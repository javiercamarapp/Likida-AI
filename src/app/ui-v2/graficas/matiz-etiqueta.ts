// Matiz de datos (1..8) de una cifra que no declara `metrica` ni `matiz`, deducido de lo que su ETIQUETA dice que mide.
// Misma familia que `METRICAS` (metricas.ts): dinero = azul, gasto = naranja, cumplimiento = verde, pendiente = ocre,
// servicio = petróleo, requiere acción = burdeos, incidencias = violeta, volumen = tinta. Como Rovaq (`.hoy-kpi[data-c]`): el filete
// de color lo da el SIGNIFICADO de la métrica, no el lugar en la tira ni el dato; y una etiqueta que no cae en ninguna familia
// no lleva filete (devuelve undefined), porque un color sin significado es decoración.
// Puro, sin React.

import type { Matiz } from '../metricas';

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Orden = prioridad: «Facturas vencidas» es acción (6), no dinero (1); «Gasto pendiente» es pendiente (4), no gasto (2). */
const FAMILIAS: ReadonlyArray<readonly [Matiz, RegExp]> = [
  [6, /\b(requier|accion|diferenc|reclam|error|fall|riesgo|vencid|rechaz|bloquead|alerta|critic|urgent|sin cuadrar|por cuadrar|moros)/],
  [7, /\b(incidenc|escalacion|soporte|ticket|queja|arco|solicitud)/],
  [4, /\b(pendient|atorad|en espera|espera|anticipo|abierto|abierta|por cobrar|por revisar|por aprobar|sin conciliar)/],
  [2, /\b(gasto|diesel|caseta|peaje|costo|consumo|combustible|us\$|cargos?)\b/],
  [1, /\b(monto|comprobad|liquid|factur|cobr|ingreso|pago|saldo|mrr|arr|venta|importe|ticket promedio|dinero)/],
  [5, /\b(a tiempo|sla|latencia|disponibilidad|uptime|servicio|puntualidad)/],
  [3, /\b(cumpl|timbrad|carta porte|aprobad|activ|verificad|conciliad|completa|al dia|saludable|operativ)/],
  [8, /\b(viaje|volumen|total|unidad|conductor|operador|flota|cliente|agente|prospecto|corrida|mensaje|documento|registro|eval)/],
];

export function matizDeEtiqueta(etiqueta: string): Matiz | undefined {
  const t = sinAcentos(etiqueta);
  for (const [matiz, re] of FAMILIAS) if (re.test(t)) return matiz;
  return undefined;
}
