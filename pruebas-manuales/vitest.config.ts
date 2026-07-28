import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Config APARTE para el arnés manual de imágenes.
//
// Por qué separada: este arnés hace llamadas REALES (OCR por OpenRouter + SAT),
// cuesta dinero y depende de red. El archivo se llama `*.prueba.ts` — no matchea
// el include por defecto de vitest — así que `npm test` NUNCA lo corre y la suite
// verde sigue siendo offline y reproducible.
//
// Se corre a mano:  npx vitest run --config pruebas-manuales/vitest.config.ts
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  resolve: {
    alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
  },
  test: {
    include: ['pruebas-manuales/*.prueba.ts'],
    testTimeout: 600_000, // OCR de varias imágenes en serie
    hookTimeout: 60_000,
  },
});
