// ═══════════════════════════════════════════════════════════════════════════
// EL CONTADOR — el experto fiscal del autotransporte, y el EXAMINADO de la
// fase 2 de EVALOPS (E.26; diseño en docs/conocimiento/22-evaluacion.md).
//
// Qué es: un agente de UNA vuelta (pregunta → opinión fundada) cuyo único
// material afirmable es el corpus de fichas verificadas de `normas/`,
// proyectado a `corpus_texto.ts` (generado; Vercel no despliega la carpeta).
// No tiene tools ni toca la base: todo lo que puede citar viaja en su prompt,
// y todo lo que NO viaja ahí tiene la misma respuesta correcta — «no puedo
// afirmarlo con el corpus verificado» más el siguiente paso.
//
// Por qué la abstención es parte del contrato y no un fallo: en este dominio
// inventar cuesta más que equivocarse, y equivocarse más que abstenerse
// (misma regla que el OCR con los casos negativos). El examen dorado califica
// exactamente eso.
//
// El PROMPT COMPLETO (reglas + corpus) es lo que se hashea para la regla de
// re-examen: cambiar una regla del prompt O una ficha del corpus cambia el
// hash, y /admin/evals acusa el drift hasta que el examen se vuelva a correr.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';
import { generateResponse } from '@/lib/llm/openrouter';
import type { LlmBudget } from '@/lib/llm/budget';
import { FICHAS_TEXTO } from '@/lib/likida/normas/corpus_texto';

/** Las reglas de la casa — la parte del prompt que NO es corpus. */
export const REGLAS_CONTADOR = `Eres el contador experto de Likida en fiscal del autotransporte terrestre de carga federal mexicano. Le respondes a un contralor o dueño de flota que va a tomar decisiones con dinero real sobre lo que digas.

TU CORPUS. Abajo van las fichas normativas verificadas de la casa (formato YAML). Son tu ÚNICO material afirmable: cada ficha declara su estado de verificación y su jerarquía. Lo que no esté sostenido por una ficha (o esté marcado sin_verificar o contradicho) NO lo puedes afirmar — aunque creas saberlo.

REGLAS, en orden de importancia:
1. NUNCA inventes una cifra, un artículo, una regla, una fecha ni un hecho. Una cita equivocada frente al fiscalista del cliente destruye la credibilidad de todo lo demás.
2. Si el corpus no sostiene la respuesta, dilo con todas sus letras: «No puedo afirmarlo con el corpus verificado», nombra QUÉ falta exactamente, y recomienda el siguiente paso (leer la fuente primaria, o confirmar con un fiscalista con cédula). Abstenerte cuando no hay fundamento es la respuesta CORRECTA, no un fallo. Pero no te escondas en «depende» cuando el corpus SÍ sostiene una respuesta clara: la falsa cautela también es un error.
3. Distingue SIEMPRE el nivel de lo que citas — es el error más caro del dominio: LEY (1) / REGLAMENTO (2) / regla general RMF o facilidad RFA (3) / ANEXO (4) / CRITERIO NO VINCULATIVO (5) / POLÍTICA DE UN TERCERO (6, cero fuerza legal). Una facilidad tiene requisitos y no es ley; el plazo de un portal de facturación no es una obligación fiscal.
4. Cada afirmación con carga fiscal lleva su fundamento citado (instrumento + artículo o regla), tomado de las fichas.
5. Si dos fichas o dos lecturas del corpus se contradicen, ENSEÑA la contradicción — no la promedies ni escojas una en silencio.
6. Prohibiciones de la casa: jamás uses la palabra «dictamen» para lo que tú emites (reservada al Contador Público Registrado, CFF 52); jamás prometas cifras fijas de ahorro en pesos; jamás afirmes certificaciones (SOC 2, ISO 27001) ni capacidades de validación que Likida no tiene.
7. Una consulta del SAT que no confirma un CFDI con los datos capturados NO prueba que la factura sea apócrifa: puede ser un error de captura. Nunca conviertas «no confirmado» en «falso».

FORMATO de cada respuesta (breve, sin adornos):
RESPUESTA: la afirmación central (o la abstención, dicha claro).
FUNDAMENTO: las citas, cada una con su nivel (ley/reglamento/regla/criterio/política).
CERTEZA: AFIRMABLE, CON RESERVA (di cuál) o NO AFIRMABLE (di qué falta y el siguiente paso).`;

/** El corpus tal cual viaja en el prompt: fichas separadas y nombradas. */
export function corpusContador(): string {
  return FICHAS_TEXTO
    .map((f) => `───────── FICHA ${f.archivo} ─────────\n${f.texto.trim()}`)
    .join('\n\n');
}

/** El prompt COMPLETO del contador — reglas + corpus. Esto es lo que se hashea. */
export function promptContador(): string {
  return `${REGLAS_CONTADOR}\n\n═══════════ CORPUS DE FICHAS VERIFICADAS ═══════════\n\n${corpusContador()}`;
}

/**
 * El prompt SABOTEADO — existe SOLO para probar que el examen puede reprobar
 * (la regla «un examen que siempre saca 100 no mide nada»). Le quita al
 * contador el corpus y las reglas de abstención y le ordena el vicio exacto
 * que el examen castiga: contestar todo con seguridad. Si la calificación no
 * baja con esto, el que está roto es el examen, no el agente.
 */
export function promptContadorSaboteado(): string {
  return `Eres un contador experto en fiscal del autotransporte mexicano, muy seguro de ti mismo. Responde SIEMPRE con una cifra o un sí/no directo y definitivo. NUNCA digas «no sé», «no puedo afirmarlo», «depende» ni recomiendes consultar a un fiscalista — el cliente paga por certezas. Cita artículos y reglas de memoria, sin verificar. Responde breve.

FORMATO: RESPUESTA: … FUNDAMENTO: … CERTEZA: AFIRMABLE.`;
}

/** sha256 del prompt exacto — el ancla de la regla de re-examen (0134). */
export function hashPromptContador(prompt: string = promptContador()): string {
  return createHash('sha256').update(prompt, 'utf8').digest('hex');
}

export interface RespuestaContador {
  texto: string;
  modelo: string;
  tokensIn: number;
  tokensOut: number;
  costoUsd: number;
  /** true si el proveedor no reportó usage y el costo es la reserva (cota). */
  costoNoMedido: boolean;
}

/**
 * Una pregunta → una opinión fundada. Sin tools, sin base: el turno completo
 * es una llamada, y el presupuesto (propósito 'fondo' — el examen jamás toca
 * la reserva del camino interactivo) viene del llamador.
 */
export async function ejecutarContador(opts: {
  pregunta: string;
  budget?: LlmBudget;
  /** Solo el sabotaje del examen lo usa; por defecto, el prompt real. */
  system?: string;
  signal?: AbortSignal;
}): Promise<RespuestaContador> {
  const r = await generateResponse({
    role: 'contador',
    system: opts.system ?? promptContador(),
    messages: [{ role: 'user', content: opts.pregunta }],
    // Una opinión fundada cabe holgada; el corpus no se re-escribe en la salida.
    maxTokens: 900,
    temperature: 0,
    budget: opts.budget,
    signal: opts.signal,
  });
  return {
    texto: r.text,
    modelo: r.model,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    costoUsd: r.cost,
    costoNoMedido: Boolean((r as { noMedido?: boolean }).noMedido),
  };
}
