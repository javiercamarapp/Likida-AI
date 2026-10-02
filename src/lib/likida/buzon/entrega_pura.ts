import { hoyMx, diaEnZona, TZ_MX } from '@/lib/formato';
import type { FormatoExport } from '../proveedores';

// ═══════════════════════════════════════════════════════════════════════════
// LA ENTREGA AL CONTADOR — la mitad PURA (reglas, sin base ni red).
//
// Lo aprobado por una persona sale al contador por correo en LOTES: un CSV (layout
// genérico, SAP B1 o CONTPAQi) y, si la flota quiere, un ZIP con el XML y el PDF de
// cada factura. La aprobación humana se conserva (LFPDPPP 26-II): este módulo solo
// decide CUÁNDO sale un lote y CÓMO se reintenta, nunca QUÉ factura es buena.
// ═══════════════════════════════════════════════════════════════════════════

export interface ConfigEntrega {
  activo: boolean;
  destinatarios: string[];
  formato: FormatoExport;
  incluirZip: boolean;
  automatica: boolean;
  /** Hora de México (0–23) a partir de la cual el cron manda el lote del día. */
  horaEnvio: number;
  minFacturas: number;
}

export const CONFIG_ENTREGA_DEFAULT: ConfigEntrega = {
  activo: false, destinatarios: [], formato: 'generico', incluirZip: true, automatica: false, horaEnvio: 8, minFacturas: 1,
};

/** Facturas por lote: el ZIP con XML+PDF debe caber en el tope de adjuntos del correo (28 MB). */
export const MAX_FACTURAS_POR_LOTE = 200;
export const MAX_DESTINATARIOS = 5;
export const MAX_INTENTOS = 5;
/** Minutos de espera tras el intento N (1-based) fallido: 15 min, 1 h, 4 h, 12 h; el 5.º agota. */
export const ESPERA_REINTENTO_MIN = [15, 60, 240, 720] as const;
/** El lease del claim de envío: si el proceso muere con el lote «enviando», pasado esto otro lo retoma. */
export const LEASE_ENVIO_MS = 5 * 60_000;
/** Tras cuánto una entrega «enviada» sin confirmación de Resend se marca con retraso. */
export const RETRASO_CONFIRMACION_MS = 6 * 3_600_000;

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Normaliza la lista que escribió una persona (separada por coma, espacio, punto y coma o renglón). */
export function parsearDestinatarios(crudo: string): { ok: true; destinatarios: string[] } | { ok: false; error: string } {
  const lista = [...new Set(crudo.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
  const malos = lista.filter((c) => !CORREO.test(c) || c.length > 254);
  if (malos.length > 0) return { ok: false, error: `Esto no parece un correo: ${malos.slice(0, 3).join(', ')}.` };
  if (lista.length > MAX_DESTINATARIOS) return { ok: false, error: `Máximo ${MAX_DESTINATARIOS} destinatarios.` };
  return { ok: true, destinatarios: lista };
}

export function validarConfigEntrega(c: ConfigEntrega): string | null {
  if (c.activo && c.destinatarios.length === 0) return 'Para activar la entrega captura al menos un correo del contador.';
  if (c.destinatarios.length > MAX_DESTINATARIOS) return `Máximo ${MAX_DESTINATARIOS} destinatarios.`;
  if (!['generico', 'sap_b1', 'contpaqi'].includes(c.formato)) return 'Formato desconocido.';
  if (!Number.isInteger(c.horaEnvio) || c.horaEnvio < 0 || c.horaEnvio > 23) return 'La hora de envío va de 0 a 23.';
  if (!Number.isInteger(c.minFacturas) || c.minFacturas < 1 || c.minFacturas > 100) return 'El mínimo de facturas va de 1 a 100.';
  return null;
}

/** La hora (0–23) en la Ciudad de México. */
export function horaMx(ahora: Date): number {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: TZ_MX, hour: '2-digit', hour12: false }).format(ahora);
  return Number(h) % 24;
}

/**
 * ¿Toca armar el lote AUTOMÁTICO de hoy? Solo si está activa y automática, ya pasó la hora de envío y no se creó
 * ya un lote automático en el día de México (uno al día, aunque el cron corra cada 15 minutos).
 */
export function tocaLoteAutomatico(config: ConfigEntrega, ahora: Date, ultimoAutomaticoEn: string | null): boolean {
  if (!config.activo || !config.automatica || config.destinatarios.length === 0) return false;
  if (horaMx(ahora) < config.horaEnvio) return false;
  if (ultimoAutomaticoEn && diaEnZona(new Date(ultimoAutomaticoEn), TZ_MX) === hoyMx(ahora)) return false;
  return true;
}

/** Cuántas facturas se reservan: el tope del lote. Un lote automático con menos del mínimo no se arma. */
export function decidirTamanoLote(disponibles: number, disparo: 'manual' | 'automatica', minFacturas: number): number {
  if (disponibles <= 0) return 0;
  if (disparo === 'automatica' && disponibles < minFacturas) return 0;
  return Math.min(disponibles, MAX_FACTURAS_POR_LOTE);
}

/** Lo que pasa tras un intento fallido: reprogramar con backoff o agotar. `intentos` ya incluye el recién hecho. */
export function trasFallo(intentos: number, ahora: Date): { estado: 'pendiente' | 'fallida'; proximoIntentoEn: Date | null } {
  if (intentos >= MAX_INTENTOS) return { estado: 'fallida', proximoIntentoEn: null };
  const espera = ESPERA_REINTENTO_MIN[Math.min(intentos, ESPERA_REINTENTO_MIN.length) - 1] ?? 15;
  return { estado: 'pendiente', proximoIntentoEn: new Date(ahora.getTime() + espera * 60_000) };
}

export function nombreCsv(formato: FormatoExport, ahora: Date): string {
  const fecha = hoyMx(ahora);
  return formato === 'generico' ? `facturas_${fecha}.csv` : `facturas_${formato}_${fecha}.csv`;
}

export function nombreZip(ahora: Date): string {
  return `facturas_xml_pdf_${hoyMx(ahora)}.zip`;
}

/** El nombre de archivo de una factura dentro del ZIP: sin separadores ni caracteres raros. */
export function nombreArchivoFactura(emisorRfc: string | null, uuid: string, ext: 'xml' | 'pdf'): string {
  const rfc = (emisorRfc ?? 'SIN-RFC').replace(/[^A-Za-z0-9&-]/g, '').slice(0, 13) || 'SIN-RFC';
  return `${rfc}_${uuid.replace(/[^A-Za-z0-9-]/g, '').slice(0, 36)}.${ext}`;
}

/** El texto del correo al contador: qué lleva, de quién y qué NO es (el XML manda; la lectura de PDF no). */
export function textoCorreoEntrega(datos: {
  nFacturas: number; total: number; formato: FormatoExport; incluyeZip: boolean; faltanXml: number; nombreFlota: string | null;
}): { asunto: string; avance: string; titulo: string; parrafos: string[] } {
  const flota = datos.nombreFlota ?? 'la flota';
  const n = datos.nFacturas;
  const parrafos = [
    `Te enviamos ${n} factura${n === 1 ? '' : 's'} de proveedores de ${flota} que ya fueron aprobadas por una persona de la flota.`,
    `Adjunto: un CSV en el layout ${datos.formato === 'sap_b1' ? 'SAP Business One' : datos.formato === 'contpaqi' ? 'CONTPAQi' : 'genérico'}${datos.incluyeZip ? ' y un ZIP con el XML y el PDF de cada factura' : ''}.`,
  ];
  if (datos.faltanXml > 0) {
    parrafos.push(`Atención: ${datos.faltanXml} factura${datos.faltanXml === 1 ? '' : 's'} del lote no tiene XML (se leyó del PDF y una persona la cotejó). Las cifras de esas filas son de lectura, no del CFDI: pide el XML al proveedor antes de contabilizar.`);
  }
  parrafos.push('Si algo no cuadra, responde a la flota; este envío no modifica nada en tu sistema.');
  return {
    asunto: `Facturas de proveedores aprobadas · ${n} · ${flota}`.slice(0, 120),
    avance: `${n} factura${n === 1 ? '' : 's'} aprobada${n === 1 ? '' : 's'}`,
    titulo: 'Facturas de proveedores para contabilidad',
    parrafos,
  };
}
