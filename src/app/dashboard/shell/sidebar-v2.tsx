'use client';

import Link from 'next/link';
import { ChevronsLeft } from 'lucide-react';
import type { PerfilTenant } from '@/lib/auth/visibilidad';
import LogoV2 from './logo-v2';
import { ALTO_LOGO_PX } from '../../marco-v2';
import { ArbolMenu, PieMenu, useMenuV2 } from './navegacion-v2';
import { useRiel } from './colapso';
import { Tooltip } from '../../ui-v2/componentes/overlay';
import { shell as shellEs } from '@/lib/i18n/es/shell';
import { useT } from '@/lib/i18n/proveedor';
import { TRAZO_ICONO } from '../../ui-v2/componentes/icono';

/**
 * El sidebar de escritorio v2: tarjeta FLOTANTE de 232 px (riel de 72 px: plegado por el usuario y por defecto entre 768 y 1023).
 * Marca arriba (logo de 22 px de alto, alineado con la barra de página + botón de plegar 32×32), árbol que scrollea por dentro y pie fijo (≤100 px) con
 * «Puesta en marcha» (<6/6) y la tarjeta de cuenta, en UN solo bloque compacto. Bajo 768 px NO se ve (`display: none` en
 * `shell.css`, así que sale también del árbol de accesibilidad): ahí manda la cabecera móvil con su hoja «Más».
 *
 * Conserva el contrato de siempre: `<aside>` con `<nav>` y `<a href>` reales.
 */
export default function SidebarV2({ rol, rolEtiqueta, nombre, perfil, usoIa, cerrarSesion, insignias, organizacion }: {
  rol: string; rolEtiqueta: string; nombre: string | null; perfil?: PerfilTenant | null; usoIa?: { pct: number } | null;
  cerrarSesion?: () => Promise<void>; insignias?: Record<string, string>;
  organizacion?: { id: string; nombre: string } | null;
}) {
  const { pathname, sufijo, menu } = useMenuV2(rol, perfil);
  const { riel, alternar } = useRiel();
  const { t } = useT('shell', shellEs);
  // El logo lleva a la «casa» del rol (su primer ítem), no a un `/dashboard` que el rol podría no abrir (el contador, bajo el perfil).
  const casa = menu.resumen[0]?.href ?? menu.grupos[0]?.items[0]?.href ?? '/dashboard';
  return (
    <aside className="rv-sb" data-riel={riel ? '' : undefined}>
      <div className="rv-sb__marca">
        <Link href={`${casa}${sufijo}`} className="rv-sb__logo" aria-label={t('marca.irInicio')}>
          {/* Una sola marca visible a la vez: horizontal con el sidebar completo, símbolo en el riel (alturas en `ALTO_LOGO_PX`). */}
          <span className="rv-logo-h"><LogoV2 alto={ALTO_LOGO_PX.sidebar} /></span>
          <span className="rv-logo-s"><LogoV2 alto={ALTO_LOGO_PX.riel} variante="simbolo" /></span>
        </Link>
        <Tooltip texto={t('cab.plegar')}>
          <button type="button" className="rv-icono-boton rv-sb__plegar" onClick={alternar} aria-label={t('cab.plegar')} aria-expanded={!riel}>
            <ChevronsLeft className="rv-chev-plegar" width={16} height={16} strokeWidth={TRAZO_ICONO} aria-hidden />
          </button>
        </Tooltip>
      </div>
      <nav aria-label={t('nav.principal')} className="rv-sb__nav">
        <ArbolMenu menu={menu} sufijo={sufijo} pathname={pathname} perfil={perfil} insignias={insignias} />
      </nav>
      <div className="rv-sb__pie">
        <PieMenu menu={menu} sufijo={sufijo} pathname={pathname} perfil={perfil} rol={rol} rolEtiqueta={rolEtiqueta} nombre={nombre}
          usoIa={usoIa} cerrarSesion={cerrarSesion} insignias={insignias} organizacion={organizacion} />
      </div>
    </aside>
  );
}
