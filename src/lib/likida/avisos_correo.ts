// ═══════════════════════════════════════════════════════════════════════════
// AVISOS POR CORREO — el canal genérico y reutilizable para decirle algo a una persona de una flota (OLA1-A3).
//
// Por qué existe: los avisos de los agentes salían SOLO por WhatsApp (Meta, con la verificación de negocio rechazada), y
// cuando el WhatsApp no sale el aviso se pierde en silencio. El correo (Resend, ya configurado para facturas y alertas) es
// el segundo canal. Este módulo es la UNICA puerta: lo usan Carta Porte (documento dudoso o agotado, copia al revisor del
// primer mes) y lo van a usar el agente de Peajes (A2) y el Vigía.
//
// Reglas (todas fallan CERRADO y lo dicen, jamás lanzan):
//   · Sin `tenantId` no se manda nada: un aviso sin flota no se sabe de quién es ni a quién le toca.
//   · El ASUNTO no lleva datos: ni RFC, ni correos, ni cifras largas, ni importes. Es genérico por tipo de aviso; el detalle
//     va en el cuerpo y detrás de la liga (que exige sesión). Un asunto con forma de dato personal se RECHAZA, no se recorta.
//   · Los destinatarios se limpian (formato, sin repetir, máximo 10); sin ninguno válido no se manda.
//   · Sin RESEND_API_KEY / RESEND_EMAIL_DOMAIN devuelve `sin_configurar` (no es un fallo: es un canal apagado).
//   · Idempotente: la llave de idempotencia de Resend se deriva de (flota, agente, tipo, `clave`), así un reintento tras un
//     timeout ambiguo no manda dos correos.
//
// CÓMO LO USA OTRO AGENTE (ver docs/operacion/avisos-correo.md):
//   await enviarAvisoCorreo({ tenantId, agente: 'peajes', tipo: 'reclamacion_vencida', asunto: 'Peajes: reclamación por vencer',
//     titulo: 'Una reclamación vence pronto', parrafos: ['Revísala antes del plazo.'], referencia: 'a1b2c3d4', liga, para: [correo], clave: idDelCaso });
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';
import { logger } from '@/lib/logger';
import type { Correo } from '@/lib/correo/plantilla';
import { enviarCorreo, type ResultadoEnvio } from '@/lib/correo/enviar';

export const MAX_DESTINATARIOS = 10;
export const MAX_ASUNTO = 120;
export const MAX_PARRAFOS = 6;
export const MAX_PARRAFO = 600;

export interface AvisoCorreo {
  tenantId: string;
  /** Qué agente avisa (`carta_porte`, `peajes`, `vigia`…): solo para el registro y la llave de idempotencia. */
  agente: string;
  /** Qué clase de aviso es (`documento_dudoso`, `documento_agotado`…): sin datos. */
  tipo: string;
  /** Genérico. Sin RFC, correos, importes ni cifras largas: si los trae, el aviso se rechaza. */
  asunto: string;
  titulo: string;
  /** Texto del cuerpo. El llamador es responsable de no meter datos de terceros que no deban viajar por correo. */
  parrafos: string[];
  /** Un código corto del caso (p. ej. los 8 primeros hex del id) para ubicarlo sin abrir el asunto. */
  referencia?: string;
  /** Liga al caso dentro de Likida (exige sesión). */
  liga?: string;
  para: readonly string[];
  /** Identifica ESTE aviso para la idempotencia (id del documento, del envío…). Sin ella no hay deduplicación del lado de Resend. */
  clave?: string;
}

export type MotivoSinAviso = 'sin_tenant' | 'sin_destinatarios' | 'asunto_inseguro' | 'sin_configurar' | 'rechazado' | 'red';
export type ResultadoAvisoCorreo = { ok: true; destinatarios: number } | { ok: false; motivo: MotivoSinAviso; detalle?: string };

export interface DepsAvisoCorreo {
  enviar(para: string[], correo: Correo, idempotencyKey?: string): Promise<ResultadoEnvio>;
}

const depsReales: DepsAvisoCorreo = {
  enviar: (para, correo, idempotencyKey) => enviarCorreo(para, correo, { ...(idempotencyKey ? { idempotencyKey } : {}) }),
};

const CORREO = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
// Formas de dato que NO deben ir en un asunto: correo, RFC (persona moral/física), 6+ dígitos seguidos, importes, URLs.
const FORMAS_PROHIBIDAS_EN_ASUNTO = [
  /[^\s@]+@[^\s@]+\.[^\s@]+/,
  /\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/i,
  /\d{6,}/,
  /[$€]\s*\d|\d\s*(?:mxn|usd|pesos)\b/i,
  /https?:\/\//i,
  /[\u0000-\u001f\u007f]/,
];

/** `true` si el asunto es apto para viajar: corto, sin saltos y sin formas de dato personal o fiscal. */
export function asuntoEsSeguro(asunto: string): boolean {
  const t = asunto.trim();
  if (t === '' || t.length > MAX_ASUNTO) return false;
  return !FORMAS_PROHIBIDAS_EN_ASUNTO.some((re) => re.test(t));
}

/** Destinatarios válidos, en minúsculas, sin repetir y con tope. */
export function limpiarDestinatarios(para: readonly (string | null | undefined)[]): string[] {
  const vistos = new Set<string>();
  for (const p of para) {
    const c = String(p ?? '').trim().toLowerCase();
    if (c.length <= 254 && CORREO.test(c)) vistos.add(c);
    if (vistos.size >= MAX_DESTINATARIOS) break;
  }
  return [...vistos];
}

const llaveIdempotencia = (a: AvisoCorreo): string | undefined =>
  a.clave ? createHash('sha256').update(`${a.tenantId}|${a.agente}|${a.tipo}|${a.clave}`).digest('hex') : undefined;

/** Manda un aviso. Nunca lanza: devuelve por qué no salió. */
export async function enviarAvisoCorreo(a: AvisoCorreo, deps: DepsAvisoCorreo = depsReales): Promise<ResultadoAvisoCorreo> {
  if (!a.tenantId || a.tenantId.trim() === '') return { ok: false, motivo: 'sin_tenant' };
  if (!asuntoEsSeguro(a.asunto)) {
    logger.warn('avisos_correo.asunto_inseguro', { agente: a.agente, tipo: a.tipo });
    return { ok: false, motivo: 'asunto_inseguro' };
  }
  const para = limpiarDestinatarios(a.para);
  if (para.length === 0) return { ok: false, motivo: 'sin_destinatarios' };
  const parrafos = a.parrafos.slice(0, MAX_PARRAFOS).map((p) => p.slice(0, MAX_PARRAFO));
  const correo: Correo = {
    asunto: a.asunto.trim(), avance: a.titulo.slice(0, 140), titulo: a.titulo.slice(0, 140), parrafos,
    ...(a.referencia ? { datos: [['Caso', a.referencia.slice(0, 40)]] as Array<[string, string]> } : {}),
    ...(a.liga ? { boton: { texto: 'Abrir en Likida', href: a.liga } } : {}),
    tono: 'atencion',
    porQueLoRecibes: 'Eres destinatario de los avisos de esta flota en Likida.',
  };
  try {
    const r = await deps.enviar(para, correo, llaveIdempotencia(a));
    if (r.ok) return { ok: true, destinatarios: para.length };
    if (r.motivo === 'sin_configurar') return { ok: false, motivo: 'sin_configurar' };
    // El detalle del proveedor puede citar el destinatario: no se propaga, solo la categoría.
    logger.warn('avisos_correo.no_salio', { agente: a.agente, tipo: a.tipo, motivo: r.motivo });
    return { ok: false, motivo: r.motivo === 'red' ? 'red' : 'rechazado' };
  } catch (e) {
    logger.warn('avisos_correo.excepcion', { agente: a.agente, tipo: a.tipo, err: e instanceof Error ? e.message.slice(0, 120) : 'desconocido' });
    return { ok: false, motivo: 'red' };
  }
}
