import { describe, it, expect } from 'vitest';
import { guardiaFundamento } from './fundamento';
import { corpusContador } from '@/lib/agents/contador';
import { beneficiosVerificados, slidesDelMercado } from '../agentes/crecimiento';

// A39-S50-01: `exigibleHasta` (RFA 2026: 2026-12-31) solo lo leía consulta.ts. La guardia de fundamento, el corpus del contador y el
// contador de fichas afirmables seguían dando por vigente la RFA 2026 desde el 1-ene-2027. Los relojes se pasan EXPLÍCITOS.
const ANTES = new Date('2026-10-25T18:00:00Z');
const DESPUES = new Date('2027-01-15T18:00:00Z');

describe('A39-S50-01 — la guardia de fundamento y las fichas vencidas', () => {
  const afirma = 'Con la RFA 2026 regla 2.9 puedes pagar hasta el 15% del diésel en efectivo.';
  const reconoce = 'La RFA 2026 regla 2.9 rigió hasta el 31 de diciembre de 2026 y ya no es exigible.';

  it('antes del vencimiento la cita permitida pasa', () => {
    expect(guardiaFundamento(afirma, ['rfa-2026-2.9'], '', ANTES).forzado).toBe(false);
  });

  it('después del vencimiento una afirmación en presente NO se sostiene con la ficha vencida: se quita la cita', () => {
    const r = guardiaFundamento(afirma, ['rfa-2026-2.9'], '', DESPUES);
    expect(r.forzado).toBe(true);
    expect(r.reply).not.toMatch(/RFA\s*2026/);
  });

  it('después del vencimiento SÍ se puede nombrar para decir que ya no rige', () => {
    const r = guardiaFundamento(reconoce, ['rfa-2026-2.9'], '', DESPUES);
    expect(r.forzado).toBe(false);
    expect(r.reply).toContain('RFA 2026 regla 2.9');
  });

  it('una ficha sin exigibleHasta nunca vence', () => {
    expect(guardiaFundamento('No es deducible por LISR 27-III.', ['lisr-27-fr-III'], '', DESPUES).forzado).toBe(false);
  });
});

describe('A39-S50-01 — el corpus del contador', () => {
  it('antes del 2027 ninguna ficha va marcada como vencida (el hash del prompt no cambia)', () => {
    expect(corpusContador(ANTES)).not.toContain('VENCIDA');
  });

  it('desde el 1-ene-2027 las fichas de la RFA 2026 viajan marcadas VENCIDA en su encabezado', () => {
    const c = corpusContador(DESPUES);
    expect(c).toMatch(/FICHA rfa-2026-2\.9\.yaml — VENCIDA el 2026-12-31/);
    expect(c).not.toMatch(/FICHA lisr-27-fr-III\.yaml — VENCIDA/);
  });
});

describe('A39-S50-01 — los conteos de fichas afirmables "hoy"', () => {
  const medido = (hoy: string) => beneficiosVerificados(hoy).find((b) => b.clave === 'corpus_citable')!.respaldo.medido;
  const afirmables = (m: string) => Number(/^(\d+) de/.exec(m)![1]);

  it('el contador de afirmables baja cuando vence la RFA 2026', () => {
    expect(afirmables(medido('2027-01-15'))).toBeLessThan(afirmables(medido('2026-10-25')));
  });

  it('una ficha vencida no es "noticia del mercado"', () => {
    const ids = (hoy: string) => slidesDelMercado(hoy, 100_000).map((s) => s.normaId);
    expect(ids('2026-10-25').some((i) => i.startsWith('rfa-2026'))).toBe(true);
    expect(ids('2027-01-15').some((i) => i.startsWith('rfa-2026'))).toBe(false);
  });
});
