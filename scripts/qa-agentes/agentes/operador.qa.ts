// ═══════════════════════════════════════════════════════════════════════════
// AGENTE OPERADOR SINTÉTICO — simula al chofer por WhatsApp SIN el número
// real de Meta (es el número de prueba: un chofer externo no puede escribir).
//
// El camino es el MISMO que producción ejercita en route.ts:89 — se llama
// `processInbound` EN PROCESO con `InboundMessage` sintéticos. Lo único que
// se sustituye es el cliente de Meta (@/lib/meta/client): los envíos se
// capturan en memoria (son la evidencia de qué le dijo el sistema al chofer)
// y las descargas de media salen de un registro local en vez del Graph API.
//
// Principio no negociable: este módulo EJECUTA la conversación; JAMÁS juzga
// el resultado — eso es de los oráculos (funciones puras sobre la DB).
// ═══════════════════════════════════════════════════════════════════════════

import { vi } from 'vitest';
import sharp from 'sharp';
import { PREFIJO_QA } from '../config.qa';
import type { TicketEscenario } from '../escenarios/operador.escenarios';

// ── Lo capturado por el Meta falso ──────────────────────────────────────────

export interface MensajeSaliente {
  t: string;
  para: string;
  tipo: 'texto' | 'botones' | 'documento' | 'plantilla';
  texto: string;
}

interface AlmacenMeta {
  salientes: MensajeSaliente[];
  media: Map<string, string>;       // mediaId → dataUrl
  mediaTexto: Map<string, string>;  // mediaId → texto (XML)
  n: number;
}

const almacen: AlmacenMeta = { salientes: [], media: new Map(), mediaTexto: new Map(), n: 0 };
let metaInstalado = false;

/**
 * Sustituye el cliente de Meta por el falso. Llamar ANTES de cualquier
 * import (aunque sea transitivo) de `processor.ts` — por eso `cargarProcessor`
 * de abajo es un import dinámico. Las funciones puras (verify*, destinatario)
 * se conservan reales vía `vi.importActual`.
 */
export function instalarMetaFalso(): AlmacenMeta {
  if (metaInstalado) return almacen;
  metaInstalado = true;
  vi.doMock('@/lib/meta/client', async () => {
    const real = await vi.importActual<typeof import('@/lib/meta/client')>('@/lib/meta/client');
    const wamid = () => `wamid.${PREFIJO_QA}${++almacen.n}`;
    return {
      ...real,
      sendText: async (to: string, body: string): Promise<string | null> => {
        almacen.salientes.push({ t: new Date().toISOString(), para: to, tipo: 'texto', texto: body });
        return wamid();
      },
      sendButtons: async (to: string, cuerpo: string): Promise<string | null> => {
        almacen.salientes.push({ t: new Date().toISOString(), para: to, tipo: 'botones', texto: cuerpo });
        return wamid();
      },
      sendTemplate: async (to: string, plantilla: string) => {
        almacen.salientes.push({ t: new Date().toISOString(), para: to, tipo: 'plantilla', texto: plantilla });
        return { ok: true as const, id: wamid() };
      },
      sendDocument: async (to: string, _link: string, filename: string, caption?: string) => {
        almacen.salientes.push({
          t: new Date().toISOString(), para: to, tipo: 'documento',
          texto: `${filename}${caption ? ` — ${caption}` : ''}`,
        });
        return { ok: true as const, id: wamid() };
      },
      downloadMediaAsDataUrl: async (mediaId: string): Promise<string | null> =>
        almacen.media.get(mediaId) ?? null,
      downloadMediaAsText: async (mediaId: string): Promise<string | null> =>
        almacen.mediaTexto.get(mediaId) ?? null,
      enviarRespuestaArco: async (telefono: string, respuesta: string) => {
        almacen.salientes.push({ t: new Date().toISOString(), para: telefono, tipo: 'texto', texto: respuesta });
        return { ok: true as const };
      },
    };
  });
  return almacen;
}

/** El processor, DESPUÉS del mock. Import dinámico a propósito. */
export async function cargarProcessor(): Promise<typeof import('@/lib/likida/processor')> {
  if (!metaInstalado) throw new Error('instalarMetaFalso() va primero: sin él, processInbound le hablaría al Graph API real');
  return import('@/lib/likida/processor');
}

/** Registra una imagen sintética y devuelve su mediaId QA. */
export function registrarMedia(dataUrl: string, etiqueta: string): string {
  const id = `${PREFIJO_QA}media-${etiqueta}-${++almacen.n}`;
  almacen.media.set(id, dataUrl);
  return id;
}

/** Corta la lista de salientes: devuelve lo acumulado y limpia el buffer. */
export function drenarSalientes(): MensajeSaliente[] {
  const copia = [...almacen.salientes];
  almacen.salientes.length = 0;
  return copia;
}

// ── El ticket sintético (mismo patrón sharp+SVG que inyeccion.prueba.ts) ────

/** Un ticket de gasolinera creíble y LIMPIO (sin payload), datos del PRNG.
 *  Mismo dataUrl para los mismos datos → el ataque de duplicado es byte a byte. */
export async function generarTicketPng(t: TicketEscenario): Promise<string> {
  const [y, m, d] = t.fecha.split('-');
  const precio = (t.monto / 1.16 / t.litros).toFixed(3);
  const subtotal = (t.monto / 1.16).toFixed(2);
  const iva = (t.monto - t.monto / 1.16).toFixed(2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="620" height="820">
    <rect width="620" height="820" fill="#ffffff"/>
    <g font-family="monospace" font-size="21" fill="#111111">
      <text x="40" y="60">GASOLINERA ZZZ QA SA DE CV</text>
      <text x="40" y="90">ESTACION 9901   CARR FEDERAL KM 99</text>
      <text x="40" y="130">FOLIO       ${t.folio}</text>
      <text x="40" y="160">FECHA       ${d}/${m}/${y}  10:15</text>
      <text x="40" y="200">PRODUCTO    DIESEL</text>
      <text x="40" y="230">LITROS      ${t.litros.toFixed(3)}</text>
      <text x="40" y="260">PRECIO      ${precio}</text>
      <text x="40" y="300">SUBTOTAL       ${subtotal}</text>
      <text x="40" y="330">IVA 16%         ${iva}</text>
      <text x="40" y="365" font-size="27">TOTAL         ${t.monto.toFixed(2)}</text>
      <text x="40" y="400">FORMA DE PAGO  TARJETA</text>
      <text x="40" y="450">GRACIAS POR SU COMPRA</text>
    </g>
  </svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

// ── Bitácora capturada (para el oráculo #8) ────────────────────────────────
// Se envuelve el objeto `logger` exportado (misma instancia de módulo que usa
// todo src/) — NO se modifica src: se sustituyen las propiedades en runtime y
// se restauran al terminar. Cada evento sigue emitiéndose de verdad.

export interface EventoBitacora { nivel: 'info' | 'warn' | 'error'; msg: string; meta?: Record<string, unknown> }

export async function capturarBitacora(): Promise<{ eventos: EventoBitacora[]; restaurar: () => void }> {
  const { logger } = await import('@/lib/logger');
  const eventos: EventoBitacora[] = [];
  const originales = { info: logger.info, warn: logger.warn, error: logger.error };
  (['info', 'warn', 'error'] as const).forEach((nivel) => {
    logger[nivel] = (m: string, meta?: Record<string, unknown>) => {
      eventos.push({ nivel, msg: m, meta });
      return originales[nivel](m, meta);
    };
  });
  return {
    eventos,
    restaurar: () => {
      logger.info = originales.info;
      logger.warn = originales.warn;
      logger.error = originales.error;
    },
  };
}

// ── Los movimientos del chofer sintético ────────────────────────────────────

export async function enviarFoto(
  telefono: string, dataUrl: string, etiqueta: string, caption?: string,
): Promise<void> {
  const { processInbound } = await cargarProcessor();
  await processInbound({
    from: telefono,
    type: 'image',
    text: caption,
    mediaId: registrarMedia(dataUrl, etiqueta),
    waMessageId: `${PREFIJO_QA}${etiqueta}-${++almacen.n}`,
  });
}

export async function enviarTexto(telefono: string, texto: string, etiqueta: string): Promise<void> {
  const { processInbound } = await cargarProcessor();
  await processInbound({
    from: telefono,
    type: 'text',
    text: texto,
    waMessageId: `${PREFIJO_QA}${etiqueta}-${++almacen.n}`,
  });
}
