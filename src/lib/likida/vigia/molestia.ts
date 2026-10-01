// ═══════════════════════════════════════════════════════════════════════════
// DETECTOR DE MOLESTIA — lenguaje, insistencia y tiempo sin respuesta.
//
// Determinista a propósito: un cliente molesto tiene que disparar el aviso al
// gerente en el MISMO instante, sin depender de un modelo que puede caerse, y la
// regla tiene que poderse explicar («escribió 4 veces sin respuesta y lleva 50
// minutos») cuando el gerente pregunta por qué le avisaron.
//
// Cada señal suma puntos; el nivel sale de la suma:
//   0  sin señales
//   1  leve    (1 punto)         — se anota; no avisa
//   2  molesto (2–3 puntos)      — avisa al gerente responsable (nivel 1)
//   3  crítico (4 o más puntos)  — avisa también al dueño (nivel 2)
//
// Las palabras se buscan CON frontera de palabra, sobre texto normalizado: la
// lista de sentimiento que sirvió de idea (atiende.ai) comparaba subcadenas, y
// «ya» (urgente) coincidía con casi cualquier mensaje.
// ═══════════════════════════════════════════════════════════════════════════
import { normalizar } from './entrada';
import type { Intencion } from './tipos';

const PALABRAS_FUERTES: readonly RegExp[] = [
  /\b(pesimo|pesima|terrible|inaceptable|vergonzoso|vergonzosa|asco|basura|porqueria|estafa|fraude|ladrones?|mentirosos?|incompetentes?|inutiles)\b/,
  /\b(harto|harta|furioso|furiosa|indignado|indignada|enojado|enojada|muy molesto|muy molesta)\b/,
  /\b(exijo|exigimos|demando|demandar|profeco|denuncia|abogado|cancelo|cancelar el contrato|cambiar de proveedor)\b/,
];
const PALABRAS_LEVES: readonly RegExp[] = [
  /\b(molesto|molesta|queja|mal servicio|decepcionado|decepcionada|no es posible|no puede ser|otra vez|de nuevo)\b/,
  /\b(urgente|urgentisimo|ya mismo|de inmediato|inmediatamente|cuanto antes|lo antes posible)\b/,
  /\b(nadie (me )?(contesta|responde|atiende)|no me (contestan|responden|atienden)|sin respuesta|cuantas veces)\b/,
];

export interface EntradaMolestia {
  texto: string;
  intencion: Intencion;
  /** Mensajes del cliente desde la última respuesta (el actual incluido). */
  entradasSinRespuesta: number;
  /** Minutos que lleva esperando (0 si nadie espera). */
  minutosEsperando: number;
  slaRespuestaMin: number;
}

export interface Molestia {
  nivel: 0 | 1 | 2 | 3;
  puntos: number;
  /** Para la bitácora y el aviso: categorías, NUNCA el texto del cliente. */
  motivos: string[];
}

export function evaluarMolestia(e: EntradaMolestia): Molestia {
  const n = normalizar(e.texto);
  const motivos: string[] = [];
  let puntos = 0;

  if (PALABRAS_FUERTES.some((r) => r.test(n))) { puntos += 2; motivos.push('lenguaje_fuerte'); }
  else if (PALABRAS_LEVES.some((r) => r.test(n))) { puntos += 1; motivos.push('lenguaje_de_molestia'); }

  // Mayúsculas sostenidas y signos repetidos (sobre el texto original: normalizar los borra).
  const letras = e.texto.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '');
  const mayus = e.texto.replace(/[^A-ZÁÉÍÓÚÑ]/g, '');
  if (letras.length >= 12 && mayus.length / letras.length >= 0.7) { puntos += 1; motivos.push('mayusculas'); }
  if (/[!¡]{2,}|\?{3,}|[?!]{3,}/.test(e.texto)) { puntos += 1; motivos.push('signos_repetidos'); }

  if (e.intencion === 'queja') { puntos += 2; motivos.push('queja'); }
  else if (e.intencion === 'pide_humano') { puntos += 1; motivos.push('pide_humano'); }

  // Insistencia: el cliente repite porque nadie le contesta.
  if (e.entradasSinRespuesta >= 5) { puntos += 2; motivos.push('insistencia_alta'); }
  else if (e.entradasSinRespuesta >= 3) { puntos += 1; motivos.push('insistencia'); }

  // Tiempo: pasado el SLA, el silencio ya es la molestia.
  const sla = Math.max(1, e.slaRespuestaMin);
  if (e.minutosEsperando >= sla * 2) { puntos += 2; motivos.push('espera_doble_sla'); }
  else if (e.minutosEsperando >= sla) { puntos += 1; motivos.push('espera_sobre_sla'); }

  const nivel = puntos >= 4 ? 3 : puntos >= 2 ? 2 : puntos >= 1 ? 1 : 0;
  return { nivel, puntos, motivos };
}
