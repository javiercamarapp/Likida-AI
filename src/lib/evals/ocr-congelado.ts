import { createHash } from 'node:crypto';
import { z } from 'zod';
import { LecturaOcrSchema, type CasoOcr } from './ocr-contrato';
import { huellaCorpus } from './ocr-corpus';

// ═══════════════════════════════════════════════════════════════════════════
// LO CONGELADO Y EL `--check` DE DERIVA (F17 c).
//
// «Congelar» = guardar, junto con las lecturas, la HUELLA de lo que se examinó:
// prompt, modelo, esquema y corpus. `--check` recalcula la huella viva sin red
// y falla si algo cambió sin re-congelar. Es la regla de re-examen de
// 22-evaluacion.md hecha prueba de CI.
//
// `origen` es la frontera de honestidad:
//  - 'doble': congelado con un guion. Detecta deriva; NO certifica al modelo.
//  - 'real' : congelado con la corrida real pagada (D25). Es el único que
//             puede dar por vigente a un slug de dinero (`compuertaModeloDinero`).
// ═══════════════════════════════════════════════════════════════════════════

export const HuellaSchema = z.object({
  prompt: z.string().length(64),
  modelo: z.string().min(1),
  esquema: z.string().length(64),
  corpus: z.string().length(64),
});
export type HuellaExamen = z.infer<typeof HuellaSchema>;

export const ManifiestoOcrSchema = z.object({
  version: z.literal(1),
  rol: z.literal('ocr'),
  origen: z.enum(['doble', 'real']),
  /** Perfil del doble, si lo fue. */
  perfilDoble: z.string().nullable(),
  congeladoEn: z.string(),
  huella: HuellaSchema,
  /** USD gastados en el congelado. `null` = no aplica (doble) o no medido. */
  costoUsd: z.number().nullable(),
  veredicto: z.enum(['paso', 'fallo', 'revisar']),
  lecturas: z.record(z.string(), LecturaOcrSchema),
});
export type ManifiestoOcr = z.infer<typeof ManifiestoOcrSchema>;

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export function huellaExamen(prompt: string, modelo: string, esquemaJson: unknown, casos: readonly CasoOcr[]): HuellaExamen {
  return { prompt: sha(prompt), modelo, esquema: sha(JSON.stringify(esquemaJson)), corpus: huellaCorpus(casos) };
}

export interface ResultadoDeriva { ok: boolean; diferencias: string[] }

export function verificarDeriva(m: ManifiestoOcr, viva: HuellaExamen, casos: readonly CasoOcr[]): ResultadoDeriva {
  const d: string[] = [];
  if (m.huella.prompt !== viva.prompt) d.push('el PROMPT del OCR cambió desde que se congeló');
  if (m.huella.modelo !== viva.modelo) d.push(`el MODELO cambió: congelado «${m.huella.modelo}», vivo «${viva.modelo}»`);
  if (m.huella.esquema !== viva.esquema) d.push('el ESQUEMA de extracción cambió');
  if (m.huella.corpus !== viva.corpus) d.push('el CORPUS cambió (un papel o una verdad)');
  const ids = new Set(casos.map((c) => c.id));
  const faltan = casos.filter((c) => !(c.id in m.lecturas)).map((c) => c.id);
  const sobran = Object.keys(m.lecturas).filter((k) => !ids.has(k));
  if (faltan.length) d.push(`faltan lecturas congeladas de: ${faltan.join(', ')}`);
  if (sobran.length) d.push(`lecturas congeladas de casos que ya no existen: ${sobran.join(', ')}`);
  return { ok: d.length === 0, diferencias: d };
}

export function mensajeDeriva(m: ManifiestoOcr, r: ResultadoDeriva): string {
  const como = m.origen === 'real'
    ? 'Re-examina con la corrida real autorizada (npx tsx scripts/evals/correr-ocr.ts --real --max-usd <tope de D25>).'
    : 'Re-congela el doble con: npx tsx scripts/evals/correr-ocr.ts --congelar-doble. (Esto NO certifica al modelo real.)';
  return `Deriva del examen del OCR:\n - ${r.diferencias.join('\n - ')}\n${como}`;
}

/** `promptSha` = sha256 hex del prompt vivo (`huellaExamen(...).prompt`). */
export interface SlugDinero { rol: string; slug: string; promptSha: string }
export interface DecisionModelo { aceptado: boolean; razon: string; certificadoPorExamenReal: boolean }

/**
 * LA COMPUERTA (F17 e): un slug de un rol de dinero sin examen REAL vigente
 * para ese hash de prompt no se acepta. Función pura; NO está cableada a
 * `models.ts` (eso es F16 b). `modo: 'advertir'` devuelve aceptado=true pero
 * con la razón, para poder enlazarla sin tumbar hoy el modelo por omisión.
 */
export function compuertaModeloDinero(m: ManifiestoOcr | null, q: SlugDinero, modo: 'bloquear' | 'advertir' = 'bloquear'): DecisionModelo {
  let razon: string | null = null;
  if (m === null) razon = 'no hay examen congelado';
  else if (m.rol !== q.rol) razon = `el examen es del rol «${m.rol}», no de «${q.rol}»`;
  else if (m.origen !== 'real') razon = 'el examen congelado es de un doble, no de una corrida real';
  else if (m.veredicto !== 'paso') razon = `el último examen real salió «${m.veredicto}»`;
  else if (m.huella.modelo !== q.slug) razon = `el examen vigente es del modelo «${m.huella.modelo}», no de «${q.slug}»`;
  else if (m.huella.prompt !== q.promptSha) razon = 'el prompt cambió desde el examen real';
  if (razon === null) return { aceptado: true, razon: 'examen real vigente para este slug y este prompt', certificadoPorExamenReal: true };
  return { aceptado: modo === 'advertir', razon, certificadoPorExamenReal: false };
}
