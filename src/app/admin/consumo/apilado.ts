import type { GastoProposito } from '@/lib/admin/consumo';
import type { PeriodoApilado } from '@/app/ui-v2/graficas';

/** Los propósitos del presupuesto de IA, en el orden fijo de las series (el tono de cada tramo depende de su lugar). */
export const PROPOSITOS = ['interactivo', 'ocr_lote', 'fondo'] as const;

/**
 * Gasto LIQUIDADO de hoy por flota, un tramo por propósito. Una columna por flota, la de mayor gasto primero; no se recorta ni se agrupa
 * («otras» mezclaría clientes distintos en una columna). Un propósito sin fila de esa flota queda `null` (no se pinta ni suma como cero).
 */
export function gastoApiladoPorFlota(filas: readonly GastoProposito[]): { series: typeof PROPOSITOS; periodos: PeriodoApilado[] } {
  const porFlota = new Map<string, { nombre: string; partes: Array<number | null> }>();
  for (const f of filas) {
    const e = porFlota.get(f.tenantId) ?? { nombre: f.tenantNombre, partes: PROPOSITOS.map(() => null as number | null) };
    const i = PROPOSITOS.indexOf(f.proposito);
    if (i >= 0) e.partes[i] = (e.partes[i] ?? 0) + f.liquidadoUsd;
    porFlota.set(f.tenantId, e);
  }
  const total = (p: Array<number | null>) => p.reduce<number>((s, v) => s + (v ?? 0), 0);
  const periodos = [...porFlota.values()]
    .sort((a, b) => total(b.partes) - total(a.partes))
    .map((e): PeriodoApilado => ({ etiqueta: e.nombre, partes: e.partes }));
  return { series: PROPOSITOS, periodos };
}
