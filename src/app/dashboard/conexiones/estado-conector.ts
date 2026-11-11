import type { Conector } from '@/lib/likida/conexiones';
import type { TonoEstado } from '@/app/ui-v2/componentes';
import type { TResto } from '@/lib/i18n/resto_tr';

/**
 * Rótulo y tono de cada estado MEDIDO del conector. Vive aparte de
 * `conectores-detalle.tsx` (que es 'use client'): la vista del servidor lo
 * llama, y una función exportada por un módulo de cliente no se puede invocar
 * desde el servidor (React #441, «No se pudo cargar el panel»).
 */
export const estadoConector = (t: TResto): Record<Conector['estado'], { rotulo: string; tono: TonoEstado }> => ({
  listo: { rotulo: t('cfg.listo'), tono: 'ok' },
  incompleto: { rotulo: t('cfg.incompleto'), tono: 'warn' },
  sin_configurar: { rotulo: t('cfg.sin_conectar'), tono: 'muted' },
  no_medible: { rotulo: t('cfg.no_se_pudo_medir'), tono: 'warn' },
  ensayo: { rotulo: t('cfg.en_ensayo'), tono: 'info' },
});
