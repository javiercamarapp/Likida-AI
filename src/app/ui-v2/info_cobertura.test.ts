/* eslint-disable security/detect-non-literal-fs-filename -- recorre el árbol del repo con rutas propias */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { INFO, type InfoTexto } from './info-catalogo';

// ═══════════════════════════════════════════════════════════════════════════
// COBERTURA DE ⓘ (L4): cada cifra (`<Cifra>`) y cada recuadro con título de las páginas migradas lleva su ⓘ del catálogo.
//  · `<Cifra …>` sin `info=` falla.
//  · En un archivo con `MarcoPagina`, un `<h2>` / `<h3>` suelto falla: el título de un recuadro es `<TituloRecuadro info=…>` (o `Tarjeta
//    info=…`). Si de verdad no es el título de un recuadro (p. ej. el de un diálogo), se marca en la línea anterior o en la misma con
//    `sin-info: <motivo>` dentro de un comentario.
//  · Ninguna entrada nueva del catálogo queda `por_confirmar` (solo las dos del Resumen que ya estaban).
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = join(process.cwd(), 'src/app/dashboard');
function tsx(dir: string, salida: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const r = join(dir, n);
    if (statSync(r).isDirectory()) { tsx(r, salida); continue; }
    if (n.endsWith('.tsx') && !/\.test\./.test(n)) salida.push(r);
  }
  return salida;
}
const todos = tsx(RAIZ).map((f) => ({ f, ruta: relative(RAIZ, f), src: readFileSync(f, 'utf8') }));

/** Etiquetas JSX `<Nombre … >` completas (con llaves anidadas), para mirar sus atributos. */
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

describe('ⓘ: cobertura de cifras y recuadros en las páginas migradas', () => {
  it('toda <Cifra> lleva info=', () => {
    const faltan = todos.flatMap(({ ruta, src }) => etiquetas(src, 'Cifra').filter((t) => !/\binfo=/.test(t)).map((t) => `${ruta}: ${t.slice(0, 70).replace(/\s+/g, ' ')}`));
    expect(faltan, `Cifras sin ⓘ (${faltan.length}):\n${faltan.join('\n')}`).toEqual([]);
  });

  it('en las páginas con MarcoPagina no hay <h2>/<h3> sueltos (usa TituloRecuadro, Tarjeta o sin-info: motivo)', () => {
    const sueltos: string[] = [];
    for (const { ruta, src } of todos) {
      if (!src.includes('MarcoPagina')) continue;
      const lineas = src.split('\n');
      lineas.forEach((l, i) => {
        if (!/<h[23][\s>]/.test(l)) return;
        if (/sin-info:/.test(l) || /sin-info:/.test(lineas[i - 1] ?? '')) return;
        sueltos.push(`${ruta}:${i + 1}: ${l.trim().slice(0, 80)}`);
      });
    }
    expect(sueltos, `Títulos de recuadro sin ⓘ (${sueltos.length}):\n${sueltos.join('\n')}`).toEqual([]);
  });

  it('el catálogo no gana textos por_confirmar (solo los dos del Resumen)', () => {
    const pend = (Object.entries(INFO) as Array<[string, InfoTexto]>).filter(([, t]) => t.estado === 'por_confirmar').map(([k]) => k).sort();
    expect(pend).toEqual(['resumen.a_tiempo', 'resumen.diferencias_recuperado']);
  });

  it('toda clave nueva (fuera de «resumen.») sigue la forma <pagina>.<recuadro> y su título coincide con el nombre accesible', () => {
    for (const [k, t] of Object.entries(INFO) as Array<[string, InfoTexto]>) {
      expect(k.split('.').length, k).toBeGreaterThan(1);
      for (const parte of k.split('.')) expect(parte, k).toMatch(/^[a-z0-9_-]+$/);
      expect(t.titulo.trim().length, k).toBeGreaterThan(3);
      expect(t.queEs, k).not.toMatch(/\n/);
      expect(t.queEs.length, k).toBeLessThanOrEqual(110);
      // Tono de guía (ANEXO C): sin exclamaciones, sin emojis.
      for (const campo of [t.queEs, t.comoSeCalcula, t.fuente, t.queHacer ?? '']) expect(campo, k).not.toMatch(/[!¡]|\p{Extended_Pictographic}/u);
    }
  });
});
