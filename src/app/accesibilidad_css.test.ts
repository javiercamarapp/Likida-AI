/* eslint-disable security/detect-non-literal-fs-filename -- recorre el fuente del propio repo; ninguna ruta viene de entrada de usuario. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

// F8 / CT-PAR-11: el respaldo de accesibilidad de globals.css no se pierde en una limpieza.
const css = readFileSync(join(__dirname, 'globals.css'), 'utf8');
const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('respaldo de accesibilidad en globals.css', () => {
  it('los campos de texto tienen anillo de foco con 2 px de contorno', () => {
    const bloque = sinComentarios.match(/input:not\([^{]*:focus-visible[^{]*\{[^}]*\}/);
    expect(bloque, 'falta la regla de :focus-visible para input/select/textarea').not.toBeNull();
    expect(bloque![0]).toContain('outline: 2px solid var(--ink)');
    expect(bloque![0]).toContain('textarea:not([data-anillo="envolvente"]');
  });
  it('excluye los campos que no son cuadro de texto, para no pintar anillo en casillas ni botones', () => {
    for (const t of ['checkbox', 'radio', 'file', 'range', 'hidden', 'submit']) expect(sinComentarios).toContain(`[type="${t}"]`);
  });
  it('pulse/bounce/ping se apagan con reduced-motion y spin NO (indicador esencial)', () => {
    const m = sinComentarios.match(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.animate-pulse[^}]*\}/);
    expect(m).not.toBeNull();
    expect(m![0]).not.toContain('animate-spin');
    for (const c of ['animate-pulse', 'animate-bounce', 'animate-ping']) expect(m![0]).toContain(c);
  });
});

// ── R4: la regla de foco visible se escribe por INTENCIÓN, no por nombres de clase de Tailwind ─────────────────────────────
// Antes excluía `.sr-only`, `.bg-transparent` y `.border-0`: si Tailwind renombra o alguien reescribe esas clases, el anillo de
// foco aparece donde no debe o desaparece donde debe, y nada lo avisa. Ahora la exclusión es `[data-anillo="envolvente"]` (el campo
// pinta su anillo en el contenedor) y `label:has(> input[data-foco="etiqueta"])` (el campo oculto lo pinta su etiqueta).
const CLASE_DE_TAILWIND = /\.(?:sr-only|bg-[\w-]+|border[\w-]*|outline[\w-]*|ring[\w-]*|text-[\w-]+|p[xytblr]?-\d+|m[xytblr]?-\d+|w-[\w-]+|h-[\w-]+|flex|grid|hidden|block|rounded[\w-]*|animate-[\w-]+)(?![\w-])/;

describe('regla de foco visible por intención (R4)', () => {
  const reglasDeFoco = [...sinComentarios.matchAll(/([^{}]*:focus-visible[^{}]*)\{/g)].map((m) => m[1].trim());

  it('hay reglas de :focus-visible y NINGUNA se apoya en un nombre de clase de Tailwind', () => {
    expect(reglasDeFoco.length).toBeGreaterThanOrEqual(4);
    const usan = reglasDeFoco.filter((sel) => CLASE_DE_TAILWIND.test(sel));
    expect(usan).toEqual([]);
  });

  it('el control negativo atrapa un selector que sí dependería de Tailwind', () => {
    expect(CLASE_DE_TAILWIND.test('input:not(.sr-only, .bg-transparent):focus-visible')).toBe(true);
    expect(CLASE_DE_TAILWIND.test('label:has(> input.sr-only:focus-visible)')).toBe(true);
    expect(CLASE_DE_TAILWIND.test('.sb-aside a:focus-visible')).toBe(false);
    expect(CLASE_DE_TAILWIND.test('input:not([data-anillo="envolvente"]):focus-visible')).toBe(false);
  });

  it('el aspecto no cambia: mismo contorno de 2 px y mismo desplazamiento', () => {
    const regla = sinComentarios.match(/input:not\(\[data-anillo="envolvente"\][^{]*\{([^}]*)\}/);
    expect(regla).not.toBeNull();
    expect(regla![1].replace(/\s+/g, ' ').trim()).toBe('outline: 2px solid var(--ink); outline-offset: 2px;');
    expect(sinComentarios).toMatch(/label:has\(> input\[data-foco="etiqueta"\]:focus-visible\)\s*\{\s*outline: 3px solid var\(--accent, var\(--marca\)\);\s*outline-offset: 2px;/);
  });

  // La exclusión por atributo solo sirve si los campos que antes se excluían por clase llevan el atributo.
  function tsx(dir: string, acc: string[] = []): string[] {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) { tsx(p, acc); continue; }
      if (/\.tsx$/.test(n) && !/\.test\./.test(n)) acc.push(p);
    }
    return acc;
  }
  const quitaFile = (t: string) => t.replace(/file:[\w-]+/g, '');

  function camposMarcables(codigo: string, nombre: string) {
    const sf = ts.createSourceFile(nombre, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    // Constantes de cadena del mismo archivo (`const inputCss = '...'`): un className que llega por identificador o plantilla
    // se expande a su texto, para que la regla no dependa de que la clase esté escrita literalmente en el JSX.
    const constantes = new Map<string, string>();
    const reunir = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer
        && (ts.isStringLiteral(n.initializer) || ts.isNoSubstitutionTemplateLiteral(n.initializer))) {
        constantes.set(n.name.text, n.initializer.text);
      }
      ts.forEachChild(n, reunir);
    };
    reunir(sf);
    const expandir = (t: string): string => {
      let out = t;
      for (let i = 0; i < 3; i++) for (const [k, v] of constantes) out = out.replace(new RegExp(`\\b${k}\\b`, 'g'), ` '${v}' `);
      return out;
    };
    const hallados: { linea: number; transparente: boolean; ocultoVisual: boolean; anillo: boolean; foco: boolean }[] = [];
    const visitar = (n: ts.Node): void => {
      if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && ['input', 'select', 'textarea'].includes(n.tagName.getText())) {
        const attrs = n.attributes.properties.filter(ts.isJsxAttribute);
        const cn = attrs.find((a) => a.name.getText() === 'className');
        const t = cn?.initializer ? quitaFile(expandir(cn.initializer.getText())) : '';
        hallados.push({
          linea: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
          // Transparente y SIN borde propio: el anillo debe pintarlo el contenedor. Un campo transparente pero con borde
          // visible (`hairline`, `border`) sí lleva el anillo del campo y no necesita el atributo.
          transparente: /(^|[\s'"])border-0(?=[\s'"])/.test(t)
            || (/(^|[\s'"])bg-transparent(?=[\s'"])/.test(t) && !/(^|[\s'"])(hairline|border|border-[a-z]+)(?=[\s'"])/.test(t)),
          ocultoVisual: /(^|[\s'"])sr-only(?=[\s'"])/.test(t),
          anillo: attrs.some((a) => a.name.getText() === 'data-anillo'),
          foco: attrs.some((a) => a.name.getText() === 'data-foco'),
        });
      }
      ts.forEachChild(n, visitar);
    };
    visitar(sf);
    return hallados;
  }

  it('todo campo transparente y sin borde declara data-anillo; todo campo sr-only declara data-foco', () => {
    const raiz = join(process.cwd(), 'src');
    const sinMarca: string[] = [];
    let transparentes = 0;
    let ocultos = 0;
    for (const f of tsx(raiz)) {
      for (const c of camposMarcables(readFileSync(f, 'utf8'), f)) {
        if (c.transparente) { transparentes++; if (!c.anillo) sinMarca.push(`${relative(process.cwd(), f)}:${c.linea} falta data-anillo="envolvente"`); }
        if (c.ocultoVisual) { ocultos++; if (!c.foco) sinMarca.push(`${relative(process.cwd(), f)}:${c.linea} falta data-foco="etiqueta"`); }
      }
    }
    expect(transparentes).toBeGreaterThanOrEqual(10);
    expect(ocultos).toBeGreaterThanOrEqual(3);
    expect(sinMarca).toEqual([]);
  });

  it('resuelve className por constante del mismo archivo y no exige atributo a un campo transparente con borde visible', () => {
    const sinBorde = camposMarcables("const css = 'px-2 bg-transparent border-0'; export const A = () => <input className={`${css} w-full`} />;", 'x.tsx');
    expect(sinBorde[0].transparente && !sinBorde[0].anillo).toBe(true);
    const conBorde = camposMarcables("const css = 'hairline rounded-lg bg-transparent'; export const A = () => <input className={`${css} w-full`} />;", 'x.tsx');
    expect(conBorde[0].transparente).toBe(false);
  });

  it('control negativo: el detector marca un campo transparente sin atributo', () => {
    const c = camposMarcables('export const A = () => <input className="bg-transparent border-0" />;', 'x.tsx');
    expect(c).toHaveLength(1);
    expect(c[0].transparente && !c[0].anillo).toBe(true);
  });
});
