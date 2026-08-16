import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// ═══════════════════════════════════════════════════════════════════════════
// Config para las PRUEBAS MANUALES (`pruebas-manuales/*.prueba.ts`): corren
// contra la base REAL con .env.local sourceado, a mano, NUNCA en CI — por eso
// viven fuera del include de la suite (que solo colecta `*.test.ts`).
// Mismo patrón que `vitest.audit.config.ts`. Uso:
//   set -a; source .env.local; set +a
//   npx vitest run --config vitest.manual.config.ts pruebas-manuales/<archivo>
// ═══════════════════════════════════════════════════════════════════════════
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['pruebas-manuales/**/*.prueba.ts'],
    // Serial a propósito: tocan datos reales; dos a la vez se pisan.
    fileParallelism: false,
  },
});
