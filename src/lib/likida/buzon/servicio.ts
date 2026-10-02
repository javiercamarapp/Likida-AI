import { enviarCorreo } from '@/lib/correo/enviar';
import * as repoBuzon from './repo';
import * as repoEntrega from './entrega_repo';
import type { DepsEntrega } from './entrega';
import { crearPuertosPdf } from './pdf_adaptador';
import { parseRepXml, ingerirRep } from '../intake/rep';
import { guardarFacturaProveedor, estadoSatDeCfdi } from '../proveedores';
import { procesarCorreoBuzon, type AdjuntoBuzon, type ContextoCorreo, type ResumenCorreo, type DepsBuzon } from './ingesta';

/** Los dependencias REALES de la ingesta del buzón (en pruebas se sustituyen por dobles de proveedor). */
export function depsBuzonReales(tenantId: string): DepsBuzon {
  return {
    repo: repoBuzon,
    pdf: crearPuertosPdf(tenantId),
    estadoSat: estadoSatDeCfdi,
    guardarFactura: guardarFacturaProveedor,
    parseRep: parseRepXml,
    ingerirRep,
    ahoraMs: () => Date.now(),
  };
}

/** La entrada de la ruta del webhook: procesa los adjuntos ya descargados de UN correo. */
export function atenderAdjuntosBuzon(ctx: ContextoCorreo, adjuntos: readonly AdjuntoBuzon[]): Promise<ResumenCorreo> {
  return procesarCorreoBuzon(ctx, adjuntos, depsBuzonReales(ctx.tenantId));
}

export type { AdjuntoBuzon, ContextoCorreo, ResumenCorreo };

/** Los puertos REALES de la entrega al contador (en pruebas se sustituyen por dobles). */
export function depsEntregaReales(): DepsEntrega {
  return {
    repo: repoEntrega,
    enviarCorreo: (para, correo, op) => enviarCorreo(para, correo, op),
    descargarPdf: repoBuzon.descargarPdf,
    nombreFlota: repoEntrega.nombreFlota,
    ahora: () => new Date(),
  };
}
