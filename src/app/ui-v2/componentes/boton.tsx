import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from './clases';

// ═══════════════════════════════════════════════════════════════════════════
// BOTÓN v2. Renderiza <button>/<a> REALES con el mismo texto y la misma
// semántica que hoy (los e2e los encuentran por rol y nombre accesible).
//
// COMPATIBILIDAD v1: sin [data-ui="v2"] pinta igual que el botón de siempre
// (las clases de BTN_PRIMARIO / BTN_SECUNDARIO de dashboard/[id]/vista.tsx
// viven aquí); la forma v2 llega solo por CSS (`componentes.css`).
// ═══════════════════════════════════════════════════════════════════════════

// `danger` (peligro) y `danger-soft` se pintan igual en v2 (rojo suave); `danger-soft` es el nombre histórico.
export type VarianteBoton = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-soft';
export type TamanoBoton = 'md' | 'sm';

const BASE_V1 = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12.5px] font-medium';
const V1: Record<VarianteBoton, string> = {
  primary: `${BASE_V1} bg-[var(--marca)] text-[var(--marca-fg)] transition-opacity hover:opacity-85 disabled:opacity-50`,
  secondary: `${BASE_V1} bg-[var(--surface)] text-[var(--ink)] hairline transition-colors hover:bg-[var(--canvas)] disabled:opacity-50 disabled:cursor-not-allowed`,
  ghost: `${BASE_V1} bg-transparent text-[var(--ink)] transition-colors hover:bg-[var(--canvas)] disabled:opacity-50 disabled:cursor-not-allowed`,
  danger: `${BASE_V1} bg-[var(--badbg)] text-[var(--bad)] transition-opacity hover:opacity-85 disabled:opacity-50`,
  'danger-soft': `${BASE_V1} bg-[var(--badbg)] text-[var(--bad)] transition-opacity hover:opacity-85 disabled:opacity-50`,
};

export function clasesBoton(variante: VarianteBoton, tamano: TamanoBoton = 'md', extra?: string): string {
  return cx('rv-btn', `rv-btn--${variante}`, tamano === 'sm' && 'rv-btn--sm', V1[variante], extra);
}

interface Comun {
  variante?: VarianteBoton;
  tamano?: TamanoBoton;
  icono?: ReactNode;
  children: ReactNode;
}

function Spinner() {
  return <span className="rv-btn__spinner" aria-hidden="true" />;
}

export function Boton({
  variante = 'secondary', tamano = 'md', icono, loading = false, className, children, disabled, type = 'button', ...resto
}: Comun & { loading?: boolean; ref?: Ref<HTMLButtonElement> } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      {...resto}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clasesBoton(variante, tamano, className)}
    >
      {loading ? <Spinner /> : icono}
      {children}
    </button>
  );
}

export function BotonEnlace({
  variante = 'secondary', tamano = 'md', icono, href, deshabilitado = false, className, children, ...resto
}: Comun & { href: string; deshabilitado?: boolean } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const clases = clasesBoton(variante, tamano, className);
  if (deshabilitado) {
    // Un enlace deshabilitado no lleva href: no navega ni entra en el orden de Tab.
    return (
      <a role="link" aria-disabled="true" className={clases} {...resto}>
        {icono}
        {children}
      </a>
    );
  }
  const interno = href.startsWith('/');
  return interno ? (
    <Link href={href} className={clases} {...resto}>
      {icono}
      {children}
    </Link>
  ) : (
    <a href={href} className={clases} {...resto}>
      {icono}
      {children}
    </a>
  );
}
