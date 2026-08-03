import Link from 'next/link';
import { TODAS_LAS_RUTAS } from './rutas';

/**
 * Variante icon-only del sidebar — se ve SOLO entre `md` y `lg` (§G del
 * complemento de diseño: "Sidebar colapsa a íconos (72px) en pantallas
 * medianas"). Es responsive por CSS (`hidden lg:block` en la versión con
 * texto de `sidebar-nav.tsx`, `lg:hidden` en esta), no un toggle manual:
 * a este ancho no cabe el acordeón de 6 secciones con texto, así que aquí
 * es una lista plana de las 27 rutas con tooltip nativo (`title`) en vez
 * de acordeón — server component, sin estado, la misma `TODAS_LAS_RUTAS`
 * que ya arma `command-palette.tsx`, ninguna copia nueva de la nav. */
export default function SidebarNavIconos() {
  return (
    <div className="flex flex-col items-center gap-1">
      {TODAS_LAS_RUTAS.map(({ href, nombre, Icono }) => (
        <Link key={href} href={href} title={nombre}
          className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-[color-mix(in_srgb,var(--muted)_10%,transparent)] transition-colors shrink-0">
          <Icono width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
        </Link>
      ))}
    </div>
  );
}
