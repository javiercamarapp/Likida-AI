import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Config DEDICADA al runner del ejército de QA (calca de vitest.audit.config.ts).
// No toca la config principal: `npm test` sigue corriendo la suite offline del
// repo, y este runner corre SOLO los *.qa.ts de scripts/qa-agentes (más el
// arnés de depuración de pruebas-manuales/qa-agentes). Hace llamadas REALES de
// pago (OCR + cuadre por OpenRouter) contra el tenant ZZZ QA — se invoca a
// propósito: npm run qa:nocturno.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: [
      'scripts/qa-agentes/**/*.qa.ts',
      'pruebas-manuales/qa-agentes/**/*.prueba.ts',
    ],
    exclude: ['**/node_modules/**'],
    environment: 'node',
    globals: false,
    // Escenarios con OCR real + agente de cuadre: minutos, no segundos.
    testTimeout: 900_000,
    hookTimeout: 300_000,
  },
});
