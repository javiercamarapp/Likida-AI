// ═══════════════════════════════════════════════════════════════════════════
// LIQUIDACIÓN EXTERNA — la forma que sale por /v1.
//
// Lo que NO sale, a propósito:
//   · la ruta del PDF en Storage ni ninguna URL firmada (son del servidor; el
//     integrador no necesita bajar el PDF que él mismo mandó);
//   · el teléfono del chofer (dato personal que el integrador ya tiene);
//   · `huella` y `generacion` (mecánica interna).
// ═══════════════════════════════════════════════════════════════════════════

import type { LiquidacionExterna } from './repo';
import type { ConceptoExterno } from './esquema';

export type CodigoFallo =
  | 'fuera_de_ventana' | 'plantilla_no_aprobada' | 'numero_no_permitido' | 'canal_whatsapp'
  | 'rechazada_por_whatsapp' | 'entrega_interna';

/**
 * Del `ultimo_error` crudo (que puede traer el cuerpo de Meta o un mensaje de
 * nuestra base) a un código estable y una frase que se puede enseñar. El texto
 * crudo NUNCA cruza a la API ni al panel: puede traer nombres de tablas o el
 * cuerpo completo de un error de Meta.
 */
export function motivoDeFallo(ultimoError: string | null): { codigo: CodigoFallo; texto: string } | null {
  if (!ultimoError) return null;
  const e = ultimoError;
  if (/\b(131047|131026|131042)\b|re-?engagement/i.test(e)) {
    return { codigo: 'fuera_de_ventana', texto: 'Pasaron más de 24 h desde el último mensaje del chofer y la plantilla no pudo abrir la conversación.' };
  }
  if (/\b132001\b|\b132000\b|\b132012\b/.test(e)) {
    return { codigo: 'plantilla_no_aprobada', texto: 'La plantilla de liquidación todavía no está aprobada en Meta.' };
  }
  if (/\b131030\b/.test(e)) {
    return { codigo: 'numero_no_permitido', texto: 'El número del chofer no está autorizado en la cuenta de WhatsApp (modo prueba).' };
  }
  if (/\b190\b|\b133016\b/.test(e)) {
    return { codigo: 'canal_whatsapp', texto: 'El canal de WhatsApp tiene un problema de credenciales; Likida ya lo está atendiendo.' };
  }
  if (/^terminal:|HTTP [45]\d\d/.test(e)) {
    return { codigo: 'rechazada_por_whatsapp', texto: 'WhatsApp rechazó el mensaje.' };
  }
  return { codigo: 'entrega_interna', texto: 'No se pudo entregar por un problema interno; se reintenta o se puede reintentar desde el panel.' };
}

export interface LiquidacionExternaApi {
  id: string;
  claveExterna: string;
  sistemaOrigen: string | null;
  operador: { id: string; nombre: string | null };
  viajes: string[];
  /** Cuántos de esos folios existen como viaje en Likida. Menos que
   *  `viajes.length` NO es un error: el viaje puede vivir solo en tu TMS. */
  viajesEnLikida: number;
  periodo: { desde: string; hasta: string };
  conceptos: ConceptoExterno[];
  total: number;
  moneda: string;
  pdfOrigen: 'adjunto' | 'generado';
  /** pendiente | en_cola | enviada | acusada | fallida. */
  estado: string;
  /** sesion | plantilla | null (todavía no se sabe por cuál). */
  via: string | null;
  /** Por qué falló o por qué se está reintentando. `null` = sin problema. */
  fallo: { codigo: CodigoFallo; texto: string } | null;
  enviadaEn: string | null;
  /** Lo que apretó el chofer: recibida | no_coincide. `null` = no ha contestado. */
  respuestaChofer: string | null;
  respuestaEn: string | null;
  creadaEn: string;
}

export function aLiquidacionExternaApi(l: LiquidacionExterna): LiquidacionExternaApi {
  return {
    id: l.id,
    claveExterna: l.claveExterna,
    sistemaOrigen: l.sistemaOrigen,
    operador: { id: l.operadorId, nombre: l.operadorNombre },
    viajes: l.foliosViaje,
    viajesEnLikida: l.viajeIds.length,
    periodo: { desde: l.periodoDesde, hasta: l.periodoHasta },
    conceptos: l.conceptos,
    total: l.total,
    moneda: l.moneda,
    pdfOrigen: l.pdfOrigen,
    estado: l.estado,
    via: l.via,
    fallo: motivoDeFallo(l.ultimoError),
    enviadaEn: l.enviadaEn,
    respuestaChofer: l.acuseTipo,
    respuestaEn: l.acuseEn,
    creadaEn: l.creadaEn,
  };
}

/** Un acuse del chofer, para el sistema del cliente (GET /v1/liquidaciones-externas/acuses). */
export interface AcuseApi {
  /** El id de Likida: es el que se manda a `acuses/confirmar`. */
  id: string;
  claveExterna: string;
  sistemaOrigen: string | null;
  operador: { id: string; nombre: string | null };
  /** recibida | no_coincide. */
  respuestaChofer: 'recibida' | 'no_coincide';
  respuestaEn: string;
  total: number;
  moneda: string;
}

/** `null` si la liquidación no tiene acuse (no debería llegar aquí). */
export function aAcuseApi(l: LiquidacionExterna): AcuseApi | null {
  if (!l.acuseTipo || !l.acuseEn) return null;
  return {
    id: l.id, claveExterna: l.claveExterna, sistemaOrigen: l.sistemaOrigen,
    operador: { id: l.operadorId, nombre: l.operadorNombre },
    respuestaChofer: l.acuseTipo, respuestaEn: l.acuseEn, total: l.total, moneda: l.moneda,
  };
}
