import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '@/lib/likida/presupuesto';
import { cifrar, descifrar } from '@/lib/likida/conectores/cofre';
import { contextoCredencial } from '@/lib/likida/conectores/contexto_credencial';

// ═══════════════════════════════════════════════════════════════════════════
// REPOSITORIO DE LÍNEAS DE WHATSAPP POR TENANT (mig. 1006, `tenant_whatsapp_linea`).
//
// Todo va por service role: la tabla no deja escribir a `authenticated` ni leer `token_cifrado`.
//
// EL TOKEN: se cifra con el cofre v2 y el contexto `${tenantId}:${phoneNumberId}` (AAD de GCM). Copiar `token_cifrado` de la fila de un
// tenant a la de otro, o cambiar el `phone_number_id` de una fila, ya no abre: el tag falla. El token en claro SOLO existe dentro de
// `abrirToken` (que lo entrega a `canal.ts`) y en `altaLinea` (que lo recibe y lo cifra). Nunca sale en una `LineaPublica`, ni en un
// log, ni en un mensaje de error.
// ═══════════════════════════════════════════════════════════════════════════

export type EstadoLinea = 'pendiente' | 'activa' | 'pausada' | 'token_vencido';
export type PropositoLinea = 'servicio_cliente' | 'operadores' | 'oficina' | 'general';
export const PROPOSITOS_LINEA: readonly PropositoLinea[] = ['servicio_cliente', 'operadores', 'oficina', 'general'];

/** La fila tal como vive en la base, CON el token cifrado. Solo para uso interno del canal. */
export type LineaFila = {
  id: string;
  tenantId: string;
  phoneNumberId: string;
  wabaId: string | null;
  numeroVisible: string | null;
  etiqueta: string | null;
  terminalId: string | null;
  proposito: PropositoLinea | null;
  principal: boolean;
  tokenCifrado: string;
  tokenPistas: string | null;
  estado: EstadoLinea;
  ultimoError: string | null;
  verificadaEn: string | null;
  creadaEn: string;
};

/** Lo único que puede llegar a una pantalla: sin `tokenCifrado`. */
export type LineaPublica = Omit<LineaFila, 'tokenCifrado'>;

const COLUMNAS = 'id, tenant_id, phone_number_id, waba_id, numero_visible, etiqueta, terminal_id, proposito, principal, token_cifrado, token_pistas, estado, ultimo_error, verificada_en, creada_en';
const ESTADOS: readonly string[] = ['pendiente', 'activa', 'pausada', 'token_vencido'];
const TTL_MS = 30_000;
const TOPE_ULTIMO_ERROR = 300;
const UMBRAL_PISTA = 16;

type Fila = Record<string, unknown>;
const texto = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function deFila(f: Fila): LineaFila | null {
  const estado = texto(f.estado);
  const id = texto(f.id);
  const tenantId = texto(f.tenant_id);
  const phoneNumberId = texto(f.phone_number_id);
  const tokenCifrado = texto(f.token_cifrado);
  if (!id || !tenantId || !phoneNumberId || !tokenCifrado || !estado || !ESTADOS.includes(estado)) return null;
  const proposito = texto(f.proposito);
  return {
    id, tenantId, phoneNumberId, tokenCifrado,
    wabaId: texto(f.waba_id), numeroVisible: texto(f.numero_visible), etiqueta: texto(f.etiqueta), terminalId: texto(f.terminal_id),
    proposito: proposito && (PROPOSITOS_LINEA as readonly string[]).includes(proposito) ? (proposito as PropositoLinea) : null,
    principal: f.principal === true, tokenPistas: texto(f.token_pistas),
    estado: estado as EstadoLinea, ultimoError: texto(f.ultimo_error), verificadaEn: texto(f.verificada_en),
    creadaEn: texto(f.creada_en) ?? '',
  };
}

export function sinToken(l: LineaFila): LineaPublica {
  const { tokenCifrado: _omitido, ...publica } = l;
  void _omitido;
  return publica;
}

// ── Caché corta ─────────────────────────────────────────────────────────────
// Se guarda lo que devolvió la base (también el «no hay»), 30 s. Cada alta o cambio de estado la vacía entera en ESTA instancia; las
// demás instancias la ven vencer sola en 30 s como máximo.
type Entrada = { vence: number; valor: LineaFila[] | LineaFila | null };
const cache = new Map<string, Entrada>();

export function invalidarCacheLineas(): void { cache.clear(); }

function deCache<T extends LineaFila[] | LineaFila | null>(clave: string): { valor: T } | null {
  const e = cache.get(clave);
  if (!e) return null;
  if (e.vence <= Date.now()) { cache.delete(clave); return null; }
  return { valor: e.valor as T };
}
const aCache = (clave: string, valor: LineaFila[] | LineaFila | null) => { cache.set(clave, { vence: Date.now() + TTL_MS, valor }); };

/** La tabla aún no existe (la 1006 sin aplicar): se trata como «ningún tenant tiene línea propia», igual que hoy. */
function tablaAusente(error: { code?: string; message?: string }): boolean {
  return error.code === '42P01' || error.code === 'PGRST205' || /tenant_whatsapp_linea.*(does not exist|schema cache)/i.test(error.message ?? '');
}

/** Todas las líneas del tenant (activas, pendientes, vencidas y pausadas), la más nueva primero. Lanza si la base falla: el llamador decide, y NO debe caer al número global. */
export async function lineasDeTenant(tenantId: string): Promise<LineaFila[]> {
  const clave = `t:${tenantId}`;
  const hit = deCache<LineaFila[]>(clave);
  if (hit) return hit.valor;
  const { data, error } = await acotada(supabaseAdmin().from('tenant_whatsapp_linea')
    .select(COLUMNAS)
    .eq('tenant_id', tenantId)
    .order('creada_en', { ascending: false })
    .order('id', { ascending: true })
    .limit(20), 'lineasDeTenant');
  if (error) {
    if (tablaAusente(error)) { aCache(clave, []); return []; }
    logger.error('wa.linea.lectura_fallo', { tenantId, codigo: error.code ?? null });
    throw new Error('No se pudo leer la línea de WhatsApp del tenant');
  }
  const filas = ((data ?? []) as Fila[]).map(deFila).filter((l): l is LineaFila => l !== null);
  aCache(clave, filas);
  return filas;
}

/** La línea dueña de un phone_number_id, o null si no es de ningún tenant. */
export async function lineaPorPhoneNumberId(phoneNumberId: string): Promise<LineaFila | null> {
  const clave = `p:${phoneNumberId}`;
  const hit = deCache<LineaFila | null>(clave);
  if (hit) return hit.valor;
  const { data, error } = await acotada(supabaseAdmin().from('tenant_whatsapp_linea')
    .select(COLUMNAS)
    .eq('phone_number_id', phoneNumberId)
    .order('creada_en', { ascending: false })
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle(), 'lineaPorPhoneNumberId');
  if (error) {
    if (tablaAusente(error)) { aCache(clave, null); return null; }
    logger.error('wa.linea.lectura_fallo', { codigo: error.code ?? null });
    throw new Error('No se pudo leer la línea de WhatsApp');
  }
  const fila = data ? deFila(data as Fila) : null;
  aCache(clave, fila);
  return fila;
}

/**
 * Abre el token de la línea. LANZA con un mensaje fijo si no abre (llave cambiada, fila alterada, contexto cruzado): el error del
 * cofre no se propaga porque nunca debe arrastrar texto del valor guardado.
 */
export function abrirToken(l: Pick<LineaFila, 'tenantId' | 'phoneNumberId' | 'tokenCifrado'>): string {
  let valores;
  try {
    valores = descifrar(l.tokenCifrado, contextoCredencial(l.tenantId, l.phoneNumberId));
  } catch {
    throw new Error('El token de la línea de WhatsApp no se pudo abrir');
  }
  const t = valores.token;
  if (typeof t !== 'string' || t.trim() === '') throw new Error('La línea de WhatsApp no tiene token');
  return t;
}

export type AltaLinea = {
  tenantId: string; phoneNumberId: string; token: string; wabaId?: string | null; numeroVisible?: string | null;
  etiqueta?: string | null; terminalId?: string | null; proposito?: PropositoLinea | null;
  /** Línea por omisión del tenant. Solo rige cuando la línea está `activa` (una sola principal activa por tenant). */
  principal?: boolean;
};

/**
 * Da de alta una línea PENDIENTE (el tenant sigue enviando por el número global hasta que se active). Un tenant puede tener varias.
 * Devuelve la fila sin el token. Para cambiar cuál es la principal de un tenant con líneas activas: `hacerLineaPrincipal`.
 */
export async function altaLinea(a: AltaLinea): Promise<LineaPublica> {
  const phoneNumberId = a.phoneNumberId.trim();
  const token = a.token.trim();
  if (!/^\d{6,32}$/.test(phoneNumberId)) throw new Error('phone_number_id inválido');
  if (token.length < UMBRAL_PISTA) throw new Error('Token inválido');
  // El número global jamás se registra como línea de un tenant: sería mezclar a todos con uno.
  if (process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_PHONE_NUMBER_ID === phoneNumberId) {
    throw new Error('Ese número es el de la plataforma');
  }
  if (a.proposito != null && !PROPOSITOS_LINEA.includes(a.proposito)) throw new Error('Propósito de línea inválido');
  const etiqueta = a.etiqueta?.trim() ? a.etiqueta.trim().slice(0, 80) : null;
  const { data, error } = await acotada(supabaseAdmin().from('tenant_whatsapp_linea').insert({
    tenant_id: a.tenantId,
    phone_number_id: phoneNumberId,
    waba_id: a.wabaId ?? null,
    numero_visible: a.numeroVisible ?? null,
    etiqueta,
    terminal_id: a.terminalId ?? null,
    proposito: a.proposito ?? null,
    principal: a.principal === true,
    token_cifrado: cifrar({ token }, contextoCredencial(a.tenantId, phoneNumberId)),
    token_pistas: `…${token.slice(-4)}`,
    estado: 'pendiente',
  }).select(COLUMNAS).single(), 'altaLinea');
  invalidarCacheLineas();
  if (error) {
    if (error.code === '23505') throw new Error('Ese número ya tiene una línea registrada');
    logger.error('wa.linea.alta_fallo', { tenantId: a.tenantId, codigo: error.code ?? null });
    throw new Error('No se pudo registrar la línea de WhatsApp');
  }
  const fila = data ? deFila(data as Fila) : null;
  if (!fila) throw new Error('No se pudo registrar la línea de WhatsApp');
  return sinToken(fila);
}

/**
 * Cambia el estado. `ultimoError` es una frase NUESTRA (nunca la respuesta cruda de Meta, que puede traer el token); se recorta.
 * Pasar a `activa` marca `verificada_en`. Devuelve false si la fila no existe o la base rechazó el cambio (p. ej. ya hay otra viva).
 */
export async function cambiarEstadoLinea(lineaId: string, estado: EstadoLinea, ultimoError: string | null = null, desde?: readonly EstadoLinea[]): Promise<boolean> {
  const cambios: Record<string, unknown> = { estado, ultimo_error: ultimoError === null ? null : ultimoError.slice(0, TOPE_ULTIMO_ERROR) };
  if (estado === 'activa') cambios.verificada_en = new Date().toISOString();
  let q = supabaseAdmin().from('tenant_whatsapp_linea').update(cambios).eq('id', lineaId);
  if (desde && desde.length > 0) q = q.in('estado', [...desde]);
  const { data, error } = await acotada(q.select('id'), 'cambiarEstadoLinea');
  invalidarCacheLineas();
  if (error) {
    logger.error('wa.linea.estado_fallo', { lineaId, codigo: error.code ?? null });
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

/**
 * Cambia la principal del tenant de forma ATÓMICA (una función SQL en una sola transacción: baja la vigente y sube la indicada, que debe
 * estar `activa`). Devuelve false si la línea no existe, no está activa o la base rechazó el cambio; nunca deja dos principales.
 */
export async function hacerLineaPrincipal(lineaId: string): Promise<boolean> {
  const { data, error } = await acotada(supabaseAdmin().rpc('tenant_whatsapp_linea_hacer_principal', { p_linea_id: lineaId }), 'hacerLineaPrincipal');
  invalidarCacheLineas();
  if (error) {
    logger.error('wa.linea.principal_fallo', { lineaId, codigo: error.code ?? null });
    return false;
  }
  return data === true;
}
