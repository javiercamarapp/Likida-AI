// ═══════════════════════════════════════════════════════════════════════════
// TELÉFONOS DEL TENANT DEMO — la marca que el envío real rechaza.
//
// El seed del demo (scripts/demo/innovativos) pone en TODOS sus teléfonos (clientes, operadores, contactos de Vigía,
// jefes de tráfico) el prefijo `28999`. El código de país 289 no está asignado a ningún país (ITU-T E.164) y el número
// completo no es una numeración mexicana (52…): ningún teléfono real de una persona empieza así.
//
// Antes los teléfonos eran 52155595…/52155596…/52155597…, que SÍ tienen forma válida de móvil de CDMX (México no
// reserva un rango para ficción) y podían ser de alguien. Esa marca no se podía distinguir de un número real, y con
// el Vigía y el Conductor encendidos y credenciales de Meta cargadas, el sistema les habría escrito.
//
// Quien llama a la Graph API (client.ts) y el cron del outbox rechazan estos destinatarios ANTES de la llamada.
// No es un rechazo de Meta ni se reintenta: es una negativa local y definitiva.
// ═══════════════════════════════════════════════════════════════════════════

/** Prefijo (solo dígitos) de todo teléfono sintético del tenant demo. */
export const PREFIJO_TELEFONO_DEMO = '28999';

/** ¿El teléfono lleva la marca del demo? Acepta cualquier forma de escribirlo (+, espacios, guiones, paréntesis). */
export function esTelefonoDemo(telefono: unknown): boolean {
  if (typeof telefono !== 'string') return false;
  return telefono.replace(/\D/g, '').startsWith(PREFIJO_TELEFONO_DEMO);
}

export const ERROR_TELEFONO_DEMO = 'destinatario de demo (teléfono con la marca 28999…): el tenant demo no envía mensajes reales';

/** Resultado de un envío rechazado por la marca. 422: no es reintentable (ni 429 ni 5xx) y no trae código de Meta. */
export const RECHAZO_TELEFONO_DEMO = { ok: false as const, error: ERROR_TELEFONO_DEMO, status: 422 };
