import { Suspense, type ReactNode } from 'react';
import { LimiteError } from './limite-error';

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

/** Shimmer suelto — el ladrillo con el que se arman los demás esqueletos. */
export function Barra({ alto = 14, ancho = '100%', className = '' }: {
  alto?: number | string; ancho?: number | string; className?: string;
}) {
  return <div className={`skeleton rounded-md ${className}`} style={{ height: alto, width: ancho }} aria-hidden />;
}

/** Envoltura accesible: el lector de pantalla oye "Cargando", no el ruido de
 *  los recuadros. Misma etiqueta que `cargando.tsx`, para que el producto
 *  diga lo mismo esté esperando la página entera o una sola tarjeta. */
function Esperando({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={className} role="status" aria-label="Cargando">{children}</div>
  );
}

/**
 * Una tarjeta blanca del alto que va a ocupar la real. `alto` es el alto del
 * CONTENIDO (el `card` le suma su propio padding), medido contra la tarjeta
 * definitiva para que no haya salto.
 */
export function EsqTarjeta({ alto = 84, className = '' }: { alto?: number; className?: string }) {
  return (
    <Esperando className={`card p-3 ${className}`}>
      <Barra alto={12} ancho="45%" />
      <div className="mt-2"><Barra alto={alto - 26} /></div>
    </Esperando>
  );
}

/**
 * Una fila de N tarjetas de cifra (`StatCard`). `rejilla` recibe LAS MISMAS
 * clases de grid que el contenido real — así el esqueleto ocupa exactamente
 * las mismas columnas en cada breakpoint.
 */
export function EsqCifras({ n = 3, rejilla = 'grid grid-cols-1 sm:grid-cols-3 gap-2', alto = 100 }: {
  n?: number; rejilla?: string; alto?: number;
}) {
  return (
    <Esperando className={rejilla}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="card p-2" style={{ minHeight: alto }}>
          <div className="rounded-xl px-3 py-2" style={{ background: 'var(--canvas)', border: '1px solid var(--line2)' }}>
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg shrink-0 skeleton" aria-hidden />
              <Barra alto={12} ancho="70%" />
            </div>
            <div className="mt-1.5"><Barra alto={20} ancho="55%" /></div>
          </div>
          <div className="mx-1.5 mt-1.5 pt-1.5" style={{ borderTop: '1px dashed var(--line2)' }}>
            <Barra alto={10} ancho="65%" />
          </div>
        </div>
      ))}
    </Esperando>
  );
}

/**
 * Una tabla con su encabezado y N filas parejas — la forma de "Viajes
 * recientes", "Esperan tu revisión" y "Últimos cierres". El alto de fila
 * (33px) es el de una fila real con `py-2` y texto de 13px.
 */
export function EsqTabla({ filas = 6, titulo = true }: { filas?: number; titulo?: boolean }) {
  return (
    <Esperando className="card p-4">
      {titulo && <div className="mb-3"><Barra alto={16} ancho="30%" /></div>}
      <div className="pb-2"><Barra alto={10} ancho="100%" /></div>
      {Array.from({ length: filas }).map((_, i) => (
        <div key={i} className="py-2 border-t" style={{ borderColor: 'var(--line2)' }}>
          <Barra alto={17} ancho={i % 3 === 0 ? '92%' : i % 3 === 1 ? '100%' : '85%'} />
        </div>
      ))}
    </Esperando>
  );
}

/** El cuerpo de una gráfica dentro de su tarjeta — una sola mancha alta. */
export function EsqGrafica({ alto = 200, className = '' }: { alto?: number; className?: string }) {
  return (
    <Esperando className={`card p-4 ${className}`}>
      <Barra alto={16} ancho="35%" />
      <div className="mt-1"><Barra alto={11} ancho="22%" /></div>
      <div className="mt-3"><Barra alto={alto} /></div>
    </Esperando>
  );
}
