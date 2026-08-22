// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18, M5 — un consumo en bar se imprimía 100% deducible.
//
// `normas/lisr-28-XX.yaml`: "En ningún caso los consumos en bares serán
// deducibles". Ticket de bar de $600 con CFDI y tarjeta, dentro de un viaje
// con hospedaje: el motor decía "Deducible para ISR $600.00" y acreditaba
// $82.76 de IVA citando LIVA 5. La norma dice $0.00 y $0.00.
//
// El intake no distingue bar de restaurante, así que el motor NO afirma 0%:
// con la señal en la razón social o el producto manda el gasto a POR CONFIRMAR
// (tercer estado), no acredita su IVA y baja la liquidación a revisión.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { cuadrarViaje, cubetaDe, pareceBar, type PoliticaGasto } from './engine';
import type { Gasto } from '@/types/likida';

const politica: PoliticaGasto[] = [{ concepto: 'alimentacion', topeMonto: 5000 }, { concepto: 'hospedaje', topeMonto: 5000 }];
const EST = { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000, clavesDieselIeps: [] };

const comida = (emisor: string, extra: Partial<Gasto> = {}): Gasto => ({
  id: 'c1', concepto: 'alimentacion', monto: 600, folio: 'A1', fecha: '2026-05-01', ocrConfianza: 0.95,
  cfdiUuid: 'u-c1', xmlVerificado: true, rfcReceptor: 'REC010101AA1', formaPago: '04',
  ivaTraslado: 82.76, subTotal: 517.24, ocrExtra: { emisor }, ...extra,
});
const hotel: Gasto = {
  id: 'h1', concepto: 'hospedaje', monto: 1160, folio: 'H1', fecha: '2026-05-01', ocrConfianza: 0.95,
  cfdiUuid: 'u-h1', xmlVerificado: true, rfcReceptor: 'REC010101AA1', formaPago: '04', ivaTraslado: 160,
};

const cuadra = (g: Gasto) => cuadrarViaje({ viajeId: 'v-bar', anticipo: 2000, politica, estimulos: EST, gastos: [g, hotel] });

describe('M5: el consumo en bar deja de imprimirse deducible', () => {
  it('el escenario del hallazgo: $600 en "BAR LA OFICINA" → por confirmar, IVA $0, liquidación a revisar', () => {
    const g = comida('BAR LA OFICINA S.A. DE C.V.');
    const r = cuadra(g);
    const d = r.diferencias.find((x) => x.tipo === 'consumo_bar')!;
    expect(d).toBeDefined();
    expect(d.gastoId).toBe('c1');
    expect(d.nota).toContain('LISR 28-XX');
    expect(d.nota).toContain('BAR LA OFICINA');
    // Antes: totalDeducible 1760 e IVA 242.76. Ahora el bar no se afirma.
    expect(cubetaDe(g, r.diferencias.filter((x) => x.gastoId === 'c1'))).toBe('por_confirmar');
    expect(r.totalDeducible).toBe(1160);
    expect(r.totalPorConfirmar).toBe(600);
    expect(r.ivaAcreditable).toBe(160);
    expect(r.estatus).toBe('revisar');
  });

  it('un restaurante no dispara: la cifra del hallazgo sigue deducible', () => {
    const r = cuadra(comida('RESTAURANTE LA BARRA DE JUAN'));
    expect(r.diferencias.some((x) => x.tipo === 'consumo_bar')).toBe(false);
    expect(r.totalDeducible).toBe(1760);
    expect(r.ivaAcreditable).toBe(242.76);
  });

  it('la señal es por palabra completa y solo sobre alimentación', () => {
    expect(pareceBar({ concepto: 'alimentacion', ocrExtra: { emisor: 'Cantina El Gallo' } })).toBe(true);
    expect(pareceBar({ concepto: 'alimentacion', ocrExtra: { producto: 'CERVECERIA' } })).toBe(true);
    expect(pareceBar({ concepto: 'alimentacion', ocrExtra: { emisor: 'Tacos de Barbacoa El Güero' } })).toBe(false);
    expect(pareceBar({ concepto: 'alimentacion', ocrExtra: { emisor: 'Barra de ensaladas' } })).toBe(false);
    expect(pareceBar({ concepto: 'alimentacion', ocrExtra: {} })).toBe(false);
    expect(pareceBar({ concepto: 'alimentacion' })).toBe(false);
    // Un hotel que se llama "Bar" no es un consumo en bar.
    expect(pareceBar({ concepto: 'hospedaje', ocrExtra: { emisor: 'Hotel Bar Azul' } })).toBe(false);
  });
});
