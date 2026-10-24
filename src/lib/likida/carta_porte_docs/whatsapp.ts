// ═══════════════════════════════════════════════════════════════════════════
// WHATSAPP — el tercer canal: la oficina reenvía el documento del cliente.
//
// Solo entra por aquí quien YA está identificado como usuario de oficina de una
// flota (el processor lo resuelve por su teléfono): un desconocido que manda un
// PDF no abre nada. Una FOTO exige un pie que diga que es una carta porte o un
// embarque (si no, es otro comprobante y sigue su camino); un DOCUMENTO entra
// siempre, salvo un XML que no es Carta Porte (ese es el CFDI de un proveedor y lo
// atiende otro agente). Un TEXTO pegado (el embarque escrito en el cuerpo del mensaje) entra solo con una
// orden explícita al inicio («ccp», «carta porte», «embarque») o si por su forma parece un embarque; los
// saludos y avisos siguen su camino de siempre.
//
// Solo funciona en las flotas que ACTIVARON el agente (tienen su buzón de Carta Porte).
//
// La respuesta a la oficina va por el selector de canal (`avisarOficina` →
// `enviarConFallback`: texto dentro de la ventana de 24 h, plantilla fuera) — se
// inyecta como `responder`, aquí no se habla con Meta.
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';
import { createHash } from 'node:crypto';
import { detectarFormato, MAX_TEXTO_MODELO } from './contenido';
import { problemaRfc } from './validacion';
import { procesarDocumento, recibirDocumento, type DepsServicio } from './servicio';
import * as repo from './repo';
import { bytesDeBase64, textoDeBytes } from './bytes';
import { numero } from '@/lib/formato';

export const MAX_BYTES_WA = 12 * 1024 * 1024;
const PIE_CARTA_PORTE = /\b(carta\s*porte|cartaporte|embarque|ccp)\b/i;

export interface MensajeWaDoc { type: string; mediaId?: string; text?: string }

// ── Texto pegado (33c4d51b 01:40: «a veces me la mandan escrita en el cuerpo del correo/WhatsApp») ──
// Un texto solo entra si trae una ORDEN explícita al inicio, o si por su forma parece un embarque.
// Todo lo demás (saludos, avisos, preguntas) sigue su camino de siempre.
const ORDEN_TEXTO = /^\s*(?:ccp|carta\s*porte|cartaporte|embarque)\b[\s:,.\-–—]*/i;
/** Mínimo de caracteres que debe traer el mensaje después de la orden (un «ccp» suelto no es un documento). */
export const MIN_CUERPO_ORDEN = 20;
/** Mínimo de caracteres y de señales para aceptar un texto SIN orden. */
export const MIN_CHARS_FORMA = 80;
export const MIN_SENALES_FORMA = 3;

/** Cuántas de las 5 señales de forma trae el texto: RFC válido, CP, unidad/cantidad, fecha, clave de producto de 8 dígitos. */
export function senalesDeForma(texto: string): number {
  let n = 0;
  const rfcs = texto.toUpperCase().match(/\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/g) ?? [];
  if (rfcs.some((r) => problemaRfc(r) === null)) n++;
  if (/\b(?:c\.?\s?p\.?|código\s+postal|codigo\s+postal)\s*:?\s*\d{5}\b/i.test(texto)) n++;
  if (/\b(?:kgs?|kilos?|pzas?|pzs?|piezas?|cantidad)\b/i.test(texto)) n++;
  if (/\b\d{1,2}[/-]\d{1,2}[/-](?:\d{2}|\d{4})\b|\b\d{4}-\d{2}-\d{2}\b/.test(texto)) n++;
  if (/(?<![\d.,])\d{8}(?![\d.,])/.test(texto)) n++;
  return n;
}

/** ¿Este mensaje de TEXTO parece un embarque pegado? (Solo de la forma; la compuerta de oficina/buzón es del llamador.) */
export function esTextoCartaPorte(m: MensajeWaDoc): boolean {
  if (m.type !== 'text' || m.mediaId) return false;
  const t = (m.text ?? '').trim();
  if (!t) return false;
  const orden = ORDEN_TEXTO.exec(t);
  if (orden) return t.slice(orden[0].length).trim().length >= MIN_CUERPO_ORDEN;
  return t.length >= MIN_CHARS_FORMA && senalesDeForma(t) >= MIN_SENALES_FORMA;
}

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
  try { return bytesDeBase64(url.slice(i + 1)); } catch { return null; }
}

const EXT_POR_MIME: Record<string, string> = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'text/csv': 'csv', 'application/xml': 'xml', 'text/xml': 'xml', 'application/json': 'json',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

/**
 * `'atendido'` = ya se le contestó a la persona (el processor termina ahí);
 * `'no_aplica'` = no era esto, que siga su camino.
 */
export async function ingerirDesdeWhatsapp(e: EntradaWhatsapp, deps: DepsWhatsapp): Promise<'atendido' | 'no_aplica'> {
  const esTexto = esTextoCartaPorte(e.mensaje);
  if (!esTexto && !esCandidatoCartaPorte(e.mensaje)) return 'no_aplica';
  const mediaId = e.mensaje.mediaId ?? '';
  try {
    // La flota ACTIVÓ el agente (tiene su buzón): sin eso, un PDF de la oficina sigue su camino de siempre y
    // nadie gasta modelo en una flota que no lo pidió.
    const buzon = await repo.buzonDeFlota(e.tenantId);
    if (!buzon || !buzon.activo) return 'no_aplica';
    let bytes: Uint8Array;
    let nombre: string;
    let formatoForzado: 'correo' | undefined;
    let asunto: string | null;
    if (esTexto) {
      // Texto pegado: se guarda tal cual como documento de formato «correo» (idempotente por sha256 del texto).
      const texto = (e.mensaje.text ?? '').trim();
      if (texto.length > MAX_TEXTO_MODELO) {
        await deps.responder(`Ese texto es demasiado largo (más de ${numero(MAX_TEXTO_MODELO)} caracteres). Súbelo como archivo desde el panel de Carta Porte.`);
        return 'atendido';
      }
      bytes = new TextEncoder().encode(texto);
      nombre = `whatsapp-texto-${createHash('sha256').update(bytes).digest('hex').slice(0, 8)}.txt`;
      formatoForzado = 'correo';
      asunto = 'Texto pegado por WhatsApp';
    } else {
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
      const descargados = url ? bytesDeDataUrl(url) : null;
      if (!descargados || descargados.length === 0) { await deps.responder('No pude descargar el archivo 😕. Reenvíalo en un momento.'); return 'atendido'; }
      if (descargados.length > MAX_BYTES_WA) { await deps.responder('Ese archivo pesa demasiado (más de 12 MB).'); return 'atendido'; }
      bytes = descargados;

      // Un XML que no es Carta Porte es la factura de un proveedor: no es de este agente.
      const f = detectarFormato(bytes);
      if (f.ok && f.clase === 'xml' && !/CartaPorte/i.test(textoDeBytes(bytes, 'utf8', 400_000))) return 'no_aplica';

      const ext = EXT_POR_MIME[meta.mimeType] ?? (f.ok ? { pdf: 'pdf', imagen: 'jpg', excel: 'xlsx', csv: 'csv', xml: 'xml', correo: 'txt', json: 'json' }[f.clase] : 'bin');
      nombre = `whatsapp-${mediaId.slice(-8)}.${ext}`;
      asunto = e.mensaje.text?.slice(0, 300) ?? null;
    }
    const r = await recibirDocumento(e.tenantId, {
      canal: 'whatsapp', nombre, bytes, remitente: e.nombreRemitente ? `WhatsApp · ${e.nombreRemitente}`.slice(0, 120) : 'WhatsApp',
      asunto, actorId: e.userId, formatoForzado,
    }, deps);
    if (!r.ok) {
      await deps.responder(r.motivo === 'agente_apagado' ? 'El agente de Carta Porte está apagado en tu flota.' : r.motivo === 'formato' ? `No pude leer ese archivo: ${r.mensaje}` : r.mensaje);
      return 'atendido';
    }
    const liga = `${e.urlBandeja}/${r.documentoId}`;
    if (r.duplicado && r.archivoPurgado) { await deps.responder(`Ese documento ya se había recibido y su archivo se purgó por retención, así que no se volvió a leer 📎. Si es un embarque nuevo, captúralo a mano o pide a tu oficina que lo cargue de nuevo. Registro anterior: ${liga}`); return 'atendido'; }
    if (r.duplicado) { await deps.responder(`Ese documento ya estaba en la bandeja 📎. Revísalo aquí: ${liga}`); return 'atendido'; }

    let leyo = false;
    let partido: number | null = null;
    if (r.estado === 'recibido' && deps.restanteMs() >= (deps.margenProcesoMs ?? 25_000)) {
      try {
        const p = await procesarDocumento(e.tenantId, r.documentoId, { ...deps, signal: deps.senal?.(Math.max(5_000, deps.restanteMs() - 8_000)) });
        leyo = p.ok;
        if (p.ok && p.estado === 'dividido') partido = p.embarques;
      } catch (err) {
        logger.error('cp_wa.proceso_fallo', { documentoId: r.documentoId, err: err instanceof Error ? err.message : String(err) });
      }
    }
    if (partido !== null) {
      // El archivo traía varios embarques: ahora son documentos separados; el original queda como constancia.
      await deps.responder(`Recibí el archivo 📄 y trae ${partido} embarques: lo separé en ${partido} documentos, uno por embarque. Se van leyendo y los verás listos para revisar en la bandeja de Carta Porte: ${e.urlBandeja}`);
      return 'atendido';
    }
    await deps.responder(leyo
      ? `Recibí el documento y ya lo leí 📄. Revísalo y apruébalo aquí: ${liga}`
      : `Recibí el documento 📄. Lo estoy leyendo; en unos minutos lo verás listo para revisar en la bandeja de Carta Porte: ${liga}`);
    return 'atendido';
  } catch (err) {
    logger.error('cp_wa.fallo', { err: err instanceof Error ? err.message : String(err) });
    await deps.responder('Tuve un problema recibiendo el documento 😕. Intenta de nuevo o súbelo desde el panel de Carta Porte.').catch(() => {});
    return 'atendido';
  }
}
