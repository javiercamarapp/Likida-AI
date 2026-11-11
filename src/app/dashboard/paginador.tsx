import { ChevronLeft, ChevronRight } from 'lucide-react';
import { BotonEnlace, Icono } from '@/app/ui-v2/componentes';

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


export function EnlacePagina({ href, direccion, etiqueta }: {
  href: string;
  direccion: 'anterior' | 'siguiente' | 'inicio';
  /** Solo cuando el rótulo estándar no sirve (p. ej. «Volver al inicio», «Ir a la última página (3)»). */
  etiqueta?: string;
}) {
  const texto = etiqueta ?? (direccion === 'siguiente' ? 'Siguiente' : direccion === 'inicio' ? 'Volver al inicio' : 'Anterior');
  return (
    <BotonEnlace
      href={href} rel={direccion === 'siguiente' ? 'next' : direccion === 'anterior' ? 'prev' : undefined} tamano="sm"
      icono={direccion !== 'siguiente' ? <Icono icono={ChevronLeft} tam={14} /> : undefined}
    >
      {texto}
      {direccion === 'siguiente' && <Icono icono={ChevronRight} tam={14} />}
    </BotonEnlace>
  );
}

/** El contenedor: se pinta solo si hay algún enlace que mostrar. */
export function NavPaginas({ children }: { children: React.ReactNode }) {
  return <nav aria-label="Paginación" className="flex flex-wrap items-center gap-1.5">{children}</nav>;
}
