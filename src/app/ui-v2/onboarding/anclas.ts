// Anclas del recorrido. El atributo canónico es `data-onboarding`; el motor también reconoce `data-tour` (las anclas de antes
// y las del menú: `nav-<ruta>`). Las DERIVADAS no son un atributo: apuntan a una estructura que toda pantalla comparte.
export const ATRIBUTOS_ANCLA = ['data-onboarding', 'data-tour'] as const;

/** Nombre → selector CSS. `pantalla.titulo` también existe como atributo (EncabezadoPagina); `primer-bloque` es lo que sigue al encabezado. */
export const ANCLAS_DERIVADAS: Readonly<Record<string, string>> = {
  'pantalla.primer-bloque': 'main.rv-marco > header.rv-encabezado ~ :not(script):not(style)',
};

/** Atributo estable para marcar un elemento: `<div {...anclaOnboarding('viajes.tabla')}>`. Aditivo: no cambia clases ni ids. */
export const anclaOnboarding = (nombre: string) => ({ 'data-onboarding': nombre }) as const;

/** `/dashboard/agentes/peajes` → `nav-agentes-peajes` (el mismo cálculo que el menú: `anclaDe`). */
export function anclaNav(href: string): string {
  return `nav-${href.replace(/^\/dashboard\/?/, '').replace(/\//g, '-') || 'resumen'}`;
}

export const slugDe = (href: string): string => href.replace(/^\/dashboard\/?/, '').replace(/\//g, '-') || 'resumen';
