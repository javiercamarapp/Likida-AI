/* eslint-disable security/detect-non-literal-fs-filename -- recorre el árbol del repo con rutas propias */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BASE_SIN_TRAZO, BASE_TRAZO_MEZCLADO } from './iconos_trazo_base';

// ═══════════════════════════════════════════════════════════════════════════
// GUARDA DE ICONOS (L7): un solo grosor de trazo. Vexa dibuja TODOS sus iconos en una rejilla de 24 con trazo 1.75 (`icons.tsx`);
// Likida mezclaba 1.25 / 1.5 / 2 / 2.5 / 3 sobre lucide. Código nuevo: solo `<Icono>` (ui-v2/componentes/icono.tsx), que fija 1.75
// y los tamaños 14/16/18/20, o un icono de lucide SIN `strokeWidth` propio distinto de 1.75.
// `strokeWidth={TRAZO_ICONO}` (la constante de icono.tsx, 1.75) cuenta como válido. OJO: un icono de lucide SIN `strokeWidth` se dibuja a 2
// (el valor por omisión de lucide), no a 1.75: por eso hay un segundo trinquete para los iconos sin grosor declarado en código nuevo.
// Trinquete: los archivos de la base conservan su deuda y no pueden crecer; un archivo nuevo con grosor distinto, falla.
// Al migrar un archivo a 1.75 se borra su línea de `iconos_trazo_base.ts` (si ya está limpio y sigue en la lista, también falla).
// ═══════════════════════════════════════════════════════════════════════════

const SRC = join(process.cwd(), 'src');
function tsx(dir: string, salida: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const r = join(dir, n);
    if (statSync(r).isDirectory()) { if (n !== 'node_modules' && n !== '__fixtures__') tsx(r, salida); continue; }
    if (n.endsWith('.tsx') && !/\.test\.|harness|\.tmp\./.test(n)) salida.push(r);
  }
  return salida;
}

/** Etiquetas JSX `<Nombre …>` completas (con llaves anidadas). */
function etiquetas(src: string, nombre: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${nombre}(?=[\\s/>])`, 'g');
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let d = 0, q: string | null = null, j = m.index;
    for (; j < src.length; j++) {
      const c = src[j];
      if (q) { if (c === '\\') j++; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === '`') q = c;
      else if (c === '{') d++;
      else if (c === '}') d--;
      else if (c === '>' && d === 0) break;
    }
    out.push(src.slice(m.index, j + 1));
  }
  return out;
}

/** Nombres (y alias) importados de lucide-react. */
function nombresLucide(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]lucide-react['"]/g)) {
    for (const parte of m[1].split(',')) {
      const t = parte.replace(/\btype\s+/, '').trim();
      if (!t) continue;
      const alias = /\bas\s+(\w+)$/.exec(t);
      out.push(alias ? alias[1] : t);
    }
  }
  return out;
}

/** Cuántos iconos de lucide del archivo declaran un `strokeWidth` distinto de 1.75 (literal o expresión no verificable). */
export function trazosMezclados(src: string): number {
  let n = 0;
  for (const nombre of nombresLucide(src)) {
    for (const tag of etiquetas(src, nombre)) {
      const m = /strokeWidth\s*=\s*(?:\{\s*([^}]*?)\s*\}|"([^"]*)")/.exec(tag);
      if (!m) continue;
      const v = (m[1] ?? m[2]).replace(/^['"]|['"]$/g, '');
      if (Number(v) !== 1.75 && v !== 'TRAZO_ICONO') n++;
    }
  }
  return n;
}

/** Cuántos iconos de lucide del archivo NO declaran `strokeWidth` (lucide los dibuja a 2, no a 1.75). */
export function trazosSinDeclarar(src: string): number {
  let n = 0;
  for (const nombre of nombresLucide(src)) for (const tag of etiquetas(src, nombre)) if (!/strokeWidth\s*=/.test(tag)) n++;
  return n;
}

describe('iconos: un solo grosor de trazo (1.75)', () => {
  const archivos = tsx(SRC).map((f) => ({ ruta: relative(SRC, f), n: trazosMezclados(readFileSync(f, 'utf8')) }));

  it('el detector ve lo que debe', () => {
    expect(trazosMezclados(`import { Info } from 'lucide-react';\n<Info strokeWidth={2} />`)).toBe(1);
    expect(trazosMezclados(`import { Info as I } from 'lucide-react';\n<I className="x" strokeWidth="1.5" aria-hidden />`)).toBe(1);
    expect(trazosMezclados(`import { Info } from 'lucide-react';\n<Info strokeWidth={1.75} /><Info />`)).toBe(0);
    expect(trazosMezclados(`<svg strokeWidth={2} />`)).toBe(0); // gráficas y SVG propios: no son iconos de lucide
    expect(trazosMezclados(`import { Info } from 'lucide-react';\n<Info strokeWidth={TRAZO_ICONO} />`)).toBe(0);
    expect(trazosSinDeclarar(`import { Info } from 'lucide-react';\n<Info /><Info strokeWidth={1.75} />`)).toBe(1);
  });

  it('ningún archivo fuera de la base declara un grosor distinto de 1.75 en un icono de lucide', () => {
    const nuevos = archivos.filter((a) => a.n > 0 && !(a.ruta in BASE_TRAZO_MEZCLADO)).map((a) => `${a.ruta}: ${a.n}`);
    expect(nuevos, 'usa <Icono> (ui-v2/componentes/icono.tsx) o quita el strokeWidth').toEqual([]);
  });

  it('ningún archivo nuevo dibuja un icono de lucide sin declarar el trazo (a 2 por omisión): usa <Icono> o strokeWidth={1.75}', () => {
    const sin = tsx(SRC).map((f) => ({ ruta: relative(SRC, f), n: trazosSinDeclarar(readFileSync(f, 'utf8')) }));
    expect(sin.filter((a) => a.n > BASE_SIN_TRAZO[a.ruta] || (a.n > 0 && !(a.ruta in BASE_SIN_TRAZO))).map((a) => `${a.ruta}: ${a.n}`)).toEqual([]);
    expect(Object.keys(BASE_SIN_TRAZO).filter((r) => (sin.find((a) => a.ruta === r)?.n ?? 0) === 0), 'ya limpios: bórralos de BASE_SIN_TRAZO').toEqual([]);
  });

  it('la deuda de la base no crece, y los archivos ya limpios salen de la lista', () => {
    const porRuta = new Map(archivos.map((a) => [a.ruta, a.n]));
    const crecen = Object.entries(BASE_TRAZO_MEZCLADO).filter(([r, tope]) => (porRuta.get(r) ?? 0) > tope).map(([r]) => r);
    expect(crecen).toEqual([]);
    const limpios = Object.keys(BASE_TRAZO_MEZCLADO).filter((r) => (porRuta.get(r) ?? 0) === 0);
    expect(limpios, 'ya están limpios: bórralos de iconos_trazo_base.ts').toEqual([]);
  });

  it('ui-v2/componentes y los componentes nuevos de L7 no tienen deuda', () => {
    const deuda = archivos.filter((a) => a.n > 0 && /^app\/ui-v2\/componentes\/(icono|campos|segmented|tabs|status-chip|tabla-base)/.test(a.ruta));
    expect(deuda).toEqual([]);
  });
});
