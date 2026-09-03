import { mxn } from '@/lib/formato';
import type { RutaConRegion } from '@/lib/likida/analytics';

/** Un color por región — la única excepción multicolor en una página que
 *  por lo demás es naranja monocromo: la región es una categoría, no una
 *  magnitud, y siete tonos de naranja no se distinguen entre sí a simple
 *  vista. `null` (sin clasificar) usa el gris neutro de `--muted`, nunca
 *  un color que sugiera una región que no se pudo confirmar.
 *
 *  Los colores viven como TOKENS en globals.css (`--region-*`), con pareja
 *  clara/oscura medida contra AA — no como hex aquí. Un hex en línea es
 *  invisible para `contraste.test.ts` y no cambia con el tema (auditoría
 *  25, MEDIO). */
const VAR_REGION: Record<string, string> = {
  Centro: '--region-centro', Occidente: '--region-occidente', Noreste: '--region-noreste',
  Noroeste: '--region-noroeste', Golfo: '--region-golfo', Sureste: '--region-sureste', Sur: '--region-sur',
};

function colorDe(region: string | null): string {
  const v = region ? VAR_REGION[region] : undefined;
  return v ? `var(${v})` : 'var(--muted)';
}

/**
 * Top rutas por gasto, con etiqueta de región — capturas de referencia de
 * Javier (8-ago-2026). `region` sale de `getTopRutasPorGasto` (geografía
 * real del destino, catálogo acotado en `analytics.ts`); una ruta a una
 * ciudad fuera del catálogo se enseña "Sin clasificar" en vez de una
 * región inventada.
 */
/** SOLO la tabla — el estado vacío lo pinta la tarjeta (panel-periodo),
 *  igual que en las demás: aquí adentro, el `overflow-x-auto` del wrapper
 *  rompía el centrado (reporte del 12-ago: la leyenda se iba hasta abajo). */
export function TopRutas({ rutas }: { rutas: RutaConRegion[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left" style={{ color: 'var(--muted)' }}>
          <th className="font-medium pb-2 pr-3 w-6">#</th>
          <th className="font-medium pb-2 pr-3">Ruta</th>
          <th className="font-medium pb-2 pr-3 text-right">Monto</th>
          <th className="font-medium pb-2 pr-3 text-right">%</th>
          <th className="font-medium pb-2">Región</th>
        </tr>
      </thead>
      <tbody>
        {rutas.map((r, i) => (
          <tr key={`${r.origen}→${r.destino}`} className="border-t" style={{ borderColor: 'var(--line)' }}>
            <td className="py-2.5 pr-3 tabular" style={{ color: 'var(--muted)' }}>{i + 1}</td>
            <td className="py-2.5 pr-3 truncate max-w-[220px]">{r.origen} → {r.destino}</td>
            <td className="py-2.5 pr-3 text-right tabular font-medium">{mxn(r.total)}</td>
            <td className="py-2.5 pr-3 text-right tabular" style={{ color: 'var(--muted)' }}>{r.pct}%</td>
            <td className="py-2.5">
              <span className="text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
                style={{ color: colorDe(r.region), background: `color-mix(in srgb, ${colorDe(r.region)} 12%, transparent)` }}>
                {r.region ?? 'Sin clasificar'}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
