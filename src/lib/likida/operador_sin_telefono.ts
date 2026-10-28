// ═══════════════════════════════════════════════════════════════════════════
// OPERADOR SIN WHATSAPP (A1 por correo, Ola 1 · migración 0932).
//
// El Agente 1 entrega el desglose por CORREO y el cliente descartó el campo de WhatsApp para él, pero `operador.telefono` es NOT
// NULL, único y con forma de teléfono. La migración 0932 admite UN marcador `sin-tel:<20 letras>`: sin un solo dígito (no es
// marcable: normaliza a vacío), sin colisión entre operadores y fuera de los índices únicos de teléfono.
//
// Este módulo concentra lo PURO para que el alta unitaria, la carga masiva y `POST /v1/operadores` no se contradigan:
//   · el marcador (generar, reconocer, ocultarlo en pantalla);
//   · la forma del correo (la misma regla que la CHECK de la 0785);
//   · (la compuerta «¿esta flota puede dar de alta a alguien sin teléfono?» vive aparte, en `operador_sin_telefono_canal.ts`: este módulo
//     es PURO a propósito, porque `administracion.ts` y los scripts de Node lo importan y no deben arrastrar la sesión ni la base).
// ═══════════════════════════════════════════════════════════════════════════

import { randomInt } from 'node:crypto';

const PREFIJO = 'sin-tel:';
const LARGO = 20;
const RE_MARCADOR = /^sin-tel:[a-z]{20}$/;
const FORMA_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_CORREO = 254;

/** Un marcador nuevo: 20 letras minúsculas al azar (26^20 combinaciones). Nunca contiene dígitos. */
export function nuevoMarcadorSinTelefono(): string {
  let s = PREFIJO;
  for (let i = 0; i < LARGO; i++) s += String.fromCharCode(97 + randomInt(26));
  return s;
}

/** ¿Este valor de `operador.telefono` es el marcador de «sin WhatsApp»? */
export function esMarcadorSinTelefono(telefono: unknown): boolean {
  return typeof telefono === 'string' && RE_MARCADOR.test(telefono);
}

/** Lo que se muestra en pantalla: el marcador es un detalle interno, nunca un «teléfono». */
export function telefonoVisible(telefono: string | null | undefined): string | null {
  if (telefono == null || telefono === '' || esMarcadorSinTelefono(telefono)) return null;
  return telefono;
}

/** Correo normalizado (minúsculas, sin espacios) o `null` si viene vacío; `undefined` si no tiene forma de correo. */
export function correoDeOperador(crudo: string | null | undefined): string | null | undefined {
  const t = (crudo ?? '').trim().toLowerCase();
  if (t === '') return null;
  return t.length <= MAX_CORREO && FORMA_CORREO.test(t) ? t : undefined;
}

export const MENSAJE_SIN_TELEFONO_NO_PERMITIDO =
  'El teléfono es obligatorio: sin él el chofer no puede hablar con el bot de WhatsApp. Solo una flota cuyo desglose de liquidación sale por correo puede dar de alta a un operador con número de empleado y correo.';
