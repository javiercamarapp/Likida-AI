'use server';

import { requireSuperadmin } from '@/lib/auth/guard';
import { anotarAccionAdmin, AVISO_SIN_BITACORA } from '@/lib/admin/acciones_riesgo';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { facturasACsv } from '@/lib/saas/facturas-csv';
import { listarFacturasSaas, TECHO_FACTURAS_SAAS } from '@/lib/saas/transferencia';
import { hoyMx } from '@/lib/formato';
import { leerFiltros, rangoAlReves } from './filtros';

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTAR PARA EL CONTADOR (FUNC-DINERO, P1). El archivo se arma EN EL SERVIDOR con los mismos filtros que valida la pantalla, de modo
// que lo que el contador recibe es exactamente lo que se ve, y el rastro (`facturas.exportadas`: quién, cuántas filas, con qué filtros)
// lo escribe la acción antes de entregarlo. Si la bitácora no pudo escribir se dice, pero el archivo se entrega: es información de la
// propia empresa y la acción ya ocurrió. Si la base tiene más facturas que el techo del archivo, NO se entrega un archivo parcial.
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoExportacion =
  | { ok: true; csv: string; nombre: string; filas: number; aviso: string | null }
  | { ok: false; error: string };

export async function accionExportarFacturas(fd: FormData): Promise<ResultadoExportacion> {
  const s = await requireSuperadmin();
  const filtros = leerFiltros({ estado: fd.get('estado'), desde: fd.get('desde'), hasta: fd.get('hasta') });
  if (rangoAlReves(filtros)) return { ok: false, error: 'El rango está al revés: la fecha «desde» es posterior a «hasta».' };
  try {
    const { filas, total, truncado } = await listarFacturasSaas({ ...filtros, limite: TECHO_FACTURAS_SAAS });
    if (truncado) {
      return { ok: false, error: `Hay ${total} facturas con ese filtro y el archivo admite ${TECHO_FACTURAS_SAAS}. Acota las fechas: un archivo parcial presentado como completo es peor que ninguno.` };
    }
    const anotado = await anotarAccionAdmin({
      actor: s, tenantId: null, accion: 'facturas.exportadas', entidad: 'factura_saas', entidadId: 'exportacion',
      detalle: { filas: filas.length, estado: filtros.estado ?? null, desde: filtros.desde ?? null, hasta: filtros.hasta ?? null },
    });
    return {
      ok: true, csv: facturasACsv(filas), nombre: `facturas-likida-${hoyMx()}.csv`, filas: filas.length,
      aviso: anotado ? null : AVISO_SIN_BITACORA.trim(),
    };
  } catch (e) {
    return { ok: false, error: mensajeParaPantalla(e, 'armar el archivo de facturas') };
  }
}
