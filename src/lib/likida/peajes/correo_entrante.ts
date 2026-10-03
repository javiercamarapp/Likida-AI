// ═══════════════════════════════════════════════════════════════════════════
// CORREO FIRMADO POR FLOTA — el desglose de peaje llega por correo (0563).
//
// Cada flota tiene su dirección `pj-<token>@<dominio de correo>` (el mismo dominio
// y el MISMO webhook de Resend que los buzones de facturas y de carta porte: la
// ruta `/api/correo/entrante` verifica la firma Svix ANTES de llegar aquí). La
// FLOTA sale del token del DESTINATARIO —24 caracteres al azar— y nunca del
// remitente: el `from` se falsifica en dos líneas; el token no se adivina.
//
// Si la flota declaró los remitentes que sí pueden mandar, un correo de fuera de
// esa lista NO entra (200 «remitente_no_permitido»): a diferencia de un documento
// de carta porte, este archivo se cruza solo y puede disparar un aviso a la
// oficina, así que no se deja que cualquiera con la dirección filtrada alimente
// la conciliación. Sin lista, la dirección ES la credencial (rotable).
//
// Cada adjunto Excel/CSV/PDF se encola con `recibirArchivoPeaje(…, 'correo')`:
// la huella sha256 hace inocuo el «al menos una vez» de Resend. El cron
// `/api/cron/peajes` lo importa y lo cruza como cualquier otro.
//
//   200 = terminado (o nada que hacer: reintentar no cambia nada)
//   503 = reintentable: descarga caída, claim ocupado, cola llena, base caída,
//         canal sin configurar o agente apagado (Resend lo vuelve a mandar).
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';
import { esTokenValido } from '@/lib/correo/buzon';
import { estaApagado } from '../interruptores';
import { reclamarCorreo, finalizarCorreo } from '../carta_porte_docs/repo';
import { remitenteReconocido } from '@/lib/correo/remitente';
import type { CorreoEntrante, DescargaAdjunto } from '../carta_porte_docs/correo_entrante';
import { buzonCorreoPeajesPorToken } from './datos';
import { recibirArchivoPeaje, MAX_ARCHIVO_INGESTA_BYTES } from './ingesta';

export const PREFIJO_PJ = 'pj-';
export const MAX_ADJUNTOS_PEAJES = 5;
const EXT_ADJUNTO = /\.(xlsx|xls|ods|csv|tsv|pdf)$/i;

export function direccionPj(token: string, dominio: string | null | undefined): string | null {
  if (!dominio || !esTokenValido(token)) return null;
  return `${PREFIJO_PJ}${token}@${dominio}`;
}

/** El token de una dirección `pj-<token>@<dominio>`; `null` si el dominio no es el nuestro o la forma no es. */
export function tokenPjDeDireccion(direccion: string, dominio: string | null | undefined): string | null {
  if (!dominio) return null;
  const angulos = /<([^>]+)>/.exec(direccion);
  const limpia = (angulos ? angulos[1] : direccion).trim().toLowerCase();
  const arroba = limpia.lastIndexOf('@');
  if (arroba === -1 || limpia.slice(arroba + 1) !== dominio.toLowerCase()) return null;
  const local = limpia.slice(0, arroba);
  if (!local.startsWith(PREFIJO_PJ)) return null;
  const token = local.slice(PREFIJO_PJ.length).split('+')[0];
  return esTokenValido(token) ? token : null;
}

/** Un buzón de peajes entre los destinatarios; dos buzones distintos = ninguno (no se adivina a cuál iba). */
export function tokenPjDeDestinatarios(direcciones: readonly string[], dominio: string | null | undefined): string | null {
  const t = new Set<string>();
  for (const d of direcciones) { const x = tokenPjDeDireccion(d, dominio); if (x) t.add(x); }
  return t.size === 1 ? [...t][0] : null;
}

/** Solo el nombre del archivo: sin rutas, sin caracteres de control ni de dirección de texto. */
export function nombreAdjuntoSeguro(nombre: string | null | undefined): string {
  const base = String(nombre ?? '').split(/[\\/]/).pop() ?? '';
  const limpio = base.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁯]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return limpio === '' || limpio === '.' || limpio === '..' ? 'desglose' : limpio;
}

export interface DepsCorreoPeajes {
  /** Baja un adjunto de Resend (con su timeout). El real vive en la ruta; las pruebas pasan un doble. */
  descargar: (emailId: string, adjuntoId: string) => Promise<DescargaAdjunto>;
  /** Para pruebas: reemplaza `estaApagado('agente:peajes')`. */
  apagado?: () => Promise<boolean>;
}

export interface RespuestaCorreoPeajes { status: 200 | 503; cuerpo: Record<string, unknown> }

export async function atenderCorreoPeajes(token: string, correo: CorreoEntrante, deps: DepsCorreoPeajes): Promise<RespuestaCorreoPeajes> {
  let buzon;
  try {
    buzon = await buzonCorreoPeajesPorToken(token);
  } catch (e) {
    logger.error('peajes_correo.buzon_lectura', { emailId: correo.emailId, err: e instanceof Error ? e.message : String(e) });
    return { status: 503, cuerpo: { error: 'no se pudo resolver la flota' } };
  }
  if (!buzon) { logger.warn('peajes_correo.buzon_desconocido', { emailId: correo.emailId }); return { status: 200, cuerpo: { ok: true, ignorado: 'buzon_desconocido' } }; }
  if (!buzon.activo) return { status: 200, cuerpo: { ok: true, ignorado: 'buzon_apagado' } };
  const tenantId = buzon.tenantId;

  const adjuntos = (correo.attachments ?? []).filter((a) => a.id && EXT_ADJUNTO.test(a.filename ?? '')).slice(0, MAX_ADJUNTOS_PEAJES);
  if (adjuntos.length === 0) return { status: 200, cuerpo: { ok: true, ignorado: 'sin_adjuntos' } };

  if (buzon.remitentes.length > 0 && remitenteReconocido(correo.from, buzon.remitentes) !== true) {
    // El remitente no se loguea completo: es un dato personal y el `email_id` alcanza para rastrearlo en Resend.
    logger.warn('peajes_correo.remitente_no_permitido', { emailId: correo.emailId, tenantId });
    return { status: 200, cuerpo: { ok: true, ignorado: 'remitente_no_permitido' } };
  }

  // El interruptor ANTES de consumir el correo: 503 para que vuelva cuando lo enciendan (un 200 lo perdería).
  if (await (deps.apagado ?? (() => estaApagado('agente:peajes')))()) {
    logger.warn('peajes_correo.agente_apagado', { emailId: correo.emailId, tenantId });
    return { status: 503, cuerpo: { error: 'el agente de peajes está apagado' } };
  }
  if (!process.env.RESEND_API_KEY) {
    logger.error('peajes_correo.sin_llave', { emailId: correo.emailId });
    return { status: 503, cuerpo: { error: 'canal no configurado' } };
  }

  const claim = await reclamarCorreo(correo.emailId);
  if (claim.resultado === 'applied') return { status: 200, cuerpo: { ok: true, ignorado: 'ya_procesado' } };
  if (claim.resultado === 'busy') return { status: 503, cuerpo: { error: 'correo en proceso' } };

  let recibidos = 0; let duplicados = 0; let ignorados = 0; let transitorios = 0;
  try {
    for (const a of adjuntos) {
      const d = await deps.descargar(correo.emailId, a.id as string);
      if (!d.ok) { if (d.transitorio) transitorios++; else ignorados++; continue; }
      if (d.bytes.length === 0 || d.bytes.length > MAX_ARCHIVO_INGESTA_BYTES) { ignorados++; continue; }
      const r = await recibirArchivoPeaje(tenantId, { nombre: nombreAdjuntoSeguro(a.filename), proveedor: null, contenido: Buffer.from(d.bytes) }, 'correo');
      if (r.ok) { if (r.duplicado) duplicados++; else recibidos++; continue; }
      // Cola llena o la base no contestó: reintentable (la huella evita duplicar lo ya guardado).
      logger.warn('peajes_correo.no_encolado', { emailId: correo.emailId, codigo: r.codigo });
      transitorios++;
    }
  } catch (e) {
    logger.error('peajes_correo.recibir_fallo', { emailId: correo.emailId, err: e instanceof Error ? e.message : String(e) });
    await finalizarCorreo(correo.emailId, claim.token, false, 'fallo al guardar');
    return { status: 503, cuerpo: { error: 'no se pudo guardar el correo' } };
  }

  if (transitorios > 0) {
    await finalizarCorreo(correo.emailId, claim.token, false, 'no se pudieron recibir todos los adjuntos');
    return { status: 503, cuerpo: { error: 'no se pudieron recibir todos los adjuntos' } };
  }
  if (!(await finalizarCorreo(correo.emailId, claim.token, true))) return { status: 503, cuerpo: { error: 'no se pudo finalizar el correo' } };
  logger.info('peajes_correo.procesado', { emailId: correo.emailId, tenantId, recibidos, duplicados, ignorados });
  return { status: 200, cuerpo: { ok: true, recibidos, duplicados, ignorados } };
}
