import LogoV2, { PROPORCION_LOGO, type TonoLogoV2 } from './dashboard/shell/logo-v2';

// EL LOGO DE LIKIDA — UNA SOLA IMPLEMENTACIÓN (identidad H, 10-nov-2026).
//
// Antes había dos: el PNG negro cortado en dos piezas y pintado con `mask-image` (aquí) y el SVG vectorial del shell
// (`dashboard/shell/logo-v2.tsx`). Las máscaras de PNG no se escalan limpio, necesitaban una regla `invert(1)` para el modo oscuro
// y dejaban dos logos distintos en la misma pantalla. Ahora todo logo sale del vector de `LogoV2` (los mismos trazados de
// `public/images/logo.png`, `currentColor`); este módulo solo ofrece el ACCESO con la forma que ya usaban las pantallas
// (`alto` como clase de Tailwind) más las variantes que faltaban: símbolo, tono positivo/negativo y tamaño mínimo.
//
// VARIANTES (el kit en `public/brand/`):
//   · horizontal (símbolo + nombre) o `simbolo` solo (riel colapsado, iconos, adornos);
//   · tono `auto` (sigue la tinta del tema: claro y oscuro con un solo marcado), `positivo` (tinta #0E0E10, para fondos claros)
//     y `negativo` (#F4F4F5, para fondos oscuros o de color), los mismos colores de los SVG `likida-*-positivo|negativo.svg`.
//   · TAMAÑO MÍNIMO como Rovaq (100 px de ancho el horizontal, 16 px el símbolo): por debajo el nombre deja de leerse, así que
//     una marca pedida más chica se sube al mínimo. El adorno decorativo (`LogoIcono`, `GlifoAdorno`) no es la marca y queda exento.
//   · El logo de Likida es MONOCROMO: no lleva el punto rojo del logo de Rovaq (decisión de marca propia, DEC-11).

export type TonoLogo = 'auto' | 'positivo' | 'negativo';
export type VarianteLogo = 'horizontal' | 'simbolo';

/** Ancho mínimo de la marca, en px, por variante (igual que `RovaqLogo`). */
export const ANCHO_MINIMO_LOGO: Record<VarianteLogo, number> = { horizontal: 100, simbolo: 16 };

/** Tono de la marca → tono del logo vectorial. Los colores (#0E0E10 y #F4F4F5, los de los SVG `likida-*-positivo|negativo.svg`) viven en `logo-v2.css`. */
const COLOR_TONO: Record<TonoLogo, TonoLogoV2> = {
  auto: 'ink',
  positivo: 'positivo',
  negativo: 'negativo',
};

/** Traduce el `alto` que ya se pasaba (`h-7`, `h-[42px]`, `h-px`…) o un número a píxeles. `null` = no se reconoce. */
export function altoEnPx(alto: string | number): number | null {
  if (typeof alto === 'number') return Number.isFinite(alto) && alto > 0 ? alto : null;
  const clase = alto.trim();
  let valor = Number.NaN;
  let factor = 1;
  if (clase.startsWith('h-[') && clase.endsWith('px]')) valor = Number(clase.slice(3, -3));
  else if (clase.startsWith('h-')) { valor = Number(clase.slice(2)); factor = 4; }
  return Number.isFinite(valor) && valor > 0 ? valor * factor : null;
}

/** El alto final: el pedido, subido al mínimo de la variante si la marca quedaría más chica que el mínimo de ancho. */
export function altoDeMarca(alto: string | number, variante: VarianteLogo): number {
  const pedido = altoEnPx(alto) ?? 28;
  const minimo = Math.ceil((ANCHO_MINIMO_LOGO[variante] / PROPORCION_LOGO[variante]) * 10) / 10;
  return Math.max(pedido, minimo);
}

/** La marca de Likida. `alto` acepta lo de siempre (`"h-7"`, `"h-[42px]"`) o píxeles. Es UNA marca para un lector de pantalla
 *  (`role="img"`, «Likida»); con `decorativo` sale del árbol de accesibilidad. */
export function Logo({ alto, variante = 'horizontal', tono = 'auto', decorativo = false, className }: {
  alto: string | number;
  variante?: VarianteLogo;
  tono?: TonoLogo;
  decorativo?: boolean;
  className?: string;
}) {
  return <LogoV2 alto={altoDeMarca(alto, variante)} variante={variante} decorativo={decorativo} className={className} tono={COLOR_TONO[tono]} />;
}

/** El símbolo solo como ADORNO (p. ej. el glifo que «piensa» en el chat): decorativo, sin tamaño mínimo y en la tinta del tema. */
export function LogoIcono({ alto, className }: { alto: string | number; className?: string }) {
  return (
    <LogoV2 alto={altoEnPx(alto) ?? 16} variante="simbolo" decorativo className={className} tono="ink" />
  );
}

/** El glifo como ADORNO — el que asoma dentro de una píldora al pasar el cursor (el gesto que la landing de likida.ai hace en sus
 *  CTAs). `aria-hidden` y sin `role`: el botón ya se nombra solo con su texto. El color se pasa (del TEXTO del botón: `--bg` en la
 *  píldora de tinta, `--ink` en la de borde). El contenedor que lo envuelve fija la altura (16-17 px) y anima el ancho de 0 a 18. */
export function GlifoAdorno({ color = 'var(--marca)', className = '' }: {
  /** Uno de los tres tokens que usa la marca: `var(--bg)`, `var(--ink)` o `var(--marca)` (por omisión). */
  color?: 'var(--bg)' | 'var(--ink)' | 'var(--marca)';
  className?: string;
}) {
  return (
    <span aria-hidden className={`block h-full ${className}`}>
      <LogoV2 alto={16} variante="simbolo" decorativo tono={color === 'var(--bg)' ? 'bg' : color === 'var(--ink)' ? 'ink' : 'marca'} />
    </span>
  );
}
