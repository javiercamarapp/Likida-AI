// ═══════════════════════════════════════════════════════════════════════════
// SERVICIO — recibir un documento (de cualquier canal) y procesarlo.
//
// Los tres canales (carga manual, correo firmado por flota, WhatsApp) terminan en
// `recibirDocumento`: UNA puerta, las mismas reglas. Lo que NO es un documento
// legible o seguro se rechaza ANTES de guardarse; lo que sí, se guarda con su huella
// (el mismo archivo por otro canal es el mismo documento) y se extrae con un claim
// con lease: dos invocaciones no extraen —ni le pagan al modelo— dos veces.
//
// Fallar cerrado: si el agente está apagado, no se recibe; si el modelo falla, el
// documento queda `fallido` con el motivo (y reintentable), nunca «sin campos».
// ═══════════════════════════════════════════════════════════════════════════

import { createHash, randomUUID } from 'node:crypto';
import { logger } from '@/lib/logger';
import { esErrorDePresupuesto } from '@/lib/llm/budget';
import { estaApagado } from '../interruptores';
import { MAX_BYTES_DOC, detectarFormato, prepararContenido, type FormatoDoc } from './contenido';
import { extraerDocumento, type LlmExtractor, type ResultadoExtraccion } from './extractor';
import { confianzaMinimaCritica, validarExtraccion, type Hallazgo, type ResultadoValidacion } from './validacion';
import type { Extraccion } from './campos';
import * as repo from './repo';
import type { CanalDoc, DocumentoFila, MetaExtraccion } from './repo';

export const DIAS_RETENCION = { recibido: 180, aprobado: 365, cerrado: 90 } as const;
export const MAX_INTENTOS = 5;

const diasDespues = (d: Date, dias: number): string => new Date(d.getTime() + dias * 86_400_000).toISOString();

export interface DepsServicio {
  /** Fábrica del extractor. Por defecto el real (OpenRouter); las pruebas pasan un doble. */
  llm?: (tenantId: string, canal: CanalDoc) => LlmExtractor | Promise<LlmExtractor>;
  ahora?: () => Date;
  /** Para probar sin tocar interruptores. */
  apagado?: () => Promise<boolean>;
}

async function llmPorDefecto(tenantId: string, canal: CanalDoc): Promise<LlmExtractor> {
  const { crearExtractorOpenRouter } = await import('./extractor_openrouter');
  // Lo que una persona espera (carga manual, WhatsApp) va por el carril interactivo; el correo, de fondo.
  return crearExtractorOpenRouter(tenantId, canal === 'correo' ? 'ocr_lote' : 'interactivo');
}

const CLASE_A_FORMATO: Record<string, FormatoDoc> = { pdf: 'pdf_texto', imagen: 'imagen', excel: 'excel', csv: 'csv', xml: 'xml', correo: 'correo' };

/** El nombre del archivo tal como lo mandó un tercero: sin rutas, sin controles, con tope. */
export function nombreArchivoSeguro(nombre: string | null | undefined): string {
  const base = String(nombre ?? '').split(/[\\/]/).pop() ?? '';
  const limpio = base.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁯]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return limpio === '' || limpio === '.' || limpio === '..' ? 'documento' : limpio;
}

export interface EntradaDocumento {
  canal: CanalDoc;
  nombre: string;
  bytes: Uint8Array;
  remitente?: string | null;
  asunto?: string | null;
  clienteId?: string | null;
  remitenteReconocido?: boolean | null;
  actorId?: string | null;
  /** El CUERPO de un correo no se detecta por bytes (podría parecer CSV): se declara. */
  formatoForzado?: 'correo';
}

export type ResultadoRecepcion =
  | { ok: true; documentoId: string; duplicado: boolean; estado: repo.EstadoDoc; formato: FormatoDoc }
  | { ok: false; motivo: 'agente_apagado' | 'formato' | 'cliente'; mensaje: string };

export async function recibirDocumento(tenantId: string, e: EntradaDocumento, deps: DepsServicio = {}): Promise<ResultadoRecepcion> {
  const ahora = (deps.ahora ?? (() => new Date()))();
  if (await (deps.apagado ?? (() => estaApagado('agente:carta_porte')))()) {
    return { ok: false, motivo: 'agente_apagado', mensaje: 'El agente de Carta Porte está apagado en esta flota.' };
  }
  const d = e.formatoForzado === 'correo' && e.bytes.length > 0 && e.bytes.length <= MAX_BYTES_DOC
    ? ({ ok: true, clase: 'correo', mime: 'text/plain' } as const)
    : detectarFormato(e.bytes);
  if (!d.ok) return { ok: false, motivo: 'formato', mensaje: d.motivo };
  if (e.clienteId && !(await repo.clientePropio(tenantId, e.clienteId))) {
    return { ok: false, motivo: 'cliente', mensaje: 'Ese cliente no pertenece a tu flota.' };
  }
  const sha256 = createHash('sha256').update(e.bytes).digest('hex');
  const ruta = `${tenantId}/${sha256}`;
  const formato = CLASE_A_FORMATO[d.clase];
  await repo.subirArchivo(ruta, e.bytes, d.mime);
  const { documento, duplicado } = await repo.insertarDocumento(tenantId, {
    id: randomUUID(), canal: e.canal, formato, nombreArchivo: nombreArchivoSeguro(e.nombre), mime: d.mime, bytes: e.bytes.length, sha256,
    storageRuta: ruta, clienteId: e.clienteId ?? null, remitente: e.remitente?.slice(0, 320) ?? null, asunto: e.asunto?.slice(0, 300) ?? null,
    remitenteReconocido: e.remitenteReconocido ?? null, retenerHasta: diasDespues(ahora, DIAS_RETENCION.recibido),
  });
  await repo.registrarEvento(tenantId, documento.id, duplicado ? 'duplicado_recibido' : 'recibido', e.actorId ?? null,
    duplicado ? { canal: e.canal } : { canal: e.canal, formato, bytes: e.bytes.length });
  return { ok: true, documentoId: documento.id, duplicado, estado: documento.estado, formato: documento.formato };
}

// ── La validación completa (con lo que solo la base sabe) ───────────────────

/**
 * `validarExtraccion` más dos avisos que dependen de la base: otro documento con el mismo folio de cliente
 * (posible duplicado lógico: distinto archivo, mismo embarque) y un viaje que ya existe con ese folio.
 * Se usa al procesar y tras cada corrección, para que los avisos no se pierdan al revalidar.
 */
export async function validarDocumento(tenantId: string, doc: Pick<DocumentoFila, 'id' | 'riesgoInyeccion' | 'remitenteReconocido'>, e: Extraccion): Promise<ResultadoValidacion> {
  const base = validarExtraccion(e, { riesgoInyeccion: doc.riesgoInyeccion, remitenteReconocido: doc.remitenteReconocido });
  const extra: Hallazgo[] = [];
  const folio = e.campos.folio_cliente?.valor;
  if (folio) {
    const otros = await repo.documentosConFolio(tenantId, folio, doc.id);
    if (otros.length > 0) {
      extra.push({ campo: 'folio_cliente', renglon: null, severidad: 'aviso', codigo: 'posible_duplicado', mensaje: `Ya hay ${otros.length === 1 ? 'otro documento' : `${otros.length} documentos`} con el folio ${folio} (${otros.map((o) => `«${o.nombreArchivo}» ${o.estado}`).join(', ')}). Revisa que no sea el mismo embarque.` });
    }
    const viaje = await repo.viajePorFolio(tenantId, folio);
    if (viaje) extra.push({ campo: 'folio_cliente', renglon: null, severidad: 'aviso', codigo: 'viaje_existente', mensaje: `Ya existe un viaje con el folio ${folio}: al aprobar se le completarán solo los datos que le falten.` });
  }
  return extra.length === 0 ? base : { ...base, hallazgos: [...base.hallazgos, ...extra] };
}

// ── Procesar ────────────────────────────────────────────────────────────────

export type ResultadoProceso =
  | { ok: true; estado: 'por_revisar'; origen: ResultadoExtraccion['origen']; nivel: number; costoUsd: number; listoParaAprobar: boolean }
  | { ok: false; motivo: 'no_reclamable' | 'perdi_el_lease' | 'archivo' | 'ilegible' | 'presupuesto' | 'modelo'; mensaje: string; permanente: boolean };

const resumenError = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 300);

export async function procesarDocumento(
  tenantId: string, documentoId: string, deps: DepsServicio & { signal?: AbortSignal } = {},
): Promise<ResultadoProceso> {
  const ahora = (deps.ahora ?? (() => new Date()))();
  const claim = await repo.reclamarDocumento(tenantId, documentoId);
  if (!claim) return { ok: false, motivo: 'no_reclamable', mensaje: 'El documento ya se está procesando, ya se extrajo o agotó sus intentos.', permanente: false };
  const doc = await repo.leerDocumento(tenantId, documentoId);
  if (!doc) return { ok: false, motivo: 'no_reclamable', mensaje: 'El documento ya no existe.', permanente: true };

  let version = claim.version;
  const fallar = async (motivo: 'archivo' | 'ilegible' | 'presupuesto' | 'modelo', mensaje: string, permanente: boolean): Promise<ResultadoProceso> => {
    const nueva = await repo.actualizarDocumento(tenantId, documentoId, version, {
      estado: 'fallido', ultimo_error: mensaje, procesando_hasta: null, retener_hasta: diasDespues(ahora, DIAS_RETENCION.cerrado),
      // Un archivo que no se deja leer no mejora reintentando: se agota el contador para que nadie lo reclame de nuevo.
      ...(permanente ? { intentos: MAX_INTENTOS } : {}),
      // El presupuesto de IA agotado no es culpa del documento: no gasta uno de sus intentos (el worker lo reintenta
      // con su espera, y el día que se amplíe el techo sigue vivo en vez de quedar terminal por un tope del proveedor).
      ...(motivo === 'presupuesto' ? { intentos: Math.max(0, claim.intentos - 1) } : {}),
    });
    if (nueva) {
      await repo.registrarEvento(tenantId, documentoId, 'extraccion_fallida', null, { motivo, permanente, intento: claim.intentos });
    }
    logger.warn('carta_porte_docs.extraccion_fallida', { tenantId, documentoId, motivo, permanente, intento: claim.intentos });
    return { ok: false, motivo, mensaje, permanente };
  };

  try {
    await repo.registrarEvento(tenantId, documentoId, 'extraccion_iniciada', null, { intento: claim.intentos });
    if (!doc.storageRuta) return await fallar('archivo', 'El archivo ya se purgó por retención.', true);

    let bytes: Uint8Array;
    try { bytes = await repo.descargarArchivo(doc.storageRuta); } catch (e) { return await fallar('archivo', `No pude leer el archivo guardado: ${resumenError(e)}`, false); }

    const d = detectarFormato(bytes);
    if (!d.ok) return await fallar('ilegible', d.motivo, true);
    let contenido;
    try { contenido = await prepararContenido(bytes, d.clase); } catch (e) { return await fallar('ilegible', resumenError(e), true); }

    const perfiles = await repo.listarPerfiles(tenantId);
    const llm = await (deps.llm ?? llmPorDefecto)(tenantId, doc.canal);
    let r: ResultadoExtraccion;
    try {
      r = await extraerDocumento(contenido, { llm, perfiles, remitente: doc.remitente, clienteId: doc.clienteId, signal: deps.signal });
    } catch (e) {
      if (esErrorDePresupuesto(e)) return await fallar('presupuesto', 'El presupuesto de IA de hoy se agotó. El documento queda en la bandeja y se puede reintentar mañana o cuando se amplíe el techo.', false);
      return await fallar('modelo', `El modelo no pudo leer el documento: ${resumenError(e)}`, false);
    }

    const docVista = { id: doc.id, riesgoInyeccion: r.riesgoInyeccion, remitenteReconocido: doc.remitenteReconocido };
    const validacion = await validarDocumento(tenantId, docVista, r.extraccion);
    const meta: MetaExtraccion = {
      origen: r.origen, nivel: r.nivel, escalamientos: r.escalamientos, avisos: r.avisos, notasModelo: r.notasModelo, indiciosInyeccion: r.indiciosInyeccion,
    };
    const guardada = await repo.actualizarDocumento(tenantId, documentoId, version, {
      estado: 'por_revisar', formato: contenido.formato, perfil_id: r.perfilId, perfil_version: r.perfilVersion,
      texto_extracto: contenido.texto, riesgo_inyeccion: r.riesgoInyeccion,
      extraccion: { campos: r.extraccion.campos, mercancias: r.extraccion.mercancias, meta },
      validacion, confianza_min: confianzaMinimaCritica(r.extraccion), nivel_modelo: r.nivel, modelo: r.modelo,
      tokens_in: r.tokensIn, tokens_out: r.tokensOut, costo_usd: r.costoUsd,
      procesando_hasta: null, ultimo_error: null,
    });
    if (!guardada) return { ok: false, motivo: 'perdi_el_lease', mensaje: 'Otra invocación terminó este documento primero.', permanente: false };
    version = guardada.version;
    await repo.registrarEvento(tenantId, documentoId, 'extraccion_ok', null, {
      origen: r.origen, nivel: r.nivel, modelo: r.modelo, campos: Object.keys(r.extraccion.campos).length, mercancias: r.extraccion.mercancias.length,
      costoUsd: r.costoUsd, bloqueos: validacion.bloqueos, porConfirmar: validacion.porConfirmar, riesgoInyeccion: r.riesgoInyeccion,
    });
    for (const x of r.escalamientos) await repo.registrarEvento(tenantId, documentoId, 'escalada', null, x);
    return { ok: true, estado: 'por_revisar', origen: r.origen, nivel: r.nivel, costoUsd: r.costoUsd, listoParaAprobar: validacion.listoParaAprobar };
  } catch (e) {
    // Cualquier otra cosa (la base, la bitácora): el documento NO se queda «procesando» para siempre; el lease vence solo
    // y el contador de intentos ya subió. Se relanza para que el llamador lo vea.
    logger.error('carta_porte_docs.proceso_roto', { tenantId, documentoId, err: resumenError(e) });
    throw e;
  }
}
