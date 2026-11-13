import { logger } from '@/lib/logger';
import type { Canal } from './canal';

/**
 * La línea de WhatsApp por la que sale el aviso de este tenant. Sin `tenantId`, o sin línea propia (`origen:
 * 'plataforma'`), devuelve `{ canal: undefined }` y los envíos se llaman EXACTAMENTE como antes (entorno global).
 * Con línea propia devuelve su canal. Si la línea existe pero no puede usarse (pausada, token vencido) o no se pudo
 * leer, falla CERRADO: nunca cae a la línea de plataforma. El módulo del canal se importa solo cuando hay tenant
 * (un solo `await import`), así el camino sin tenant no toca la base.
 */
export async function canalDeEnvio(tenantId: string | null | undefined): Promise<{ canal?: Canal } | { error: string }> {
  if (!tenantId) return { canal: undefined };
  try {
    const { resolverCanal } = await import('./canal');
    const c = await resolverCanal(tenantId);
    return c.origen === 'tenant' ? { canal: c } : { canal: undefined };
  } catch (e) {
    const motivo = (e as { motivo?: string } | null)?.motivo;
    if (motivo) {
      logger.warn('wa.canal_no_disponible', { tenantId, motivo });
      return { error: motivo === 'pausada' ? 'La línea de WhatsApp de esta cuenta está pausada: no se envió el mensaje.' : 'El token de la línea de WhatsApp de esta cuenta no sirve (vencido o ausente): no se envió el mensaje.' };
    }
    logger.error('wa.canal_no_resuelto', { tenantId, error: e instanceof Error ? e.message : String(e) });
    return { error: 'No se pudo determinar la línea de WhatsApp de esta cuenta: no se envió el mensaje.' };
  }
}
