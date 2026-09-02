// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · FIS-2 (CRÍTICO, reincidente 23) — `proporcionesDeducibles`
// tiene que reproducir AL CENTAVO lo que `cuadrarViaje` reparte.
//
// El motor llena `proporcionDeducible` mientras recorre los gastos (frontera
// del 15% de la RFA 2.9, tope diario de LISR 28-V). La póliza no corre el
// motor: lee la liquidación guardada (gastos + diferencias) y necesita la
// MISMA fracción por gasto. Este archivo es el candado: si alguien cambia la
// regla en `cuadrarViaje` y no en el helper, cae en rojo.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { cuadrarViaje, cubetaDe, copiasDeComprobante, proporcionesDeducibles, type CuadreInput, type PoliticaGasto } from './engine';
import type { Gasto } from '@/types/likida';

const round2 = (n: number) => Math.round(n * 100) / 100;
const politica: PoliticaGasto[] = [
  { concepto: 'alimentacion', topeMonto: 100_000 }, { concepto: 'hospedaje', topeMonto: 100_000 },
  { concepto: 'diesel', topeMonto: 100_000 }, { concepto: 'flete', topeMonto: 100_000 },
];
const EST = { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000, clavesDieselIeps: ['15101505'] };

const g = (id: string, extra: Partial<Gasto>): Gasto => ({
  id, concepto: 'alimentacion', monto: 1000, fecha: '2026-05-01', ocrConfianza: 0.95,
  cfdiUuid: `u-${id}`, xmlVerificado: true, formaPago: '03', rfcReceptor: 'REC010101AA1', ...extra,
});

/** El reparto de la póliza, hecho con las tres funciones del motor. */
function repartoDesdeLoGuardado(input: CuadreInput) {
  const liq = cuadrarViaje(input);
  const copias = copiasDeComprobante(liq.gastos);
  const vivos = liq.gastos.filter((x) => !copias.has(x.id) && x.monto > 0);
  const p = proporcionesDeducibles(vivos, liq.diferencias);
  let deducible = 0, noDeducible = 0, porConfirmar = 0;
  for (const x of vivos) {
    const cubeta = cubetaDe(x, liq.diferencias.filter((d) => d.gastoId === x.id));
    if (cubeta === 'no_deducible') { noDeducible += x.monto; continue; }
    if (cubeta === 'por_confirmar') { porConfirmar += x.monto; continue; }
    const d = round2(x.monto * Math.max(0, Math.min(1, p.get(x.id) ?? 1)));
    deducible += d; noDeducible += round2(x.monto - d);
  }
  return { liq, p, deducible: round2(deducible), noDeducible: round2(noDeducible), porConfirmar: round2(porConfirmar) };
}

const igualAlMotor = (input: CuadreInput) => {
  const r = repartoDesdeLoGuardado(input);
  expect(r.deducible).toBe(r.liq.totalDeducible);
  expect(r.noDeducible).toBe(r.liq.totalNoDeducible);
  expect(r.porConfirmar).toBe(r.liq.totalPorConfirmar);
  return r;
};

describe('FIS-2: la proporción reconstruida desde lo guardado es la del motor', () => {
  it('comida de $2,000 con CFDI y tope de $750: 37.5% deducible, y la póliza lo sabe', () => {
    const r = igualAlMotor({
      viajeId: 'v', anticipo: 5000, politica, estimulos: EST,
      gastos: [
        g('comida', { monto: 2000, subTotal: 1724.14, ivaTraslado: 275.86 }),
        // El hospedaje del mismo día es el soporte del viático (LISR 28-V).
        g('hotel', { concepto: 'hospedaje', monto: 1160, subTotal: 1000, ivaTraslado: 160 }),
      ],
    });
    expect(r.p.get('comida')).toBeCloseTo(0.375, 6);
    expect(r.p.has('hotel')).toBe(false);
    // El escenario de la auditoría: 750 + 1,160 deducible; 1,250 no deducible.
    expect(r.liq.totalDeducible).toBe(1910);
    expect(r.liq.totalNoDeducible).toBe(1250);
  });

  it('dos comidas del mismo día (una sin CFDI): la proporción del día es SOLO entre timbrados', () => {
    igualAlMotor({
      viajeId: 'v', anticipo: 5000, politica, estimulos: EST,
      gastos: [
        g('c1', { monto: 900 }),
        g('c2', { monto: 600, cfdiUuid: undefined, xmlVerificado: false }),
        g('h1', { concepto: 'hospedaje', monto: 1160, subTotal: 1000, ivaTraslado: 160 }),
      ],
    });
  });

  it('diésel en efectivo que cruza la frontera del 15%: solo el excedente de ESE comprobante se pierde', () => {
    const r = igualAlMotor({
      viajeId: 'v', anticipo: 20_000, politica, estimulos: EST, facilidad15: true, anioEjercicio: '2026',
      totalCombustibleEjercicio: 100_000, efectivoPrevEjercicio: 12_000,
      gastos: [
        g('d1', { concepto: 'diesel', monto: 5000, formaPago: '01', claveProdServ: '15101505', subTotal: 4310.34, ivaTraslado: 689.66 }),
        g('d2', { concepto: 'diesel', monto: 2000, formaPago: '03', claveProdServ: '15101505', subTotal: 1724.14, ivaTraslado: 275.86 }),
      ],
    });
    // Tope 15,000; previo 12,000 → caben 3,000 de los 5,000: 60% deducible.
    expect(r.p.get('d1')).toBeCloseTo(0.6, 6);
    expect(r.p.has('d2')).toBe(false);
  });

  it('con copias, viáticos sobre el tope y un no deducible, sigue cuadrando con el motor', () => {
    igualAlMotor({
      viajeId: 'v', anticipo: 30_000, politica, estimulos: EST,
      gastos: [
        g('f1', { concepto: 'flete', monto: 8000, cfdiUuid: 'u-flete', subTotal: 6896.55, ivaTraslado: 1103.45 }),
        g('f2', { concepto: 'flete', monto: 8000, cfdiUuid: 'u-flete', subTotal: 6896.55, ivaTraslado: 1103.45 }),
        g('c1', { monto: 1200 }),
        g('h1', { concepto: 'hospedaje', monto: 3000, formaPago: '01', subTotal: 2586.21, ivaTraslado: 413.79 }),
      ],
    });
  });

  it('sin diferencias que partan nada, el mapa está vacío (todo deducible al 100%)', () => {
    expect(proporcionesDeducibles([g('x', {})], []).size).toBe(0);
  });
});
