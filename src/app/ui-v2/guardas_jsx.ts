// Extractor compartido por las guardas de arquitectura de ui-v2 (iconos_trazo.test.ts y controles_gruesos_guarda.test.ts).

/** Etiquetas JSX `<Nombre …>` completas (con llaves anidadas y cadenas). `nombre` admite una expresión regular (p. ej. `button`). */
export function etiquetas(src: string, nombre: string): string[] {
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
