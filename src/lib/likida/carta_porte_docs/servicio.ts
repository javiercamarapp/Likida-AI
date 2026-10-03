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
import { derivarHijos, evaluarDivision, MAX_EMBARQUES, type PlanDivision } from './multiembarque';
import { elegirPerfil } from './perfiles';
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
  /** El archivo traía N embarques: quedó `dividido` y cada embarque es un documento hijo `recibido` (lo lee el cron o «Procesar»). */
  | {
    ok: true; estado: 'dividido'; embarques: number; hijos: string[]; yaExistian: number;
    /** Hijos cuya huella era de un documento rechazado o fallido: volvieron a `recibido` (0672). La oficina debe saberlo. */
    reabiertos?: number;
    /** Hijos que ya existían, ya sin archivo (purgados): el archivo recién subido se borró en vez de quedar huérfano. */
    sinArchivo?: number;
  }
  | {
    ok: false; motivo: 'no_reclamable' | 'perdi_el_lease' | 'archivo' | 'ilegible' | 'presupuesto' | 'modelo'; mensaje: string; permanente: boolean;
    /** Solo con `motivo: 'presupuesto'`: qué techo se topó. `run` es el tope POR DOCUMENTO (culpa del archivo, cuenta como
     *  intento); `tenant` y `proposito` son de la FLOTA (no son culpa del documento ni afectan a otras flotas). */
    alcance?: 'run' | 'tenant' | 'proposito';
  };

/** El `scope` del `LlmBudgetExceededError` (a través de la cadena de `cause`), o `undefined` si no se puede leer. */
function alcanceDePresupuesto(err: unknown): 'run' | 'tenant' | 'proposito' | undefined {
  let actual: unknown = err;
  for (let i = 0; i < 6 && actual && typeof actual === 'object'; i++) {
    const sc = (actual as { scope?: unknown }).scope;
    if (sc === 'run' || sc === 'tenant' || sc === 'proposito') return sc;
    actual = (actual as { cause?: unknown }).cause;
  }
  return undefined;
}

const resumenError = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 300);

/** Nombre de la ruta de Storage de un archivo de la flota (el mismo esquema que `recibirDocumento`). */
const rutaDe = (tenantId: string, sha256: string): string => `${tenantId}/${sha256}`;

type ResultadoDividir =
  | { estado: 'ok'; resultado: Extract<ResultadoProceso, { ok: true; estado: 'dividido' }> }
  | { estado: 'perdido' }
  | { estado: 'sin_migracion' };

/**
 * Parte el documento: sube el archivo derivado de cada embarque (el mismo bytes ⇒ la misma huella ⇒ la misma ruta, así que
 * un reintento tras una caída sobrescribe lo mismo y no deja basura distinta) y llama a la RPC atómica de la 0671.
 */
async function dividirEnHijos(tenantId: string, doc: DocumentoFila, version: number, plan: PlanDivision, ahora: Date): Promise<ResultadoDividir> {
  const hijos = derivarHijos(plan, doc.nombreArchivo);
  for (const h of hijos) await repo.subirArchivo(rutaDe(tenantId, h.sha256), h.bytes, 'text/csv');
  const r = await repo.dividirDocumento(
    tenantId, doc.id, version,
    hijos.map((h) => ({ indice: h.indice, clave: h.clave, nombre: h.nombre, sha256: h.sha256, bytes: h.bytes.length, storageRuta: rutaDe(tenantId, h.sha256) })),
    diasDespues(ahora, DIAS_RETENCION.recibido), diasDespues(ahora, DIAS_RETENCION.cerrado),
  );
  if (r.estado === 'perdido') await limpiarArchivosHuerfanos(tenantId, doc.id, hijos.map((h) => h.sha256));
  if (r.estado !== 'ok') return r;
  const yaExistian = r.hijos.filter((h) => !h.creado).length;
  const reabiertos = r.hijos.filter((h) => h.accion === 'reabierto').length;
  // M1 (ronda 15): un hijo que ya existía pero SIN archivo (purgado) dejaba el archivo recién subido sin dueño. Se borra.
  const huerfanos = r.hijos.filter((h) => h.accion === 'sin_archivo');
  for (const h of huerfanos) {
    const sha = hijos[h.indice - 1]?.sha256;
    if (!sha) continue;
    try { await repo.borrarArchivo(rutaDe(tenantId, sha)); } catch (e) { logger.warn('carta_porte_docs.hijo_huerfano_no_borrado', { tenantId, documentoId: doc.id, err: resumenError(e) }); }
  }
  logger.info('carta_porte_docs.dividido', { tenantId, documentoId: doc.id, embarques: hijos.length, yaExistian, reabiertos, sinArchivo: huerfanos.length, columna: plan.origenColumna, avisos: plan.avisos });
  return {
    estado: 'ok',
    resultado: { ok: true, estado: 'dividido', embarques: hijos.length, hijos: r.hijos.map((h) => h.documentoId), yaExistian, reabiertos, sinArchivo: huerfanos.length },
  };
}

/**
 * La RPC dijo «perdido»: este documento ya no es de quien lo reclamó. Los archivos de los hijos que se acababan de subir solo
 * se borran si el padre YA NO EXISTE o se purgó (nadie los va a retener) y ninguna fila de la flota los usa; si el padre
 * sigue vivo (otra invocación lo está dividiendo, o ya lo dividió), esos mismos archivos son de SUS hijos y no se tocan.
 */
async function limpiarArchivosHuerfanos(tenantId: string, padreId: string, huellas: string[]): Promise<void> {
  try {
    const padre = await repo.leerDocumento(tenantId, padreId);
    if (padre && !padre.purgadoEn) return;
    for (const sha of huellas) {
      if (await repo.documentoPorHuella(tenantId, sha)) continue;
      await repo.borrarArchivo(rutaDe(tenantId, sha));
    }
  } catch (e) {
    logger.warn('carta_porte_docs.huerfanos_no_limpiados', { tenantId, documentoId: padreId, err: resumenError(e) });
  }
}

export async function procesarDocumento(
  tenantId: string, documentoId: string, deps: DepsServicio & { signal?: AbortSignal } = {},
): Promise<ResultadoProceso> {
  const ahora = (deps.ahora ?? (() => new Date()))();
  const claim = await repo.reclamarDocumento(tenantId, documentoId);
  if (!claim) return { ok: false, motivo: 'no_reclamable', mensaje: 'El documento ya se está procesando, ya se extrajo o agotó sus intentos.', permanente: false };
  const doc = await repo.leerDocumento(tenantId, documentoId);
  if (!doc) return { ok: false, motivo: 'no_reclamable', mensaje: 'El documento ya no existe.', permanente: true };

  let version = claim.version;
  const fallar = async (
    motivo: 'archivo' | 'ilegible' | 'presupuesto' | 'modelo', mensaje: string, permanente: boolean, alcance?: 'run' | 'tenant' | 'proposito',
  ): Promise<ResultadoProceso> => {
    const nueva = await repo.actualizarDocumento(tenantId, documentoId, version, {
      estado: 'fallido', ultimo_error: mensaje, procesando_hasta: null, retener_hasta: diasDespues(ahora, DIAS_RETENCION.cerrado),
      // Un archivo que no se deja leer no mejora reintentando: se agota el contador para que nadie lo reclame de nuevo.
      ...(permanente ? { intentos: MAX_INTENTOS } : {}),
      // El techo de la FLOTA (diario o de fondo) no es culpa del documento: no gasta uno de sus intentos (el worker lo
      // reintenta con su espera, y el día que se amplíe el techo sigue vivo en vez de quedar terminal). PERO el tope POR
      // DOCUMENTO (`run`) SÍ lo es: un archivo cuyo escalamiento rebasa el tope lo rebasará cada vez y pagaría los niveles
      // anteriores en cada pasada. Ese cuenta su intento, para llegar al estado terminal y avisar a la oficina.
      ...(motivo === 'presupuesto' && alcance !== 'run' ? { intentos: Math.max(0, claim.intentos - 1) } : {}),
    });
    if (nueva) {
      await repo.registrarEvento(tenantId, documentoId, 'extraccion_fallida', null, { motivo, permanente, intento: claim.intentos });
    }
    logger.warn('carta_porte_docs.extraccion_fallida', { tenantId, documentoId, motivo, permanente, intento: claim.intentos });
    return { ok: false, motivo, mensaje, permanente, ...(alcance ? { alcance } : {}) };
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

    // Un Excel/CSV con N embarques se PARTE en N documentos (0670-0671) antes de gastar un solo token: cada embarque es
    // su propio documento, con su revisión, su aprobación y su viaje. Sin la migración cae a leer el primero con el aviso.
    const { plan, exceso, variasHojas } = evaluarDivision(contenido, elegirPerfil(perfiles, contenido, doc.remitente, doc.clienteId).perfil);
    if (plan) {
      const div = await dividirEnHijos(tenantId, doc, version, plan, ahora);
      if (div.estado === 'ok') return div.resultado;
      if (div.estado === 'perdido') return { ok: false, motivo: 'perdi_el_lease', mensaje: 'Otra invocación terminó este documento primero.', permanente: false };
      contenido.avisos.push(`El archivo trae ${plan.embarques.length} embarques pero esta base aún no sabe partirlos: se leyó el primero; sube el resto por separado.`);
    } else if (variasHojas !== null) {
      const otras = variasHojas.otras.slice(0, 5).map((n) => `«${n}»`).join(', ');
      contenido.avisos.push(`El libro trae ${variasHojas.embarques} embarques en la hoja «${variasHojas.hojaDelFolio}» y además datos en otra(s) hoja(s) (${otras}): partirlo dejaría a cada embarque sin esas hojas, así que no se parte. Se leyó el primero; deja los embarques en una sola hoja o súbelos por separado.`);
    } else if (exceso !== null) {
      contenido.avisos.push(`El archivo trae ${exceso} embarques (más de ${MAX_EMBARQUES}): no se parte solo. Se leyó el primero; divide el archivo y súbelo por partes.`);
    }

    const llm = await (deps.llm ?? llmPorDefecto)(tenantId, doc.canal);
    let r: ResultadoExtraccion;
    try {
      r = await extraerDocumento(contenido, { llm, perfiles, remitente: doc.remitente, clienteId: doc.clienteId, signal: deps.signal });
    } catch (e) {
      if (esErrorDePresupuesto(e)) {
        const alcance = alcanceDePresupuesto(e);
        if (alcance === 'run') {
          return await fallar('presupuesto', 'Este documento rebasó el tope de IA por documento al escalar de nivel (suele ser un archivo muy grande o ilegible). Se reintenta unas veces más y, si sigue igual, captúralo a mano.', false, alcance);
        }
        return await fallar('presupuesto', 'El presupuesto de IA de hoy se agotó. El documento queda en la bandeja y se puede reintentar mañana o cuando se amplíe el techo.', false, alcance);
      }
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
