// ═══════════════════════════════════════════════════════════════════════════
// CORREO FIRMADO POR FLOTA — el segundo canal de ingesta.
//
// Cada flota tiene su dirección `cp-<token>@<dominio de correo>` (el mismo dominio
// y el mismo webhook de Resend que el buzón de facturas). «Firmado» significa dos
// cosas, y las dos pasan ANTES de leer una línea del correo:
//
//   1. el webhook de Resend va firmado (Svix/HMAC: lo verifica la ruta
//      `/api/correo/entrante` antes de llegar aquí; sin firma válida no hay
//      lectura);
//   2. la FLOTA sale del token del DESTINATARIO —24 caracteres al azar— y nunca del
//      remitente: el `from` se falsifica en dos líneas; el token no se adivina.
//
// Además, la flota puede declarar los remitentes que usan sus clientes: un correo
// de fuera de esa lista entra igual (a revisión, con aviso), no se descarta en
// silencio — un cliente nuevo no debe perder su primer embarque.
//
// Los correos se reintentan (Resend ante cualquier no-2xx): el claim por email_id y
// la huella del documento vuelven inocuo el «al menos una vez».
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';
import { esTokenValido, generarToken } from '@/lib/correo/buzon';
import { estaApagado } from '../interruptores';
import { nombreArchivoSeguro, procesarDocumento, recibirDocumento, type DepsServicio } from './servicio';
import * as repo from './repo';

export const PREFIJO_CP = 'cp-';
/** El adjunto más grande que se descarga (el tope de lectura de un documento es 12 MB). */
export const MAX_ADJUNTO_BYTES = 8 * 1024 * 1024;
export const MAX_ADJUNTOS = 10;
/** El cuerpo solo cuenta como documento si tiene algo más que «gracias». */
export const MIN_CUERPO_CHARS = 80;
const EXT_ADJUNTO = /\.(pdf|xlsx|xls|csv|xml|png|jpe?g|webp|eml|txt)$/i;

export const generarTokenCp = generarToken;

export function direccionCp(token: string, dominio: string | null | undefined): string | null {
  if (!dominio || !esTokenValido(token)) return null;
  return `${PREFIJO_CP}${token}@${dominio}`;
}

/** El token de una dirección `cp-<token>@<dominio>`; `null` si el dominio no es el nuestro o la forma no es. */
export function tokenCpDeDireccion(direccion: string, dominio: string | null | undefined): string | null {
  if (!dominio) return null;
  const angulos = /<([^>]+)>/.exec(direccion);
  const limpia = (angulos ? angulos[1] : direccion).trim().toLowerCase();
  const arroba = limpia.lastIndexOf('@');
  if (arroba === -1 || limpia.slice(arroba + 1) !== dominio.toLowerCase()) return null;
  const local = limpia.slice(0, arroba);
  if (!local.startsWith(PREFIJO_CP)) return null;
  const token = local.slice(PREFIJO_CP.length).split('+')[0];
  return esTokenValido(token) ? token : null;
}

/** Un buzón de carta porte entre los destinatarios; dos buzones distintos = ninguno (no se adivina a cuál iba). */
export function tokenCpDeDestinatarios(direcciones: readonly string[], dominio: string | null | undefined): string | null {
  const t = new Set<string>();
  for (const d of direcciones) { const x = tokenCpDeDireccion(d, dominio); if (x) t.add(x); }
  return t.size === 1 ? [...t][0] : null;
}

/** `null` = la flota no declaró lista (no hay con qué comparar); `true/false` = coincide o no (por correo o por dominio). */
export function remitenteReconocido(remitente: string | null | undefined, permitidos: readonly string[]): boolean | null {
  if (permitidos.length === 0) return null;
  const m = /([a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,}))/i.exec(remitente ?? '');
  if (!m) return false;
  const correo = m[1].toLowerCase(); const dominio = m[2].toLowerCase();
  return permitidos.some((p) => { const x = p.trim().toLowerCase(); return x === correo || x === dominio || x === `@${dominio}`; });
}

export interface AdjuntoEntrante { id?: string; filename?: string; content_type?: string }
export interface CorreoEntrante {
  emailId: string;
  from?: string;
  subject?: string;
  text?: string;
  html?: string;
  attachments?: AdjuntoEntrante[];
}

export type DescargaAdjunto = { ok: true; bytes: Uint8Array } | { ok: false; transitorio: boolean };

export interface DepsCorreo extends DepsServicio {
  /** Baja un adjunto de Resend (con su timeout). El real vive en la ruta; las pruebas pasan un doble. */
  descargar: (emailId: string, adjuntoId: string) => Promise<DescargaAdjunto>;
  /** Milisegundos de reloj que quedan para procesar documentos (después de recibirlos todos). */
  restanteMs: () => number;
  /** Tiempo mínimo que debe quedar para intentar extraer un documento más. */
  margenProcesoMs?: number;
}

export interface RespuestaCorreo { status: 200 | 503; cuerpo: Record<string, unknown> }

function htmlATexto(html: string): string {
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|tr|li)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

/**
 * Atiende un correo YA verificado (firma Svix) cuyo destinatario es un buzón de carta porte.
 * Devuelve el status y el cuerpo; la ruta solo los envuelve en una respuesta HTTP.
 *   200 = terminado (o nada que hacer: reintentar no cambia nada)
 *   503 = reintentable (Resend lo vuelve a mandar): descarga caída, claim ocupado, canal sin configurar o agente apagado.
 */
export async function atenderCorreoCartaPorte(token: string, correo: CorreoEntrante, deps: DepsCorreo): Promise<RespuestaCorreo> {
  const buzon = await repo.buzonPorToken(token);
  if (!buzon) { logger.warn('cp_correo.buzon_desconocido', { emailId: correo.emailId }); return { status: 200, cuerpo: { ok: true, ignorado: 'buzon_desconocido' } }; }
  if (!buzon.activo) return { status: 200, cuerpo: { ok: true, ignorado: 'buzon_apagado' } };
  const tenantId = buzon.tenantId;

  const adjuntos = (correo.attachments ?? []).filter((a) => a.id && EXT_ADJUNTO.test(a.filename ?? '')).slice(0, MAX_ADJUNTOS);
  const cuerpoTexto = (correo.text && correo.text.trim().length > 0 ? correo.text : htmlATexto(correo.html ?? '')).trim();
  const hayCuerpo = cuerpoTexto.length >= MIN_CUERPO_CHARS;
  if (adjuntos.length === 0 && !hayCuerpo) {
    return { status: 200, cuerpo: { ok: true, ignorado: 'sin_contenido' } };
  }

  // El interruptor ANTES de consumir el correo: 503 para que vuelva cuando lo enciendan (un 200 lo perdería).
  if (await (deps.apagado ?? (() => estaApagado('agente:carta_porte')))()) {
    logger.warn('cp_correo.agente_apagado', { emailId: correo.emailId, tenantId });
    return { status: 503, cuerpo: { error: 'el agente de Carta Porte está apagado' } };
  }
  if (adjuntos.length > 0 && !process.env.RESEND_API_KEY) {
    logger.error('cp_correo.sin_llave', { emailId: correo.emailId });
    return { status: 503, cuerpo: { error: 'canal no configurado' } };
  }

  const claim = await repo.reclamarCorreo(correo.emailId);
  if (claim.resultado === 'applied') return { status: 200, cuerpo: { ok: true, ignorado: 'ya_procesado' } };
  if (claim.resultado === 'busy') return { status: 503, cuerpo: { error: 'correo en proceso' } };

  const reconocido = remitenteReconocido(correo.from, buzon.remitentesPermitidos);
  let caidas = 0; let ignorados = 0; let recibidos = 0; let duplicados = 0;
  const porProcesar: string[] = [];
  const recibir = async (nombre: string, bytes: Uint8Array, forzado?: 'correo'): Promise<void> => {
    const r = await recibirDocumento(tenantId, {
      canal: 'correo', nombre, bytes, remitente: correo.from ?? null, asunto: correo.subject ?? null, remitenteReconocido: reconocido, formatoForzado: forzado,
    }, deps);
    if (!r.ok) {
      // Un formato ilegible o un agente apagado entre medias: permanente, no se reintenta.
      ignorados++;
      logger.info('cp_correo.rechazado', { emailId: correo.emailId, motivo: r.motivo });
      return;
    }
    if (r.duplicado) { duplicados++; return; }
    recibidos++;
    if (r.estado === 'recibido') porProcesar.push(r.documentoId);
  };

  try {
    for (const a of adjuntos) {
      const d = await deps.descargar(correo.emailId, a.id as string);
      if (!d.ok) { if (d.transitorio) caidas++; else ignorados++; continue; }
      if (d.bytes.length > MAX_ADJUNTO_BYTES) { ignorados++; continue; }
      await recibir(nombreArchivoSeguro(a.filename), d.bytes);
    }
    if (hayCuerpo) {
      const enc = [correo.from ? `De: ${correo.from}` : null, correo.subject ? `Asunto: ${correo.subject}` : null].filter(Boolean).join('\n');
      await recibir('cuerpo-del-correo.txt', new TextEncoder().encode(`${enc}\n\n${cuerpoTexto}`.slice(0, 200_000)), 'correo');
    }
  } catch (e) {
    // La base o Storage fallaron: transitorio. El claim se libera y Resend reintenta (la huella evita duplicar lo ya guardado).
    logger.error('cp_correo.recibir_fallo', { emailId: correo.emailId, err: e instanceof Error ? e.message : String(e) });
    await repo.finalizarCorreo(correo.emailId, claim.token, false, 'fallo al guardar');
    return { status: 503, cuerpo: { error: 'no se pudo guardar el correo' } };
  }

  if (caidas > 0) {
    await repo.finalizarCorreo(correo.emailId, claim.token, false, 'no se pudieron descargar todos los adjuntos');
    return { status: 503, cuerpo: { error: 'no se pudieron descargar todos los adjuntos' } };
  }

  // Extraer lo que alcance en el reloj; lo demás queda «recibido» y se procesa desde la bandeja.
  let procesados = 0;
  for (const id of porProcesar) {
    if (deps.restanteMs() < (deps.margenProcesoMs ?? 25_000)) break;
    try {
      const r = await procesarDocumento(tenantId, id, deps);
      if (r.ok) procesados++;
    } catch (e) {
      logger.error('cp_correo.proceso_fallo', { emailId: correo.emailId, documentoId: id, err: e instanceof Error ? e.message : String(e) });
    }
  }

  if (!(await repo.finalizarCorreo(correo.emailId, claim.token, true))) {
    return { status: 503, cuerpo: { error: 'no se pudo finalizar el correo' } };
  }
  logger.info('cp_correo.procesado', { emailId: correo.emailId, tenantId, recibidos, duplicados, ignorados, procesados });
  return { status: 200, cuerpo: { ok: true, recibidos, duplicados, ignorados, procesados, pendientes: porProcesar.length - procesados } };
}
