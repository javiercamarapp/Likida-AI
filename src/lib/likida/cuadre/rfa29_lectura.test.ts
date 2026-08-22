// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18, B4 — el 15% de la RFA 2026 regla 2.9 se reparte en proporción,
// y el papel tiene que decir que ésa es UNA lectura.
//
// "siempre que estos no excedan el 15 por ciento del total de los pagos" se
// puede leer como tope prorrateable (el motor) o como condición de procedencia
// (rebasado el 15%, nada del efectivo se deduce). Sobre $1,000,000 de
// combustible con $200,000 en efectivo: el motor deja $150,000 deducibles; la
// otra lectura, $0. El motor no cambia de lectura aquí — la ficha no resuelve
// la ambigüedad— pero deja de callarla, igual que `BASE_ESTIMULO_PEAJE` declara
// la base del peaje.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { cuadrarViaje, LECTURA_RFA_29_PRORRATEO, type PoliticaGasto } from './engine';
import type { Gasto } from '@/types/likida';

const politica: PoliticaGasto[] = [{ concepto: 'diesel', topeMonto: 1_000_000 }];

const diesel = (id: string, monto: number): Gasto => ({
  id, concepto: 'diesel', monto, folio: `F-${id}`, fecha: '2026-05-01', ocrConfianza: 0.95,
  cfdiUuid: `u-${id}`, xmlVerificado: true, rfcReceptor: 'REC010101AA1', formaPago: '01',
});

describe('B4: la lectura proporcional del 15% va escrita en la nota', () => {
  const r = cuadrarViaje({
    viajeId: 'v-b4', anticipo: 200_000, politica,
    facilidad15: true, anioEjercicio: '2026', totalCombustibleEjercicio: 1_000_000, efectivoPrevEjercicio: 0,
    gastos: [diesel('g1', 200_000)],
  });
  const sobre = r.diferencias.find((d) => d.tipo === 'efectivo_sobre_15')!;

  it('la cifra no cambia: el excedente de $50,000 es lo único no deducible (lectura a)', () => {
    expect(sobre).toBeDefined();
    expect(sobre.monto).toBe(50_000);
    expect(r.totalDeducible).toBe(150_000);
  });

  it('y la nota declara la lectura y nombra la otra, con su consecuencia', () => {
    expect(sobre.nota).toContain(LECTURA_RFA_29_PRORRATEO);
    expect(LECTURA_RFA_29_PRORRATEO).toContain('Lectura aplicada');
    expect(LECTURA_RFA_29_PRORRATEO).toMatch(/TODO el combustible en efectivo/);
    expect(LECTURA_RFA_29_PRORRATEO).toMatch(/confírmela con su contador/);
  });

  it('dentro del 15% no hay excedente que discutir, y la nota no carga la lectura', () => {
    const ok = cuadrarViaje({
      viajeId: 'v-b4b', anticipo: 100_000, politica,
      facilidad15: true, anioEjercicio: '2026', totalCombustibleEjercicio: 1_000_000, efectivoPrevEjercicio: 0,
      gastos: [diesel('g2', 100_000)],
    });
    const dentro = ok.diferencias.find((d) => d.tipo === 'combustible_efectivo_dentro15')!;
    expect(dentro).toBeDefined();
    expect(dentro.nota).not.toContain('Lectura aplicada');
  });
});
