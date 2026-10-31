import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// GUARDA «SIN AZUL DE INTERFAZ» (L9a, decisión de Javier 31-oct-2026: «lo azul, por la paleta negro/gris/blanco»).
//
// El cromo de v2 (tokens, shell, componentes, overlays, carga, movimiento, marco público), /login y las páginas públicas
// no pueden tener azul: ni clases de Tailwind blue/sky/indigo/cyan/violet/navy, ni los azules históricos (#0B5FFF, #1F4FB0,
// #E6EDFA fuera de la serie de datos), ni un hex de matiz azul. El azul SOLO vive en los colores de DATOS: la serie de 8
// matices (`--chart-N`, `--soft-N`, `--ink-N`, `--on-N`), las gráficas y el logotipo de Google (obligatorio por su marca).
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = join(__dirname, '..');
const ARCHIVOS_EN_ALCANCE = [
  'ui-v2/tokens.css', 'ui-v2/shell.css', 'ui-v2/componentes.css', 'ui-v2/overlay.css', 'ui-v2/carga.css', 'ui-v2/movimiento.css',
  'ui-v2/paginas.css', 'ui-v2/marco-publico.css', 'ui-v2/fonts.css', 'ui-v2/componentes/marco-publico.tsx',
  'login/login.css', 'login/vista-login.tsx', 'login/page.tsx',
  'sin-acceso/page.tsx', 'cuenta/page.tsx', 'not-found.tsx', 'global-error.tsx', 'legal/marco.tsx',
  'privacidad/page.tsx', 'terminos/page.tsx', 'seguridad/page.tsx', 'estado/page.tsx', 'demo/page.tsx',
  'calculadora/page.tsx', 'calculadora/calc.tsx', 'blog/page.tsx', 'blog/[slug]/page.tsx', 'pago/[token]/page.tsx',
  'pago/[token]/forma.tsx', 'mcp/autorizar/page.tsx', 'aviso/prospectos/page.tsx', 'aviso/[tenant]/page.tsx',
];
const CARPETAS_CROMO = ['dashboard/shell'];

function archivosDe(dir: string): string[] {
  return readdirSync(join(RAIZ, dir)).flatMap((n) => {
    const rel = `${dir}/${n}`;
    if (statSync(join(RAIZ, rel)).isDirectory()) return archivosDe(rel);
    return /\.(tsx|css)$/.test(n) && !/\.test\./.test(n) ? [rel] : [];
  });
}

const TAILWIND_AZUL = /\b(?:text|bg|border|ring|from|to|via|fill|stroke|outline|decoration|divide|accent|shadow|placeholder|caret)-(?:blue|sky|indigo|cyan|violet|navy)-\d{2,3}\b/;
const NOMBRES_AZUL = /--(?:marino|azul|petroleo|tint-azul)\b|#0b5fff|#1f4fb0/i;
// Línea de la serie de datos (permitida): `--chart-1: …`, `--soft-3: …`, `--ink-5: …`, `--on-2: …`.
const SERIE_DATOS = /--(?:chart|soft|ink|on)-\d\s*:/;
// Marca de terceros que no se puede recolorear (logotipo de Google).
const MARCA_TERCEROS = /#4285F4/;

function esHexAzul(hex: string): boolean {
  const h = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return false;
  const s = (max - min) / max;
  let tono: number;
  if (max === r) tono = (((g - b) / (max - min)) % 6) / 6;
  else if (max === g) tono = ((b - r) / (max - min) + 2) / 6;
  else tono = ((r - g) / (max - min) + 4) / 6;
  if (tono < 0) tono += 1;
  return tono >= 0.5 && tono <= 0.72 && s >= 0.22 && max > 0.2;
}

describe('sin azul de interfaz en el cromo v2, /login y las páginas públicas', () => {
  const todos = [...ARCHIVOS_EN_ALCANCE, ...CARPETAS_CROMO.flatMap(archivosDe)];

  it('el alcance existe (no se guarda un archivo que ya no está)', () => {
    for (const f of ARCHIVOS_EN_ALCANCE) expect(() => readFileSync(join(RAIZ, f), 'utf8'), f).not.toThrow();
  });

  for (const f of todos) {
    it(`${f}: sin azul de interfaz`, () => {
      const lineas = readFileSync(join(RAIZ, f), 'utf8').split('\n');
      const culpables: string[] = [];
      lineas.forEach((l, i) => {
        if (SERIE_DATOS.test(l)) return;
        const donde = `${f}:${i + 1}`;
        if (TAILWIND_AZUL.test(l)) culpables.push(`${donde} clase de Tailwind azul`);
        if (NOMBRES_AZUL.test(l)) culpables.push(`${donde} nombre/valor de azul histórico`);
        const sinMarca = l.replace(MARCA_TERCEROS, '');
        for (const m of sinMarca.matchAll(/#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
          // En .tsx los comentarios citan incidencias («#124»): ahí solo se mira el hex de 6 u 8 dígitos.
          if (f.endsWith('.tsx') && m[1].length === 3) continue;
          if (esHexAzul(m[1])) culpables.push(`${donde} ${m[0]} tiene matiz azul`);
        }
      });
      expect(culpables, culpables.join('\n')).toEqual([]);
    });
  }
});
