import { describe, it, expect } from 'vitest';
import {
  validarLiquidacionExterna, huellaContenido, validarPdfAdjunto, aCentavos,
  MAX_CONCEPTOS, MAX_VIAJES, MAX_PDF_BYTES, MAX_DIAS_PERIODO,
} from './esquema';
import { CampoInvalido } from '@/app/api/v1/_escritura';

// ═══════════════════════════════════════════════════════════════════════════
// LA VALIDACIÓN ESTRICTA DEL POST /v1/liquidaciones-externas.
//
// Lo que se fija: nada se acepta en silencio. Un campo desconocido, un decimal
// de más, un total que no cuadra con los renglones, un texto largo o un PDF que
// no lo es son 400 con el campo señalado — porque lo que pasa esta puerta llega
// al teléfono de un chofer con la firma de su patrón.
// ═══════════════════════════════════════════════════════════════════════════

const BASE = () => ({
  claveExterna: 'SAP-LIQ-000123',
  sistemaOrigen: 'SAP',
  operador: { telefono: '5512345678' },
  viajes: ['VJ-100', 'VJ-101'],
  periodo: { desde: '2026-09-01', hasta: '2026-09-07' },
  conceptos: [
    { clave: 'P010', descripcion: 'Sueldo base', tipo: 'percepcion', monto: 3500 },
    { clave: 'P020', descripcion: 'Comisión por viaje', tipo: 'percepcion', monto: 1200.5 },
    { clave: 'D010', descripcion: 'Anticipo', tipo: 'deduccion', monto: 1000.25 },
  ],
  total: 3700.25,
  moneda: 'MXN',
}) as Record<string, unknown>;

const rechaza = (cuerpo: Record<string, unknown>, campo?: string, texto?: RegExp) => {
  try {
    validarLiquidacionExterna(cuerpo);
  } catch (e) {
    expect(e).toBeInstanceOf(CampoInvalido);
    if (campo) expect((e as CampoInvalido).campo).toBe(campo);
    if (texto) expect((e as CampoInvalido).message).toMatch(texto);
    return;
  }
  throw new Error('debió rechazar');
};

/** Un PDF mínimo y bien formado, en base64. */
const PDF_MIN = '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';
const b64 = (s: string | Uint8Array) => Buffer.from(s).toString('base64');

describe('el caso feliz', () => {
  it('normaliza y devuelve las cifras tal cual, en pesos con dos decimales', () => {
    const n = validarLiquidacionExterna(BASE());
    expect(n.claveExterna).toBe('SAP-LIQ-000123');
    expect(n.total).toBe(3700.25);
    expect(n.conceptos.map((c) => c.monto)).toEqual([3500, 1200.5, 1000.25]);
    expect(n.operador.telefono).toBe('525512345678');
    expect(n.pdf).toBeNull();
  });

  it('acepta montos como texto (un CSV de un TMS manda todo como texto) y coma decimal', () => {
    const c = BASE();
    c.total = '3,700.25';
    (c.conceptos as Array<Record<string, unknown>>)[0].monto = '3500.00';
    expect(validarLiquidacionExterna(c).total).toBe(3700.25);
  });

  it('acepta un total NEGATIVO cuando las deducciones superan las percepciones (el chofer debe)', () => {
    const c = BASE();
    c.conceptos = [
      { descripcion: 'Sueldo', tipo: 'percepcion', monto: 500 },
      { descripcion: 'Faltante de combustible', tipo: 'deduccion', monto: 1250.4 },
    ];
    c.total = -750.4;
    expect(validarLiquidacionExterna(c).total).toBe(-750.4);
  });

  it('acepta un total en CERO medido (no es lo mismo que ausente)', () => {
    const c = BASE();
    c.conceptos = [
      { descripcion: 'Sueldo', tipo: 'percepcion', monto: 100 },
      { descripcion: 'Anticipo', tipo: 'deduccion', monto: 100 },
    ];
    c.total = 0;
    expect(validarLiquidacionExterna(c).total).toBe(0);
  });

  it('acepta USD y se queda con la moneda', () => {
    const c = BASE();
    c.moneda = 'USD';
    expect(validarLiquidacionExterna(c).moneda).toBe('USD');
  });

  it('deja pasar los campos opcionales ausentes', () => {
    const c = BASE();
    delete c.sistemaOrigen;
    (c.conceptos as Array<Record<string, unknown>>).forEach((x) => delete x.clave);
    const n = validarLiquidacionExterna(c);
    expect(n.sistemaOrigen).toBeNull();
    expect(n.conceptos[0].clave).toBeNull();
  });

  it('el id del operador se normaliza a minúsculas (Postgres devuelve los uuid así)', () => {
    const c = BASE();
    c.operador = { id: '3F2504E0-4F89-41D3-9A0C-0305E82C3301' };
    expect(validarLiquidacionExterna(c).operador.id).toBe('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
  });

  it('los folios numéricos se normalizan a texto', () => {
    const c = BASE();
    c.viajes = [12345, 'VJ-2'];
    expect(validarLiquidacionExterna(c).viajes).toEqual(['12345', 'VJ-2']);
  });
});

describe('estricta: nada se acepta en silencio', () => {
  it('un campo desconocido en la raíz es 400 y dice cuál (un `totl` no puede volverse una liquidación sin total)', () => {
    const c = BASE();
    c.totl = 5;
    rechaza(c, 'totl', /totl/);
  });

  it('`tenant_id` en el cuerpo es 400: el tenant sale de la credencial, no del cuerpo', () => {
    const c = BASE();
    c.tenant_id = 'otro-tenant';
    rechaza(c, 'tenant_id');
  });

  it('un campo desconocido DENTRO de un concepto, del operador o del periodo también', () => {
    const a = BASE(); (a.conceptos as Array<Record<string, unknown>>)[0].extra = 1; rechaza(a, 'extra');
    const b = BASE(); (b.operador as Record<string, unknown>).rfc = 'X'; rechaza(b, 'rfc');
    const d = BASE(); (d.periodo as Record<string, unknown>).dias = 7; rechaza(d, 'dias');
  });

  it('más de dos decimales se rechaza, no se redondea (un centavo que cambia es un descuadre)', () => {
    const c = BASE();
    (c.conceptos as Array<Record<string, unknown>>)[1].monto = 1200.505;
    rechaza(c, 'conceptos[1].monto', /dos decimales/);
  });

  it('el total que no es la suma de los renglones es 400 y dice la diferencia', () => {
    const c = BASE();
    c.total = 3700.26;
    rechaza(c, 'total', /3700\.26.*3700\.25/);
  });

  it('un renglón sin monto NO es un renglón de cero (VACÍO ≠ CERO)', () => {
    const c = BASE();
    delete (c.conceptos as Array<Record<string, unknown>>)[0].monto;
    rechaza(c, 'conceptos[0].monto', /obligatorio/);
    const d = BASE();
    (d.conceptos as Array<Record<string, unknown>>)[0].monto = '';
    rechaza(d, 'conceptos[0].monto');
    const e = BASE();
    (e.conceptos as Array<Record<string, unknown>>)[0].monto = null;
    rechaza(e, 'conceptos[0].monto');
  });

  it('un total ausente no es un total de cero', () => {
    const c = BASE(); delete c.total; rechaza(c, 'total', /obligatorio/);
    const d = BASE(); d.total = ''; rechaza(d, 'total');
    const e = BASE(); e.total = null; rechaza(e, 'total');
  });

  it('el monto de un renglón no puede ser negativo: el signo lo da el tipo', () => {
    const c = BASE();
    (c.conceptos as Array<Record<string, unknown>>)[2].monto = -1000.25;
    rechaza(c, 'conceptos[2].monto');
  });

  it('el tipo solo admite percepcion o deduccion', () => {
    const c = BASE();
    (c.conceptos as Array<Record<string, unknown>>)[0].tipo = 'bono';
    rechaza(c, 'conceptos[0].tipo', /percepcion/);
  });

  it('NaN, Infinity y booleanos no son montos', () => {
    for (const malo of [Number.NaN, Number.POSITIVE_INFINITY, true, {}, [], 'abc', '1e5', '0x10']) {
      const c = BASE();
      (c.conceptos as Array<Record<string, unknown>>)[0].monto = malo;
      expect(() => validarLiquidacionExterna(c), String(malo)).toThrow(CampoInvalido);
    }
  });

  it('los topes de monto (más de 9,999,999.99) se rechazan', () => {
    const c = BASE();
    c.conceptos = [{ descripcion: 'Mucho', tipo: 'percepcion', monto: 10_000_000 }];
    c.total = 10_000_000;
    rechaza(c);
  });

  it('la moneda tiene que ser MXN o USD; nada de minúsculas ni EUR', () => {
    for (const m of ['mxn', 'EUR', '', 5, null, undefined]) {
      const c = BASE(); c.moneda = m; rechaza(c, 'moneda');
    }
  });

  it('la clave externa: obligatoria, sin espacios, sin caracteres raros y con tope', () => {
    for (const k of [undefined, '', '  ', 'con espacio', '=cmd|calc', '../../etc', 'a'.repeat(121), '-empieza-con-guion', 'x;y']) {
      const c = BASE();
      if (k === undefined) delete c.claveExterna; else c.claveExterna = k;
      expect(() => validarLiquidacionExterna(c), String(k)).toThrow(CampoInvalido);
    }
  });

  it('los textos largos se rechazan, no se recortan', () => {
    const a = BASE(); (a.conceptos as Array<Record<string, unknown>>)[0].descripcion = 'x'.repeat(121); rechaza(a, undefined, /120/);
    const b = BASE(); b.sistemaOrigen = 'S'.repeat(41); rechaza(b, 'sistemaOrigen');
    const d = BASE(); d.viajes = ['V'.repeat(41)]; rechaza(d);
  });

  it('un salto de línea o carácter de control en un texto es 400 (rompe el CSV, el mensaje y el PDF)', () => {
    const a = BASE(); (a.conceptos as Array<Record<string, unknown>>)[0].descripcion = 'Sueldo\nbase'; rechaza(a);
    const b = BASE(); b.viajes = ['VJ\u0000-1']; rechaza(b);
    const c = BASE(); c.sistemaOrigen = 'SAP\r\nX'; rechaza(c);
  });

  it('el operador necesita al menos UNA forma de identificarse', () => {
    const c = BASE(); c.operador = {}; rechaza(c, 'operador');
    const d = BASE(); delete d.operador; rechaza(d, 'operador');
    const e = BASE(); e.operador = 'Juan'; rechaza(e, 'operador');
  });

  it('un teléfono que no es mexicano es 400 con el motivo', () => {
    const c = BASE(); c.operador = { telefono: '123' }; rechaza(c, 'operador.telefono');
  });

  it('un uuid de operador mal formado es 400', () => {
    const c = BASE(); c.operador = { id: 'el-de-siempre' }; rechaza(c, 'id');
  });

  it('viajes: obligatorio, sin repetidos, con tope', () => {
    const a = BASE(); a.viajes = []; rechaza(a, 'viajes');
    const b = BASE(); delete b.viajes; rechaza(b, 'viajes');
    const c = BASE(); c.viajes = ['A', 'A']; rechaza(c, undefined, /repetido/);
    const d = BASE(); d.viajes = Array.from({ length: MAX_VIAJES + 1 }, (_, i) => `V${i}`); rechaza(d, 'viajes');
    const e = BASE(); e.viajes = [{}]; rechaza(e);
    const f = BASE(); f.viajes = [' ']; rechaza(f);
  });

  it('conceptos: obligatorio y con tope', () => {
    const a = BASE(); a.conceptos = []; rechaza(a, 'conceptos');
    const b = BASE(); delete b.conceptos; rechaza(b, 'conceptos');
    const c = BASE();
    c.conceptos = Array.from({ length: MAX_CONCEPTOS + 1 }, () => ({ descripcion: 'x', tipo: 'percepcion', monto: 1 }));
    c.total = MAX_CONCEPTOS + 1;
    rechaza(c, 'conceptos');
    const d = BASE(); d.conceptos = ['x']; rechaza(d);
  });

  it('el periodo: fechas reales, en orden y de a lo más un año', () => {
    const a = BASE(); a.periodo = { desde: '2026-02-30', hasta: '2026-03-01' }; rechaza(a);
    const b = BASE(); b.periodo = { desde: '2026-09-08', hasta: '2026-09-01' }; rechaza(b, 'periodo');
    const c = BASE(); c.periodo = { desde: '2026-09-01T00:00:00Z', hasta: '2026-09-07' }; rechaza(c);
    const d = BASE(); d.periodo = { desde: '2024-01-01', hasta: '2026-01-01' }; rechaza(d, 'periodo');
    const e = BASE(); delete e.periodo; rechaza(e, 'periodo');
    const f = BASE(); f.periodo = { desde: '2026-09-01' }; rechaza(f, 'periodo');
    // el borde: exactamente un año de días es válido
    const g = BASE(); g.periodo = { desde: '2026-01-01', hasta: '2026-12-31' };
    expect(Date.parse('2026-12-31') - Date.parse('2026-01-01')).toBeLessThan(MAX_DIAS_PERIODO * 86_400_000);
    expect(() => validarLiquidacionExterna(g)).not.toThrow();
  });

  it('un cuerpo con __proto__ no contamina nada y se rechaza como campo desconocido', () => {
    const c = JSON.parse('{"__proto__": {"polluted": true}, "claveExterna": "X1"}') as Record<string, unknown>;
    expect(() => validarLiquidacionExterna(c)).toThrow(CampoInvalido);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('el PDF adjunto: se comprueba por sus BYTES', () => {
  it('un PDF bien formado pasa y trae su sha256', () => {
    const p = validarPdfAdjunto({ base64: b64(PDF_MIN), nombre: 'liq septiembre' });
    expect(p.nombre).toBe('liq septiembre.pdf');
    expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(p.bytes.length).toBe(PDF_MIN.length);
  });

  it('lo que no empieza con %PDF- no es un PDF aunque se llame .pdf', () => {
    expect(() => validarPdfAdjunto({ base64: b64('MZ\x90\x00 esto es un ejecutable'), nombre: 'liq.pdf' })).toThrow(/no es un PDF/);
  });

  it('un PDF truncado (sin %%EOF) se rechaza', () => {
    expect(() => validarPdfAdjunto({ base64: b64('%PDF-1.4\n1 0 obj<<>>endobj') })).toThrow(/truncado/);
  });

  it('un PDF con contenido activo se rechaza (JavaScript, Launch, archivos incrustados)', () => {
    for (const marca of ['/JavaScript', '/JS', '/Launch', '/EmbeddedFile', '/OpenAction']) {
      const malo = `%PDF-1.4\n1 0 obj<</S /X ${marca} (alert(1))>>endobj\n%%EOF\n`;
      expect(() => validarPdfAdjunto({ base64: b64(malo) }), marca).toThrow(/contenido activo/);
    }
  });

  it('base64 inválido, vacío o con basura es 400', () => {
    for (const malo of ['%%%%', '', '   ', 'AAA', 'AAAA====', 12345, null, undefined]) {
      expect(() => validarPdfAdjunto({ base64: malo }), String(malo)).toThrow(CampoInvalido);
    }
  });

  it('el tope de peso se aplica ANTES de decodificar', () => {
    const grande = `%PDF-${'A'.repeat(MAX_PDF_BYTES)}%%EOF`;
    expect(() => validarPdfAdjunto({ base64: b64(grande) })).toThrow(/no puede pesar/);
  });

  it('el nombre no puede llevar rutas ni caracteres raros', () => {
    const p = validarPdfAdjunto({ base64: b64(PDF_MIN), nombre: '../../etc/passwd' });
    expect(p.nombre).not.toContain('/');
    expect(p.nombre.startsWith('.')).toBe(false);
    expect(p.nombre.endsWith('.pdf')).toBe(true);
  });

  it('un campo desconocido dentro de `pdf` es 400', () => {
    expect(() => validarPdfAdjunto({ base64: b64(PDF_MIN), url: 'http://x' })).toThrow(/url/);
    expect(() => validarPdfAdjunto('texto')).toThrow(CampoInvalido);
  });

  it('el PDF entra al cuerpo normalizado y a la huella', () => {
    const c = BASE(); c.pdf = { base64: b64(PDF_MIN) };
    const con = validarLiquidacionExterna(c);
    const sin = validarLiquidacionExterna(BASE());
    expect(con.pdf).not.toBeNull();
    expect(huellaContenido(con)).not.toBe(huellaContenido(sin));
  });
});

describe('la huella del contenido: lo que decide 200 idempotente vs 409', () => {
  it('es determinista y el mismo cuerpo reserializado con otro orden de llaves da la misma', () => {
    const a = validarLiquidacionExterna(BASE());
    const reordenado = Object.fromEntries(Object.entries(BASE()).reverse());
    const b = validarLiquidacionExterna(reordenado);
    expect(huellaContenido(a)).toBe(huellaContenido(b));
    expect(huellaContenido(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('el orden de los FOLIOS no importa (es un conjunto)', () => {
    const c = BASE(); c.viajes = ['VJ-101', 'VJ-100'];
    expect(huellaContenido(validarLiquidacionExterna(c))).toBe(huellaContenido(validarLiquidacionExterna(BASE())));
  });

  it('el orden de los CONCEPTOS sí importa (es lo que el chofer lee)', () => {
    const c = BASE();
    (c.conceptos as unknown[]).reverse();
    expect(huellaContenido(validarLiquidacionExterna(c))).not.toBe(huellaContenido(validarLiquidacionExterna(BASE())));
  });

  it('un centavo, una moneda, un periodo o un folio distintos cambian la huella', () => {
    const base = huellaContenido(validarLiquidacionExterna(BASE()));
    const variantes: Array<(c: Record<string, unknown>) => void> = [
      (c) => { (c.conceptos as Array<Record<string, unknown>>)[0].monto = 3500.01; c.total = 3700.26; },
      (c) => { c.moneda = 'USD'; },
      (c) => { c.periodo = { desde: '2026-09-02', hasta: '2026-09-07' }; },
      (c) => { c.viajes = ['VJ-100']; },
      (c) => { c.sistemaOrigen = 'TMS'; },
      (c) => { c.operador = { telefono: '5512345679' }; },
    ];
    const huellas = new Set([base]);
    for (const v of variantes) {
      const c = BASE(); v(c);
      huellas.add(huellaContenido(validarLiquidacionExterna(c)));
    }
    expect(huellas.size).toBe(variantes.length + 1);
  });

  it('$500 y $500.00 son la misma cifra', () => {
    const a = BASE(); const b = BASE();
    (a.conceptos as Array<Record<string, unknown>>)[0].monto = 3500;
    (b.conceptos as Array<Record<string, unknown>>)[0].monto = '3500.00';
    expect(huellaContenido(validarLiquidacionExterna(a))).toBe(huellaContenido(validarLiquidacionExterna(b)));
  });
});

describe('aritmética en centavos', () => {
  it('no arrastra errores de coma flotante', () => {
    expect(aCentavos(1234.56)).toBe(123456);
    expect(aCentavos(0.1 + 0.2)).toBe(30);
    // 0.1 + 0.2 en coma flotante es 0.30000000000000004: el total cuadra igual
    const c = BASE();
    c.conceptos = [
      { descripcion: 'a', tipo: 'percepcion', monto: 0.1 },
      { descripcion: 'b', tipo: 'percepcion', monto: 0.2 },
    ];
    c.total = 0.3;
    expect(validarLiquidacionExterna(c).total).toBe(0.3);
  });

  it('una suma larga de centavos sigue cuadrando', () => {
    const c = BASE();
    c.conceptos = Array.from({ length: 100 }, () => ({ descripcion: 'x', tipo: 'percepcion', monto: 33.33 }));
    c.total = 3333;
    expect(validarLiquidacionExterna(c).total).toBe(3333);
  });
});
