import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Config DEDICADA al runner de auditoría. No toca la config principal
// (vitest.config.ts): `npm test` sigue corriendo la suite del repo, y este
// runner corre SOLO los archivos *.audit.ts de scripts/auditoria.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['scripts/auditoria/**/*.audit.ts'],
    exclude: ['**/node_modules/**'],
    environment: 'node',
    globals: false,
  },
});