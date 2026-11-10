import type { FacturaSaasFila } from './transferencia';

// ═══════════════════════════════════════════════════════════════════════════
// EL CSV PARA EL CONTADOR: las facturas de la mensualidad de Likida a sus flotas, una fila por factura, con el desglose que va (o
// iba a ir) en el CFDI. PURO: recibe las filas ya leídas y devuelve texto. No inventa nada: un dato que la fila no tiene sale
// VACÍO (jamás 0), y una factura sin desglose lo dice en la columna «Observación» porque esa factura no se puede timbrar.
//
// · Montos con punto decimal y dos decimales, sin separador de millares ni símbolo: es lo que una hoja de cálculo y un sistema
//   contable leen sin ambigüedad (el formato de pantalla es otra cosa y vive en lib/formato.ts).
// · Fechas AAAA-MM-DD tal como están guardadas (las de periodo) o en UTC ISO (las de evento).
// · Celdas que empiezan con = + - @ se prefijan con comilla: una referencia tecleada por una persona no debe ejecutarse como fórmula
//   al abrir el archivo en una hoja de cálculo.
// · Salto de línea CRLF y BOM UTF-8 al inicio, para que Excel respete acentos.
// ═══════════════════════════════════════════════════════════════════════════

export const ENCABEZADOS_CSV_FACTURAS = [
  'Folio interno', 'Flota', 'Periodo inicio', 'Periodo fin', 'Estado', 'Moneda', 'Subtotal', 'IVA', 'Total',
  'Referencia de pago', 'Referencia del banco', 'Pagada en', 'Conciliada en', 'UUID del CFDI', 'Timbrada en', 'CFDI cancelado en', 'Observación',
] as const;

const PELIGROSAS = /^[=+\-@\t\r]/;

export function celdaCsv(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return '';
  let s = typeof valor === 'number' ? (Number.isFinite(valor) ? valor.toFixed(2) : '') : String(valor);
  if (typeof valor === 'string' && PELIGROSAS.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function observacion(f: FacturaSaasFila): string {
  const notas: string[] = [];
  if (f.subtotal === null || f.iva === null) notas.push('Sin desglose de IVA: no se puede timbrar');
  if (f.estado === 'pagada' && !f.cfdiUuid) notas.push('Pagada sin CFDI timbrado');
  if (f.cfdiCanceladoEn) notas.push('CFDI cancelado');
  return notas.join('; ');
}

export function facturasACsv(filas: readonly FacturaSaasFila[]): string {
  const lineas = [ENCABEZADOS_CSV_FACTURAS.map((h) => celdaCsv(h)).join(',')];
  for (const f of filas) {
    lineas.push([
      f.id, f.tenantNombre, f.periodoInicio, f.periodoFin, f.estado, f.moneda, f.subtotal, f.iva, f.monto,
      f.referencia, f.referenciaBanco, f.pagadaEn, f.conciliadaEn, f.cfdiUuid, f.timbradaEn, f.cfdiCanceladoEn, observacion(f),
    ].map(celdaCsv).join(','));
  }
  return `﻿${lineas.join('\r\n')}\r\n`;
}
