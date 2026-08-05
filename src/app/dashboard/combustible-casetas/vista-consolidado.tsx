import { mxn, fechaMx } from '@/lib/utils';
import type { LineaPorConciliar } from '@/lib/cuadra/analytics';

// La pantalla que faltaba desde la 0076 (auditoría 10, hallazgo CRÍTICO
// fiscal): `cfdi_consolidado_linea` ya guardaba la cola de líneas que el JOIN
// automático no pudo ligar solo, con sus candidatos en JSON — pero ninguna
// pantalla dejaba a un humano resolverla. Cada línea de aquí es una fila de
// esa cola, y el `<form>` de abajo llama a `resolverLineaAMano`
// (`intake/consolidado.ts`) vía la Server Action que pasa `combustible-
// casetas/page.tsx`, siguiendo el mismo patrón que `incidencias/vista.tsx`
// (forms server-rendered, sin JS de cliente).

/** El valor del `<option>` que significa "ningún candidato es el correcto" —
 *  nunca choca con un `gastoId` real porque no tiene forma de UUID. Se
 *  exporta para que la Server Action en `page.tsx` sepa distinguirlo de un
 *  `gastoId` sin tener que importar lógica de `intake/consolidado.ts` aquí. */
export const NINGUNO_VALOR = '__ninguno__';

const CONTROL = { background: 'var(--canvas)', border: '1px solid var(--line)', color: 'var(--ink)' } as const;

/** Por qué una línea NO se ligó sola, en una frase — la misma distinción que
 *  hace `conciliarLineas`: cero candidatos es "nadie cuadra", dos o más es
 *  "cuadran varios y no se adivina cuál". */
function motivoPorConciliar(n: number): string {
  if (n === 0) return 'Sin candidato — ningún gasto capturado cuadra por fecha y monto';
  return `${n} candidatos — cuadran varios por fecha y monto, no se adivina cuál`;
}

export function LineasPorConciliar({
  lineas, accion,
}: {
  lineas: LineaPorConciliar[];
  accion: (fd: FormData) => Promise<void>;
}) {
  if (lineas.length === 0) return null;

  return (
    <div className="divide-y mt-3" style={{ borderColor: 'var(--line)' }}>
      {lineas.map((l) => (
        <div key={l.id} className="py-4 flex flex-col gap-2">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="text-sm font-semibold tabular">{mxn(l.monto)}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                {l.fecha ? fechaMx(l.fecha) : 'sin fecha en el CFDI'}
                {l.estacionRfc ? ` · estación ${l.estacionRfc}` : ''}
                {l.folioOperacion ? ` · folio ${l.folioOperacion}` : ''}
                {l.descripcion ? ` · ${l.descripcion}` : ''}
              </div>
              {l.cfdiUuid && (
                <div className="text-xs mt-0.5 font-mono truncate max-w-md" style={{ color: 'var(--muted)' }}>
                  CFDI {l.cfdiUuid} · línea {l.indice}
                </div>
              )}
            </div>
          </div>

          <div className="text-xs" style={{ color: 'var(--muted)' }}>
            {motivoPorConciliar(l.candidatos.length)}
            {l.candidatos.length > 0 && ': ' + l.candidatos
              .map((c) => `viaje ${c.viajeFolio ?? '(sin folio)'} (${mxn(c.monto)}, ${c.fecha ? fechaMx(c.fecha) : 'sin fecha'})`)
              .join(' · ')}
          </div>

          <form action={accion} className="flex items-center gap-2 flex-wrap mt-1">
            <input type="hidden" name="lineaId" value={l.id} />
            <select
              name="eleccion"
              defaultValue={l.candidatos.length > 0 ? l.candidatos[0].gastoId : NINGUNO_VALOR}
              className="text-sm rounded-lg px-2.5 py-1.5 max-w-xs"
              style={CONTROL}
            >
              {l.candidatos.map((c) => (
                <option key={c.gastoId} value={c.gastoId}>
                  Viaje {c.viajeFolio ?? '(sin folio)'} — {mxn(c.monto)}, {c.fecha ? fechaMx(c.fecha) : 'sin fecha'}
                </option>
              ))}
              <option value={NINGUNO_VALOR}>Ninguno de estos — no ligar a nada</option>
            </select>
            <button type="submit" className="text-sm font-medium rounded-lg px-3 py-1.5"
              style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
              Resolver
            </button>
          </form>
        </div>
      ))}
    </div>
  );
}
