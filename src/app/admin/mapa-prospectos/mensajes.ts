// El primer toque pre-armado del Cerebro — WhatsApp y correo, la MISMA voz.
// Módulo aparte (puro, sin imports de servidor) porque lo comparten
// cerebro.tsx y calles.tsx. Reglas de la casa dentro del texto: sin
// "nuestros clientes" (no hay clientes todavía), sin cifras fiscales (el
// diésel solo se habla en litros y eso no cabe en un primer toque), y el
// mensaje se abre EDITABLE — Javier manda, no el sistema.

import type { ProspectoMapa } from '@/lib/admin/prospectos-mapa';

export function mensajeWa(p: ProspectoMapa): string {
  const gancho = p.vacante
    ? `vi que buscan "${p.vacante}" — ese trabajo es exactamente el que automatizamos`
    : 'la liquidación de viajes de los operadores se sigue haciendo a mano en casi todas las flotas';
  return `Hola, soy Javier, de Likida. En ${p.empresa}, ${gancho}: el operador manda sus comprobantes por WhatsApp y la liquidación sale cuadrada, con lo fiscal separado. Estamos eligiendo a las primeras flotas. ¿Le interesan 15 minutos?`;
}

export function correoProspecto(p: ProspectoMapa): { asunto: string; cuerpo: string } {
  const asunto = p.vacante
    ? `Sobre su vacante de ${p.vacante}`
    : `La liquidación de viajes de ${p.empresa}, sin captura`;
  const apertura = p.vacante
    ? `Vi que en ${p.empresa} buscan "${p.vacante}". Ese trabajo — recibir los tickets del operador, cotejarlos contra el anticipo y cerrar la liquidación — es exactamente lo que automatizamos.`
    : `Le escribo porque en casi todas las flotas la liquidación de viajes se sigue capturando a mano, y eso es exactamente lo que automatizamos.`;
  const cuerpo = [
    'Hola,',
    '',
    apertura,
    '',
    'El operador manda sus comprobantes por WhatsApp y la liquidación sale cuadrada, con lo fiscal separado y su PDF. El número lo calcula un motor, no una IA: nunca inventa un monto.',
    '',
    'Estamos eligiendo a las primeras flotas de México. ¿Le interesan 15 minutos esta semana?',
    '',
    'Javier Cámara',
    'Likida.ai',
  ].join('\r\n');
  return { asunto, cuerpo };
}

/** El href mailto completo. Manda el mensaje del AGENTE EXPERTO (0129) si ya
 *  existe; la plantilla determinista es solo el respaldo del no trabajado. */
export function hrefCorreo(p: ProspectoMapa): string | null {
  if (!p.correo) return null;
  const asunto = p.correoAsuntoIa ?? correoProspecto(p).asunto;
  const cuerpo = p.correoCuerpoIa ?? correoProspecto(p).cuerpo;
  return `mailto:${p.correo}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
}

/** El href de WhatsApp (lada MX) — misma regla: el mensaje IA manda. */
export function hrefWa(p: ProspectoMapa): string | null {
  if (!p.telefono) return null;
  const texto = p.mensajeWaIa ?? mensajeWa(p);
  return `https://wa.me/52${p.telefono.replace(/^52/, '')}?text=${encodeURIComponent(texto)}`;
}
