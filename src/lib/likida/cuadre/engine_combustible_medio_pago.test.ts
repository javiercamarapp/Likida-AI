// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18-c3 · FISC-C3-1 (CRÍTICO) — la regla del combustible leía UN
// valor donde la norma define una LISTA por exclusión.
//
// RFA 2026 regla 2.9 (`normas/rfa-2026-2.9.yaml`, verificado_fuente_primaria):
//
//   «…considerarán cumplida la obligación establecida en el artículo 27,
//    fracción III, segundo párrafo de la Ley del ISR, cuando los pagos por
//    consumo de combustible se realicen CON MEDIOS DISTINTOS A cheque
//    nominativo de la cuenta del contribuyente; tarjeta de crédito, de débito
//    o de servicios; o monederos electrónicos autorizados por el SAT, siempre
//    que estos no excedan el 15 por ciento del total de los pagos efectuados
//    por consumo de combustible…»
//
// O sea: la lista de medios ADMITIDOS es cerrada —`MEDIOS_LISR_27_III`, que
// este mismo archivo ya declara y usaba SOLO para los litros de IEPS— y todo
// lo demás entra al cubo del 15%. La puerta de la regla decía
// `formaPago === '01'`, así que `'06' Dinero electrónico`, `'08' Vales`,
// `'12' Dación en pago`, `'17' Compensación` y `'23' Novación` se salían por
// el hueco y salían «Deducible para ISR» en verde, con su IVA acreditado.
//
// Es la misma familia de error que la auditoría 18 ya había cerrado dos veces
// en este archivo (A7 en el peaje, y los litros de IEPS): «cualquiera que no
// sea 01» y «solo 01» son los dos lados de la misma lectura equivocada.
//
// Se prueba con el motor REAL (`cuadrarViaje`) afirmando `totalDeducible`,
// `totalNoDeducible` e `ivaAcreditable` como SALIDA.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { cuadrarViaje, type PoliticaGasto } from './engine';
import type { Gasto } from '@/types/likida';

const politica: PoliticaGasto[] = [{ concepto: 'diesel', topeMonto: 100000 }];
const EST = { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000, clavesDieselIeps: [] };

/** Diésel de $11,600 (SubTotal $10,000 + IVA $1,600), CFDI verificado. */
function diesel(formaPago: string | undefined, monto = 11600, subTotal = 10000, iva = 1600): Gasto {
  return {
    id: 'g1', concepto: 'diesel', monto, subTotal, folio: 'D-1', fecha: '2026-08-10',
    ocrConfianza: 0.95, cfdiUuid: 'uuid-d1', xmlVerificado: true,
    rfcReceptor: 'REC010101AA1', tipoComprobante: 'I', ivaTraslado: iva,
    ...(formaPago ? { formaPago } : {}),
  };
}

const correr = (g: Gasto, extra: Record<string, unknown> = {}) =>
  cuadrarViaje({
    viajeId: 'v1', anticipo: 20000, politica, estimulos: EST,
    anioEjercicio: '2026', gastos: [g], ...extra,
  });

describe('FISC-C3-1 · el combustible exige un medio de la lista de la LISR 27-III', () => {
  // ── Flota NO elegible: la facilidad del 15% no la alcanza, así que 27-III
  //    aplica sin excepción y CUALQUIER medio fuera de la lista no deduce.
  describe('flota NO elegible (facilidad15: false)', () => {
    for (const fp of ['01', '06', '08', '12', '17', '23']) {
      it(`forma de pago '${fp}' → NO deducible, y no acredita IVA`, () => {
        const r = correr(diesel(fp), { facilidad15: false });
        expect(r.totalDeducible).toBe(0);
        expect(r.totalNoDeducible).toBe(11600);
        expect(r.ivaAcreditable).toBe(0);
      });
    }

    for (const fp of ['02', '03', '04', '05', '28', '29']) {
      it(`forma de pago '${fp}' (de la lista admitida) → SÍ deducible, con su IVA`, () => {
        const r = correr(diesel(fp), { facilidad15: false });
        expect(r.totalDeducible).toBe(11600);
        expect(r.totalNoDeducible).toBe(0);
        expect(r.ivaAcreditable).toBe(1600);
      });
    }

    it('sin forma de pago NO se juzga: desconocido no es "medio no admitido"', () => {
      // Mismo criterio que el resto del motor y que `causasDe`: suponerlo
      // inflaría el no-deducible contra la flota con una suposición.
      const r = correr(diesel(undefined), { facilidad15: false });
      expect(r.totalDeducible).toBe(11600);
    });
  });

  // ── Flota SÍ elegible: el medio fuera de la lista CONSUME el 15%, igual que
  //    el efectivo. El ejercicio lleva $140,000 de un tope de $150,000, así que
  //    de un diésel de $50,000 solo caben $10,000.
  describe('flota SÍ elegible (facilidad15: true) — el medio distinto consume el 15%', () => {
    const ejercicio = {
      facilidad15: true,
      totalCombustibleEjercicio: 1_000_000,
      efectivoPrevEjercicio: 140_000,
    };

    for (const fp of ['01', '06', '17']) {
      it(`forma de pago '${fp}' → \$10,000 deducible y \$40,000 NO deducible`, () => {
        const r = correr(diesel(fp, 50000, 43103.45, 6896.55), ejercicio);
        expect(r.totalDeducible).toBe(10000);
        expect(r.totalNoDeducible).toBe(40000);
        expect(r.diferencias.some((d) => d.tipo === 'efectivo_sobre_15')).toBe(true);
      });
    }

    it("forma de pago '03' (transferencia, admitida) → no toca el 15%: deduce completo", () => {
      const r = correr(diesel('03', 50000, 43103.45, 6896.55), ejercicio);
      expect(r.totalDeducible).toBe(50000);
      expect(r.totalNoDeducible).toBe(0);
      expect(r.diferencias.some((d) => d.tipo === 'efectivo_sobre_15')).toBe(false);
    });
  });

  // ── El rótulo tiene que ser verdad: con '06' la nota NO puede decir
  //    «pagado en EFECTIVO», porque no lo fue.
  it('la nota nombra el medio real, no «EFECTIVO», cuando el pago no fue en efectivo', () => {
    const r = correr(diesel('06'), { facilidad15: false });
    const d = r.diferencias.find((x) => x.tipo === 'efectivo_no_elegible');
    expect(d).toBeDefined();
    expect(d!.nota).not.toContain('EFECTIVO');
    expect(d!.nota).toContain('06');
  });

  it("con '01' la nota sí dice EFECTIVO, que es lo que pasó", () => {
    const r = correr(diesel('01'), { facilidad15: false });
    const d = r.diferencias.find((x) => x.tipo === 'efectivo_no_elegible');
    expect(d!.nota).toContain('EFECTIVO');
  });
});
