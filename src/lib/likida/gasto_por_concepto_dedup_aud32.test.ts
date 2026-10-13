import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gastoPorConceptoFiscal, type GastoFiscal } from './fiscal';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 32 c16 · ARQ-A3 (CRÍTICO, reincidente desde la c13)
//
// La misma verdad del dinero tenía DOS sedes y la pantalla que el contralor
// abre para el cierre estaba cableada a la mala:
//
//   /dashboard/combustible-casetas  →  gasto_por_concepto_tenant  (0150:284-287)
//                                      `sum(monto) from gasto group by 1`,
//                                      sin un solo `row_number()`
//   PDF · póliza · WhatsApp · /dashboard/contador
//                                  →  gastos_fiscales_agregados_tenant (0702)
//                                      dos `row_number()` + censo `uuids_en_grupo`
//
// MEDIDO contra PostgreSQL 16.15 con las 439 migraciones sobre base virgen,
// con el par mixto que la 0365 documenta como «la ÚNICA forma que puede tomar
// un par de copias de un comprobante con folio fiscal» — un ticket de diésel
// de $2,500, folio 1234, fotografiado dos veces (la 1ª sin CFDI porque el OCR
// lo leyó ilegible, la 2ª con CFDI):
//
//   gasto_por_concepto_tenant        →  diesel · n 2 · $5,000.00
//   gastos_fiscales_agregados_tenant →  diesel · 1 fila · $2,500.00
//
// La parte SQL de esa medición vive en `supabase/tests/0704_gasto_por_concepto_dedup.sql`
// (corre en ci-postgres contra Postgres real). Lo de aquí es la otra mitad: el
// agrupador por concepto sobre comprobantes ya deduplicados, y el escaneo de
// fuente que impide que la pantalla vuelva a la sede cruda.
// ═══════════════════════════════════════════════════════════════════════════

function gasto(over: Partial<GastoFiscal> = {}): GastoFiscal {
  return {
    id: 'g1', viajeId: 'v1', concepto: 'diesel', monto: 1000,
    fecha: '2026-03-01', folio: 'A1', rfcEmisor: 'AAA010101AAA',
    cfdiUuid: 'uuid-1', cfdiValido: null, estadoSat: 'vigente',
    efos: false, efosRevisar: null, formaPago: '03',
    subTotal: null, ivaTraslado: null, iepsTraslado: null,
    claveProdServ: null, tipoComprobante: 'I', xmlVerificado: true,
    ocrConfianza: 0.9, viajeFolio: 'VJ-1', operadorNombre: 'Juan',
    plazoVencido: null, liquidacionFirmada: true, rfcReceptor: 'REC010101AA1',
    monedaExtranjera: false, renglonesAjenos: false, consumoBar: false,
    complementoHidrocarburosFalta: false, otroEjercicio: false,
    ...over,
  };
}

function leer(ruta: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- lee la FUENTE del propio repo en tiempo de prueba; la ruta es una constante de este archivo, no entrada de usuario.
  return readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8');
}

describe('gastoPorConceptoFiscal — el agrupador de la sede deduplicada', () => {
  it('el par mixto ya viene como UNA fila: $2,500 y 1 carga, igual que el PDF', () => {
    // Lo que la 0702 entrega para el ticket del escenario: una sola fila, la
    // que sobrevive al dedup. Antes la pantalla recibía las DOS filas crudas y
    // pintaba $5,000 · 2 cargas.
    const r = gastoPorConceptoFiscal([
      gasto({ id: 'sobreviviente', concepto: 'diesel', monto: 2500, folio: '1234', cfdiUuid: null }),
    ]);
    expect(r).toEqual([{ concepto: 'diesel', n: 1, total: 2500 }]);
  });

  it('agrupa todos los conceptos, no solo diésel y caseta — la Dona los pinta todos', () => {
    const r = gastoPorConceptoFiscal([
      gasto({ id: 'a', concepto: 'diesel', monto: 2500 }),
      gasto({ id: 'b', concepto: 'caseta', monto: 480.5 }),
      gasto({ id: 'c', concepto: 'caseta', monto: 319.5 }),
      gasto({ id: 'd', concepto: 'alimentacion', monto: 210 }),
    ]);
    expect(r).toEqual([
      { concepto: 'diesel', n: 1, total: 2500 },
      { concepto: 'caseta', n: 2, total: 800 },
      { concepto: 'alimentacion', n: 1, total: 210 },
    ]);
  });

  it('un comprobante sin concepto cae en «otro», igual que el `coalesce` de la 0150', () => {
    const r = gastoPorConceptoFiscal([gasto({ concepto: '', monto: 100 })]);
    expect(r).toEqual([{ concepto: 'otro', n: 1, total: 100 }]);
  });

  it('una celda consolidada cuenta sus n comprobantes, no 1 — el rótulo dice «cargas registradas»', () => {
    // `consolidarCeldasPorEmisor` funde las celdas sin CFDI del mismo emisor;
    // la fila resultante representa `celda.n` comprobantes. Contar `.length`
    // habría convertido el arreglo de ARQ-A3 en una cifra corta, que es el
    // error opuesto y del mismo tamaño.
    const r = gastoPorConceptoFiscal([
      { ...gasto({ id: 'celda', concepto: 'caseta', monto: 900 }), celda: { n: 4 } } as GastoFiscal,
    ]);
    expect(r).toEqual([{ concepto: 'caseta', n: 4, total: 900 }]);
  });

  it('redondea a dos decimales UNA vez, al final — no acumula el error por fila', () => {
    const r = gastoPorConceptoFiscal([
      gasto({ id: 'a', concepto: 'diesel', monto: 0.005 }),
      gasto({ id: 'b', concepto: 'diesel', monto: 0.005 }),
    ]);
    expect(r).toEqual([{ concepto: 'diesel', n: 2, total: 0.01 }]);
  });

  it('sin comprobantes devuelve [] — la pantalla distingue vacío de fallo', () => {
    // `safe()` devuelve `null` cuando la lectura truena; `[]` es "no hay
    // nada". Confundirlos es cómo un panel ciego afirma $0.00.
    expect(gastoPorConceptoFiscal([])).toEqual([]);
  });
});

describe('ARQ-A3: la pantalla del contralor lee la sede deduplicada, no `gasto` crudo', () => {
  const page = leer('../../app/dashboard/combustible-casetas/page.tsx');

  it('combustible-casetas/page.tsx NO llama `getGastoPorConcepto` (la sede cruda de la 0150)', () => {
    expect(page).not.toMatch(/getGastoPorConcepto/);
  });

  it('pasa por `getGastosFiscales` + `gastoPorConceptoFiscal` — la misma sede que el PDF', () => {
    expect(page).toMatch(/gastoPorConceptoFiscal\(/);
    expect(page).toMatch(/getGastosFiscales\(tenantId,\s*resolverPeriodo\('todo',\s*hoy\)/);
  });

  it("la ventana sigue siendo el histórico: `resolverPeriodo('todo')`, no un mes", () => {
    // El rótulo del tile dice «histórico». Si alguien cambia esta ventana sin
    // cambiar el rótulo, la pantalla miente — CLAUDE.md: un rótulo tiene que
    // ser verdad.
    expect(page).toMatch(/resolverPeriodo\('todo'/);
    expect(page).toMatch(/histórico · \$\{numero\(diesel\.n\)\} cargas registradas/);
  });
});
