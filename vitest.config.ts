import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Alias '@' → src/ para que los tests puedan importar módulos que usan '@/...'
// en tiempo de ejecución (antes solo los type-only resolvían).
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
