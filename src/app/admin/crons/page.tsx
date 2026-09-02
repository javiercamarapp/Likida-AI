import { detalleLatidos } from '@/lib/admin/salud';
import { logger } from '@/lib/logger';
import { VistaCrons } from './vista';

export const dynamic = 'force-dynamic';

/**
 * La puerta y la consulta; el render vive en `vista.tsx` (patrón de la casa:
 * `rentabilidad/page.tsx`). `requireSuperadmin()` ya lo hizo el layout de
 * /admin para renderizar, y esta pantalla no tiene server actions que
 * re-gatear porque no dispara nada: solo mira.
 */
export default async function CronsPage() {
  // El `.catch(() => null)` de la casa: `null` significa «no se pudo leer», y
  // la vista lo DICE. Lo que no se hace es devolver una tabla vacía — una
  // tabla de renglones grises se leería como relojes tranquilos, que es la
  // manera exacta de que una base caída pase por sistema sano.
  const latidos = await detalleLatidos().catch((e: unknown) => {
    logger.error('admin.crons.sin_latidos', { err: e instanceof Error ? e.message : String(e) });
    return null;
  });

  return <VistaCrons latidos={latidos} />;
}
