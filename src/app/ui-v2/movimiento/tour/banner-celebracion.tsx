import { Boton } from '../../componentes/boton';
import { CheckDibujado } from './check-dibujado';
import { useT } from '@/lib/i18n/proveedor';
import { onboarding as onbEs } from '@/lib/i18n/es/onboarding';

// Aviso de logro al terminar una tarea o un recorrido. SIEMPRE visible y con texto (`role="status"`): la animación solo lo hace
// entrar; con «reducir movimiento» aparece quieto. Sobrio: sin confeti ni caricaturas. Se cierra con un botón de 44 px en móvil.
export function BannerCelebracion({ titulo, texto, onCerrar }: { titulo: string; texto?: string; onCerrar?: () => void }) {
  const { t } = useT('onboarding', onbEs);
  return (
    <div className="rv-onb-celebra" role="status">
      <CheckDibujado tamano={22} />
      <div className="rv-onb-celebra__cuerpo">
        <p className="rv-onb-celebra__titulo">{titulo}</p>
        {texto ? <p className="rv-onb-celebra__texto">{texto}</p> : null}
      </div>
      {onCerrar ? <Boton variante="ghost" tamano="sm" onClick={onCerrar} aria-label={t('ui.celebra.cerrar_aviso')}>{t('ui.celebra.cerrar')}</Boton> : null}
    </div>
  );
}
