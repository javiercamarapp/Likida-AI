import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// CT-SEG-22 · `'use server'` anidado: una función con la directiva dentro de un Server Component es una ACCION que el navegador
// puede invocar. `gate()` es un ayudante interno (devuelve tenantId/userId): no debe llevarla. Las acciones reales si.
const fuente = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

function cuerpoDe(nombre: string): string {
  const ini = fuente.indexOf(`async function ${nombre}(`);
  expect(ini).toBeGreaterThan(-1);
  const sig = fuente.indexOf('\n  async function ', ini + 10);
  return fuente.slice(ini, sig === -1 ? undefined : sig);
}

describe('CT-SEG-22 · emergencias: solo las acciones llevan use server', () => {
  it('gate() no lleva la directiva (no es invocable desde el navegador)', () => {
    expect(cuerpoDe('gate')).not.toMatch(/'use server'/);
  });

  it('gate() vive a nivel de modulo (no es closure del componente: Next no serializa funciones capturadas)', () => {
    expect(fuente).toMatch(/^async function gate\(sp: /m);
    expect(fuente).not.toMatch(/^ {2}async function gate\(/m);
  });

  it('las seis acciones reales la conservan y todas pasan por gate()', () => {
    for (const a of ['altaProveedor', 'verificarProveedor', 'borrarProveedor', 'guardarPolizaAction', 'altaContacto', 'borrarContacto']) {
      const c = cuerpoDe(a);
      expect(c).toMatch(/'use server'/);
      expect(c).toMatch(/await gate\(sp, tenantId\)/);
    }
  });
});
