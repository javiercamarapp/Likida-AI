// ═══════════════════════════════════════════════════════════════════════════
// RETENCIÓN — el documento crudo y su texto se borran al vencer.
//
// Contienen datos personales de terceros (nombre, licencia y RFC del operador, RFC
// de remitente y destinatario). `retener_hasta` manda; al vencer se borra el archivo
// de Storage y el texto, y la fila queda como constancia (huella, quién, cuándo,
// a qué viaje llegó) con `purgado_en`. Va colgada del cron `/api/cron/purgar`.
//
// Falla cerrado hacia ADELANTE: si el archivo no se pudo borrar, la fila NO se marca
// purgada y la corrida siguiente lo reintenta; marcar sin borrar sería declarar
// cumplido un plazo que no se cumplió.
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';
import * as repo from './repo';

export interface ResultadoPurga { revisados: number; purgados: number; fallidos: number }

export async function purgarDocumentosVencidos(limite = 100): Promise<ResultadoPurga> {
  const vencidos = await repo.documentosVencidos(limite);
  let purgados = 0; let fallidos = 0;
  for (const v of vencidos) {
    try {
      if (v.storageRuta) await repo.borrarArchivo(v.storageRuta);
      if (await repo.marcarPurgado(v.tenantId, v.id)) {
        purgados++;
        await repo.registrarEvento(v.tenantId, v.id, 'purgado', null, {});
      }
    } catch (e) {
      fallidos++;
      logger.error('carta_porte_docs.purga_fallo', { documentoId: v.id, err: e instanceof Error ? e.message : String(e) });
    }
  }
  return { revisados: vencidos.length, purgados, fallidos };
}
