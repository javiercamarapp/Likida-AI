'use client';

import { useCountUp } from '../admin/ui/use-count-up';
import { usePrefersReducedMotion } from '../admin/ui/prefers-reduced-motion';
import { useInView } from '../admin/ui/use-in-view';
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
 * La animación es un count-up con ease-out que arranca cuando la cifra
 * entra en pantalla, más un fundido de entrada — se respeta
 * `prefers-reduced-motion`, que entonces la pinta final de una vez.
 */
export default function CifraGrande({
  valor, etiqueta, formato = 'mxn', nota,
}: {
  valor: number;
  etiqueta: string;
  formato?: FormatoPreset;
  /** Segunda línea opcional, aún más discreta (la ventana de tiempo, la base legal). */
  nota?: string;
}) {
  const [ref, enVista] = useInView<HTMLDivElement>();
  const reducido = usePrefersReducedMotion();
  const animar = enVista && !reducido;
  const mostrado = useCountUp(valor, animar);
  const fmt = resolverFormato(formato);

  return (
    <div ref={ref} className="shrink-0 text-right">
      <div
        className="tabular leading-none"
        style={{
          fontFamily: 'var(--font-display), var(--font-sans)',
          fontWeight: 600,
          fontSize: 'clamp(2rem, 3.4vw, 3.25rem)',
          letterSpacing: '-0.035em',
          // Fundido + subida corta al entrar. `reducido` lo deja quieto.
          opacity: enVista || reducido ? 1 : 0,
          transform: enVista || reducido ? 'none' : 'translateY(6px)',
          transition: reducido ? undefined : 'opacity 520ms ease, transform 520ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {fmt(mostrado)}
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
