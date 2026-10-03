// ═══════════════════════════════════════════════════════════════════════════
// GET /v1/peajes/desgloses — los desgloses del proveedor de peaje de la flota, cada
// uno con su resumen de conciliación MEDIDO (cuadra / no cuadra / sin contraparte),
// del más nuevo al más viejo. Es la lista que un SAP/TMS lee para saber QUÉ
// desglose exportar con `GET /v1/peajes/exportacion?desglose=<id>`.
//
// Área `dinero`. Los ANULADOS no salen. `limite` (1-50, defecto 20).
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { abrir, leerPagina, errorApi, fallo } from '../../_comun';
import { listarDesgloses } from '@/lib/likida/intake/desglose_peaje';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: Request) {
  const acceso = await abrir(req, 'dinero');
  if (!acceso.ok) return acceso.respuesta;

  const pag = leerPagina(req.url);
  if (!pag.ok) return pag.respuesta;
  if (pag.pagina.desplazamiento > 0) {
    return errorApi('parametro_invalido', 'Esta ruta no pagina por desplazamiento: pide `limite` (hasta 50) y acota con la exportación por desglose.');
  }

  try {
    // Una de más para saber si hay más.
    const filas = await listarDesgloses(acceso.tenantId, pag.pagina.limite + 1);
    const hayMas = filas.length > pag.pagina.limite;
    const datos = filas.slice(0, pag.pagina.limite).map((d) => ({
      id: d.desgloseId,
      proveedor: d.proveedor,
      archivo: d.archivoNombre,
      periodo: { desde: d.periodoDesde, hasta: d.periodoHasta },
      recibidoEn: d.creadoEn,
      resumen: { total: d.total, cuadra: d.cuadra, noCuadra: d.noCuadra, sinContraparte: d.sinContraparte, pctCuadra: d.pctCuadra },
    }));
    return NextResponse.json({ datos, pagina: { limite: pag.pagina.limite, devueltos: datos.length, hayMas, siguiente: null } });
  } catch (e) {
    return fallo('v1.peajes.desgloses', e, { tenant: acceso.tenantId });
  }
}
