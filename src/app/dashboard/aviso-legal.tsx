import Link from 'next/link';
import type { SessionTenant } from '@/lib/auth/session';
import { aceptacionesDeFlota, pendientesDeUsuario } from '@/lib/legal/aceptacion';

/**
 * El aviso NO bloqueante del layout: si el dueño todavía no aceptó la versión
 * vigente de los Términos o del Aviso (0443), se le invita a hacerlo en
 * /dashboard/legal. Es una franja, no una compuerta: una base que no contesta o
 * un rol que no es dueño NO deben dejar a nadie fuera del panel, así que ante
 * cualquier duda no se pinta nada.
 */
export async function AvisoLegalPendiente({ sesion }: { sesion: Pick<SessionTenant, 'rol' | 'tenantId' | 'userId'> }) {
  if (sesion.rol !== 'flota_admin' || !sesion.tenantId) return null;
  try {
    const filas = await aceptacionesDeFlota(sesion.tenantId);
    if (pendientesDeUsuario(filas, sesion.userId).length === 0) return null;
  } catch {
    return null;
  }
  return (
    <div role="note" className="mb-3 rounded-lg px-3 py-2 text-[12.5px]" style={{ border: '1px solid var(--line)', color: 'var(--muted)' }}>
      Falta registrar tu aceptación de los Términos y del Aviso de privacidad vigentes.{' '}
      <Link href="/dashboard/legal" className="underline font-medium">Revisar y aceptar</Link>
    </div>
  );
}
