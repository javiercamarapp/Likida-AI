import { requireSuperadmin } from '@/lib/auth/guard';
import { redirigirPermanente, type ParametrosDeBusqueda } from '@/lib/admin/redirigir-permanente';

export const dynamic = 'force-dynamic';

/**
 * Playground (retirado en la Fase 1 del plan maestro del admin): no tenía función, era un aviso honesto de que el sandbox no existe. Lo que sí hay (OCR, Cuadre, WhatsApp) vive en Agentes.
 * Redirección PERMANENTE (308) con la consulta conservada; el registro vive en `guardas/redirecciones_308.ts`. La puerta propia va
 * primero: el layout puede no ejecutarse en una petición RSC parcial (A37-S05-01), y un 308 sin sesión no debe revelar nada.
 */
export default async function PlaygroundRetirado({ searchParams }: { searchParams: Promise<ParametrosDeBusqueda> }) {
  await requireSuperadmin();
  redirigirPermanente('/admin/agentes', await searchParams);
}
