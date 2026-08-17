import { redirect } from 'next/navigation';
import { requireSuperadmin } from '@/lib/auth/guard';
import { tenantDemo } from '@/lib/auth/tenant-demo';
import {
  leerSeleccionFlota, guardarSeleccionFlota, limpiarSeleccionFlota,
  anotarSeleccionEnBitacora, destinoSeguro,
} from '@/lib/auth/admin-context';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ElegirFlotaContenido, type FlotaElegible } from './contenido';

export const dynamic = 'force-dynamic';

/**
 * /admin/elegir-flota — el gateo y las acciones del selector (el dibujo vive
 * en `contenido.tsx`, convención inicio-contenido). El layout de /admin ya
 * pasó `requireSuperadmin`; las server actions lo RE-CHEQUEAN por su cuenta
 * (una action es un endpoint POST, no hereda la puerta de la página — mismo
 * patrón que mi-perfil).
 *
 * La selección se firma y viaja httpOnly (admin-context.ts), y CADA selección
 * queda en `bitacora_auditoria` — best-effort, como la firma del "ver como".
 */
export default async function ElegirFlotaPage({
  searchParams,
}: { searchParams: Promise<{ next?: string; error?: string }> }) {
  await requireSuperadmin();
  const sp = await searchParams;
  const next = destinoSeguro(sp.next);

  // La lista de flotas reales. Un error NO se enseña como lista vacía
  // (regla del repo: fallar cerrado y decirlo) — la demo sigue elegible.
  const { data, error } = await supabaseAdmin()
    .from('tenant').select('id, nombre').order('nombre');
  const demoId = tenantDemo();
  const flotas: FlotaElegible[] = (data ?? [])
    .filter((t) => t.id !== demoId)
    .map((t) => ({ id: t.id as string, nombre: (t.nombre as string) ?? t.id }));

  const seleccionActual = await leerSeleccionFlota();

  async function elegirFlota(formData: FormData) {
    'use server';
    const { userId } = await requireSuperadmin();
    const crudo = String(formData.get('flota') ?? '').trim();
    const destino = destinoSeguro(formData.get('next'));
    const esDemo = crudo === 'demo';
    const tenantId = esDemo ? tenantDemo() : crudo;
    if (!esDemo) {
      // Solo se firma una flota COMPROBADA: un id que no resuelve (o que no
      // se pudo verificar) no se convierte en cookie — fallar cerrado.
      const { data: fila, error: err } = await supabaseAdmin()
        .from('tenant').select('id').eq('id', tenantId).maybeSingle();
      if (err || !fila) redirect(`/admin/elegir-flota?next=${encodeURIComponent(destino)}&error=flota`);
    }
    const ok = await guardarSeleccionFlota(tenantId);
    if (!ok) redirect(`/admin/elegir-flota?next=${encodeURIComponent(destino)}&error=firma`);
    await anotarSeleccionEnBitacora(userId, tenantId, esDemo);
    redirect(destino);
  }

  async function quitarSeleccion() {
    'use server';
    await requireSuperadmin();
    await limpiarSeleccionFlota();
    redirect('/admin');
  }

  return (
    <ElegirFlotaContenido
      flotas={flotas}
      demoId={demoId}
      seleccionActual={seleccionActual}
      next={next}
      error={sp.error ?? null}
      errorLista={Boolean(error)}
      accionElegir={elegirFlota}
      accionQuitar={quitarSeleccion}
    />
  );
}
