import { requireSuperadmin } from '@/lib/auth/guard';
import { redirigirPermanente, type ParametrosDeBusqueda } from '@/lib/admin/redirigir-permanente';

export const dynamic = 'force-dynamic';

/**
 * Ejecutivo / Board (retirado en la Fase 2 del plan maestro del admin): el Resumen conserva lo que enseñaba (MRR contra la meta, `esSoloDemo`,
 * facturas procesadas total y por día, costo de IA); la prueba `resumen_conserva_cifras.test.ts` lo fija.
 * Redirección PERMANENTE (308) con la consulta conservada; el registro vive en `guardas/redirecciones_308.ts`. La puerta propia va primero:
 * el layout puede no ejecutarse en una petición RSC parcial (A37-S05-01), y un 308 sin sesión no debe revelar nada.
 */
export default async function EjecutivoRetirado({ searchParams }: { searchParams: Promise<ParametrosDeBusqueda> }) {
  await requireSuperadmin();
  redirigirPermanente('/admin', await searchParams);
}
