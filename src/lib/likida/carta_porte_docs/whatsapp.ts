// ═══════════════════════════════════════════════════════════════════════════
// WHATSAPP — el tercer canal: la oficina reenvía el documento del cliente.
//
// Solo entra por aquí quien YA está identificado como usuario de oficina de una
// flota (el processor lo resuelve por su teléfono): un desconocido que manda un
// PDF no abre nada. Una FOTO exige un pie que diga que es una carta porte o un
// embarque (si no, es otro comprobante y sigue su camino); un DOCUMENTO entra
// siempre, salvo un XML que no es Carta Porte (ese es el CFDI de un proveedor y lo
// atiende otro agente).
//
// La respuesta a la oficina va por el selector de canal (`avisarOficina` →
// `enviarConFallback`: texto dentro de la ventana de 24 h, plantilla fuera) — se
// inyecta como `responder`, aquí no se habla con Meta.
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';
import { detectarFormato } from './contenido';
import { procesarDocumento, recibirDocumento, type DepsServicio } from './servicio';

export const MAX_BYTES_WA = 12 * 1024 * 1024;
const PIE_CARTA_PORTE = /\b(carta\s*porte|cartaporte|embarque|ccp)\b/i;

export interface MensajeWaDoc { type: string; mediaId?: string; text?: string }

/** ¿Este mensaje es, a primera vista, un documento de embarque? (La foto sin pie NO lo es.) */
export function esCandidatoCartaPorte(m: MensajeWaDoc): boolean {
  if (!m.mediaId) return false;
  if (m.type === 'document') return true;
  if (m.type === 'image') return PIE_CARTA_PORTE.test(m.text ?? '');
  return false;
}

export interface DepsWhatsapp extends DepsServicio {
  metadatos: (mediaId: string) => Promise<{ mimeType: string; fileSize: number | null } | null>;
  /** Un data-URL (`data:<mime>;base64,…`) o `null` si no se pudo bajar. */
  descargar: (mediaId: string) => Promise<string | null>;
  responder: (texto: string) => Promise<void>;
  restanteMs: () => number;
  senal?: (ms: number) => AbortSignal;
  margenProcesoMs?: number;
}

export interface EntradaWhatsapp {
  tenantId: string;
  userId: string | null;
  mensaje: MensajeWaDoc;
  /** Cómo se llama quien lo mandó (para el rastro); nunca su teléfono. */
  nombreRemitente: string | null;
  /** Liga base a la bandeja (`https://app.likida.ai/dashboard/carta-porte/documentos`). */
  urlBandeja: string;
}

function bytesDeDataUrl(url: string): Uint8Array | null {
  const i = url.indexOf(',');
  if (i < 0) return null;
  try { return new Uint8Array(Buffer.from(url.slice(i + 1), 'base64')); } catch { return null; }
}

const EXT_POR_MIME: Record<string, string> = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'text/csv': 'csv', 'application/xml': 'xml', 'text/xml': 'xml',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

/**
 * `'atendido'` = ya se le contestó a la persona (el processor termina ahí);
 * `'no_aplica'` = no era esto, que siga su camino.
 */
export async function ingerirDesdeWhatsapp(e: EntradaWhatsapp, deps: DepsWhatsapp): Promise<'atendido' | 'no_aplica'> {
  if (!esCandidatoCartaPorte(e.mensaje)) return 'no_aplica';
  const mediaId = e.mensaje.mediaId as string;
  try {
    const meta = await deps.metadatos(mediaId);
    if (!meta) { await deps.responder('No pude abrir ese archivo 😕. Reenvíalo, o súbelo desde el panel de Carta Porte.'); return 'atendido'; }
    if (/^image\/hei[cf]/i.test(meta.mimeType)) {
      await deps.responder('Esa foto viene en formato HEIC y no la puedo leer 📷. Mándala como JPG (en el iPhone: Ajustes → Cámara → Formatos → «Más compatible») o súbela desde el panel.');
      return 'atendido';
    }
    if (meta.fileSize !== null && meta.fileSize > MAX_BYTES_WA) {
      await deps.responder('Ese archivo pesa demasiado (más de 12 MB). Súbelo desde el panel de Carta Porte o mándame una versión más ligera.');
      return 'atendido';
    }
    const url = await deps.descargar(mediaId);
    const bytes = url ? bytesDeDataUrl(url) : null;
    if (!bytes || bytes.length === 0) { await deps.responder('No pude descargar el archivo 😕. Reenvíalo en un momento.'); return 'atendido'; }
    if (bytes.length > MAX_BYTES_WA) { await deps.responder('Ese archivo pesa demasiado (más de 12 MB).'); return 'atendido'; }

    // Un XML que no es Carta Porte es la factura de un proveedor: no es de este agente.
    const f = detectarFormato(bytes);
    if (f.ok && f.clase === 'xml' && !/CartaPorte/i.test(Buffer.from(bytes.subarray(0, 400_000)).toString('utf8'))) return 'no_aplica';

    const ext = EXT_POR_MIME[meta.mimeType] ?? (f.ok ? { pdf: 'pdf', imagen: 'jpg', excel: 'xlsx', csv: 'csv', xml: 'xml', correo: 'txt' }[f.clase] : 'bin');
    const r = await recibirDocumento(e.tenantId, {
      canal: 'whatsapp', nombre: `whatsapp-${mediaId.slice(-8)}.${ext}`, bytes, remitente: e.nombreRemitente ? `WhatsApp · ${e.nombreRemitente}`.slice(0, 120) : 'WhatsApp',
      asunto: e.mensaje.text?.slice(0, 300) ?? null, actorId: e.userId,
    }, deps);
    if (!r.ok) {
      await deps.responder(r.motivo === 'agente_apagado' ? 'El agente de Carta Porte está apagado en tu flota.' : r.motivo === 'formato' ? `No pude leer ese archivo: ${r.mensaje}` : r.mensaje);
      return 'atendido';
    }
    const liga = `${e.urlBandeja}/${r.documentoId}`;
    if (r.duplicado) { await deps.responder(`Ese documento ya estaba en la bandeja 📎. Revísalo aquí: ${liga}`); return 'atendido'; }

    let leyo = false;
    if (r.estado === 'recibido' && deps.restanteMs() >= (deps.margenProcesoMs ?? 25_000)) {
      try {
        const p = await procesarDocumento(e.tenantId, r.documentoId, { ...deps, signal: deps.senal?.(Math.max(5_000, deps.restanteMs() - 8_000)) });
        leyo = p.ok;
      } catch (err) {
        logger.error('cp_wa.proceso_fallo', { documentoId: r.documentoId, err: err instanceof Error ? err.message : String(err) });
      }
    }
    await deps.responder(leyo
      ? `Recibí el documento y ya lo leí 📄. Revísalo y apruébalo aquí: ${liga}`
      : `Recibí el documento 📄. Lo estoy leyendo; lo verás en la bandeja de Carta Porte en un momento: ${liga}`);
    return 'atendido';
  } catch (err) {
    logger.error('cp_wa.fallo', { err: err instanceof Error ? err.message : String(err) });
    await deps.responder('Tuve un problema recibiendo el documento 😕. Intenta de nuevo o súbelo desde el panel de Carta Porte.').catch(() => {});
    return 'atendido';
  }
}
