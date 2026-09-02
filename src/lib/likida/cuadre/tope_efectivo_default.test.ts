// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · PRU-2 (ALTO) — el tope de efectivo de la LISR 27-III no tenía
// ancla: `?? 2000` → `?? 20000` pasaba 10,001 pruebas en verde.
//
// Las pruebas que tocan efectivo o pasan `estimulos.efectivoTopeMxn` explícito
// o usan montos muy lejos del tope ($58,000). Ninguna pisaba la FRONTERA con el
// default — y la banda de $2,000–$5,000 en efectivo (diésel sin monedero,
// casetas) es donde vive la mayoría de los comprobantes de una flota.
//
// Ficha: `normas/lisr-27-III.yaml` («los pagos cuyo monto exceda de $2,000.00
// se efectúen mediante transferencia electrónica…»). El número vive UNA vez,
// con nombre y exportado (`TOPE_EFECTIVO_LISR_27_III`), y aquí se ancla en la
// frontera exacta: $2,000.00 pasa, $2,000.01 no.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { cuadrarViaje, TOPE_EFECTIVO_LISR_27_III, type PoliticaGasto } from './engine';
import type { Gasto } from '@/types/likida';

const politica: PoliticaGasto[] = [{ concepto: 'hospedaje', topeMonto: 100_000 }];

const hospedajeEfectivo = (monto: number): Gasto => ({
  id: 'g1', concepto: 'hospedaje', monto, folio: 'H1', fecha: '2026-05-01',
  ocrConfianza: 0.95, cfdiUuid: 'u-g1', xmlVerificado: true, formaPago: '01',
});

const tipos = (monto: number, estimulos?: { efectivoTopeMxn: number }) =>
  cuadrarViaje({
    viajeId: 'v1', anticipo: 10_000, politica, gastos: [hospedajeEfectivo(monto)],
    ...(estimulos ? { estimulos: { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, clavesDieselIeps: [], ...estimulos } } : {}),
  }).diferencias.map((d) => d.tipo);

describe('PRU-2: el tope de efectivo por defecto es el de la ficha, y se prueba en la frontera', () => {
  it('la constante es la de LISR 27-III: $2,000.00', () => {
    expect(TOPE_EFECTIVO_LISR_27_III).toBe(2000);
    // Y la ficha lo dice con esa cifra: si la ley cambia, cambia la ficha y
    // esta prueba la sigue.
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- lee una ficha del propio repo en tiempo de prueba; la ruta no viene de ninguna entrada de usuario.
    const ficha = readFileSync(new URL('../../../../normas/lisr-27-III.yaml', import.meta.url), 'utf8');
    expect(ficha).toMatch(/2,000\.00/);
  });

  it('SIN `estimulos`, $2,000.01 en efectivo ya no es deducible', () => {
    expect(tipos(2000.01)).toContain('efectivo_sobre_tope');
  });

  it('SIN `estimulos`, $2,000.00 exacto en efectivo sí pasa («exceda de»)', () => {
    expect(tipos(2000)).not.toContain('efectivo_sobre_tope');
  });

  it('el tope declarado por el tenant manda: con $5,000, $4,999 pasa', () => {
    expect(tipos(4999, { efectivoTopeMxn: 5000 })).not.toContain('efectivo_sobre_tope');
    expect(tipos(5000.01, { efectivoTopeMxn: 5000 })).toContain('efectivo_sobre_tope');
  });
});
