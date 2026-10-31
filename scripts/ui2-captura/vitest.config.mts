import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Config propia del arnés de capturas de la UI v2 (Fase 0.2). Solo recoge
// `*.harness.tsx`, que el `vitest.config.ts` de la raíz NO matchea (su patrón
// por defecto es *.test.* / *.spec.*), así que `npm test` jamás lo corre.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  test: {
    root: fileURLToPath(new URL('../..', import.meta.url)),
    include: ['scripts/ui2-captura/**/*.harness.tsx'],
    environment: 'node',
  },
});
