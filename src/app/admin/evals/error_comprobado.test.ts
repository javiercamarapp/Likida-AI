import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24, ADM-14 (MEDIO):
//
//  1. `marcarResultado` (Server Action inline) hacía TRES escrituras y
//     descartaba el `error` de cada una — el juez humano hacía clic en
//     "pasó" y podía no haber quedado registrado.
//  2. La lectura de `eval_corrida` (últimas 10 corridas) usaba
//     `r.data ?? []` sin mirar `r.error`: una base caída se pintaba igual
//     que "ninguna corrida todavía" — "no se sabe" ≠ "no hay" (CLAUDE.md).
//  3. Lo mismo dentro del loop por agente, con `eval_resultado`.
//
// Mismo patrón que `avatar_validado.test.ts`/`mi-perfil/error_comprobado.
// test.ts`: la lógica vive inline en un Server Component, así que la
// prueba lee el código fuente y falla si el candado de `error` desaparece.
// ═══════════════════════════════════════════════════════════════════════════

const PAGINA = readFileSync(
  fileURLToPath(new URL('./page.tsx', import.meta.url)),
  'utf8',
);

function cuerpo(inicio: string, fin: string): string {
  const i = PAGINA.indexOf(inicio);
  const j = PAGINA.indexOf(fin, i);
  expect(i, `no se encontró "${inicio}"`).toBeGreaterThan(-1);
  expect(j, `no se encontró "${fin}" después de "${inicio}"`).toBeGreaterThan(-1);
  return PAGINA.slice(i, j);
}

describe('admin/evals: marcarResultado comprueba las TRES escrituras', () => {
  const accion = cuerpo('async function marcarResultado', '\nconst AGENTES');

  it('comprueba el error del UPDATE que marca el veredicto', () => {
    expect(accion).toMatch(/const \{ data, error: errMarcar \} = await admin\.from\('eval_resultado'\)/);
    expect(accion).toMatch(/if \(errMarcar\) \{/);
  });

  it('comprueba el error de la relectura para recalcular el veredicto agregado', () => {
    expect(accion).toMatch(/const \{ data: todos, error: errLeer \} = await admin\.from\('eval_resultado'\)/);
    expect(accion).toMatch(/if \(errLeer\) \{/);
  });

  it('comprueba el error del UPDATE del veredicto agregado de la corrida', () => {
    expect(accion).toMatch(/const \{ error: errAgregado \} = await admin\.from\('eval_corrida'\)/);
    expect(accion).toMatch(/if \(errAgregado\) \{/);
  });

  it('cualquier error de escritura redirige con ?error=marcar — nunca un `return` mudo', () => {
    expect(accion.match(/redirect\('\/admin\/evals\?error=marcar'\)/g)?.length).toBe(3);
  });
});

describe('admin/evals: la pantalla dice "no se pudo leer" cuando de verdad no se pudo', () => {
  it('el redirect de marcarResultado se pinta como banner', () => {
    expect(PAGINA).toMatch(/sp\.error === 'marcar'/);
  });

  it('la lectura de eval_corrida comprueba r.error antes de pintar "Ninguna todavía"', () => {
    const bloque = cuerpo("const r = await admin.from('eval_corrida')", 'for (const def of AGENTES)');
    expect(bloque).toMatch(/if \(r\.error\) throw new Error\(r\.error\.message\)/);
    expect(PAGINA).toMatch(/corridasError/);
  });

  it('la lectura de eval_resultado (por agente) comprueba rr.error, no solo `rr.data ?? []`', () => {
    const bloque = cuerpo("const rr = await admin.from('eval_resultado')", 'porCaso = (rr.data');
    expect(bloque).toMatch(/if \(rr\.error\) throw new Error\(rr\.error\.message\)/);
  });
});
