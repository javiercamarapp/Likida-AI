'use client';

import Link from 'next/link';
import { PanelLeftClose } from 'lucide-react';
import type { PerfilTenant } from '@/lib/auth/visibilidad';
import LogoV2 from './logo-v2';
import { ArbolMenu, PieMenu, useMenuV2 } from './navegacion-v2';
import { useRiel } from './colapso';

/**
 * El sidebar de escritorio v2: tarjeta FLOTANTE de 232 px (riel de 72 px: plegado por el usuario y por defecto entre 768 y 1023).
 * Marca arriba (logo de 30 px de alto + botón de plegar 32×32), árbol que scrollea por dentro y pie fijo (≤150 px) con
 * Notificaciones, Puesta en marcha (<6/6), tema segmentado y la tarjeta de cuenta. Bajo 768 px NO se ve (`display: none` en
 * `shell.css`, así que sale también del árbol de accesibilidad): ahí manda la cabecera móvil con su hoja «Más».
 *
 * Conserva el contrato de siempre: `<aside>` con `<nav>` y `<a href>` reales.
 */
export default function SidebarV2({ rol, rolEtiqueta, nombre, perfil, usoIa, cerrarSesion, insignias }: {
  rol: string; rolEtiqueta: string; nombre: string | null; perfil?: PerfilTenant | null; usoIa?: { pct: number } | null;
  cerrarSesion?: () => Promise<void>; insignias?: Record<string, string>;
}) {
  const { pathname, sufijo, menu } = useMenuV2(rol, perfil);
  const { riel, alternar } = useRiel();
  // El logo lleva a la «casa» del rol (su primer ítem), no a un `/dashboard` que el rol podría no abrir (el contador, bajo el perfil).
  const casa = menu.resumen[0]?.href ?? menu.grupos[0]?.items[0]?.href ?? '/dashboard';
  return (
    <aside className="rv-sb" data-riel={riel ? '' : undefined}>
      <div className="rv-sb__marca">
        <Link href={`${casa}${sufijo}`} className="rv-sb__logo" aria-label="Likida, ir al inicio">
          {/* Una sola marca visible a la vez: horizontal (30 de alto) con el sidebar completo, símbolo (28) en el riel. */}
          <LogoV2 alto={30} className="rv-logo-h" />
          <LogoV2 alto={28} variante="simbolo" className="rv-logo-s" />
        </Link>
        <button type="button" className="rv-icono-boton rv-sb__plegar" onClick={alternar} aria-label="Plegar el menú" title="Plegar el menú" aria-expanded={!riel}>
          <PanelLeftClose width={16} height={16} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      <nav aria-label="Navegación principal" className="rv-sb__nav">
        <ArbolMenu menu={menu} sufijo={sufijo} pathname={pathname} perfil={perfil} insignias={insignias} />
      </nav>
      <div className="rv-sb__pie">
        <PieMenu menu={menu} sufijo={sufijo} pathname={pathname} perfil={perfil} rol={rol} rolEtiqueta={rolEtiqueta} nombre={nombre}
          usoIa={usoIa} cerrarSesion={cerrarSesion} insignias={insignias} />
      </div>
    </aside>
  );
}
