import { NextResponse } from 'next/server';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { resolverTenantApi } from '@/lib/auth/tenant-api';
import { puedeExportar } from '@/lib/auth/permisos';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { logger } from '@/lib/logger';
import { LecturaIncompleta } from '@/lib/likida/pg';
import { leerPeriodo } from '../liquidaciones/periodo';
import {
  listarLiquidacionesExternas, leerPorId, firmarPdfExterno, ESTADOS,
  type Cursor, type EstadoLiquidacionExterna, type FiltroListado, type LiquidacionExterna,
} from '@/lib/likida/liquidacion_externa/repo';
import { csvLiquidacionesExternas } from '@/lib/likida/liquidacion_externa/csv';
import { rutaExcelExterno } from '@/lib/likida/liquidacion_externa/almacen';

export const runtime = 'nodejs';
// Literal a propósito (BE-19): Next lo lee en build y la prueba de exports lo exige.
export const maxDuration = 120;

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT DE LIQUIDACIONES EXTERNAS (CSV y PDF).
//
//   GET ?desde=AAAA-MM-DD&hasta=AAAA-MM-DD[&estado=…][&respuestaChofer=…] → CSV del periodo
//   GET ?pdf=<uuid>                                    → 302 al PDF (URL firmada)
//   GET ?excel=<uuid>                                  → 302 al Excel en el formato de la flota (0564), si lo hay
//
// La puerta es la de todo export de dinero: sesión → flota → área `dinero` →
// `puedeExportar`. El PDF se busca CON el tenant de la sesión: un id de otra
// flota es un 404, nunca el documento de otro.
//
// El CSV recorre la tabla por cursor `(created_at, id)` y DEMUESTRA que trajo
// todo (`count` exacto contra lo leído): un archivo corto con cara de completo
// es justo lo que un export no puede entregar. Tope de 3 meses por archivo,
// igual que el de liquidaciones del motor.
// ═══════════════════════════════════════════════════════════════════════════

const PAGINA_EXPORT = 500;     // +1 de lookahead = 501 < max_rows de PostgREST (1,000)
const MAX_PAGINAS_EXPORT = 40; // 20,000 filas por archivo
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  if (!(await rateLimit(`export:${clientIp(req)}`, 10, 60_000))) return new NextResponse('Demasiadas peticiones', { status: 429 });

  const t = await resolverTenantApi(req.url);
  if (!t.ok) return new NextResponse(t.motivo, { status: t.status });
  const tenantId = t.tenantId;

  if (!(await rateLimit(`export:tenant:${tenantId}`, 10, 60_000))) return new NextResponse('Demasiadas peticiones', { status: 429 });

  // Dinero: el encargado ve el área `operacion` y nada más. Mismo criterio que
  // `/api/export/liquidaciones`.
  if (!puedeVerArea(t.rol, 'dinero')) {
    logger.warn('export.liqext.area_sin_permiso', { rol: t.rol });
    return new NextResponse('Tu rol no ve las cifras de dinero de la flota.', { status: 403 });
  }
  if (!puedeExportar(t.rol)) {
    logger.warn('export.liqext.rol_sin_permiso', { rol: t.rol });
    return new NextResponse('Tu rol no puede descargar este documento.', { status: 403 });
  }

  const params = new URL(req.url).searchParams;

  // ── PDF de una liquidación ───────────────────────────────────────────────
  const pdf = params.get('pdf');
  if (pdf !== null) {
    if (!UUID.test(pdf)) return new NextResponse('`pdf` tiene que ser el id de una liquidación.', { status: 400 });
    try {
      const liq = await leerPorId(tenantId, pdf.toLowerCase());
      if (!liq || !liq.pdfRuta) return new NextResponse('No encontré ese PDF.', { status: 404 });
      const url = await firmarPdfExterno(liq.pdfRuta, 60, `liquidacion_${liq.claveExterna.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60)}.pdf`);
      return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
      logger.error('export.liqext.pdf', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
      return new NextResponse('No se pudo preparar la descarga. Intenta de nuevo en un momento.', { status: 502 });
    }
  }

  // ── Excel de una liquidación (el formato de la flota, 0564) ──────────────
  // Solo existe para las que Likida generó DESPUÉS de que la flota configuró su
  // formato; el resto es 404 con su razón, nunca un archivo vacío.
  const excel = params.get('excel');
  if (excel !== null) {
    if (!UUID.test(excel)) return new NextResponse('`excel` tiene que ser el id de una liquidación.', { status: 400 });
    try {
      const liq = await leerPorId(tenantId, excel.toLowerCase());
      if (!liq || !liq.pdfRuta || liq.pdfOrigen !== 'generado') return new NextResponse('Esa liquidación no tiene Excel (solo las que Likida generó con el formato de la flota).', { status: 404 });
      const url = await firmarPdfExterno(rutaExcelExterno(liq.pdfRuta), 60, `liquidacion_${liq.claveExterna.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60)}.xlsx`);
      return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      if (/not found|no existe|404/i.test(mensaje)) return new NextResponse('Esa liquidación no tiene Excel (llegó antes de configurar el formato de la flota).', { status: 404 });
      logger.error('export.liqext.excel', { tenant: tenantId, err: mensaje });
      return new NextResponse('No se pudo preparar la descarga. Intenta de nuevo en un momento.', { status: 502 });
    }
  }

  // ── CSV del periodo ──────────────────────────────────────────────────────
  const periodo = leerPeriodo(params);
  if (!periodo.ok) return new NextResponse(periodo.motivo, { status: 400 });
  const filtro: FiltroListado = { desde: params.get('desde')!, hasta: params.get('hasta')! };
  const estado = params.get('estado');
  if (estado) {
    if (!(ESTADOS as readonly string[]).includes(estado)) {
      return new NextResponse(`\`estado\` tiene que ser uno de: ${ESTADOS.join(', ')}.`, { status: 400 });
    }
    filtro.estado = estado as EstadoLiquidacionExterna;
  }

  const respuesta = params.get('respuestaChofer');
  if (respuesta) {
    if (respuesta !== 'recibida' && respuesta !== 'no_coincide') {
      return new NextResponse('`respuestaChofer` tiene que ser `recibida` o `no_coincide`.', { status: 400 });
    }
    filtro.acuseTipo = respuesta;
  }

  try {
    const filas: LiquidacionExterna[] = [];
    let despues: Cursor | null = null;
    let esperadas: number | null = null;
    for (let n = 0; n < MAX_PAGINAS_EXPORT; n++) {
      const r = await listarLiquidacionesExternas(tenantId, filtro, PAGINA_EXPORT, despues, n === 0);
      if (n === 0) esperadas = r.total;
      filas.push(...r.filas);
      if (!r.hayMas) break;
      const ultima: LiquidacionExterna | undefined = r.filas.at(-1);
      if (!ultima) break;
      despues = { creadoEn: ultima.creadaEn, id: ultima.id };
    }
    // Completa Y DEMOSTRADA, o no sale. Sin un conteo no hay con qué demostrar.
    if (esperadas === null) throw new Error('liquidaciones externas: no se pudo contar el periodo');
    if (filas.length !== esperadas) throw new LecturaIncompleta('export.liquidaciones_externas', filas.length, esperadas);

    return new NextResponse(csvLiquidacionesExternas(filas), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="liquidaciones_externas_${periodo.etiqueta.replaceAll('..', '_a_')}.csv"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    logger.error('export.liqext.csv', { tenant: tenantId, periodo: periodo.etiqueta, err: e instanceof Error ? e.message : String(e) });
    return new NextResponse('No se pudo generar el export. Intenta de nuevo en un momento.', { status: 500 });
  }
}
