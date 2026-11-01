// Muestrario del lote G (NO es código de producción): las gráficas interactivas REALES de ui-v2/graficas con datos sintéticos.
// Lo empaqueta capturar-lg.mjs con vite.
import { createRoot } from 'react-dom/client';
import { Tarjeta } from '@/app/ui-v2/componentes';
import { AreaMini, BarList, Columnas, ColumnasAgrupadas, DonaMini } from '@/app/ui-v2/graficas';

const CIERRES = [
  { etiqueta: '24 ago', valor: 21 }, { etiqueta: '31 ago', valor: 26 }, { etiqueta: '7 sep', valor: 18 }, { etiqueta: '14 sep', valor: 31 },
  { etiqueta: '21 sep', valor: 28 }, { etiqueta: '28 sep', valor: 34 }, { etiqueta: '5 oct', valor: 29 }, { etiqueta: '12 oct', valor: 17, parcial: true },
].map((d) => ({ ...d, largo: `Semana del ${d.etiqueta}` }));
const CON_HUECO = [
  { etiqueta: 'ene', valor: 120_000 }, { etiqueta: 'feb', valor: 150_000 }, { etiqueta: 'mar', valor: null }, { etiqueta: 'abr', valor: 210_000 },
  { etiqueta: 'may', valor: 190_000 }, { etiqueta: 'jun', valor: 240_000, parcial: true },
];
const mxn = (v: number) => `$${v.toLocaleString('en-US')}`;

function Muestrario() {
  return (
    <div data-ui="v2" className="rv-muestra" style={{ display: 'grid', gap: 14, padding: 20, maxWidth: 1180, margin: '0 auto' }}>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Gráficas interactivas · lote G</h1>
      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <div id="c-col"><Tarjeta titulo="Liquidaciones cerradas por semana"><Columnas datos={CIERRES} etiqueta="Liquidaciones cerradas por semana" unidad="cierres" matiz={1} /></Tarjeta></div>
        <div id="c-hueco"><Tarjeta titulo="Con sin dato y parcial"><Columnas datos={CON_HUECO} etiqueta="Importe mensual" formato={mxn} tipo="estimado" matiz={4} /></Tarjeta></div>
        <div id="c-area"><Tarjeta titulo="Respuestas por día"><AreaMini matiz={5} valores={[32, 41, 38, 52, 47, 61, 58, 66]} etiquetas={['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom', 'lun']} etiqueta="Respuestas por día" /></Tarjeta></div>
        <div id="c-agr"><Tarjeta titulo="Gasto por categoría"><ColumnasAgrupadas etiqueta="Gasto por categoría" matiz={2} categorias={['3 sep', '10 sep', '17 sep', '24 sep', '1 oct']} series={[{ nombre: 'Diésel', valores: [91000, 84000, 102000, 97000, 88000] }, { nombre: 'Caseta', valores: [21000, 25000, 19000, 28000, 23000] }, { nombre: 'Viáticos', valores: [8000, 6000, 9500, 7000, 8200] }]} formato={mxn} formatoEje={(v) => `$${Math.round(v / 1000)} mil`} /></Tarjeta></div>
        <div id="c-dona"><Tarjeta titulo="Rubros del gasto"><DonaMini matiz={2} etiqueta="Rubros" gajos={[{ etiqueta: 'Diésel', valor: 91000 }, { etiqueta: 'Casetas', valor: 48200 }, { etiqueta: 'Viáticos', valor: 12000 }, { etiqueta: 'Otros', valor: 4000 }]} formato={mxn} /></Tarjeta></div>
        <div id="c-bar"><Tarjeta titulo="Dónde más pesa (historial)"><BarList matiz={6} etiqueta="Dónde más pesan las diferencias" formato={mxn} items={[{ clave: 'a', etiqueta: 'Diésel fuera de política', valor: 24_600 }, { clave: 'b', etiqueta: 'Caseta sin comprobante', valor: 11_200 }, { clave: 'c', etiqueta: 'Anticipo sin cerrar', valor: 6_900 }, { clave: 'd', etiqueta: 'Viáticos duplicados', valor: null }]} /></Tarjeta></div>
      </div>
    </div>
  );
}
createRoot(document.getElementById('raiz')!).render(<Muestrario />);
