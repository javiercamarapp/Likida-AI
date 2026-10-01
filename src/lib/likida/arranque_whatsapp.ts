// ═══════════════════════════════════════════════════════════════════════════
// EL NÚMERO DE WHATSAPP DE LIKIDA Y EL ARRANQUE DEL CHOFER (W2 «producto»).
//
// La auditoría de producto lo dijo así: «un tenant nuevo no puede completar el
// ciclo central (comprobante por WhatsApp) sin pedir el número por fuera del
// producto». Ninguna pantalla enseñaba a QUÉ número escribirle al bot. Este
// módulo resuelve el número (PURO, sin red) y arma el enlace `wa.me` con texto
// prellenado que la guía convierte en botón y en QR.
//
// DE DÓNDE SALE. `LIKIDA_WHATSAPP_NUMERO` —el número comercial verificado, con
// código de país, solo dígitos o con formato—. NO se deriva de
// `WHATSAPP_PHONE_NUMBER_ID`: ese es un id interno de Meta, no un teléfono. Hoy
// es UN número para todas las flotas (el de la WABA); cuando haya un número por
// flota, este es el punto donde se lee.
//
// HONESTIDAD. Sin variable no se inventa un número: el estado es
// `sin_configurar` y la pantalla lo dice. Un número marcado como de prueba
// (`LIKIDA_WHATSAPP_NUMERO_PRUEBA`) se muestra igual, con su advertencia: un
// chofer que escribe a un número de prueba en producción no recibe respuesta, y
// es mejor que el dueño lo sepa que descubrirlo con 250 choferes.
// ═══════════════════════════════════════════════════════════════════════════

import { valorEntornoReal } from '@/lib/env';

export type NumeroWhatsApp =
  | { estado: 'sin_configurar' }
  | { estado: 'invalido'; motivo: string }
  | {
    estado: 'configurado';
    /** Código de país + número, solo dígitos (la forma que pide `wa.me`). */
    digitos: string;
    /** Para leerlo: «+52 55 1234 5678». */
    visible: string;
    /** Marcado como número de PRUEBA: no atiende a choferes reales. */
    esPrueba: boolean;
  };

/** `wa.me` pide el número en formato internacional SIN «+», ceros ni espacios.
 *  Para México, `521`+10 se normaliza a `52`+10 (misma regla que
 *  `destinatarioWhatsApp`, meta/client.ts). */
export function normalizarDigitos(crudo: string): string {
  const d = crudo.replace(/[^\d]/g, '');
  const mx = /^521(\d{10})$/.exec(d);
  return mx ? `52${mx[1]}` : d;
}

/** «5255 1234 5678» → «+52 55 1234 5678»; fuera de México, solo «+<dígitos>». */
export function formatoVisible(digitos: string): string {
  const mx = /^52(\d{2})(\d{4})(\d{4})$/.exec(digitos);
  return mx ? `+52 ${mx[1]} ${mx[2]} ${mx[3]}` : `+${digitos}`;
}

const VERDAD = /^(1|true|si|sí|yes)$/i;

export function numeroWhatsAppDeLikida(
  env: Record<string, string | undefined> = process.env,
): NumeroWhatsApp {
  const crudo = env.LIKIDA_WHATSAPP_NUMERO;
  if (!valorEntornoReal(crudo)) return { estado: 'sin_configurar' };
  if (/[a-zA-Z]/.test(crudo)) return { estado: 'invalido', motivo: 'El número configurado trae letras: debe ser solo el teléfono con código de país.' };
  const digitos = normalizarDigitos(crudo);
  // E.164: de 8 a 15 dígitos. México: 52 + 10.
  if (digitos.length < 10 || digitos.length > 15) {
    return { estado: 'invalido', motivo: 'El número configurado no parece un teléfono con código de país (por ejemplo 52 55 1234 5678).' };
  }
  if (digitos.startsWith('52') && digitos.length !== 12) {
    return { estado: 'invalido', motivo: 'Un número de México lleva 52 y 10 dígitos (por ejemplo 52 55 1234 5678).' };
  }
  return {
    estado: 'configurado', digitos, visible: formatoVisible(digitos),
    esPrueba: VERDAD.test((env.LIKIDA_WHATSAPP_NUMERO_PRUEBA ?? '').trim()),
  };
}

/** El mensaje que el chofer manda al tocar el enlace o escanear el QR. Lleva el
 *  nombre de la flota para que la oficina sepa de quién es el primer mensaje. */
export function textoDeArranque(nombreFlota: string): string {
  const flota = nombreFlota.replace(/\s+/g, ' ').trim().slice(0, 60) || 'mi flota';
  return `Hola, soy chofer de ${flota}. Quiero empezar a mandar mis comprobantes por Likida.`;
}

/** El enlace `wa.me` con el texto prellenado, codificado. */
export function enlaceWaMe(digitos: string, texto: string): string {
  return `https://wa.me/${digitos}?text=${encodeURIComponent(texto)}`;
}
