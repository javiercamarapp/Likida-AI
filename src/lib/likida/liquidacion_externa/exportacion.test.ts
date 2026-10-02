import { describe, it, expect } from 'vitest';
import type { LiquidacionExterna } from './repo';
import { leerOpcionesExportacion, generarExportacion, CATALOGO_COLUMNAS, COLUMNAS_POR_DEFECTO } from './exportacion';

// La exportación configurable hacia el SAP/TMS: el layout lo decide el cliente por
// parámetros; lo que se fija aquí es que cada opción hace lo que dice, que lo
// inválido se rechaza diciendo qué aceptar y que un texto hostil no se vuelve fórmula.

const liq = (p: Partial<LiquidacionExterna> = {}): LiquidacionExterna => ({
  id: '11111111-1111-4111-8111-111111111111', tenantId: 't-1', claveExterna: 'SAP-1', huella: 'x'.repeat(64),
  sistemaOrigen: 'SAP', operadorId: 'o-1', operadorNombre: 'Juan Pérez', operadorTelefono: '525512345678',
  foliosViaje: ['VJ-1', 'VJ-2'], viajeIds: [], periodoDesde: '2026-09-01', periodoHasta: '2026-09-07',
  conceptos: [
    { clave: 'P010', descripcion: 'Sueldo', tipo: 'percepcion', monto: 1500.5 },
    { clave: 'D020', descripcion: 'Anticipo', tipo: 'deduccion', monto: 300 },
  ],
  total: 1200.5, moneda: 'MXN', pdfRuta: 't-1/externas/SECRETA.pdf', pdfOrigen: 'generado', estado: 'acusada', via: 'sesion',
  generacion: 1, intentos: 1, proximoIntentoEn: 'x', ultimoError: null, wamid: 'wamid.X', enviadaEn: '2026-09-08T10:00:00Z',
  acuseTipo: 'no_coincide', acuseEn: '2026-09-09T18:30:00Z', acuseConfirmadoEn: null, creadaEn: '2026-09-08T09:00:00.000Z', ...p,
});
const q = (s: string) => new URLSearchParams(s);
const opc = (s = '') => { const r = leerOpcionesExportacion(q(s)); if (!r.ok) throw new Error(r.mensaje); return r.opciones; };

describe('leerOpcionesExportacion', () => {
  it('sin parámetros usa el layout por defecto de la granularidad', () => {
    expect(opc().columnas).toEqual(COLUMNAS_POR_DEFECTO.liquidacion);
    expect(opc('granularidad=concepto').columnas).toEqual(COLUMNAS_POR_DEFECTO.concepto);
  });

  it('todas las columnas por defecto existen en el catálogo', () => {
    for (const g of ['liquidacion', 'concepto'] as const) for (const c of COLUMNAS_POR_DEFECTO[g]) expect(CATALOGO_COLUMNAS[c], c).toBeDefined();
  });

  it('rechaza lo desconocido y dice qué aceptar', () => {
    for (const [s, re] of [
      ['granularidad=otra', /granularidad/], ['separador=pipe', /separador/], ['decimal=x', /decimal/], ['fechas=us', /fechas/],
      ['bom=2', /bom/], ['columnas=claveExterna,inventada', /inventada.*no existe/], ['columnas=claveExterna,claveExterna', /repetir/],
      ['columnas=conceptoMonto', /solo existe con `granularidad=concepto`/], ['columnas=', /./],
    ] as const) {
      const r = leerOpcionesExportacion(q(s));
      if (s === 'columnas=') { expect(r.ok).toBe(true); continue; } // vacío = defecto
      expect(r.ok, s).toBe(false);
      if (!r.ok) expect(r.mensaje, s).toMatch(re);
    }
  });

  it('coma decimal con coma de columnas es ambiguo y se rechaza; con punto y coma o tab sí', () => {
    expect(leerOpcionesExportacion(q('decimal=coma')).ok).toBe(false);
    expect(leerOpcionesExportacion(q('decimal=coma&separador=punto_y_coma')).ok).toBe(true);
    expect(leerOpcionesExportacion(q('decimal=coma&separador=tab')).ok).toBe(true);
  });

  it('un nombre de columna tipo prototipo no cuela (`constructor`, `__proto__`)', () => {
    for (const c of ['constructor', '__proto__', 'toString']) expect(leerOpcionesExportacion(q(`columnas=${c}`)).ok, c).toBe(false);
  });

  it('más de 30 columnas se rechaza', () => {
    const muchas = Array.from({ length: 31 }, (_, i) => `c${i}`).join(',');
    expect(leerOpcionesExportacion(q(`columnas=${muchas}`)).ok).toBe(false);
  });
});

describe('generarExportacion', () => {
  it('columnas elegidas, en ese orden, con encabezado', () => {
    const t = generarExportacion([liq()], opc('columnas=total,claveExterna,moneda'));
    expect(t).toBe('total,claveExterna,moneda\n1200.50,SAP-1,MXN\n');
  });

  it('separador y decimal configurables (formato típico de un Excel/SAP en español)', () => {
    const t = generarExportacion([liq()], opc('columnas=claveExterna,total&separador=punto_y_coma&decimal=coma'));
    expect(t).toBe('claveExterna;total\nSAP-1;1200,50\n');
    expect(generarExportacion([liq()], opc('columnas=claveExterna,total&separador=tab'))).toBe('claveExterna\ttotal\nSAP-1\t1200.50\n');
  });

  it('un texto que contiene el separador elegido se entrecomilla (si no, desplaza columnas)', () => {
    const t = generarExportacion([liq({ operadorNombre: 'Pérez; Juan' })], opc('columnas=operador,total&separador=punto_y_coma'));
    expect(t).toBe('operador;total\n"Pérez; Juan";1200.50\n');
  });

  it('fechas: iso, dmy y sap; los instantes se expresan en el día de México', () => {
    const base = 'columnas=periodoDesde,respuestaEn';
    expect(generarExportacion([liq()], opc(`${base}&fechas=iso`))).toBe('periodoDesde,respuestaEn\n2026-09-01,2026-09-09\n');
    expect(generarExportacion([liq()], opc(`${base}&fechas=dmy`))).toBe('periodoDesde,respuestaEn\n01/09/2026,09/09/2026\n');
    expect(generarExportacion([liq()], opc(`${base}&fechas=sap`))).toBe('periodoDesde,respuestaEn\n20260901,20260909\n');
    // 03:00 UTC = 21:00 del día anterior en México
    expect(generarExportacion([liq({ acuseEn: '2026-09-10T03:00:00Z' })], opc(`${base}&fechas=iso`))).toContain(',2026-09-09');
  });

  it('bom y sin encabezado', () => {
    const t = generarExportacion([liq()], opc('columnas=claveExterna&bom=1&encabezado=0'));
    expect(t).toBe('﻿SAP-1\n');
  });

  it('granularidad concepto: UNA fila por renglón, con monto firmado (deducción en negativo)', () => {
    const t = generarExportacion([liq()], opc('granularidad=concepto&columnas=claveExterna,conceptoClave,conceptoTipo,conceptoMonto,conceptoMontoFirmado'));
    expect(t.trim().split('\n')).toEqual([
      'claveExterna,conceptoClave,conceptoTipo,conceptoMonto,conceptoMontoFirmado',
      'SAP-1,P010,percepcion,1500.50,1500.50',
      'SAP-1,D020,deduccion,300.00,-300.00',
    ]);
  });

  it('INYECCIÓN DE FÓRMULAS: el texto hostil se neutraliza, las cifras negativas no', () => {
    const t = generarExportacion([liq({ operadorNombre: '=HYPERLINK("http://x")', sistemaOrigen: '@SUM(A1)', total: -350 })], opc('columnas=operador,sistemaOrigen,total'));
    const [, fila] = t.trim().split('\n');
    expect(fila).toBe('"\'=HYPERLINK(""http://x"")",\'@SUM(A1),-350.00');
  });

  it('el error crudo de entrega NUNCA sale: solo el código estable', () => {
    const t = generarExportacion([liq({ estado: 'fallida', ultimoError: 'terminal:HTTP 400: {"error":{"code":132001,"message":"relation foo"}}' })], opc('columnas=claveExterna,falloCodigo'));
    expect(t).toContain('plantilla_no_aprobada');
    expect(t).not.toMatch(/relation|HTTP 400|132001/);
  });

  it('los datos que no son del archivo no salen: ni teléfono ni ruta del PDF (no existen en el catálogo)', () => {
    const todas = generarExportacion([liq()], opc(`columnas=${Object.entries(CATALOGO_COLUMNAS).filter(([, c]) => !c.soloEn).map(([k]) => k).join(',')}`));
    expect(todas).not.toMatch(/525512345678|SECRETA|wamid/);
  });

  it('sin filas: solo el encabezado; con encabezado apagado, nada', () => {
    expect(generarExportacion([], opc('columnas=claveExterna'))).toBe('claveExterna\n');
    expect(generarExportacion([], opc('columnas=claveExterna&encabezado=0'))).toBe('');
  });

  it('una liquidación sin acuse deja vacías las columnas del acuse (nunca «null»)', () => {
    const t = generarExportacion([liq({ acuseTipo: null, acuseEn: null, via: null })], opc('columnas=respuestaChofer,respuestaEn,via,acuseConfirmadoEn'));
    expect(t).toBe('respuestaChofer,respuestaEn,via,acuseConfirmadoEn\n,,,\n');
  });
});
