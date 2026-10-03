import { manejarCompletar } from '@/lib/likida/autofactura/vinculacion_http';
import { crearDepsVinculacion } from '@/lib/likida/autofactura/vinculacion_remota_repo';

export const dynamic = 'force-dynamic';

/** Sube la sesión ya iniciada (o avisa del fallo). Ver `vinculacion_http.ts`. */
export async function POST(req: Request) {
  return manejarCompletar(req, crearDepsVinculacion());
}
