// ═══════════════════════════════════════════════════════════════════════════
// AUD24 · PRU-A2 (ALTO, REINCIDENTE) — `archivoSapB1` (formatos.ts:159-169)
// numera `Line_ID` con el índice de `.entries()`. `formatos.ts` marca 100% de
// líneas, pero ninguna prueba afirma el VALOR de esa columna: la mutación M14
// (`linea` → `0 * linea`, colapsando todo Line_ID a 0) pasa 100% de líneas
// igual.
//
// Con `Line_ID` repetido dentro del mismo `JdtNum`, el Data Transfer
// Workbench de SAP importa un asiento corrupto (dos renglones con la misma
// llave se pisan o se rechazan, según la versión).
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { polizaDeLiquidacion, type CatalogoContable, type LiquidacionParaPoliza } from './poliza';
import { archivoSapB1, SAP_B1_BASE } from './formatos';

const CATALOGO: CatalogoContable = {
  gastos: { diesel: '5010-001', caseta: '5010-002', alimentacion: '5010-003' },
  ivaAcreditable: '1180-001',
  ivaNoAcreditable: '1180-002',
  anticipoOperador: '1190-001',
  porCobrarOperador: '1190-002',
  porPagarOperador: '2010-001',
};

// Diesel + caseta + IVA + anticipo: al menos 3 movimientos, suficiente para
// que "todo Line_ID = 0" sea observable (con 1 solo movimiento, 0*0 = 0 igual
// que 0, y la mutación pasaría desapercibida).
const LIQ: LiquidacionParaPoliza = {
  folioViaje: 'VJ-2026-0007',
  operador: 'Juan Pérez',
  fecha: '2026-08-20',
  anticipo: 5000,
  porConcepto: [
    { concepto: 'diesel', subtotal: 3000 },
    { concepto: 'caseta', subtotal: 1000 },
  ],
  ivaAcreditable: 640,
  diferencia: 360,
};

describe('PRU-A2: Line_ID de SAP B1 es 0..n-1 sin repetir dentro del mismo JdtNum', () => {
  it('cada renglón de JournalEntries_Lines trae un Line_ID distinto, en orden', () => {
    const r = polizaDeLiquidacion(LIQ, CATALOGO);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.poliza.movimientos.length).toBeGreaterThanOrEqual(3);

    const { lineas } = archivoSapB1([r.poliza], SAP_B1_BASE);
    const filas = lineas.trim().split('\n').slice(2); // sin las 2 filas de cabecera técnica/visible
    expect(filas.length).toBe(r.poliza.movimientos.length);

    const lineIds = filas.map((f) => Number(f.split('\t')[1]));
    expect(lineIds).toEqual(r.poliza.movimientos.map((_, i) => i));
    // Ninguno repetido: exactamente lo que "Line_ID = 0 en todos" rompería.
    expect(new Set(lineIds).size).toBe(lineIds.length);
  });
});
