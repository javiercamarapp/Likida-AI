// El lector REAL del examen del OCR: llama al proveedor. Solo se importa DESPUÉS de que
// `permisoCorridaReal` autorizó la corrida (ver correr-ocr.ts y src/lib/evals/ocr-real.ts).
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { PROMPT_OCR, EsquemaExtraccionOcr } from '../../src/lib/likida/intake/ocr';
import { generateStructured } from '../../src/lib/llm/openrouter';
import { createLlmBudget } from '../../src/lib/llm/budget';
import { renderizarSvg } from '../../src/lib/evals/ocr-corpus';
import { proyectarLectura, type CasoOcr } from '../../src/lib/evals/ocr-contrato';
import { correrLector, type ResultadoCorrida } from '../../src/lib/evals/ocr-corrida';

const TENANT = process.env.DEMO_TENANT_ID ?? '11111111-1111-1111-1111-111111111111';

async function aDataUrl(c: CasoOcr): Promise<string> {
  if (c.imagenPath) return `data:image/jpeg;base64,${(await sharp(readFileSync(c.imagenPath)).jpeg().toBuffer()).toString('base64')}`;
  const png = await sharp(Buffer.from(renderizarSvg(c))).jpeg().toBuffer();
  return `data:image/jpeg;base64,${png.toString('base64')}`;
}

export async function corridaRealOcr(casos: readonly CasoOcr[], maxUsd: number): Promise<ResultadoCorrida> {
  // Propósito 'fondo' SIEMPRE: el examen jamás toca la reserva del camino interactivo (mig. 0244).
  const budget = createLlmBudget(TENANT, randomUUID(), 'fondo', { maxRunUsd: maxUsd });
  return correrLector({
    casos, maxUsd,
    lector: async (c) => {
      const res = await generateStructured({
        role: 'ocr', system: PROMPT_OCR, messages: [{ role: 'user', content: 'Extrae los datos de este comprobante.' }],
        images: [await aDataUrl(c)], schema: EsquemaExtraccionOcr, schemaName: 'comprobante', budget,
      });
      return { lectura: proyectarLectura(res.data as Record<string, unknown>), costoUsd: res.cost, noMedido: 'noMedido' in res ? Boolean(res.noMedido) : false };
    },
  });
}
