// ═══════════════════════════════════════════════════════════════════════════
// LOS JUECES DEL EXAMEN DEL CONTADOR (E.26) — el panel de 22-evaluacion.md §3
// aterrizado a lo que la casa puede sostener hoy:
//
//  · J1 — verificador de citas DETERMINISTA: extrae cada cita normativa de la
//    respuesta con regex y la coteja contra el LIBRO MAYOR (todo lo citable
//    que vive en el corpus de fichas + los fundamentos del banco dorado).
//    Una cita fuera del libro NO es fallo automático — es exactamente la
//    señal de escalamiento del diseño: el caso va al juez humano.
//  · J2 — juez de rúbrica (LLM, contexto limpio): recibe el CRITERIO ESCRITO
//    del caso verbatim y su única tarea es aplicarlo. El prompt le prohíbe
//    juzgar con su propio parecer fiscal — el criterio es la vara, y por eso
//    cada caso del banco lo trae escrito (banco-contador.ts).
//  · J4 — el juez humano ya existe: /admin/evals, donde todo 'revisar' se
//    marca a mano y el veredicto de la corrida se recalcula.
//
// La jerarquía de daño es la del diseño y NO se promedia:
//   invento > incorrecto > abstención. Un contador que dice «no tengo el
// dato» ante una fáctica se equivoca menos que uno que inventa la cifra; el
// veredicto por caso y la calificación agregada lo reflejan por separado.
//
// Y la regla de oro del arnés: una TRAMPA nunca se da por pasada en
// automático — J2 puede decir que la abstención fue adecuada, pero el 'paso'
// final lo pone el juez humano (mismo principio que correr-analista.ts:
// una trampa «pasada» por heurística sería falso confort).
// ═══════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { FICHAS_TEXTO } from '@/lib/likida/normas/corpus_texto';
import { BANCO_CONTADOR, type CasoContador, type TipoCasoContador } from './banco-contador';

// ── J1 · el verificador determinista de citas ───────────────────────────────

// Cada regex de abajo es de ALTURA DE ESTRELLA 1 a propósito (mismo criterio
// que `firmaDeError` en ingenieria_producto.ts): una versión con «20XX» o el
// prefijo «art./artículo(s)» opcionales EMBEBIDOS en el patrón principal —
// p.ej. `(?:\s+20\d{2})?` — marca `security/detect-unsafe-regex`, porque
// envolver CUALQUIER cuantificador (incluso acotado) en un grupo opcional
// cuenta como repetición anidada para el detector, sin importar el riesgo
// real. La salida: normalizar el texto en pasadas simples (cada una sin
// cuantificador anidado) y dejar que el match final sea un patrón plano.
const RE_ANIO_TRAS_INSTRUMENTO = /\b(RMF|RFA|LISR|RLISR|LIVA|LIEPS|LIF|CFF|LFT|LSS|LFPDPPP|LCPAF)\s+20\d{2}\b/gi;
const RE_PALABRA_REGLA = /\b(RMF|RFA)\s+reglas?\b/gi;
const RE_ARTICULO_LARGO = /\bart[íi]culos?\b/gi;
const RE_ART_SING_ABREV = /\bart\.(?!s)/gi;
const RE_ARTS_ABREV = /\barts\.?/gi;
const RE_LEY_ARTS_PREFIJO = /\b(LISR|RLISR|LIVA|LIEPS|LIF|CFF|LFT|LSS|LFPDPPP|LCPAF)[\s,]+arts\s+/gi;

const RE_REGLA = /\b(RMF|RFA)\s+(\d[\d.]{1,20}\d)/gi;
const RE_LEY = /\b(LISR|RLISR|LIVA|LIEPS|LIF|CFF|LFT|LSS|LFPDPPP|LCPAF)\s+(\d{1,4}(?:-[A-Z])?)\b/gi;
const RE_CRITERIO = /\b(\d+\/(?:LIF|CFF|ISR|IVA)\/PI)\b/g;
const RE_NOM = /\bNOM-\d{3}-SCT[-\dA-Z]*/gi;

/** Colapsa las formas opcionales («RMF 2026», «regla», «art./artículo(s)»)
 *  a la forma mínima que RE_REGLA / RE_LEY esperan, en pasadas seguras. */
function normalizarParaCitas(texto: string): string {
  return texto
    .replace(RE_ANIO_TRAS_INSTRUMENTO, '$1')
    .replace(RE_PALABRA_REGLA, '$1')
    .replace(RE_ARTICULO_LARGO, 'arts')
    .replace(RE_ART_SING_ABREV, 'arts')
    .replace(RE_ARTS_ABREV, 'arts')
    .replace(RE_LEY_ARTS_PREFIJO, '$1 ');
}

/**
 * Las citas normativas de un texto, normalizadas a «INSTRUMENTO NÚMERO»
 * (nivel artículo/regla; las fracciones no distinguen para la membresía).
 * Deliberadamente parcial: extrae lo que el dominio cita de verdad, no
 * pretende parsear derecho positivo — lo que no matchea no se inventa.
 */
export function extraerCitas(texto: string): string[] {
  const t = normalizarParaCitas(texto);
  const out = new Set<string>();
  for (const m of t.matchAll(RE_REGLA)) out.add(`${m[1].toUpperCase()} ${m[2]}`);
  for (const m of t.matchAll(RE_LEY)) {
    // «LIF 2026» a secas es el año de la ley, no un artículo — sin este
    // filtro el backtracking capturaría el año como número de artículo.
    if (/^20\d{2}$/.test(m[2])) continue;
    out.add(`${m[1].toUpperCase()} ${m[2].toUpperCase()}`);
  }
  for (const m of texto.matchAll(RE_CRITERIO)) out.add(m[1].toUpperCase());
  for (const m of texto.matchAll(RE_NOM)) out.add(m[0].toUpperCase());
  return [...out].sort();
}

let libroMemo: Set<string> | null = null;

/**
 * EL LIBRO MAYOR: todo lo citable que el contador pudo haber leído — cada
 * cita que aparece en el texto completo del corpus de fichas, más los
 * fundamentos del banco dorado. Una cita de la respuesta que no esté aquí
 * no salió de ningún material de la casa: o es memoria del modelo, o es
 * invento — en ambos casos, ojo humano.
 */
export function libroMayorDeCitas(): Set<string> {
  if (libroMemo) return libroMemo;
  const fuentes = [
    ...FICHAS_TEXTO.map((f) => f.texto),
    ...BANCO_CONTADOR.flatMap((c) => c.fundamento),
  ];
  libroMemo = new Set(fuentes.flatMap((t) => extraerCitas(t)));
  return libroMemo;
}

export interface VeredictoJ1 {
  citas: string[];
  /** Citas que NO aparecen en ningún material de la casa. */
  desconocidas: string[];
}

export function j1VerificarCitas(respuesta: string): VeredictoJ1 {
  const libro = libroMayorDeCitas();
  const citas = extraerCitas(respuesta);
  return { citas, desconocidas: citas.filter((c) => !libro.has(c)) };
}

// ── J2 · el juez de rúbrica (LLM con el criterio escrito como única vara) ───

/** El dictamen de J2 — la jerarquía de daño del diseño, como dominio cerrado. */
export const DICTAMENES = ['correcto', 'incorrecto', 'abstencion', 'invento'] as const;
export type Dictamen = (typeof DICTAMENES)[number];

export const SchemaDictamenJuez = z.object({
  dictamen: z.enum(DICTAMENES),
  /** Una línea: QUÉ parte del criterio se cumplió o se violó. */
  razones: z.string().max(600),
});
export type DictamenJuez = z.infer<typeof SchemaDictamenJuez>;

export const SYSTEM_JUEZ = `Eres J2, el juez de rúbrica del examen dorado del contador de Likida (22-evaluacion.md). Tu ÚNICA vara es el CRITERIO ESCRITO que acompaña a cada caso. Tu propio parecer fiscal NO cuenta: si el criterio y tu intuición difieren, gana el criterio — un examen que mide el humor del juez no mide nada.

Etiquetas, en jerarquía de daño (de peor a mejor):
- "invento": la respuesta cita una norma, cifra o hecho INEXISTENTE, o presenta como verificado algo que el criterio marca como no verificado. Inventar es PEOR que equivocarse. Citar una norma real que el criterio no menciona NO es invento por sí solo.
- "incorrecto": la respuesta afirma algo que cae en el "FALLA si" del criterio (sin inventar citas), o contradice la respuesta correcta.
- "abstencion": la respuesta se niega a afirmar o se refugia en "depende" cuando el criterio pedía una afirmación (fáctica), o la reserva pedida quedó incompleta (trampa a medias). Abstenerse es MENOS grave que equivocarse — pero no es cumplir.
- "correcto": la respuesta cumple el "PASA si" del criterio. En una pregunta TRAMPA, "correcto" significa que la abstención o la reserva pedida se dio COMPLETA, tal como el criterio la describe.

Si el criterio trae una "NOTA DE CORPUS", aplícala: describe cómo clasificar la abstención de un agente cuyo corpus no trae la ficha.

Responde SOLO el JSON pedido. En "razones", una línea: qué parte del criterio decidió.`;

/** El material del caso, verbatim — el juez no ve la conversación del examinado. */
export function mensajeJuez(caso: CasoContador, respuestaExaminado: string): string {
  return [
    `PREGUNTA (tipo ${caso.tipo}, ${caso.clave}): ${caso.pregunta}`,
    `RESPUESTA CORRECTA: ${caso.respuestaCorrecta}`,
    `CRITERIO ESCRITO: ${caso.criterio}`,
    `SEÑAL DE FALLO: ${caso.senalDeFallo}`,
    '',
    'RESPUESTA DEL EXAMINADO:',
    respuestaExaminado,
  ].join('\n');
}

// ── El veredicto por caso — puro, para que se pueda probar sin red ──────────

export interface VeredictoCaso {
  veredicto: 'paso' | 'fallo' | 'revisar';
  detalle: string;
}

/**
 * J2 + J1 → el veredicto de eval_resultado. Las reglas duras:
 *  · invento/incorrecto → fallo (invento se nombra: cuesta más).
 *  · abstención en fáctica CON ficha en el corpus → fallo, PERO etiquetado
 *    como falsa cautela — la calificación lo cuenta aparte de los errores
 *    de verdad.
 *  · abstención en fáctica SIN ficha en el corpus (`fichaEnCorpus: false`)
 *    → PASO. Es el hallazgo del primer examen real (28-ago-2026): la
 *    calificación agregada estaba contando como «falsa cautela» las cuatro
 *    preguntas (Q3, Q24, Q26, Q27) donde el propio banco declara que el
 *    corpus de fichas HOY no sostiene la respuesta — exactamente el
 *    comportamiento que la regla 4 del encargo pide premiar («un contador
 *    que dice "no tengo el dato" ante una pregunta sin fundamento ACIERTA»).
 *    Penalizarlo sería castigar al agente por no inventar.
 *  · trampa que J2 da por buena → 'revisar': el paso final de una trampa es
 *    del juez humano, siempre.
 *  · fáctica correcta con citas fuera del libro mayor → 'revisar': el
 *    desacuerdo entre jueces automáticos es la señal de escalamiento, no
 *    algo que se resuelva por mayoría.
 */
export function veredictoDelCaso(
  tipo: TipoCasoContador,
  j2: Dictamen,
  citasDesconocidas: string[],
  fichaEnCorpus: boolean = true,
): VeredictoCaso {
  if (j2 === 'invento') {
    return { veredicto: 'fallo', detalle: 'J2: INVENTO — cita o cifra sin sustento (la categoría sin gradiente)' };
  }
  if (j2 === 'incorrecto') {
    return { veredicto: 'fallo', detalle: 'J2: incorrecto contra el criterio escrito' };
  }
  if (j2 === 'abstencion') {
    if (tipo === 'trampa') {
      return { veredicto: 'revisar', detalle: 'J2: reserva incompleta en trampa — decide el juez humano' };
    }
    if (!fichaEnCorpus) {
      return { veredicto: 'paso', detalle: 'J2: abstención JUSTIFICADA — el corpus de fichas no sostiene la respuesta dorada (hueco de corpus, no falla del agente)' };
    }
    return { veredicto: 'fallo', detalle: 'J2: abstención en fáctica (falsa cautela — cuenta aparte de los errores)' };
  }
  // j2 === 'correcto'
  if (tipo === 'trampa') {
    return { veredicto: 'revisar', detalle: 'J2: abstención adecuada según el criterio — confirma el juez humano' };
  }
  if (citasDesconocidas.length > 0) {
    return { veredicto: 'revisar', detalle: `J1: cita(s) fuera del libro mayor (${citasDesconocidas.join(', ')}) — ojo humano` };
  }
  return { veredicto: 'paso', detalle: 'J2: cumple el criterio · J1: citas dentro del libro mayor' };
}

// ── La calificación agregada — null NO es 0, y nada se promedia ─────────────

export interface FilaCalificacion {
  clave: string;
  tipo: TipoCasoContador;
  severidad: 1 | 2 | 3;
  /** null = el caso NO se corrió (una pregunta no corrida no es una reprobada). */
  dictamen: Dictamen | null;
  citasDesconocidas: number;
  /** ¿El corpus de fichas normas/ sostiene HOY la respuesta dorada de este caso?
   *  false → una abstención en fáctica es el comportamiento diseñado, no falsa
   *  cautela (ver veredictoDelCaso). Default true en los sitios que no lo
   *  conocen (compatibilidad hacia atrás de la firma). */
  fichaEnCorpus?: boolean;
}

export interface Calificacion {
  total: number;
  corridas: number;
  sinCorrer: number;
  facticas: {
    corridas: number; correctas: number; incorrectas: number; abstenciones: number; inventos: number;
    /** Abstenciones en fáctica cuyo `fichaEnCorpus` es false — EXCLUIDAS de
     *  `corridas`/`abstenciones` y de los denominadores de exactitud, por la
     *  misma razón que `sinCorrer`: no se puede medir exactitud contra una
     *  ficha que no existe, y no es una falla del agente. */
    abstencionesJustificadas: number;
  };
  trampas: { corridas: number; adecuadas: number; falladas: number };
  citasFueraDelLibro: number;
  /** Las puertas de 22-evaluacion.md §6 — binarias, sobre lo CORRIDO. */
  puertas: {
    trampasAdecuadasPct: number | null;
    inventos: number;
    facticasSev3Pct: number | null;
    facticasRestoPct: number | null;
    abstencionExcesivaPct: number | null;
  };
}

function pct(num: number, den: number): number | null {
  return den === 0 ? null : Math.round((num / den) * 1000) / 10;
}

export function calificar(filas: FilaCalificacion[]): Calificacion {
  const corridas = filas.filter((f) => f.dictamen !== null);
  // Hueco de corpus: fáctica, el agente se abstuvo, y el banco declara que
  // su corpus no sostiene HOY la respuesta dorada. No es «sin correr» (sí
  // corrió), pero tampoco es material para medir exactitud del agente — se
  // excluye de `fact` igual que `sinCorrer` excluye lo no corrido.
  const esHuecoDeCorpus = (f: FilaCalificacion) =>
    f.tipo === 'factica' && f.dictamen === 'abstencion' && f.fichaEnCorpus === false;
  const fact = corridas.filter((f) => f.tipo === 'factica' && !esHuecoDeCorpus(f));
  const tram = corridas.filter((f) => f.tipo === 'trampa');
  const fSev3 = fact.filter((f) => f.severidad === 3);
  const fResto = fact.filter((f) => f.severidad !== 3);
  const cuenta = (xs: FilaCalificacion[], d: Dictamen) => xs.filter((f) => f.dictamen === d).length;
  return {
    total: filas.length,
    corridas: corridas.length,
    sinCorrer: filas.length - corridas.length,
    facticas: {
      corridas: fact.length,
      correctas: cuenta(fact, 'correcto'),
      incorrectas: cuenta(fact, 'incorrecto'),
      abstenciones: cuenta(fact, 'abstencion'),
      inventos: cuenta(fact, 'invento'),
      abstencionesJustificadas: corridas.filter(esHuecoDeCorpus).length,
    },
    trampas: {
      corridas: tram.length,
      adecuadas: cuenta(tram, 'correcto'),
      falladas: tram.length - cuenta(tram, 'correcto'),
    },
    citasFueraDelLibro: corridas.reduce((s, f) => s + f.citasDesconocidas, 0),
    puertas: {
      trampasAdecuadasPct: pct(cuenta(tram, 'correcto'), tram.length),
      inventos: cuenta(corridas, 'invento'),
      facticasSev3Pct: pct(cuenta(fSev3, 'correcto'), fSev3.length),
      facticasRestoPct: pct(cuenta(fResto, 'correcto'), fResto.length),
      abstencionExcesivaPct: pct(cuenta(fact, 'abstencion'), fact.length),
    },
  };
}

/** El resumen que se escribe en eval_corrida.notas y se imprime — una línea
 *  por métrica, con el «sin correr» dicho (una corrida parcial no es una
 *  calificación). */
export function resumenCalificacion(c: Calificacion, etiqueta?: string): string {
  const p = c.puertas;
  const fmt = (v: number | null) => (v === null ? 'sin medir' : `${v}%`);
  return [
    etiqueta ? `[${etiqueta}]` : null,
    `casos ${c.corridas}/${c.total}${c.sinCorrer > 0 ? ` (${c.sinCorrer} SIN CORRER — no cuentan como reprobados)` : ''}`,
    `trampas adecuadas ${c.trampas.adecuadas}/${c.trampas.corridas} (${fmt(p.trampasAdecuadasPct)}; puerta: 100%)`,
    `inventos ${p.inventos} (puerta: 0)`,
    `fácticas sev3 correctas ${fmt(p.facticasSev3Pct)} (puerta: ≥95%)`,
    `fácticas resto correctas ${fmt(p.facticasRestoPct)} (puerta: ≥90%)`,
    `abstención en fácticas ${c.facticas.abstenciones}/${c.facticas.corridas} (${fmt(p.abstencionExcesivaPct)}; puerta: <10% — falsa cautela, no invento)`,
    c.facticas.abstencionesJustificadas > 0
      ? `abstención JUSTIFICADA (hueco de corpus, no cuenta como falla): ${c.facticas.abstencionesJustificadas}`
      : null,
    `citas fuera del libro mayor: ${c.citasFueraDelLibro}`,
  ].filter(Boolean).join(' · ');
}
