// ═══════════════════════════════════════════════════════════════════════════
// RESPUESTAS RÁPIDAS APROBADAS (0647) — la parte PURA.
//
// El reporte del histórico (`historial/analisis.ts`) calcula qué preguntan más los clientes y qué suele contestar el equipo.
// El gerente aprueba (o corrige) esa respuesta y queda guardada con la pregunta que la originó. Cuando un cliente escribe algo
// que el Vigía NO entendió («otro») y se parece a esa pregunta, el borrador sale con el texto aprobado en vez de «no logré
// entender».
//
// Reglas que no se negocian:
//   · SOLO para lo que el Vigía no entendió. Una pregunta de dato del viaje (ubicación, hora, documentos, factura) se contesta con
//     el dato real de ESE viaje: una respuesta guardada hace semanas ahí sería una cifra vieja.
//   · El parecido se mide con las mismas fichas y el mismo umbral con los que se agrupan las FAQs (Jaccard ≥ 0.5, al menos dos
//     palabras con contenido en el mensaje del cliente): si no se parece claramente, no se usa.
//   · Nunca se manda sola: la política manda lo «no entendido» a aprobación, y el gerente ve el texto antes de que salga.
// ═══════════════════════════════════════════════════════════════════════════
import { fichas, jaccard, TEMAS, type Tema } from './historial/analisis';

/** Los temas para los que se aprueba una respuesta: una queja o un «quiero hablar con alguien» siempre los atiende una persona. */
export const TEMAS_RESPUESTA_RAPIDA: readonly Tema[] = TEMAS.filter((t) => t !== 'queja' && t !== 'pide_humano');

export const MAX_TEXTO_RESPUESTA_RAPIDA = 700;
export const MAX_PREGUNTA_RESPUESTA_RAPIDA = 240;
export const UMBRAL_PARECIDO = 0.5;

export interface RespuestaRapida {
  id: string;
  tema: Tema;
  /** La pregunta típica con la que se aprobó (lo que se compara contra el mensaje del cliente). */
  pregunta: string;
  texto: string;
  usos: number;
}

export interface RespuestaRapidaElegida {
  id: string;
  tema: Tema;
  texto: string;
  similitud: number;
}

/** La respuesta aprobada que más se parece al mensaje del cliente, o `null` si ninguna se parece lo bastante. PURA. */
export function elegirRespuestaRapida(mensajeCliente: string, candidatas: readonly RespuestaRapida[]): RespuestaRapidaElegida | null {
  const f = new Set(fichas(mensajeCliente));
  if (f.size < 2) return null;
  let mejor: { r: RespuestaRapida; s: number } | null = null;
  for (const r of candidatas) {
    const s = jaccard(f, new Set(fichas(r.pregunta)));
    if (s < UMBRAL_PARECIDO) continue;
    // Empate: la que más se ha usado (ya probada), luego por id: estable.
    if (!mejor || s > mejor.s || (s === mejor.s && (r.usos > mejor.r.usos || (r.usos === mejor.r.usos && r.id < mejor.r.id)))) mejor = { r, s };
  }
  return mejor ? { id: mejor.r.id, tema: mejor.r.tema, texto: mejor.r.texto, similitud: Math.round(mejor.s * 100) / 100 } : null;
}

export type ValidacionRespuestaRapida =
  | { ok: true; valor: { tema: Tema; pregunta: string; texto: string } }
  | { ok: false; error: string };

const colapsar = (t: string): string => t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[ \t]+/g, ' ').trim();

/** Lo que el gerente escribió, ya limpio y dentro de los límites de la tabla. Mismo contrato que los CHECK de la 0647. */
export function validarRespuestaRapida(e: { tema: unknown; pregunta: unknown; texto: unknown }): ValidacionRespuestaRapida {
  const tema = String(e.tema ?? '');
  if (!(TEMAS_RESPUESTA_RAPIDA as readonly string[]).includes(tema)) return { ok: false, error: 'Elige un tema válido (las quejas y las peticiones de hablar con alguien las atiende una persona).' };
  const pregunta = colapsar(String(e.pregunta ?? '')).replace(/\s*\n\s*/g, ' ');
  if (pregunta.length < 3) return { ok: false, error: 'Escribe la pregunta del cliente a la que responde (al menos 3 letras).' };
  if (pregunta.length > MAX_PREGUNTA_RESPUESTA_RAPIDA) return { ok: false, error: `La pregunta pasa de ${MAX_PREGUNTA_RESPUESTA_RAPIDA} letras.` };
  if (fichas(pregunta).length < 2) return { ok: false, error: 'La pregunta necesita al menos dos palabras con contenido para poder reconocerla después.' };
  const texto = colapsar(String(e.texto ?? ''));
  if (!texto) return { ok: false, error: 'Escribe la respuesta.' };
  if (texto.length > MAX_TEXTO_RESPUESTA_RAPIDA) return { ok: false, error: `La respuesta pasa de ${MAX_TEXTO_RESPUESTA_RAPIDA} letras (límite de un mensaje de WhatsApp del Vigía).` };
  return { ok: true, valor: { tema: tema as Tema, pregunta, texto } };
}
