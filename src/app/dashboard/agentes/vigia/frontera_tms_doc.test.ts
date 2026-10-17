/* eslint-disable security/detect-non-literal-fs-filename -- prueba que lee rutas del propio repo; ninguna ruta viene de entrada de usuario. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// T-A4-48: la frontera con el TMS está decidida por escrito y no promete «sin intervención» sin citar el escenario elegido.
const DOC = 'docs/operacion/vigia-frontera-tms.md';
const leer = () => readFileSync(join(process.cwd(), DOC), 'utf8');

/** Líneas que prometen automatización: «sin intervención», «automático/a/mente», «desaparece». */
const PROMESA = /sin intervenci[oó]n|autom[aá]tic[oa]s?|autom[aá]ticamente|desaparece/i;
const ESCENARIO = /escenario\s*\((a|b|c)\)/i;

describe('frontera con el TMS', () => {
  it('toda promesa de automatización cita un escenario por nombre', () => {
    // un «párrafo» es un viñeta, una fila o un bloque de texto: las líneas partidas se unen para no esconder la promesa
    const parrafos = leer().split(/\n(?=- |\d+\. |\||#|\n)/).map((p) => p.replace(/\n+/g, ' ').trim());
    const lineas = parrafos.filter((l) => PROMESA.test(l));
    expect(lineas.length).toBeGreaterThan(0);
    for (const l of lineas) {
      if (/^\|/.test(l)) continue; // las filas de la matriz describen el escenario de su fila
      expect(l, l).toMatch(ESCENARIO);
    }
  });

  it('el detector falla con una promesa sin escenario', () => {
    const mala = 'El correo sale sin intervención del equipo.';
    expect(PROMESA.test(mala) && !ESCENARIO.test(mala)).toBe(true);
  });

  it('compara los tres escenarios y recomienda uno explícito', () => {
    const t = leer();
    for (const e of ['(a)', '(b)', '(c)']) expect(t).toMatch(new RegExp(`\\|\\s*${e.replace(/[\\()]/g, '\\$&')}\\s*\\|`));
    expect(t).toMatch(/### Recomendaci[oó]n/);
    expect(t).toMatch(/\*\*\(a\) para lo que ya esté en el sistema y \(b\) como respaldo/);
    expect(t).toMatch(/no se borra/i);
  });

  it('tiene entre 1 y 5 preguntas numeradas y marca lo no verificado', () => {
    const t = leer();
    const seccion = t.split('## Preguntas')[1]?.split('\n## ')[0] ?? '';
    const n = seccion.split('\n').filter((l) => /^\d+\.\s/.test(l)).length;
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(5);
    expect(t).toMatch(/NO verificado/i);
  });

  it('cada pregunta lleva una fecha calendario concreta (AAAA-MM-DD)', () => {
    const seccion = leer().split('## Preguntas')[1]?.split('\n## ')[0] ?? '';
    // una pregunta puede partirse en varias líneas: se une cada ítem numerado con sus líneas de continuación
    const items = seccion.split(/\n(?=\d+\.\s)/).filter((l) => /^\d+\.\s/.test(l.trim()));
    expect(items.length).toBeGreaterThan(0);
    for (const q of items) expect(q, q).toMatch(/\b20\d{2}-\d{2}-\d{2}\b/);
  });

  it('no promete fecha de sistemas', () => {
    const t = leer();
    expect(t).toMatch(/No se promete fecha de sistemas/);
  });
});
