import { requireSuperadmin } from '@/lib/auth/guard';
import { redirigirPermanente, type ParametrosDeBusqueda } from '@/lib/admin/redirigir-permanente';

export const dynamic = 'force-dynamic';

/**
 * Conocimiento / RAG (retirado en la Fase 1): declaraba que Likida no usa RAG; no había nada que conservar. Cae en el Resumen.
 * Redirección PERMANENTE (308) con la consulta conservada; el registro vive en `guardas/redirecciones_308.ts`. La puerta propia va
 * primero: el layout puede no ejecutarse en una petición RSC parcial (A37-S05-01), y un 308 sin sesión no debe revelar nada.
 */
export default async function ConocimientoRagRetirado({ searchParams }: { searchParams: Promise<ParametrosDeBusqueda> }) {
  await requireSuperadmin();
  redirigirPermanente('/admin', await searchParams);
}
