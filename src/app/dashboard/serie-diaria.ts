// ═══════════════════════════════════════════════════════════════════════════
// LOS VIAJES POR DÍA, CONTADOS EN SQL (FE-5, 22-ago-2026) — LA PARTE PURA
//
// Este archivo NO importa nada: lo consumen `avance-cierre.tsx` y
// `actividad.tsx`, que son Client Components. La LECTURA vive en
// `serie-diaria-servidor.ts` a propósito — importar `analytics.ts` desde aquí
// arrastraría `supabaseAdmin` (y con él `sharp`) al bundle del navegador, que
// es exactamente lo que el encabezado de `supabase/admin.ts` prohíbe. El
// build lo atrapó: "Reading from node:crypto is not handled by plugins",
// vía avance-cierre → serie-diaria → analytics → engine → cfdi → sharp.
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
