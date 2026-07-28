import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { NORMA_POR_DIFERENCIA, SIN_NORMA, normasDe } from './por_diferencia';
import { IDS_NORMA, NORMAS } from './indice';
import type { TipoDiferencia } from '@/types/cuadra';

// ═══════════════════════════════════════════════════════════════════════════
// TODO TIPO DE DIFERENCIA TIENE QUE ESTAR CLASIFICADO.
//
// O tiene norma detrás, o se declara que no la tiene y por qué. Un tipo que no
// esté en ninguna de las dos listas es el motor afirmando algo sin saber si lo
// respalda la ley — y ese es el hueco por el que el agente acabaría diciendo
// "por la ley" sobre un tope que puso la flota.
// ═══════════════════════════════════════════════════════════════════════════
const tipos = (() => {
  const src = readFileSync(new URL('../../../types/cuadra.ts', import.meta.url), 'utf8');
  const i = src.indexOf('export type TipoDiferencia');
  const decl = src.slice(i, src.indexOf('\n\n', i));
  return [...decl.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as TipoDiferencia);
})();

describe('cobertura de tipos de diferencia', () => {
  it('se leyeron los tipos de verdad', () => {
    expect(tipos.length).toBeGreaterThan(20);
  });

  it('cada tipo está clasificado: con norma o declarado sin ella', () => {
    for (const t of tipos) {
      const clasificado = t in NORMA_POR_DIFERENCIA || t in SIN_NORMA;
      expect(clasificado, `"${t}" no está ni en NORMA_POR_DIFERENCIA ni en SIN_NORMA`).toBe(true);
    }
  });

  it('ningún tipo está en las dos listas a la vez', () => {
    for (const t of tipos) {
      const enAmbas = t in NORMA_POR_DIFERENCIA && t in SIN_NORMA;
      expect(enAmbas, `"${t}" está clasificado dos veces`).toBe(false);
    }
  });

  it('no se referencian tipos que ya no existen', () => {
    // Un tipo renombrado deja aquí una entrada muerta, y con ella una norma que
    // ya no se cita nunca.
    for (const k of [...Object.keys(NORMA_POR_DIFERENCIA), ...Object.keys(SIN_NORMA)]) {
      expect(tipos, `"${k}" no es un TipoDiferencia`).toContain(k);
    }
  });
});

describe('las normas referenciadas existen', () => {
  it('ningún norma_id inventado', () => {
    // Si esto falla, el agente recibiría un id que la guardia no reconoce y la
    // cita se le quitaría del mensaje aunque fuera legítima.
    for (const [tipo, ids] of Object.entries(NORMA_POR_DIFERENCIA)) {
      for (const id of ids!) expect(IDS_NORMA, `"${tipo}" cita "${id}", que no está en el índice`).toContain(id);
    }
  });

  it('las razones de SIN_NORMA están escritas, no vacías', () => {
    for (const [tipo, razon] of Object.entries(SIN_NORMA)) {
      expect(razon!.length, `"${tipo}" no dice por qué no tiene norma`).toBeGreaterThan(10);
    }
  });
});

describe('normasDe', () => {
  it('junta las normas de varias diferencias sin repetir', () => {
    const r = normasDe(['sin_cfdi', 'combustible_efectivo']);
    expect(r).toContain('lisr-27-fr-III');
    expect(r).toContain('rfa-2026-2.9');
    expect(r.filter((x) => x === 'lisr-27-fr-III')).toHaveLength(1);
  });

  it('el efectivo en combustible trae la regla Y su excepción', () => {
    // El patrón que costó dinero cuatro veces: LISR 27-III lo prohíbe en
    // absoluto y RFA 2026 regla 2.9 concede el 15%. Con solo la primera, el
    // agente explica mal el veredicto.
    const r = normasDe(['combustible_efectivo']);
    expect(r).toEqual(expect.arrayContaining(['lisr-27-fr-III', 'rfa-2026-2.9']));
    expect(NORMAS['rfa-2026-2.9'].jerarquia).toBe(3);   // facilidad, no ley
    expect(NORMAS['lisr-27-fr-III'].jerarquia).toBe(1); // ley
  });

  it('una diferencia sin norma no aporta ninguna', () => {
    expect(normasDe(['sobre_politica'])).toEqual([]);
  });
});
