import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { getKpis, getAcreditables, type DashboardKpis, type Acreditables } from '@/lib/likida/analytics';
import ChatFlota from '../chat';

export const dynamic = 'force-dynamic';

/**
 * Preguntar a la IA — LA PRIMERA página reconstruida tras el borrado del
 * 10-ago-2026, pedida explícita el 12-ago: "cuando le aprietes a preguntarle
 * a AI que te abra una página idéntica así [usehandle.ai] pero con el logo
 * de Likida". La composición hero ya vivía en `ChatFlota` (variante 'hero',
 * sobrevivió al borrado porque el componente lo usa también el rail).
 *
 * REGLA DE SEGURIDAD HEREDADA (inventario §12, corregida en su momento):
 * `getKpis`/`getAcreditables` se piden DESPUÉS de `puedeVerArea(rol,
 * 'dinero')` — antes de ese chequeo, un encargado podía leer cifras de
 * dinero por esta pantalla aunque el resto del panel se las negara.
 */
export default async function PaginaChat({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/chat', sp);

  if (!puedeVerArea(rol, 'dinero')) redirect('/dashboard');

  const [kpis, acred] = await Promise.all([
    getKpis(tenantId).catch((): DashboardKpis | null => null),
    getAcreditables(tenantId).catch((): Acreditables | null => null),
  ]);

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <div className="flex-1 flex flex-col"><ChatFlota kpis={kpis} acred={acred} variante="hero" /></div>
      </div>
    </main>
  );
}
