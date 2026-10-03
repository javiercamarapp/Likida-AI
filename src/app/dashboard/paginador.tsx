import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// LOS ENLACES DE PÁGINA — UNO (W2 «producto», 1-oct-2026).
//
// Siete pantallas pintaban su propio «← Anterior / Siguientes →» con tres estilos
// y cuatro rótulos distintos («Siguientes», «Siguiente →», «Anteriores», «← Anterior»).
// Aquí viven, una vez: el MISMO botón (pastilla con hairline, 32 px de alto) y los
// MISMOS rótulos. El registro con búsqueda y «Página N de M» sigue siendo
// `FiltroRegistro` (offset); estos son los enlaces de las paginaciones por cursor y
// por página de las demás listas.
//
// Accesibilidad: el contenedor es `<nav aria-label="Paginación">` y cada enlace
// lleva `rel="prev" | "next"`; el ícono es decorativo y el rótulo dice la dirección.
// ═══════════════════════════════════════════════════════════════════════════

const BOTON = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12.5px] font-medium hairline transition-colors hover:bg-[var(--canvas)] focus-visible:outline-2 focus-visible:outline-offset-2';

export function EnlacePagina({ href, direccion, etiqueta }: {
  href: string;
  direccion: 'anterior' | 'siguiente' | 'inicio';
  /** Solo cuando el rótulo estándar no sirve (p. ej. «Volver al inicio», «Ir a la última página (3)»). */
  etiqueta?: string;
}) {
  const texto = etiqueta ?? (direccion === 'siguiente' ? 'Siguiente' : direccion === 'inicio' ? 'Volver al inicio' : 'Anterior');
  return (
    <Link href={href} rel={direccion === 'siguiente' ? 'next' : direccion === 'anterior' ? 'prev' : undefined}
      className={BOTON} style={{ background: 'var(--surface)', outlineColor: 'var(--marca)' }}>
      {direccion !== 'siguiente' && <ChevronLeft aria-hidden width={13} height={13} strokeWidth={1.75} />}
      {texto}
      {direccion === 'siguiente' && <ChevronRight aria-hidden width={13} height={13} strokeWidth={1.75} />}
    </Link>
  );
}

/** El contenedor: se pinta solo si hay algún enlace que mostrar. */
export function NavPaginas({ children }: { children: React.ReactNode }) {
  return <nav aria-label="Paginación" className="flex flex-wrap items-center gap-1.5">{children}</nav>;
}
