import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import {
  getKpis, getLiquidaciones, contarViajes, getLiquidacionesPorDia,
  getHechosSolos, getDineroObservadoPorTipo, getStatsPorOperador, getValorAhorro,
} from '@/lib/likida/analytics';
import { getConfig } from '@/lib/likida/config';
import { traerResumenCostoIaTenant } from '@/lib/likida/costos';
import { VistaAgenteLiquidacion, type ExtraAgenteLiquidacion } from './vista';

export const dynamic = 'force-dynamic';

/** Sección secundaria que no se pudo leer → null → su leyenda honesta.
 *  Mismo patrón `safe` que inicio-contenido: una gráfica caída no tumba la
 *  página, pero TAMPOCO pinta un cero sin medir. */
function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  return fn().catch(() => null);
}

/**
 * Agente de Liquidación de Ruta — v2 (13-ago-2026: "gráficas, algo visual").
 * Esta puerta trae sesión y TODOS los datos; el dibujo vive en `vista.tsx`
 * (patrón page/vista). Los datos primarios (KPIs, cola) fallan CERRADO: base
 * caída = página caída. Los secundarios degradan a su leyenda.
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

  const [
    kpis, liqs, costo, abiertos, enCuadre, liquidados, porDia, hechos, porTipo, stats, ahorro, config,
  ] = await Promise.all([
    // Primarios: sin catch a propósito — no se pinta "0 por revisar" ciego.
    getKpis(tenantId),
    getLiquidaciones(tenantId),
    // Secundarios: cada uno degrada solo.
    traerResumenCostoIaTenant(tenantId, 'pagina_agente_liquidacion'),
    contarViajes(tenantId, ['abierto']),
    contarViajes(tenantId, ['en_cuadre']),
    contarViajes(tenantId, ['liquidado']),
    safe(() => getLiquidacionesPorDia(tenantId, 84)),
    safe(() => getHechosSolos(tenantId)),
    safe(() => getDineroObservadoPorTipo(tenantId)),
    safe(() => getStatsPorOperador(tenantId)),
    safe(() => getValorAhorro(tenantId)),
    safe(() => getConfig(tenantId)),
  ]);

  const extra: ExtraAgenteLiquidacion = {
    actividadIa: 'ok' in costo
      ? costo.ok.porFase.filter((f) => f.fase !== 'chat').reduce((s, f) => s + f.n, 0)
      : null,
    funnel: { abiertos, enCuadre, porRevisar: kpis.porRevisar, liquidados },
    cierresPorDia: porDia?.map((d) => ({ fecha: d.dia, valor: d.valor })) ?? null,
    hechos,
    huerfanos: ahorro ? { resueltos: ahorro.huerfanosResueltos, totales: ahorro.huerfanosTotales } : null,
    docsProcesados: ahorro?.documentosProcesados ?? null,
    porTipo,
    operadores: stats
      ?.filter((o) => o.diferencias > 0)
      .sort((a, b) => b.diferencias - a.diferencias)
      .slice(0, 6)
      .map((o) => ({ etiqueta: o.nombre, valor: o.diferencias })) ?? null,
    politica: config?.politica ?? null,
  };

  return (
    <VistaAgenteLiquidacion
      kpis={kpis}
      cola={liqs.filter((l) => l.estatus === 'revisar')}
      cierres={liqs.filter((l) => l.estatus !== 'revisar').slice(0, 8)}
      extra={extra}
      sufijo={sufijo}
    />
  );
}
