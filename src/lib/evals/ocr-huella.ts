import { z } from 'zod';
import { PROMPT_OCR, EsquemaExtraccionOcr } from '@/lib/likida/intake/ocr';
import { modelFor } from '@/lib/llm/models';
import { createHash } from 'node:crypto';
import type { CasoOcr } from './ocr-contrato';
import { huellaExamen, type HuellaExamen } from './ocr-congelado';

/** La huella VIVA: el prompt, el modelo y el esquema que corren hoy en producción. */
export function huellaOcrViva(casos: readonly CasoOcr[]): HuellaExamen {
  return huellaExamen(PROMPT_OCR, modelFor('ocr'), z.toJSONSchema(EsquemaExtraccionOcr), casos);
}

/** Solo el hash del prompt (lo que muestra /admin/evals como «el prompt cambió»). */
export function hashPromptOcr(): string {
  return createHash('sha256').update(PROMPT_OCR, 'utf8').digest('hex');
}
