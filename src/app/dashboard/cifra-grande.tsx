'use client';

import { useCountUp } from '../admin/ui/use-count-up';
import { usePrefersReducedMotion } from '../admin/ui/prefers-reduced-motion';
import { resolverFormato, type FormatoPreset } from '../admin/ui/formato-preset';

/**
 * La cifra de cabecera del panel del CLIENTE.
 *
 * Reemplaza al `ContadorRetro` (el reloj Solari de tiles negros), que se
 * queda en /admin: ese contador es un guiño de consola interna —dígitos
 * girando en cajitas— y lo que un contralor necesita arriba de su panel es
 * lo contrario, una sola cifra tranquila que se lea de lejos en la sala.
 *
 * Minimalista a propósito: sin caja, sin fondo, sin borde. Solo el número
 * grande en tipografía display, el símbolo de moneda a menor tamaño y en
 * gris (es contexto, no dato), y el rótulo abajo en versalitas espaciadas.
 *
 * AUDITORÍA 10, MEDIO — antes el fundido de entrada dependía de
 * `useInView` (IntersectionObserver): en el servidor `enVista` arranca en
 * `false`, así que el `opacity:0` salía en el HTML servido y el número
 * —el más grande del panel— quedaba invisible hasta que el JS montara,
 * corriera el observer y confirmara que el elemento ya estaba en pantalla.
 * Pero esta cifra vive en el ENCABEZADO FIJO (`dashboard/page.tsx`: "no se
 * va al hacer scroll"): nunca está fuera de vista al cargar, así que ese
 * fundido "al entrar en viewport" (pensado para gráficas más abajo, §F-bis)
 * no tenía nada que detectar y solo escondía la cifra mientras tanto. Se
 * quita: se pinta a opacidad plena desde el HTML servido, mismo criterio
 * que ya aplica `useCountUp` — el valor real, VISIBLE, sin esperar a que
 * el JS corra.
 */
export default function CifraGrande({
  valor, etiqueta, formato = 'mxn', nota,
}: {
  valor?: number;
  etiqueta: string;
  formato?: FormatoPreset;
  /** Segunda línea opcional, aún más discreta (la ventana de tiempo, la base legal). */
  nota?: string;
}) {
  const reducido = usePrefersReducedMotion();
  const mostrado = useCountUp(valor ?? 0, !reducido);
  const fmt = resolverFormato(formato);

  return (
    <div className="shrink-0 text-right">
      <div
        className="tabular leading-none"
        style={{
          fontFamily: 'var(--font-display), var(--font-sans)',
          fontWeight: 600,
          fontSize: 'clamp(2rem, 3.4vw, 3.25rem)',
          letterSpacing: '-0.035em',
        }}
      >
        {/* AUDITORÍA 13, MEDIO: con la consulta caída el panel servía $0.00 —
            el cero-que-se-lee-como-medición en la cifra más grande. Sin dato
            se enseña un guion (la doctrina de 'un rótulo tiene que ser
            verdad'), no un cero. */}
        {valor === undefined ? '—' : fmt(mostrado)}
      </div>
      <div
        className="text-[10px] font-semibold uppercase mt-2 whitespace-nowrap"
        style={{ color: 'var(--muted)', letterSpacing: '0.14em' }}
      >
        {etiqueta}
      </div>
      {nota && (
        <div className="text-[11px] mt-1 whitespace-nowrap" style={{ color: 'var(--faint)' }}>
          {nota}
        </div>
      )}
    </div>
  );
}
