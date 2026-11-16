import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Config propia del arnés admin-sa: SOLO recoge admin-sa*.harness.tsx (el `vitest.config.ts` raíz no lo ve).
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  test: {
    root: fileURLToPath(new URL('../..', import.meta.url)),
    include: ['scripts/ui2-captura/admin-sa*.harness.tsx'],
    environment: 'node',
  },
});
