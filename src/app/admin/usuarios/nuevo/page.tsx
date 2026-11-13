import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireSuperadmin } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

/**
 * Equipo › Nuevo acceso — ya no tiene vista propia: el alta de una persona vive en la tarjeta «Invitar integrante» de Equipo (Rovaq: UN solo
 * formulario). Antes eran dos pantallas con el mismo formulario y la misma acción de servidor (`accionNuevoAcceso`, con su puerta y su
 * bitácora, que no cambian). La URL se conserva (enlaces entrantes, correos ya enviados y el botón «Agregar usuario» de la ficha) y lleva a
 * Equipo con la flota preseleccionada (`?flota=`).
 */
export default async function NuevoUsuario({ searchParams }: { searchParams?: Promise<{ flota?: string }> }) {
  await requireSuperadmin();
  const flota = (await searchParams)?.flota;
  redirect(flota ? `/admin/equipo?flota=${encodeURIComponent(flota)}` : '/admin/equipo');
}

export const metadata: Metadata = { title: 'Nuevo acceso' };
