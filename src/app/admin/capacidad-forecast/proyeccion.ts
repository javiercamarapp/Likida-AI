// A37-S05-03: proyección de costo de IA sobre una VENTANA REAL de 30 días.
//
// Antes se promediaba TODO el historial (del primer al último día con
// actividad) y se rotulaba "últimos N días": tras un año la proyección ignoraba
// que el gasto actual podía ser 5 veces mayor, y si la IA se detuvo hace
// semanas el rótulo mentía. Además cada día llegaba ya redondeado a centavos,
// así que los días de menos de $0.005 sumaban 0 y la proyección salía en $0
// aunque hubiera gasto. Aquí se suma el costo SIN redondear de la ventana.

export interface Proyeccion {
  promedioDiario: number;
  proyeccionMensual: number;
  diasVentana: number;
}

const DIA_MS = 86_400_000;

const msDe = (dia: string) => new Date(`${dia}T00:00:00Z`).getTime();

/**
 * @param historico  días con actividad de TODO el historial (solo se usa su
 *                   primer día: una plataforma con menos de `ventana` días no
 *                   se promedia entre días que aún no existían).
 * @param enVentana  costo por día SIN redondear, ya acotado a la ventana.
 * @param hoy        día UTC (YYYY-MM-DD) que cierra la ventana (inclusive).
 */
export function proyectarCosto(
  historico: ReadonlyArray<{ dia: string }>,
  enVentana: ReadonlyArray<{ dia: string; costoUsd: number }>,
  hoy: string,
  ventana = 30,
): Proyeccion | null {
  if (historico.length === 0) return null;
  const primero = Math.min(...historico.map((d) => msDe(d.dia)));
  const diasDesdeInicio = Math.floor((msDe(hoy) - primero) / DIA_MS) + 1;
  const diasVentana = Math.max(1, Math.min(ventana, diasDesdeInicio));
  const desde = msDe(hoy) - (diasVentana - 1) * DIA_MS;
  const total = enVentana
    .filter((d) => msDe(d.dia) >= desde && msDe(d.dia) <= msDe(hoy))
    .reduce((s, d) => s + d.costoUsd, 0);
  const promedioDiario = total / diasVentana;
  return { promedioDiario, proyeccionMensual: promedioDiario * 30, diasVentana };
}
