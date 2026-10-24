import { randomUUID } from 'node:crypto';
import { reclamarPollsConector, finalizarPollConector, RondasDePollNoDisponibles } from '../repo';
import type { PollReclamado, RecursoPoll } from '../repo';
import { conPool } from '../lotes';
import { logger } from '@/lib/logger';

export type { PollReclamado, RecursoPoll } from '../repo';

/** Política del worker; la frontera de datos reclama y valida los leases. */
export async function reclamarPolls(
  recurso: RecursoPoll,
  proveedores: string[],
  limite = 200,
  _opciones: { bootstrapDesde?: string } = {},
): Promise<PollReclamado[]> {
  const worker = `${process.env.VERCEL_REGION ?? 'local'}:${process.pid}:${randomUUID()}`;
  return reclamarPollsConector(recurso, proveedores, limite, worker);
}

export type ResultadoPoll<R> = { c: PollReclamado } & ({ ok: R } | { error: unknown });

/**
 * A37-S38-02 · reparto justo: ANTES se reclamaban solo `ancho` flotas por corrida
 * (cada flota se sondeaba cada 5·ceil(N/ancho) min). Ahora `ancho` obreros reclaman
 * DE A UNA flota, la procesan y reclaman la siguiente hasta agotar las elegibles o
 * el reloj (`venceEn`). La RPC (0866) excluye a las ya iniciadas en esta corrida
 * (`p_no_iniciados_desde`), así que ninguna flota se sondea dos veces ni se queda
 * esperando 'sinTurno'. Sin la 0866 en la base cae al reclamo por lote anterior y
 * lo AVISA. Una flota que lanza no tumba a las demás (`{ error }`).
 */
export async function procesarPollsEnPool<R>(
  recurso: RecursoPoll,
  proveedores: string[],
  ancho: number,
  opciones: { venceEn?: number; ahora?: () => number },
  procesar: (c: PollReclamado) => Promise<R>,
): Promise<Array<ResultadoPoll<R>>> {
  const ahora = opciones.ahora ?? Date.now;
  const worker = `${process.env.VERCEL_REGION ?? 'local'}:${process.pid}:${randomUUID()}`;
  const inicioIso = new Date(ahora()).toISOString();
  const salida: Array<ResultadoPoll<R>> = [];
  // Orden de RECLAMO (no de término): el llamador y las pruebas esperan un orden estable.
  const orden = new Map<PollReclamado, number>();
  const correr = async (c: PollReclamado): Promise<void> => {
    if (!orden.has(c)) orden.set(c, orden.size);
    salida.push(await procesar(c).then((ok) => ({ c, ok }), (error) => ({ c, error })));
  };
  const porLote = async (): Promise<void> => {
    const lote = await reclamarPollsConector(recurso, proveedores, ancho, worker);
    await conPool(lote, ancho, correr);
  };

  const vistas = new Set<string>();
  let degradado = false;
  let lote: 'rondas' | 'lote' = 'rondas';
  const obrero = async (): Promise<void> => {
    // El PRIMER reclamo de cada obrero se hace aunque el reloj ya venció: así las primeras `ancho` flotas salen
    // declaradas `sinTurno` (comportamiento histórico); después del vencimiento ya no se reclaman flotas nuevas.
    let primera = true;
    for (;;) {
      if (lote !== 'rondas') return;
      if (!primera && opciones.venceEn !== undefined && ahora() >= opciones.venceEn) return;
      primera = false;
      let reclamadas: PollReclamado[];
      try {
        reclamadas = await reclamarPollsConector(recurso, proveedores, 1, worker, {
          noIniciadosDesde: inicioIso, ahoraIso: new Date(ahora()).toISOString(),
        });
      } catch (e) {
        if (e instanceof RondasDePollNoDisponibles) { degradado = true; lote = 'lote'; return; }
        throw e;
      }
      if (reclamadas.length === 0) return;
      // Red de seguridad: una flota ya atendida en esta corrida NO se vuelve a procesar (reloj desfasado o cliente sin
      // exclusión). Se corta el reclamo en vez de martillar al proveedor.
      if (reclamadas.some((x) => vistas.has(`${x.tenantId}|${x.proveedor}`))) {
        logger.warn('poll.reclamo_repetido', { recurso });
        lote = 'lote';
        return;
      }
      reclamadas.forEach((x) => vistas.add(`${x.tenantId}|${x.proveedor}`));
      if (reclamadas.length > 1) {
        // Cliente sin RPC (pruebas): devolvió todo de una vez; sin exclusión no se repite.
        lote = 'lote';
        await conPool(reclamadas, ancho, correr);
        return;
      }
      await correr(reclamadas[0]);
    }
  };
  const obreros = await Promise.allSettled(new Array(ancho).fill(0).map(() => obrero()));
  const caida = obreros.find((o): o is PromiseRejectedResult => o.status === 'rejected');
  if (caida && salida.length === 0 && !degradado) throw caida.reason;
  if (caida) logger.error('poll.reclamo_fallo', { recurso, error: caida.reason instanceof Error ? caida.reason.message : String(caida.reason) });
  if (degradado) {
    logger.warn('poll.rondas_sin_migracion_0866', { recurso });
    await porLote();
  }
  return salida.sort((a, b) => (orden.get(a.c) ?? 0) - (orden.get(b.c) ?? 0));
}

export async function finalizarPoll(
  recurso: RecursoPoll,
  claim: PollReclamado,
  resultado: Parameters<typeof finalizarPollConector>[2],
): Promise<void> {
  return finalizarPollConector(recurso, claim, resultado);
}
