import { Suspense, type ReactNode } from 'react';
import { LimiteError } from './limite-error';
import { EsqCifrasV2, EsqTablaV2, EsqTarjetaV2 } from '../ui-v2/componentes';

// ═══════════════════════════════════════════════════════════════════════════
// FE-14 — STREAMING POR TARJETA.
//
// Hasta hoy no había UN solo `<Suspense>` en /dashboard ni en /admin: todas
// las páginas son `force-dynamic` y abrían con un `Promise.all` gigante (16
// consultas en el Resumen, 13 en el agente de Liquidación, 8 en el Panel del
// contador). Next no manda un byte hasta que la función de la página regresa,
// así que el usuario miraba el logo respirando (`loading.tsx`) durante lo que
// tardara la consulta MÁS LENTA — el saludo, la barra y los KPIs baratos
// esperaban a la gráfica de 12 semanas.
//
// El patrón que sustituye a eso, y que estas piezas hacen barato de escribir:
//
//   1. La página LANZA todas las promesas de una (sin `await`) — mismo
//      paralelismo que daba `Promise.all`. Pasar la PROMESA, nunca el valor
//      ya esperado: un `await` en el padre re-serializa lo que se acaba de
//      paralelizar, que es la trampa clásica de esta migración.
//   2. Cada tarjeta se envuelve en `<Bloque>` con un esqueleto de SU forma y
//      SU altura, y adentro un componente `async` que solo espera SUS
//      promesas. Lo barato sale con el primer flush; lo caro llega después
//      por el mismo stream, sin recargar.
//   3. El manejo de error por bloque se conserva entero: las secciones que ya
//      usaban `safe()` siguen resolviendo a `null` y pintando su leyenda
//      honesta ("no se pudo leer" ≠ "cero"), y `LimiteError` cubre a las que
//      lanzan de verdad — la tarjeta rota enseña `EstadoError` y sus hermanas
//      ni se enteran.
//
// LA REGLA DEL ESQUELETO: misma altura aproximada que el contenido real. Un
// esqueleto de 40px donde luego caen 300 produce el salto de layout que el
// streaming venía a evitar; por eso estos helpers piden `alto` y aceptan el
// MISMO `className` de rejilla que usa el contenido definitivo.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Una sección que llega por streaming: límite de error POR FUERA (Suspense no
 * atrapa errores, solo espera) y el esqueleto como fallback mientras su
 * consulta viaja.
 */
export function Bloque({ mensaje, esqueleto, children }: {
  /** Qué se le dice al usuario si ESTE bloque revienta (no la página). */
  mensaje: string;
  /** El esqueleto de la forma y la altura del contenido real. */
  esqueleto: ReactNode;
  children: ReactNode;
}) {
  return (
    <LimiteError mensaje={mensaje}>
      <Suspense fallback={esqueleto}>{children}</Suspense>
    </LimiteError>
  );
}

/**
 * Marca una promesa como YA OBSERVADA sin cambiarla ni tragarse su error.
 *
 * Una promesa que se lanza aquí arriba y se espera dentro de un `<Suspense>`
 * pasa un rato sin nadie escuchándola. Si revienta en ese hueco, Node la
 * cuenta como `unhandledRejection` — que en producción puede tumbar el
 * proceso entero por una consulta caída. El `.catch` vacío ADJUNTA un
 * observador (y devuelve otra promesa que nadie usa); la original sigue
 * rechazando igual, y el bloque que la espera sigue viendo el error y
 * pintando su `EstadoError`.
 *
 * Las envueltas en `safe()` no lo necesitan —resuelven a `null` y jamás
 * rechazan—; esto es para las que fallan CERRADO a propósito.
 */
export function vigilar<T>(p: Promise<T>): Promise<T> {
  p.catch(() => {});
  return p;
}

/** Shimmer suelto — el ladrillo con el que se arman los demás esqueletos. */
export function Barra({ alto = 14, ancho = '100%', className = '' }: {
  alto?: number | string; ancho?: number | string; className?: string;
}) {
  return <div className={`skeleton rounded-md ${className}`} style={{ height: alto, width: ancho }} aria-hidden />;
}

/**
 * Una tarjeta del alto que va a ocupar la real. `alto` es el alto del CONTENIDO; se redondea al escalón más cercano de los que el
 * CSS conoce (60/84/120/160/240/320), medidos contra las tarjetas definitivas para que no haya salto.
 */
const ESCALONES = [60, 84, 120, 160, 240, 320] as const;
const escalon = (alto: number) => ESCALONES.reduce((a, b) => (Math.abs(b - alto) < Math.abs(a - alto) ? b : a));

export function EsqTarjeta({ alto = 84, className = '' }: { alto?: number; className?: string }) {
  return <EsqTarjetaV2 alto={escalon(alto)} className={className} />;
}

/**
 * La tira de n indicadores con la forma de `TiraCifras` (una tarjeta, celdas con filete, 112 px). `rejilla` y `alto` se aceptan por
 * compatibilidad con las llamadas anteriores y se ignoran: la tira se acomoda sola con su CSS.
 */
export function EsqCifras({ n = 3 }: { n?: number; rejilla?: string; alto?: number }) {
  return <EsqCifrasV2 n={Math.min(5, Math.max(2, n)) as 2 | 3 | 4 | 5} />;
}

/** Una tabla con su encabezado (36 px) y N filas parejas (40 px) — la forma de "Viajes recientes", "Esperan tu revisión" y "Últimos cierres". */
export function EsqTabla({ filas = 6 }: { filas?: number; titulo?: boolean }) {
  return <EsqTablaV2 filas={filas} />;
}

/** El cuerpo de una gráfica dentro de su tarjeta — una sola mancha alta. */
export function EsqGrafica({ alto = 200, className = '' }: { alto?: number; className?: string }) {
  return <EsqTarjetaV2 alto={escalon(alto + 40)} className={className} />;
}
