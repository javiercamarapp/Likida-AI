import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { modelFor } from './models';

// ═══════════════════════════════════════════════════════════════════════════
// LOS SLUGS DE MODELO SON IDS REALES DE OPENROUTER (Carta Porte, ronda 3).
//
// Ronda 2 dejó dos slugs sin verificar: `google/gemini-3.8-flash` y
// `anthropic/claude-sonnet-5.5`. El 1-oct-2026 se consultó la API pública
// (`GET https://openrouter.ai/api/v1/models`, sin llave) y los dos EXISTEN, con
// los precios que usa el repo ($0.75/$3.75 y $2/$10 por millón) y entrada de
// imagen y archivo. La foto de lo que Likida usa vive en
// `fixtures/openrouter_modelos_2026-10-01.json`; `scripts/verificar-modelos-
// openrouter.ts` la contrasta con la API de hoy (necesita red: no corre en CI).
//
// Un slug inventado no falla ruidosamente: OpenRouter contesta 404/400 y el
// extractor escala al siguiente escalón o al fallback, con latencia y costo, y el
// documento termina «sin extraer». Esta prueba falla ANTES.
// ═══════════════════════════════════════════════════════════════════════════

const FOTO = JSON.parse(readFileSync('src/lib/llm/fixtures/openrouter_modelos_2026-10-01.json', 'utf8')) as {
  modelos: Record<string, { entrada: string[]; precioEntradaUsdM: number; precioSalidaUsdM: number }>;
};
const slugsDe = (archivo: string): string[] =>
  [...new Set([...readFileSync(archivo, 'utf8').matchAll(/'((?:[a-z0-9-]+)\/[a-z0-9.:_-]+)'/g)].map((m) => m[1]))]
    .filter((s) => !s.startsWith('.') && /^(anthropic|google|openai|meta|deepseek|x-ai|mistralai|qwen)\//.test(s));
const PRECIOS_OPENROUTER = (() => {
  const texto = readFileSync('src/lib/llm/openrouter.ts', 'utf8');
  const bloque = /const PRICES: Record<string, \[number, number\]> = \{([\s\S]*?)\n\};/.exec(texto)?.[1] ?? '';
  return new Map([...bloque.matchAll(/'([a-z0-9./:_-]+)':\s*\[([0-9.]+),\s*([0-9.]+)\]/g)].map((m) => [m[1], [Number(m[2]), Number(m[3])] as const]));
})();

describe('los slugs que usa el repo existen en OpenRouter', () => {
  it('cada slug de models.ts y openrouter.ts está en la foto de la API pública del 1-oct-2026', () => {
    const slugs = [...slugsDe('src/lib/llm/models.ts'), ...slugsDe('src/lib/llm/openrouter.ts')];
    expect(slugs.length).toBeGreaterThan(10);
    const faltan = [...new Set(slugs)].filter((s) => !(s in FOTO.modelos));
    expect(faltan, `slugs que no están en la foto de OpenRouter: ${faltan.join(', ')}. Si es un modelo nuevo, corre scripts/verificar-modelos-openrouter.ts --escribir.`).toEqual([]);
  });

  it('los dos slugs que ronda 2 dejó sin verificar son reales y con el precio que usa el repo', () => {
    expect(FOTO.modelos['google/gemini-3.8-flash']).toMatchObject({ precioEntradaUsdM: 0.75, precioSalidaUsdM: 3.75 });
    expect(FOTO.modelos['anthropic/claude-sonnet-5.5']).toMatchObject({ precioEntradaUsdM: 2, precioSalidaUsdM: 10 });
    expect(PRECIOS_OPENROUTER.get('google/gemini-3.8-flash')).toEqual([0.75, 3.75]);
    expect(PRECIOS_OPENROUTER.get('anthropic/claude-sonnet-5.5')).toEqual([2, 10]);
  });

  it('los TRES escalones del extractor de Carta Porte y su fallback leen imagen y archivo (PDF), y su precio de PRICES es el de OpenRouter', () => {
    const escalones = [modelFor('cartaporte_extractor'), modelFor('cartaporte_extractor_escala'), modelFor('cartaporte_extractor_escala2'), 'anthropic/claude-haiku-4.5'];
    for (const slug of escalones) {
      const m = FOTO.modelos[slug];
      expect(m, slug).toBeDefined();
      expect(m.entrada, `${slug} no lee imagen`).toContain('image');
      expect(m.entrada, `${slug} no lee archivos`).toContain('file');
      const p = PRECIOS_OPENROUTER.get(slug);
      if (p) expect(p, `precio de ${slug} en openrouter.ts`).toEqual([m.precioEntradaUsdM, m.precioSalidaUsdM]);
    }
  });

  it('los modelos de visión de los otros roles (OCR del comprobante, Conductor, Vigía) también leen imagen', () => {
    for (const rol of ['ocr', 'conductor_hito'] as const) expect(FOTO.modelos[modelFor(rol)].entrada, rol).toContain('image');
  });

  it('cada fallback declarado en openrouter.ts apunta a un modelo real', () => {
    const texto = readFileSync('src/lib/llm/openrouter.ts', 'utf8');
    const bloque = /const FALLBACKS?[^=]*=\s*\{([\s\S]*?)\n\};/.exec(texto)?.[1] ?? '';
    const destinos = [...bloque.matchAll(/'[a-z0-9./:_-]+':\s*'([a-z0-9./:_-]+)'/g)].map((m) => m[1]);
    for (const d of destinos) expect(FOTO.modelos[d], `fallback ${d}`).toBeDefined();
  });
});
