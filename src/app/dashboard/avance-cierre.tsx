'use client';

import { useMemo } from 'react';
import type { ViajeRow } from '@/lib/likida/analytics';

// ═══════════════════════════════════════════════════════════════════════════
// AVANCE DE CIERRE — cuánto de lo que se abrió ya cerró, por periodo.
//
// Por qué ESTA métrica y no una de dinero: esta barra vive en /dashboard, que
// el ENCARGADO también ve (visibilidad.ts). Una barra de pesos ahí sería una
// fuga por la puerta de atrás — el jefe de tráfico no ve finanzas. Ésta es
// puramente operativa: viajes liquidados contra viajes iniciados en el
// periodo, que además es la pregunta que el operador se hace en la mañana
// ("¿voy al corriente o se me está acumulando?").
//
// Se calcula en el cliente sobre los viajes que la página ya trajo, no con
// una consulta por pestaña: cambiar de semana a mes es instantáneo y no
// cuesta un viaje al servidor por clic.
// ═══════════════════════════════════════════════════════════════════════════

type Periodo = 'semana' | 'mes' | 'todo';

// AUDITORÍA 10, MEDIO — este filtro decía "Semana | Mes | Todo" y, 130 px
// abajo en la misma pantalla, `GlobalFilter` dice "7d | 30d | Todo" sobre
// las mismas ventanas (7 y 30 días). Dos vocabularios para la misma medida
// en la misma pantalla: la captura mostraba "Mes" apretado arriba y
// "últimos 7 días" escrito abajo, como si fueran cosas distintas. Gana el
// vocabulario de `GlobalFilter` porque es el que de verdad mueve las tres
// consultas de la página — esta barra solo mueve su propio cálculo local,
// así que es la que se ajusta. Los `id` internos ('semana'/'mes') no
// cambian: solo son claves de estado, nunca se enseñan.
const PERIODOS: Array<{ id: Periodo; label: string; dias: number | null }> = [
  { id: 'semana', label: '7d', dias: 7 },
  { id: 'mes', label: '30d', dias: 30 },
  { id: 'todo', label: 'Todo', dias: null },
];

/**
 * `ahoraMs` lo manda el SERVIDOR (`ahoraMs()` de lib/saludo). Leer el reloj
 * aquí sería impuro —el componente puede re-renderizar y clasificar distinto—
 * y además el reloj del navegador no coincide con el del servidor, así que el
 * HTML servido y el primer render del cliente podrían meter un viaje en
 * periodos distintos y React reportaría desajuste de hidratación.
 */
/** Ya no tiene su propio toggle — Javier pidió UN solo botón de periodo para
 *  toda la pantalla, no tres controles que pueden mostrar estados distintos.
 *  `rango` lo recibe como prop (el mismo `?rango=` que ya mueve KPIs,
 *  gráfica y `GlobalFilter`) en vez de leerlo con `useSearchParams()`: así
 *  se resuelve UNA vez en el Server Component (`page.tsx`, vía
 *  `resolverRango`) y este componente se queda puro — se puede seguir
 *  probando con `renderToStaticMarkup` sin envolverlo en un router de
 *  Next, que es justo como ya estaban escritas sus pruebas. El cálculo
 *  sigue siendo local sobre `viajes` (cero viajes de más al servidor). */
export default function AvanceCierre({ viajes, ahoraMs, rango }: { viajes: ViajeRow[]; ahoraMs: number; rango?: string }) {
  const periodo: Periodo = rango === '30' ? 'mes' : rango === 'todo' ? 'todo' : 'semana';

  const datos = useMemo(() => {
    const cfg = PERIODOS.find((p) => p.id === periodo)!;
    const corte = cfg.dias === null ? null : ahoraMs - cfg.dias * 86_400_000;

    // Un viaje SIN fecha de inicio no se puede ubicar en un periodo. No se
    // cuenta ni como dentro ni como fuera: se reporta aparte, porque meterlo
    // en el total movería el porcentaje sin que nadie sepa por qué.
    let dentro = 0, cerrados = 0, sinFecha = 0;
    for (const v of viajes) {
      if (!v.fechaInicio) { sinFecha += 1; continue; }
      const t = Date.parse(v.fechaInicio);
      if (Number.isNaN(t)) { sinFecha += 1; continue; }
      if (corte !== null && t < corte) continue;
      dentro += 1;
      if (v.estatus === 'liquidado') cerrados += 1;
    }
    return { dentro, cerrados, sinFecha, pct: dentro === 0 ? null : Math.round((cerrados / dentro) * 100) };
  }, [viajes, periodo, ahoraMs]);

  return (
    <div>
      <div className="flex items-baseline gap-2 min-w-0 mb-2">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
          Avance de cierre
        </span>
        {/* Sin viajes en el periodo NO se pinta 0%: un 0% se lee como "no
            has cerrado nada", que es una acusación. Se dice que no hubo. */}
        {datos.pct !== null && (
          <span className="text-sm font-semibold tabular">{datos.pct}%</span>
        )}
      </div>

      {/* AUDITORÍA 10, BAJO — sin viajes en el periodo, esto dibujaba la
          pista Y la barra a `width: 0%`: una barra vacía a lo ancho del
          panel. `chofer/vista.tsx` (Barra) ya tiene la regla escrita para
          esta misma situación: "SIN ANTICIPO NO SE DIBUJA BARRA. Una barra
          vacía se lee como 'llevas 0%'". Aquí es "sin viajes" en vez de
          "sin anticipo", pero es la misma barra fantasma — se aplica la
          misma regla: sin `pct` (nada que medir), no se dibuja ni la pista.
          El pie de página ("No hay viajes iniciados…") ya dice por qué. */}
      {datos.pct !== null && (
        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--canvas)' }}>
          <div
            className="h-full rounded-full motion-reduce:transition-none"
            style={{
              width: `${datos.pct}%`,
              background: 'var(--marca)',
              transition: 'width 620ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          />
        </div>
      )}

      <p className="text-[11px] mt-1" style={{ color: 'var(--muted)' }}>
        {datos.dentro === 0
          ? 'No hay viajes iniciados en este periodo.'
          : `${datos.cerrados} de ${datos.dentro} viaje${datos.dentro === 1 ? '' : 's'} iniciado${datos.dentro === 1 ? '' : 's'} ya está${datos.cerrados === 1 ? '' : 'n'} liquidado${datos.cerrados === 1 ? '' : 's'}.`}
        {datos.sinFecha > 0 && ` ${datos.sinFecha} sin fecha de inicio, fuera del cálculo.`}
      </p>
    </div>
  );
}
