// ═══════════════════════════════════════════════════════════════════════════
// EL REPOSITORIO DE REGLAS (0229) — el único escritor de `regla_vigilancia`.
//
// Dos clases de función conviven aquí a propósito, con contratos distintos:
//
//  · Las que atiende una PERSONA (crear, confirmar, pausar, borrar, listar)
//    devuelven el error POR VALOR. Una server action tiene que poder pintar
//    "esa regla ya la tienes declarada" sin atrapar excepciones.
//  · Las que atiende el CRON (`reglasActivas`, `sellarDisparo`) LANZAN. Un
//    barrido que no pudo leer sus reglas no puede reportar "ninguna regla
//    disparó": eso se lee igual que una flota tranquila.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { anotarBitacora } from '../bitacora_escritura';
import { logger } from '@/lib/logger';
import {
  CATALOGO, esPlantilla, validarParams,
  type PlantillaId, type ParamsCualquiera, type CanalAviso,
} from './catalogo';
import type { Disparo } from './lectores';
import { LIMITE_POR_OMISION, validarLimite, type LimiteFrecuencia } from './frecuencia';

export type EstadoRegla = 'pendiente' | 'activa' | 'pausada';

export interface ReglaGuardada {
  id: string;
  tenantId: string;
  plantilla: PlantillaId;
  params: ParamsCualquiera;
  textoOriginal: string;
  frase: string;
  estado: EstadoRegla;
  creadaEn: string;
  confirmadaEn: string | null;
  ultimaCorridaEn: string | null;
  ultimoDisparoEn: string | null;
  modelo: string | null;
  /** Tope de avisos en 24 h y separación mínima (0520). */
  maxAvisosDia: number;
  minHorasEntreAvisos: number;
}

/** Un aviso que la regla intentó mandar (0520), para el historial. */
export interface AvisoDeRegla {
  enviadoEn: string;
  resultado: 'enviado' | 'fallido';
  casos: number;
  via: 'texto' | 'botones' | 'plantilla' | null;
  motivo: string | null;
  error: string | null;
}

/** Lo que la pantalla necesita para pintar una regla. */
export interface ReglaEnPantalla extends ReglaGuardada {
  titulo: string;
  canal: CanalAviso;
  /** Los últimos disparos, para que "última vez que sonó" tenga un porqué. */
  ultimasEvidencias: Array<{ evidencia: string; disparadoEn: string }>;
  /** El historial de avisos (más nuevo primero), enviados y fallidos. */
  ultimosAvisos: AvisoDeRegla[];
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; error: string };

/** Cuántas reglas puede tener una flota a la vez.
 *
 *  No es una restricción comercial: cada regla activa es una consulta por
 *  corrida horaria y un WhatsApp potencial. Treinta cubre de sobra lo que un
 *  dueño de flota va a querer vigilar, y pone un techo al costo de una
 *  pantalla que invita a escribir. */
export const TOPE_REGLAS_POR_FLOTA = 30;

interface FilaRegla {
  id: string; tenant_id: string; plantilla: string; params: unknown;
  texto_original: string; frase: string; estado: string; creada_en: string;
  confirmada_en: string | null; ultima_corrida_en: string | null;
  ultimo_disparo_en: string | null; modelo: string | null;
  /** Ausentes en filas anteriores a la 0520 (y en dobles de prueba viejos). */
  max_avisos_dia?: number | null; min_horas_entre_avisos?: number | null;
}

/**
 * De fila a objeto, VALIDANDO los parámetros contra el catálogo de hoy.
 *
 * `null` = la fila no se puede correr: una plantilla que ya no existe o unos
 * parámetros que dejaron de ser válidos porque el catálogo cambió de dominio.
 * Se descarta con log en vez de correrse a medias — una regla que el lector
 * no entiende no puede mandar un WhatsApp.
 */
export function desdeFila(f: FilaRegla): ReglaGuardada | null {
  if (!esPlantilla(f.plantilla)) {
    logger.warn('reglas.plantilla_desconocida', { regla: f.id, plantilla: f.plantilla });
    return null;
  }
  const v = validarParams(f.plantilla, f.params);
  if (!v.ok) {
    logger.warn('reglas.params_invalidos', { regla: f.id, plantilla: f.plantilla, motivo: v.error });
    return null;
  }
  return {
    id: f.id,
    tenantId: f.tenant_id,
    plantilla: f.plantilla,
    params: v.params,
    textoOriginal: f.texto_original,
    frase: f.frase,
    estado: f.estado as EstadoRegla,
    creadaEn: f.creada_en,
    confirmadaEn: f.confirmada_en,
    ultimaCorridaEn: f.ultima_corrida_en,
    ultimoDisparoEn: f.ultimo_disparo_en,
    modelo: f.modelo,
    maxAvisosDia: f.max_avisos_dia ?? LIMITE_POR_OMISION.maxAvisosDia,
    minHorasEntreAvisos: f.min_horas_entre_avisos ?? LIMITE_POR_OMISION.minHorasEntreAvisos,
  };
}

const COLUMNAS = 'id, tenant_id, plantilla, params, texto_original, frase, estado, creada_en, confirmada_en, ultima_corrida_en, ultimo_disparo_en, modelo, max_avisos_dia, min_horas_entre_avisos';

// ── Lo que atiende una persona ─────────────────────────────────────────────

export interface NuevaRegla {
  plantilla: PlantillaId;
  params: ParamsCualquiera;
  textoOriginal: string;
  frase: string;
  modelo: string | null;
  costoUsd: number;
}

/**
 * Guarda la interpretación como regla PENDIENTE. No vigila nada todavía: la
 * base no la deja salir de 'pendiente' sin firma (`regla_activa_confirmada`).
 */
export async function crearReglaPendiente(
  tenantId: string, nueva: NuevaRegla, userId: string | null,
): Promise<Resultado<ReglaGuardada>> {
  const cuantas = await contarReglas(tenantId);
  if (!cuantas.ok) return cuantas;
  if (cuantas.valor >= TOPE_REGLAS_POR_FLOTA) {
    return { ok: false, error: `Ya tienes ${cuantas.valor} reglas declaradas, que es el tope. Borra o pausa alguna antes de agregar otra.` };
  }

  const { data, error } = await acotada(supabaseAdmin()
    .from('regla_vigilancia')
    .insert({
      tenant_id: tenantId,
      plantilla: nueva.plantilla,
      params: nueva.params,
      texto_original: nueva.textoOriginal.trim().slice(0, 400),
      frase: nueva.frase.slice(0, 400),
      estado: 'pendiente',
      creada_por: userId,
      modelo: nueva.modelo,
      costo_usd: nueva.costoUsd > 0 ? nueva.costoUsd : null,
    })
    .select(COLUMNAS)
    .single(), 'reglas.crear');

  if (error) {
    // El índice parcial `regla_vigilancia_unica`: la misma vigilancia con los
    // mismos parámetros ya está viva. Es una respuesta, no un fallo.
    if ((error as { code?: string }).code === '23505') {
      return { ok: false, error: 'Esa misma vigilancia ya está declarada, con esos mismos números.' };
    }
    logger.error('reglas.crear_fallo', { tenant: tenantId, err: error.message });
    return { ok: false, error: 'No se pudo guardar la regla.' };
  }
  const regla = desdeFila(data as unknown as FilaRegla);
  if (!regla) return { ok: false, error: 'La regla se guardó con parámetros que el vigilante no sabe leer. Vuelve a declararla.' };
  return { ok: true, valor: regla };
}

/**
 * La CONFIRMACIÓN HUMANA. Es lo único que enciende una regla, y va anclada
 * por `id + estado='pendiente'`: dos clics del mismo botón no la confirman dos
 * veces ni le cambian la firma.
 */
export async function confirmarRegla(
  tenantId: string, reglaId: string, actor: { id: string; email?: string | null },
): Promise<Resultado<'confirmada'>> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('regla_vigilancia')
    .update({ estado: 'activa', confirmada_por: actor.id, confirmada_en: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', reglaId)
    .eq('estado', 'pendiente')
    .select('id, frase'), 'reglas.confirmar');
  if (error) {
    logger.error('reglas.confirmar_fallo', { tenant: tenantId, regla: reglaId, err: error.message });
    return { ok: false, error: 'No se pudo confirmar la regla.' };
  }
  if (!data || (data as unknown[]).length === 0) {
    return { ok: false, error: 'Esa regla ya no está esperando confirmación.' };
  }
  await anotarBitacora({
    tenantId, actor, accion: 'regla.confirmada', entidad: 'regla_vigilancia', entidadId: reglaId,
    detalle: { frase: (data as Array<{ frase: string }>)[0].frase },
  }, { evento: 'reglas.bitacora_no_escribio' });
  return { ok: true, valor: 'confirmada' };
}

/** Pausar o reanudar. Una pausada conserva su firma —por eso puede volver a
 *  'activa' sin re-confirmarse— y deja de barrerse en la corrida. */
export async function alternarPausa(
  tenantId: string, reglaId: string, pausar: boolean, actor: { id: string; email?: string | null },
): Promise<Resultado<EstadoRegla>> {
  const destino: EstadoRegla = pausar ? 'pausada' : 'activa';
  const origen: EstadoRegla = pausar ? 'activa' : 'pausada';
  const { data, error } = await acotada(supabaseAdmin()
    .from('regla_vigilancia')
    .update({ estado: destino })
    .eq('tenant_id', tenantId)
    .eq('id', reglaId)
    .eq('estado', origen)
    .select('id'), 'reglas.pausa');
  if (error) {
    logger.error('reglas.pausa_fallo', { tenant: tenantId, regla: reglaId, err: error.message });
    return { ok: false, error: 'No se pudo cambiar el estado de la regla.' };
  }
  if (!data || (data as unknown[]).length === 0) {
    return { ok: false, error: pausar ? 'Esa regla no estaba activa.' : 'Esa regla no estaba pausada.' };
  }
  await anotarBitacora({
    tenantId, actor, accion: pausar ? 'regla.pausada' : 'regla.reanudada',
    entidad: 'regla_vigilancia', entidadId: reglaId,
  }, { evento: 'reglas.bitacora_no_escribio' });
  return { ok: true, valor: destino };
}

/** Borrar. Los sellos se van con ella (FK compuesta con cascade): la regla ya
 *  no existe, así que la memoria de qué le avisó tampoco tiene a quién
 *  pertenecer. */
export async function borrarRegla(
  tenantId: string, reglaId: string, actor: { id: string; email?: string | null },
): Promise<Resultado<'borrada'>> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('regla_vigilancia')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('id', reglaId)
    .select('id'), 'reglas.borrar');
  if (error) {
    logger.error('reglas.borrar_fallo', { tenant: tenantId, regla: reglaId, err: error.message });
    return { ok: false, error: 'No se pudo borrar la regla.' };
  }
  if (!data || (data as unknown[]).length === 0) {
    return { ok: false, error: 'Esa regla ya no existe.' };
  }
  await anotarBitacora({
    tenantId, actor, accion: 'regla.borrada', entidad: 'regla_vigilancia', entidadId: reglaId,
  }, { evento: 'reglas.bitacora_no_escribio' });
  return { ok: true, valor: 'borrada' };
}

async function contarReglas(tenantId: string): Promise<Resultado<number>> {
  const { count, error } = await supabaseAdmin()
    .from('regla_vigilancia')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);
  if (error || typeof count !== 'number') {
    // Fail-closed: sin poder contar no se agrega. Es preferible un "intenta
    // de nuevo" a rebasar el tope sin enterarse.
    logger.warn('reglas.conteo_ilegible', { tenant: tenantId, err: error?.message });
    return { ok: false, error: 'No se pudo leer cuántas reglas tienes; intenta de nuevo.' };
  }
  return { ok: true, valor: count };
}

/** Cuántos renglones de historial (avisos y evidencias) se enseñan por regla. */
export const HISTORIAL_POR_REGLA = 10;

interface FilaAviso {
  regla_id: string; enviado_en: string; resultado: string; casos: number;
  via: string | null; motivo: string | null; error: string | null;
}

function aAviso(a: FilaAviso): AvisoDeRegla {
  return {
    enviadoEn: a.enviado_en,
    resultado: a.resultado === 'enviado' ? 'enviado' : 'fallido',
    casos: Number(a.casos),
    via: a.via === 'texto' || a.via === 'botones' || a.via === 'plantilla' ? a.via : null,
    motivo: a.motivo ?? null,
    error: a.error ?? null,
  };
}

/** Las reglas de una flota, con sus últimas evidencias, para la pantalla. */
export async function listarReglas(tenantId: string): Promise<ReglaEnPantalla[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('regla_vigilancia')
    .select(COLUMNAS)
    .eq('tenant_id', tenantId)
    .order('creada_en', { ascending: false })
    .limit(TOPE_REGLAS_POR_FLOTA * 2), 'reglas.listar');
  if (error) throw new Error(`listarReglas: ${error.message}`);

  const reglas = ((data ?? []) as unknown as FilaRegla[])
    .map(desdeFila)
    .filter((r): r is ReglaGuardada => r !== null);
  if (reglas.length === 0) return [];

  const ids = reglas.map((r) => r.id);
  // R10-7: solo lo que de verdad SONÓ (`estado = 'enviado'`). Una llave `enviando` es un reclamo en vuelo o huérfano (la corrida murió o
  // Meta rechazó): sin este filtro aparecía en «lo último que sonó» un caso que nunca se avisó. Sin la 0660 no hay columna `estado`
  // (todo lo anterior ya se mandó): se reintenta sin el filtro.
  const leerSellos = (soloEnviados: boolean) => {
    let q = supabaseAdmin().from('regla_disparo').select('regla_id, evidencia, disparado_en').eq('tenant_id', tenantId).in('regla_id', ids);
    if (soloEnviados) q = q.eq('estado', 'enviado');
    return acotada(q.order('disparado_en', { ascending: false }).order('objeto_id', { ascending: false }).limit(400), 'reglas.sellos_recientes');
  };
  let lectura = await leerSellos(true);
  if (lectura.error && esColumnaFaltante(lectura.error)) lectura = await leerSellos(false);
  const { data: sellos, error: errSellos } = lectura;
  if (errSellos) throw new Error(`listarReglas.sellos: ${errSellos.message}`);

  const { data: avisos, error: errAvisos } = await acotada(supabaseAdmin()
    .from('regla_aviso')
    .select('regla_id, enviado_en, resultado, casos, via, motivo, error')
    .eq('tenant_id', tenantId)
    .in('regla_id', ids)
    .order('enviado_en', { ascending: false })
    .order('id', { ascending: false })
    .limit(400), 'reglas.avisos_recientes');
  if (errAvisos) throw new Error(`listarReglas.avisos: ${errAvisos.message}`);

  const porRegla = new Map<string, Array<{ evidencia: string; disparadoEn: string }>>();
  for (const s of (sellos ?? []) as Array<{ regla_id: string; evidencia: string; disparado_en: string }>) {
    const lista = porRegla.get(s.regla_id) ?? [];
    if (lista.length < HISTORIAL_POR_REGLA) lista.push({ evidencia: s.evidencia, disparadoEn: s.disparado_en });
    porRegla.set(s.regla_id, lista);
  }
  const avisosPorRegla = new Map<string, AvisoDeRegla[]>();
  for (const a of (avisos ?? []) as FilaAviso[]) {
    const lista = avisosPorRegla.get(a.regla_id) ?? [];
    if (lista.length < HISTORIAL_POR_REGLA) lista.push(aAviso(a));
    avisosPorRegla.set(a.regla_id, lista);
  }

  return reglas.map((r) => ({
    ...r,
    titulo: CATALOGO[r.plantilla].titulo,
    canal: CATALOGO[r.plantilla].canal,
    ultimasEvidencias: porRegla.get(r.id) ?? [],
    ultimosAvisos: avisosPorRegla.get(r.id) ?? [],
  }));
}

// ── Lo que atiende el cron ─────────────────────────────────────────────────

/**
 * TODAS las reglas activas, de todas las flotas. LANZA si no se pueden leer:
 * un barrido ciego no es un barrido tranquilo.
 */
export async function reglasActivas(tope = 500): Promise<ReglaGuardada[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('regla_vigilancia')
    .select(COLUMNAS)
    .eq('estado', 'activa')
    .order('tenant_id')
    .order('creada_en')
    .limit(tope), 'reglas.activas');
  if (error) throw new Error(`reglasActivas: ${error.message}`);
  return ((data ?? []) as unknown as FilaRegla[])
    .map(desdeFila)
    .filter((r): r is ReglaGuardada => r !== null);
}

/** Los sellos que YA existen para esta regla, entre los disparos candidatos.
 *  Una consulta por regla, no una por candidato.
 *
 *  Una llave `enviando` (0660) cuenta como sellada MIENTRAS su arriendo siga vigente: otra corrida la lleva. Con el arriendo
 *  vencido la corrida que la tomó murió a media y la llave vuelve a ser «nueva» para que el reclamo la retome. Sin la 0660
 *  (columnas ausentes) todas las filas son sellos, como antes. */
export async function sellosDe(
  tenantId: string, reglaId: string, candidatos: Disparo[], ahora: Date = new Date(),
): Promise<Set<string>> {
  if (candidatos.length === 0) return new Set();
  const consulta = (columnas: string) => acotada(supabaseAdmin()
    .from('regla_disparo')
    .select(columnas)
    .eq('tenant_id', tenantId)
    .eq('regla_id', reglaId)
    .in('objeto_id', [...new Set(candidatos.map((c) => c.objetoId))])
    .limit(1_000), 'reglas.sellos');
  let res = await consulta('objeto, objeto_id, clave, estado, reclamo_expira_en');
  if (res.error && esColumnaFaltante(res.error)) res = await consulta('objeto, objeto_id, clave');
  if (res.error) throw new Error(`sellosDe: ${res.error.message}`);
  const filas = (res.data ?? []) as unknown as Array<{
    objeto: string; objeto_id: string; clave: string; estado?: string; reclamo_expira_en?: string | null;
  }>;
  return new Set(filas
    .filter((s) => s.estado !== 'enviando' || (s.reclamo_expira_en != null && new Date(s.reclamo_expira_en).getTime() > ahora.getTime()))
    .map((s) => `${s.objeto}|${s.objeto_id}|${s.clave}`));
}

export function llaveSello(d: Disparo): string {
  return `${d.objeto}|${d.objetoId}|${d.clave}`;
}

/**
 * Sella los disparos que YA se avisaron. Se llama DESPUÉS de mandar, nunca
 * antes: un aviso que no salió se reintenta a la siguiente corrida (el mismo
 * criterio que `avisarVencimientos`). `ignoreDuplicates` hace inofensiva la
 * carrera de dos crons solapados.
 */
export async function sellarDisparos(
  tenantId: string, reglaId: string, disparos: Disparo[],
): Promise<void> {
  if (disparos.length === 0) return;
  const { error } = await acotada(supabaseAdmin()
    .from('regla_disparo')
    .upsert(disparos.map((d) => ({
      tenant_id: tenantId, regla_id: reglaId,
      objeto: d.objeto, objeto_id: d.objetoId, clave: d.clave,
      evidencia: d.evidencia.slice(0, 1_000),
    })), { onConflict: 'tenant_id,regla_id,objeto,objeto_id,clave', ignoreDuplicates: true }),
  'reglas.sellar');
  if (error) throw new Error(`sellarDisparos: ${error.message}`);
}

// ── El reclamo antes de mandar (0660) ──────────────────────────────────────

/** `reclamo` = la base atendió el reclamo; `sin_rpc` = base sin la 0660 (se manda y se sella como antes). */
export type ReclamoDisparos =
  | { modo: 'reclamo'; token: string; ganados: Disparo[] }
  | { modo: 'sin_rpc' };

const PARTES_RPC = /reclamar_disparos_regla|confirmar_disparos_regla|liberar_disparos_regla/;
function esRpcFaltante(e: { code?: string | null; message?: string | null }): boolean {
  const msg = e.message ?? '';
  return PARTES_RPC.test(msg) && (e.code === '42883' || e.code === 'PGRST202' || /could not find the function|does not exist/i.test(msg));
}
function esColumnaFaltante(e: { code?: string | null; message?: string | null }): boolean {
  return e.code === '42703' || /does not exist|could not find/i.test(e.message ?? '');
}

/**
 * RECLAMA los casos nuevos ANTES de mandar el aviso: insertar la llave es reclamarla (patrón de `cobranza_gasto`, 0525). De
 * dos corridas solapadas que ven los mismos casos, cada llave la gana una sola. LANZA si la base falla por otra causa: sin
 * saber quién la lleva no se manda, y la regla se reintenta a la hora siguiente.
 */
export async function reclamarDisparos(
  tenantId: string, reglaId: string, disparos: Disparo[], ahora: Date = new Date(),
): Promise<ReclamoDisparos> {
  if (disparos.length === 0) return { modo: 'reclamo', token: '', ganados: [] };
  const { data, error } = await acotada(supabaseAdmin().rpc('reclamar_disparos_regla', {
    p_tenant: tenantId, p_regla: reglaId, p_ahora: ahora.toISOString(),
    p_items: disparos.map((d) => ({ objeto: d.objeto, objeto_id: d.objetoId, clave: d.clave, evidencia: d.evidencia.slice(0, 1_000) })),
  }), 'reglas.reclamar');
  if (error) {
    if (esRpcFaltante(error)) return { modo: 'sin_rpc' };
    throw new Error(`reclamarDisparos: ${error.message}`);
  }
  const filas = (data ?? []) as Array<{ o_token: string; o_objeto: string; o_objeto_id: string; o_clave: string }>;
  const ganadas = new Set(filas.map((f) => `${f.o_objeto}|${f.o_objeto_id}|${f.o_clave}`));
  return {
    modo: 'reclamo',
    token: filas[0]?.o_token ?? '',
    ganados: disparos.filter((d) => ganadas.has(llaveSello(d))),
  };
}

/**
 * R10-6: ¿hay OTRA corrida mandando AHORA un aviso de esta misma regla? (llaves `enviando` con otro token y arriendo vigente).
 * El tope de frecuencia se revisa antes del reclamo; dos corridas solapadas con casos DISTINTOS pasaban las dos ese filtro (ninguna
 * había registrado aún su aviso) y mandaban dos avisos en la misma hora. Tras ganar el reclamo, quien ve a otra corrida en vuelo
 * suelta lo suyo y difiere (se reintenta a la hora siguiente): del lado seguro, a lo más se pospone, jamás se manda de más.
 * Sin la 0660 (sin reclamo) no hay llaves `enviando`: devuelve `false`.
 */
export async function hayEnvioAjenoEnVuelo(tenantId: string, reglaId: string, token: string, ahora: Date = new Date()): Promise<boolean> {
  // orden-no-importa: solo se pregunta si existe al menos una fila.
  const { data, error } = await acotada(supabaseAdmin().from('regla_disparo').select('objeto_id')
    .eq('tenant_id', tenantId).eq('regla_id', reglaId).eq('estado', 'enviando')
    .neq('reclamo_token', token).gt('reclamo_expira_en', ahora.toISOString()).limit(1), 'reglas.envio_ajeno_en_vuelo');
  if (error) {
    if (esColumnaFaltante(error)) return false;
    throw new Error(`hayEnvioAjenoEnVuelo: ${error.message}`);
  }
  return (data ?? []).length > 0;
}

/** Meta ACEPTÓ el aviso: las llaves que lleva este token pasan a `enviado`. LANZA si falla (el aviso ya salió; el arriendo
 *  vencería y otra corrida lo repetiría: mejor que la regla cuente el fallo y quede en el log). */
export async function confirmarDisparos(tenantId: string, reglaId: string, token: string, ahora: Date = new Date()): Promise<number> {
  const { data, error } = await acotada(supabaseAdmin().rpc('confirmar_disparos_regla', {
    p_tenant: tenantId, p_regla: reglaId, p_token: token, p_ahora: ahora.toISOString(),
  }), 'reglas.confirmar_disparos');
  if (error) throw new Error(`confirmarDisparos: ${error.message}`);
  return Number(data ?? 0);
}

/** El aviso NO salió: se sueltan las llaves de este token para que la corrida siguiente las reintente. Best-effort declarado:
 *  si falla, el arriendo vence solo (5 min) y la llave vuelve a ser reclamable. */
export async function liberarDisparos(tenantId: string, reglaId: string, token: string): Promise<void> {
  if (!token) return;
  const { error } = await acotada(supabaseAdmin().rpc('liberar_disparos_regla', {
    p_tenant: tenantId, p_regla: reglaId, p_token: token,
  }), 'reglas.liberar_disparos');
  if (error) logger.error('reglas.claim_no_liberado', { regla: reglaId, tenant: tenantId, err: error.message });
}

/** La bitácora de operación de la regla. Best-effort declarado: si no se pudo
 *  anotar, el aviso YA salió y sellado está — perder el contador es menos
 *  grave que fingir que la corrida falló. */
export async function anotarCorrida(
  tenantId: string, reglaId: string, ahora: Date, nuevosDisparos: number,
): Promise<void> {
  const parche: Record<string, unknown> = { ultima_corrida_en: ahora.toISOString() };
  if (nuevosDisparos > 0) parche.ultimo_disparo_en = ahora.toISOString();
  const { error } = await acotada(supabaseAdmin()
    .from('regla_vigilancia')
    .update(parche)
    .eq('tenant_id', tenantId)
    .eq('id', reglaId), 'reglas.anotar_corrida');
  if (error) logger.warn('reglas.corrida_no_anotada', { regla: reglaId, err: error.message });
}

// ── Frecuencia e historial (0520) ──────────────────────────────────────────

/**
 * Cambia el límite de frecuencia de UNA regla. Va anclado por tenant + id: el
 * `tenantId` sale de la sesión, nunca del formulario, y una regla de otra flota
 * simplemente no se encuentra.
 */
export async function actualizarFrecuencia(
  tenantId: string, reglaId: string,
  cruda: { maxAvisosDia: unknown; minHorasEntreAvisos: unknown },
  actor: { id: string; email?: string | null },
): Promise<Resultado<LimiteFrecuencia>> {
  const v = validarLimite(cruda);
  if (!v.ok) return { ok: false, error: v.error };
  const { data, error } = await acotada(supabaseAdmin()
    .from('regla_vigilancia')
    .update({ max_avisos_dia: v.limite.maxAvisosDia, min_horas_entre_avisos: v.limite.minHorasEntreAvisos })
    .eq('tenant_id', tenantId)
    .eq('id', reglaId)
    .select('id'), 'reglas.frecuencia');
  if (error) {
    logger.error('reglas.frecuencia_fallo', { tenant: tenantId, regla: reglaId, err: error.message });
    return { ok: false, error: 'No se pudo guardar el límite de frecuencia.' };
  }
  if (!data || (data as unknown[]).length === 0) return { ok: false, error: 'Esa regla ya no existe.' };
  await anotarBitacora({
    tenantId, actor, accion: 'regla.frecuencia', entidad: 'regla_vigilancia', entidadId: reglaId,
    detalle: { ...v.limite },
  }, { evento: 'reglas.bitacora_no_escribio' });
  return { ok: true, valor: v.limite };
}

/** Los instantes de los avisos que SÍ salieron en la ventana (para el tope).
 *  LANZA si no se puede leer: sin historial no se sabe si ya se mandó, y mandar
 *  a ciegas rompería justo el límite que esta lectura protege. */
export async function avisosEnviadosDesde(tenantId: string, reglaId: string, desde: Date): Promise<Date[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('regla_aviso')
    .select('enviado_en')
    .eq('tenant_id', tenantId)
    .eq('regla_id', reglaId)
    .eq('resultado', 'enviado')
    .gte('enviado_en', desde.toISOString())
    .order('enviado_en', { ascending: false })
    .order('id', { ascending: false })
    .limit(100), 'reglas.avisos_desde');
  if (error) throw new Error(`avisosEnviadosDesde: ${error.message}`);
  return ((data ?? []) as Array<{ enviado_en: string }>).map((a) => new Date(a.enviado_en));
}

export interface NuevoAviso {
  resultado: 'enviado' | 'fallido';
  casos: number;
  via?: 'texto' | 'botones' | 'plantilla' | null;
  motivo?: string | null;
  error?: string | null;
  enviadoEn?: Date;
}

/** Anota un intento de aviso. Best-effort declarado: el mensaje YA salió (o ya
 *  falló); perder la fila deja un hueco en el historial, no un aviso perdido. */
export async function registrarAviso(tenantId: string, reglaId: string, a: NuevoAviso): Promise<void> {
  const { error } = await acotada(supabaseAdmin()
    .from('regla_aviso')
    .insert({
      tenant_id: tenantId, regla_id: reglaId, resultado: a.resultado, casos: Math.max(1, a.casos),
      via: a.resultado === 'enviado' ? (a.via ?? 'texto') : null,
      motivo: a.motivo ? a.motivo.slice(0, 300) : null,
      error: a.error ? a.error.slice(0, 300) : null,
      ...(a.enviadoEn ? { enviado_en: a.enviadoEn.toISOString() } : {}),
    }), 'reglas.registrar_aviso');
  if (error) logger.warn('reglas.aviso_no_registrado', { regla: reglaId, err: error.message });
}

/** Retención: el historial de avisos de más de 365 días se borra en el mismo
 *  barrido que lo escribe. Best-effort: no tumba la corrida. */
export const DIAS_RETENCION_AVISOS = 365;
export async function purgarAvisosViejos(ahora: Date): Promise<number> {
  const corte = new Date(ahora.getTime() - DIAS_RETENCION_AVISOS * 86_400_000).toISOString();
  const { data, error } = await acotada(supabaseAdmin()
    .from('regla_aviso')
    .delete()
    .lt('enviado_en', corte)
    .select('id'), 'reglas.purgar_avisos');
  if (error) {
    logger.warn('reglas.purga_avisos_fallo', { err: error.message });
    return 0;
  }
  return ((data ?? []) as unknown[]).length;
}
