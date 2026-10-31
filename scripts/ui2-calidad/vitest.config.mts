import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Config propia del detector de calidad UI v2: solo recoge `*.harness.tsx` de esta carpeta (el vitest.config.ts de la
// raíz no los matchea, así que `npm test` jamás los corre).
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  test: {
    root: fileURLToPath(new URL('../..', import.meta.url)),
    include: ['scripts/ui2-calidad/**/*.harness.tsx'],
    environment: 'node',
  },
});
