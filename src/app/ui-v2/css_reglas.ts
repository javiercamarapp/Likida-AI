// Utilidad de pruebas: lista las reglas de un CSS que NO cuelgan de [data-ui="v2"] (las que tocan a v1).
// Cada regla = «selector { cuerpo normalizado }»; @media se aplana como «@media (...) » + selector.
// Se ignoran bloques :root/html:root (tokens) y @keyframes (inocuos sin una clase que los use).
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

function bloques(s: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    const j = s.indexOf('{', i);
    if (j < 0) break;
    let d = 1, k = j + 1;
    while (d > 0 && k < s.length) { if (s[k] === '{') d++; else if (s[k] === '}') d--; k++; }
    out.push([norm(s.slice(i, j)), s.slice(j + 1, k - 1)]);
    i = k;
  }
  return out;
}

/** Divide una lista de selectores por comas de nivel 0 (respeta :is(a, b) y [attr="a,b"]). */
function dividir(sel: string): string[] {
  const out: string[] = [];
  let d = 0, cur = '';
  for (const ch of sel) {
    if (ch === '(' || ch === '[') d++; else if (ch === ')' || ch === ']') d--;
    if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

export function reglasSinAmbito(css: string, prefijo = ''): string[] {
  const salida: string[] = [];
  for (const [sel, cuerpo] of bloques(sinComentarios(css))) {
    if (/^@media|^@supports/.test(sel)) { salida.push(...reglasSinAmbito(cuerpo, `${prefijo}${sel} `)); continue; }
    if (/^@keyframes|^@font-face/.test(sel) || /^:root|^html:root/.test(sel)) continue;
    const libres = dividir(sel).filter((x) => !x.includes('data-ui="v2"'));
    if (libres.length) salida.push(`${prefijo}${libres.join(', ')} { ${norm(cuerpo)} }`);
  }
  return salida;
}
