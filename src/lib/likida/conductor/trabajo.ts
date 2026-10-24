import { logger } from '@/lib/logger';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { exigir, traerTodo } from '../pg';
import { COLUMNAS_HITO, COLUMNAS_VIAJE_CTX, filaAHito, filaAViajeCtx, type ViajeContexto } from './repo';
import type { AvisoReclamado } from './planificador';
import type { HitoFila } from './tipos';
import { debeReintentarseValidacion } from './validacion';
import { COLUMNAS_POLIGONO, conPoligonoOCirculo, geometriaDeFila } from './geometria_datos';
import type { MuestraGps, SitioGps, SitiosViaje, UnidadDeViaje } from './ciclo_gps';
import { normalizarNombre, type CandidatoSitio, type LadoViaje, type SitioCatalogo, type SitioEquivalencia } from './sitio_derivado';
import { faltaEsquema, filaAEpisodio } from './repo';
import type { EstadoEpisodios } from './senal_vida';
import { agruparEmergencias, filtrarViajesAvisables, HORAS_EMERGENCIA_VIGENTE, TIPOS_EMERGENCIA, type EmergenciasPorFlota, type FilaEmergencia } from './seguridad_chofer';

// ═══════════════════════════════════════════════════════════════════════════
// LA LISTA DE TRABAJO DEL CRON `conductor-hitos` — las lecturas que CRUZAN flotas.
//
// El cron barre los viajes abiertos de TODAS las flotas en una corrida, así que estas
// consultas no llevan `.eq('tenant_id', …)` A PROPÓSITO (como `liquidacion_externa/
// trabajo.ts` y `wa-outbox`). Viven en su PROPIO archivo para que la exención de
// `consultas_admin_filtran_tenant.test.ts` no cubra a `repo.ts`, que atiende a una
// flota por llamada y sigue vigilado entero.
//
// Cada fila que devuelven trae su `tenant_id`, y TODO lo que el motor hace después con
// ella (planificar con la config DE ESA flota, reclamar el aviso, mandar, marcar) se ancla
// a ESE tenant. `tenantDelViaje` resuelve la flota de un payload de botón (`jefe_atiendo:
// <viaje>`) y la respuesta se vuelve a comprobar con `puedeAcusar(tenant, teléfono)`.
// ═══════════════════════════════════════════════════════════════════════════

type Fila = Record<string, unknown>;

/** El tenant de un viaje por su id (el payload del «Ya lo atiendo» no trae flota). `null` = no existe. */
export async function tenantDelViaje(viajeId: string): Promise<string | null> {
  const res = await acotada(supabaseAdmin().from('viaje').select('tenant_id').eq('id', viajeId).maybeSingle(), 'conductor.acuse_viaje');
  const f = exigir(res as never, 'conductor.acuse_viaje') as { tenant_id: string } | null;
  return f ? f.tenant_id : null;
}

const trozos = <T,>(xs: T[], n: number): T[][] => {
  const r: T[][] = [];
  for (let i = 0; i < xs.length; i += n) r.push(xs.slice(i, i + n));
  return r;
};

export async function sembrarHitos(limite: number): Promise<number> {
  // A37-S62-01 (0863): la siembra que también atiende a las flotas con perfil habilitadas. Sin la 0863 en la base cae a la de la 0801 (que las excluye).
  const nueva = await acotada(supabaseAdmin().rpc('sembrar_hitos_conductor_con_compuerta', { p_limite: limite }), 'conductor.sembrar');
  if (!nueva.error) return Number(nueva.data ?? 0);
  const ausente = nueva.error.code === '42883' || nueva.error.code === 'PGRST202' || /could not find the function|does not exist/i.test(nueva.error.message ?? '');
  if (!ausente) throw new Error(`conductor.sembrar: ${nueva.error.message}`);
  const { data, error } = await acotada(supabaseAdmin().rpc('sembrar_hitos_conductor', { p_limite: limite }), 'conductor.sembrar');
  if (error) throw new Error(`conductor.sembrar: ${error.message}`);
  return Number(data ?? 0);
}

/** Desde cuándo un viaje que sigue «abierto» deja de ser trabajo del agente (días desde que se aceptó). Un viaje de 30 días que
 *  nadie liquidó es un viaje olvidado, no uno en curso: ocuparía un lugar del tope para siempre (0661). */
export const DIAS_VIAJE_ABIERTO_VENCIDO = 30;
const VENTANA_ROTACION_MS = 5 * 60_000;

/** La base no tiene la RPC (migración 0661 sin aplicar): se lee como antes, sin reparto. */
function esRpcAusente(e: { code?: string | null; message?: string | null }): boolean {
  const msg = e.message ?? '';
  return /viajes_activos_repartidos|cerrar_hitos_viajes_vencidos/.test(msg)
    && (e.code === '42883' || e.code === 'PGRST202' || /could not find the function|does not exist/i.test(msg));
}

async function leerViajesActivosPlano(limite: number): Promise<ViajeContexto[]> {
  const res = await acotada(supabaseAdmin()
    .from('viaje').select(COLUMNAS_VIAJE_CTX)
    .eq('estatus', 'abierto').not('aceptado_en', 'is', null)
    .order('aceptado_en', { ascending: true }).order('id').limit(limite), 'conductor.viajes');
  return ((exigir(res as never, 'conductor.viajes') ?? []) as unknown as Fila[]).map(filaAViajeCtx);
}

/**
 * Los viajes abiertos y aceptados de TODAS las flotas, REPARTIDOS (0661): primero el más viejo de cada flota, luego el segundo de
 * cada una, hasta llenar `limite`. Antes eran los `limite` más viejos en bloque y una flota grande se comía la pasada entera,
 * sin aviso. El turno sobrante rota cada 5 minutos para que no sea siempre de la misma flota. Los de más de
 * `DIAS_VIAJE_ABIERTO_VENCIDO` días quedan fuera. Sin la 0661 en la base, lectura anterior.
 */
export async function leerViajesActivos(limite: number): Promise<ViajeContexto[]> {
  const { data, error } = await acotada(supabaseAdmin().rpc('viajes_activos_repartidos', {
    p_limite: limite, p_rotacion: Math.floor(Date.now() / VENTANA_ROTACION_MS), p_max_dias: DIAS_VIAJE_ABIERTO_VENCIDO,
  }), 'conductor.viajes_repartidos');
  if (error) {
    if (esRpcAusente(error)) return leerViajesActivosPlano(limite);
    throw new Error(`conductor.viajes_repartidos: ${error.message}`);
  }
  const ids = ((data ?? []) as Array<{ o_id: string }>).map((f) => f.o_id);
  const porId = new Map<string, ViajeContexto>();
  for (const lote of trozos(ids, 150)) {
    const res = await acotada(supabaseAdmin()
      .from('viaje').select(COLUMNAS_VIAJE_CTX).in('id', lote).eq('estatus', 'abierto'), 'conductor.viajes_lote');
    for (const f of (exigir(res as never, 'conductor.viajes_lote') ?? []) as unknown as Fila[]) {
      const v = filaAViajeCtx(f);
      porId.set(v.id, v);
    }
  }
  // Se conserva el orden del reparto (turnos), no el de la lectura por lotes.
  return ids.flatMap((id) => { const v = porId.get(id); return v ? [v] : []; });
}

/**
 * A37-A5-02: las emergencias SIN RESOLVER de las flotas dadas (tipos de `TIPOS_EMERGENCIA` o prioridad crítica, abiertas en las últimas
 * `HORAS_EMERGENCIA_VIGENTE` h). LANZA si no se puede leer: quien llama se detiene (fail-closed), no asume «no hay emergencias».
 */
export async function leerEmergenciasAbiertas(tenantIds: string[], ahora: Date = new Date()): Promise<EmergenciasPorFlota> {
  if (tenantIds.length === 0) return new Map();
  const desde = new Date(ahora.getTime() - HORAS_EMERGENCIA_VIGENTE * 3_600_000).toISOString();
  const filas: FilaEmergencia[] = [];
  for (const lote of trozos(tenantIds, 100)) {
    const res = await acotada(supabaseAdmin().from('incidencia').select('tenant_id, operador_id, viaje_id, unidad_id')
      .in('tenant_id', lote).neq('estado', 'resuelta').gte('abierta_en', desde)
      .or(`tipo.in.(${TIPOS_EMERGENCIA.join(',')}),prioridad.eq.critica`).order('id').limit(2000), 'conductor.emergencias_abiertas');
    filas.push(...((exigir(res as never, 'conductor.emergencias_abiertas') ?? []) as unknown as FilaEmergencia[]));
  }
  return agruparEmergencias(filas);
}

/**
 * A37-A5-02: ¿el chofer con ESTE teléfono tiene una emergencia abierta? Es la última barrera del puerto de envío (cubre los motores
 * que no pasan por la lista de viajes). Lanza si no se puede leer.
 */
export async function hayEmergenciaDeTelefono(tenantId: string, telefono: string, ahora: Date = new Date()): Promise<boolean> {
  const op = await acotada(supabaseAdmin().from('operador').select('id').eq('tenant_id', tenantId).eq('telefono', telefono).order('id').limit(20), 'conductor.emergencia_operador');
  const ids = ((exigir(op as never, 'conductor.emergencia_operador') ?? []) as Array<{ id: string }>).map((f) => f.id);
  if (ids.length === 0) return false;
  const em = (await leerEmergenciasAbiertas([tenantId], ahora)).get(tenantId);
  return !!em && ids.some((id) => em.operadorIds.has(id));
}

/**
 * Los viajes de `leerViajesActivos` a cuyo chofer SÍ se le puede escribir: sin emergencia abierta (A37-A5-02) y con el operador activo y
 * sin oposición (A37-A5-03). Es la lista de trabajo de todos los motores que le escriben al chofer o escalan «porque no contestó».
 * Lanza si no se pueden leer las emergencias.
 */
export async function leerViajesAvisables(limite: number): Promise<ViajeContexto[]> {
  const viajes = await leerViajesActivos(limite);
  if (viajes.length === 0) return viajes;
  const em = await leerEmergenciasAbiertas([...new Set(viajes.map((v) => v.tenantId))]);
  const r = filtrarViajesAvisables(viajes, em);
  if (r.enEmergencia > 0 || r.operadorNoAvisable > 0) logger.info('conductor.viajes_no_avisables', { enEmergencia: r.enEmergencia, operadorNoAvisable: r.operadorNoAvisable });
  return r.viajes;
}

/**
 * Los hitos que siguen esperando de un viaje abierto con más de `DIAS_VIAJE_ABIERTO_VENCIDO` días se marcan `omitido`
 * (`viaje_abierto_vencido`): la escalera deja de perseguirlos y la oficina los puede capturar a mano. El viaje NO se toca.
 * Sin la 0661 en la base devuelve 0.
 */
export async function cerrarHitosDeViajesVencidos(): Promise<number> {
  const { data, error } = await acotada(supabaseAdmin().rpc('cerrar_hitos_viajes_vencidos', {
    p_max_dias: DIAS_VIAJE_ABIERTO_VENCIDO, p_limite: 500,
  }), 'conductor.cerrar_vencidos');
  if (error) {
    if (esRpcAusente(error)) return 0;
    throw new Error(`conductor.cerrar_vencidos: ${error.message}`);
  }
  return Number(data ?? 0);
}

export async function leerHitosDeViajes(viajeIds: string[]): Promise<HitoFila[]> {
  const salida: HitoFila[] = [];
  for (const ids of trozos(viajeIds, 150)) {
    const filas = await traerTodo<Fila>((desde, hasta) => acotada(supabaseAdmin()
      .from('viaje_hito').select(COLUMNAS_HITO).in('viaje_id', ids).order('id').range(desde, hasta), 'conductor.hitos_lote') as never, 'conductor.hitos_lote');
    salida.push(...filas.map(filaAHito));
  }
  return salida;
}

/**
 * T-A5-22: la «Fecha Salida» (ISO) que el TMS selló en cada viaje (0804), solo de los que la traen. Para el barrido: los ids vienen de
 * viajes ya leídos por tenant. Si la lectura falla (p. ej. la 0804 sin aplicar) devuelve `undefined`: el barrido no registra nada.
 */
export async function leerSalidasTmsDeViajes(viajeIds: string[]): Promise<Map<string, string> | undefined> {
  try {
    const m = new Map<string, string>();
    for (const ids of trozos(viajeIds, 150)) {
      const filas = await traerTodo<Fila>((desde, hasta) => acotada(supabaseAdmin()
        .from('viaje').select('id, tms_salida_en').in('id', ids).not('tms_salida_en', 'is', null).order('id').range(desde, hasta), 'conductor.salidas_tms_lote') as never, 'conductor.salidas_tms_lote');
      for (const f of filas) {
        const iso = typeof f.tms_salida_en === 'string' ? f.tms_salida_en : null;
        if (iso && Number.isFinite(Date.parse(iso))) m.set(String(f.id), iso);
      }
    }
    return m;
  } catch (e) {
    logger.warn('conductor.salidas_tms_lote_no_leidas', { err: e instanceof Error ? e.message : String(e) });
    return undefined;
  }
}

export async function leerAvisosDeHitos(hitoIds: string[]): Promise<Array<AvisoReclamado & { hitoId: string }>> {
  const salida: Array<AvisoReclamado & { hitoId: string }> = [];
  for (const ids of trozos(hitoIds, 150)) {
    const filas = await traerTodo<Fila>((desde, hasta) => acotada(supabaseAdmin()
      .from('viaje_hito_aviso').select('viaje_hito_id, ciclo, clase, nivel, ok').in('viaje_hito_id', ids).order('id').range(desde, hasta), 'conductor.avisos_lote') as never, 'conductor.avisos_lote');
    for (const f of filas) {
      salida.push({ hitoId: String(f.viaje_hito_id), ciclo: Number(f.ciclo), clase: f.clase as AvisoReclamado['clase'], nivel: Number(f.nivel), ok: typeof f.ok === 'boolean' ? f.ok : null });
    }
  }
  return salida;
}

/** Cuántos mensajes proactivos recibió cada chofer desde `desde` (el tope diario). */
export async function contarEnviadosPorChofer(operadorIds: string[], desde: Date): Promise<Record<string, number>> {
  const cuenta: Record<string, number> = {};
  for (const ids of trozos(operadorIds, 150)) {
    const filas = await traerTodo<Fila>((d, h) => acotada(supabaseAdmin()
      .from('viaje_hito_aviso').select('operador_id').in('operador_id', ids).in('clase', ['solicitud', 'recordatorio'])
      .gte('created_at', desde.toISOString()).order('id').range(d, h), 'conductor.tope_dia') as never, 'conductor.tope_dia');
    for (const f of filas) cuenta[String(f.operador_id)] = (cuenta[String(f.operador_id)] ?? 0) + 1;
  }
  return cuenta;
}

/**
 * Las llegadas recientes que aún no se pudieron validar contra la ubicación: sin veredicto del ciclo
 * vigente, o «sin dato» por falta de posición (el GPS reporta con minutos de retraso). Cruza flotas
 * a propósito (el barrido es del cron); cada candidato trae su `tenantId` y todo lo posterior se
 * ancla a él. Solo viajes abiertos.
 */
export async function leerCandidatosValidacion(desde: Date, limite: number): Promise<Array<{ hito: HitoFila; viaje: ViajeContexto; resultadoPrevio: 'sin_coincidencia' | null }>> {
  const res = await acotada(supabaseAdmin()
    .from('viaje_hito').select(COLUMNAS_HITO)
    .in('tipo', ['llegada_carga', 'llegada_descarga']).eq('estado', 'recibido').gte('recibido_en', desde.toISOString())
    .order('recibido_en', { ascending: false }).order('id').limit(limite * 2), 'conductor.candidatos_validacion');
  const hitos = ((exigir(res as never, 'conductor.candidatos_validacion') ?? []) as unknown as Fila[]).map(filaAHito);
  if (hitos.length === 0) return [];

  const vistos = new Map<string, { ciclo: number; resultado: string; motivo: string | null }>();
  for (const ids of trozos(hitos.map((h) => h.id), 150)) {
    const rv = await acotada(supabaseAdmin()
      .from('viaje_hito_validacion').select('viaje_hito_id, ciclo, resultado, motivo').in('viaje_hito_id', ids), 'conductor.candidatos_veredictos');
    for (const f of (exigir(rv as never, 'conductor.candidatos_veredictos') ?? []) as unknown as Fila[]) {
      vistos.set(`${f.viaje_hito_id}|${f.ciclo}`, { ciclo: Number(f.ciclo), resultado: String(f.resultado), motivo: typeof f.motivo === 'string' ? f.motivo : null });
    }
  }
  const pendientes = hitos.filter((h) => {
    const v = vistos.get(`${h.id}|${h.ciclo}`);
    return debeReintentarseValidacion(v);
  }).slice(0, limite);
  if (pendientes.length === 0) return [];

  const viajes = new Map<string, ViajeContexto>();
  for (const ids of trozos([...new Set(pendientes.map((h) => h.viajeId))], 150)) {
    const rv = await acotada(supabaseAdmin().from('viaje').select(COLUMNAS_VIAJE_CTX).in('id', ids).eq('estatus', 'abierto'), 'conductor.candidatos_viajes');
    for (const f of (exigir(rv as never, 'conductor.candidatos_viajes') ?? []) as unknown as Fila[]) viajes.set(String(f.id), filaAViajeCtx(f));
  }
  // El hito y su viaje SON de la misma flota: se comprueba, no se supone.
  return pendientes.flatMap((h) => {
    const v = viajes.get(h.viajeId);
    if (!v || v.tenantId !== h.tenantId) return [];
    const previo = vistos.get(`${h.id}|${h.ciclo}`);
    return [{ hito: h, viaje: v, resultadoPrevio: previo?.resultado === 'sin_coincidencia' ? 'sin_coincidencia' as const : null }];
  });
}

/** El correo de un usuario del panel por su id (llave primaria): firma la bitácora de las acciones de oficina. `null` = no existe. */
export async function emailDeUsuario(userId: string): Promise<string | null> {
  const res = await acotada(supabaseAdmin().from('app_user').select('email').eq('id', userId).maybeSingle(), 'conductor.email_usuario');
  const f = exigir(res as never, 'conductor.email_usuario') as { email?: unknown } | null;
  return f && typeof f.email === 'string' && f.email.length > 0 ? f.email : null;
}

/**
 * Qué viajes traen sitio de carga y de descarga (solo si están asignados, no sus coordenadas): lo que el aviso de «llegada sin
 * confirmar» necesita para distinguir «sin posición que la respalde» de «sin sitio contra el cual compararla». Lanza si la base
 * no contesta o no tiene la columna (0385): sin saberlo no se avisa, porque un «sin sitio» falso es peor que un aviso tardío.
 */
export async function leerSitiosDeViajes(viajeIds: string[]): Promise<Map<string, { origen: boolean; destino: boolean }>> {
  const salida = new Map<string, { origen: boolean; destino: boolean }>();
  for (const ids of trozos(viajeIds, 150)) {
    const filas = await traerTodo<Fila>((desde, hasta) => acotada(supabaseAdmin()
      .from('viaje').select('id, origen_geocerca_id, destino_geocerca_id').in('id', ids).order('id').range(desde, hasta), 'conductor.sitios_viajes') as never, 'conductor.sitios_viajes');
    for (const f of filas) salida.set(String(f.id), { origen: typeof f.origen_geocerca_id === 'string', destino: typeof f.destino_geocerca_id === 'string' });
  }
  return salida;
}

/**
 * Los sitios (con su polígono nativo si lo tienen) que cada viaje espera para cargar y descargar. Cruza flotas a propósito:
 * el barrido del ciclo por geocerca es del cron. El sitio de un viaje es de SU flota (FK compuesta con tenant, 0385) y aun así
 * se acota la lectura del catálogo por las flotas de los viajes. Un sitio archivado no cuenta (es como no tenerlo).
 */
export async function leerSitiosGeometriaDeViajes(viajes: Array<{ id: string; tenantId: string }>): Promise<Map<string, SitiosViaje>> {
  const salida = new Map<string, SitiosViaje>();
  if (viajes.length === 0) return salida;
  const tenants = [...new Set(viajes.map((v) => v.tenantId))];
  const asignados = new Map<string, { origen: string | null; destino: string | null }>();
  for (const ids of trozos(viajes.map((v) => v.id), 150)) {
    const filas = await traerTodo<Fila>((desde, hasta) => acotada(supabaseAdmin()
      .from('viaje').select('id, origen_geocerca_id, destino_geocerca_id').in('tenant_id', tenants).in('id', ids).order('id').range(desde, hasta), 'conductor.ciclo_sitios_viajes') as never, 'conductor.ciclo_sitios_viajes');
    for (const f of filas) asignados.set(String(f.id), { origen: typeof f.origen_geocerca_id === 'string' ? f.origen_geocerca_id : null, destino: typeof f.destino_geocerca_id === 'string' ? f.destino_geocerca_id : null });
  }
  const sitioIds = [...new Set([...asignados.values()].flatMap((a) => [a.origen, a.destino]).filter((x): x is string => x !== null))];
  const sitios = new Map<string, SitioGps>();
  for (const ids of trozos(sitioIds, 150)) {
    const g = await conPoligonoOCirculo((conPoligono) => acotada(supabaseAdmin().from('geocerca')
      .select(conPoligono ? `id, nombre, lat, lng, radio_m, ${COLUMNAS_POLIGONO}` : 'id, nombre, lat, lng, radio_m')
      .in('tenant_id', tenants).in('id', ids).eq('activa', true), 'conductor.ciclo_sitios'));
    for (const f of (exigir(g as never, 'conductor.ciclo_sitios') ?? []) as unknown as Fila[]) {
      sitios.set(String(f.id), { id: String(f.id), nombre: String(f.nombre), lat: Number(f.lat), lng: Number(f.lng), radioM: Number(f.radio_m), ...geometriaDeFila(f) });
    }
  }
  for (const [viajeId, a] of asignados) {
    salida.set(viajeId, { origen: a.origen ? sitios.get(a.origen) ?? null : null, destino: a.destino ? sitios.get(a.destino) ?? null : null });
  }
  return salida;
}

/**
 * Las muestras de GPS de verdad (el pin de WhatsApp NO: lo elige el chofer, no mide dónde está el tractor) de cada unidad desde
 * `desde`, de la más vieja a la más reciente. Llave `<tenant>|<unidad>`. Cruza flotas a propósito (cron); cada lectura se acota
 * por las flotas de las unidades pedidas.
 */
export async function leerMuestrasGps(unidades: UnidadDeViaje[], desde: Date): Promise<Map<string, MuestraGps[]>> {
  const salida = new Map<string, MuestraGps[]>();
  if (unidades.length === 0) return salida;
  const tenants = [...new Set(unidades.map((u) => u.tenantId))];
  const pedidas = new Set(unidades.map((u) => `${u.tenantId}|${u.unidadId}`));
  for (const ids of trozos([...new Set(unidades.map((u) => u.unidadId))], 100)) {
    const traer = (columnas: string) => traerTodo<Fila>((d, h) => acotada(supabaseAdmin().from('posicion').select(columnas)
      .in('tenant_id', tenants).in('unidad_id', ids).neq('proveedor', 'whatsapp').gte('medida_en', desde.toISOString())
      .order('medida_en', { ascending: true }).order('id').range(d, h), 'conductor.ciclo_muestras') as never, 'conductor.ciclo_muestras');
    // La ignición (0500) sirve a la señal de vida y `despacho_ref` (0802) liga la muestra a su viaje; una base sin alguna de las
    // columnas sigue funcionando sin ella (sin `despacho_ref` todo cae a «unidad + ventana», como antes).
    const sinVelocidad = async (): Promise<Fila[]> => {
      try { return await traer('tenant_id, unidad_id, lat, lng, medida_en, ignicion, despacho_ref, proveedor'); } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (!/ignicion|despacho_ref/i.test(m)) throw e;
        try { return await traer('tenant_id, unidad_id, lat, lng, medida_en, ignicion, proveedor'); } catch (e2) {
          if (!/ignicion/i.test(e2 instanceof Error ? e2.message : String(e2))) throw e2;
          return await traer('tenant_id, unidad_id, lat, lng, medida_en, proveedor');
        }
      }
    };
    // A37-A5-10: la velocidad (km/h) de la muestra alimenta la regla «conduciendo» de la compuerta; si la columna no existiera,
    // se cae a la lectura de siempre.
    let filas: Fila[];
    try { filas = await traer('tenant_id, unidad_id, lat, lng, medida_en, ignicion, despacho_ref, proveedor, velocidad'); } catch (eV) {
      if (!/velocidad/i.test(eV instanceof Error ? eV.message : String(eV))) throw eV;
      filas = await sinVelocidad();
    }
    for (const f of filas) {
      const llave = `${String(f.tenant_id)}|${String(f.unidad_id)}`;
      if (!pedidas.has(llave)) continue; // la combinación flota/unidad que no se pidió no es de esta corrida
      salida.set(llave, [...(salida.get(llave) ?? []), {
        lat: Number(f.lat), lng: Number(f.lng), medidaEn: new Date(String(f.medida_en)), ignicion: typeof f.ignicion === 'boolean' ? f.ignicion : null,
        despachoRef: typeof f.despacho_ref === 'string' && f.despacho_ref !== '' ? f.despacho_ref : null,
        proveedor: typeof f.proveedor === 'string' && f.proveedor !== '' ? f.proveedor : null,
        velocidadKmh: typeof f.velocidad === 'number' && Number.isFinite(f.velocidad) ? f.velocidad : null,
      }]);
    }
  }
  return salida;
}

/**
 * T-A5-66: las unidades activas de esas flotas SIN un viaje abierto que el ciclo por geocerca atienda (abierto, aceptado y de menos de
 * `DIAS_VIAJE_ABIERTO_VENCIDO` días): son las que pueden dejar un cruce huérfano. Anclado a las flotas pedidas.
 */
export async function leerUnidadesSinViajeAbierto(tenantIds: string[], limite: number, ahora: Date = new Date()): Promise<UnidadDeViaje[]> {
  if (tenantIds.length === 0) return [];
  const unidades = await traerTodo<Fila>((d, h) => acotada(supabaseAdmin().from('unidad').select('id, tenant_id')
    .in('tenant_id', tenantIds).eq('activo', true).order('id').range(d, h), 'conductor.huerfanos_unidades') as never, 'conductor.huerfanos_unidades');
  const desde = new Date(ahora.getTime() - DIAS_VIAJE_ABIERTO_VENCIDO * 86_400_000).toISOString();
  const ocupadas = new Set<string>();
  const viajes = await traerTodo<Fila>((d, h) => acotada(supabaseAdmin().from('viaje').select('tenant_id, unidad_id')
    .in('tenant_id', tenantIds).eq('estatus', 'abierto').not('aceptado_en', 'is', null).not('unidad_id', 'is', null).gte('aceptado_en', desde)
    .order('id').range(d, h), 'conductor.huerfanos_viajes_abiertos') as never, 'conductor.huerfanos_viajes_abiertos');
  for (const v of viajes) ocupadas.add(`${String(v.tenant_id)}|${String(v.unidad_id)}`);
  return unidades
    .map((u) => ({ tenantId: String(u.tenant_id), unidadId: String(u.id) }))
    .filter((u) => !ocupadas.has(`${u.tenantId}|${u.unidadId}`))
    .slice(0, limite);
}

/**
 * Los viajes abiertos y aceptados a los que les falta el sitio de carga o de descarga, con el texto de su origen y destino, su
 * cliente y qué lados ya se derivaron una vez (0637; una base sin esa tabla se lee como «ninguno»). Cruza flotas a propósito
 * (cron); cada candidato lleva su `tenantId` y todo lo posterior se ancla a él. Los más recientes primero.
 */
export async function leerCandidatosSitioDerivado(limite: number): Promise<CandidatoSitio[]> {
  const res = await acotada(supabaseAdmin().from('viaje')
    .select('id, tenant_id, origen, destino, cliente_id, origen_geocerca_id, destino_geocerca_id')
    .eq('estatus', 'abierto').not('aceptado_en', 'is', null).or('origen_geocerca_id.is.null,destino_geocerca_id.is.null')
    .order('aceptado_en', { ascending: false }).order('id').limit(limite), 'conductor.sitio_derivado_viajes');
  const viajes = (exigir(res as never, 'conductor.sitio_derivado_viajes') ?? []) as unknown as Fila[];
  if (viajes.length === 0) return [];

  const derivados = new Map<string, Set<LadoViaje>>();
  for (const ids of trozos(viajes.map((v) => String(v.id)), 150)) {
    const rd = await acotada(supabaseAdmin().from('viaje_sitio_derivado').select('viaje_id, lado').in('viaje_id', ids), 'conductor.sitio_derivado_previos');
    if (rd.error) {
      if (faltaEsquema(rd.error, /viaje_sitio_derivado/i)) break; // base sin la 0637: no hay derivaciones previas que respetar
      throw new Error(`conductor.sitio_derivado_previos: ${rd.error.message}`);
    }
    for (const f of (rd.data ?? []) as unknown as Fila[]) {
      const k = String(f.viaje_id);
      derivados.set(k, (derivados.get(k) ?? new Set()).add(f.lado === 'destino' ? 'destino' : 'origen'));
    }
  }
  return viajes.map((v): CandidatoSitio => {
    const conSitio = new Set<LadoViaje>();
    if (typeof v.origen_geocerca_id === 'string') conSitio.add('origen');
    if (typeof v.destino_geocerca_id === 'string') conSitio.add('destino');
    return {
      tenantId: String(v.tenant_id), viajeId: String(v.id), origen: typeof v.origen === 'string' ? v.origen : null,
      destino: typeof v.destino === 'string' ? v.destino : null, clienteId: typeof v.cliente_id === 'string' ? v.cliente_id : null,
      conSitio, yaDerivados: derivados.get(String(v.id)) ?? new Set(),
    };
  });
}

/** Los sitios ACTIVOS del catálogo del Conductor de cada flota (el de peajes es de otra pantalla). Acotado a las flotas pedidas. */
export async function leerCatalogoSitios(tenantIds: string[]): Promise<Map<string, SitioCatalogo[]>> {
  const salida = new Map<string, SitioCatalogo[]>();
  if (tenantIds.length === 0) return salida;
  const filas = await traerTodo<Fila>((d, h) => acotada(supabaseAdmin().from('geocerca').select('id, tenant_id, nombre, codigo, cliente_id')
    .in('tenant_id', tenantIds).eq('catalogo', 'conductor').eq('activa', true).order('id').range(d, h), 'conductor.sitio_derivado_catalogo') as never, 'conductor.sitio_derivado_catalogo');
  for (const f of filas) {
    const t = String(f.tenant_id);
    salida.set(t, [...(salida.get(t) ?? []), {
      id: String(f.id), nombre: String(f.nombre), codigo: typeof f.codigo === 'string' ? f.codigo : null, clienteId: typeof f.cliente_id === 'string' ? f.cliente_id : null,
    }]);
  }
  return salida;
}

/**
 * Las equivalencias texto→sitio (0803) de cada flota, junto al catálogo. Una base sin la 0803 se lee como «ninguna»: se deriva
 * solo con el catálogo, como antes. Acotado a las flotas pedidas.
 */
export async function leerEquivalenciasSitio(tenantIds: string[]): Promise<Map<string, SitioEquivalencia[]>> {
  const salida = new Map<string, SitioEquivalencia[]>();
  if (tenantIds.length === 0) return salida;
  let filas: Fila[];
  try {
    filas = await traerTodo<Fila>((d, h) => acotada(supabaseAdmin().from('sitio_equivalencia').select('tenant_id, texto_normalizado, lado, geocerca_id, tipo, cliente_id')
      .in('tenant_id', tenantIds).order('id').range(d, h), 'conductor.sitio_equivalencias') as never, 'conductor.sitio_equivalencias');
  } catch (e) {
    if (faltaEsquema({ message: e instanceof Error ? e.message : String(e) }, /sitio_equivalencia/i)) return salida;
    throw e;
  }
  for (const f of filas) {
    const t = String(f.tenant_id);
    const tipo = f.tipo === 'sin_sitio' || f.tipo === 'ignorar' ? f.tipo : 'sitio';
    const lado = f.lado === 'origen' || f.lado === 'destino' ? f.lado : 'ambos';
    salida.set(t, [...(salida.get(t) ?? []), {
      texto: normalizarNombre(String(f.texto_normalizado)), lado, tipo,
      sitioId: typeof f.geocerca_id === 'string' ? f.geocerca_id : null, clienteId: typeof f.cliente_id === 'string' ? f.cliente_id : null,
    }]);
  }
  return salida;
}

/**
 * Los episodios de «sin señal de vida» de estos viajes: el abierto (si lo hay) y el silencio vigente que dejó la respuesta del chofer.
 * Cruza flotas a propósito (cron). Una base sin la 0636 se lee como «sin episodios» (la perilla de la flota tampoco existe: apagada).
 */
export async function leerEpisodiosSenalVida(viajeIds: string[], ahora: Date): Promise<Map<string, EstadoEpisodios>> {
  const salida = new Map<string, EstadoEpisodios>();
  for (const ids of trozos(viajeIds, 150)) {
    const res = await acotada(supabaseAdmin().from('viaje_senal_vida')
      .select('id, tenant_id, viaje_id, motivo, abierto_en, nivel_enviado, aviso_1_en, aviso_2_en, escalado_en, ultimo_error, cerrado_en, silenciado_hasta')
      .in('viaje_id', ids).or(`cerrado_en.is.null,silenciado_hasta.gt.${ahora.toISOString()}`).order('abierto_en', { ascending: false }).order('id').limit(ids.length * 3), 'conductor.senal_episodios');
    if (res.error) {
      if (faltaEsquema(res.error, /viaje_senal_vida/i)) return salida;
      throw new Error(`conductor.senal_episodios: ${res.error.message}`);
    }
    for (const f of (res.data ?? []) as unknown as Fila[]) {
      const k = String(f.viaje_id);
      const previo = salida.get(k) ?? { abierto: null, silenciadoHasta: null };
      if (f.cerrado_en === null || f.cerrado_en === undefined) previo.abierto = filaAEpisodio(f);
      else if (typeof f.silenciado_hasta === 'string') {
        const t = new Date(f.silenciado_hasta);
        if (!previo.silenciadoHasta || t.getTime() > previo.silenciadoHasta.getTime()) previo.silenciadoHasta = t;
      }
      salida.set(k, previo);
    }
  }
  return salida;
}

/** La última muestra de GPS de verdad de cada unidad desde `desde` (posición e ignición; una consulta por unidad; son pocas: solo las que no tienen muestras recientes). */
export async function leerUltimaMuestraGps(unidades: UnidadDeViaje[], desde: Date): Promise<Map<string, MuestraGps>> {
  const salida = new Map<string, MuestraGps>();
  for (const u of unidades.slice(0, 200)) {
    const consulta = (columnas: string) => acotada(supabaseAdmin().from('posicion').select(columnas)
      .eq('tenant_id', u.tenantId).eq('unidad_id', u.unidadId).neq('proveedor', 'whatsapp').gte('medida_en', desde.toISOString())
      .order('medida_en', { ascending: false }).order('id').limit(1), 'conductor.senal_ultima_muestra');
    let res = await consulta('lat, lng, medida_en, ignicion, proveedor');
    if (res.error && faltaEsquema(res.error, /ignicion/i)) res = await consulta('lat, lng, medida_en, proveedor'); // base sin la 0500
    const f = ((exigir(res as never, 'conductor.senal_ultima_muestra') ?? []) as unknown as Fila[])[0];
    if (f && typeof f.medida_en === 'string') {
      salida.set(`${u.tenantId}|${u.unidadId}`, { lat: Number(f.lat), lng: Number(f.lng), medidaEn: new Date(f.medida_en), ignicion: typeof f.ignicion === 'boolean' ? f.ignicion : null, proveedor: typeof f.proveedor === 'string' && f.proveedor !== '' ? f.proveedor : null });
    }
  }
  return salida;
}

/**
 * Los sitios activos del catálogo del Conductor de cada flota CON su geometría: patios, plantas de otros clientes, cualquier lugar
 * donde un tractor espera con razón. La señal de vida los usa para no preguntarle «¿sigues bien?» a un chofer que descansa en el patio.
 */
export async function leerSitiosGeometriaDeFlotas(tenantIds: string[]): Promise<Map<string, SitioGps[]>> {
  const salida = new Map<string, SitioGps[]>();
  if (tenantIds.length === 0) return salida;
  const filas = await traerTodo<Fila>((d, h) => conPoligonoOCirculo((conPoligono) => acotada(supabaseAdmin().from('geocerca')
    .select(conPoligono ? `id, tenant_id, nombre, lat, lng, radio_m, ${COLUMNAS_POLIGONO}` : 'id, tenant_id, nombre, lat, lng, radio_m')
    .in('tenant_id', tenantIds).eq('catalogo', 'conductor').eq('activa', true).order('id').range(d, h), 'conductor.senal_sitios_flota')) as never, 'conductor.senal_sitios_flota');
  for (const f of filas) {
    const t = String(f.tenant_id);
    salida.set(t, [...(salida.get(t) ?? []), { id: String(f.id), nombre: String(f.nombre), lat: Number(f.lat), lng: Number(f.lng), radioM: Number(f.radio_m), ...geometriaDeFila(f) }]);
  }
  return salida;
}

/** Las flotas cuyo conector de GPS (recurso `posiciones`) tiene la última lectura fallida: backoff por credencial vencida o proveedor caído (0500). */
export async function leerFlotasConConectorDegradado(tenantIds: string[]): Promise<Set<string>> {
  const salida = new Set<string>();
  if (tenantIds.length === 0) return salida;
  const res = await acotada(supabaseAdmin().from('conector_poll_estado').select('tenant_id')
    .in('tenant_id', tenantIds).eq('recurso', 'posiciones').gt('errores_seguidos', 0).range(0, 999), 'conductor.senal_conector');
  if (res.error) {
    if (faltaEsquema(res.error, /errores_seguidos/i)) return salida; // base sin la 0500: no hay backoff que consultar
    throw new Error(`conductor.senal_conector: ${res.error.message}`);
  }
  for (const f of (res.data ?? []) as unknown as Fila[]) salida.add(String(f.tenant_id));
  return salida;
}
