import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CARGADORES, NAMESPACES } from './catalogo';
import { IDIOMAS } from './idioma';
import { variablesDe } from './traducir';

// ═══════════════════════════════════════════════════════════════════════════
// i18n_paridad — es y en dicen LO MISMO con las MISMAS piezas (PLAN-I18N §4, guarda 1).
//
// El compilador ya exige las mismas claves (`en` es `Record<keyof typeof es, string>`), pero no ve el texto: esta prueba mira los
// VALORES. Una `{variable}` que falta en inglés se imprime como `{n}` o desaparece; un plural sin pareja da «1 pendientes».
// Recorre el catálogo (no una lista a mano) y exige que cada archivo de diccionario esté registrado en él.
// ═══════════════════════════════════════════════════════════════════════════

/** Palabras con acento que SÍ pueden aparecer en inglés: nombres propios y el nombre de cada idioma en su idioma. */
const NOMBRES_PROPIOS = ['Español', 'México', 'Querétaro', 'Nuevo León', 'Yucatán', 'Michoacán', 'San Luis Potosí', 'Jalisco'];
const ACENTOS = /[áéíóúüñ¿¡]/i;

function sinPropios(texto: string): string {
  return NOMBRES_PROPIOS.reduce((t, n) => t.split(n).join(''), texto);
}
function etiquetasHtml(texto: string): string[] {
  return [...texto.matchAll(/<\/?[a-z][a-z0-9]*[^>]*>/gi)].map((m) => m[0].replace(/\s+.*>/, '>')).sort();
}

describe('el catálogo coincide con el disco', () => {
  it('cada archivo es/<ns>.ts tiene su en/<ns>.ts y su registro en NAMESPACES (y al revés)', () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const en = (d: string) => readdirSync(join(process.cwd(), 'src/lib/i18n', d)).filter((f) => f.endsWith('.ts')).map((f) => f.replace(/\.ts$/, '')).sort();
    expect(en('es')).toEqual([...NAMESPACES].sort());
    expect(en('en')).toEqual([...NAMESPACES].sort());
  });

  it('los dos idiomas tienen cargador para el mismo conjunto de namespaces', () => {
    for (const idioma of IDIOMAS) expect(Object.keys(CARGADORES[idioma]).sort()).toEqual([...NAMESPACES].sort());
  });
});

describe.each(NAMESPACES)('namespace «%s»: paridad es / en', (ns) => {
  it('mismas claves, mismas {variables}, sin textos vacíos', async () => {
    const es = (await CARGADORES.es[ns]()) as Record<string, string>;
    const en = (await CARGADORES.en[ns]()) as Record<string, string>;

    expect(Object.keys(en).sort(), 'claves distintas entre es y en').toEqual(Object.keys(es).sort());
    for (const clave of Object.keys(es)) {
      expect(es[clave].trim(), `${ns}.${clave} (es) vacío`).not.toBe('');
      expect(en[clave].trim(), `${ns}.${clave} (en) vacío`).not.toBe('');
      expect(variablesDe(en[clave]).sort(), `${ns}.${clave}: variables distintas`).toEqual(variablesDe(es[clave]).sort());
      expect(etiquetasHtml(en[clave]), `${ns}.${clave}: etiquetas HTML distintas`).toEqual(etiquetasHtml(es[clave]));
    }
  });

  it('el inglés no trae acentos ni ¿¡ (salvo nombres propios)', async () => {
    const en = (await CARGADORES.en[ns]()) as Record<string, string>;
    const malos = Object.entries(en).filter(([, v]) => ACENTOS.test(sinPropios(v))).map(([k, v]) => `${k}: ${v}`);
    expect(malos).toEqual([]);
  });

  it('plurales: toda clave .uno tiene su .otros y al revés, en los dos idiomas, y ambas llevan {n}', async () => {
    for (const idioma of IDIOMAS) {
      const dic = (await CARGADORES[idioma][ns]()) as Record<string, string>;
      for (const clave of Object.keys(dic)) {
        const m = /^(.*)\.(uno|otros)$/.exec(clave);
        if (!m) continue;
        const pareja = `${m[1]}.${m[2] === 'uno' ? 'otros' : 'uno'}`;
        expect(dic, `${idioma}/${ns}: ${clave} sin ${pareja}`).toHaveProperty(pareja);
        expect(variablesDe(dic[clave]), `${idioma}/${ns}.${clave} sin {n}`).toContain('n');
      }
    }
  });
});
