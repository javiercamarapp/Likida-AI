// ═══════════════════════════════════════════════════════════════════════════
// GET /v1/evidencias — el estado de los DOCUMENTOS DE CIERRE de un viaje (T-A5-53/54, 0823): cuáles ya llegaron,
// cuáles faltan y cuáles quedaron marcados «revisar» por foto ilegible. `viajeId` es obligatorio: no hay un
// listado útil sin acotar a un viaje (el catálogo es por cliente, el estado es por viaje).
//
// Siempre dentro de la flota de la credencial: un `viajeId` de otra flota (o sin solicitud armada, o el cliente
// sin catálogo propio) contesta lo mismo — lista vacía, sin romper nada (el POD de siempre sigue sirviendo a
// quien no usa este catálogo). Área `operacion`: facturación/cobranza lo consultan para saber si ya tienen todo.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { UUID } from '@/lib/likida/conductor/lectura';
import { leerDocumentosCierre } from '@/lib/likida/conductor/repo_validacion';
import { resumenDocumentosCierre } from '@/lib/likida/conductor/documentos_cierre';
import { abrir, errorApi, fallo } from '../_comun';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const acceso = await abrir(req, 'operacion');
  if (!acceso.ok) return acceso.respuesta;

  const q = new URL(req.url).searchParams;
  const viajeId = q.get('viajeId');
  if (viajeId === null || viajeId.trim() === '') return errorApi('parametro_invalido', 'Manda `viajeId` (el viaje cuyos documentos de cierre quieres ver).');
  if (!UUID.test(viajeId)) return errorApi('parametro_invalido', '`viajeId` tiene que ser un uuid.');

  try {
    const filas = await leerDocumentosCierre(acceso.tenantId, viajeId.toLowerCase());
    const resumen = resumenDocumentosCierre(filas);
    return NextResponse.json({
      datos: filas.map((f) => ({
        id: f.id,
        documentoRequeridoId: f.documentoRequeridoId,
        nombre: f.nombreSolicitado,
        tipo: f.tipoSolicitado,
        estado: f.estado,
        solicitadoEn: f.solicitadoEn,
        recibidoEn: f.recibidoEn,
        evidenciaId: f.viajeHitoEvidenciaId,
        intentosLegibilidad: f.intentosLegibilidad,
        respuestaChofer: f.respuestaChofer,
      })),
      resumen: { usaCatalogo: resumen.usaCatalogo, total: resumen.total, recibidos: resumen.recibidos, faltan: resumen.faltantes.length },
    });
  } catch (e) {
    return fallo('v1.evidencias', e, { tenant: acceso.tenantId, viaje: viajeId });
  }
}
