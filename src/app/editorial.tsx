// ═══════════════════════════════════════════════════════════════════════════
// LA VOZ EDITORIAL DE LA MARCA, PARA LAS PANTALLAS DE ALTO.
//
// El 17-ago-2026 la landing se mudó a https://likida.ai con un lenguaje
// propio: papel, tinta, hairlines de 1px, kicker en mono mayúsculas y
// TITULARES EN SERIF (Fraunces). El software se quedó con su sistema — Inter /
// Inter Tight / IBM Plex Mono, tokens en `globals.css` — que es el correcto
// para un panel de trabajo: un estado de cuenta no se escribe en serif.
//
// Pero hay dos pantallas que NO son panel: el 404 y el error del boundary. Son
// callejones, y quien las ve puede no haber entrado nunca al producto (un
// enlace viejo compartido por WhatsApp, un buscador, un correo). Ahí la
// pantalla es MARCA, y tiene que sonar como likida.ai.
//
// Este módulo es el puente, y es deliberadamente CHICO — tres piezas, no un
// segundo sistema de diseño:
//   · `serifEditorial` — Fraunces, la única voz que el software no tenía.
//   · `Kicker` — el micro-rótulo en mono, con el tracking de la landing.
//   · `Pildora` — el botón redondo de tinta con el glifo que asoma en hover.
//
// LOS COLORES NO SE COPIAN: `--bg`, `--ink`, `--line`, `--muted` de
// `globals.css` YA son la paleta de la landing (papel #fbfbfd, tinta #17100d,
// línea #ececef, gris #6b7280 — los mismos hex). Copiarlos a mano habría hecho
// que el tema oscuro del panel dejara de aplicarles.
//
// Y NO SE USA EL NARANJA. `--accent`/`--marca` siguen siendo #c2410c en el
// software, y la landing nueva no tiene naranja: quien monte estas piezas pone
// `tema-neutro` en su raíz (el override que ya usan las dos consolas) y el
// glifo del logo sale en tinta, no en naranja, en claro y en oscuro.
// ═══════════════════════════════════════════════════════════════════════════
import Link from 'next/link';
import { Fraunces } from 'next/font/google';
import { GlifoAdorno } from './logo';

// `preload: false` A PROPÓSITO. Este módulo lo importa también
// `dashboard/error.tsx`, que es un componente de cliente y por lo tanto viaja
// en el bundle de TODAS las páginas del panel. Con el preload por defecto,
// cada pantalla del panel emitiría un `<link rel=preload>` de ~70 KB por una
// tipografía que solo se pinta cuando algo se rompe. Sin preload, el @font-face
// va igual en el CSS de la ruta y la fuente se pide cuando de verdad hay texto
// serif que pintar; `display: swap` cubre ese instante con la Georgia del
// fallback (la misma cascada que declara la landing).
export const serifEditorial = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-serif',
});

/** La cascada completa. Se exporta para `global-error.tsx`, que no puede
 *  depender de la variable CSS (ver el comentario de ese archivo). */
export const SERIF_CASCADA = 'var(--font-serif), Fraunces, Georgia, "Times New Roman", serif';

/** El micro-rótulo de la landing: mono, mayúsculas, tracking .14em, dentro de
 *  una píldora de hairline. Es el que ordena la jerarquía antes del titular. */
export function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="etiqueta-mono inline-block text-[11px] uppercase"
      style={{
        letterSpacing: '0.14em',
        color: 'var(--muted)',
        border: '1px solid var(--line)',
        borderRadius: '8px',
        padding: '6px 12px',
        background: 'var(--surface)',
      }}
    >
      {children}
    </span>
  );
}

/** El titular serif. `textWrap: balance` para que en un teléfono no quede una
 *  línea huérfana de una palabra, y escala fluida en vez de saltos por
 *  breakpoint: en un monitor de sala de juntas crece, en un celular no se
 *  desborda. */
export function TituloEditorial({ children }: { children: React.ReactNode }) {
  return (
    <h1
      className="mt-7"
      style={{
        fontFamily: SERIF_CASCADA,
        fontWeight: 400,
        fontSize: 'clamp(36px, 5.4vw, 74px)',
        lineHeight: 1.06,
        letterSpacing: '-0.015em',
        textWrap: 'balance',
      }}
    >
      {children}
    </h1>
  );
}

/**
 * El botón píldora de la landing. Dos variantes, las mismas dos que
 * `main.css`: `tinta` (rellena, la acción principal) y `borde` (hairline, la
 * secundaria). Los estilos viven en `globals.css` (`.pildora*`) porque el
 * gesto del glifo es un `:hover` y eso no se puede escribir en línea.
 *
 * `href` o `onClick`, nunca los dos: con `href` sale un `<Link>` (navegación
 * suave); sin él, un `<button>` — que es lo que necesita el `reset()` del
 * error boundary.
 */
export function Pildora({
  children,
  href,
  onClick,
  variante = 'tinta',
}: {
  children: React.ReactNode;
  href?: string;
  onClick?: () => void;
  variante?: 'tinta' | 'borde';
}) {
  const clase = `pildora ${variante === 'tinta' ? 'pildora-tinta' : 'pildora-borde'}`;
  // El glifo toma el color del TEXTO de su píldora: sobre tinta es papel,
  // sobre la de borde es tinta. Así nunca aparece el naranja de `--marca`.
  const cuerpo = (
    <>
      <span aria-hidden className="pildora-glifo">
        <GlifoAdorno color={variante === 'tinta' ? 'var(--bg)' : 'var(--ink)'} />
      </span>
      <span>{children}</span>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={clase}>
        {cuerpo}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={clase}>
      {cuerpo}
    </button>
  );
}
