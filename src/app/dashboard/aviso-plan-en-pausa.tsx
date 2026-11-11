import { veredictoSalidasDeFlota } from '@/lib/saas/salidas_flota';
import { getT } from '@/lib/i18n/servidor';
import './aviso-plan-en-pausa.css';

/**
 * F20: la franja que dice la verdad cuando el plan de la flota frena las salidas. Se pinta en el dashboard de la flota y en su ficha
 * de /admin con el MISMO texto («Plan en pausa: los agentes no envían nada»). Solo informa: no bloquea la lectura de nadie
 * (el superadmin y la flota siguen viendo sus datos y recibiendo comprobantes). Si el plan está libre no pinta nada; si no se pudo leer,
 * lo dice (falla cerrado en las salidas, y la pantalla no lo calla).
 */
export async function AvisoPlanEnPausa({ tenantId }: { tenantId: string | null | undefined }) {
  if (!tenantId) return null;
  const v = await veredictoSalidasDeFlota(tenantId);
  if (v.salen) return null;
  const { t } = await getT('avisos');
  return (
    <div role="status" data-aviso="plan-frena-salidas" className="rv-plan-pausa">
      <strong>{v.mensaje}.</strong>{' '}
      {v.estado === 'ilegible' ? t('planPausa.ilegible') : t('planPausa.frena')}
    </div>
  );
}
