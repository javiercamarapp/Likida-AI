'use client';

import Link from 'next/link';
import { Ellipsis } from 'lucide-react';
import type { PerfilTenant } from '@/lib/auth/visibilidad';
import { hrefActivo } from './menu-por-perfil';
import { useMenuV2 } from './navegacion-v2';
import { destinosMovil, type DestinoMovil } from './barra-inferior-destinos';
import { shell as shellEs } from '@/lib/i18n/es/shell';
import { useT } from '@/lib/i18n/proveedor';
import { etiquetaNav } from '@/lib/i18n/nav';
import { TRAZO_ICONO } from '../../ui-v2/componentes/icono';

/**
 * La barra inferior móvil (<768 px, ESTILO §11): píldora flotante de 64 px + área segura, hasta 4 destinos del rol y «Más», que abre
 * la hoja con el árbol completo. Misma fuente que el sidebar y la hoja (`useMenuV2`), así que respeta el rol y el perfil. Sin
 * destinos (rol sin rutas en este panel) no se pinta. Desde 768 no existe (`display: none` en `shell.css`): nunca hay dos
 * navegaciones visibles. Los destinos NO llevan `data-tour` (las anclas del recorrido son las del sidebar y la hoja: un duplicado oculto
 * rompe los localizadores `[data-tour=…]` y `a[href=…]` que toman el primero). Cada destino es un enlace real con `aria-current="page"` y toque de 44 px o más.
 */
export default function BarraInferior({ rol, perfil, masAbierta, alAbrirMas }: {
  rol: string; perfil?: PerfilTenant | null; masAbierta: boolean; alAbrirMas: () => void;
}) {
  const { pathname, sufijo, menu } = useMenuV2(rol, perfil);
  const destinos = destinosMovil(rol, menu);
  return <BarraInferiorVista destinos={destinos} sufijo={sufijo} activo={hrefActivo(pathname, menu)} masAbierta={masAbierta} alAbrirMas={alAbrirMas} />;
}

/** El dibujo de la barra, sin saber de qué panel es (lo comparten /dashboard y /admin): recibe los destinos ya resueltos y el activo. */
export function BarraInferiorVista({ destinos, sufijo, activo, masAbierta, alAbrirMas }: {
  destinos: DestinoMovil[]; sufijo: string; activo: string | null; masAbierta: boolean; alAbrirMas: () => void;
}) {
  const tr = useT('shell', shellEs);
  const { t } = tr;
  if (destinos.length === 0) return null;
  const activoEnBarra = destinos.some((d) => d.href === activo);
  return (
    <nav className="rv-nav-inf" aria-label={t('nav.movil')}>
      <ul className="rv-nav-inf__lista">
        {destinos.map((d) => {
          const esActivo = d.href === activo;
          return (
            <li key={d.href}>
              <Link href={`${d.href}${sufijo}`} className="rv-nav-inf__item" aria-current={esActivo ? 'page' : undefined}>
                <d.Icono className="rv-nav-inf__ico" width={22} height={22} strokeWidth={TRAZO_ICONO} aria-hidden />
                <span className="rv-nav-inf__txt">{etiquetaNav(tr, d.etiqueta)}</span>
              </Link>
            </li>
          );
        })}
        <li>
          <button type="button" className="rv-nav-inf__item" aria-label={t('nav.mas.abrir')} aria-haspopup="dialog" aria-expanded={masAbierta}
            data-activo={!activoEnBarra && activo ? '' : undefined} data-tour="nav-mas" onClick={alAbrirMas}>
            <Ellipsis className="rv-nav-inf__ico" width={22} height={22} strokeWidth={TRAZO_ICONO} aria-hidden />
            <span className="rv-nav-inf__txt">{t('nav.mas')}</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
