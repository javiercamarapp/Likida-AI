'use client';

import Link from 'next/link';
import { ChevronsLeft, Users } from 'lucide-react';
import LogoV2 from '../dashboard/shell/logo-v2';
import { ALTO_LOGO_PX } from '../marco-v2';
import { useRiel } from '../dashboard/shell/colapso';
import { Tooltip } from '../ui-v2/componentes/overlay';
import { ConmutadorIdioma, ConmutadorTema, TarjetaUsuario, inicialesDe } from '../ui-v2/componentes/pie-sidebar';
import { TRAZO_ICONO } from '../ui-v2/componentes/icono';
import { shell as shellEs } from '@/lib/i18n/es/shell';
import { useT } from '@/lib/i18n/proveedor';

/**
 * El sidebar de /vendedor: el MISMO caparazón de Rovaq que /dashboard y /admin (tarjeta flotante de 232 px, riel de 72 al plegar, marca con el
 * botón de plegar, un ítem activo y el pie con tema, idioma y la tarjeta de usuario), con las clases `rv-*` de `ui-v2/shell.css`.
 * Decisión 11 del dueño: todo rol trabaja dentro del mismo esqueleto. Tiene UN solo ítem porque el vendedor tiene una sola pantalla; el
 * ítem existe (activo) y no anuncia secciones que no hay. Bajo 768 px no se ve (manda `CabeceraVendedor movil`).
 */
export default function SidebarVendedor({ nombre, rolEtiqueta, avatarUrl, salir }: {
  nombre: string | null;
  rolEtiqueta: string;
  avatarUrl?: string | null;
  /** El `<form>` de salir ya armado por el servidor (clase `rv-cuenta__salir`). */
  salir?: React.ReactNode;
}) {
  const { riel, alternar } = useRiel();
  const { t } = useT('shell', shellEs);
  return (
    <aside className="rv-sb" data-riel={riel ? '' : undefined}>
      <div className="rv-sb__marca">
        <Link href="/vendedor" className="rv-sb__logo" aria-label={t('marca.irInicio')}>
          <span className="rv-logo-h"><LogoV2 alto={ALTO_LOGO_PX.sidebar} /></span>
          <span className="rv-logo-s"><LogoV2 alto={ALTO_LOGO_PX.riel} variante="simbolo" /></span>
        </Link>
        <Tooltip texto={riel ? t('cab.expandir') : t('cab.plegar')}>
          <button type="button" className="rv-icono-boton rv-sb__plegar" onClick={alternar} aria-label={riel ? t('cab.expandir') : t('cab.plegar')} aria-expanded={!riel}>
            <ChevronsLeft className="rv-chev-plegar" width={16} height={16} strokeWidth={TRAZO_ICONO} aria-hidden />
          </button>
        </Tooltip>
      </div>
      <nav aria-label={t('nav.principal')} className="rv-sb__nav">
        <ul className="rv-lista">
          <li>
            <Link href="/vendedor" className="rv-item" aria-current="page" title={t('vendedor.prospectos')}>
              <Users className="rv-item__ico" width={16} height={16} strokeWidth={TRAZO_ICONO} aria-hidden />
              <span className="rv-item__txt">{t('vendedor.prospectos')}</span>
            </Link>
          </li>
        </ul>
      </nav>
      <div className="rv-sb__pie">
        <div className="rv-pie rv-ps" data-pie="sidebar">
          <div className="rv-ps-toggles">
            <ConmutadorTema />
            <ConmutadorIdioma />
          </div>
          <TarjetaUsuario nombre={nombre} rolEtiqueta={rolEtiqueta} iniciales={inicialesDe(nombre)} avatarUrl={avatarUrl} href="/cuenta" salir={salir} />
        </div>
      </div>
    </aside>
  );
}
