import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24, LEG-4 (ALTO): `/aviso/prospectos` traía su propio
// `RESPONSABLE` fijo en `{ razonSocial: null, domicilio: null }` en vez de
// leer `LEGAL_CONFIG` — la fuente única que ya usan `/privacidad` y
// `/terminos`. En producción eso imprimía «🔴 razón social pendiente 🔴» en
// la liga que va al pie de 6,524 correos fríos, mientras `/privacidad`, con
// el MISMO dato ya capturado en el entorno, mostraba la razón social real.
//
// Esta prueba fija que la página lea la fuente única y no traiga su propia
// copia hardcodeada — así una futura edición no puede reintroducir el bug
// sin que esta prueba lo note.
// ═══════════════════════════════════════════════════════════════════════════

const PAGINA = readFileSync('src/app/aviso/prospectos/page.tsx', 'utf8');

describe('LEG-4 · /aviso/prospectos lee la fuente única de identidad legal', () => {
  it('importa y usa LEGAL_CONFIG, no un RESPONSABLE hardcodeado en null', () => {
    expect(PAGINA).toMatch(/from ['"]@\/lib\/legal\/config['"]/);
    expect(PAGINA).toMatch(/razonSocial:\s*LEGAL_CONFIG\.razonSocial/);
    expect(PAGINA).toMatch(/domicilio:\s*LEGAL_CONFIG\.domicilio/);
    // El contacto también viene de la fuente única: antes era un buzón
    // distinto (`likida.ai@gmail.com`) al de `/privacidad`.
    expect(PAGINA).toMatch(/contacto:\s*LEGAL_CONFIG\.contacto/);
  });

  it('ya no hardcodea razonSocial/domicilio en null', () => {
    expect(PAGINA).not.toMatch(/razonSocial:\s*null/);
    expect(PAGINA).not.toMatch(/domicilio:\s*null/);
  });
});
