// ═══════════════════════════════════════════════════════════════════════════
// LIQUIDACIÓN EXTERNA — la entrega por WhatsApp.
//
// ── EL PUERTO: `EntregaWhatsApp.enviarConFallback` ───────────────────────────
//
// Entregar una liquidación es INICIAR una conversación con el chofer. Dentro de
// las 24 h de su último mensaje se puede mandar un mensaje de sesión (documento
// + botones); fuera, solo una plantilla aprobada. Decidir cuál toca es trabajo
// de un selector (`enviarConFallback`) que vive en la rama de WhatsApp de
// producción, junto con el registro de la ventana de 24 h. Hasta que exista, el
// contrato es esta interfaz fina, y la implementación por omisión
// (`entregaPorOutbox`) hace lo único honesto sin saber la ventana: PROBAR la
// sesión primero y, solo si Meta contesta «ventana cerrada», caer a la
// plantilla. Cuando llegue el selector real, se reemplaza `entregaPorOutbox` por
// un adaptador de esa interfaz y nada más de este módulo cambia.
//
// ── POR QUÉ POR EL OUTBOX Y NO UN `sendDocument` DIRECTO ─────────────────────
//
// `wa_outbox` (0180) es la cola durable: reclama con lease, reintenta con
// backoff, entierra con alerta lo que muere y reconcilia los recibos de Meta.
// Un envío directo desde aquí duplicaría todo eso —o peor, mandaría dos veces
// un mensaje de pago al mismo chofer si el reintento del cliente de Meta y el
// nuestro coincidieran—. El mensaje se ENCOLA con una llave de deduplicación
// estable (`liqext:<id>:g<generación>:<canal>`): encolarlo dos veces es la misma
// fila. Esta capa nunca habla con Meta.
//
// ── UN SOLO MENSAJE: DOCUMENTO + BOTONES ─────────────────────────────────────
//
// El mensaje interactivo de botones admite un encabezado de documento, así que
// el PDF, el resumen y los dos botones viajan juntos. Dos mensajes separados
// (documento, luego botones) no tienen orden garantizado en el outbox —se
// reclaman en lotes de 4 en paralelo— y el chofer podría ver los botones sin el
// documento.
// ═══════════════════════════════════════════════════════════════════════════

import { destinatarioWhatsApp } from '@/lib/meta/client';
import { CODIGOS_FUERA_VENTANA } from '@/lib/meta/aviso_oficina';
import { encolarSalidaWhatsAppDedupe } from '../wa_outbox';
import {
  cuerpoMensaje, primerNombre, PREFIJO_BOTON_RECIBIDA, PREFIJO_BOTON_NO_COINCIDE,
  TITULO_BOTON_RECIBIDA, TITULO_BOTON_NO_COINCIDE, dinero, periodoTexto,
} from './presentacion';
import type { MonedaExterna } from './esquema';
import { leerFilasOutbox, type FilaOutbox, type ViaEntrega } from './repo';

/** Plantilla que hay que dar de alta y aprobar en Meta (ver
 *  `docs/operacion/liquidacion-externa.md`). Una sola, con encabezado de
 *  documento, cuatro variables de cuerpo y dos botones de respuesta rápida. */
export const PLANTILLA_LIQUIDACION = 'liquidacion_externa_v1';
export const IDIOMA_PLANTILLA = 'es_MX';

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

export const llaveSesion = (id: string, generacion: number) => `liqext:${id}:g${generacion}:sesion`;
export const llavePlantilla = (id: string, generacion: number) => `liqext:${id}:g${generacion}:plantilla`;

// ── los payloads ────────────────────────────────────────────────────────────

/** El mensaje de SESIÓN: botones con encabezado de documento. */
export function payloadSesion(m: MensajeLiquidacion): Record<string, unknown> {
  return {
    messaging_product: 'whatsapp',
    to: destinatarioWhatsApp(m.telefono),
    type: 'interactive',
    interactive: {
      type: 'button',
      header: { type: 'document', document: { link: m.pdfUrl, filename: m.pdfNombre } },
      body: { text: cuerpoMensaje(m) },
      action: {
        buttons: [
          { type: 'reply', reply: { id: `${PREFIJO_BOTON_RECIBIDA}${m.liquidacionId}`, title: TITULO_BOTON_RECIBIDA } },
          { type: 'reply', reply: { id: `${PREFIJO_BOTON_NO_COINCIDE}${m.liquidacionId}`, title: TITULO_BOTON_NO_COINCIDE } },
        ],
      },
    },
  };
}

/** El mensaje de PLANTILLA (fuera de la ventana de 24 h). Variables de cuerpo:
 *  {{1}} nombre, {{2}} periodo, {{3}} total, {{4}} origen. */
export function payloadPlantilla(m: MensajeLiquidacion): Record<string, unknown> {
  const primer = primerNombre(m.nombre);
  return {
    messaging_product: 'whatsapp',
    to: destinatarioWhatsApp(m.telefono),
    type: 'template',
    template: {
      name: PLANTILLA_LIQUIDACION,
      language: { code: IDIOMA_PLANTILLA },
      components: [
        { type: 'header', parameters: [{ type: 'document', document: { link: m.pdfUrl, filename: m.pdfNombre } }] },
        {
          type: 'body',
          parameters: [
            { type: 'text', text: primer },
            { type: 'text', text: periodoTexto(m.desde, m.hasta) },
            { type: 'text', text: dinero(m.total, m.moneda) },
            { type: 'text', text: m.sistemaOrigen ?? 'el sistema de tu empresa' },
          ].map((p) => ({ ...p, text: p.text.replace(/\s+/g, ' ').trim() })),
        },
        { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: `${PREFIJO_BOTON_RECIBIDA}${m.liquidacionId}` }] },
        { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: `${PREFIJO_BOTON_NO_COINCIDE}${m.liquidacionId}` }] },
      ],
    },
  };
}

// ── el estado del outbox ────────────────────────────────────────────────────

/** ¿Meta rechazó por ventana de 24 h cerrada? El outbox guarda el cuerpo del
 *  error de Meta en `ultimo_error`. */
export function murioPorVentana(error: string | null): boolean {
  if (!error) return false;
  if (CODIGOS_FUERA_VENTANA.some((c) => error.includes(String(c)))) return true;
  return /re-?engagement/i.test(error);
}

function aEstado(f: FilaOutbox, via: ViaEntrega): EstadoEntrega {
  if (f.estado === 'sent') return { estado: 'enviada', via, wamid: f.provider_message_id ?? '' };
  if (f.estado === 'dead') return { estado: 'fallida', via, error: (f.ultimo_error ?? 'el outbox agotó los reintentos').slice(0, 500), reintentable: false };
  return { estado: 'en_cola', via };
}

/**
 * La implementación por omisión: sesión primero, plantilla si Meta dice que la
 * ventana está cerrada. Todo por el outbox, todo idempotente.
 */
export const entregaPorOutbox: EntregaWhatsApp = {
  async enviarConFallback(m) {
    const kS = llaveSesion(m.liquidacionId, m.generacion);
    const kP = llavePlantilla(m.liquidacionId, m.generacion);
    const filas = await leerFilasOutbox([kS, kP]);
    const sesion = filas.get(kS);
    const plantilla = filas.get(kP);

    // 1. Si ya se pasó a plantilla, ESA es la que manda.
    if (plantilla) return aEstado(plantilla, 'plantilla');

    // 2. Si la sesión murió por ventana cerrada, se cae a plantilla (una vez:
    //    la llave de deduplicación lo garantiza aunque dos crons coincidan).
    if (sesion?.estado === 'dead' && murioPorVentana(sesion.ultimo_error)) {
      const q = await encolarSalidaWhatsAppDedupe(kP, payloadPlantilla(m), 'liquidación externa: fuera de ventana, por plantilla');
      if (!q) return { estado: 'fallida', via: 'plantilla', error: 'no se pudo encolar la plantilla (el outbox no respondió)', reintentable: true };
      return aEstado({ dedupe_key: kP, estado: q.estado, provider_message_id: q.providerMessageId, ultimo_error: null }, 'plantilla');
    }

    // 3. Si la sesión ya está en el outbox, se reporta su estado real.
    if (sesion) return aEstado(sesion, 'sesion');

    // 4. Nada encolado todavía: se encola la sesión.
    const q = await encolarSalidaWhatsAppDedupe(kS, payloadSesion(m), 'liquidación externa');
    if (!q) return { estado: 'fallida', via: 'sesion', error: 'no se pudo encolar el mensaje (el outbox no respondió)', reintentable: true };
    return aEstado({ dedupe_key: kS, estado: q.estado, provider_message_id: q.providerMessageId, ultimo_error: null }, 'sesion');
  },
};
