'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireSuperadmin } from '@/lib/auth/guard';
import { fijarTechoIa, validarTechoUsd } from '@/lib/admin/techo_ia';

const RUTA = '/admin/techo-ia';

/**
 * Fija o quita el techo diario de IA de UNA flota. La puerta es la misma de toda la consola:
 * `requireSuperadmin()` (sesión, rol y MFA) corre ANTES de leer el formulario, así que un rechazo no
 * alcanza ni la validación ni la base. Un monto vacío QUITA la declaración (la flota vuelve a su plan o
 * al piso); un monto fuera de rango rebota con el motivo en la URL, jamás se recorta en silencio.
 */
export async function guardarTechoIa(fd: FormData): Promise<void> {
  const sesion = await requireSuperadmin();
  const tenantId = String(fd.get('tenantId') ?? '');
  const v = validarTechoUsd(fd.get('techoUsd'));
  if (!v.ok) redirect(`${RUTA}?error=${encodeURIComponent(v.error)}`);
  const r = await fijarTechoIa(tenantId, v.usd, { id: sesion.userId });
  if (!r.ok) redirect(`${RUTA}?error=${encodeURIComponent(r.error)}`);
  revalidatePath(RUTA);
  redirect(`${RUTA}?ok=${r.despues === null ? 'quitado' : 'fijado'}`);
}
