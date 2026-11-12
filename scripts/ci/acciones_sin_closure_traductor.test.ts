// Una Server Action INLINE ('use server' dentro de una función de página) que usa un traductor del componente lo captura por
// closure; Next lo serializa en encryptActionBoundArgs y las funciones no se pueden serializar: la página entera revienta en
// producción con «Functions cannot be passed directly to Client Components» (en dev y en pruebas de unidad NO se ve).
// La acción debe pedir su propio traductor: `const { t } = await getT('ns')` como primera línea tras la directiva.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ = join(__dirname, '..', '..');
const NOMBRES = ['t', 'tr', 'tx', 'ta', 'tra', 'ts', 'tl', 'tMon', 'tSis'];

function archivos(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) archivos(p, acc);
    else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) acc.push(p);
  }
  return acc;
}

/** Hallazgos «archivo:línea usa X» de las acciones inline que usan un traductor sin declararlo ni recibirlo. */
export function capturasDeTraductor(fuente: string): string[] {
  const L = fuente.split('\n');
  const fallos: string[] = [];
  L.forEach((l, i) => {
    const m = /^(\s+)'use server';?\s*$/.exec(l);
    if (!m) return;
    const ind = m[1].length - 2;
    let s = i;
    while (s > 0 && !(L[s].length - L[s].trimStart().length === ind && L[s].trim())) s--;
    let e = i + 1;
    while (e < L.length && !(L[e].length - L[e].trimStart().length === ind && /^[})]/.test(L[e].trim()))) e++;
    const cuerpo = L.slice(i + 1, e + 1).join('\n');
    const cabeza = L.slice(s, i).join('\n');
    for (const n of NOMBRES) {
      const usa = new RegExp(`(?<![\\w.$])${n}\\(`).test(cuerpo) || new RegExp(`[(,=:]\\s*${n}\\s*[,)]`).test(cuerpo);
      if (!usa) continue;
      const declara = new RegExp(`(const|let)\\s*\\{[^}]*\\b${n}\\b[^}]*\\}\\s*=`).test(cuerpo) || new RegExp(`\\bconst ${n}\\b`).test(cuerpo)
        || new RegExp(`[(,]\\s*${n}\\s*[:,)][^\\n]*=>|\\b${n}\\s*=>`).test(cuerpo);
      const recibe = new RegExp(`[(,]\\s*${n}\\s*[:,)]`).test(cabeza);
      if (!declara && !recibe) fallos.push(`línea ${s + 1} usa «${n}» capturado por closure`);
    }
  });
  return fallos;
}

describe('acciones inline sin traductor capturado por closure', () => {
  it('sanidad: detecta la captura y acepta el traductor propio', () => {
    const malo = ["async function P() {", "  const { t } = await getT('resto');", "  async function a(fd: FormData) {", "    'use server';", "    return t('x.y');", "  }", "}"].join('\n');
    const bueno = ["async function P() {", "  const { t } = await getT('resto');", "  async function a(fd: FormData) {", "    'use server';", "    const { t } = await getT('resto');", "    return t('x.y');", "  }", "}"].join('\n');
    expect(capturasDeTraductor(malo)).toHaveLength(1);
    expect(capturasDeTraductor(bueno)).toEqual([]);
  });
  it('ninguna página de src/app captura un traductor en una acción inline', () => {
    const hallazgos: string[] = [];
    for (const f of archivos(join(RAIZ, 'src', 'app'))) {
      const txt = readFileSync(f, 'utf8');
      if (!txt.includes("'use server'")) continue;
      for (const h of capturasDeTraductor(txt)) hallazgos.push(`${relative(RAIZ, f)}: ${h}`);
    }
    expect(hallazgos).toEqual([]);
  });
});
