import { getKpis, getAcreditables, type DashboardKpis, type Acreditables } from '@/lib/cuadra/analytics';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import ChatFlota from '../chat';

export const dynamic = 'force-dynamic';

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * Chatea con tus datos (PASO 8) — la versión de página completa del mismo
 * chat que vive en el rail del Asistente.
 *
 * Responde por coincidencia de palabras clave contra cifras YA calculadas en
 * el servidor, NO traduciendo lenguaje natural a SQL. Esa diferencia es
 * deliberada: un cuadro de texto con línea directa a la base, corriendo con
 * permisos de servicio en una app multi-tenant, es el vector de inyección
 * que la propia auditoría de este repo persigue. Cuando haga falta contestar
 * algo que la lista no cubre, se agranda la lista.
 */
export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId } = await resolverTenantEfectivo('/dashboard/chat', sp);

  const [kpis, acred] = await Promise.all([
    safe<DashboardKpis>(() => getKpis(tenantId)),
    safe<Acreditables>(() => getAcreditables(tenantId)),
  ]);

  // Un solo recuadro: el de escribir. El encabezado y la nota de límites
  // siguen ahí —son obligatorios, no decorativos— pero como texto sobre el
  // lienzo, no como dos tarjetas más. Los tres `glass-panel` apilados hacían
  // que la página se leyera como un formulario y no como una pregunta.
  return (
    <div className="h-full min-h-[560px]">
      <ChatFlota kpis={kpis} acred={acred} variante="hero" />
    </div>
  );
}
