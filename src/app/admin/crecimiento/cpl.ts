// A37-S06-04: los leads de ads NO están atribuidos por campaña (solo por
// fuente), así que dividir el gasto de UNA campaña entre los leads de TODAS
// da una cifra de dinero falsa. Solo se calcula el CPL AGREGADO: gasto medido
// total entre leads totales de ads.

export function cplAgregado(
  campanas: ReadonlyArray<{ gastoRealUsd: number | null }>,
  leadsAds: number,
): { cplUsd: number; gastoUsd: number; medidas: number; total: number } | null {
  const medidas = campanas.filter((c) => c.gastoRealUsd !== null);
  if (medidas.length === 0 || !(leadsAds > 0)) return null;
  const gastoUsd = medidas.reduce((n, c) => n + (c.gastoRealUsd as number), 0);
  return { cplUsd: gastoUsd / leadsAds, gastoUsd, medidas: medidas.length, total: campanas.length };
}
