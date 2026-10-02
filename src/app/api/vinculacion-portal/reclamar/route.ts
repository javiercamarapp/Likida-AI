import { manejarReclamo } from '@/lib/likida/autofactura/vinculacion_http';
import { crearDepsVinculacion } from '@/lib/likida/autofactura/vinculacion_remota_repo';

export const dynamic = 'force-dynamic';

/** Puerta del script de la máquina con pantalla: su credencial es el código de un solo uso. Ver `vinculacion_http.ts`. */
export async function POST(req: Request) {
  return manejarReclamo(req, crearDepsVinculacion());
}
