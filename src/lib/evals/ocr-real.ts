/* eslint-disable security/detect-non-literal-fs-filename -- la ruta del corpus real es configuración local del dueño, validada fuera del repo y sin '..' */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { CONCEPTOS_EXAMEN, DOCUMENTOS_EXAMEN, type CasoOcr } from './ocr-contrato';

// ═══════════════════════════════════════════════════════════════════════════
// LA CORRIDA REAL: PREPARADA, APAGADA Y DECLARADA (F17 d, b-real).
//
// Nada de este archivo llama a un proveedor. Declara las condiciones bajo las
// que `scripts/evals/correr-ocr.ts --real` está autorizado a gastar, y carga el
// corpus REAL redactado desde una ruta local FUERA de git.
//
// PARA ENCENDERLA (decisión D25 del dueño, no de un constructor):
//   1. El dueño fija un tope en USD y alguien lo escribe en `topeMaximoUsd`
//      (hoy null = apagada) y pone `habilitada: true` en un commit revisado.
//   2. Cada corrida exige además `--max-usd N` (N ≤ topeMaximoUsd) y
//      LIKIDA_EVAL_OCR_REAL=1 en el entorno.
//   3. Sin el tope, el script se niega ANTES de importar el cliente del LLM.
// ═══════════════════════════════════════════════════════════════════════════

export const CORRIDA_REAL_OCR = {
  decision: 'D25',
  habilitada: false as boolean,
  /** USD. `null` hasta que el dueño lo fije. */
  topeMaximoUsd: null as number | null,
  /** Variable de entorno con la ruta del corpus real redactado. */
  variableCorpusReal: 'LIKIDA_OCR_CORPUS_REAL_DIR',
  variableConfirmacion: 'LIKIDA_EVAL_OCR_REAL',
} as const;

export interface PermisoCorridaReal { permitido: boolean; razon: string | null; maxUsd: number | null }

export function permisoCorridaReal(
  maxUsdArg: number | undefined, env: Record<string, string | undefined>,
  decl: { habilitada: boolean; topeMaximoUsd: number | null } = CORRIDA_REAL_OCR,
): PermisoCorridaReal {
  const no = (razon: string): PermisoCorridaReal => ({ permitido: false, razon, maxUsd: null });
  if (!decl.habilitada) return no('la corrida real está APAGADA (decisión D25 pendiente del dueño: falta fijar el tope en USD)');
  if (decl.topeMaximoUsd === null || !(decl.topeMaximoUsd > 0)) return no('no hay tope máximo declarado en CORRIDA_REAL_OCR.topeMaximoUsd');
  if (maxUsdArg === undefined || !Number.isFinite(maxUsdArg) || maxUsdArg <= 0) return no('falta --max-usd N (un número positivo): no hay corrida real sin tope explícito');
  if (maxUsdArg > decl.topeMaximoUsd) return no(`--max-usd ${maxUsdArg} excede el tope declarado por el dueño (${decl.topeMaximoUsd})`);
  if (env[CORRIDA_REAL_OCR.variableConfirmacion] !== '1') return no(`falta ${CORRIDA_REAL_OCR.variableConfirmacion}=1 en el entorno`);
  return { permitido: true, razon: null, maxUsd: maxUsdArg };
}

// ── El corpus real redactado, FUERA de git ──────────────────────────────────

const EsperadoRealSchema = z.object({
  legible: z.boolean(),
  concepto: z.enum(CONCEPTOS_EXAMEN).optional(),
  monto: z.number().finite().nullable(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  rfc_emisor: z.string().nullable(),
  litros: z.number().finite().nullable(),
  documento: z.enum(DOCUMENTOS_EXAMEN),
  texto_sospechoso: z.boolean(),
  moneda: z.string().nullable(),
});

export const ManifiestoCorpusRealSchema = z.object({
  /** Quien redactó y cuándo: el corpus real lo prepara una persona, no un script. */
  redactadoPor: z.string().min(1),
  redactadoEn: z.string().min(1),
  casos: z.array(z.object({
    id: z.string().min(1),
    categoria: z.string().min(1),
    /** Nombre del archivo de imagen, relativo a la carpeta. */
    imagen: z.string().min(1).refine((s) => !s.includes('..') && !isAbsolute(s), 'ruta relativa sin ..'),
    esperado: EsperadoRealSchema,
  })).min(1),
});

function dentroDe(raiz: string, ruta: string): boolean {
  const r = relative(raiz, ruta);
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
}

/** Rechaza cualquier ruta dentro del repo: el corpus real NUNCA se versiona. */
export function cargarCorpusReal(dir: string, raizRepo: string): CasoOcr[] {
  const d = realpathSync(resolve(dir));
  const raiz = realpathSync(resolve(raizRepo));
  if (dentroDe(raiz, d)) throw new Error(`el corpus real no puede vivir dentro del repo (${raiz}): el repo es público`);
  const man = join(d, 'manifest.json');
  if (!existsSync(man)) throw new Error(`falta manifest.json en el corpus real (${d})`);
  const m = ManifiestoCorpusRealSchema.parse(JSON.parse(readFileSync(man, 'utf8')));
  return m.casos.map((c) => {
    const img = join(d, c.imagen);
    if (!existsSync(img)) throw new Error(`falta la imagen ${c.imagen} del caso ${c.id}`);
    return { id: c.id, origen: 'real' as const, categoria: c.categoria as CasoOcr['categoria'], imagenPath: img, esperado: c.esperado };
  });
}
