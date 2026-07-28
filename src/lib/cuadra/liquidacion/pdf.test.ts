import { describe, it, expect } from 'vitest';
import { generarLiquidacionPDF } from './pdf';
import type { Liquidacion, Viaje, Operador } from '@/types/cuadra';

// ═══════════════════════════════════════════════════════════════════════════
// EL SANEADO A WinAnsi TENÍA UN HUECO EN LO QUE DICE PROTEGER.
//
// pdf-lib con la fuente estándar Helvetica codifica WinAnsi, que no mapea todo
// Unicode. Por eso hay un saneador: "cualquier char fuera de Latin-1 sin mapeo →
// '?' para que el PDF NUNCA truene por datos de OCR".
//
// Pero el rango del regex empezaba en un byte NUL literal —invisible en el
// editor, donde parecía un espacio— en vez de en el espacio 0x20. Con `\x00-ÿ`
// los caracteres de CONTROL quedan DENTRO del rango permitido y pasan enteros a
// drawText.
//
// Y los datos de aquí vienen de OCR de fotos de tickets térmicos: exactamente de
// donde salen los bytes raros.
//
// El NUL además hacía que `file` clasificara pdf.ts como binario, así que git no
// mostraba sus diffs y las búsquedas que saltan binarios no lo encontraban.
// ═══════════════════════════════════════════════════════════════════════════
const liq = (extra: Partial<Liquidacion> = {}): Liquidacion => ({
  id: 'l1', viajeId: 'v1', creadaEn: '2026-05-02T10:00:00Z',
  totalComprobado: 1000, totalAnticipo: 1000, diferencia: 0, estatus: 'cuadrada',
  totalDeducible: 1000, totalNoDeducible: 0, totalPorConfirmar: 0,
  iepsAcreditable: 0, litrosDieselAcreditables: 0, ivaAcreditable: 0, peajeAcreditable: 0,
  diferencias: [], gastos: [{ id: 'g1', concepto: 'diesel', monto: 1000, folio: 'A1', fecha: '2026-05-01' }],
  ...extra,
});
const viaje: Viaje = { id: 'v1', folio: 'VJ-1', origen: 'Mérida', destino: 'Cancún', anticipo: 1000 };
const operador: Operador = { id: 'o1', nombre: 'Juan Pérez', telefono: '+52', terminal: 'Mérida' };

describe('generarLiquidacionPDF — saneado de texto', () => {
  it('aguanta caracteres de CONTROL en datos de OCR', async () => {
    // Un ticket térmico mal leído puede meter \x01, \x1b (escape de impresora),
    // \t o \r en cualquier campo de texto.
    const sucio: Operador = { ...operador, nombre: 'Juan\x01P\x1bérez\r\tGómez' };
    const bytes = await generarLiquidacionPDF(liq(), { ...viaje, origen: 'Mé\x00rida', destino: 'Can\x07cún' }, sucio);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('aguanta un carácter de control en la NOTA de una diferencia', async () => {
    const l = liq({ diferencias: [{ tipo: 'sin_cfdi', concepto: 'diesel', monto: 0, nota: 'Falta CFDI\x1b[0m del diésel', gastoId: 'g1' }] });
    const bytes = await generarLiquidacionPDF(l, viaje, operador);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('sigue generando bien el caso normal', async () => {
    const bytes = await generarLiquidacionPDF(liq(), viaje, operador, 'TRANSPORTES DEL SURESTE SA DE CV');
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('no deja bytes de control en el fuente del propio módulo', async () => {
    // El NUL de la línea 91 hacía que `file` clasificara pdf.ts como binario:
    // git no mostraba sus diffs y las búsquedas que saltan binarios lo ignoraban
    // entero. Un archivo de código no puede tener bytes de control.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./pdf.ts', import.meta.url));
    const malos = [...src].filter((b) => b < 0x09 || (b > 0x0d && b < 0x20));
    expect(malos, 'hay bytes de control en pdf.ts').toHaveLength(0);
  });
});
