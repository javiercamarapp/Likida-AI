import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';

export const MAX_POLITICA_BYTES = 8 * 1024 * 1024;
const TIPOS = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

export function aceptaPolitica(archivo: { size: number; type: string }): string | null {
  if (archivo.size <= 0) return 'El archivo está vacío.';
  if (archivo.size > MAX_POLITICA_BYTES) return 'El archivo pesa más de 8 MB.';
  if (!TIPOS.has(archivo.type)) return 'Sube un PDF o una imagen (JPEG o PNG).';
  return null;
}

/**
 * Sube el PDF/imagen de la política de la flota. Vive en el bucket
 * `comprobantes` (privado, solo service-role) bajo `perfil/{tenant}/`,
 * no junto a los tickets: el CFF art. 30 cubre comprobantes fiscales,
 * no este papel. Si el bucket no existe, el upload truena — no se
 * inventa que quedó guardado.
 */
export async function subirPoliticaPerfil(tenantId: string, archivo: File): Promise<{
  path: string; nombre: string; contentType: string;
}> {
  const rechazo = aceptaPolitica(archivo);
  if (rechazo) throw new Error(rechazo);
  const tipo = archivo.type;
  const ext = tipo === 'application/pdf' ? 'pdf' : tipo === 'image/png' ? 'png' : tipo === 'image/webp' ? 'webp' : 'jpg';
  const path = `perfil/${tenantId}/politica-${crypto.randomUUID()}.${ext}`;
  const buf = Buffer.from(await archivo.arrayBuffer());
  const { error } = await acotada(
    supabaseAdmin().storage.from('comprobantes').upload(path, buf, { contentType: tipo, upsert: false }),
    'subirPoliticaPerfil',
  ) as { error: { message: string } | null };
  if (error) throw new Error(`No se pudo guardar el documento: ${error.message}`);
  const nombre = archivo.name.replace(/[/\\]/g, '').slice(0, 180) || `politica.${ext}`;
  return { path, nombre, contentType: tipo };
}
