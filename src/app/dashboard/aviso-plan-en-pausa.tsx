import { veredictoSalidasDeFlota } from '@/lib/saas/salidas_flota';

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
  return (
    <div role="status" data-aviso="plan-frena-salidas" className="mb-3 rounded-lg px-3 py-2 text-[12px]" style={{ border: '1px solid var(--line)', color: 'var(--muted)' }}>
      <strong>{v.mensaje}.</strong>{' '}
      {v.estado === 'ilegible'
        ? 'Los datos y los comprobantes siguen entrando; las salidas se reanudan al confirmar el plan.'
        : 'Los datos y los comprobantes siguen entrando; no sale ningún mensaje ni correo automático hasta reactivar el plan.'}
    </div>
  );
}
