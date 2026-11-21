import { describe, it, expect } from 'vitest';
/* eslint-disable security/detect-non-literal-fs-filename -- lee archivos del propio repo, rutas derivadas de CLAUDE.md */
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * A52-ARQ-01 — `CLAUDE.md` es el documento que lee CADA agente antes de tocar
 * el repo, y era el artefacto de arquitectura MENOS probado: cero pruebas lo
 * leían. En dos rondas la auditoría le encontró afirmaciones muertas que
 * mandaban a construir sobre premisas falsas: `geocerca` «sin escritor»
 * (tenía dos), cinco roles donde el CHECK admite seis, `dashboard/pendiente.tsx`
 * borrado en `07978e98` y aún citado, `exigir()`/`traerTodo()` ubicados en
 * `analytics.ts` cuando viven en `pg.ts`, y la librería de UI descrita al revés.
 *
 * Esta guarda cubre lo que se puede comprobar con un comando. NO intenta
 * validar la prosa: valida las CIFRAS que el documento declara y que los
 * PUNTEROS `archivo:línea` apunten a algo. Si una cifra deja de ser cierta,
 * esto se pone rojo y se actualiza el documento — es el mismo trato que el
 * trinquete de lint y el de i18n.
 */
const DOC = readFileSync('CLAUDE.md', 'utf8');

const contar = (cmd: string) => Number(execSync(cmd, { encoding: 'utf8' }).trim());

describe('A52-ARQ-01: las cifras que declara CLAUDE.md siguen siendo ciertas', () => {
  it('el número de páginas de /dashboard es el que dice el documento', () => {
    const real = contar('find src/app/dashboard -name page.tsx | wc -l');
    const m = DOC.match(/\*\*(\d+) páginas\*\*/);
    expect(m, 'CLAUDE.md debe declarar «**N páginas**» para /dashboard').not.toBeNull();
    expect(Number(m![1]), `/dashboard tiene ${real} page.tsx`).toBe(real);
  });

  it('la proporción ui-v2 contra kit v1 es la que dice el documento', () => {
    const uiV2 = contar(`grep -rn "ui-v2/" src/app/dashboard --include=*.tsx | wc -l`);
    const m = DOC.match(/\*\*(\d+)\*\* imports de `ui-v2`/);
    expect(m, 'CLAUDE.md debe declarar «**N** imports de `ui-v2`»').not.toBeNull();
    expect(Number(m![1]), `hay ${uiV2} imports de ui-v2 en /dashboard`).toBe(uiV2);
    // La afirmación que importa: ui-v2 es la librería viva, por goleada.
    expect(uiV2).toBeGreaterThan(100);
  });

  it('ningún puntero a un archivo del repo apunta a algo que ya no existe', () => {
    // Solo rutas con `/` y extensión .ts/.tsx dentro de comillas invertidas.
    // Un solo cuantificador sobre una clase negada: lineal, sin retroceso.
    const citados = [...DOC.matchAll(/`([^`\s]+)`/g)]
      .map(([, t]) => t.replace(/:\d+$/, ''))
      .filter((r) => r.includes('/') && /\.tsx?$/.test(r) && !r.startsWith('node_modules/'));
    const prefijos = ['', 'src/', 'src/app/', 'src/lib/', 'src/lib/likida/'];
    const muertos = [...new Set(citados)].filter((r) => !prefijos.some((p) => existsSync(p + r)));
    expect(muertos, `CLAUDE.md cita archivos que no existen: ${muertos.join(', ')}`).toEqual([]);
  });
});
