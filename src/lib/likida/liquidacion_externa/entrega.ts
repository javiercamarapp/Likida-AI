// ═══════════════════════════════════════════════════════════════════════════
// LIQUIDACIÓN EXTERNA — la entrega por WhatsApp.
//
// ── EL PUERTO: `EntregaWhatsApp.enviarConFallback` ───────────────────────────
//
// Entregar una liquidación es INICIAR una conversación con el chofer. Dentro de
// las 24 h de su último mensaje se puede mandar un mensaje de sesión (documento
// + botones); fuera, solo una plantilla aprobada. Esa decisión la toma el
// SELECTOR CENTRAL (`src/lib/meta/enviar_con_fallback.ts`, ola 1) en su modo
// durable, que consulta el registro de la ventana de 24 h (`wa_ventana_contacto`)
// y deja constancia de cada decisión en `wa_envio_registro`. Este módulo solo
// aporta lo propio de la liquidación: el cuerpo, los botones, el PDF del
// encabezado y la plantilla `liquidacion_externa_v1` del catálogo.
//
// ── POR QUÉ EL MODO DURABLE (OUTBOX) Y NO UN ENVÍO DIRECTO ───────────────────
//
// `wa_outbox` (0180) es la cola durable: reclama con lease, reintenta con
// backoff, entierra con alerta lo que muere y reconcilia los recibos de Meta.
// Un envío directo duplicaría todo eso —o peor, mandaría dos veces un mensaje de
// pago al mismo chofer si el POST y el cron coincidieran—. El mensaje se ENCOLA
// con una llave de deduplicación estable (`liqext:<id>:g<generación>`): encolarlo
// dos veces es la misma fila. Esta capa nunca habla con Meta.
//
// ── UN SOLO MENSAJE: DOCUMENTO + BOTONES ─────────────────────────────────────
//
// El mensaje interactivo de botones admite un encabezado de documento, así que
// el PDF, el resumen y los dos botones viajan juntos. Dos mensajes separados
// (documento, luego botones) no tienen orden garantizado en el outbox —se
// reclaman en lotes de 4 en paralelo— y el chofer podría ver los botones sin el
// documento.
// ═══════════════════════════════════════════════════════════════════════════

import {
  enviarConFallbackDurable, llaveSesionDurable, llavePlantillaDurable, murioPorVentana,
  type ResultadoDurable,
} from '@/lib/meta/enviar_con_fallback';
import { opcionesDeEnvio, PLANTILLA } from '@/lib/meta/plantillas_catalogo';
import { payloadBotones } from '@/lib/meta/client';
import {
  cuerpoMensaje, primerNombre, PREFIJO_BOTON_RECIBIDA, PREFIJO_BOTON_NO_COINCIDE,
  TITULO_BOTON_RECIBIDA, TITULO_BOTON_NO_COINCIDE, dinero, periodoTexto,
} from './presentacion';
import type { MonedaExterna } from './esquema';
import type { ViaEntrega } from './repo';

/** Plantilla del catálogo central (`plantillas_catalogo.ts`) que hay que aprobar
 *  en Meta (ver `docs/operacion/liquidacion-externa.md`). Una sola, con
 *  encabezado de documento, cuatro variables de cuerpo y dos botones de
 *  respuesta rápida. */
export const PLANTILLA_LIQUIDACION = PLANTILLA.liquidacionExterna;
export const IDIOMA_PLANTILLA = 'es_MX';
export { murioPorVentana };

export interface MensajeLiquidacion {
  tenantId: string;
  liquidacionId: string;
  generacion: number;
  telefono: string;
  nombre: string;
  desde: string;
  hasta: string;
  total: number;
  moneda: MonedaExterna;
  sistemaOrigen: string | null;
  /** URL firmada del PDF (la cola puede tardar: ver `TTL_URL_PDF_SEGUNDOS`). */
  pdfUrl: string;
  pdfNombre: string;
}

export type EstadoEntrega =
  | { estado: 'en_cola'; via: ViaEntrega }
  | { estado: 'enviada'; via: ViaEntrega; wamid: string }
  // `reintentable`: el fallo fue NUESTRO y transitorio (el outbox no respondió al
  // encolar) —ni se llegó a Meta—, así que el cron lo vuelve a intentar. Un
  // fallo definitivo (el outbox enterró el mensaje) NO es reintentable solo: lo
  // decide una persona desde el panel.
  | { estado: 'fallida'; via: ViaEntrega; error: string; reintentable: boolean };

export interface EntregaWhatsApp {
  /**
   * Entrega el mensaje, IDEMPOTENTE: llamarla otra vez con el mismo
   * `(liquidacionId, generacion)` NO manda un segundo mensaje, avanza el mismo
   * y devuelve su estado actual. Quien la llama (el POST y el cron) no necesita
   * saber en qué punto del camino va.
   */
  enviarConFallback(m: MensajeLiquidacion): Promise<EstadoEntrega>;
}

/** Cuánto vive la URL del PDF dentro del payload encolado. La cola reintenta
 *  con backoff durante horas: 15 minutos (lo que usa el envío directo del
 *  cierre) vencería antes del tercer reintento. 24 h cubre de sobra los ocho
 *  reintentos del outbox, y se renueva en cada reintento manual. */
export const TTL_URL_PDF_SEGUNDOS = 24 * 3600;

/** Llave base de la entrega; el selector le añade `:sesion` / `:plantilla`. */
export const llaveEntrega = (id: string, generacion: number) => `liqext:${id}:g${generacion}`;
export const llaveSesion = (id: string, generacion: number) => llaveSesionDurable(llaveEntrega(id, generacion));
export const llavePlantilla = (id: string, generacion: number) => llavePlantillaDurable(llaveEntrega(id, generacion));

// ── los insumos del selector ────────────────────────────────────────────────

export const botonesLiquidacion = (liquidacionId: string) => [
  { id: `${PREFIJO_BOTON_RECIBIDA}${liquidacionId}`, titulo: TITULO_BOTON_RECIBIDA },
  { id: `${PREFIJO_BOTON_NO_COINCIDE}${liquidacionId}`, titulo: TITULO_BOTON_NO_COINCIDE },
];

/** El mensaje de SESIÓN: botones con encabezado de documento (lo arma el cliente
 *  de Meta; aquí solo se expone para las pruebas de contrato). */
export function payloadSesion(m: MensajeLiquidacion): Record<string, unknown> {
  return payloadBotones(m.telefono, cuerpoMensaje(m), botonesLiquidacion(m.liquidacionId), { url: m.pdfUrl, nombreArchivo: m.pdfNombre });
}

/** Variables de cuerpo de la plantilla, en el orden del catálogo:
 *  {{1}} nombre · {{2}} sistema de origen · {{3}} periodo · {{4}} total. */
export function variablesPlantilla(m: MensajeLiquidacion): string[] {
  return [
    primerNombre(m.nombre),
    m.sistemaOrigen ?? 'tu empresa',
    periodoTexto(m.desde, m.hasta),
    dinero(m.total, m.moneda),
  ].map((t) => t.replace(/\s+/g, ' ').trim());
}

function aEstado(r: ResultadoDurable): EstadoEntrega {
  if (r.estado === 'enviada') return { estado: 'enviada', via: r.via, wamid: r.wamid };
  if (r.estado === 'fallida') return { estado: 'fallida', via: r.via, error: r.error, reintentable: r.reintentable };
  return { estado: 'en_cola', via: r.via };
}

/**
 * La implementación por omisión: el selector central en modo durable. Todo por
 * el outbox, todo idempotente.
 */
export const entregaPorOutbox: EntregaWhatsApp = {
  async enviarConFallback(m) {
    const { idioma, ...opciones } = opcionesDeEnvio(PLANTILLA_LIQUIDACION, {
      cuerpo: variablesPlantilla(m),
      idsBotones: m.liquidacionId,
      medio: { link: m.pdfUrl, nombreArchivo: m.pdfNombre },
    });
    const r = await enviarConFallbackDurable(m.telefono, {
      llave: llaveEntrega(m.liquidacionId, m.generacion),
      texto: cuerpoMensaje(m),
      botones: botonesLiquidacion(m.liquidacionId),
      documento: { url: m.pdfUrl, nombreArchivo: m.pdfNombre },
      plantilla: { nombre: PLANTILLA_LIQUIDACION, idioma, ...opciones },
      contexto: 'liquidacion_externa',
      tenantId: m.tenantId,
    });
    return aEstado(r);
  },
};
