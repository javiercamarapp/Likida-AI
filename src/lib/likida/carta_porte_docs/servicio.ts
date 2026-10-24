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
import { avisosDelCatalogo, enriquecer } from './catalogo_cliente';
import { precargarCatalogosSat } from './catalogos_sat';
import type { SalidaTms } from './tms_puerto';
import { derivarHijos, evaluarDivision, MAX_EMBARQUES, type PlanDivision } from './multiembarque';
import { elegirPerfil } from './perfiles';
import { confianzaMinimaCritica, validarExtraccion, type Hallazgo, type ResultadoValidacion } from './validacion';
import { extraccionVacia, type Extraccion } from './campos';
import { clasificarFormato } from './registro_formatos';
import type { VisionRemision } from './lectores/remision';
import * as repo from './repo';
import { asignarAlLlegarARevision } from './revisor';
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
  /** T-A3-53: transcribe una captura (imagen) a texto por rótulos (modelo de visión). Sin él, una imagen se lee como siempre y no se puede detectar un corte por código. */
  transcribir?: (imagenes: string[], signal?: AbortSignal) => Promise<string>;
  /** T-A3-67: el modelo de visión que lee una remisión escaneada (formato C). Sin él (sin llave: bloqueo externo) esa remisión queda «requiere captura manual». */
  vision?: VisionRemision | null;
}

async function llmPorDefecto(tenantId: string, canal: CanalDoc): Promise<LlmExtractor> {
  const { crearExtractorOpenRouter } = await import('./extractor_openrouter');
  // Lo que una persona espera (carga manual, WhatsApp) va por el carril interactivo; el correo, de fondo.
  return crearExtractorOpenRouter(tenantId, canal === 'correo' ? 'ocr_lote' : 'interactivo');
}

const CLASE_A_FORMATO: Record<string, FormatoDoc> = { pdf: 'pdf_texto', imagen: 'imagen', excel: 'excel', csv: 'csv', xml: 'xml', correo: 'correo', json: 'json' };

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
  | { ok: true; documentoId: string; duplicado: boolean; estado: repo.EstadoDoc; formato: FormatoDoc; /** A37-A3-04: el archivo era de un documento fallido/rechazado y volvió a la cola. */ reabierto?: boolean }
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
  // A37-A3-17: el duplicado de un documento ya purgado (sin storage_ruta) no vuelve a guardar el archivo: lo recién subido
  // quedaría sin referencia y ningún barrido lo borraría. Se retira (mejor esfuerzo; si falla se avisa, no se rompe la recepción).
  if (duplicado && !documento.storageRuta) {
    try { await repo.borrarArchivo(ruta); } catch (err) { logger.warn('cpdocs.huerfano_no_borrado', { tenantId, error: err instanceof Error ? err.message : String(err) }); }
  }
  await repo.registrarEvento(tenantId, documento.id, duplicado ? 'duplicado_recibido' : 'recibido', e.actorId ?? null,
    duplicado ? { canal: e.canal } : { canal: e.canal, formato, bytes: e.bytes.length });
  // A37-A3-04: reenviar el MISMO archivo de un documento fallido (o rechazado) lo reabre, en vez de contestar «ya estaba».
  if (duplicado && (documento.estado === 'fallido' || documento.estado === 'rechazado') && documento.storageRuta) {
    const r = await reintentarDocumento(tenantId, documento, e.actorId ?? null, `reenvío del mismo archivo (${e.canal})`, ahora);
    if (r.ok) return { ok: true, documentoId: documento.id, duplicado: false, estado: 'recibido', formato: documento.formato, reabierto: true };
  }
  return { ok: true, documentoId: documento.id, duplicado, estado: documento.estado, formato: documento.formato };
}

/** Cuántas veces se puede reabrir a mano el MISMO documento: más que esto es un archivo que no se va a poder leer. */
export const MAX_REINTENTOS_MANUALES = 5;

export type ResultadoReintento = { ok: true } | { ok: false; mensaje: string };

/**
 * A37-A3-04 · SALIDA DE UN DOCUMENTO `fallido` TERMINAL. Con 5 intentos agotados el documento no se reclamaba nunca más y
 * reenviar el archivo solo contestaba «ya estaba». Esto lo devuelve a `recibido` con los intentos en cero (con tope de
 * reaperturas, bitácora y sin tocar el archivo ni la extracción previa). Solo `fallido` y `rechazado` con archivo.
 */
export async function reintentarDocumento(
  tenantId: string, d: DocumentoFila, actorId: string | null, motivo: string, ahora: Date = new Date(),
): Promise<ResultadoReintento> {
  if (d.estado !== 'fallido' && d.estado !== 'rechazado') return { ok: false, mensaje: `Un documento «${d.estado}» no se reintenta.` };
  if (!d.storageRuta) return { ok: false, mensaje: 'El archivo ya se purgó por retención: súbelo de nuevo.' };
  const previos = (await repo.listarEventos(tenantId, d.id)).filter((ev) => ev.tipo === 'reabierto' && ev.detalle.reintento_manual === true).length;
  if (previos >= MAX_REINTENTOS_MANUALES) {
    return { ok: false, mensaje: `Este documento ya se reintentó ${previos} veces sin poder leerse. Captura el viaje a mano o pide el archivo de nuevo en otro formato.` };
  }
  const r = await repo.actualizarDocumento(tenantId, d.id, d.version, {
    estado: 'recibido', intentos: 0, ultimo_error: null, procesando_hasta: null, rechazo_motivo: null, revisado_por: actorId,
    retener_hasta: diasDespues(ahora, DIAS_RETENCION.recibido),
  });
  if (!r) return { ok: false, mensaje: 'Otra persona o el sistema cambió este documento a la vez. Recarga la pantalla y vuelve a intentarlo.' };
  // Para que el SIGUIENTE agotamiento vuelva a avisar a la oficina (el candado de «una sola vez» se suelta).
  await repo.liberarAvisoDoc(tenantId, d.id, 'agotado').catch(() => false);
  await repo.registrarEvento(tenantId, d.id, 'reabierto', actorId, { reintento_manual: true, desde: d.estado, intentos_previos: d.intentos, motivo: motivo.slice(0, 120) });
  return { ok: true };
}

/** Un aviso de lectura que además es una PÉRDIDA de datos (embarques que no se leyeron): bloquea la aprobación. */
function perdida(contenido: { avisos: string[]; perdidas?: Array<{ mensaje: string; bloquea: boolean }> }, mensaje: string): void {
  contenido.avisos.push(mensaje);
  contenido.perdidas = [...(contenido.perdidas ?? []), { mensaje, bloquea: true }];
}

// ── La validación completa (con lo que solo la base sabe) ───────────────────

/**
 * `validarExtraccion` más dos avisos que dependen de la base: otro documento con el mismo folio de cliente
 * (posible duplicado lógico: distinto archivo, mismo embarque) y un viaje que ya existe con ese folio.
 * Se usa al procesar y tras cada corrección, para que los avisos no se pierdan al revalidar.
 */
export async function validarDocumento(
  tenantId: string,
  doc: Pick<DocumentoFila, 'id' | 'riesgoInyeccion' | 'remitenteReconocido'> & { capturaIncompleta?: { ultimoRotulo: string } | null; lecturaIncompleta?: Array<{ mensaje: string; bloquea: boolean }>; requiereCapturaManual?: MetaExtraccion['requiereCapturaManual']; extraccion?: DocumentoFila['extraccion'] },
  e: Extraccion,
  opc: { tms?: SalidaTms } = {},
): Promise<ResultadoValidacion> {
  // Catálogos SAT (T-A3-24): UNA consulta por catálogo con todas las claves del documento; si falla o está vacío, degrada a aviso.
  const catalogosSat = await precargarCatalogosSat(e, (catalogo, claves) => repo.cargarCatalogoSat(catalogo, claves), { tms: opc.tms });
  // T-A3-53: el corte de la captura vive en lo guardado (meta) para que la revalidación tras una corrección y la de «aprobar» lo vean.
  const capturaIncompleta = doc.capturaIncompleta ?? doc.extraccion?.meta?.capturaIncompleta ?? null;
  const base = validarExtraccion(e, { riesgoInyeccion: doc.riesgoInyeccion, remitenteReconocido: doc.remitenteReconocido, catalogosSat, capturaIncompleta });
  const extra: Hallazgo[] = [];
  // T-A3-67: lo que el lector no pudo leer se declara en cada revalidación (no se pierde al corregir un campo).
  const manual = doc.requiereCapturaManual ?? doc.extraccion?.meta?.requiereCapturaManual ?? null;
  // A37-A3-03: lo que la lectura dejó fuera (embarques, páginas, filas) se declara en cada revalidación, también tras corregir un campo.
  for (const p of doc.lecturaIncompleta ?? doc.extraccion?.meta?.lecturaIncompleta ?? []) {
    extra.push({ campo: 'documento', renglon: null, severidad: p.bloquea ? 'bloqueo' : 'confirmar', codigo: 'lectura_incompleta', mensaje: `${p.mensaje}${p.bloquea ? ' No se puede aprobar hasta que se lea completo: divide el archivo y súbelo por partes, o captura lo que falta.' : ' Confirma que no falta nada.'}` });
  }
  if (manual) {
    extra.push({ campo: 'documento', renglon: null, severidad: 'bloqueo', codigo: 'requiere_captura_manual', mensaje: 'Esta remisión escaneada no se pudo leer porque no hay modelo de visión configurado. No se inventó ningún dato: captúrala a mano contra el original.' });
  }
  const folio = e.campos.folio_cliente?.valor;
  if (folio) {
    const otros = await repo.documentosConFolio(tenantId, folio, doc.id);
    if (otros.length > 0) {
      extra.push({ campo: 'folio_cliente', renglon: null, severidad: 'aviso', codigo: 'posible_duplicado', mensaje: `Ya hay ${otros.length === 1 ? 'otro documento' : `${otros.length} documentos`} con el folio ${folio} (${otros.map((o) => `«${o.nombreArchivo}» ${o.estado}`).join(', ')}). Revisa que no sea el mismo embarque.` });
    }
    const viaje = await repo.viajePorFolio(tenantId, folio);
    if (viaje) extra.push({ campo: 'folio_cliente', renglon: null, severidad: 'aviso', codigo: 'viaje_existente', mensaje: `Ya existe un viaje con el folio ${folio}: al aprobar se le completarán solo los datos que le falten.` });
  }
  if (extra.length === 0) return base;
  // Los extras de aquí son avisos, salvo `requiere_captura_manual`, que SÍ bloquea: se recuentan para que `listoParaAprobar` no mienta.
  const bloqueos = base.bloqueos + extra.filter((h) => h.severidad === 'bloqueo').length;
  return { ...base, hallazgos: [...base.hallazgos, ...extra], bloqueos, listoParaAprobar: base.listoParaAprobar && bloqueos === 0 };
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

// ── T-A3-67: formatos C, D y E ──────────────────────────────────────────────

/** Pide la transcripción una sola vez: la clasificación y el extractor comparten el resultado (y el costo del modelo de visión). */
function memorizarTranscripcion(f: NonNullable<DepsServicio['transcribir']>): NonNullable<DepsServicio['transcribir']> {
  let promesa: Promise<string> | null = null;
  return (imagenes, signal) => (promesa ??= f(imagenes, signal));
}

/**
 * Reconoce por su firma (T-A3-59) si el documento es una remisión escaneada (C), un BOL en inglés (D) o una orden del agente
 * aduanal (E), para despacharlo a su lector. Un PDF o correo con texto se clasifica con su texto; un escaneo o una imagen, con la
 * transcripción de su encabezado (puerto `transcribir`; sin él no hay con qué reconocerlo y sigue el flujo de siempre). Los
 * formatos F1–F3 (correo/captura) los despacha el extractor por su cuenta; lo ambiguo o no reconocido tampoco se adivina.
 */
async function clasificarEntradaCDE(
  c: Awaited<ReturnType<typeof prepararContenido>>, transcribir: DepsServicio['transcribir'], signal?: AbortSignal,
): Promise<'C' | 'D' | 'E' | null> {
  const visual = c.formato === 'imagen' || c.formato === 'pdf_escaneado';
  let textoVision: string | null = null;
  if (visual && !c.texto && transcribir && c.imagenes.length > 0) {
    try { textoVision = await transcribir(c.imagenes, signal); } catch (e) { if (signal?.aborted) throw e; textoVision = null; }
  }
  const f = clasificarFormato({ contenido: c, textoVision }).formato;
  return f === 'C' || f === 'D' || f === 'E' ? f : null;
}

/** Resultado de «nadie leyó el documento»: extracción vacía, sin modelo, sin costo. Lo que no se leyó no se inventa. */
function resultadoSinLectura(avisos: string[], aviso: string): ResultadoExtraccion {
  return {
    extraccion: extraccionVacia(), origen: 'llm', nivel: 0, modelo: null, tokensIn: 0, tokensOut: 0, costoUsd: 0,
    riesgoInyeccion: false, indiciosInyeccion: [], perfilId: null, perfilVersion: null, perfilAmbiguo: false,
    avisos: [...avisos, aviso], escalamientos: [], revisionHumana: [], caidas: [], notasModelo: [], capturaIncompleta: null,
  };
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
    const { plan, exceso, variasHojas, mismoEmbarque } = evaluarDivision(contenido, elegirPerfil(perfiles, contenido, doc.remitente, doc.clienteId).perfil);
    if (plan) {
      const div = await dividirEnHijos(tenantId, doc, version, plan, ahora);
      if (div.estado === 'ok') return div.resultado;
      if (div.estado === 'perdido') return { ok: false, motivo: 'perdi_el_lease', mensaje: 'Otra invocación terminó este documento primero.', permanente: false };
      perdida(contenido, `El archivo trae ${plan.embarques.length} embarques pero esta base aún no sabe partirlos: se leyó el primero; sube el resto por separado.`);
    } else if (variasHojas !== null) {
      const otras = variasHojas.otras.slice(0, 5).map((n) => `«${n}»`).join(', ');
      perdida(contenido, `El libro trae ${variasHojas.embarques} embarques en la hoja «${variasHojas.hojaDelFolio}» y además datos en otra(s) hoja(s) (${otras}): partirlo dejaría a cada embarque sin esas hojas, así que no se parte. Se leyó el primero; deja los embarques en una sola hoja o súbelos por separado.`);
    } else if (mismoEmbarque) {
      contenido.hojasMismoEmbarque = mismoEmbarque.hojas;
      contenido.avisos.push(mismoEmbarque.aviso);
    } else if (exceso !== null) {
      perdida(contenido, `El archivo trae ${exceso} embarques (más de ${MAX_EMBARQUES}): no se parte solo. Se leyó el primero; divide el archivo y súbelo por partes.`);
    }

    // T-A3-67: la transcripción de una captura/escaneo se pide UNA vez por documento (la usan la clasificación y, después, el extractor).
    const transcribir = deps.transcribir ? memorizarTranscripcion(deps.transcribir) : undefined;
    const formatoEntrada = await clasificarEntradaCDE(contenido, transcribir, deps.signal);
    // Remisión escaneada sin modelo de visión (sin llave): no hay con qué leerla. No se manda al modelo genérico a adivinarla ni se
    // inventa nada: queda «requiere captura manual», visible y bloqueante, y el flujo no se rompe.
    const sinVision = formatoEntrada === 'C' && !deps.vision && contenido.imagenes.length > 0;

    const llm = sinVision ? null : await (deps.llm ?? llmPorDefecto)(tenantId, doc.canal);
    let r: ResultadoExtraccion;
    try {
      r = sinVision || !llm
        ? resultadoSinLectura(contenido.avisos, 'Sin modelo de visión configurado: esta remisión escaneada se captura a mano.')
        : await extraerDocumento(contenido, {
          llm, perfiles, remitente: doc.remitente, clienteId: doc.clienteId, signal: deps.signal, nombreArchivo: doc.nombreArchivo, errorFatal: esErrorDePresupuesto,
          ...(transcribir ? { transcribir } : {}), ...(formatoEntrada ? { formatoEntrada } : {}), ...(deps.vision ? { vision: deps.vision } : {}),
        });
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

    // El catálogo del cliente se aplica DESPUÉS del perfil/modelo y ANTES de validar. El modelo ya contestó: nunca lo vio.
    // Sin cliente en el documento o sin catálogo cargado es un no-op.
    let extraccion = r.extraccion;
    const avisosCatalogo: string[] = [];
    let catalogoAplicados = 0;
    if (doc.clienteId) {
      const catalogo = await repo.cargarCatalogoCliente(tenantId, doc.clienteId);
      const e = enriquecer(extraccion, catalogo, { tenantId, clienteId: doc.clienteId });
      extraccion = e.extraccion;
      catalogoAplicados = e.aplicados.length;
      avisosCatalogo.push(...avisosDelCatalogo(e, catalogo.truncado === true));
    }

    const requiereCapturaManual: MetaExtraccion['requiereCapturaManual'] = sinVision ? { formato: 'C', motivo: 'sin_vision' } : null;
    const lecturaIncompleta = contenido.perdidas ?? [];
    const docVista = { id: doc.id, riesgoInyeccion: r.riesgoInyeccion, remitenteReconocido: doc.remitenteReconocido, capturaIncompleta: r.capturaIncompleta, requiereCapturaManual, lecturaIncompleta };
    const validacion = await validarDocumento(tenantId, docVista, extraccion);
    const meta: MetaExtraccion = {
      origen: r.origen, nivel: r.nivel, escalamientos: r.escalamientos, ...(r.revisionHumana.length > 0 ? { revisionHumana: r.revisionHumana } : {}), ...(r.caidas.length > 0 ? { caidas: r.caidas } : {}), avisos: [...r.avisos, ...avisosCatalogo], notasModelo: r.notasModelo, indiciosInyeccion: r.indiciosInyeccion,
      ...(r.capturaIncompleta ? { capturaIncompleta: r.capturaIncompleta } : {}),
      ...(formatoEntrada ? { formatoEntrada } : {}),
      ...(requiereCapturaManual ? { requiereCapturaManual } : {}),
      ...(lecturaIncompleta.length > 0 ? { lecturaIncompleta } : {}),
    };
    const guardada = await repo.actualizarDocumento(tenantId, documentoId, version, {
      estado: 'por_revisar', formato: contenido.formato, perfil_id: r.perfilId, perfil_version: r.perfilVersion,
      texto_extracto: contenido.texto, riesgo_inyeccion: r.riesgoInyeccion,
      extraccion: { campos: extraccion.campos, mercancias: extraccion.mercancias, meta },
      validacion, confianza_min: confianzaMinimaCritica(extraccion), nivel_modelo: r.nivel, modelo: r.modelo,
      tokens_in: r.tokensIn, tokens_out: r.tokensOut, costo_usd: r.costoUsd,
      procesando_hasta: null, ultimo_error: null,
    });
    if (!guardada) return { ok: false, motivo: 'perdi_el_lease', mensaje: 'Otra invocación terminó este documento primero.', permanente: false };
    version = guardada.version;
    await repo.registrarEvento(tenantId, documentoId, 'extraccion_ok', null, {
      origen: r.origen, nivel: r.nivel, modelo: r.modelo, campos: Object.keys(extraccion.campos).length, mercancias: extraccion.mercancias.length, catalogoAplicados,
      costoUsd: r.costoUsd, bloqueos: validacion.bloqueos, porConfirmar: validacion.porConfirmar, riesgoInyeccion: r.riesgoInyeccion,
    });
    for (const x of r.escalamientos) await repo.registrarEvento(tenantId, documentoId, 'escalada', null, x);
    // T-A3-31: con bloqueo o duda y un destinatario configurado, el caso ya llega a su persona (mejor esfuerzo; sin configuración no hace nada).
    await asignarAlLlegarARevision(tenantId, documentoId, validacion);
    return { ok: true, estado: 'por_revisar', origen: r.origen, nivel: r.nivel, costoUsd: r.costoUsd, listoParaAprobar: validacion.listoParaAprobar };
  } catch (e) {
    // Cualquier otra cosa (la base, la bitácora): el documento NO se queda «procesando» para siempre; el lease vence solo
    // y el contador de intentos ya subió. Se relanza para que el llamador lo vea.
    logger.error('carta_porte_docs.proceso_roto', { tenantId, documentoId, err: resumenError(e) });
    throw e;
  }
}
