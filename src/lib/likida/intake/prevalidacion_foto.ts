import { logger } from '@/lib/logger';
import {
  decidirPrevalidacion, mensajeRepetirFoto, medirFotoParaPrevalidar, type MotivoFoto,
} from './calidad_foto';
import { registrarRechazoDeFoto, rechazosDeFotoHoy } from './repeticion_foto';

// ═══════════════════════════════════════════════════════════════════════════
// LA PREVALIDACIÓN, EN EL CAMINO DE LA FOTO (F19). Una sola llamada para el
// procesador: mide la foto ya descargada y dice qué hacer, ANTES de pagar el
// OCR. Nunca lanza y falla ABIERTO: ante cualquier problema interno la foto
// sigue al OCR.
// ═══════════════════════════════════════════════════════════════════════════

export type AccionPrevalidacion =
  | { accion: 'seguir'; marca: MotivoFoto | null }
  | { accion: 'repetir'; mensaje: string; motivo: MotivoFoto };

/**
 * · foto buena                      → `seguir` sin marca.
 * · foto mala, dentro del tope      → `repetir` con el motivo y cómo tomarla (cuenta un rechazo del día).
 * · foto mala, tope del día cumplido → `seguir` con marca (el motivo viaja en `ocrExtra.fotoDudosa` para revisión humana).
 * · la prevalidación falló          → `seguir` sin marca.
 */
export async function prevalidarFotoDeOperador(operadorId: string, dataUrl: string, ahoraMs: number = Date.now()): Promise<AccionPrevalidacion> {
  try {
    const m = await medirFotoParaPrevalidar(dataUrl);
    const veredicto = decidirPrevalidacion({ motivo: m.motivo, error: m.error, rechazosHoy: rechazosDeFotoHoy(operadorId, ahoraMs) });
    if (veredicto === 'repetir' && m.motivo) {
      registrarRechazoDeFoto(operadorId, ahoraMs);
      logger.info('foto.prevalidacion_repetir', { motivo: m.motivo });
      return { accion: 'repetir', motivo: m.motivo, mensaje: mensajeRepetirFoto(m.motivo) };
    }
    if (veredicto === 'pasa_con_marca') {
      logger.info('foto.prevalidacion_pasa_con_marca', { motivo: m.motivo });
      return { accion: 'seguir', marca: m.motivo };
    }
    return { accion: 'seguir', marca: null };
  } catch (err) {
    logger.warn('foto.prevalidacion_error', { err: err instanceof Error ? err.message : String(err) });
    return { accion: 'seguir', marca: null };
  }
}
