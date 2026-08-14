import { createHmac, timingSafeEqual } from 'node:crypto';

// ═══════════════════════════════════════════════════════════════════════════
// LA FIRMA DEL CORREO ENTRANTE — lo único que separa una factura de proveedor
// de una que alguien inventó.
//
// El webhook de correo entrante es un POST sin autenticar: cualquiera que
// adivine la URL puede mandarnos un evento. Y lo que ese evento dispara no es
// inocuo — mete una factura a la bandeja del Agente de Proveedores, con su
// RFC, su monto y su UUID. Sin verificar, Likida sería un buzón por el que
// cualquiera empuja gasto falso a la contabilidad de un cliente.
//
// Resend firma con Svix. Se implementa aquí en vez de traer el SDK, por el
// mismo criterio que el envío: son treinta líneas de `crypto` contra una
// dependencia más en el bundle.
//
// ── LAS TRES COSAS QUE HAY QUE HACER BIEN ────────────────────────────────
//
//  1. **Firmar el cuerpo CRUDO**, no el JSON reparseado. `JSON.parse` seguido
//     de `JSON.stringify` reordena llaves y normaliza espacios: el resultado
//     ya no es el que se firmó y toda verificación fallaría — o peor, alguien
//     ajustaría el código hasta que "funcione" quitando la verificación.
//  2. **Rechazar lo viejo.** Sin tolerancia de tiempo, cualquiera que capture
//     un webhook legítimo puede reenviarlo mil veces y duplicar la factura.
//  3. **Comparar en tiempo constante.** Un `===` corta en el primer byte
//     distinto y filtra la firma a quien pueda medir.
// ═══════════════════════════════════════════════════════════════════════════

/** Cuánto se tolera de desfase de reloj, en cada dirección.
 *
 *  Cinco minutos es lo que recomienda Svix: suficiente para un reloj mal
 *  sincronizado y para un reintento razonable del proveedor, corto para que un
 *  webhook capturado no sirva de aquí a una hora. */
export const TOLERANCIA_MS = 5 * 60_000;

export interface CabecerasSvix {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export type ResultadoFirma =
  | { ok: true }
  | { ok: false; motivo: 'sin_secreto' | 'faltan_cabeceras' | 'fuera_de_tiempo' | 'firma_invalida' };

/**
 * El secreto viene como `whsec_<base64>`. Lo que se usa para el HMAC son los
 * BYTES de ese base64, no la cadena: firmar con el texto produce una firma que
 * nunca cuadra y manda a buscar el error donde no está.
 */
function llaveDelSecreto(secreto: string): Buffer | null {
  const limpio = secreto.startsWith('whsec_') ? secreto.slice(6) : secreto;
  if (!limpio) return null;
  try {
    return Buffer.from(limpio, 'base64');
  } catch {
    return null;
  }
}

function igualEnTiempoConstante(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Verifica la firma de un webhook de Resend.
 *
 * `cuerpo` DEBE ser el texto crudo de la petición (`await req.text()`), nunca
 * un objeto reserializado.
 *
 * @param ahoraMs Se inyecta para poder probar los bordes de la ventana sin
 *   depender del reloj de la máquina que corre las pruebas.
 */
export function verificarFirma(
  cuerpo: string,
  cab: CabecerasSvix,
  secreto: string | undefined,
  ahoraMs: number,
): ResultadoFirma {
  // Sin secreto NO se acepta el webhook. Es el fallo cerrado que importa: la
  // alternativa —"si no hay secreto, confía"— convierte una variable de
  // entorno olvidada en un buzón abierto.
  if (!secreto) return { ok: false, motivo: 'sin_secreto' };
  const llave = llaveDelSecreto(secreto);
  if (!llave || llave.length === 0) return { ok: false, motivo: 'sin_secreto' };

  if (!cab.id || !cab.timestamp || !cab.signature) {
    return { ok: false, motivo: 'faltan_cabeceras' };
  }

  const ts = Number(cab.timestamp);
  if (!Number.isFinite(ts)) return { ok: false, motivo: 'fuera_de_tiempo' };
  // El timestamp de Svix va en SEGUNDOS.
  const desfase = Math.abs(ahoraMs - ts * 1000);
  if (desfase > TOLERANCIA_MS) return { ok: false, motivo: 'fuera_de_tiempo' };

  const esperada = createHmac('sha256', llave)
    .update(`${cab.id}.${cab.timestamp}.${cuerpo}`, 'utf8')
    .digest('base64');

  // La cabecera puede traer VARIAS firmas separadas por espacio —así es como
  // Svix rota secretos sin cortar el servicio—, cada una como `v1,<firma>`.
  // Se recorren TODAS aunque una cuadre: salir temprano volvería medible
  // cuántas venían.
  let valida = false;
  for (const parte of cab.signature.split(' ')) {
    const [version, firma] = parte.split(',');
    if (version !== 'v1' || !firma) continue;
    if (igualEnTiempoConstante(firma, esperada)) valida = true;
  }

  return valida ? { ok: true } : { ok: false, motivo: 'firma_invalida' };
}

/** El texto que se le devuelve a Resend. Nunca dice QUÉ falló con detalle: un
 *  atacante que distinga "firma inválida" de "fuera de tiempo" aprende a
 *  ajustar su intento. El motivo real va al log. */
export function mensajeDeRechazo(): string {
  return 'Firma no válida.';
}
