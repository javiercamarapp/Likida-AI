'use client';

import { useMemo, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ProveedorAreaV2 } from '../ui-v2/componentes/contexto-area';
import { ProveedorPestanasHub, type ValorPestanasHub } from '../ui-v2/componentes/pestanas-hub';
import { SECCIONES, entradaDeRuta, pestanaActiva } from './rutas';
import type { ConteosPestanas } from './conteos-pestanas';
import { useConteosPestanas } from './conteos-pestanas-contexto';
import { shell as shellEs } from '@/lib/i18n/es/shell';
import { useT } from '@/lib/i18n/proveedor';
import { etiquetaNav, type TraductorNav } from '@/lib/i18n/nav';

/**
 * El marco de contexto de /admin: según la ruta abierta ofrece (1) el ÁREA del menú (la etiqueta sobre el título, tomada de
 * `SECCIONES`: la misma que pinta el sidebar) y (2) las PESTAÑAS del grupo al que pertenece la pantalla (`rutas.ts`).
 *
 * La barra la pinta `MarcoPagina` bajo el encabezado (`PestanasHub`). Mientras una pantalla no esté migrada a `MarcoPagina`, el
 * proveedor pinta la misma barra como respaldo sobre el contenido (y la oculta en cuanto la pantalla trae su `MarcoPagina`), así
 * el menú de 16 entradas no pierde ninguna pantalla en el camino. Cada pestaña es una ruta hermana con su propia dirección. Un
 * grupo de una sola página no pinta barra.
 */
export function pestanasDeRuta(pathname: string, conteos?: ConteosPestanas, tr?: TraductorNav): ValorPestanasHub | null {
  const entrada = entradaDeRuta(pathname);
  if (!entrada || !entrada.pestanas || entrada.pestanas.length < 2) return null;
  const actual = pestanaActiva(entrada, pathname);
  return {
    etiqueta: `Secciones de ${entrada.nombre}`,
    actual: actual?.href ?? entrada.pestanas[0].href,
    // Los conteos vivos se mezclan sobre el árbol estático; sin dato para una pestaña, no se pinta número (nunca un 0 inventado).
    // El nombre de cada pestaña sale en el idioma activo (el mismo catálogo `nav.n.*` que el menú lateral); sin traductor, en español.
    pestanas: entrada.pestanas
      .map((p) => (tr ? { ...p, nombre: etiquetaNav(tr, p.nombre) } : p))
      .map((p) => (conteos && conteos[p.href] ? { ...p, ...conteos[p.href] } : p)),
  };
}

/** El área del menú (título de la sección) a la que pertenece la ruta; `null` fuera del menú (Inicio, Mi perfil…). */
export function areaDeRutaAdmin(pathname: string): string | null {
  const entrada = entradaDeRuta(pathname);
  if (!entrada) return null;
  return SECCIONES.find((s) => s.items.includes(entrada))?.titulo ?? null;
}

export default function ProveedorMarcoAdmin({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const conteos = useConteosPestanas();
  const tr = useT('shell', shellEs);
  const valor = useMemo(() => pestanasDeRuta(pathname, conteos, tr), [pathname, conteos, tr]);
  const area = areaDeRutaAdmin(pathname);
  return (
    <ProveedorAreaV2 value={area === null ? null : etiquetaNav(tr, area)}>
      <ProveedorPestanasHub valor={valor} claseRespaldo="adm-pestanas">{children}</ProveedorPestanasHub>
    </ProveedorAreaV2>
  );
}
