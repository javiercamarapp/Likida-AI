'use client';

import Link from 'next/link';
import { Ellipsis } from 'lucide-react';
import type { PerfilTenant } from '@/lib/auth/visibilidad';
import { hrefActivo } from './menu-por-perfil';
import { useMenuV2 } from './navegacion-v2';
import { destinosMovil } from './barra-inferior-destinos';

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
  if (destinos.length === 0) return null;
  const activo = hrefActivo(pathname, menu);
  const activoEnBarra = destinos.some((d) => d.href === activo);
  return (
    <nav className="rv-nav-inf" aria-label="Navegación móvil">
      <ul className="rv-nav-inf__lista">
        {destinos.map((d) => {
          const esActivo = d.href === activo;
          return (
            <li key={d.href}>
              <Link href={`${d.href}${sufijo}`} className="rv-nav-inf__item" aria-current={esActivo ? 'page' : undefined} title={d.nombre}>
                <d.Icono className="rv-nav-inf__ico" width={22} height={22} strokeWidth={1.75} aria-hidden />
                <span className="rv-nav-inf__txt">{d.etiqueta}</span>
              </Link>
            </li>
          );
        })}
        <li>
          <button type="button" className="rv-nav-inf__item" aria-label="Más: abrir el menú completo" aria-haspopup="dialog" aria-expanded={masAbierta}
            data-activo={!activoEnBarra && activo ? '' : undefined} data-tour="nav-mas" onClick={alAbrirMas}>
            <Ellipsis className="rv-nav-inf__ico" width={22} height={22} strokeWidth={1.75} aria-hidden />
            <span className="rv-nav-inf__txt">Más</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
