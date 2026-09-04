import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { techoDeclarado, masAllaDelTecho } from './verificar-huerfanas-repair.mjs';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 25 · ALTO — `repair_migrations` marcaba 0302 y 0303 como
// "applied" sin haber corrido su SQL nunca: "migration repair" NUNCA ejecuta
// SQL (solo bookkeeping), así que eso era un sello de goma sobre un esquema
// que no tenía esos cambios. Rojo comprobado: con la lista vieja (que SÍ
// incluía 0302/0303) esta prueba habría fallado.
// ═══════════════════════════════════════════════════════════════════════════

describe('techoDeclarado', () => {
  it('lee el rango "ya están aplicadas" de APLICAR-EN-PRODUCCION.md', () => {
    const doc = '> las migraciones **0272→0301** ya están aplicadas contra la base real';
    expect(techoDeclarado(doc)).toBe('0301');
  });

  it('sin el patrón, null — fail closed, no un techo inventado', () => {
    expect(techoDeclarado('nada relevante aquí')).toBeNull();
  });

  it('lee el documento REAL del repo (rojo si alguien le rompe el formato sin querer)', () => {
    const doc = readFileSync('supabase/APLICAR-EN-PRODUCCION.md', 'utf8');
    expect(techoDeclarado(doc)).toMatch(/^\d{4}$/);
  });
});

describe('masAllaDelTecho', () => {
  it('el escenario real: 0302 y 0303 por encima de un techo en 0301', () => {
    expect(masAllaDelTecho(['0299', '0300', '0301', '0302', '0303'], '0301')).toEqual(['0302', '0303']);
  });

  it('todo por debajo o a la par del techo: nada se marca', () => {
    expect(masAllaDelTecho(['0299', '0300', '0301'], '0301')).toEqual([]);
  });

  it('techo null (no se pudo leer): TODO cuenta como "más allá" — fail closed', () => {
    expect(masAllaDelTecho(['0001', '0002'], null)).toEqual(['0001', '0002']);
  });

  it('lista vacía: nunca hay nada que rechazar', () => {
    expect(masAllaDelTecho([], '0301')).toEqual([]);
  });
});

describe('el estado real del repo hoy no dispara la guarda', () => {
  it('migraciones-huerfanas-local.txt ya NO incluye 0302 ni 0303 — el hallazgo concreto está cerrado', () => {
    const lista = readFileSync('scripts/ci/migraciones-huerfanas-local.txt', 'utf8')
      .split('\n').map((l) => l.trim()).filter(Boolean);
    expect(lista).not.toContain('0302');
    expect(lista).not.toContain('0303');
  });

  it('con el techo y la lista reales del repo, nada queda por encima', () => {
    const lista = readFileSync('scripts/ci/migraciones-huerfanas-local.txt', 'utf8')
      .split('\n').map((l) => l.trim()).filter(Boolean);
    const techo = techoDeclarado(readFileSync('supabase/APLICAR-EN-PRODUCCION.md', 'utf8'));
    expect(masAllaDelTecho(lista, techo)).toEqual([]);
  });
});

describe('el cableado', () => {
  it('deploy-preview-promote.yml corre la guarda ANTES de repair, en el mismo job', () => {
    const wf = readFileSync('.github/workflows/deploy-preview-promote.yml', 'utf8');
    const iGuarda = wf.indexOf('verificar-huerfanas-repair.mjs');
    const iRepara = wf.indexOf("Reparar (reverted -> applied) y confirmar con dry-run");
    expect(iGuarda).toBeGreaterThan(-1);
    expect(iRepara).toBeGreaterThan(-1);
    expect(iGuarda).toBeLessThan(iRepara);
  });
});
