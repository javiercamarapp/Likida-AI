import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24, LEG-10 (MEDIO, reincidente): la cláusula taxativa de "Con
// quién se comparten" (art. 35) omitía al procesador de pagos. `grep
// 'pago|stripe' privacidad/page.tsx` daba 0. Se nombra, con su finalidad.
// ═══════════════════════════════════════════════════════════════════════════

const PAGINA = readFileSync('src/app/privacidad/page.tsx', 'utf8');

describe('LEG-10 · /privacidad nombra a Stripe en la lista de encargadas', () => {
  it('nombra a Stripe y dice qué le llega', () => {
    expect(PAGINA).toMatch(/Stripe/);
    expect(PAGINA.toLowerCase()).toMatch(/mensualidad/);
  });
});
