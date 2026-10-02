import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { exigir, traerTodo } from '../pg';
import { COLUMNAS_HITO, COLUMNAS_VIAJE_CTX, filaAHito, filaAViajeCtx, type ViajeContexto } from './repo';
import type { AvisoReclamado } from './planificador';
import type { HitoFila } from './tipos';
import { debeReintentarseValidacion } from './validacion';

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

const trozos = <T>(xs: T[], n: number): T[][] => {
  const r: T[][] = [];
  for (let i = 0; i < xs.length; i += n) r.push(xs.slice(i, i + n));
  return r;
};

export async function sembrarHitos(limite: number): Promise<number> {
  const { data, error } = await acotada(supabaseAdmin().rpc('sembrar_hitos_conductor', { p_limite: limite }), 'conductor.sembrar');
  if (error) throw new Error(`conductor.sembrar: ${error.message}`);
  return Number(data ?? 0);
}

export async function leerViajesActivos(limite: number): Promise<ViajeContexto[]> {
  const res = await acotada(supabaseAdmin()
    .from('viaje').select(COLUMNAS_VIAJE_CTX)
    .eq('estatus', 'abierto').not('aceptado_en', 'is', null)
    .order('aceptado_en', { ascending: true }).order('id').limit(limite), 'conductor.viajes');
  return ((exigir(res as never, 'conductor.viajes') ?? []) as unknown as Fila[]).map(filaAViajeCtx);
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

export async function leerAvisosDeHitos(hitoIds: string[]): Promise<Array<AvisoReclamado & { hitoId: string }>> {
  const salida: Array<AvisoReclamado & { hitoId: string }> = [];
  for (const ids of trozos(hitoIds, 150)) {
    const filas = await traerTodo<Fila>((desde, hasta) => acotada(supabaseAdmin()
      .from('viaje_hito_aviso').select('viaje_hito_id, ciclo, clase, nivel').in('viaje_hito_id', ids).order('id').range(desde, hasta), 'conductor.avisos_lote') as never, 'conductor.avisos_lote');
    for (const f of filas) {
      salida.push({ hitoId: String(f.viaje_hito_id), ciclo: Number(f.ciclo), clase: f.clase as AvisoReclamado['clase'], nivel: Number(f.nivel) });
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
