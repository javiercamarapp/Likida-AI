import { LogOut, Users } from 'lucide-react';
import { getT } from '@/lib/i18n/servidor';
import LogoV2 from '../dashboard/shell/logo-v2';
import { ConmutadorTema } from '../ui-v2/componentes/pie-sidebar';
import { Chip } from '../ui-v2/componentes';
import { TRAZO_ICONO } from '../ui-v2/componentes/icono';
import './vendedor.css';

/**
 * Las cabeceras de /vendedor sobre el caparazón de Rovaq. Escritorio: la topbar de 44 px (`.rv-cab-esc`) con el título de la pantalla
 * (el logo, el tema, el idioma y salir viven en el sidebar, `sidebar-vendedor.tsx`); bajo 768 px: la cabecera móvil de 56
 * (`.rv-cab-movil`) con logo, tema y salir. El texto sale del diccionario `shell` (es/en); el formulario de salir lo arma el layout (server action).
 */
export default async function CabeceraVendedor({ esSoporte, salir, movil }: {
  esSoporte: boolean;
  /** Server action de cerrar sesión; opcional para renderizar el marco sin sesión. */
  salir?: () => Promise<void>;
  /** `true` pinta la versión móvil (cabecera pegajosa de 56). */
  movil?: boolean;
}) {
  const { t } = await getT('shell');
  const boton = salir ? (
    <form action={salir} className="vnd-salir">
      <button type="submit" className="rv-btn rv-btn--secondary rv-btn--sm" aria-label={t('pie.cuenta.salir')}>
        <LogOut width={14} height={14} strokeWidth={TRAZO_ICONO} aria-hidden />
        <span className="vnd-salir__txt">{t('vendedor.salir')}</span>
      </button>
    </form>
  ) : null;
  if (movil) {
    return (
      <header className="rv-cab-movil">
        <span className="rv-cab-movil__logo"><LogoV2 alto={22} /></span>
        <div className="rv-cab-movil__acciones vnd-acciones">
          <ConmutadorTema />
          {boton}
        </div>
      </header>
    );
  }
  return (
    <header className="rv-cab-esc">
      <div className="rv-cab-esc__izq">
        <span className="rv-cab-esc__titulo" aria-hidden>
          <Users width={15} height={15} strokeWidth={TRAZO_ICONO} aria-hidden />
          <span>{t('vendedor.prospectos')}</span>
        </span>
        <Chip>{t('vendedor.rotulo')}</Chip>
        {esSoporte ? <Chip tono="warn">{t('vendedor.soporte')}</Chip> : null}
      </div>
    </header>
  );
}
