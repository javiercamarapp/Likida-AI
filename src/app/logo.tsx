// El logo de Likida, en dos piezas y dos colores: el ícono en el naranja de
// marca, el wordmark "LIKIDA" en la tinta.
//
// Por qué no es una sola imagen: `public/images/logo.png` (726×149) trae ícono
// y letras en un mismo PNG negro sobre transparente. Para teñirlo con la
// paleta se usaba `mask-image` con `background: var(--marca)`, y una máscara
// pinta TODO el recorte de un solo color — ícono y letras salían naranjas.
//
// Por qué el corte está en x=161: midiendo el canal alfa por columna, el ícono
// ocupa 0–112 y la "L" arranca en 210. Ese hueco de 97px es el más ancho del
// archivo (los huecos ENTRE letras no pasan de 50px), así que es el único
// separador que no parte una letra a la mitad. Se corta en su centro (161),
// y las dos piezas suman exactamente 726: `logo-icono.png` es 161×149 y
// `logo-texto.png` 565×149. Como las proporciones 161/149 + 565/149 recomponen
// el 726/149 original, el logo mide y espacia igual que antes.
//
// Las dos piezas van con máscara —ninguna es un <img> crudo— para que ambas
// sigan su token si mañana cambia el color: el <img> se quedaría negro.

const MASCARA = {
  WebkitMaskRepeat: 'no-repeat',
  maskRepeat: 'no-repeat',
  WebkitMaskSize: 'contain',
  maskSize: 'contain',
  WebkitMaskPosition: 'left center',
  maskPosition: 'left center',
} as const;

export function Logo({ alto, className = '' }: { alto: string; className?: string }) {
  return (
    // `role="img"` + `aria-label` en el contenedor: para un lector de pantalla
    // esto es UNA marca, no dos gráficos. Las piezas van `aria-hidden`.
    <span role="img" aria-label="Likida" className={`inline-flex items-stretch ${alto} ${className}`}>
      <span
        aria-hidden
        className="block h-full"
        style={{
          aspectRatio: '161 / 149',
          background: 'var(--marca)',
          WebkitMaskImage: 'url(/images/logo-icono.png)',
          maskImage: 'url(/images/logo-icono.png)',
          ...MASCARA,
        }}
      />
      <span
        aria-hidden
        className="block h-full"
        style={{
          aspectRatio: '565 / 149',
          background: 'var(--ink)',
          WebkitMaskImage: 'url(/images/logo-texto.png)',
          maskImage: 'url(/images/logo-texto.png)',
          ...MASCARA,
        }}
      />
    </span>
  );
}
