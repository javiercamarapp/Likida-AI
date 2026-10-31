import { mxn } from '@/lib/formato';
import { ColumnasAgrupadas } from '@/app/ui-v2/graficas';
import { compactEs } from '@/app/ui-v2/graficas/escala';

// Copia VIGILADA del mapa del motor (`label()` en cuadre/engine.ts):
// `etiquetas_sincronizadas.test.ts` barre src/ y la compara clave por clave.
// Divergió tres veces ('Casetas'/'Facturas'/'Otros') sin que nadie lo viera
// (auditoría 18, M1): la leyenda del Resumen decía una palabra y el PDF otra.
const CONCEPTO_LABEL: Record<string, string> = {
  diesel: 'Diésel', caseta: 'Caseta', viaticos: 'Viáticos',
  factura: 'Factura', alimentacion: 'Alimentación', hospedaje: 'Hospedaje',
  transporte: 'Transporte', flete: 'Flete', otro: 'Otro',
};

/**
 * Gasto por semana × concepto (barras AGRUPADAS, no apiladas) sobre `ColumnasAgrupadas` de ui-v2: eje con cifra compacta, rejilla
 * tenue, tooltip con cada concepto y el total al pasar, tocar o enfocar (←/→), «Ver como tabla» con los mismos importes y
 * leyenda con el nombre de cada serie. Los valores y las series son EXACTAMENTE los que llegan (nada se recalcula aquí).
 */
export function GastoSemanalChart({ categorias, series }: { categorias: string[]; series: Array<{ nombre: string; valores: number[] }> }) {
  return (
    <ColumnasAgrupadas
      matiz={2}
      etiqueta="Gasto por categoría"
      categorias={categorias}
      series={series.map((s) => ({ nombre: CONCEPTO_LABEL[s.nombre] ?? s.nombre, valores: s.valores }))}
      formato={mxn}
      formatoEje={(v) => `$${compactEs(v)}`}
    />
  );
}
