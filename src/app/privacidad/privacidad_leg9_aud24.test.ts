import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24, LEG-9 (MEDIO, reincidente ×3): la cláusula del art. 35 solo
// decía "capturas de pantalla del portal de facturación", y
// `piloto_vision.ts:478-480` manda además, en cada paso, un inventario de
// los campos de la página (con los `hidden` incluidos) y el texto visible
// completo. El aviso ahora describe el flujo real (art. 35 lo exige).
// ═══════════════════════════════════════════════════════════════════════════

const PAGINA = readFileSync('src/app/privacidad/page.tsx', 'utf8');

describe('LEG-9 · /privacidad describe lo que el piloto de facturación manda de verdad', () => {
  it('menciona el texto visible y el inventario de campos, no solo la captura', () => {
    expect(PAGINA).toMatch(/texto visible/);
    expect(PAGINA).toMatch(/inventario de sus campos/);
  });
});
