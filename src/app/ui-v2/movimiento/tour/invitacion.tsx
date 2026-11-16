'use client';

import { Boton } from '../../componentes/boton';
import { useT } from '@/lib/i18n/proveedor';
import { onboarding as onbEs } from '@/lib/i18n/es/onboarding';

// La invitación al recorrido (primer ingreso): Vexa pregunta el modo antes de empezar. Presentacional y sin estado.
// Nunca arranca sola: el recorrido solo empieza cuando la persona elige «corto» o «completo».
export function InvitacionRecorrido({ titulo, asistente, onElegir, onAhoraNo, onNoVolver }: {
  titulo: string;
  /** Nombre del asistente que sigue (Puesta en marcha / Arranque); null si el rol no lo ve. */
  asistente: string | null;
  onElegir: (modo: 'corto' | 'completo') => void;
  onAhoraNo: () => void;
  onNoVolver: () => void;
}) {
  const { t } = useT('onboarding', onbEs);
  return (
    <section className="rv-onb-inv" role="region" aria-label={t('ui.inv.region')}>
      <div className="rv-sr" role="status">{t('ui.inv.anuncio')}</div>
      <h2>{t('ui.inv.titulo')}</h2>
      <p>
        {t('ui.inv.cuerpo', { titulo })}
        {asistente ? ` ${t('ui.inv.despues', { asistente })}` : ''} {t('ui.inv.salir')}
      </p>
      <div className="rv-onb-acciones">
        <Boton variante="ghost" onClick={onNoVolver}>{t('ui.inv.no_volver')}</Boton>
        <Boton variante="secondary" onClick={onAhoraNo}>{t('ui.inv.ahora_no')}</Boton>
        <Boton variante="secondary" onClick={() => onElegir('completo')}>{t('ui.inv.completo')}</Boton>
        <Boton variante="primary" onClick={() => onElegir('corto')} data-onb-primario>{t('ui.inv.corto')}</Boton>
      </div>
    </section>
  );
}
