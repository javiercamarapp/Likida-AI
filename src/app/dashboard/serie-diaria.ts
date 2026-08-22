import { getSerieComparativa } from '@/lib/likida/analytics';

// ═══════════════════════════════════════════════════════════════════════════
// LOS VIAJES POR DÍA, CONTADOS EN SQL (FE-5, 22-ago-2026)
//
// "Actividad — últimos 7 días" y "Avance de cierre" se calculaban en el
// navegador sobre `getViajes(tenantId, 100)`: las 100 filas MÁS RECIENTES.
// A 50,000 viajes/mes, 100 viajes son unos 90 MINUTOS de operación — así que
// la gráfica rotulada "7 días" dibujaba hora y media y seis barras en cero, y
// el "Avance de cierre" medía el porcentaje de la última hora y media
// llamándolo la semana. Ninguno de los dos avisaba: son cifras que se ven
// perfectamente plausibles y están mal, que es justo lo que este producto no
// puede hacer ("nunca inventar una cifra", CLAUDE.md).
//
// No hace falta una función SQL nueva: `serie_comparativa_tenant` (mig. 0112,
// ya aplicada y verificada) recibe `ventanaDias` y `pasos` y devuelve un
// bucket por ventana. Con `ventanaDias = 1` y `pasos = 30` eso ES el conteo
// por día — `count(*)` y `count(*) filter (where estatus = 'liquidado')`
// sobre `viaje.fecha_inicio`, en la base, en UN viaje de red y sin tope de
// filas. El bucketeo en JS (`bucketsPorDia`) se retira: sin las 100 filas
// crudas ya no hay nada que bucketear en el cliente.
// ═══════════════════════════════════════════════════════════════════════════

export interface DiaViajes {
  /** `AAAA-MM-DD`, el mismo formato de `viaje.fecha_inicio` (columna `date`). */
  dia: string;
  /** Viajes INICIADOS ese día. */
  viajes: number;
  /** De ésos, cuántos ya están liquidados. */
  liquidados: number;
}

/** Cuántos días trae la serie. 30 cubre las dos vistas del panel (semanal
 *  toma los últimos 7 de estos mismos 30) con UNA sola lectura. */
export const DIAS_SERIE = 30;

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

/** Suma los últimos `n` días de la serie (la cola, que es la más reciente).
 *  Pura, para que las dos vistas del selector no cuesten una consulta cada
 *  una: 7 días son los últimos 7 buckets de los mismos 30. */
export function sumarUltimos(serie: DiaViajes[], n: number): { viajes: number; liquidados: number } {
  const cola = n >= serie.length ? serie : serie.slice(serie.length - n);
  return cola.reduce(
    (acc, d) => ({ viajes: acc.viajes + d.viajes, liquidados: acc.liquidados + d.liquidados }),
    { viajes: 0, liquidados: 0 },
  );
}
