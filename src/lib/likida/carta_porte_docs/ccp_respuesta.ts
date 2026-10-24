// ═══════════════════════════════════════════════════════════════════════════
// RESPUESTA AUTOMÁTICA CON EL CCP YA TIMBRADO (T-A3-33).
//
// Qué resuelve (9df88631 10:59–11:32): hoy, al quedar timbrado el CCP en el TMS del cliente, la capturista lo descarga
// y se lo comparte al cliente que lo pidió. Si el TMS avisa del timbrado (PDF + XML), este módulo lo registra y, solo
// si la flota lo activó, contesta por correo al remitente original del documento. Es un DESEO del cliente, no un
// requisito, y B-7 sigue abierto (¿el TMS avisa o se le consulta?): por eso el interruptor `responder_ccp` nace APAGADO.
//
// ESTE MÓDULO NO TIMBRA NI CREA CCP. Registra el UUID fiscal que el TMS ya generó y reparte los archivos que el TMS
// entregó; nunca los fabrica ni los modifica.
//
// ── LAS REGLAS (cada una tiene su prueba) ─────────────────────────────────────────────────────────────────────
//   1. El XML tiene que SER un CCP timbrado: se lee con el lector oficial (`extraerCartaPorteXml`) y trae un
//      `TimbreFiscalDigital@UUID`. Sin eso no se guarda nada.
//   2. La `referencia` tiene que ser de un envío PROPIO de la flota de la credencial. Una referencia ajena o
//      inventada es «no encontrado» (404), sin guardar y sin correo: no se confirma ni que exista en otra flota.
//   3. Idempotente por UUID fiscal: el mismo aviso dos veces es UNA fila y UN correo (el TMS reintenta).
//   4. Se responde solo si (a) la flota activó «responder al cliente», (b) el remitente del documento fue reconocido
//      (`remitente_reconocido`), y (c) ya se le respondió antes a ese mismo destino. La PRIMERA vez por cliente queda
//      `pendiente_confirmacion` hasta que una persona la confirme (`confirmarYResponder`).
//   5. El correo sale con el candado atómico de la base (`cp_ccp_marcar_respondido`): dos hilos nunca mandan dos veces.
//      Si el correo no sale, el candado se suelta y queda `error_envio` (el siguiente aviso del mismo UUID reintenta).
//   6. Adjuntos ≤ 8 MB cada uno (`MAX_ADJUNTO_BYTES`); sin PII en logs (jamás una dirección, un folio o un UUID).
//
// Todo entra por `DepsCcp`: se prueba entero con dobles, sin red ni base. El acceso real vive en `ccp_respuesta_repo.ts`.
// ═══════════════════════════════════════════════════════════════════════════

import { XMLValidator } from 'fast-xml-parser';
import type { Correo } from '@/lib/correo/plantilla';
import type { ResultadoEnvio } from '@/lib/correo/enviar';
import { MAX_ADJUNTO_BYTES } from './correo_entrante';
import { parsearXml } from './contenido';
import { bajar, extraerCartaPorteXml } from './xml_ccp';
import { direccionDeRemitente } from '@/lib/correo/remitente';

export { MAX_ADJUNTO_BYTES };

export type EstadoCcpTimbrado = 'guardado' | 'pendiente_confirmacion' | 'respondido' | 'error_envio';

/** Lo que guarda la base por cada aviso (una fila por UUID fiscal y flota). */
export interface FilaCcp {
  id: string;
  tenantId: string;
  documentoId: string;
  envioId: string;
  uuid: string;
  pdfRuta: string;
  xmlRuta: string;
  destinoCorreo: string | null;
  estado: EstadoCcpTimbrado;
  respondidoEn: string | null;
}

/** El envío propio al que corresponde la referencia, con lo mínimo del documento de origen. */
export interface EnvioPropio {
  envioId: string;
  documentoId: string;
  /** Quién mandó el documento, tal cual llegó (`Nombre <a@b>` o `a@b`); `null` si no vino de un correo. */
  remitente: string | null;
  remitenteReconocido: boolean | null;
}

export interface NuevaFilaCcp {
  tenantId: string; documentoId: string; envioId: string; uuid: string; pdfRuta: string; xmlRuta: string;
  destinoCorreo: string | null; estado: 'guardado' | 'pendiente_confirmacion';
}

export interface DepsCcp {
  /** El envío de ESTA flota cuya referencia en el TMS coincide; `null` si no hay (o es de otra flota). */
  buscarEnvio(tenantId: string, referencia: string): Promise<EnvioPropio | null>;
  /** ¿La flota activó «responder al cliente»? Sin la migración 0794 devuelve `'sin_migracion'`. */
  respuestaActiva(tenantId: string): Promise<boolean | 'sin_migracion'>;
  buscarPorUuid(tenantId: string, uuid: string): Promise<FilaCcp | null>;
  subirArchivo(ruta: string, bytes: Uint8Array, mime: string): Promise<void>;
  descargarArchivo(ruta: string): Promise<Uint8Array>;
  /** Inserta; si el UUID ya existe (carrera con otro aviso) devuelve la fila vigente con `creada: false`. */
  insertar(f: NuevaFilaCcp): Promise<{ creada: boolean; fila: FilaCcp }>;
  /** ¿Ya se le respondió alguna vez a este destino en esta flota? (la confirmación humana es «la primera vez por cliente») */
  destinoYaConfirmado(tenantId: string, destino: string): Promise<boolean>;
  /** Fija el destino de una fila aún sin responder (la confirmación humana puede corregirlo). */
  fijarDestino(tenantId: string, id: string, destino: string): Promise<void>;
  /** El candado atómico (`cp_ccp_marcar_respondido`): `true` solo para UNA llamada. */
  marcarRespondido(tenantId: string, id: string): Promise<boolean>;
  /** Suelta el candado cuando el correo NO salió (`cp_ccp_liberar_respuesta`). */
  liberarRespuesta(tenantId: string, id: string): Promise<boolean>;
  enviarCorreo(para: string, correo: Correo, adjuntos: Array<{ filename: string; content: string; contentType: string }>, idempotencyKey: string): Promise<ResultadoEnvio>;
  /** Telemetría sin PII (nombre del evento + contadores). */
  registrar?(evento: string, datos: Record<string, string | number | boolean>): void;
}

export type CodigoErrorCcp = 'adjunto_grande' | 'xml_invalido' | 'pdf_invalido' | 'no_encontrado' | 'sin_migracion';

export type ResultadoCcp =
  | { ok: true; duplicado: boolean; estado: EstadoCcpTimbrado; respondido: boolean }
  | { ok: false; codigo: CodigoErrorCcp; mensaje: string };

const falla = (codigo: CodigoErrorCcp, mensaje: string): ResultadoCcp => ({ ok: false, codigo, mensaje });

// ── Lectura del XML ─────────────────────────────────────────────────────────

const UUID_FISCAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface CcpLeido { uuid: string; folio: string | null }

/** Lee el XML entregado por el TMS: tiene que ser un CCP con timbre. `null` = no lo es (la razón no se detalla: no es un validador). */
export function leerCcpTimbrado(bytes: Uint8Array): CcpLeido | null {
  let texto: string;
  try { texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''); } catch { return null; }
  if (/<!ENTITY/i.test(texto)) return null;
  if (XMLValidator.validate(texto) !== true) return null;
  let arbol: unknown;
  try { arbol = parsearXml(texto); } catch { return null; }
  const extraccion = extraerCartaPorteXml(arbol);
  if (!extraccion) return null;
  const timbre = bajar(arbol, 'Comprobante', 'Complemento', 'TimbreFiscalDigital');
  const crudo = timbre && typeof timbre === 'object' ? (timbre as Record<string, unknown>)['@_UUID'] : null;
  const uuid = typeof crudo === 'string' ? crudo.trim().toLowerCase() : '';
  if (!UUID_FISCAL.test(uuid)) return null;
  const f = extraccion.campos.folio_cliente?.valor;
  return { uuid, folio: typeof f === 'string' || typeof f === 'number' ? String(f) : null };
}

const esPdf = (b: Uint8Array): boolean => b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d; // «%PDF-»

/** El correo del remitente original (`Nombre <a@b>` o `a@b`), en minúsculas; `null` si no hay uno utilizable. */
export function destinoDeRemitente(remitente: string | null | undefined): string | null {
  return direccionDeRemitente(remitente); // A37-A3-16/S31-09: solo la dirección real (entre < >), nunca el nombre visible
}

/** El folio va en el asunto, pero acotado y sin saltos: es dato del cliente y no arrastra texto libre. */
const folioSeguro = (f: string | null): string => (f ?? '').replace(/[^\p{L}\p{N}._\-/ ]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 40);

const base64 = (b: Uint8Array): string => Buffer.from(b).toString('base64');

/** El correo al cliente: el PDF y el XML tal cual los entregó el TMS. Sin importes ni nombres: solo folio y UUID fiscal. */
export function correoCcpTimbrado(uuid: string, folio: string | null): Correo {
  const f = folioSeguro(folio);
  return {
    asunto: f ? `Carta Porte timbrada: ${f}` : 'Carta Porte timbrada',
    avance: 'Adjuntamos el PDF y el XML de la Carta Porte timbrada.',
    titulo: 'Carta Porte timbrada',
    parrafos: [
      'Adjuntamos el PDF y el XML de la Carta Porte ya timbrada del servicio que nos solicitaste.',
      ...(f ? [`Folio: ${f}.`] : []),
    ],
    datos: [['UUID fiscal', uuid]],
    tono: 'neutral',
    porQueLoRecibes: 'Recibes este correo porque nos enviaste el documento de embarque de este servicio; la respuesta se genera cuando el sistema registra el timbrado.',
  };
}

// ── El envío con candado ────────────────────────────────────────────────────

/** Toma el candado, manda el correo y, si no salió, lo suelta. Devuelve si el cliente recibió la respuesta. */
async function responder(deps: DepsCcp, fila: FilaCcp, destino: string, xml: Uint8Array, pdf: Uint8Array, folio: string | null): Promise<{ respondido: boolean; estado: EstadoCcpTimbrado }> {
  // El destino se fija ANTES de tomar el candado: el RPC exige uno y la fila debe llevar el que se usó.
  if (fila.destinoCorreo !== destino) await deps.fijarDestino(fila.tenantId, fila.id, destino);
  if (!(await deps.marcarRespondido(fila.tenantId, fila.id))) {
    // Otro hilo ganó el candado (o ya estaba respondido): no se manda un segundo correo.
    deps.registrar?.('ccp_respuesta.candado_perdido', { tenant: fila.tenantId });
    return { respondido: false, estado: fila.estado };
  }
  const res = await deps.enviarCorreo(
    destino,
    correoCcpTimbrado(fila.uuid, folio),
    [
      { filename: `${fila.uuid}.pdf`, content: base64(pdf), contentType: 'application/pdf' },
      { filename: `${fila.uuid}.xml`, content: base64(xml), contentType: 'application/xml' },
    ],
    `ccp-${fila.tenantId}-${fila.uuid}`,
  ).catch((): ResultadoEnvio => ({ ok: false, motivo: 'red', detalle: 'excepción' }));
  if (res.ok) return { respondido: true, estado: 'respondido' };
  await deps.liberarRespuesta(fila.tenantId, fila.id);
  deps.registrar?.('ccp_respuesta.correo_no_salio', { tenant: fila.tenantId, motivo: res.motivo });
  return { respondido: false, estado: 'error_envio' };
}

// ── El aviso del TMS ────────────────────────────────────────────────────────

export interface EntradaCcp { tenantId: string; referencia: string; xml: Uint8Array; pdf: Uint8Array }

/**
 * Registra el aviso del TMS y, si corresponde, contesta al cliente. Nunca lanza por un correo que no salió: lo que se
 * contesta al TMS es si SE GUARDÓ el aviso; el correo es un efecto aparte con su propio estado.
 */
export async function procesarCcpTimbrado(deps: DepsCcp, e: EntradaCcp): Promise<ResultadoCcp> {
  if (e.xml.length > MAX_ADJUNTO_BYTES || e.pdf.length > MAX_ADJUNTO_BYTES) {
    return falla('adjunto_grande', `Cada archivo (PDF y XML) puede pesar hasta ${MAX_ADJUNTO_BYTES / 1024 / 1024} MB.`);
  }
  if (!esPdf(e.pdf)) return falla('pdf_invalido', 'El PDF no es un PDF válido.');
  const ccp = leerCcpTimbrado(e.xml);
  if (!ccp) return falla('xml_invalido', 'El XML no es una Carta Porte timbrada (falta el complemento o el UUID fiscal).');

  const envio = await deps.buscarEnvio(e.tenantId, e.referencia);
  if (!envio) return falla('no_encontrado', 'No hay un envío de tu flota con esa referencia.');

  const activa = await deps.respuestaActiva(e.tenantId);
  if (activa === 'sin_migracion') return falla('sin_migracion', 'La función aún no está disponible en esta cuenta.');

  // ¿Ya lo teníamos? (el TMS reintenta). Nunca se reenvía el correo desde aquí.
  const previa = await deps.buscarPorUuid(e.tenantId, ccp.uuid);
  if (previa) {
    if (previa.envioId !== envio.envioId) return falla('no_encontrado', 'No hay un envío de tu flota con esa referencia.');
    // A37-S31-08: un `error_envio` NO se reenvía solo. Si el proveedor aceptó el correo y la respuesta se perdió, un
    // reintento pasada su ventana de idempotencia duplicaría PDF y XML al cliente; lo decide una persona (`confirmarYResponder`).
    return { ok: true, duplicado: true, estado: previa.estado, respondido: previa.estado === 'respondido' };
  }

  // Decisión ANTES de insertar: la fila nace en su estado definitivo.
  const destino = destinoDeRemitente(envio.remitente);
  let estado: 'guardado' | 'pendiente_confirmacion' = 'guardado';
  let enviar = false;
  if (activa) {
    const conocido = destino !== null && envio.remitenteReconocido === true && await deps.destinoYaConfirmado(e.tenantId, destino);
    if (conocido) enviar = true; else estado = 'pendiente_confirmacion';
  }

  const base = `${e.tenantId}/ccp/${ccp.uuid}`;
  const pdfRuta = `${base}.pdf`;
  const xmlRuta = `${base}.xml`;
  await deps.subirArchivo(pdfRuta, e.pdf, 'application/pdf');
  await deps.subirArchivo(xmlRuta, e.xml, 'application/xml');
  const { creada, fila } = await deps.insertar({
    tenantId: e.tenantId, documentoId: envio.documentoId, envioId: envio.envioId, uuid: ccp.uuid, pdfRuta, xmlRuta,
    destinoCorreo: destino, estado,
  });
  // Carrera con otro aviso del mismo UUID: el que perdió no responde.
  if (!creada) return { ok: true, duplicado: true, estado: fila.estado, respondido: fila.estado === 'respondido' };

  if (!enviar || destino === null) return { ok: true, duplicado: false, estado, respondido: false };
  const r = await responder(deps, fila, destino, e.xml, e.pdf, ccp.folio);
  return { ok: true, duplicado: false, estado: r.estado, respondido: r.respondido };
}

// ── La confirmación humana ──────────────────────────────────────────────────

export type ResultadoConfirmacion =
  | { ok: true; respondido: boolean; estado: EstadoCcpTimbrado }
  | { ok: false; motivo: 'no_encontrada' | 'ya_respondida' | 'no_aplica' | 'sin_destino' | 'destino_invalido' };

/**
 * La primera vez por cliente (o un remitente no reconocido) la confirma una persona de la flota; esta función es lo que su
 * botón llama. Descarga los archivos guardados y manda el mismo correo. `destino` es opcional: una persona puede corregir
 * a quién va. Solo actúa sobre filas `pendiente_confirmacion` o `error_envio` de SU flota.
 */
export async function confirmarYResponder(
  deps: DepsCcp, tenantId: string, fila: FilaCcp | null, destino?: string,
): Promise<ResultadoConfirmacion> {
  if (!fila || fila.tenantId !== tenantId) return { ok: false, motivo: 'no_encontrada' };
  if (fila.estado === 'respondido') return { ok: false, motivo: 'ya_respondida' };
  if (fila.estado === 'guardado') return { ok: false, motivo: 'no_aplica' }; // la flota no tenía activada la respuesta: solo se guardó
  const limpio = destino === undefined ? null : destino.trim().toLowerCase();
  if (limpio !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(limpio)) return { ok: false, motivo: 'destino_invalido' };
  const elegido = limpio ?? fila.destinoCorreo;
  if (!elegido) return { ok: false, motivo: 'sin_destino' };
  const [xml, pdf] = await Promise.all([deps.descargarArchivo(fila.xmlRuta), deps.descargarArchivo(fila.pdfRuta)]);
  const folio = leerCcpTimbrado(xml)?.folio ?? null;
  const r = await responder(deps, fila, elegido, xml, pdf, folio);
  return { ok: true, respondido: r.respondido, estado: r.estado };
}
