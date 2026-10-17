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

  // T-A4-46: anexo de factibilidad verificada, con fecha y fuente, sin prometer nada.
  it('el anexo de factibilidad tiene fecha de consulta, fuente con URL y rotula lo NO verificado', () => {
    const anexo = leer(DOC).split('## Anexo: factibilidad verificada')[1] ?? '';
    expect(anexo).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(anexo).toMatch(/documentaci[oó]n/i);
    expect(anexo).toContain('https://developers.facebook.com/documentation/');
    expect(anexo).toMatch(/NO verificado/);
    expect(anexo).toMatch(/servicio al cliente/i);
    expect(anexo).toMatch(/frescura/i);
  });

  it('el anexo no promete estar en los grupos actuales ni leer en vivo', () => {
    const anexo = leer(DOC).split('## Anexo: factibilidad verificada')[1] ?? '';
    expect(anexo).toMatch(/no tiene v[ií]a documentada/i);
    expect(anexo).not.toMatch(/\b(ya est[aá] en|estar[aá] en) (todos )?(los|sus) grupos\b(?!\s+actuales)/i);
  });

  it('el documento no contiene correos, razones sociales ni nombres propios de personas', () => {
    const t = leer(DOC);
    expect(t).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(t).not.toMatch(/\bS\.?\s?A\.?\s+de\s+C\.?V\b/i);
    // Dos palabras seguidas con inicial mayúscula fuera de títulos/tablas/citas de producto = posible nombre de persona.
    const prosa = t
      .split('\n')
      .filter((l) => !/^(#|\||\s*-\s+https?:)/.test(l))
      .join('\n')
      .replace(/«[^»]*»/g, '');
    const candidatos = prosa.match(/(?<![.¿¡:]\s)(?<!^)\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+ [A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\b/gm) ?? [];
    const permitidos = new Set(['Cloud API', 'Official Business', 'Business Account', 'Groups API', 'Multi-solution Conversations']);
    expect(candidatos.filter((c) => !permitidos.has(c))).toEqual([]);
  });
});
