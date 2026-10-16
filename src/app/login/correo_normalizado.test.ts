import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ═══════════════════════════════════════════════════════════════════════════
// FASE 1 · SEG-LOGIN-MAYUSCULAS (checklist 31 v2, #2): `invitar.ts:81` ya
// normaliza el correo con `.trim().toLowerCase()` al CREAR la cuenta, pero
// `login/page.tsx:146` solo hacía `.trim()` al ENTRAR — asimetría real:
// MAYUSCULA@dominio.com y minuscula@dominio.com son el MISMO registro en
// GoTrue (que normaliza a minúsculas al guardar), pero esta pantalla le
// mandaba a `signInWithOtp` el correo tal cual lo tecleó el operador. GoTrue
// internamente normaliza igual al buscar, así que no era una fuga — pero sí
// una inconsistencia frente a `reenvio_enlace.ts` (que guarda la cookie con
// el correo SIN normalizar) y frente al propio `invitar.ts`, la fuente de
// verdad de "así se guarda un correo en este repo".
//
// Mismo criterio que `no_autoregistro.test.ts`: los server actions viven
// dentro del componente y no se pueden importar sueltos — se lee el fuente.
// ═══════════════════════════════════════════════════════════════════════════

const PAGINA = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');

describe('/login normaliza el correo igual que invitar.ts', () => {
  it('aplica .toLowerCase() además de .trim() antes de usar el correo', () => {
    expect(PAGINA).toMatch(/\.trim\(\)\.toLowerCase\(\)/);
  });

  it('guarda el correo para reenvío YA normalizado, no el crudo del formulario', () => {
    // `guardarCorreoParaReenvio(email)` tiene que recibir la variable
    // normalizada, no `formData.get('email')` sin pasar por `.toLowerCase()`.
    const i = PAGINA.indexOf('guardarCorreoParaReenvio(email)');
    expect(i, 'se esperaba que guardarCorreoParaReenvio reciba la variable `email`').toBeGreaterThan(-1);
    const antes = PAGINA.slice(0, i);
    const declaracion = antes.lastIndexOf('const email =');
    expect(declaracion).toBeGreaterThan(-1);
    expect(antes.slice(declaracion)).toMatch(/\.trim\(\)\.toLowerCase\(\)/);
  });
});
