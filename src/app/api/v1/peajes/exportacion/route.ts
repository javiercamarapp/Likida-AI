// ═══════════════════════════════════════════════════════════════════════════
// GET /v1/peajes/exportacion?desglose=<uuid> — la bitácora conciliada de UN
// desglose en el layout que pida el SAP/ERP del cliente (columnas, separador,
// decimal, fechas, BOM: ver `peajes/exportacion.ts`).
//
// Área `dinero`. Cada fila trae `estado` (cuadra / sin respaldo / por verificar) y
// `motivo`: «sin respaldo» es un hecho sobre los datos de Likida, NO una acusación
// (la leyenda completa viaja en `X-Likida-Leyenda`). Un desglose ANULADO o de otra
// flota es 404. Sin `desglose` es 400: la lista con sus ids es
// `GET /v1/peajes/desgloses`.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { abrir, errorApi, fallo } from '../../_comun';
import { bitacoraConciliada, LEYENDAS_BITACORA_CONCILIADA } from '@/lib/likida/peajes/bitacora_conciliada';
import { leerOpcionesExportacionPeajes, generarExportacionPeajes } from '@/lib/likida/peajes/exportacion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const acceso = await abrir(req, 'dinero');
  if (!acceso.ok) return acceso.respuesta;

  const q = new URL(req.url).searchParams;
  const desglose = q.get('desglose');
  if (!desglose || !UUID.test(desglose)) return errorApi('parametro_invalido', '`desglose` es obligatorio y tiene que ser el uuid de un desglose (ver `GET /v1/peajes/desgloses`).');
  const lectura = leerOpcionesExportacionPeajes(q);
  if (!lectura.ok) return errorApi('parametro_invalido', lectura.mensaje);

  try {
    const b = await bitacoraConciliada(acceso.tenantId, desglose.toLowerCase());
    if (!b) return errorApi('no_encontrado', 'No hay un desglose vigente con ese id en tu flota.');
    return new NextResponse(generarExportacionPeajes(b, lectura.opciones), {
      headers: {
        'Content-Type': `${lectura.opciones.separador === 'tab' ? 'text/tab-separated-values' : 'text/csv'}; charset=utf-8`,
        'Content-Disposition': `attachment; filename="bitacora_peajes_${desglose.slice(0, 8)}.${lectura.opciones.separador === 'tab' ? 'tsv' : 'csv'}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Likida-Filas': String(b.filas.length),
        // Una sola línea (los encabezados HTTP no admiten saltos): la leyenda de la doctrina.
        'X-Likida-Leyenda': encodeURIComponent(LEYENDAS_BITACORA_CONCILIADA.slice(1, 3).join(' ')),
      },
    });
  } catch (e) {
    return fallo('v1.peajes.exportacion', e, { tenant: acceso.tenantId, desglose });
  }
}
