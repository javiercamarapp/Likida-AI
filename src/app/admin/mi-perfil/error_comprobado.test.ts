import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24, ADM-14 (MEDIO) — las dos escrituras de este panel ignoraban
// el `error` de supabase-js y hacían `redirect('?ok=…')` de todos modos:
// "Guardado" podía salir aunque el UPDATE hubiera fallado de verdad. Viola
// "fallar cerrado y decirlo" (CLAUDE.md).
//
// Mismo patrón que `avatar_validado.test.ts`: la lógica vive en Server
// Actions INLINE dentro del Server Component, así que la prueba lee el
// código fuente y falla si el candado de `error` vuelve a faltar.
// ═══════════════════════════════════════════════════════════════════════════

const PAGINA = readFileSync(
  fileURLToPath(new URL('./page.tsx', import.meta.url)),
  'utf8',
);

describe('admin/mi-perfil: actualizarNombre comprueba el error antes de decir "guardado"', () => {
  it('destructura el error del update', () => {
    const accion = PAGINA.slice(PAGINA.indexOf('async function actualizarNombre'), PAGINA.indexOf('async function subirAvatar'));
    expect(accion).toMatch(/const \{ error \} = await supabaseAdmin\(\)\.from\('app_user'\)\.update\(\{ nombre \}\)/);
  });

  it('con error, redirige a un ?error= DISTINTO de ?ok=nombre — nunca "guardado" sobre un fallo', () => {
    const accion = PAGINA.slice(PAGINA.indexOf('async function actualizarNombre'), PAGINA.indexOf('async function subirAvatar'));
    const posIfError = accion.indexOf('if (error)');
    const posOk = accion.indexOf("redirect('/admin/mi-perfil?ok=nombre')");
    expect(posIfError).toBeGreaterThan(-1);
    expect(posOk).toBeGreaterThan(-1);
    // El `if (error)` con SU redirect tiene que aparecer ANTES del redirect
    // incondicional de éxito, o el éxito seguiría corriendo primero.
    expect(posIfError).toBeLessThan(posOk);
  });
});

describe('admin/mi-perfil: subirAvatar comprueba el error del segundo UPDATE (avatar_url)', () => {
  it('el archivo puede subir a Storage y el UPDATE de app_user fallar — ese error también se comprueba', () => {
    const accion = PAGINA.slice(PAGINA.indexOf('async function subirAvatar'), PAGINA.indexOf('return (\n    <main'));
    // El primer `error` (subida a storage) ya se comprobaba antes de esta
    // ronda; lo nuevo es el SEGUNDO update, el que escribe avatar_url.
    expect(accion).toMatch(/const \{ error: errAvatar \} = await admin2\.from\('app_user'\)\.update\(\{ avatar_url:/);
    expect(accion).toMatch(/if \(errAvatar\) redirect\('\/admin\/mi-perfil\?error=avatar_guardar'\)/);
  });
});

describe('admin/mi-perfil: la pantalla pinta los dos errores nuevos', () => {
  it('distingue "nombre vacío" de "el guardado falló" — son cosas distintas', () => {
    expect(PAGINA).toMatch(/sp\.error === 'nombre_guardar'/);
    expect(PAGINA).toMatch(/sp\.error === 'avatar_guardar'/);
  });
});
