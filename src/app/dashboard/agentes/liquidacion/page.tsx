import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { getKpis, getLiquidaciones } from '@/lib/likida/analytics';
import { traerResumenCostoIaTenant } from '@/lib/likida/costos';
import { VistaAgenteLiquidacion } from './vista';

export const dynamic = 'force-dynamic';

/**
 * Agente de Liquidación — la PRIMERA página de la categoría AGENTES
 * (13-ago-2026). Es la ventana de un agente que trabaja solo: qué ha
 * cerrado, qué trae en cola para un humano, y qué le cuesta a la flota.
 * Esta puerta trae sesión y datos; el dibujo vive en `vista.tsx` para
 * poder mirarlo sin sesión (patrón page/vista del repo).
 *
 * Todo lo que se pinta viene de consultas reales (getKpis, getLiquidaciones,
 * llm_costo). Lo único que NO hay es un LED de "activo": nadie mide aquí si
 * el webhook de WhatsApp está vivo, y un LED verde sin medición es una cifra
 * inventada con forma de círculo.
 */
export default async function PaginaAgenteLiquidacion({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/agentes/liquidacion', sp);
  if (!puedeVerRuta(rol, '/dashboard/agentes/liquidacion')) redirect('/dashboard');

  const base = sp.tenant ? `?tenant=${sp.tenant}` : sp.vista ? `?vista=${sp.vista}` : '';
  const sufijo = sp.rol ? `${base}${base ? '&' : '?'}rol=${sp.rol}` : base;

  // Sin catch a propósito: si la base está caída, la página FALLA — no pinta
  // "0 por revisar" sobre una lectura ciega (regla del repo, ver analytics.ts).
  const [kpis, liqs, costo] = await Promise.all([
    getKpis(tenantId),
    getLiquidaciones(tenantId),
    traerResumenCostoIaTenant(tenantId, 'pagina_agente_liquidacion'),
  ]);

  return (
    <VistaAgenteLiquidacion
      kpis={kpis}
      cola={liqs.filter((l) => l.estatus === 'revisar')}
      cierres={liqs.filter((l) => l.estatus !== 'revisar').slice(0, 8)}
      costo={costo}
      sufijo={sufijo}
    />
  );
}
