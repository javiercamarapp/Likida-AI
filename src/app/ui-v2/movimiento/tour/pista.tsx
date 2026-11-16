'use client';

import { Boton } from '../../componentes/boton';
import { Ilustracion } from './ilustraciones';
import { useT } from '@/lib/i18n/proveedor';
import { onboarding as onbEs } from '@/lib/i18n/es/onboarding';

// La pista contextual: una nota breve al abrir una pantalla que no está en el menú (subpantallas y detalles). Una vez por pantalla.
export function PistaContextual({ titulo, texto, ilu, desde, onEntendido, onNoVolver }: {
  titulo: string; texto: string; ilu: string; desde: string; onEntendido: () => void; onNoVolver: () => void;
}) {
  const { t } = useT('onboarding', onbEs);
  return (
    <section className="rv-onb-pista" role="region" aria-label={t('ui.pista.region', { titulo })}>
      <div className="rv-sr" role="status">{t('ui.pista.anuncio', { titulo, texto })}</div>
      <div className="rv-onb-pista__marco" aria-hidden="true"><Ilustracion nombre={ilu} /></div>
      <p className="rv-onb-pista__desde">{t('ui.pista.desde', { desde })}</p>
      <h2>{titulo}</h2>
      <p>{texto}</p>
      <div className="rv-onb-acciones">
        <Boton variante="ghost" onClick={onNoVolver}>{t('ui.inv.no_volver')}</Boton>
        <Boton variante="primary" onClick={onEntendido} data-onb-primario>{t('ui.pista.entendido')}</Boton>
      </div>
    </section>
  );
}
