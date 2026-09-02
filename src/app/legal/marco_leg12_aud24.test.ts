import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24, LEG-12 (BAJO, reincidente): "Vigente al <hoy>" en los cuatro
// documentos legales era la fecha del RENDER (`fechaMx(new Date())`), no la
// del último cambio de texto — cambiaba cada día que alguien abriera la
// página, y nunca decía cuándo cambió de verdad. `PaginaLegal` ahora exige
// una prop `vigenteDesde` por documento; cada llamador declara su propia
// fecha del último cambio SUSTANTIVO.
// ═══════════════════════════════════════════════════════════════════════════

const MARCO = readFileSync('src/app/legal/marco.tsx', 'utf8');
const TERMINOS = readFileSync('src/app/terminos/page.tsx', 'utf8');
const PRIVACIDAD = readFileSync('src/app/privacidad/page.tsx', 'utf8');
const PROSPECTOS = readFileSync('src/app/aviso/prospectos/page.tsx', 'utf8');
const TENANT = readFileSync('src/app/aviso/[tenant]/page.tsx', 'utf8');

describe('LEG-12 · el rótulo "Vigente" ya no es la fecha del render', () => {
  it('marco.tsx ya no usa `new Date()` para "Vigente"', () => {
    expect(MARCO).not.toMatch(/Vigente[^\n]*new Date\(\)/);
    expect(MARCO).toMatch(/vigenteDesde/);
  });

  it('los cuatro documentos pasan una fecha constante, no `new Date()`', () => {
    for (const [nombre, texto] of [
      ['terminos', TERMINOS], ['privacidad', PRIVACIDAD],
      ['prospectos', PROSPECTOS], ['aviso/[tenant]', TENANT],
    ] as const) {
      expect(texto, `${nombre} debe declarar una fecha`).toMatch(/vigenteDesde|VIGENTE_DESDE/);
      expect(texto, `${nombre} no debe usar new Date() para el rótulo "Vigente"`)
        .not.toMatch(/Vigente[^\n]*new Date\(\)/);
    }
  });
});
