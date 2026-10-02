import { createHmac, timingSafeEqual } from 'node:crypto';

// ═══════════════════════════════════════════════════════════════════════════
// LA FIRMA DEL PUSH DE POSICIONES.
//
//   X-Likida-Timestamp: <segundos UNIX>
//   X-Likida-Signature: v1=<hex(HMAC-SHA256(secreto, `${timestamp}.${cuerpo}`))>
//
// El timestamp va DENTRO de lo firmado: quien capture una petición no la puede
// repetir fuera de la ventana de tolerancia, ni cambiar su hora. Dentro de la
// ventana, repetirla es inocuo: las posiciones son idempotentes
// (`uq_posicion_lectura`). El cuerpo se firma TAL CUAL llegó (bytes → texto), no
// re-serializado.
// ═══════════════════════════════════════════════════════════════════════════

export const TOLERANCIA_RELOJ_S = 300;

export function firmarPush(secreto: string, timestampS: number, cuerpo: string): string {
  return `v1=${createHmac('sha256', secreto).update(`${timestampS}.${cuerpo}`, 'utf8').digest('hex')}`;
}

/** Comparación en tiempo constante; longitudes distintas = no coincide (sin lanzar). */
export function firmaCoincide(esperada: string, recibida: string): boolean {
  const enc = new TextEncoder();
  const a = enc.encode(esperada);
  const b = enc.encode(recibida.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

/** El timestamp debe ser un entero de segundos; nada de decimales, signos ni notación científica. */
export function leerTimestamp(valor: string | null): number | null {
  if (valor === null || !/^\d{9,11}$/.test(valor.trim())) return null;
  return Number(valor.trim());
}
