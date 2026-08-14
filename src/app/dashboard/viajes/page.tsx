import { redirect } from 'next/navigation';
import { read as leerLibro, utils as xlsxUtils } from 'xlsx';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAsignar } from '@/lib/auth/permisos';
import { getViajes, getLiquidaciones, contarViajes, contarEscalados } from '@/lib/likida/analytics';
import { interpretarFilasViajes, importarViajes } from '@/lib/likida/importar_viajes';
import { logger } from '@/lib/logger';
import { sufijoTenant } from '../sufijo';
import { VistaViajes, type FiltroViajes, type FilaRegistroViaje } from './vista';
import type { ResultadoImportarUI } from './importar';

/** Un export de TMS real pesa KB; 8 MB ya es el archivo equivocado. */
const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

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

  async function importar(_prev: ResultadoImportarUI | null, fd: FormData): Promise<ResultadoImportarUI | null> {
    'use server';
    // Se repite ADENTRO (patrón del repo): POST directo posible. Importar
    // CREA viajes — el gate es el de asignar, no solo el de ver.
    const sesion = await requireSessionTenant('/dashboard/viajes');
    if (!puedeAsignar(sesion.rol)) return { error: 'Tu rol no puede crear viajes.' };
    if (sesion.rol !== 'superadmin' && sesion.tenantId !== tenantId) return { error: 'Este registro no es de tu flota.' };

    const archivo = fd.get('archivo');
    if (!(archivo instanceof File) || archivo.size === 0) return { error: 'Elige el CSV o Excel con los viajes.' };
    if (archivo.size > MAX_IMPORT_BYTES) return { error: 'Ese archivo pesa demasiado para ser un export de viajes.' };

    let matriz: unknown[][];
    try {
      const libro = leerLibro(await archivo.arrayBuffer(), { type: 'array' });
      const hoja = libro.Sheets[libro.SheetNames[0]];
      matriz = xlsxUtils.sheet_to_json(hoja, { header: 1, raw: true }) as unknown[][];
    } catch {
      return { error: 'No pude leer el archivo — asegúrate de que sea CSV o Excel.' };
    }

    const lectura = interpretarFilasViajes(matriz);
    if (lectura.error && lectura.viajes.length === 0) return { error: lectura.error };

    const r = await importarViajes(tenantId, lectura.viajes);
    logger.info('viajes.importados', { tenantId, creados: r.creados, saltados: r.saltados.length });
    if (r.error) return { error: r.error };
    return {
      resumen: {
        creados: r.creados,
        saltados: r.saltados.length,
        descartadas: lectura.descartadas,
        operadoresSinAmarrar: r.operadoresSinAmarrar,
        sinOperador: r.sinOperador,
        operadorOcupado: r.operadorOcupado,
      },
    };
  }

  return (
    <VistaViajes
      filas={filas}
      filtro={filtro}
      conteos={{ total, abiertos, enCuadre, liquidados, escalados }}
      cargados={viajes.length}
      sufijo={sufijo}
      importar={importar}
    />
  );
}
