// CT-BAS-10: numero nuevo > 0949 y todo hueco no declarado esta prohibido.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sin tipos
import { parsearNumeracion, verificarNumeracion, verificarRepo, BASE_APLICADA } from './guarda-numeracion-migraciones.mjs';

const md = `
## Huecos declarados

| Número | Estado |
| --- | --- |
| \`0003\` | x |
| \`0007\`-\`0008\` | y |

## Rangos reservados por fase

| Rango | Fase |
| --- | --- |
| \`0950\`-\`0959\` | F3 |
`;

describe('guarda de numeración de migraciones', () => {
  it('parsea huecos declarados y rangos reservados', () => {
    expect(parsearNumeracion(md)).toEqual({ declarados: [[3, 3], [7, 8]], reservados: [[950, 959]] });
  });

  it('acepta una numeración con todos los huecos declarados', () => {
    const r = verificarNumeracion({ prefijos: ['0001', '0002', '0004', '0005', '0006', '0009'], declarados: [[3, 3], [7, 8]], reservados: [], base: 9 });
    expect(r).toEqual({ ok: true, errores: [] });
  });

  it('rechaza un hueco no declarado', () => {
    const r = verificarNumeracion({ prefijos: ['0001', '0002', '0004'], declarados: [], reservados: [], base: 4 });
    expect(r.ok).toBe(false);
    expect(r.errores.join('\n')).toMatch(/hueco no declarado: 0003/);
  });

  it('rechaza rellenar un hueco declarado (número ≤ base con archivo)', () => {
    const r = verificarNumeracion({ prefijos: ['0001', '0002', '0003', '0004'], declarados: [[3, 3]], reservados: [], base: 4 });
    expect(r.ok).toBe(false);
    expect(r.errores.join('\n')).toMatch(/0003 está declarado como saltado pero existe un archivo/);
  });

  it('un número nuevo con hueco sobre la base, fuera de rango reservado, es error', () => {
    const r = verificarNumeracion({ prefijos: ['0949', '0951'], declarados: [], reservados: [], base: 949 });
    expect(r.errores.join('\n')).toMatch(/0950/);
  });

  it('tolera huecos sobre la base solo dentro de un rango reservado por fase', () => {
    const r = verificarNumeracion({ prefijos: ['0949', '0950', '0952'], declarados: [], reservados: [[950, 979]], base: 949 });
    expect(r).toEqual({ ok: true, errores: [] });
  });

  it('un hueco sobre la base fuera del rango reservado falla aunque otra fase tenga rango', () => {
    const r = verificarNumeracion({ prefijos: ['0949', '0950', '0985'], declarados: [], reservados: [[950, 979], [985, 989]], base: 949 });
    expect(r.errores.join('\n')).toMatch(/hueco no declarado: 0980/);
  });

  it('el repo real cumple la regla con NUMERACION-SALTADA.md', () => {
    expect(BASE_APLICADA).toBe(949);
    const r = verificarRepo();
    expect(r.errores).toEqual([]);
  });

  it('NUMERACION-SALTADA.md declara los 412 huecos históricos y los rangos por fase', () => {
    const { declarados, reservados } = parsearNumeracion(readFileSync('supabase/migrations/NUMERACION-SALTADA.md', 'utf8'));
    const total = declarados.reduce((s: number, [a, b]: number[]) => s + (b - a + 1), 0);
    expect(total).toBeGreaterThanOrEqual(412);
    expect(reservados).toEqual([[950, 959], [960, 974], [975, 984], [985, 989], [990, 999]]);
  });
});
