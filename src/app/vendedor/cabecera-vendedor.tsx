import { LogOut } from 'lucide-react';
import { getT } from '@/lib/i18n/servidor';
import LogoV2 from '../dashboard/shell/logo-v2';
import { ConmutadorTema } from '../ui-v2/componentes/pie-sidebar';
import { Chip } from '../ui-v2/componentes';
import { TRAZO_ICONO } from '../ui-v2/componentes/icono';
import './vendedor.css';

/**
 * La cabecera de /vendedor sobre el sistema nuevo: logo, quién eres, tema y salir. UNA sola pantalla, así que sin sidebar (un menú
 * anunciaría secciones que no existen). Escritorio: la topbar de 44 px (`.rv-cab-esc`); bajo 768 px: la cabecera móvil de 56
 * (`.rv-cab-movil`). El texto sale del diccionario `shell` (es/en); el formulario de salir lo arma el layout (server action).
 */
export default async function CabeceraVendedor({ nombre, esSoporte, salir, movil }: {
  nombre: string | null;
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
      <LogoV2 alto={20} />
      <Chip>{t('vendedor.rotulo')}</Chip>
      {esSoporte ? <Chip tono="warn">{t('vendedor.soporte')}</Chip> : null}
      <div className="rv-cab-esc__der vnd-acciones">
        <span className="vnd-nombre">{nombre ?? ''}</span>
        <ConmutadorTema />
        {boton}
      </div>
    </header>
  );
}
