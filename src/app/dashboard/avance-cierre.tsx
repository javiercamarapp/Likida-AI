'use client';

import { useMemo } from 'react';
import { sumarUltimos, type DiaViajes } from './serie-diaria';

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
// ── FE-5 (22-ago-2026): LA CUENTA VIENE DE SQL, NO DE 100 FILAS ────────────
//
// Esto contaba EN MEMORIA sobre `getViajes(tenantId, 100)`: las 100 filas más
// recientes. A 50,000 viajes/mes eso son ~90 minutos de operación, así que
// "7d" medía hora y media, "30d" medía la misma hora y media, y "Todo" medía
// otra vez la misma hora y media — tres botones, un solo dato, y el
// porcentaje se veía perfectamente creíble en los tres.
//
// Ahora llega `porDia` (un bucket por día, contado por `serie_comparativa_
// tenant` con ventana de 1 día — ver `serie-diaria.ts`) e `historico` (la
// ventana de ~10 años que ya usa `getSeriesKpiCards`). Cambiar de 7d a 30d
// sigue siendo instantáneo y sin viaje al servidor: los 7 días son la cola de
// los mismos 30 buckets.
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
 * `porDia` e `historico` los cuenta la BASE y llegan por props: este
 * componente no lee el reloj ni parsea fechas. Leer el reloj aquí sería
 * impuro —el componente puede re-renderizar y clasificar distinto— y además
 * el reloj del navegador no coincide con el del servidor, así que el HTML
 * servido y el primer render del cliente podrían meter un viaje en periodos
 * distintos y React reportaría desajuste de hidratación.
 */
/** Ya no tiene su propio toggle — Javier pidió UN solo botón de periodo para
 *  toda la pantalla, no tres controles que pueden mostrar estados distintos.
 *  `rango` lo recibe como prop (el mismo `?rango=` que ya mueve KPIs,
 *  gráfica y `GlobalFilter`) en vez de leerlo con `useSearchParams()`: así
 *  se resuelve UNA vez en el Server Component (`page.tsx`, vía
 *  `resolverRango`) y este componente se queda puro — se puede seguir
 *  probando con `renderToStaticMarkup` sin envolverlo en un router de
 *  Next, que es justo como ya estaban escritas sus pruebas. */
export default function AvanceCierre({ porDia, historico, rango }: {
  /** Un bucket por día (del más viejo al más reciente), ya contado en SQL. */
  porDia: DiaViajes[];
  /** Todo el histórico: viajes iniciados y de ésos cuántos cerraron. `null`
   *  = no se pudo leer, y el botón "Todo" lo dice en vez de enseñar un 0%. */
  historico: { viajes: number; liquidados: number } | null;
  rango?: string;
}) {
  const periodo: Periodo = rango === '30' ? 'mes' : rango === 'todo' ? 'todo' : 'semana';

  const datos = useMemo(() => {
    const cfg = PERIODOS.find((p) => p.id === periodo)!;
    // "Todo" NO es la suma de los 30 buckets: son ventanas distintas y
    // sumarlas diría "todo el histórico" sobre un mes. Viene de su propia
    // lectura (la ventana de ~10 años de getSeriesKpiCards).
    const suma = cfg.dias === null
      ? (historico === null ? null : { viajes: historico.viajes, liquidados: historico.liquidados })
      : sumarUltimos(porDia, cfg.dias);
    if (suma === null) return { dentro: 0, cerrados: 0, ilegible: true, pct: null as number | null };
    return {
      dentro: suma.viajes,
      cerrados: suma.liquidados,
      ilegible: false,
      pct: suma.viajes === 0 ? null : Math.round((suma.liquidados / suma.viajes) * 100),
    };
  }, [porDia, historico, periodo]);

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

      {/* Ya no se reporta "N sin fecha de inicio, fuera del cálculo": ese
          renglón existía porque la cuenta se hacía en memoria sobre 100 filas
          y había que confesar qué se estaba tirando. Ahora la base cuenta por
          `fecha_inicio` dentro del periodo, así que un viaje sin fecha no
          está "fuera del cálculo" — está fuera de la pregunta, que dice
          "iniciados" en su propio texto. */}
      <p className="text-[11px] mt-1" style={{ color: 'var(--muted)' }}>
        {datos.ilegible
          ? 'No se pudo leer el histórico — esto no significa que no haya viajes.'
          : datos.dentro === 0
            ? 'No hay viajes iniciados en este periodo.'
            : `${datos.cerrados} de ${datos.dentro} viaje${datos.dentro === 1 ? '' : 's'} iniciado${datos.dentro === 1 ? '' : 's'} ya está${datos.cerrados === 1 ? '' : 'n'} liquidado${datos.cerrados === 1 ? '' : 's'}.`}
      </p>
    </div>
  );
}
