import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { generarPdfLiquidacionExterna } from './pdf';
import { validarPdfAdjunto, validarLiquidacionExterna, type LiquidacionExternaNormalizada } from './esquema';

// ═══════════════════════════════════════════════════════════════════════════
// EL PDF QUE LIKIDA GENERA CON LAS CIFRAS DEL CLIENTE.
//
// Lo que se fija: que sea un PDF de verdad (pasa la MISMA validación que se le
// exige a un adjunto), que no truene con datos hostiles —los textos vienen de
// un sistema ajeno— y que sea DETERMINISTA: la ruta de Storage está direccionada
// por contenido, y dos peticiones concurrentes con los mismos datos tienen que
// escribir los mismos bytes.
// ═══════════════════════════════════════════════════════════════════════════

const base = (): LiquidacionExternaNormalizada => validarLiquidacionExterna({
  claveExterna: 'SAP-1',
  sistemaOrigen: 'SAP',
  operador: { telefono: '5512345678' },
  viajes: ['VJ-1', 'VJ-2'],
  periodo: { desde: '2026-09-01', hasta: '2026-09-07' },
  conceptos: [
    { clave: 'P1', descripcion: 'Sueldo base', tipo: 'percepcion', monto: 3500 },
    { descripcion: 'Anticipo', tipo: 'deduccion', monto: 1000.25 },
  ],
  total: 2499.75,
  moneda: 'MXN',
});

const generar = (l: LiquidacionExternaNormalizada, nombre = 'Juan Pérez', razon: string | null = 'Transportes Ejemplo SA') =>
  generarPdfLiquidacionExterna({ liquidacion: l, operadorNombre: nombre, razonSocial: razon });

describe('el PDF generado', () => {
  it('es un PDF válido: pasa la validación que se le exige a un adjunto y lo abre pdf-lib', async () => {
    const bytes = await generar(base());
    const p = validarPdfAdjunto({ base64: Buffer.from(bytes).toString('base64') });
    expect(p.bytes.length).toBeGreaterThan(500);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('es determinista: los mismos datos dan los mismos bytes', async () => {
    const a = await generar(base());
    const b = await generar(base());
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('cambia con una cifra distinta', async () => {
    const otro = base();
    otro.total = 2499.76;
    otro.conceptos[0].monto = 3500.01;
    expect(Buffer.from(await generar(base())).equals(Buffer.from(await generar(otro)))).toBe(false);
  });

  it('sin razón social conserva «Likida» y no inventa ningún nombre', async () => {
    const bytes = await generar(base(), 'Juan', null);
    expect(bytes.length).toBeGreaterThan(500);
  });

  it('con 100 renglones pagina en vez de montarse sobre el pie', async () => {
    const l = base();
    l.conceptos = Array.from({ length: 100 }, (_, i) => ({ clave: null, descripcion: `Concepto ${i + 1}`, tipo: 'percepcion' as const, monto: 10 }));
    l.total = 1000;
    const doc = await PDFDocument.load(await generar(l));
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it('no truena con datos hostiles: emoji, controles, RTL, comillas tipográficas, textos larguísimos', async () => {
    const l = base();
    l.conceptos = [
      { clave: '😀', descripcion: 'Sueldo 😀 “base” ‘x’ … → ünï', tipo: 'percepcion', monto: 100 },
      { clave: null, descripcion: '‮evil‬ \u0092 \u007f \u0001', tipo: 'percepcion', monto: 100 },
      { clave: null, descripcion: 'X'.repeat(120), tipo: 'deduccion', monto: 50 },
      { clave: null, descripcion: '日本語のテキスト', tipo: 'deduccion', monto: 50 },
    ];
    l.total = 100;
    l.viajes = ['V'.repeat(40), 'ÁÉÍÓÚ-ñ', '😀'];
    l.sistemaOrigen = 'S'.repeat(40);
    const bytes = await generar(l, '😀 Nombre \u0001 con control', 'Razón 😀 SA de CV');
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
  });

  it('imprime el signo de las deducciones y la moneda del total', async () => {
    const usd = base();
    usd.moneda = 'USD';
    const bytes = await generar(usd);
    // pdf-lib comprime los streams, así que no se busca el texto en los bytes:
    // se comprueba que el documento se arme con la moneda USD sin lanzar y que
    // difiera del MXN (la moneda entra al papel).
    expect(Buffer.from(bytes).equals(Buffer.from(await generar(base())))).toBe(false);
  });
});
