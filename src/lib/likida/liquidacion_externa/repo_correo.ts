// ═══════════════════════════════════════════════════════════════════════════
// LIQUIDACIÓN POR CORREO — el ÚNICO acceso a datos nuevo del frente (T-A1-13).
//
// Tablas de las migraciones 0785 (correo del operador, coordinadores, config), 0786 (encabezado del desglose,
// excepciones, estado del pull) y 0787 (cola de entrega por correo + RPC de reclamo).
//
// Reglas de todo este archivo (las de `CLAUDE.md`):
//   · service_role salta RLS: CADA consulta lleva `.eq('tenant_id')`, y toda va por `acotada`;
//   · los errores de Supabase llegan por valor: se revisan y se LANZAN (`exigir`). «No pude leer» jamás es «no hay nada»;
//   · sin la migración (42P01 / PGRST205) las LECTURAS devuelven `{ ok: false, motivo: 'no_disponible' }` en vez de
//     lanzar (patrón de `avisosPendientes`): el módulo convive con una base sin 0785-0787. Las ESCRITURAS lanzan con un
//     mensaje que nombra la migración: nunca fingen haber guardado;
//   · sin selección comodín de columnas; los cambios de estado son UPDATE condicionados (el candado), nunca leer-y-luego-escribir;
//   · lo único que cruza flotas es la RPC `reclamar_entregas_correo` (el cron de envío barre todas en una pasada, como
//     `trabajo.ts`): es una RPC, no un `.from`, y cada fila que devuelve trae su `tenant_id`, al que se ancla TODO lo
//     que se haga después con ella (`marcar*` exigen `tenantId` y el `claim_token`).
//
// Ningún otro archivo nuevo del frente importa `supabaseAdmin`: todo pasa por aquí. El Storage reutiliza los helpers de
// `repo.ts` (bucket `liquidaciones`) y las rutas direccionadas por contenido de `almacen.ts`.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { exigir, traerTodo } from '../pg';
import { DatoInvalido } from '../errores';
import { rutaPdfExterno, rutaExcelExterno } from './almacen';
import { subirArchivoExterno, firmarPdfExterno, leerPorId, TIPO_XLSX, type NuevaLiquidacionExterna } from './repo';
import type { CursorDesglose } from './desglose_puerto';
import type { PuertoContactos, OperadorContacto } from './contactos_csv';
import type { RolDestinatario } from './correo_destinatarios';

// ── Tipos públicos ──────────────────────────────────────────────────────────

export type Lectura<T> = { ok: true; valor: T } | { ok: false; motivo: 'no_disponible' };
export type CanalEntrega = 'whatsapp' | 'correo' | 'ambos';
export type EstadoEntregaCorreo = 'pendiente' | 'enviando' | 'enviada' | 'entregada' | 'rebotada' | 'queja' | 'fallida' | 'omitida';
export type TipoExcepcion =
  | 'sin_poliza' | 'operador_no_encontrado' | 'operador_sin_correo' | 'coordinador_sin_correo' | 'total_no_cuadra'
  | 'concepto_prohibido' | 'neto_negativo' | 'tipo_sin_regla' | 'correccion_pendiente' | 'mapeo_invalido'
  | 'unidades_mezcladas';

export interface ConfigCorreo {
  canal: CanalEntrega;
  activa: boolean;
  remitenteNombre: string | null;
  responderA: string | null;
  rhCorreos: string[];
  archivoCorreo: string | null;
  enviaCoordinador: boolean;
  enviaRh: boolean;
  etiquetaViaje: string;
  agruparViaje: boolean;
  conceptosViaje: string[];
  renombres: unknown[];
  conceptosProhibidos: string[];
  tiposQueReciben: string[];
  netoNegativo: 'retener' | 'enviar';
  enviarDesdeHora: number | null;
}

/** Lo que vale cuando la flota no tiene fila: el comportamiento de siempre (WhatsApp), sin enviar nada por correo. */
export const CONFIG_CORREO_POR_DEFECTO: ConfigCorreo = {
  canal: 'whatsapp', activa: false, remitenteNombre: null, responderA: null, rhCorreos: [], archivoCorreo: null,
  enviaCoordinador: true, enviaRh: true, etiquetaViaje: 'Pago de viaje', agruparViaje: false,
  conceptosViaje: ['Sueldo', 'Viáticos'], renombres: [], conceptosProhibidos: [], tiposQueReciben: ['foraneo', 'local'],
  netoNegativo: 'retener', enviarDesdeHora: null,
};

export interface ContactoOperador { operadorId: string; correo: string | null; correoRebotadoEn: string | null; coordinadorId: string | null }
export interface Coordinador { id: string; nombre: string | null; correo: string; activo: boolean }

export interface MetaDesglose {
  liquidacionExternaId: string;
  bitacora: string;
  terminal?: string | null;
  poliza?: string | null;
  unidad?: string | null;
  tipoOperador?: 'foraneo' | 'local' | 'permisionario' | null;
  dias?: number | null;
  totalOrigen: 'tms' | 'calculado';
  retenidaMotivo?: string | null;
  /** 0789: número de liquidación y de pago del origen, y todas las bitácoras que la liquidación junta. */
  numeroLiquidacion?: string | null;
  numeroPago?: string | null;
  bitacoras?: string[] | null;
}
export interface Desglose extends Required<Omit<MetaDesglose, 'retenidaMotivo' | 'numeroLiquidacion' | 'numeroPago' | 'bitacoras'>> {
  numeroLiquidacion?: string | null;
  numeroPago?: string | null;
  bitacoras?: string[] | null;
  enviadoOrigenEn: string | null;
  retenidaMotivo: string | null;
  creadoEn: string;
}

export interface NuevaEntrega { liquidacionExternaId: string; generacion?: number; rol: RolDestinatario; correo: string; xlsxRuta?: string | null; xlsxSha256?: string | null; disparo?: 'auto' | 'manual' | 'reclamo'; pedidoPor?: string | null }
export interface EntregaCorreo {
  id: string;
  tenantId: string;
  liquidacionExternaId: string;
  generacion: number;
  rol: RolDestinatario;
  correo: string;
  estado: EstadoEntregaCorreo;
  intentos: number;
  proximoIntentoEn: string;
  claimToken: string | null;
  claimExpiraEn: string | null;
  resendId: string | null;
  ultimoError: string | null;
  disparo: string;
  xlsxRuta: string | null;
  xlsxSha256: string | null;
  enviadaEn: string | null;
  entregadaEn: string | null;
  rebotadaEn: string | null;
  creadaEn: string;
}

export interface Excepcion { id: number; claveExterna: string; tipo: TipoExcepcion; detalle: Record<string, unknown>; primeraVez: string; ultimaVez: string; resueltaEn: string | null }
export interface EstadoPull { cursor: CursorDesglose | null; ultimaCorrida: string | null; ultimoExito: string | null; ultimoError: string | null; leidas: number; importadas: number; excepciones: number }
export interface ConteoInsights {
  desgloses: number;
  entregasPorEstado: Partial<Record<EstadoEntregaCorreo, number>>;
  excepcionesAbiertas: number;
}

// ── Utilidades internas ─────────────────────────────────────────────────────

const FORMA_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TOPE_ERROR = 1000;

type ErrorPg = { message?: string; code?: string } | null;
const tablaAusente = (e: ErrorPg): boolean =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202' || e.code === '42883'
    || /does not exist|schema cache/i.test(e.message ?? ''));
const esDuplicado = (e: ErrorPg): boolean => !!e && (e.code === '23505' || /duplicate key/i.test(e.message ?? ''));

/** Lanza si la respuesta trae error; si el error es «tabla ausente», lanza uno que nombra la migración. */
function exigirEscritura<T>(res: { data: T | null; error: ErrorPg }, consulta: string): T | null {
  if (tablaAusente(res.error)) throw new Error(`${consulta}: la base no tiene las migraciones 0785-0787 (liquidación por correo)`);
  return exigir(res as { data: T | null; error: { message: string } | null }, consulta);
}

/** Lectura que tolera la ausencia de la migración: `no_disponible` en vez de lanzar. Cualquier otro error lanza. */
function leer<T>(res: { data: T | null; error: ErrorPg }, consulta: string): Lectura<T | null> {
  if (res.error) {
    if (tablaAusente(res.error)) return { ok: false, motivo: 'no_disponible' };
    throw new Error(`${consulta}: ${res.error.message ?? 'error de base'}`);
  }
  return { ok: true, valor: res.data };
}

const recortar = (t: string | null | undefined): string | null => (t == null ? null : String(t).slice(0, TOPE_ERROR));

function normalizarCorreo(c: string | null | undefined, campo: string): string | null {
  const t = (c ?? '').trim().toLowerCase();
  if (t === '') return null;
  if (t.length > 254 || !FORMA_CORREO.test(t)) throw new DatoInvalido(`${campo}: el correo no tiene forma de correo`);
  return t;
}

type Fila = Record<string, unknown>;

// ── Configuración de la flota ───────────────────────────────────────────────

const COLS_CONFIG =
  'canal, activa, remitente_nombre, responder_a, rh_correos, archivo_correo, envia_coordinador, envia_rh, etiqueta_viaje, '
  + 'agrupar_viaje, conceptos_viaje, renombres, conceptos_prohibidos, tipos_que_reciben, neto_negativo, enviar_desde_hora';

function aConfig(r: Fila): ConfigCorreo {
  const lista = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  return {
    canal: r.canal as CanalEntrega,
    activa: r.activa === true,
    remitenteNombre: (r.remitente_nombre as string | null) ?? null,
    responderA: (r.responder_a as string | null) ?? null,
    rhCorreos: lista(r.rh_correos),
    archivoCorreo: (r.archivo_correo as string | null) ?? null,
    enviaCoordinador: r.envia_coordinador !== false,
    enviaRh: r.envia_rh !== false,
    etiquetaViaje: String(r.etiqueta_viaje ?? CONFIG_CORREO_POR_DEFECTO.etiquetaViaje),
    agruparViaje: r.agrupar_viaje === true,
    conceptosViaje: lista(r.conceptos_viaje),
    renombres: Array.isArray(r.renombres) ? (r.renombres as unknown[]) : [],
    conceptosProhibidos: lista(r.conceptos_prohibidos),
    tiposQueReciben: lista(r.tipos_que_reciben),
    netoNegativo: r.neto_negativo === 'enviar' ? 'enviar' : 'retener',
    enviarDesdeHora: r.enviar_desde_hora == null ? null : Number(r.enviar_desde_hora),
  };
}

/** Sin fila ⇒ el defecto (WhatsApp, inactiva). Tabla ausente ⇒ `no_disponible`. Cualquier otro error LANZA. */
export async function leerConfigCorreo(tenantId: string): Promise<Lectura<ConfigCorreo>> {
  const res = await acotada(supabaseAdmin().from('liquidacion_correo_config')
    .select(COLS_CONFIG).eq('tenant_id', tenantId).maybeSingle(), 'liqcorreo.config_leer');
  const l = leer(res as unknown as { data: Fila | null; error: ErrorPg }, 'liqcorreo.config_leer');
  if (!l.ok) return l;
  return { ok: true, valor: l.valor ? aConfig(l.valor) : { ...CONFIG_CORREO_POR_DEFECTO } };
}

export async function guardarConfigCorreo(tenantId: string, c: ConfigCorreo, por: string | null): Promise<void> {
  if (!['whatsapp', 'correo', 'ambos'].includes(c.canal)) throw new DatoInvalido('canal: debe ser whatsapp, correo o ambos');
  if (c.rhCorreos.length > 3) throw new DatoInvalido('rh_correos: máximo 3 correos');
  const rh = c.rhCorreos.map((x) => normalizarCorreo(x, 'rh_correos')).filter((x): x is string => x !== null);
  if (c.enviarDesdeHora != null && !(Number.isInteger(c.enviarDesdeHora) && c.enviarDesdeHora >= 0 && c.enviarDesdeHora <= 23)) {
    throw new DatoInvalido('enviar_desde_hora: debe ser un entero de 0 a 23');
  }
  // A37-A1-04: el correo promete «responde a este correo»; sin «Responder a» la respuesta cae en el buzón de campañas y se pierde.
  if (c.activa && c.canal !== 'whatsapp' && !normalizarCorreo(c.responderA, 'responder_a')) {
    throw new DatoInvalido('responder_a: es obligatorio para activar el envío por correo (ahí llegan las respuestas del operador)');
  }
  const fila = {
    tenant_id: tenantId,
    canal: c.canal,
    activa: c.activa,
    remitente_nombre: c.remitenteNombre?.trim() || null,
    responder_a: normalizarCorreo(c.responderA, 'responder_a'),
    rh_correos: rh,
    archivo_correo: normalizarCorreo(c.archivoCorreo, 'archivo_correo'),
    envia_coordinador: c.enviaCoordinador,
    envia_rh: c.enviaRh,
    etiqueta_viaje: c.etiquetaViaje,
    agrupar_viaje: c.agruparViaje,
    conceptos_viaje: c.conceptosViaje,
    renombres: c.renombres,
    conceptos_prohibidos: c.conceptosProhibidos,
    tipos_que_reciben: c.tiposQueReciben,
    neto_negativo: c.netoNegativo,
    enviar_desde_hora: c.enviarDesdeHora,
    actualizado_en: new Date().toISOString(),
    actualizado_por: por,
  };
  const res = await acotada(supabaseAdmin().from('liquidacion_correo_config')
    .upsert(fila, { onConflict: 'tenant_id' }).select('tenant_id'), 'liqcorreo.config_guardar');
  exigirEscritura(res as unknown as { data: unknown; error: ErrorPg }, 'liqcorreo.config_guardar');
}

// ── Contacto del operador y coordinadores ───────────────────────────────────

export async function leerContactoOperador(tenantId: string, operadorId: string): Promise<Lectura<ContactoOperador | null>> {
  const res = await acotada(supabaseAdmin().from('operador')
    .select('id, correo, correo_rebotado_en, coordinador_id')
    .eq('tenant_id', tenantId).eq('id', operadorId).maybeSingle(), 'liqcorreo.operador_leer');
  const l = leer(res as unknown as { data: Fila | null; error: ErrorPg }, 'liqcorreo.operador_leer');
  if (!l.ok) return l;
  const r = l.valor;
  return {
    ok: true,
    valor: r ? {
      operadorId: String(r.id),
      correo: (r.correo as string | null) ?? null,
      correoRebotadoEn: (r.correo_rebotado_en as string | null) ?? null,
      coordinadorId: (r.coordinador_id as string | null) ?? null,
    } : null,
  };
}

/** Cambia el correo y/o el coordinador. Un correo nuevo borra el rebote anterior (era del correo viejo). */
export async function guardarContactoOperador(
  tenantId: string, operadorId: string, cambios: { correo?: string | null; coordinadorId?: string | null },
): Promise<void> {
  const set: Fila = {};
  if (cambios.correo !== undefined) { set.correo = normalizarCorreo(cambios.correo, 'correo'); set.correo_rebotado_en = null; }
  if (cambios.coordinadorId !== undefined) set.coordinador_id = cambios.coordinadorId;
  if (Object.keys(set).length === 0) return;
  const res = await acotada(supabaseAdmin().from('operador').update(set)
    .eq('tenant_id', tenantId).eq('id', operadorId).select('id'), 'liqcorreo.operador_guardar');
  const filas = exigirEscritura(res as unknown as { data: Fila[] | null; error: ErrorPg }, 'liqcorreo.operador_guardar') ?? [];
  if (filas.length === 0) throw new DatoInvalido('No encontré a ese operador en la flota');
}

const aCoordinador = (r: Fila): Coordinador => ({
  id: String(r.id), nombre: (r.nombre as string | null) ?? null, correo: String(r.correo), activo: r.activo !== false,
});

export async function listarCoordinadores(tenantId: string): Promise<Lectura<Coordinador[]>> {
  const res = await acotada(supabaseAdmin().from('liquidacion_coordinador')
    .select('id, nombre, correo, activo').eq('tenant_id', tenantId).order('correo').order('id').limit(500), 'liqcorreo.coordinadores_listar');
  const l = leer(res as unknown as { data: Fila[] | null; error: ErrorPg }, 'liqcorreo.coordinadores_listar');
  if (!l.ok) return l;
  return { ok: true, valor: (l.valor ?? []).map(aCoordinador) };
}

/** Alta (sin `id`) o edición (con `id`). Un correo ya registrado en la flota ⇒ DatoInvalido, no un 500. */
export async function guardarCoordinador(
  tenantId: string, c: { id?: string; nombre?: string | null; correo: string; activo?: boolean },
): Promise<Coordinador> {
  const correo = normalizarCorreo(c.correo, 'correo');
  if (!correo) throw new DatoInvalido('correo: el coordinador necesita un correo');
  const nombre = c.nombre?.trim() || null;
  const q = supabaseAdmin().from('liquidacion_coordinador');
  const res = c.id
    ? await acotada(q.update({ nombre, correo, activo: c.activo ?? true }).eq('tenant_id', tenantId).eq('id', c.id)
      .select('id, nombre, correo, activo').maybeSingle(), 'liqcorreo.coordinador_editar')
    : await acotada(q.insert({ tenant_id: tenantId, nombre, correo, activo: c.activo ?? true })
      .select('id, nombre, correo, activo').maybeSingle(), 'liqcorreo.coordinador_crear');
  const r = res as unknown as { data: Fila | null; error: ErrorPg };
  if (esDuplicado(r.error)) throw new DatoInvalido('Ese correo ya está registrado como coordinador en la flota');
  const fila = exigirEscritura(r, 'liqcorreo.coordinador_guardar');
  if (!fila) throw new DatoInvalido('No encontré a ese coordinador en la flota');
  return aCoordinador(fila);
}

// ── Carga de contactos (A37-A1-01) ──────────────────────────────────────────

/** Cuántos operadores de la flota tienen correo cargado: sin ninguno, activar el envío abriría una excepción por cada desglose. */
export async function contarOperadoresConCorreo(tenantId: string): Promise<number> {
  const res = await acotada(supabaseAdmin().from('operador')
    .select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).not('correo', 'is', null), 'liqcorreo.operadores_con_correo');
  const r = res as unknown as { count: number | null; error: ErrorPg };
  if (r.error) throw new Error(`liqcorreo.operadores_con_correo: ${r.error.message ?? 'error'}`);
  return r.count ?? 0;
}

/**
 * Guardia de ACTIVAR el envío por correo (A37-A1-01): con ningún correo de operador cargado, cada desglose abriría
 * `operador_sin_correo` y solo recibirían RH y archivo. Lanza `DatoInvalido` con el camino para cargarlos.
 */
export async function exigirContactosParaActivar(tenantId: string, c: Pick<ConfigCorreo, 'activa' | 'canal'>): Promise<void> {
  if (!c.activa || c.canal === 'whatsapp') return;
  if ((await contarOperadoresConCorreo(tenantId)) === 0) {
    throw new DatoInvalido('Antes de activar el envío por correo carga los correos de los operadores (POST /v1/liquidaciones-externas/contactos): hoy ninguno tiene correo y cada desglose quedaría como excepción «operador sin correo».');
  }
}

/** El adaptador real de `aplicarContactos` sobre este repo: todo acotado a la flota, sin tocar `telefono`. */
export function puertoContactosReal(tenantId: string): PuertoContactos {
  return {
    async buscarOperadores(numeros) {
      const salida = new Map<string, OperadorContacto[]>();
      const unicos = [...new Set(numeros)];
      for (let i = 0; i < unicos.length; i += 200) {
        const res = await acotada(supabaseAdmin().from('operador')
          .select('id, numero_empleado, correo, coordinador_id').eq('tenant_id', tenantId).in('numero_empleado', unicos.slice(i, i + 200))
          .order('id').limit(1000), 'liqcorreo.contactos_buscar');
        const r = res as unknown as { data: Fila[] | null; error: ErrorPg };
        for (const f of exigirEscritura(r, 'liqcorreo.contactos_buscar') ?? []) {
          const k = String(f.numero_empleado);
          salida.set(k, [...(salida.get(k) ?? []), {
            id: String(f.id), correo: (f.correo as string | null) ?? null, coordinadorId: (f.coordinador_id as string | null) ?? null,
          }]);
        }
      }
      return salida;
    },
    async asegurarCoordinador({ correo, nombre }) {
      const c = normalizarCorreo(correo, 'correo');
      if (!c) throw new DatoInvalido('correo: el coordinador necesita un correo');
      const buscar = async (): Promise<Fila | null> => {
        const res = await acotada(supabaseAdmin().from('liquidacion_coordinador')
          .select('id, nombre').eq('tenant_id', tenantId).eq('correo', c).maybeSingle(), 'liqcorreo.coordinador_buscar');
        return exigirEscritura(res as unknown as { data: Fila | null; error: ErrorPg }, 'liqcorreo.coordinador_buscar');
      };
      const previo = await buscar();
      if (previo) {
        if (nombre && !previo.nombre) {
          await acotada(supabaseAdmin().from('liquidacion_coordinador').update({ nombre }).eq('tenant_id', tenantId).eq('id', String(previo.id)), 'liqcorreo.coordinador_nombre');
        }
        return { id: String(previo.id), creado: false };
      }
      try {
        const nuevo = await guardarCoordinador(tenantId, { nombre, correo: c });
        return { id: nuevo.id, creado: true };
      } catch (e) {
        // La carrera de dos cargas: el otro proceso lo creó entre la lectura y la inserción.
        const ya = await buscar();
        if (ya) return { id: String(ya.id), creado: false };
        throw e;
      }
    },
    async guardarContacto(operadorId, cambios) {
      await guardarContactoOperador(tenantId, operadorId, cambios);
    },
    // A37-S48-06: el puerto NO traía esta consulta, así que el choque con otro operador de la flota nunca se detectaba.
    // Los correos se guardan en minúsculas (el import los normaliza); se consulta por igualdad y se descartan en memoria
    // los operadores que el propio archivo va a tocar. Un error de lectura LANZA: sin saberlo, no se escribe.
    async correosEnUsoPorOtros(correos, excluirOperadorIds) {
      const excluidos = new Set(excluirOperadorIds);
      const ocupados = new Set<string>();
      const lista = [...new Set(correos.map((c) => c.toLowerCase()))];
      for (let i = 0; i < lista.length; i += 200) {
        const res = await acotada(supabaseAdmin().from('operador')
          .select('id, correo').eq('tenant_id', tenantId).in('correo', lista.slice(i, i + 200))
          .order('id').limit(1000), 'liqcorreo.contactos_choques');
        const r = res as unknown as { data: Fila[] | null; error: ErrorPg };
        for (const f of exigirEscritura(r, 'liqcorreo.contactos_choques') ?? []) {
          if (!excluidos.has(String(f.id)) && typeof f.correo === 'string') ocupados.add(f.correo.toLowerCase());
        }
      }
      return ocupados;
    },
  };
}

// ── Encabezado del desglose ─────────────────────────────────────────────────

/** Una fila por liquidación (clave primaria). Reintentar la misma no duplica ni pisa: devuelve `false`. */
export async function insertarDesglose(tenantId: string, m: MetaDesglose): Promise<boolean> {
  const fila = {
    liquidacion_externa_id: m.liquidacionExternaId, tenant_id: tenantId, bitacora: m.bitacora,
    terminal: m.terminal ?? null, poliza: m.poliza ?? null, unidad: m.unidad ?? null,
    tipo_operador: m.tipoOperador ?? null, dias: m.dias ?? null, total_origen: m.totalOrigen,
    retenida_motivo: recortar(m.retenidaMotivo),
    // 0789: solo si vienen, para no exigir las columnas nuevas a quien no las usa.
    ...(m.numeroLiquidacion != null ? { numero_liquidacion: m.numeroLiquidacion } : {}),
    ...(m.numeroPago != null ? { numero_pago: m.numeroPago } : {}),
    ...(m.bitacoras != null ? { bitacoras: m.bitacoras } : {}),
  };
  const res = await acotada(supabaseAdmin().from('liquidacion_desglose').insert(fila).select('liquidacion_externa_id'), 'liqcorreo.desglose_insertar');
  const r = res as unknown as { data: unknown; error: ErrorPg };
  if (esDuplicado(r.error)) return false;
  exigirEscritura(r, 'liqcorreo.desglose_insertar');
  return true;
}

const COLS_DESGLOSE =
  'liquidacion_externa_id, bitacora, terminal, poliza, unidad, tipo_operador, dias, total_origen, enviado_origen_en, retenida_motivo, created_at';

function aDesglose(r: Fila): Desglose {
  return {
    liquidacionExternaId: String(r.liquidacion_externa_id), bitacora: String(r.bitacora),
    terminal: (r.terminal as string | null) ?? null, poliza: (r.poliza as string | null) ?? null,
    unidad: (r.unidad as string | null) ?? null, tipoOperador: (r.tipo_operador as Desglose['tipoOperador']) ?? null,
    dias: r.dias == null ? null : Number(r.dias), totalOrigen: r.total_origen as 'tms' | 'calculado',
    enviadoOrigenEn: (r.enviado_origen_en as string | null) ?? null, retenidaMotivo: (r.retenida_motivo as string | null) ?? null,
    creadoEn: String(r.created_at),
  };
}

/** El encabezado de UN desglose (para el detalle). `null` = no hay fila; `no_disponible` = no se pudo leer. */
export async function leerDesglose(tenantId: string, liquidacionId: string): Promise<Lectura<Desglose | null>> {
  const res = await acotada(supabaseAdmin().from('liquidacion_desglose').select(COLS_DESGLOSE)
    .eq('tenant_id', tenantId).eq('liquidacion_externa_id', liquidacionId).maybeSingle(), 'liqcorreo.desglose_leer');
  const l = leer(res as unknown as { data: Fila | null; error: ErrorPg }, 'liqcorreo.desglose_leer');
  if (!l.ok) return l;
  return { ok: true, valor: l.valor ? aDesglose(l.valor) : null };
}

/**
 * Quita la retención de un desglose (una persona decidió enviarlo). UPDATE condicionado a que siga retenido: dos clics seguidos
 * no se pisan y la segunda llamada devuelve `false`.
 */
export async function liberarRetencionDesglose(tenantId: string, liquidacionId: string): Promise<boolean> {
  const res = await acotada(supabaseAdmin().from('liquidacion_desglose').update({ retenida_motivo: null })
    .eq('tenant_id', tenantId).eq('liquidacion_externa_id', liquidacionId).not('retenida_motivo', 'is', null).select('liquidacion_externa_id'),
  'liqcorreo.desglose_liberar');
  return (exigirEscritura(res as unknown as { data: Fila[] | null; error: ErrorPg }, 'liqcorreo.desglose_liberar') ?? []).length > 0;
}

export interface FiltroDesgloses { bitacora?: string; terminal?: string; soloRetenidos?: boolean; limite?: number }
export interface CursorLista { creadoEn: string; id: string }

/** Keyset descendente por `(created_at, liquidacion_externa_id)`. `siguiente` es null cuando ya no hay más. */
export async function listarDesgloses(
  tenantId: string, filtro: FiltroDesgloses = {}, cursor: CursorLista | null = null,
): Promise<Lectura<{ items: Desglose[]; siguiente: CursorLista | null }>> {
  const limite = Math.min(Math.max(Math.trunc(filtro.limite ?? 50), 1), 200);
  let q = supabaseAdmin().from('liquidacion_desglose').select(COLS_DESGLOSE).eq('tenant_id', tenantId);
  if (filtro.bitacora) q = q.eq('bitacora', filtro.bitacora);
  if (filtro.terminal) q = q.eq('terminal', filtro.terminal);
  if (filtro.soloRetenidos) q = q.not('retenida_motivo', 'is', null);
  if (cursor) {
    q = q.or(`created_at.lt.${cursor.creadoEn},and(created_at.eq.${cursor.creadoEn},liquidacion_externa_id.lt.${cursor.id})`);
  }
  const res = await acotada(q.order('created_at', { ascending: false }).order('liquidacion_externa_id', { ascending: false }).limit(limite + 1),
  'liqcorreo.desgloses_listar');
  const l = leer(res as unknown as { data: Fila[] | null; error: ErrorPg }, 'liqcorreo.desgloses_listar');
  if (!l.ok) return l;
  const filas = l.valor ?? [];
  const hayMas = filas.length > limite;
  const items = filas.slice(0, limite).map(aDesglose);
  const ultimo = items[items.length - 1];
  return { ok: true, valor: { items, siguiente: hayMas && ultimo ? { creadoEn: ultimo.creadoEn, id: ultimo.liquidacionExternaId } : null } };
}

// ── Entregas por correo ─────────────────────────────────────────────────────

const COLS_ENTREGA =
  'id, tenant_id, liquidacion_externa_id, generacion, rol, correo, estado, intentos, proximo_intento_en, claim_token, claim_expira_en, '
  + 'resend_id, ultimo_error, disparo, xlsx_ruta, xlsx_sha256, enviada_en, entregada_en, rebotada_en, created_at';

function aEntrega(r: Fila): EntregaCorreo {
  return {
    id: String(r.id), tenantId: String(r.tenant_id), liquidacionExternaId: String(r.liquidacion_externa_id),
    generacion: Number(r.generacion), rol: r.rol as RolDestinatario, correo: String(r.correo), estado: r.estado as EstadoEntregaCorreo,
    intentos: Number(r.intentos), proximoIntentoEn: String(r.proximo_intento_en),
    claimToken: (r.claim_token as string | null) ?? null, claimExpiraEn: (r.claim_expira_en as string | null) ?? null,
    resendId: (r.resend_id as string | null) ?? null, ultimoError: (r.ultimo_error as string | null) ?? null,
    disparo: String(r.disparo), xlsxRuta: (r.xlsx_ruta as string | null) ?? null, xlsxSha256: (r.xlsx_sha256 as string | null) ?? null,
    enviadaEn: (r.enviada_en as string | null) ?? null, entregadaEn: (r.entregada_en as string | null) ?? null,
    rebotadaEn: (r.rebotada_en as string | null) ?? null, creadaEn: String(r.created_at),
  };
}

/**
 * Crea una fila por destinatario. NO duplica: el índice único `(liquidación, generación, rol, lower(correo))` es la
 * idempotencia. Un lote que choca se reinserta fila por fila para que lo ya existente no tire lo nuevo. Devuelve cuántas
 * filas se crearon de verdad (0 en la segunda llamada idéntica).
 */
export async function insertarEntregas(tenantId: string, rows: NuevaEntrega[]): Promise<number> {
  if (rows.length === 0) return 0;
  const filas = rows.map((e) => ({
    tenant_id: tenantId, liquidacion_externa_id: e.liquidacionExternaId, generacion: e.generacion ?? 1, rol: e.rol,
    correo: normalizarCorreo(e.correo, 'correo') ?? '', xlsx_ruta: e.xlsxRuta ?? null, xlsx_sha256: e.xlsxSha256 ?? null,
    disparo: e.disparo ?? 'auto', pedido_por: e.pedidoPor ?? null,
  }));
  if (filas.some((f) => f.correo === '')) throw new DatoInvalido('correo: toda entrega necesita un correo');

  const lote = await acotada(supabaseAdmin().from('liquidacion_entrega_correo').insert(filas).select('id'), 'liqcorreo.entregas_insertar');
  const rl = lote as unknown as { data: Fila[] | null; error: ErrorPg };
  if (!esDuplicado(rl.error)) return (exigirEscritura(rl, 'liqcorreo.entregas_insertar') ?? []).length;

  let creadas = 0;
  for (const f of filas) {
    const uno = await acotada(supabaseAdmin().from('liquidacion_entrega_correo').insert(f).select('id'), 'liqcorreo.entregas_insertar_una');
    const ru = uno as unknown as { data: Fila[] | null; error: ErrorPg };
    if (esDuplicado(ru.error)) continue;
    creadas += (exigirEscritura(ru, 'liqcorreo.entregas_insertar_una') ?? []).length;
  }
  return creadas;
}

/** Lo que recibe la RPC 0857: todo lo que `recibirDesglose` escribe, para guardarlo en UNA transacción. */
export interface PedidoRecepcionAtomica {
  liquidacion: NuevaLiquidacionExterna;
  meta: Omit<MetaDesglose, 'liquidacionExternaId'>;
  evento: Record<string, unknown>;
  entregas: Array<Omit<NuevaEntrega, 'liquidacionExternaId'>>;
}
export interface RecepcionAtomica { liquidacionId: string; creada: boolean; reparada: boolean; entregas: number }

/**
 * Liquidación + encabezado + evento + entregas en una sola transacción (RPC 0857, hallazgo A35-A1-01). Si la liquidación ya
 * existe con la misma huella pero a medias, la RPC completa lo que falta. `no_disponible` = la base aún no tiene la 0857: el
 * llamador cae al camino anterior (no atómico) y lo avisa. Cualquier otro error LANZA: nada queda a medias y se reintenta.
 */
export async function recibirDesgloseAtomico(tenantId: string, p: PedidoRecepcionAtomica): Promise<Lectura<RecepcionAtomica>> {
  const d = p.liquidacion.datos;
  const m = p.meta;
  const res = await acotada(supabaseAdmin().rpc('recibir_desglose_atomico', {
    p_tenant: tenantId,
    p_liquidacion: {
      clave_externa: d.claveExterna, huella: p.liquidacion.huella, sistema_origen: d.sistemaOrigen,
      operador_id: p.liquidacion.operadorId, folios_viaje: d.viajes, viaje_ids: p.liquidacion.viajeIds,
      periodo_desde: d.periodo.desde, periodo_hasta: d.periodo.hasta, conceptos: d.conceptos, total: d.total, moneda: d.moneda,
      pdf_ruta: p.liquidacion.pdfRuta, pdf_origen: p.liquidacion.pdfOrigen, pdf_sha256: p.liquidacion.pdfSha256,
    },
    p_desglose: {
      bitacora: m.bitacora, terminal: m.terminal ?? null, poliza: m.poliza ?? null, unidad: m.unidad ?? null,
      tipo_operador: m.tipoOperador ?? null, dias: m.dias ?? null, total_origen: m.totalOrigen,
      retenida_motivo: recortar(m.retenidaMotivo), numero_liquidacion: m.numeroLiquidacion ?? null,
      numero_pago: m.numeroPago ?? null, bitacoras: m.bitacoras ?? null,
    },
    p_evento: p.evento,
    p_entregas: p.entregas.map((e) => ({
      rol: e.rol, correo: normalizarCorreo(e.correo, 'correo') ?? '', xlsx_ruta: e.xlsxRuta ?? null,
      xlsx_sha256: e.xlsxSha256 ?? null, disparo: e.disparo ?? 'auto',
    })),
  }), 'liqcorreo.recibir_atomico');
  const r = res as unknown as { data: { liquidacion_id?: string; creada?: boolean; reparada?: boolean; entregas?: number } | null; error: ErrorPg };
  if (r.error) {
    if (r.error.code === '42883' || r.error.code === 'PGRST202' || /could not find the function/i.test(r.error.message ?? '')) {
      return { ok: false, motivo: 'no_disponible' };
    }
    throw new Error(`liqcorreo.recibir_atomico: ${r.error.message ?? 'error de base'}`);
  }
  if (!r.data || typeof r.data.liquidacion_id !== 'string') throw new Error('liqcorreo.recibir_atomico: respuesta sin liquidacion_id');
  return {
    ok: true,
    valor: { liquidacionId: r.data.liquidacion_id, creada: r.data.creada === true, reparada: r.data.reparada === true, entregas: Number(r.data.entregas ?? 0) },
  };
}

/**
 * ¿Quedó a medias una recepción anterior? (sin encabezado, o sin retención y sin una sola entrega). Es lo que dejaba el camino
 * no atómico tras un corte; hoy lo rescata `recibirDesglose`. Si no se puede leer, `false` (no inventa trabajo).
 */
export async function desgloseIncompleto(tenantId: string, liquidacionId: string): Promise<boolean> {
  const d = await leerDesglose(tenantId, liquidacionId);
  if (!d.ok) return false;
  if (d.valor === null) return true;
  if (d.valor.retenidaMotivo !== null) return false;
  const e = await entregasDe(tenantId, liquidacionId);
  return e.ok && e.valor.length === 0;
}

/** Reclama hasta `limite` entregas listas (RPC 0787, `for update skip locked`). Cruza flotas a propósito: cada fila trae su tenant. */
export async function reclamarEntregas(limite: number, ahora: Date, leaseSeg = 120): Promise<Lectura<EntregaCorreo[]>> {
  const res = await acotada(supabaseAdmin().rpc('reclamar_entregas_correo', {
    p_limite: limite, p_ahora: ahora.toISOString(), p_lease_seg: leaseSeg,
  }), 'liqcorreo.reclamar');
  const l = leer(res as unknown as { data: Fila[] | null; error: ErrorPg }, 'liqcorreo.reclamar');
  if (!l.ok) return l;
  return { ok: true, valor: (l.valor ?? []).map(aEntrega) };
}

/** UPDATE condicionado por tenant, id, estado y (si se da) claim_token. `true` si cambió una fila. */
async function transicionarEntrega(
  tenantId: string, id: string, desde: EstadoEntregaCorreo[], set: Fila, claimToken: string | null, etiqueta: string,
): Promise<boolean> {
  let q = supabaseAdmin().from('liquidacion_entrega_correo').update({ ...set, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('id', id).in('estado', desde);
  if (claimToken) q = q.eq('claim_token', claimToken);
  const res = await acotada(q.select('id'), etiqueta);
  return (exigirEscritura(res as unknown as { data: Fila[] | null; error: ErrorPg }, etiqueta) ?? []).length > 0;
}

const SIN_LEASE = { claim_token: null, claim_expira_en: null };

/** Quien tiene el lease confirma que el proveedor aceptó el mensaje. Solo desde `enviando` y con SU token. */
export const marcarEnviada = (tenantId: string, id: string, claimToken: string, resendId: string, ahora: Date): Promise<boolean> =>
  transicionarEntrega(tenantId, id, ['enviando'], { estado: 'enviada', resend_id: resendId, enviada_en: ahora.toISOString(), ultimo_error: null, ...SIN_LEASE }, claimToken, 'liqcorreo.marcar_enviada');

export const marcarEntregada = (tenantId: string, id: string, ahora: Date): Promise<boolean> =>
  transicionarEntrega(tenantId, id, ['enviada'], { estado: 'entregada', entregada_en: ahora.toISOString() }, null, 'liqcorreo.marcar_entregada');

export const marcarRebotada = (tenantId: string, id: string, ahora: Date, motivo?: string): Promise<boolean> =>
  transicionarEntrega(tenantId, id, ['enviada', 'entregada'], { estado: 'rebotada', rebotada_en: ahora.toISOString(), ultimo_error: recortar(motivo) }, null, 'liqcorreo.marcar_rebotada');

export const marcarFallida = (tenantId: string, id: string, claimToken: string | null, error: string): Promise<boolean> =>
  transicionarEntrega(tenantId, id, ['enviando', 'pendiente'], { estado: 'fallida', ultimo_error: recortar(error), ...SIN_LEASE }, claimToken, 'liqcorreo.marcar_fallida');

export const marcarOmitida = (tenantId: string, id: string, motivo: string): Promise<boolean> =>
  transicionarEntrega(tenantId, id, ['pendiente', 'enviando'], { estado: 'omitida', ultimo_error: recortar(motivo), ...SIN_LEASE }, null, 'liqcorreo.marcar_omitida');

/** Devuelve la entrega a `pendiente` con su siguiente intento (backoff lo decide quien llama). */
export const reprogramarEntrega = (tenantId: string, id: string, claimToken: string, intentos: number, proximoIntentoEn: Date, error: string | null): Promise<boolean> =>
  transicionarEntrega(tenantId, id, ['enviando'], { estado: 'pendiente', intentos, proximo_intento_en: proximoIntentoEn.toISOString(), ultimo_error: recortar(error), ...SIN_LEASE }, claimToken, 'liqcorreo.reprogramar');

// ── Noticia de entrega del proveedor (T-A1-18) ──────────────────────────────

export type EventoEntregaCorreo = 'entregada' | 'rebotada' | 'queja';
export interface ResultadoEntregaCorreo {
  /**
   * `sin_entrega`: ese id de Resend no es de una entrega por correo (el webhook sigue su flujo de siempre).
   * `aplicada`: la entrega cambió de estado. `sin_cambio`: la noticia llegó tarde, repetida o desordenada.
   */
  resultado: 'sin_entrega' | 'aplicada' | 'sin_cambio';
  rol?: RolDestinatario;
  /** El correo del operador quedó marcado como rebotado (y su excepción abierta). */
  operadorMarcado?: boolean;
}

const enmascarar = (c: string): string => {
  const [u = '', d = ''] = c.split('@');
  return `${u.slice(0, 1)}***@${d}`;
};

/**
 * Casa el webhook de Resend con la entrega por correo del desglose por `resend_id` (índice único). Es, junto con
 * `reclamarEntregas`, lo único de este archivo que NO parte de un `tenant_id`: el webhook no sabe de qué flota es el
 * mensaje. Apenas se encuentra la fila, TODO lo siguiente se ancla a su `tenant_id`.
 *
 * Reglas (las mismas del buzón): `entregada` solo escribe sobre `enviada`; `rebotada`/`queja` pisan a `entregada`
 * (la mala noticia es la que opera); una mala noticia sobre otra mala noticia no cambia nada. Si rebota el correo del
 * OPERADOR: se marca `operador.correo_rebotado_en` (solo si ese sigue siendo su correo: si ya lo corrigieron, el rebote
 * es viejo) y se abre la excepción `operador_sin_correo`. Esos efectos son idempotentes y se repiten aunque la entrega
 * ya estuviera rebotada, para que un reintento de Resend tras un fallo a medias los complete. NO suprime ninguna
 * dirección: la lista de supresión es de campañas.
 */
export async function confirmarEntregaCorreo(
  emailId: string, evento: EventoEntregaCorreo, ahora: Date = new Date(),
): Promise<ResultadoEntregaCorreo> {
  const res = await acotada(supabaseAdmin().from('liquidacion_entrega_correo').select(COLS_ENTREGA)
    .eq('resend_id', emailId).maybeSingle(), 'liqcorreo.confirmar_buscar');
  const l = leer(res as unknown as { data: Fila | null; error: ErrorPg }, 'liqcorreo.confirmar_buscar');
  if (!l.ok || !l.valor) return { resultado: 'sin_entrega' };
  const e = aEntrega(l.valor);

  let cambio: boolean;
  if (evento === 'entregada') cambio = await marcarEntregada(e.tenantId, e.id, ahora);
  else if (evento === 'rebotada') cambio = await marcarRebotada(e.tenantId, e.id, ahora, 'rebote (webhook Resend)');
  else {
    cambio = await transicionarEntrega(e.tenantId, e.id, ['enviada', 'entregada'],
      { estado: 'queja', rebotada_en: ahora.toISOString(), ultimo_error: 'queja de spam (webhook Resend)' }, null, 'liqcorreo.marcar_queja');
  }

  const malaNoticia = evento !== 'entregada';
  const yaEraMala = e.estado === 'rebotada' || e.estado === 'queja';
  if (!(malaNoticia && e.rol === 'operador' && (cambio || yaEraMala))) {
    return { resultado: cambio ? 'aplicada' : 'sin_cambio', rol: e.rol };
  }

  const liq = await leerPorId(e.tenantId, e.liquidacionExternaId);
  let operadorMarcado = false;
  if (liq) {
    const up = await acotada(supabaseAdmin().from('operador').update({ correo_rebotado_en: ahora.toISOString() })
      .eq('tenant_id', e.tenantId).eq('id', liq.operadorId).eq('correo', e.correo.trim().toLowerCase()).select('id'), 'liqcorreo.operador_rebote');
    operadorMarcado = (exigirEscritura(up as unknown as { data: Fila[] | null; error: ErrorPg }, 'liqcorreo.operador_rebote') ?? []).length > 0;
    if (operadorMarcado) {
      await abrirExcepcion(e.tenantId, liq.claveExterna, 'operador_sin_correo', {
        motivo: 'correo_rebotado', rol: 'operador', correo: enmascarar(e.correo), evento,
        accion: 'Corrige el correo del operador y reenvía el desglose.',
      }, ahora);
    }
  }
  return { resultado: cambio ? 'aplicada' : 'sin_cambio', rol: e.rol, operadorMarcado };
}

export async function entregasDe(tenantId: string, liquidacionId: string): Promise<Lectura<EntregaCorreo[]>> {
  const res = await acotada(supabaseAdmin().from('liquidacion_entrega_correo').select(COLS_ENTREGA)
    .eq('tenant_id', tenantId).eq('liquidacion_externa_id', liquidacionId)
    .order('generacion').order('rol').order('correo').order('id').limit(200), 'liqcorreo.entregas_de');
  const l = leer(res as unknown as { data: Fila[] | null; error: ErrorPg }, 'liqcorreo.entregas_de');
  if (!l.ok) return l;
  return { ok: true, valor: (l.valor ?? []).map(aEntrega) };
}

// ── Excepciones ─────────────────────────────────────────────────────────────

const COLS_EXCEPCION = 'id, clave_externa, tipo, detalle, primera_vez, ultima_vez, resuelta_en';
const aExcepcion = (r: Fila): Excepcion => ({
  id: Number(r.id), claveExterna: String(r.clave_externa), tipo: r.tipo as TipoExcepcion,
  detalle: (r.detalle as Record<string, unknown>) ?? {}, primeraVez: String(r.primera_vez), ultimaVez: String(r.ultima_vez),
  resueltaEn: (r.resuelta_en as string | null) ?? null,
});

/**
 * Abre la excepción o, si ya hay una abierta de la misma flota+clave+tipo, solo actualiza `ultima_vez` y el detalle
 * (índice único parcial de la 0786). `detalle` es solo ids y motivos: nunca importes ni nombres.
 */
export async function abrirExcepcion(
  tenantId: string, claveExterna: string, tipo: TipoExcepcion, detalle: Record<string, unknown>, ahora: Date,
): Promise<{ id: number; nueva: boolean }> {
  const marca = ahora.toISOString();
  const refrescar = async (): Promise<number | null> => {
    const r = await acotada(supabaseAdmin().from('liquidacion_excepcion').update({ ultima_vez: marca, detalle })
      .eq('tenant_id', tenantId).eq('clave_externa', claveExterna).eq('tipo', tipo).is('resuelta_en', null).select('id'), 'liqcorreo.excepcion_refrescar');
    const filas = exigirEscritura(r as unknown as { data: Fila[] | null; error: ErrorPg }, 'liqcorreo.excepcion_refrescar') ?? [];
    return filas.length > 0 ? Number(filas[0].id) : null;
  };
  const previa = await refrescar();
  if (previa !== null) return { id: previa, nueva: false };

  const ins = await acotada(supabaseAdmin().from('liquidacion_excepcion')
    .insert({ tenant_id: tenantId, clave_externa: claveExterna, tipo, detalle, primera_vez: marca, ultima_vez: marca }).select('id'), 'liqcorreo.excepcion_abrir');
  const ri = ins as unknown as { data: Fila[] | null; error: ErrorPg };
  if (esDuplicado(ri.error)) { // otra corrida la abrió entre la lectura y la inserción
    const id = await refrescar();
    if (id !== null) return { id, nueva: false };
  }
  const filas = exigirEscritura(ri, 'liqcorreo.excepcion_abrir') ?? [];
  return { id: Number(filas[0]?.id), nueva: true };
}

export async function resolverExcepcion(tenantId: string, id: number, ahora: Date): Promise<boolean> {
  const res = await acotada(supabaseAdmin().from('liquidacion_excepcion').update({ resuelta_en: ahora.toISOString() })
    .eq('tenant_id', tenantId).eq('id', id).is('resuelta_en', null).select('id'), 'liqcorreo.excepcion_resolver');
  return (exigirEscritura(res as unknown as { data: Fila[] | null; error: ErrorPg }, 'liqcorreo.excepcion_resolver') ?? []).length > 0;
}

export async function listarExcepciones(
  tenantId: string, opts: { soloAbiertas?: boolean; tipo?: TipoExcepcion; clave?: string; limite?: number } = {},
): Promise<Lectura<Excepcion[]>> {
  let q = supabaseAdmin().from('liquidacion_excepcion').select(COLS_EXCEPCION).eq('tenant_id', tenantId);
  if (opts.soloAbiertas !== false) q = q.is('resuelta_en', null);
  if (opts.tipo) q = q.eq('tipo', opts.tipo);
  if (opts.clave) q = q.eq('clave_externa', opts.clave);
  const res = await acotada(q.order('ultima_vez', { ascending: false }).order('id').limit(Math.min(Math.max(Math.trunc(opts.limite ?? 100), 1), 500)), 'liqcorreo.excepciones_listar');
  const l = leer(res as unknown as { data: Fila[] | null; error: ErrorPg }, 'liqcorreo.excepciones_listar');
  if (!l.ok) return l;
  return { ok: true, valor: (l.valor ?? []).map(aExcepcion) };
}

// ── Cursor del pull ─────────────────────────────────────────────────────────

const COLS_PULL = 'cursor, ultima_corrida, ultimo_exito, ultimo_error, leidas, importadas, excepciones';

function aCursor(v: unknown): CursorDesglose | null {
  if (!v || typeof v !== 'object') return null;
  const { desde, despuesDe } = v as Record<string, unknown>;
  return typeof desde === 'string' && typeof despuesDe === 'string' ? { desde, despuesDe } : null;
}

export async function leerCursorPull(tenantId: string): Promise<Lectura<EstadoPull>> {
  const res = await acotada(supabaseAdmin().from('liquidacion_pull_estado').select(COLS_PULL)
    .eq('tenant_id', tenantId).maybeSingle(), 'liqcorreo.pull_leer');
  const l = leer(res as unknown as { data: Fila | null; error: ErrorPg }, 'liqcorreo.pull_leer');
  if (!l.ok) return l;
  const r = l.valor;
  return {
    ok: true,
    valor: {
      cursor: aCursor(r?.cursor), ultimaCorrida: (r?.ultima_corrida as string | null) ?? null, ultimoExito: (r?.ultimo_exito as string | null) ?? null,
      ultimoError: (r?.ultimo_error as string | null) ?? null, leidas: Number(r?.leidas ?? 0), importadas: Number(r?.importadas ?? 0),
      excepciones: Number(r?.excepciones ?? 0),
    },
  };
}

/** `cursor` solo se pasa cuando la corrida terminó bien: una corrida fallida NO adelanta el cursor (se re-lee). */
export async function guardarCursorPull(
  tenantId: string,
  e: { cursor?: CursorDesglose | null; ahora: Date; exito: boolean; error?: string | null; leidas: number; importadas: number; excepciones: number },
): Promise<void> {
  const fila: Fila = {
    tenant_id: tenantId, ultima_corrida: e.ahora.toISOString(), ultimo_error: e.exito ? null : recortar(e.error ?? 'error sin detalle'),
    leidas: e.leidas, importadas: e.importadas, excepciones: e.excepciones,
  };
  if (e.exito) fila.ultimo_exito = e.ahora.toISOString();
  if (e.exito && e.cursor !== undefined) fila.cursor = e.cursor;
  const res = await acotada(supabaseAdmin().from('liquidacion_pull_estado').upsert(fila, { onConflict: 'tenant_id' }).select('tenant_id'), 'liqcorreo.pull_guardar');
  exigirEscritura(res as unknown as { data: unknown; error: ErrorPg }, 'liqcorreo.pull_guardar');
}

// ── Conteos para insights ───────────────────────────────────────────────────

/** Conteos del periodo [desde, hasta) por `created_at`, completos y demostrados (`traerTodo`). Sin tablas ⇒ `no_disponible`. */
export async function contarParaInsights(tenantId: string, desde: Date, hasta: Date): Promise<Lectura<ConteoInsights>> {
  const d = desde.toISOString();
  const h = hasta.toISOString();
  const ds = await acotada(supabaseAdmin().from('liquidacion_desglose').select('liquidacion_externa_id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId).gte('created_at', d).lt('created_at', h), 'liqcorreo.insights_desgloses');
  const rd = ds as unknown as { count?: number | null; error: ErrorPg; data: unknown };
  if (rd.error) {
    if (tablaAusente(rd.error)) return { ok: false, motivo: 'no_disponible' };
    throw new Error(`liqcorreo.insights_desgloses: ${rd.error.message ?? 'error de base'}`);
  }
  const entregas = await traerTodo<{ estado: EstadoEntregaCorreo }>(
    (a, b) => supabaseAdmin().from('liquidacion_entrega_correo').select('estado', { count: 'exact' })
      .eq('tenant_id', tenantId).gte('created_at', d).lt('created_at', h).order('id').range(a, b) as never,
    'liqcorreo.insights_entregas');
  const ex = await acotada(supabaseAdmin().from('liquidacion_excepcion').select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId).is('resuelta_en', null), 'liqcorreo.insights_excepciones');
  const re = ex as unknown as { count?: number | null; error: ErrorPg };
  if (re.error) throw new Error(`liqcorreo.insights_excepciones: ${re.error.message ?? 'error de base'}`);
  const porEstado: Partial<Record<EstadoEntregaCorreo, number>> = {};
  for (const e of entregas) porEstado[e.estado] = (porEstado[e.estado] ?? 0) + 1;
  return { ok: true, valor: { desgloses: rd.count ?? 0, entregasPorEstado: porEstado, excepcionesAbiertas: re.count ?? 0 } };
}

// ── Storage del .xlsx ───────────────────────────────────────────────────────

/** Ruta del Excel, direccionada por contenido y SIEMPRE bajo la carpeta del tenant (la clave va hasheada). Pura. */
export function rutaXlsxDesglose(tenantId: string, claveExterna: string, huella: string): string {
  return rutaExcelExterno(rutaPdfExterno(tenantId, claveExterna, huella));
}

/** Una ruta ajena (otra flota, `..`, absoluta) NO se firma ni se sube: es el cierre del escape entre flotas. */
function exigirRutaDelTenant(tenantId: string, ruta: string): void {
  if (!ruta.startsWith(`${tenantId}/`) || ruta.split('/').includes('..') || ruta.includes('\\') || !ruta.endsWith('.xlsx')) {
    throw new DatoInvalido('La ruta del Excel no pertenece a esta flota');
  }
}

export async function subirXlsx(tenantId: string, claveExterna: string, huella: string, bytes: Uint8Array): Promise<string> {
  const ruta = rutaXlsxDesglose(tenantId, claveExterna, huella);
  exigirRutaDelTenant(tenantId, ruta);
  await subirArchivoExterno(ruta, bytes, TIPO_XLSX);
  return ruta;
}

export async function firmarXlsx(tenantId: string, ruta: string, ttlSegundos: number, descarga?: string): Promise<string> {
  exigirRutaDelTenant(tenantId, ruta);
  return firmarPdfExterno(ruta, ttlSegundos, descarga);
}
