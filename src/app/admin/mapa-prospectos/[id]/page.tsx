import { notFound } from 'next/navigation';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getDetalleProspecto } from '@/lib/admin/prospectos-mapa';
import { Detalle } from './detalle';

export const dynamic = 'force-dynamic';

/**
 * LA FICHA DE UN PROSPECTO — /admin/mapa-prospectos/[id]. Ruta real (no un
 * panel que se abre encima del mapa) para que se pueda enlazar y compartir
 * directo, y para que el botón "atrás" del navegador funcione solo.
 */
export default async function PaginaDetalleProspecto({ params }: { params: Promise<{ id: string }> }) {
  await requireSuperadmin();
  const { id } = await params;
  const p = await getDetalleProspecto(id);
  if (!p) notFound();
  return <Detalle p={p} />;
}
