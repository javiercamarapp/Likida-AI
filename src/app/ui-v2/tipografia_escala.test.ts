/* eslint-disable security/detect-non-literal-fs-filename -- recorre el árbol del repo con rutas propias */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// GUARDA DE TIPOGRAFÍA (L4, decisión de Javier 31-oct): el código v2 y el dashboard solo usan tamaños de la escala cerrada
// {11, 12, 13, 14, 15, 16, 18, 20, 26} px. PROHIBIDOS 9, 9.5, 10, 10.5, 11.5, 12.5, 13.5, 17, 19, 22, 24 y 28. Cambiar un tamaño de la
// escala se hace en `ui-v2/tokens.css` (--t-*), no con valores sueltos. La guarda mira `text-[Npx]`, `font-size: Npx` y `font: W Npx`.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = join(process.cwd(), 'src/app');
const ESCALA = new Set([11, 12, 13, 14, 15, 16, 18, 20, 26]);

function archivos(dir: string, exts: string[], salida: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) { if (nombre !== '__fixtures__' && nombre !== 'node_modules') archivos(ruta, exts, salida); continue; }
    if (exts.some((e) => nombre.endsWith(e)) && !/\.test\.tsx?$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

/** Tamaños (px) usados por un texto de código o CSS. Quita comentarios de CSS y de bloque para no contar prosa. */
function tamanos(texto: string): number[] {
  const limpio = texto.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: number[] = [];
  for (const m of limpio.matchAll(/text-\[([0-9.]+)px\]/g)) out.push(Number(m[1]));
  for (const m of limpio.matchAll(/font-size:\s*([0-9.]+)px/g)) out.push(Number(m[1]));
  for (const m of limpio.matchAll(/font:\s*[a-z]*\s*[0-9]{3}\s+([0-9.]+)px/g)) out.push(Number(m[1]));
  for (const m of limpio.matchAll(/fontSize=\{?"?([0-9.]+)/g)) out.push(Number(m[1]));
  for (const m of limpio.matchAll(/fontSize:\s*['"]?([0-9.]+)(?:px)?['"]?/g)) out.push(Number(m[1]));
  return out;
}
const fuera = (texto: string) => tamanos(texto).filter((n) => !ESCALA.has(n));

/** Excepciones JUSTIFICADAS dentro del alcance v2. Cada una debe seguir teniendo valores fuera de escala (si ya está limpia, se borra de aquí). */
/** Excepciones JUSTIFICADAS dentro del alcance v2. Vacía: el chat y los overlays del lote 3 ya están en la escala. Cada entrada nueva debe seguir teniendo valores fuera de escala. */
const EXCEPCIONES_V2: Record<string, string> = {};

describe('tipografía: solo la escala de tokens en el código v2 y el dashboard', () => {
  const alcance = [
    ...archivos(join(RAIZ, 'dashboard'), ['.tsx', '.ts', '.css']),
    ...archivos(join(RAIZ, 'ui-v2'), ['.tsx', '.ts', '.css']),
  ];

  it('hay archivos que revisar', () => { expect(alcance.length).toBeGreaterThan(300); });

  it('ningún archivo fuera de la lista de excepciones usa un tamaño fuera de la escala', () => {
    const malos = alcance
      .map((f) => [relative(RAIZ, f), fuera(readFileSync(f, 'utf8'))] as const)
      .filter(([r, v]) => v.length > 0 && !(r in EXCEPCIONES_V2))
      .map(([r, v]) => `${r}: ${[...new Set(v)].join(', ')} px`);
    expect(malos, `Tamaños fuera de la escala {${[...ESCALA].join(', ')}}:\n${malos.join('\n')}`).toEqual([]);
  });

  it('cada excepción sigue siendo necesaria (si el archivo ya cumple, se retira de la lista)', () => {
    for (const r of Object.keys(EXCEPCIONES_V2)) {
      expect(fuera(readFileSync(join(RAIZ, r), 'utf8')).length, `${r} ya cumple: bórralo de EXCEPCIONES_V2`).toBeGreaterThan(0);
    }
  });
});

describe('tipografía: /admin y el resto (v1) no empeoran', () => {
  // Línea base medida al abrir L4. /admin es v1 (no carga ui-v2/*.css): se migrará con su propio lote; mientras tanto no puede crecer.
  const TOPE_ADMIN = 200;
  it(`/admin tiene como máximo ${TOPE_ADMIN} usos fuera de escala`, () => {
    const n = archivos(join(RAIZ, 'admin'), ['.tsx', '.ts', '.css']).reduce((a, f) => a + fuera(readFileSync(f, 'utf8')).length, 0);
    expect(n).toBeLessThanOrEqual(TOPE_ADMIN);
  });
});

describe('tipografía: los tokens existen y las utilidades de la escala leen el token', () => {
  const tokens = readFileSync(join(RAIZ, 'ui-v2/tokens.css'), 'utf8');
  it.each([
    ['--t-page', '20px'], ['--t-section', '14px'], ['--t-card', '14px'], ['--t-body', '13px'],
    ['--t-small', '12px'], ['--t-micro', '11px'], ['--t-kpi', '26px'],
  ])('%s = %s', (nombre, valor) => {
    expect(tokens).toMatch(new RegExp(`${nombre}:\\s*${valor};`));
  });
  it('el cuerpo del alcance v2 es 13/1.5 con tracking 0', () => {
    expect(tokens).toMatch(/\[data-ui="v2"\] \{\s*font-size: var\(--t-body\);\s*line-height: 1\.5;\s*letter-spacing: 0;/);
  });
  it.each([['11', 'micro'], ['12', 'small'], ['13', 'body'], ['14', 'section'], ['20', 'page'], ['26', 'kpi']])(
    'text-[%spx] lee --t-%s', (px, token) => {
      expect(tokens).toContain(`[data-ui="v2"] .text-\\[${px}px\\] { font-size: var(--t-${token}); }`);
    });
});
