import { logger } from '@/lib/logger';
import { limpiar } from './evidencia';
import { normalizarNombreDocumento, type CatalogoDeCliente, type TipoDocumento } from './documentos_cliente';
import { PREFIJO_BOTON, type HitoFila } from './tipos';
import type { Salida } from './mensajes';
import type { ConfigConductor } from './config';
import type { ViajeContexto } from './repo';

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-53/54 — DOCUMENTOS DE CIERRE: pedirlos (plantilla N11), clasificar la
// foto que llega y la contingencia de fotos ilegibles de celulares de gama
// baja. Puro: la lectura/escritura vive en `repo.ts`; el cableado con
// WhatsApp, en `atender.ts`/`processor.ts`.
//
// ── EL CICLO ─────────────────────────────────────────────────────────────
//   1. Al terminar de descargar (`salida_descarga` ya registrado), si el
//      cliente del viaje tiene catálogo (0809) se arma la SOLICITUD: un
//      snapshot (`documentosARequerir`) con el nombre y tipo de CADA
//      documento, uno por fila en `viaje_documento_cierre`. El catálogo
//      puede cambiar después sin alterar lo ya pedido.
//   2. El chofer manda fotos. Cada una se clasifica por su CAPTION contra
//      los documentos aún pendientes (`documentoDeCaption`) — mismo criterio
//      que el sello/andén/recibido de `evidencia.ts`: el caption es la única
//      señal determinística. Sin categoría clara, la foto se guarda igual
//      (como evidencia `documento_cierre` sin documento asignado) y queda
//      «por revisar»: nunca se adivina ni se pierde.
//   3. T-A5-54: si la foto es de mala calidad (< 800 px, oscura o borrosa) se
//      pide repetir UNA vez; al segundo intento fallido se acepta igual,
//      marcada «revisar». El contador es POR DOCUMENTO (no se comparte entre
//      documentos distintos del mismo viaje) y nunca bloquea el viaje.
//      FASE 1 (esta entrega): sin un analizador de imagen real, `metadatos`
//      llega ausente y toda foto se acepta como legible — la heurística y el
//      contador quedan listos, probados y a la espera de ese dato (fase 2,
//      igual que `fotoRegistraHito`/`detectarHitosGps` en su momento).
//
// ── APAGADA HASTA APROBAR N11 (R24/plantillas-meta.md) ──────────────────────
// `pedirDocumentosCierreActivo` nace `false` (sin columna en
// `agente_conductor_config` todavía: mismo «construido y apagado» que
// `resultadoDescargaActivo`/`patioEntregaActivo` antes de su migración). La
// plantilla `conductor_pedir_evidencia_v1` (N11) sigue `nueva_para_aprobacion`
// en el catálogo de Meta: aunque se encienda la perilla, un envío fuera de la
// ventana de 24 h se rechaza con 132001 hasta que Meta la apruebe.
// ═══════════════════════════════════════════════════════════════════════════

export type EstadoDocumentoCierre = 'pendiente' | 'recibido' | 'revisar';
export const ESTADOS_DOCUMENTO_CIERRE = ['pendiente', 'recibido', 'revisar'] as const;
export const esEstadoDocumentoCierre = (v: unknown): v is EstadoDocumentoCierre => typeof v === 'string' && (ESTADOS_DOCUMENTO_CIERRE as readonly string[]).includes(v);

export interface DocumentoCierreFila {
  id: string;
  tenantId: string;
  viajeId: string;
  /** `null` = el documento se borró del catálogo (`bajaDocumentoCliente`) DESPUÉS de pedirse: la fila y su snapshot siguen vivos. */
  documentoRequeridoId: string | null;
  /** Snapshot del catálogo al pedirlo: el nombre/tipo que el cliente tenía declarado EN ESE MOMENTO. */
  nombreSolicitado: string;
  tipoSolicitado: TipoDocumento;
  solicitadoEn: string;
  recibidoEn: string | null;
  viajeHitoEvidenciaId: string | null;
  intentosLegibilidad: number;
  estado: EstadoDocumentoCierre;
  respuestaChofer: 'evid_listo' | 'evid_falta' | null;
}

// ── 1. Qué se pide: el snapshot del catálogo (T-A5-53) ──────────────────────

export interface DocumentoARequerir {
  documentoRequeridoId: string;
  nombre: string;
  tipo: TipoDocumento;
}

/** Los documentos a solicitar, en el orden en que se piden (básicos primero). `[]` = el cliente no tiene catálogo propio: solo se pide el POD de siempre, sin romper nada. */
export function documentosARequerir(catalogo: CatalogoDeCliente): DocumentoARequerir[] {
  if (!catalogo.usaCatalogo) return [];
  return [...catalogo.basicos, ...catalogo.complementarios].map((d) => ({ documentoRequeridoId: d.id, nombre: d.nombre, tipo: d.tipo }));
}

// ── 2. Qué falta: para el tablero del Conductor y `GET /v1/evidencias` ──────

export interface ResumenDocumentosCierre {
  /** `false` = este viaje no tiene solicitud (sin catálogo del cliente, o `salida_descarga` aún no registrada): no se pinta nada. */
  usaCatalogo: boolean;
  total: number;
  /** `recibido` + `revisar` (la foto ya llegó, aunque alguna quede marcada para revisar calidad). */
  recibidos: number;
  /** Solo `pendiente`: lo que de verdad falta para facturación/cobranza. */
  faltantes: DocumentoCierreFila[];
  /** `recibido`/`revisar` con intentos ≥ 1, o `pendiente` esperando repetición: para que el tablero avise «celular de gama baja». */
  conProblemaDeCalidad: DocumentoCierreFila[];
}

export function resumenDocumentosCierre(filas: readonly DocumentoCierreFila[]): ResumenDocumentosCierre {
  return {
    usaCatalogo: filas.length > 0,
    total: filas.length,
    recibidos: filas.filter((f) => f.estado !== 'pendiente').length,
    faltantes: filas.filter((f) => f.estado === 'pendiente'),
    conProblemaDeCalidad: filas.filter((f) => f.intentosLegibilidad > 0),
  };
}

// ── 3. Clasificar la foto por su caption (T-A5-53) ──────────────────────────

const MAX_LARGO_CAPTION_DOCUMENTO = 60;

/**
 * ¿El caption nombra a UNO de los documentos aún pendientes? Forma EXACTA (normalizada: sin acentos, en minúsculas, espacios
 * simples) contra el nombre SOLICITADO (el snapshot, no el catálogo vigente) — mismo criterio cerrado que `tipoEvidenciaDeCaption`.
 * `null` = sin caption, caption largo, o ninguno calza: la foto «queda por revisar», nunca se adivina.
 */
export function documentoDeCaption(caption: string | undefined, pendientes: readonly Pick<DocumentoCierreFila, 'documentoRequeridoId' | 'nombreSolicitado'>[]): string | null {
  if (typeof caption !== 'string' || !caption.trim() || caption.length > MAX_LARGO_CAPTION_DOCUMENTO) return null;
  const t = limpiar(caption);
  const hallado = pendientes.find((d) => limpiar(normalizarNombreDocumento(d.nombreSolicitado)) === t);
  return hallado?.documentoRequeridoId ?? null;
}

// ── 4. Legibilidad y contingencia (T-A5-54) ─────────────────────────────────

/** Ancho mínimo (px) para considerar la foto legible. Por debajo, «se ve chica» (celulares de gama baja). SUPUESTO, no medición. */
export const PX_ANCHO_MIN_LEGIBLE = 800;
/** Reintentos ANTES de aceptar la foto igual y marcarla «revisar» (una sola repetición pedida). */
export const MAX_REINTENTOS_LEGIBILIDAD = 2;

/**
 * Lo que un analizador de imagen (fase 2) reportaría de la foto. Todo opcional y `null`/ausente por omisión: sin esta pieza
 * (fase 1, hoy) toda foto se acepta como legible — la clasificación por calidad NUNCA bloquea el viaje.
 */
export interface MetadatosFoto {
  anchoPx?: number | null;
  oscura?: boolean | null;
  borrosa?: boolean | null;
}

export type MotivoIlegible = 'pequena' | 'oscura' | 'borrosa';

/** `null` = legible (o sin metadatos: fase 1 acepta siempre). */
export function motivoIlegible(m: MetadatosFoto | null | undefined): MotivoIlegible | null {
  if (!m) return null;
  if (typeof m.anchoPx === 'number' && Number.isFinite(m.anchoPx) && m.anchoPx > 0 && m.anchoPx < PX_ANCHO_MIN_LEGIBLE) return 'pequena';
  if (m.oscura === true) return 'oscura';
  if (m.borrosa === true) return 'borrosa';
  return null;
}

export type AccionFotoDocumento = 'aceptar_ok' | 'pedir_repetir' | 'aceptar_revisar';

export interface DecisionFotoDocumento {
  accion: AccionFotoDocumento;
  /** El contador YA actualizado (lo que se guarda en `viaje_documento_cierre.intentos_legibilidad`). */
  intentos: number;
}

/**
 * Qué hacer con la foto de ESE documento. Pura: el contador es el que el llamador pasa (una fila, un contador — nunca se comparte
 * entre documentos distintos del mismo viaje). `motivo: null` (legible, o sin metadatos en fase 1) siempre acepta sin tocar el contador.
 */
export function decidirFotoDocumento(e: { motivo: MotivoIlegible | null; intentosPrevios: number }): DecisionFotoDocumento {
  if (e.motivo === null) return { accion: 'aceptar_ok', intentos: e.intentosPrevios };
  const intentos = e.intentosPrevios + 1;
  if (intentos >= MAX_REINTENTOS_LEGIBILIDAD) return { accion: 'aceptar_revisar', intentos };
  return { accion: 'pedir_repetir', intentos };
}

/** El `estado` de `viaje_documento_cierre` que corresponde a cada acción (la escritura la hace `repo_validacion.ts`). */
export function estadoDeAccion(accion: AccionFotoDocumento): EstadoDocumentoCierre {
  if (accion === 'pedir_repetir') return 'pendiente';
  if (accion === 'aceptar_revisar') return 'revisar';
  return 'recibido';
}

// ── 5. Los mensajes al chofer ───────────────────────────────────────────────

const una = (t: string, n: number): string => t.replace(/\s+/g, ' ').trim().slice(0, n);

/** La lista en una línea para el acuse y para la plantilla N11 («carta porte firmada y sellada, pedimento»). */
export function listaDocumentos(nombres: readonly string[]): string {
  return nombres.map((n) => una(n, 60)).join(', ');
}

export function mensajeFotoDocumento(accion: AccionFotoDocumento, nombreDocumento: string): string {
  const nombre = una(nombreDocumento, 60);
  switch (accion) {
    case 'aceptar_ok': return `Recibí tu foto de ${nombre} ✅.`;
    case 'pedir_repetir': return `La foto de ${nombre} se ve chica, oscura o borrosa 😕. ¿Puedes repetirla con más luz y de cerca?`;
    case 'aceptar_revisar': return `Va, la dejo así ✅ — la foto de ${nombre} quedó algo chica/oscura, así que la marco para que la revisen. No se detiene tu viaje.`;
  }
}

export const MENSAJE_SIN_CATEGORIA_DOCUMENTO = 'Recibí tu foto, pero no supe a cuál documento pertenece. La dejo guardada para que la revisen. 🙏';
export const MENSAJE_FOTO_DOCUMENTO_FALLO = 'No pude guardar esa foto ahorita 😕 — consérvala y reenvíamela en un momento, por favor.';

/** Lo que decide `documentoCierreDeLaFoto` (`repo_validacion.ts`) antes de subir el archivo: a qué documento pertenece la foto (si se pudo determinar) y la lista de pendientes para el acuse. */
export interface DocumentoCierrePrevio {
  pendientes: DocumentoCierreFila[];
  /** `null` = el caption no nombró a ninguno de los pendientes: «queda por revisar», sin avanzar ningún documento. */
  documentoId: string | null;
}

/** El acuse cuando ya se tienen TODOS los documentos pedidos. */
export const MENSAJE_DOCUMENTOS_COMPLETOS = '¡Listo! Ya tengo todos los documentos del cierre. Gracias 🙌';

// ── 6. Pedir los documentos: la pregunta N11 tras `salida_descarga` ─────────

export interface PuertosDocumentosCierre {
  /** Las filas de la solicitud de ESE viaje (ya existentes). `[]` = aún no se armó, o el cliente no tiene catálogo. */
  leer(tenantId: string, viajeId: string): Promise<DocumentoCierreFila[]>;
  /** Arma la solicitud (snapshot del catálogo del cliente del viaje) SOLO si no existe ya. Idempotente: no duplica si se llama dos veces. */
  crear(tenantId: string, viajeId: string, clienteId: string | null, ahora: Date): Promise<DocumentoCierreFila[]>;
}

/** La pregunta N11, con la lista de lo que falta. `null` = apagada, sin catálogo del cliente, o ya está todo. Nunca lanza. */
export async function preguntarDocumentosCierre(
  p: PuertosDocumentosCierre, config: Pick<ConfigConductor, 'pedirDocumentosCierreActivo'>, viaje: ViajeContexto, hito: Pick<HitoFila, 'tipo'>,
): Promise<Salida | null> {
  if (config.pedirDocumentosCierreActivo !== true || hito.tipo !== 'salida_descarga') return null;
  try {
    const existentes = await p.leer(viaje.tenantId, viaje.id);
    const filas = existentes.length > 0 ? existentes : await p.crear(viaje.tenantId, viaje.id, viaje.clienteId ?? null, new Date());
    const pendientes = filas.filter((f) => f.estado === 'pendiente');
    if (pendientes.length === 0) return null; // sin catálogo (nada que pedir), o ya está todo
    const nombre = una(viaje.operadorNombre ?? 'Hola', 40) || 'Hola';
    const folio = viaje.folio || viaje.id.slice(0, 8);
    return {
      texto: `${nombre}, para cerrar el viaje ${folio} faltan estos documentos: ${listaDocumentos(pendientes.map((d) => d.nombreSolicitado))}. Envíalos por aquí en fotos legibles y completas. Cuando termines, toca «Ya los envié».`,
      botones: [
        { id: `${PREFIJO_BOTON.documentosCierreListo}:${viaje.id}`, titulo: 'Ya los envié' },
        { id: `${PREFIJO_BOTON.documentosCierreFalta}:${viaje.id}`, titulo: 'Me falta uno' },
      ],
    };
  } catch (err) {
    logger.warn('conductor.documentos_cierre_pregunta_fallo', { viaje: viaje.id, err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
