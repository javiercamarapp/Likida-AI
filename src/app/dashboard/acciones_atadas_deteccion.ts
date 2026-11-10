// Detector compartido de las pruebas de arquitectura MX-002 (acciones_atadas_arquitectura.test.ts y
// acciones_atadas_resto_arquitectura.test.ts): enumera las server actions de un archivo y dice cuales no llegan a la guarda.
export const GUARDA = /\b(resolverTenantAtadoAccion|resolverTenantAtadoFirmado|resolverTenantAtadoOLanza|resolverTenantAtado|exigirFlotaPintada)\(/;

function cuerpoDesde(f: string, desde: number): string {
  const abre = f.indexOf('{', desde);
  if (abre < 0) return '';
  let prof = 0;
  for (let i = abre; i < f.length; i++) {
    if (f[i] === '{') prof++;
    else if (f[i] === '}') { prof--; if (prof === 0) return f.slice(abre, i + 1); }
  }
  return f.slice(abre);
}
export function cuerpoDeFuncion(f: string, trasNombre: number): string {
  const a = f.indexOf('(', trasNombre);
  if (a < 0) return '';
  let p = 0, i = a;
  for (; i < f.length; i++) { if (f[i] === '(') p++; else if (f[i] === ')') { p--; if (p === 0) break; } }
  let ang = 0;
  for (let j = i + 1; j < f.length; j++) {
    const c = f[j];
    if (c === '<') ang++;
    else if (c === '>' && f[j - 1] !== '=') ang--;
    else if (c === '{' && ang <= 0) return cuerpoDesde(f, j);
  }
  return '';
}
export const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Escapa todo metacarácter de expresión regular (incluida la barra invertida) de un nombre que se inserta en un RegExp. */
function escaparRegex(t: string): string {
  return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Acciones (nombre) del archivo que no llegan a la guarda, directo o por un ayudante del mismo archivo. */
export function accionesSinGuarda(fuenteCruda: string): string[] {
  const fuente = sinComentarios(fuenteCruda);
  const cuerpos = new Map<string, string>();
  for (const m of fuente.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)) cuerpos.set(m[1], cuerpoDeFuncion(fuente, m.index! + m[0].length));
  const llega = (cuerpo: string, visto: Set<string>): boolean => {
    if (GUARDA.test(cuerpo)) return true;
    for (const [n, c] of cuerpos) {
      if (visto.has(n) || !new RegExp(`\\b${escaparRegex(n)}\\s*\\(`).test(cuerpo)) continue;
      visto.add(n);
      if (llega(c, visto)) return true;
    }
    return false;
  };
  const sin: string[] = [];
  if (/^\s*['"]use server['"]/.test(fuente)) {
    for (const m of fuente.matchAll(/export\s+async\s+function\s+([A-Za-z_$][\w$]*)/g)) {
      if (!llega(cuerpoDeFuncion(fuente, m.index! + m[0].length), new Set([m[1]]))) sin.push(m[1]);
    }
    return sin;
  }
  for (const m of fuente.matchAll(/^[ \t]*['"]use server['"];/gm)) {
    const d = [...fuente.slice(0, m.index).matchAll(/function\s+([A-Za-z_$][\w$]*)/g)].pop();
    if (!d) { sin.push('(directiva sin función)'); continue; }
    if (!llega(cuerpoDeFuncion(fuente, d.index! + d[0].length), new Set([d[1]]))) sin.push(d[1]);
  }
  return sin;
}
export function totalAcciones(fuenteCruda: string): number {
  const f = sinComentarios(fuenteCruda);
  return /^\s*['"]use server['"]/.test(f) ? [...f.matchAll(/export\s+async\s+function\s+/g)].length : [...f.matchAll(/^[ \t]*['"]use server['"];/gm)].length;
}

