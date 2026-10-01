import { describe, it, expect } from 'vitest';
import { celdaTexto, celdaNumero, filaCsv, csvLiquidacionesExternas, ENCABEZADOS_CSV } from './csv';
import type { LiquidacionExterna } from './repo';

// ═══════════════════════════════════════════════════════════════════════════
// EL CSV QUE LA OFICINA ABRE EN EXCEL.
//
// Todo el texto viene de un sistema ajeno, y una celda que empieza con `=`, `+`,
// `-` o `@` la evalúa Excel como FÓRMULA. Se neutraliza — pero las CIFRAS no se
// tocan: un total negativo legítimo tiene que seguir siendo un número.
// ═══════════════════════════════════════════════════════════════════════════

const liq = (p: Partial<LiquidacionExterna> = {}): LiquidacionExterna => ({
  id: '11111111-1111-4111-8111-111111111111', tenantId: 't-1', claveExterna: 'SAP-1', huella: 'h'.repeat(64),
  sistemaOrigen: 'SAP', operadorId: 'o-1', operadorNombre: 'Juan Pérez', operadorTelefono: '525512345678',
  foliosViaje: ['VJ-1', 'VJ-2'], viajeIds: [], periodoDesde: '2026-09-01', periodoHasta: '2026-09-07',
  conceptos: [], total: 2499.75, moneda: 'MXN', pdfRuta: 't-1/externas/x.pdf', pdfOrigen: 'generado',
  estado: 'acusada', via: 'sesion', generacion: 1, intentos: 1, proximoIntentoEn: '2026-09-08T00:00:00Z',
  ultimoError: null, wamid: 'wamid.X', enviadaEn: '2026-09-08T10:00:00Z', acuseTipo: 'no_coincide',
  acuseEn: '2026-09-08T11:00:00Z', creadaEn: '2026-09-08T09:00:00Z', ...p,
});

describe('celdaTexto: la inyección de fórmulas', () => {
  it('neutraliza = + - @ tab y retorno al inicio', () => {
    for (const v of ['=HYPERLINK("http://x","y")', '+cmd', '-2+3', '@SUM(A1)', '\t=1', '\r=1']) {
      expect(celdaTexto(v).replace(/^"/, '').startsWith("'"), v).toBe(true);
    }
  });
  it('no toca el texto normal ni los guiones en medio', () => {
    expect(celdaTexto('Juan Pérez')).toBe('Juan Pérez');
    expect(celdaTexto('VJ-100')).toBe('VJ-100');
  });
  it('escapa comillas, comas y saltos', () => {
    expect(celdaTexto('di "hola", ya')).toBe('"di ""hola"", ya"');
    expect(celdaTexto('a\nb')).toBe('"a\nb"');
  });
  it('null y undefined salen vacíos', () => {
    expect(celdaTexto(null)).toBe('');
    expect(celdaTexto(undefined)).toBe('');
  });
});

describe('celdaNumero', () => {
  it('conserva el signo y dos decimales', () => {
    expect(celdaNumero(-350)).toBe('-350.00');
    expect(celdaNumero(2499.75)).toBe('2499.75');
    expect(celdaNumero(0)).toBe('0.00');
  });
  it('lo que no es número finito sale vacío, jamás un cero inventado', () => {
    expect(celdaNumero(Number.NaN)).toBe('');
    expect(celdaNumero(Number.POSITIVE_INFINITY)).toBe('');
    expect(celdaNumero(null)).toBe('');
  });
});

describe('el archivo', () => {
  it('lleva encabezado, una fila por liquidación y su moneda por fila', () => {
    const csv = csvLiquidacionesExternas([liq(), liq({ claveExterna: 'SAP-2', moneda: 'USD', total: -10 })]);
    const lineas = csv.trimEnd().split('\n');
    expect(lineas[0]).toBe(ENCABEZADOS_CSV.join(','));
    expect(lineas).toHaveLength(3);
    expect(lineas[1]).toContain(',MXN,');
    expect(lineas[2]).toContain(',-10.00,USD,');
  });

  it('sin filas devuelve solo el encabezado (y no una cadena vacía que Excel abriría en blanco)', () => {
    expect(csvLiquidacionesExternas([])).toBe(`${ENCABEZADOS_CSV.join(',')}\n`);
  });

  it('un nombre o un concepto hostil no se vuelve fórmula', () => {
    const fila = filaCsv(liq({ operadorNombre: '=cmd|\' /C calc\'!A0', claveExterna: '@evil', sistemaOrigen: '+x' }));
    expect(fila).toContain("'=cmd");
    expect(fila.startsWith("'@evil")).toBe(true);
    expect(fila).toContain(",'+x,");
  });

  it('el estado, la vía y la respuesta del chofer van legibles', () => {
    const fila = filaCsv(liq());
    expect(fila).toContain('acusada');
    expect(fila).toContain('sesion');
    expect(fila).toContain('no coincide');
  });

  it('una liquidación sin respuesta deja esas celdas vacías', () => {
    const fila = filaCsv(liq({ acuseTipo: null, acuseEn: null, estado: 'enviada' }));
    expect(fila).toContain(',enviada,sesion,,,');
  });

  it('el error de entrega viaja, pero jamás rompe la fila', () => {
    const fila = filaCsv(liq({ ultimoError: 'terminal:HTTP 400: {"error":{"code":131047}}\n=bad' }));
    expect(fila.split('\n').length).toBeGreaterThan(1); // el salto va entre comillas
    expect(fila).toContain('"terminal:HTTP 400: {""error"":{""code"":131047}}\n=bad"');
  });
});
