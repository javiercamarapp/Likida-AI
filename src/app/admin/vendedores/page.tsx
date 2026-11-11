import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { ConsolaVendedores } from './consola-vendedores';
import { getT } from '@/lib/i18n/servidor';

export const dynamic = 'force-dynamic';

/**
 * /admin/vendedores — SOLO el gate y el desempaque de searchParams. El
 * contenido completo vive en `consola-vendedores.tsx` (exportado) por la
 * razón #2 de `dashboard/inicio-contenido.tsx`: la página llama
 * `requireSuperadmin()` y el preview headless sin sesión no puede montarla —
 * el componente extraído sí, y es el REAL (una copia verificaría la copia).
 *
 * El gate está DOBLE a propósito: admin/layout.tsx ya lo hace por todo
 * /admin, y aquí se repite porque esta página no debe depender de que el
 * layout siga haciéndolo. Cada server action de la consola re-gatea por su
 * cuenta, así que extraer el contenido no regaló ninguna escritura.
 */
export default async function VendedoresPage({
  searchParams,
}: {
  searchParams: Promise<{ vendedor?: string; q?: string }>;
}) {
  const [{ nombre }, sp] = await Promise.all([requireSuperadmin(), searchParams]);
  const { t } = await getT('admin_sistema');
  return <ConsolaVendedores nombre={nombre} sp={sp} tx={t} />;
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_sistema');
  return { title: t('vendedores.vendedores') };
}
