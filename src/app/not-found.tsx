import Link from 'next/link';

// Sin esta página, una URL mal escrita mostraba el 404 crudo de Next: pantalla
// negra con texto de framework. Delante de un comprador eso se lee como "esto
// está a medio hacer", aunque el 404 sea correcto.
//
// Sin tarjeta y sin botón de color. Un 404 no es una acción que el producto
// quiera que hagas —es un callejón—, así que no lleva el único acento de la
// marca, que está reservado para lo que sí importa. Tipografía grande y muy
// apretada (el registro de la landing: `--display` a -.042em), mucho aire, y
// una sola salida en texto.
export default function NoEncontrado() {
  return (
    <main
      className="min-h-screen flex flex-col justify-between px-8 py-8 md:px-14 md:py-12"
      style={{ background: 'var(--bg)' }}
    >
      {/* `self-start` NO es decorativo: como hijo directo de un flex column, el
          `align-items: stretch` de default estiraba el logo a todo el ancho y
          lo deformaba. En /login no pasa porque ahí va dentro de un div. */}
      <span role="img" aria-label="Likida" className="h-6  self-start block" style={{ aspectRatio: '726 / 149', background: 'var(--marca)', WebkitMaskImage: "url(/images/logo.png)", maskImage: "url(/images/logo.png)", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat", WebkitMaskSize: "contain", maskSize: "contain", WebkitMaskPosition: "left center", maskPosition: "left center" }} />

      <div className="max-w-3xl">
        <p
          className="text-xs font-medium uppercase"
          style={{ color: 'var(--muted)', letterSpacing: '0.14em' }}
        >
          Error 404
        </p>

        <h1
          className="mt-5 font-medium"
          style={{
            fontFamily: 'var(--font-display), system-ui, sans-serif',
            // Escala fluida en vez de saltos por breakpoint: en un monitor de
            // sala de juntas crece, en un teléfono no se desborda.
            fontSize: 'clamp(38px, 7vw, 82px)',
            lineHeight: 0.98,
            letterSpacing: '-0.042em',
            textWrap: 'balance',
          }}
        >
          Esta página no existe
        </h1>

        <p
          className="mt-6 max-w-lg"
          style={{ color: 'var(--muted)', fontSize: 'clamp(16px, 1.5vw, 19px)', lineHeight: 1.55 }}
        >
          Puede que el enlace esté mal escrito, o que lo que buscabas ya no esté disponible.
        </p>

        <Link
          href="/dashboard"
          className="group inline-flex items-center gap-2 mt-9 text-base font-medium"
          style={{ color: 'var(--ink)' }}
        >
          <span
            className="pb-0.5"
            style={{ borderBottom: '1px solid color-mix(in srgb, var(--ink) 28%, transparent)' }}
          >
            Ir al panel
          </span>
          {/* La flecha se mueve sola en hover; `motion-reduce` la deja quieta
              para quien pidió menos animación en el sistema. */}
          <span
            aria-hidden
            className="transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transform-none motion-reduce:transition-none"
          >
            →
          </span>
        </Link>
      </div>

      <p className="text-xs" style={{ color: 'var(--faint, var(--muted))' }}>
        Likida · Liquidación de viajes por WhatsApp
      </p>
    </main>
  );
}
