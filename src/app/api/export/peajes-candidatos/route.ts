import { NextResponse } from 'next/server';
import {
  revisionDeDesglose, lineasDeDesglose, lineaCobroDeFila, listarReglasCasetas, listarReclamos,
} from '@/lib/likida/peajes/revision_cobros';
import { listarTarifas } from '@/lib/likida/peajes/datos';
import { evaluarContraTarifa, tarifasDesdeInferidas } from '@/lib/likida/peajes/reglas_tarifa';
import { inferirTarifas } from '@/lib/likida/peajes/tarifario_inferido';
import {
  armarCandidatos, candidatosAExcel, candidatosACsv, CATEGORIAS_ARCHIVO, type CategoriaArchivo,
} from '@/lib/likida/peajes/candidatos_archivos';
import { hoyMx } from '@/lib/formato';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { resolverTenantApi } from '@/lib/auth/tenant-api';
import { puedeExportar } from '@/lib/auth/permisos';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { logger } from '@/lib/logger';
import { LecturaIncompleta } from '@/lib/likida/pg';

export const runtime = 'nodejs';
// Lee el desglose paginado (hasta 60 000 líneas), aplica las reglas y el tarifario y arma el archivo. Literal a propósito: Next lo lee en build.
export const maxDuration = 120;

/**
 * El REPORTE «LISTO PARA SUBIR AL PORTAL DEL PROVEEDOR» de UN desglose de peaje (Agente 2): una hoja por
 * categoría de candidato (clase, extemporáneo, duplicado, importe sobre tarifa, TAG de baja, caseta que no
 * debe cruzarse) con las columnas del archivo original y lo que el reclamo explica. Sin la interpretación
 * interna (confianza, GPS). Todo es candidato salvo la diferencia contra una tarifa CONFIRMADA.
 *
 *   GET ?desglose=<uuid>[&formato=xlsx|csv][&excluirReclamados=1]   (xlsx por omisión)
 *
 * `excluirReclamados=1` omite las categorías de ese desglose que ya tienen un reclamo no rechazado.
 * Mismas puertas que los demás exports de dinero: la del DATO (área dinero) y la del verbo
 * (`puedeExportar`), rate limit por IP y por flota, y el desglose SIEMPRE acotado al tenant de la sesión.
 */
export async function GET(req: Request) {
  if (!(await rateLimit(`export-peajes-candidatos:${clientIp(req)}`, 10, 60_000))) {
    return new NextResponse('Demasiadas peticiones', { status: 429 });
  }
  const t = await resolverTenantApi(req.url);
  if (!t.ok) return new NextResponse(t.motivo, { status: t.status });
  if (!(await rateLimit(`export-peajes-candidatos:tenant:${t.tenantId}`, 10, 60_000))) {
    return new NextResponse('Demasiadas peticiones', { status: 429 });
  }
  if (!puedeVerArea(t.rol, 'dinero')) {
    logger.warn('export.peajes_candidatos_area_sin_permiso', { rol: t.rol });
    return new NextResponse('Tu rol no ve las cifras de dinero de la flota.', { status: 403 });
  }
  if (!puedeExportar(t.rol)) {
    logger.warn('export.peajes_candidatos_rol_sin_permiso', { rol: t.rol });
    return new NextResponse('Tu rol no puede descargar este documento.', { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const desgloseId = params.get('desglose')?.trim() ?? '';
  if (!desgloseId) return new NextResponse('Falta el desglose (?desglose=…).', { status: 400 });
  const formato = params.get('formato') ?? 'xlsx';
  if (formato !== 'xlsx' && formato !== 'csv') return new NextResponse('`formato` tiene que ser `xlsx` o `csv`.', { status: 400 });
  const excluirReclamados = params.get('excluirReclamados') === '1';

  try {
    const rev = await revisionDeDesglose(t.tenantId, desgloseId);
    if (!rev) return new NextResponse('Ese desglose no existe en tu flota.', { status: 404 });

    const [filas, tarifas, casetas, seguimiento] = await Promise.all([
      lineasDeDesglose(t.tenantId, desgloseId),
      listarTarifas(t.tenantId),
      listarReglasCasetas(t.tenantId),
      excluirReclamados ? listarReclamos(t.tenantId, hoyMx()) : Promise.resolve(null),
    ]);
    const lineas = filas.map(lineaCobroDeFila);
    const excepcionesClase = new Map(casetas.filter((c) => c.clasesPermitidas.length > 0).map((c) => [c.nombreNorm, c.clasesPermitidas]));
    // Las tarifas guardadas mandan; las inferidas de los propios archivos completan y siguen SIN confirmar.
    const evaluadas = evaluarContraTarifa(lineas, [...tarifas, ...tarifasDesdeInferidas(inferirTarifas(lineas).tarifas)], { excepcionesClase });

    const excluir = new Set<CategoriaArchivo>();
    if (seguimiento) {
      for (const r of seguimiento.reclamos) {
        if (r.desgloseId === desgloseId && r.estado !== 'rechazado' && (CATEGORIAS_ARCHIVO as readonly string[]).includes(r.categoria)) excluir.add(r.categoria as CategoriaArchivo);
      }
    }

    const reporte = armarCandidatos({
      proveedor: rev.proveedor, archivoNombre: rev.archivoNombre,
      periodoDesde: rev.periodoOficialDesde, periodoHasta: rev.periodoOficialHasta,
      revision: rev.revision, evaluadas, excluir,
    });
    const cabeceras = { 'Cache-Control': 'no-store' } as const;
    if (formato === 'csv') {
      return new NextResponse(candidatosACsv(reporte), {
        headers: { ...cabeceras, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="candidatos_peajes_likida.csv"' },
      });
    }
    return new NextResponse(new Blob([candidatosAExcel(reporte) as BlobPart]), {
      headers: {
        ...cabeceras,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="candidatos_peajes_likida.xlsx"',
      },
    });
  } catch (e) {
    if (e instanceof LecturaIncompleta) {
      logger.error('export.peajes_candidatos_incompleta', { tenant: t.tenantId, leidas: e.leidas, esperadas: e.esperadas });
      return new NextResponse('Ese desglose trae más líneas de las que el export puede traer demostrando que están todas. No se manda un archivo corto: avísanos.', { status: 500 });
    }
    logger.error('export.peajes_candidatos', { tenant: t.tenantId, err: e instanceof Error ? e.message : String(e) });
    return new NextResponse('No se pudo generar el reporte. Intenta de nuevo en un momento.', { status: 500 });
  }
}
