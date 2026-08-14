import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { getViajes, getLiquidaciones, contarViajes, contarEscalados } from '@/lib/likida/analytics';
import { sufijoTenant } from '../sufijo';
import { VistaViajes, type FiltroViajes, type FilaRegistroViaje } from './vista';

export const dynamic = 'force-dynamic';

const FILTROS: FiltroViajes[] = ['todos', 'abiertos', 'en_cuadre', 'liquidados', 'escalados'];

/**
 * Registro de Viajes (F2 del plan) — la fuente de verdad NAVEGABLE, no una
 * página de acción: crear/asignar/avisar viven en Despacho. Área
 * `operacion` y por eso CERO pesos: el anticipo existe en `ViajeRow` y esta
 * página lo deja en el servidor a propósito (el 4-ago una página de viajes
 * ya filtró anticipos al encargado; `dinero_por_area.test.ts` vigila).
 */
export default async function PaginaViajes({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string; f?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/viajes', sp);
  if (!puedeVerRuta(rol, '/dashboard/viajes')) redirect('/dashboard');
  const sufijo = sufijoTenant(sp);

  const filtro: FiltroViajes = (FILTROS as string[]).includes(sp.f ?? '') ? (sp.f as FiltroViajes) : 'todos';

  // Primarios sin catch (fail closed); los conteos degradan a null solos.
  const [viajes, liquidaciones, total, abiertos, enCuadre, liquidados, escalados] = await Promise.all([
    getViajes(tenantId),
    getLiquidaciones(tenantId).catch(() => null),
    contarViajes(tenantId),
    contarViajes(tenantId, ['abierto']),
    contarViajes(tenantId, ['en_cuadre']),
    contarViajes(tenantId, ['liquidado']),
    contarEscalados(tenantId),
  ]);

  // `/dashboard/[id]` abre por id de LIQUIDACIÓN — se cruza por folio, y un
  // folio sin cruce se queda sin link (nunca un link a un 404).
  const liqPorFolio = new Map((liquidaciones ?? []).map((l) => [l.folio, l.id]));

  // SIN anticipo a propósito — ver encabezado.
  const filas: FilaRegistroViaje[] = viajes
    .filter((v) => {
      if (filtro === 'abiertos') return v.estatus === 'abierto';
      if (filtro === 'en_cuadre') return v.estatus === 'en_cuadre';
      if (filtro === 'liquidados') return v.estatus === 'liquidado';
      if (filtro === 'escalados') return v.escaladoEn !== null && v.aceptadoEn === null && v.estatus !== 'liquidado';
      return true;
    })
    .map((v) => ({
      id: v.id, folio: v.folio, origen: v.origen, destino: v.destino,
      estatus: v.estatus, operadorNombre: v.operadorNombre, fechaInicio: v.fechaInicio,
      intakePendientes: v.intakePendientes,
      avisadoEn: v.avisadoEn, aceptadoEn: v.aceptadoEn, escaladoEn: v.escaladoEn,
      avisosEnviados: v.avisosEnviados,
      liqId: v.estatus === 'liquidado' ? liqPorFolio.get(v.folio) ?? null : null,
    }));

  return (
    <VistaViajes
      filas={filas}
      filtro={filtro}
      conteos={{ total, abiertos, enCuadre, liquidados, escalados }}
      cargados={viajes.length}
      sufijo={sufijo}
    />
  );
}
