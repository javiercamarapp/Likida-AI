import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { ConsolaAdmin } from './consola';

export const dynamic = 'force-dynamic';

/**
 * Inicio de /admin — SOLO el gateo. El contenido real (el Centro de Mando) vive en `consola.tsx` (`ConsolaAdmin`), exportado, por la
 * misma convención que los inicios de /dashboard: sin export no se puede montar el componente REAL en un preview headless sin sesión.
 * El `requireSuperadmin()` que gatea de verdad ya lo hizo admin/layout.tsx; aquí se vuelve a llamar para el nombre del saludo.
 */
export default async function Admin() {
  const { nombre } = await requireSuperadmin();
  return <ConsolaAdmin nombre={nombre ?? null} />;
}

export const metadata: Metadata = { title: 'Resumen' };
