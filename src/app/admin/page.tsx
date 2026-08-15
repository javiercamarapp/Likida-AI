import { requireSuperadmin } from '@/lib/auth/guard';
import { ConsolaAdmin } from './consola';

export const dynamic = 'force-dynamic';

/**
 * Inicio de /admin — SOLO el gateo. El contenido real vive en `consola.tsx`
 * (`ConsolaAdmin`), exportado, por la misma convención que los inicios de
 * /dashboard (`inicio-contenido.tsx`, razón #2 de su comentario): sin export
 * no se puede montar el componente REAL en un preview headless sin sesión, y
 * "verificar mirando" es regla del repo — una copia verificaría la copia.
 *
 * El `requireSuperadmin()` que gatea de verdad ya lo hizo admin/layout.tsx;
 * aquí se vuelve a llamar solo para el nombre del saludo.
 */
export default async function Admin({
  searchParams,
}: { searchParams: Promise<{ rango?: string }> }) {
  const [{ nombre }, sp] = await Promise.all([requireSuperadmin(), searchParams]);
  return <ConsolaAdmin nombre={nombre ?? null} sp={sp} />;
}
