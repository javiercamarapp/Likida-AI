// El primer toque pre-armado del Cerebro — WhatsApp y correo, la MISMA voz.
// Módulo aparte (puro, sin imports de servidor) porque lo comparten
// cerebro.tsx y calles.tsx. Reglas de la casa dentro del texto: sin
// "nuestros clientes" (no hay clientes todavía), sin cifras fiscales (el
// diésel solo se habla en litros y eso no cabe en un primer toque), y el
// mensaje se abre EDITABLE — Javier manda, no el sistema.

import type { ProspectoMapa, TextosProspecto } from '@/lib/admin/prospectos-mapa-client';

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

// ── Los textos largos ya NO viajan en el listado (FE-16) ───────────────────
// `t` es lo que devolvió `getTextosProspectos` para ESTE prospecto, o null si
// todavía no ha llegado. Los dos href caen a la plantilla determinista cuando
// no hay texto del agente — que es lo correcto para el prospecto que nadie ha
// trabajado (`mensajesGeneradosEn === null`) y NO lo es para el que sí: por
// eso `esperandoTextos` existe y la vista deshabilita el botón mientras tanto,
// en vez de abrir WhatsApp con el mensaje equivocado en nombre de Javier.

/** true = este prospecto TIENE mensaje del agente experto y todavía no llega:
 *  el botón no debe abrirse con la plantilla. */
export function esperandoTextos(
  p: Pick<ProspectoMapa, 'mensajesGeneradosEn'>,
  t: TextosProspecto | null | undefined,
): boolean {
  return p.mensajesGeneradosEn !== null && !t;
}

/** El href mailto completo. Manda el mensaje del AGENTE EXPERTO (0129) si ya
 *  existe; la plantilla determinista es solo el respaldo del no trabajado. */
export function hrefCorreo(p: ProspectoMapa, t?: TextosProspecto | null): string | null {
  if (!p.correo) return null;
  const asunto = t?.correoAsuntoIa ?? correoProspecto(p).asunto;
  const cuerpo = t?.correoCuerpoIa ?? correoProspecto(p).cuerpo;
  return `mailto:${p.correo}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
}

/**
 * El href de WhatsApp (lada MX) — misma regla: el mensaje IA manda.
 *
 * ADM-15 (auditoría 24, MEDIO): `p.telefono.replace(/^52/, '')` asumía un
 * teléfono ya limpio de dígitos. Un teléfono con el formato con el que DENUE
 * los entrega (`+52 55 1234 5678`, con espacios y el `+`) ni siquiera
 * empataba el `/^52/` — el string se quedaba intacto y el resultado era
 * `wa.me/52+52 55 1234 5678`, un link roto. Se limpia a solo dígitos
 * PRIMERO, y solo entonces se decide si ya trae el 52 de país (no
 * duplicarlo) o hay que anteponerlo.
 */
export function hrefWa(p: ProspectoMapa, t?: TextosProspecto | null): string | null {
  if (!p.telefono) return null;
  const texto = t?.mensajeWaIa ?? mensajeWa(p);
  const digitos = p.telefono.replace(/\D/g, '');
  if (!digitos) return null;
  const numero = digitos.startsWith('52') ? digitos : `52${digitos}`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}
