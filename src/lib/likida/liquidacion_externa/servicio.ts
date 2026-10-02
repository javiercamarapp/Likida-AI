// ═══════════════════════════════════════════════════════════════════════════
// LIQUIDACIÓN EXTERNA — el servicio: recibir, entregar, reintentar, acusar.
//
// Las cuatro operaciones comparten una disciplina:
//
//   · el ESTADO solo cambia con una transición condicional (`transicionar`):
//     el POST (que intenta entregar de inmediato) y el cron (que levanta lo que
//     quedó) pueden coincidir sobre la misma fila, y ninguno puede pisar al
//     otro ni mandar el mensaje dos veces;
//   · lo que sale a WhatsApp sale POR EL PUERTO (`EntregaWhatsApp`): este
//     archivo no sabe de Meta;
//   · nada se marca `enviada` sin que el puerto diga que Meta aceptó el
//     mensaje, y nada se marca `acusada` sin que el chofer haya apretado.
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';
import { conPool } from '../lotes';
import { generarPdfLiquidacionExterna } from './pdf';
import { generarExcelFormato, generarPdfFormato, type DatosFormato } from './render_formato';
import { rutaPdfExterno, rutaExcelExterno } from './almacen';
import {
  entregaPorOutbox, TTL_URL_PDF_SEGUNDOS,
  type EntregaWhatsApp, type EstadoEntrega,
} from './entrega';
import {
  resolverOperadorDestino, resolverViajeIds, insertarLiquidacionExterna, registrarEvento,
  transicionar, leerPorId, subirArchivoExterno, firmarPdfExterno, leerRazonSocial, confirmarAcuses, leerFormatoFlota, TIPO_XLSX,
  type LiquidacionExterna, type TipoAcuse, type ResultadoConfirmacion, type ConfigFormatoFlota,
} from './repo';
import { trabajoPendiente } from './trabajo';
import { avisarNoCoincidePorOmision, type AvisarNoCoincide } from './aviso_no_coincide';
import { copiarAJefePorOmision, type CopiarAJefe, type ResultadoCopia } from './copia_jefe';
import type { LiquidacionExternaNormalizada } from './esquema';

/** Cuántas veces el cron intenta ENCOLAR (fallos nuestros, transitorios) antes
 *  de darla por fallida y pedirle a una persona que mire. */
export const MAX_INTENTOS_ENCOLADO = 5;
/** Lote por pasada del cron. */
export const LOTE_CRON = 50;

export interface Dependencias {
  entrega: EntregaWhatsApp;
  ahora: () => Date;
  /** Razón social de la flota, para el encabezado del PDF que Likida genera. */
  razonSocial: (tenantId: string) => Promise<string | null>;
  firmarPdf: (ruta: string, ttlSegundos: number) => Promise<string>;
  /** Avisa a la oficina que un chofer respondió «No coincide». `true` = Meta aceptó el aviso. */
  avisarNoCoincide: AvisarNoCoincide;
  /** El formato de la flota (0564), o `null` si no tiene o la base aún no trae la 0564. */
  formato: (tenantId: string) => Promise<ConfigFormatoFlota | null>;
  /** Sube un archivo al bucket de liquidaciones (PDF o Excel). */
  subirArchivo: (ruta: string, bytes: Uint8Array, tipo: string) => Promise<void>;
  /** Copia de la liquidación entregada al jefe de flota. */
  copiarAJefe: CopiarAJefe;
}

export const dependenciasPorOmision: Dependencias = {
  entrega: entregaPorOutbox,
  ahora: () => new Date(),
  razonSocial: leerRazonSocial,
  firmarPdf: (ruta, ttl) => firmarPdfExterno(ruta, ttl),
  avisarNoCoincide: avisarNoCoincidePorOmision,
  formato: (t) => leerFormatoFlota(t),
  subirArchivo: (r, b, t) => subirArchivoExterno(r, b, t),
  copiarAJefe: copiarAJefePorOmision,
};

// ── recibir ─────────────────────────────────────────────────────────────────

export interface Recibida {
  liquidacion: LiquidacionExterna;
}

/**
 * Lo que hace el POST dentro de `escribir()`: resuelve al chofer, prepara el
 * PDF, inserta y deja el evento. NO entrega — eso es `intentarEntrega`, que el
 * llamador invoca aparte para que un fallo de entrega jamás convierta una
 * recepción exitosa en un 500 (el cliente reintentaría algo que ya se guardó).
 */
export async function recibirLiquidacionExterna(
  tenantId: string, datos: LiquidacionExternaNormalizada, huella: string,
  deps: Dependencias = dependenciasPorOmision,
): Promise<Recibida> {
  const operador = await resolverOperadorDestino(tenantId, datos.operador);
  const viajeIds = await resolverViajeIds(tenantId, datos.viajes);

  let bytes: Uint8Array;
  let pdfOrigen: 'adjunto' | 'generado';
  let pdfSha: string | null;
  let excel: Uint8Array | null = null;
  let formato: ConfigFormatoFlota | null = null;
  if (datos.pdf) {
    // El PDF del cliente manda: no se reformatea ni se le pone otro aspecto.
    bytes = datos.pdf.bytes;
    pdfOrigen = 'adjunto';
    pdfSha = datos.pdf.sha256;
  } else {
    const razonSocial = await deps.razonSocial(tenantId);
    // El formato de la flota (0564): si lo tiene, el PDF y el Excel salen con SUS columnas.
    formato = await deps.formato(tenantId);
    if (formato) {
      const df: DatosFormato = {
        claveExterna: datos.claveExterna, sistemaOrigen: datos.sistemaOrigen, operadorNombre: operador.nombre, razonSocial,
        viajes: datos.viajes, desde: datos.periodo.desde, hasta: datos.periodo.hasta, conceptos: datos.conceptos,
        total: datos.total, moneda: datos.moneda,
      };
      bytes = await generarPdfFormato(formato.formato, df);
      excel = generarExcelFormato(formato.formato, df);
    } else {
      bytes = await generarPdfLiquidacionExterna({ liquidacion: datos, operadorNombre: operador.nombre, razonSocial });
    }
    pdfOrigen = 'generado';
    pdfSha = null;
  }
  const ruta = rutaPdfExterno(tenantId, datos.claveExterna, huella);
  await deps.subirArchivo(ruta, bytes, 'application/pdf');
  if (excel) {
    try {
      await deps.subirArchivo(rutaExcelExterno(ruta), excel, TIPO_XLSX);
    } catch (e) {
      // Si el Excel es el documento que viaja por WhatsApp, sin él no hay entrega: se falla
      // (el cliente reintenta). Si es solo el complemento del panel, se dice y se sigue.
      if (formato?.formato.salida === 'xlsx') throw e;
      logger.warn('liqext.excel_sin_subir', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
    }
  }
  const liquidacion = await insertarLiquidacionExterna({
    tenantId, datos, huella, operadorId: operador.id, viajeIds,
    pdfRuta: ruta, pdfOrigen, pdfSha256: pdfSha,
  });
  await registrarEvento(tenantId, liquidacion.id, 'recibida', {
    origen: datos.sistemaOrigen, conceptos: datos.conceptos.length, viajes: datos.viajes.length,
    viajesEnLikida: viajeIds.length, pdf: pdfOrigen, formatoFlota: formato !== null,
  });
  return { liquidacion };
}

// ── entregar ────────────────────────────────────────────────────────────────

/** 2, 4, 8, 16 minutos: lo bastante corto para que un blip del outbox no deje
 *  al chofer sin su liquidación, y lo bastante largo para no martillarlo. */
function esperaMs(intentos: number): number {
  return Math.min(2 ** intentos, 30) * 60_000;
}

export type ResultadoEntrega = 'en_cola' | 'enviada' | 'reintentar' | 'fallida' | 'sin_cambio';

/**
 * Empuja UNA liquidación un paso adelante. Idempotente y segura de llamar
 * desde el POST y desde el cron a la vez. NUNCA lanza: lo que falle queda en la
 * fila (`ultimo_error`) y en el log.
 */
export async function intentarEntrega(
  liq: LiquidacionExterna, deps: Dependencias = dependenciasPorOmision,
): Promise<ResultadoEntrega> {
  const tenantId = liq.tenantId;
  try {
    // Solo se empuja lo que no terminó: una acusada o fallida no se toca.
    if (liq.estado !== 'pendiente' && liq.estado !== 'en_cola') return 'sin_cambio';
    if (!liq.pdfRuta) throw new Error('la liquidación no tiene PDF en Storage');
    if (!liq.operadorTelefono) throw new Error('el operador no tiene teléfono');

    const base = `liquidacion-${liq.claveExterna.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60)}`;
    const doc = await documentoDeEntrega(liq, base, deps);
    const estado: EstadoEntrega = await deps.entrega.enviarConFallback({
      tenantId, liquidacionId: liq.id, generacion: liq.generacion,
      telefono: liq.operadorTelefono, nombre: liq.operadorNombre ?? '',
      desde: liq.periodoDesde, hasta: liq.periodoHasta, total: liq.total, moneda: liq.moneda,
      sistemaOrigen: liq.sistemaOrigen, pdfUrl: doc.url, pdfNombre: doc.nombre,
    });
    const ahora = deps.ahora();

    if (estado.estado === 'en_cola') {
      const cambio = liq.estado === 'pendiente';
      const cambioDeVia = liq.via !== null && liq.via !== estado.via;
      if (!cambio && !cambioDeVia) return 'sin_cambio';
      const aplicada = await transicionar(tenantId, liq.id, ['pendiente', 'en_cola'], {
        estado: 'en_cola', via: estado.via, ultimo_error: null,
        ...(cambio ? { intentos: liq.intentos + 1 } : {}),
      });
      if (aplicada) {
        await registrarEvento(tenantId, liq.id, estado.via === 'plantilla' && cambioDeVia ? 'fallback_plantilla' : 'encolada', { via: estado.via });
        if (cambio) await copiarSinTumbar(liq, doc, deps);
      }
      return 'en_cola';
    }

    if (estado.estado === 'enviada') {
      const aplicada = await transicionar(tenantId, liq.id, ['pendiente', 'en_cola'], {
        estado: 'enviada', via: estado.via, wamid: estado.wamid || null,
        enviada_en: ahora.toISOString(), ultimo_error: null,
      });
      if (aplicada) {
        await registrarEvento(tenantId, liq.id, 'enviada', { via: estado.via, wamid: estado.wamid || null });
        await copiarSinTumbar(liq, doc, deps);
      }
      return 'enviada';
    }

    // fallida
    if (estado.reintentable && liq.intentos + 1 < MAX_INTENTOS_ENCOLADO) {
      const aplicada = await transicionar(tenantId, liq.id, ['pendiente', 'en_cola'], {
        estado: 'pendiente', intentos: liq.intentos + 1, ultimo_error: estado.error.slice(0, 500),
        proximo_intento_en: new Date(ahora.getTime() + esperaMs(liq.intentos + 1)).toISOString(),
      });
      if (aplicada) logger.warn('liqext.reintento_programado', { id: liq.id, intentos: liq.intentos + 1 });
      return 'reintentar';
    }
    const aplicada = await transicionar(tenantId, liq.id, ['pendiente', 'en_cola'], {
      estado: 'fallida', via: estado.via, ultimo_error: estado.error.slice(0, 500),
    });
    if (aplicada) {
      logger.error('liqext.fallida', { id: liq.id, via: estado.via });
      await registrarEvento(tenantId, liq.id, 'fallida', { via: estado.via, error: estado.error.slice(0, 500) });
    }
    return 'fallida';
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error('liqext.entrega_error', { id: liq.id, err: error });
    // Un fallo NUESTRO (no se pudo firmar, el PDF no está) se reintenta con
    // backoff igual que un outbox mudo, y al agotar intentos queda fallida a la
    // vista del panel — nunca en un limbo de `pendiente` eterno.
    try {
      const fin = liq.intentos + 1 >= MAX_INTENTOS_ENCOLADO;
      await transicionar(tenantId, liq.id, ['pendiente', 'en_cola'], fin
        ? { estado: 'fallida', ultimo_error: error.slice(0, 500) }
        : {
          estado: 'pendiente', intentos: liq.intentos + 1, ultimo_error: error.slice(0, 500),
          proximo_intento_en: new Date(deps.ahora().getTime() + esperaMs(liq.intentos + 1)).toISOString(),
        });
      if (fin) await registrarEvento(tenantId, liq.id, 'fallida', { error: error.slice(0, 500) });
      return fin ? 'fallida' : 'reintentar';
    } catch (e2) {
      logger.error('liqext.entrega_error_sin_registrar', { id: liq.id, err: e2 instanceof Error ? e2.message : String(e2) });
      return 'sin_cambio';
    }
  }
}


// ── el documento que viaja y la copia al jefe ───────────────────────────────

interface DocumentoEntrega { url: string; nombre: string; formato: 'pdf' | 'xlsx' }

/**
 * Qué documento se entrega: el PDF de siempre, salvo que la flota pidió el
 * Excel de su formato (y la liquidación es de las que Likida generó: el PDF
 * que adjunta el cliente jamás se reemplaza). Si el Excel no está en Storage
 * (la liquidación llegó antes de configurar el formato), se entrega el PDF y se
 * dice, en vez de fallar la entrega.
 */
async function documentoDeEntrega(liq: LiquidacionExterna, base: string, deps: Dependencias): Promise<DocumentoEntrega> {
  const pdfRuta = liq.pdfRuta as string;
  if (liq.pdfOrigen === 'generado') {
    const cfg = await deps.formato(liq.tenantId);
    if (cfg?.formato.salida === 'xlsx') {
      try {
        const url = await deps.firmarPdf(rutaExcelExterno(pdfRuta), TTL_URL_PDF_SEGUNDOS);
        return { url, nombre: `${base}.xlsx`, formato: 'xlsx' };
      } catch (e) {
        logger.warn('liqext.excel_no_disponible_se_entrega_pdf', { id: liq.id, err: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  return { url: await deps.firmarPdf(pdfRuta, TTL_URL_PDF_SEGUNDOS), nombre: `${base}.pdf`, formato: 'pdf' };
}

/** La copia al jefe NUNCA tumba ni retrasa la entrega al chofer: ya salió o quedó en cola. */
async function copiarSinTumbar(liq: LiquidacionExterna, doc: DocumentoEntrega, deps: Dependencias): Promise<void> {
  try {
    await deps.copiarAJefe(liq, { url: doc.url, nombre: doc.nombre });
  } catch (e) {
    logger.error('liqext.copia_jefe_lanzo', { id: liq.id, err: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Reenvía la copia al jefe de una liquidación ya entregada (el panel, cuando la
 * primera no llegó). No toca el estado ni al chofer.
 */
export async function reenviarCopiaAJefe(
  tenantId: string, id: string, deps: Dependencias = dependenciasPorOmision,
): Promise<ResultadoCopia | { estado: 'no_encontrada' } | { estado: 'no_aplica' }> {
  const liq = await leerPorId(tenantId, id);
  if (!liq) return { estado: 'no_encontrada' };
  if (!liq.pdfRuta || liq.estado === 'pendiente') return { estado: 'no_aplica' };
  const base = `liquidacion-${liq.claveExterna.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60)}`;
  const doc = await documentoDeEntrega(liq, base, deps);
  return deps.copiarAJefe(liq, { url: doc.url, nombre: doc.nombre });
}

// ── el cron ─────────────────────────────────────────────────────────────────

export interface ResumenPasada {
  tomadas: number;
  en_cola: number; enviadas: number; reintentar: number; fallidas: number; sin_cambio: number;
}

export async function procesarLiquidacionesExternas(
  deps: Dependencias = dependenciasPorOmision, limite = LOTE_CRON,
): Promise<ResumenPasada> {
  const trabajo = await trabajoPendiente(limite, deps.ahora().toISOString());
  const resumen: ResumenPasada = { tomadas: trabajo.length, en_cola: 0, enviadas: 0, reintentar: 0, fallidas: 0, sin_cambio: 0 };
  await conPool(trabajo, 4, async (liq) => {
    const r = await intentarEntrega(liq, deps);
    if (r === 'enviada') resumen.enviadas++;
    else if (r === 'en_cola') resumen.en_cola++;
    else if (r === 'reintentar') resumen.reintentar++;
    else if (r === 'fallida') resumen.fallidas++;
    else resumen.sin_cambio++;
  });
  return resumen;
}

// ── reintento manual ────────────────────────────────────────────────────────

export type ResultadoReintento = 'reintentada' | 'no_encontrada' | 'no_aplica';

/**
 * El panel reintenta una entrega FALLIDA. Sube la generación (llave de
 * deduplicación nueva: la anterior apunta a una fila `dead` del outbox) y la
 * vuelve `pendiente`. Solo desde `fallida`: reintentar una que sí salió sería
 * mandarle dos veces el mismo pago al chofer.
 */
export async function reintentarLiquidacionExterna(
  tenantId: string, id: string, actor: string, deps: Dependencias = dependenciasPorOmision,
): Promise<ResultadoReintento> {
  const liq = await leerPorId(tenantId, id);
  if (!liq) return 'no_encontrada';
  if (liq.estado !== 'fallida') return 'no_aplica';
  const aplicada = await transicionar(tenantId, id, ['fallida'], {
    estado: 'pendiente', generacion: liq.generacion + 1, intentos: 0, via: null,
    proximo_intento_en: deps.ahora().toISOString(), ultimo_error: null,
  });
  if (!aplicada) return 'no_aplica';
  await registrarEvento(tenantId, id, 'reintento_manual', { actor, generacion: liq.generacion + 1 });
  const fresca = await leerPorId(tenantId, id);
  if (fresca) await intentarEntrega(fresca, deps);
  return 'reintentada';
}

// ── acuse del chofer ────────────────────────────────────────────────────────

export type ResultadoAcuse = 'registrado' | 'ya_registrado' | 'no_encontrada';

/** Qué pasó con el aviso a la oficina (solo aplica a «No coincide»). */
export type AvisoOficina = 'enviado' | 'no_enviado' | 'no_aplica';

export interface AcuseRegistrado { resultado: ResultadoAcuse; avisoOficina: AvisoOficina }

/**
 * El chofer apretó un botón. El `operadorId` sale de SU teléfono (processor), no
 * del id del botón: un chofer que reenvía o fabrica un id ajeno no puede acusar
 * la liquidación de otro. `no_encontrada` cubre «no existe», «es de otra flota»
 * y «es de otro chofer» a propósito: no se distingue para no revelar cuál.
 *
 * «No coincide» AVISA a la oficina (quien ve dinero) por el selector central; el
 * resultado del aviso se devuelve para que al chofer solo se le prometa lo que de
 * verdad salió, y queda en la bitácora (`aviso_oficina`). Si el chofer cambia de
 * respuesta, la confirmación que el sistema del cliente ya había dado (0561) se
 * reinicia: el acuse nuevo se le entrega otra vez.
 */
export async function registrarAcuseConAviso(
  tenantId: string, operadorId: string, liquidacionId: string, tipo: TipoAcuse,
  deps: Pick<Dependencias, 'ahora'> & Partial<Pick<Dependencias, 'avisarNoCoincide'>> = dependenciasPorOmision,
): Promise<AcuseRegistrado> {
  const liq = await leerPorId(tenantId, liquidacionId);
  if (!liq || liq.operadorId !== operadorId) return { resultado: 'no_encontrada', avisoOficina: 'no_aplica' };
  if (liq.estado === 'acusada' && liq.acuseTipo === tipo) return { resultado: 'ya_registrado', avisoOficina: 'no_aplica' };
  // La transición es condicional TAMBIÉN sobre el acuse: de dos entregas simultáneas del mismo botón (el chequeo de arriba
  // las deja pasar a las dos) solo una la aplica, y solo esa avisa a la oficina.
  const aplicada = await transicionar(
    tenantId, liquidacionId, ['pendiente', 'en_cola', 'enviada', 'fallida', 'acusada'],
    { estado: 'acusada', acuse_tipo: tipo, acuse_en: deps.ahora().toISOString(), acuse_confirmado_en: null },
    { acuseDistintoDe: tipo },
  );
  if (!aplicada) {
    const ahora = await leerPorId(tenantId, liquidacionId);
    return ahora && ahora.estado === 'acusada' && ahora.acuseTipo === tipo
      ? { resultado: 'ya_registrado', avisoOficina: 'no_aplica' }
      : { resultado: 'no_encontrada', avisoOficina: 'no_aplica' };
  }
  await registrarEvento(tenantId, liquidacionId, tipo === 'recibida' ? 'acuse_recibida' : 'acuse_no_coincide', {});
  if (tipo !== 'no_coincide') return { resultado: 'registrado', avisoOficina: 'no_aplica' };

  const avisar = deps.avisarNoCoincide ?? dependenciasPorOmision.avisarNoCoincide;
  let enviado = false;
  try { enviado = await avisar(liq); } catch (e) {
    logger.error('liqext.no_coincide_aviso_lanzo', { id: liquidacionId, err: e instanceof Error ? e.message : String(e) });
  }
  await registrarEvento(tenantId, liquidacionId, 'aviso_oficina', { enviado });
  return { resultado: 'registrado', avisoOficina: enviado ? 'enviado' : 'no_enviado' };
}

/** Compatibilidad: solo el resultado del acuse. */
export async function registrarAcuse(
  tenantId: string, operadorId: string, liquidacionId: string, tipo: TipoAcuse,
  deps: Pick<Dependencias, 'ahora'> & Partial<Pick<Dependencias, 'avisarNoCoincide'>> = dependenciasPorOmision,
): Promise<ResultadoAcuse> {
  return (await registrarAcuseConAviso(tenantId, operadorId, liquidacionId, tipo, deps)).resultado;
}

// ── el sistema del cliente confirma que ya leyó los acuses ──────────────────

/** Máximo de ids por confirmación (un lote de pull razonable). */
export const MAX_IDS_CONFIRMACION = 200;

export async function confirmarAcusesLeidos(
  tenantId: string, ids: string[], actor: string, deps: Pick<Dependencias, 'ahora'> = dependenciasPorOmision,
): Promise<ResultadoConfirmacion> {
  const unicos = [...new Set(ids)];
  const r = await confirmarAcuses(tenantId, unicos, deps.ahora().toISOString());
  for (const id of r.confirmadas) await registrarEvento(tenantId, id, 'acuse_confirmado', { actor });
  return r;
}
