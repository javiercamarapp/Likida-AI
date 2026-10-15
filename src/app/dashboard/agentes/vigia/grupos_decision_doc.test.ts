/* eslint-disable security/detect-non-literal-fs-filename -- prueba que lee/escribe rutas del propio repo o de un directorio temporal; ninguna ruta ni patrón viene de entrada de usuario. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// T-A4-33: la decisión sobre grupos de WhatsApp está documentada y NO promete lectura de grupos en vivo.
const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), 'utf8');
const DOC = 'docs/operacion/vigia-grupos-decision.md';

describe('decisión de grupos: no se promete nada', () => {
  it('«en vivo» solo aparece negado', () => {
    const lineas = leer(DOC).split('\n').filter((l) => /en vivo/i.test(l));
    for (const l of lineas) expect(l, l).toMatch(/\b(no|nunca|ni|sin)\b/i);
  });

  it('dice que hoy no se promete, lista las opciones a-d con la d descartada y marca lo no verificado', () => {
    const t = leer(DOC);
    expect(t).toMatch(/hoy no se promete/i);
    expect(t).toMatch(/\|\s*d\s*\|[^\n]*\*\*Descartada\*\*/);
    for (const o of ['a', 'b', 'c']) expect(t).toMatch(new RegExp(`\\|\\s*${o}\\s*\\|`));
    expect(t).toMatch(/NO verificado/i);
  });

  it('tiene entre 1 y 6 preguntas numeradas', () => {
    const seccion = leer(DOC).split('## Preguntas')[1]?.split('\n## ')[0] ?? '';
    const n = seccion.split('\n').filter((l) => /^\d+\.\s/.test(l)).length;
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(6);
  });

  it('la guía de operación enlaza la decisión y dice «hoy no se promete»', () => {
    const g = leer('docs/operacion/vigia-cliente.md');
    expect(g).toContain('vigia-grupos-decision.md');
    expect(g).toMatch(/hoy no se promete/i);
  });
});
