import { mxn } from '@/lib/formato';

/** Un color distinto por serie, mismo ramp naranja que el resto del
 *  Resumen (`DEGRADADO_MARCA`) — no un color por categoría inventado: son
 *  las mismas tres paradas de `--g3`/`--g4`/`--marca` que ya usa el
 *  degradado, para que esta gráfica se sienta de la misma familia visual. */
const COLOR_SERIE = ['var(--g3)', 'var(--g4)', 'var(--marca)'];

const CONCEPTO_LABEL: Record<string, string> = {
  diesel: 'Diésel', caseta: 'Casetas', viaticos: 'Viáticos',
  factura: 'Facturas', alimentacion: 'Alimentación', hospedaje: 'Hospedaje',
  transporte: 'Transporte', flete: 'Flete', otro: 'Otros',
};

/** 4 marcas redondas de eje Y (0/25/50/75/100% de `max`) — mismo criterio
 *  que un eje real: un múltiplo legible, no el máximo exacto de los datos. */
function marcasEje(max: number): number[] {
  return [0, 0.25, 0.5, 0.75, 1].map((f) => max * f).reverse();
}

/**
 * Barras agrupadas (NO apiladas) por semana × categoría, con tooltip al
 * :hover — capturas de referencia de Javier (8-ago-2026). Divs con
 * `height` en %, no SVG: un `<svg>` con `preserveAspectRatio="none"`
 * distorsiona las esquinas redondeadas al estirarse a un ancho real (mismo
 * problema ya documentado en `BarChartSimple`, `admin/charts.tsx`) — los
 * divs no tienen ese punto de falla.
 */
export function GastoSemanalChart({ categorias, series }: { categorias: string[]; series: Array<{ nombre: string; valores: number[] }> }) {
  const max = Math.max(...series.flatMap((s) => s.valores), 1);
  const ejeY = marcasEje(max);
  const ALTO = 200;

  return (
    <div>
      <div className="flex flex-wrap gap-4 mb-3">
        {series.map((s, i) => (
          <div key={s.nombre} className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
            <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLOR_SERIE[i % COLOR_SERIE.length] }} />
            {CONCEPTO_LABEL[s.nombre] ?? s.nombre}
          </div>
        ))}
      </div>
      <div className="flex gap-2" style={{ height: ALTO }}>
        <div className="flex flex-col justify-between text-right shrink-0 pb-5" style={{ width: 44 }}>
          {ejeY.map((v, i) => (
            <span key={i} className="text-[10px] leading-none" style={{ color: 'var(--faint)' }}>{mxn(v).replace('.00', '')}</span>
          ))}
        </div>
        <div className="relative flex-1 flex items-end gap-3 border-l border-b" style={{ borderColor: 'var(--line)' }}>
          {/* Gridlines horizontales — hairline de 1px, mismo criterio que AreaChartSimple. */}
          {ejeY.slice(1).map((_, i) => (
            <div key={i} className="absolute left-0 right-0 border-t" style={{ borderColor: 'var(--line)', bottom: `${((i + 1) / (ejeY.length - 1)) * 100}%`, opacity: 0.6 }} />
          ))}
          {categorias.map((cat, ci) => (
            <div key={cat} className="relative flex-1 h-full flex flex-col justify-end items-center group cursor-default z-10">
              <div className="flex items-end gap-[3px] w-full justify-center" style={{ height: '100%' }}>
                {series.map((s, si) => (
                  <div key={s.nombre} className="w-full max-w-[14px] rounded-t-[3px]" style={{
                    height: `${Math.max(s.valores[ci] > 0 ? 2 : 0, (s.valores[ci] / max) * 100)}%`,
                    background: COLOR_SERIE[si % COLOR_SERIE.length],
                    transition: `height 480ms cubic-bezier(.22,1,.36,1) ${ci * 60}ms`,
                  }} />
                ))}
              </div>
              <span className="text-[11px] mt-2" style={{ color: 'var(--muted)' }}>{cat}</span>
              {/* Tooltip oscuro, mismo lenguaje que AreaChartSimple — aparece
                  al :hover del cluster completo, no de cada barra suelta. */}
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 rounded-lg px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-20"
                style={{ background: 'var(--ink)' }}>
                <div className="text-[11px] font-semibold mb-1" style={{ color: 'var(--surface)' }}>{cat}</div>
                {series.map((s, si) => (
                  <div key={s.nombre} className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--surface)' }}>
                    <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: COLOR_SERIE[si % COLOR_SERIE.length] }} />
                    <span className="opacity-80">{CONCEPTO_LABEL[s.nombre] ?? s.nombre}</span>
                    <span className="font-semibold ml-auto">{mxn(s.valores[ci])}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
