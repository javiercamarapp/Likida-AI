/* eslint-disable security/detect-non-literal-fs-filename, security/detect-unsafe-regex -- recorre src/app por rutas propias del repo; el patrón corre sobre texto de código local. */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * GUARDA DE FRONTERA servidor → cliente (incidente de producción: /dashboard «No se pudo cargar el panel», digest
 * 2381304822, «Functions cannot be passed directly to Client Components»). `renderToStaticMarkup` NO impone esa frontera,
 * así que ninguna prueba de render lo veía. Aquí se lee el código: un archivo SIN 'use client' que use una gráfica de
 * cliente de `ui-v2/graficas` solo puede pasarle `formato="id"` (string), nunca una función ni un identificador.
 */
const RAIZ = join(__dirname, '..', '..'); // src/app
const GRAFICAS = join(RAIZ, 'ui-v2', 'graficas');

function archivos(dir: string, salida: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) archivos(p, salida);
    else if (/\.tsx$/.test(n) && !/\.test\./.test(n)) salida.push(p);
  }
  return salida;
}

const primeraLinea = (src: string) => src.split('\n').find((l) => l.trim() !== '' && !l.trim().startsWith('//') && !l.trim().startsWith('/*') && !l.trim().startsWith('*'))?.trim() ?? '';
const esCliente = (src: string) => /^['"]use client['"]/.test(primeraLinea(src));

/** Componentes exportados por los archivos 'use client' de ui-v2/graficas, leídos de la primera línea de cada uno. */
export function componentesCliente(): string[] {
  const nombres: string[] = [];
  for (const f of archivos(GRAFICAS)) {
    const src = readFileSync(f, 'utf8');
    if (!esCliente(src)) continue;
    for (const m of src.matchAll(/export\s+(?:default\s+)?(?:function|const)\s+([A-Z]\w*)/g)) nombres.push(m[1]);
  }
  return nombres;
}

/** Texto de cada etiqueta JSX `<Nombre ...>` (hasta su `>` de cierre al nivel 0, respetando llaves y cadenas). */
function etiquetas(src: string, nombres: string[]): Array<{ nombre: string; texto: string; indice: number }> {
  const res: Array<{ nombre: string; texto: string; indice: number }> = [];
  const re = new RegExp(`<(${nombres.join('|')})(?=[\\s/>])`, 'g');
  for (const m of src.matchAll(re)) {
    let i = (m.index ?? 0) + m[0].length;
    let prof = 0;
    let comilla = '';
    for (; i < src.length; i++) {
      const c = src[i];
      if (comilla) { if (c === comilla && src[i - 1] !== '\\') comilla = ''; continue; }
      if (c === '"' || c === "'" || c === '`') comilla = c;
      else if (c === '{') prof++;
      else if (c === '}') prof--;
      else if (c === '>' && prof === 0 && src[i - 1] !== '=') break;
    }
    res.push({ nombre: m[1], texto: src.slice(m.index, i), indice: m.index ?? 0 });
  }
  return res;
}

/** Valores de props `formato*=` que NO son un string literal (ni un ternario de strings literales). */
export function formatosNoSerializables(src: string, nombres: string[]): string[] {
  const malos: string[] = [];
  for (const { nombre, texto } of etiquetas(src, nombres)) {
    for (const m of texto.matchAll(/\bformato\w*=/g)) {
      const resto = texto.slice((m.index ?? 0) + m[0].length);
      if (/^(["'])[^"']*\1/.test(resto)) continue; // formato="numero"
      if (resto.startsWith('{')) {
        let prof = 0, fin = 0;
        for (; fin < resto.length; fin++) { if (resto[fin] === '{') prof++; else if (resto[fin] === '}' && --prof === 0) break; }
        const dentro = resto.slice(1, fin).trim();
        if (/^(["'])\w+\1$/.test(dentro)) continue; // formato={'numero'}
        if (!dentro.includes('=>') && /^[^?:]+\?\s*(["'])\w+\1\s*:\s*(["'])\w+\2$/.test(dentro)) continue; // cond ? 'a' : 'b'
        malos.push(`<${nombre} ${m[0]}{${dentro}}`);
      } else malos.push(`<${nombre} ${m[0]}${resto.slice(0, 20)}`);
    }
  }
  return malos;
}

describe('frontera servidor → cliente: formato de las gráficas', () => {
  const nombres = componentesCliente();

  it('descubre las gráficas de cliente leyendo la primera línea de cada archivo', () => {
    for (const n of ['Columnas', 'ColumnasAgrupadas', 'AreaMini', 'DonaMini']) expect(nombres).toContain(n);
  });

  it('el detector distingue una función de un id (no pasa en falso)', () => {
    expect(formatosNoSerializables('<Columnas formato={numero} />', nombres)).toHaveLength(1);
    expect(formatosNoSerializables('<DonaMini centro={x} formato={(v) => mxn(v)} />', nombres)).toHaveLength(1);
    expect(formatosNoSerializables('<AreaMini formato={a ? mxn : numero} />', nombres)).toHaveLength(1);
    expect(formatosNoSerializables('<Columnas formato="numero" vacio="x" />', nombres)).toHaveLength(0);
    expect(formatosNoSerializables("<AreaMini formato={a === 'x' ? 'mxn' : 'numero'} />", nombres)).toHaveLength(0);
    expect(formatosNoSerializables('<Bullet formato={(v) => String(v)} />', nombres)).toHaveLength(0); // Bullet es de servidor
  });

  it('ningún archivo sin \'use client\' pasa una función como formato a una gráfica de cliente', () => {
    const fallos: string[] = [];
    for (const f of archivos(RAIZ)) {
      const src = readFileSync(f, 'utf8');
      if (esCliente(src)) continue; // cliente → cliente sí puede pasar funciones
      if (!nombres.some((n) => new RegExp(`\\b${n}\\b`).test(src))) continue;
      for (const m of formatosNoSerializables(src, nombres)) fallos.push(`${relative(RAIZ, f)}: ${m}`);
    }
    expect(fallos).toEqual([]);
  });
});
