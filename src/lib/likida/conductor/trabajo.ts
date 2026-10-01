import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { exigir, traerTodo } from '../pg';
import { COLUMNAS_HITO, COLUMNAS_VIAJE_CTX, filaAHito, filaAViajeCtx, type ViajeContexto } from './repo';
import type { AvisoReclamado } from './planificador';
import type { HitoFila } from './tipos';

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
    .order('aceptado_en', { ascending: true }).limit(limite), 'conductor.viajes');
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
