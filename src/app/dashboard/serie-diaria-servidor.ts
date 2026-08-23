import { getSerieComparativa } from '@/lib/likida/analytics';
import { DIAS_SERIE, type DiaViajes } from './serie-diaria';

// ═══════════════════════════════════════════════════════════════════════════
// LA LECTURA de la serie diaria (FE-5) — SOLO SERVIDOR.
//
// Vive aparte de `serie-diaria.ts` porque aquél lo importan dos Client
// Components (`actividad.tsx`, `avance-cierre.tsx`) y este archivo importa
// `analytics.ts`, que trae `supabaseAdmin` — y `supabaseAdmin` arrastra
// `sharp` por la cadena engine → cfdi. El build falla ruidoso si se mezclan
// ("Reading from node:crypto is not handled by plugins"), que es como se
// descubrió: la partición no es estética.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Un bucket por día, del más viejo al más reciente (el orden en que se
 * dibuja la gráfica). `hoy` llega como `AAAA-MM-DD` en día de MÉXICO — el
 * mismo criterio de `hoyMx`: a las 6pm de CDMX, UTC ya dice mañana.
 *
 * LANZA si la lectura falla (`getSerieComparativa` ya lo hace, incluida la
 * comprobación de forma contra una 0112 sin aplicar). El llamador la envuelve
 * en su `safe()` y la tarjeta dice "no se pudo cargar" — nunca una gráfica en
 * ceros, que se lee como una flota parada.
 */
export async function getViajesPorDia(
  tenantId: string,
  hoy: string,
  dias: number = DIAS_SERIE,
): Promise<DiaViajes[]> {
  // `paso` 0 es el más reciente; la gráfica se lee al revés.
  const serie = await getSerieComparativa(tenantId, 1, dias, hoy);
  return serie
    .map((p) => ({ dia: p.desde, viajes: p.totalViajes, liquidados: p.viajesLiquidados }))
    .reverse();
}
