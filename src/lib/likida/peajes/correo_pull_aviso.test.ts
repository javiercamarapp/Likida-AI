import { describe, it, expect, vi } from 'vitest';

// Las piezas PURAS del correo, el pull, el aviso y la exportación de peajes (0563).
// El recorrido con base y dobles vive en `ciclo_completo.e2e.test.ts`.

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('sin base en esta prueba'); } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { direccionPj, tokenPjDeDireccion, tokenPjDeDestinatarios, nombreAdjuntoSeguro } = await import('./correo_entrante');
const { urlConDesde } = await import('./pull');
const { textoAvisoDesglose } = await import('./aviso_oficina');
const { leerOpcionesExportacionPeajes, generarExportacionPeajes, CATALOGO_COLUMNAS_PEAJES, COLUMNAS_POR_DEFECTO_PEAJES } = await import('./exportacion');
const { generarToken } = await import('@/lib/correo/buzon');
const { remitenteReconocido } = await import('@/lib/correo/remitente');

const TOKEN = 'abcdefghjkmnpqrstvwxyz23';
const DOM = 'mail.likida.ai';

describe('la dirección pj-<token>@dominio', () => {
  it('se arma y se lee de vuelta, tolerante con «Nombre <…>», mayúsculas y sufijos +', () => {
    expect(direccionPj(TOKEN, DOM)).toBe(`pj-${TOKEN}@${DOM}`);
    expect(tokenPjDeDireccion(`Cortes <PJ-${TOKEN.toUpperCase()}+x@${DOM}>`, DOM)).toBe(TOKEN);
  });

  it('un token inválido, otro prefijo u otro dominio NO resuelven (no se rescata el token de una dirección ajena)', () => {
    expect(direccionPj('corto', DOM)).toBeNull();
    expect(direccionPj(TOKEN, null)).toBeNull();
    for (const d of [`cp-${TOKEN}@${DOM}`, `f-${TOKEN}@${DOM}`, `pj-${TOKEN}@otro.example`, `pj-corto@${DOM}`, `pj-${TOKEN}`, '']) {
      expect(tokenPjDeDireccion(d, DOM), d).toBeNull();
    }
  });

  it('los tokens generados por buzon.ts son siempre válidos para este buzón', () => {
    for (let i = 0; i < 20; i++) {
      const t = generarToken();
      expect(tokenPjDeDireccion(`pj-${t}@${DOM}`, DOM)).toBe(t);
    }
  });

  it('dos buzones distintos entre los destinatarios = ninguno (no se adivina a cuál iba); el mismo repetido sí', () => {
    const otro = 'bcdefghjkmnpqrstvwxyz234';
    expect(tokenPjDeDestinatarios([`pj-${TOKEN}@${DOM}`, `pj-${otro}@${DOM}`], DOM)).toBeNull();
    expect(tokenPjDeDestinatarios([`x@y.example`, `pj-${TOKEN}@${DOM}`, `PJ-${TOKEN}@${DOM}`], DOM)).toBe(TOKEN);
    expect(tokenPjDeDestinatarios([], DOM)).toBeNull();
  });

  it('el nombre del adjunto se sanea: sin rutas, sin control ni caracteres de dirección de texto', () => {
    expect(nombreAdjuntoSeguro('../../etc/passwd.csv')).toBe('passwd.csv');
    expect(nombreAdjuntoSeguro('C:\\x\\corte.xlsx')).toBe('corte.xlsx');
    expect(nombreAdjuntoSeguro('co\u202Ertc.csv\u0000')).toBe('cortc.csv');
    expect(nombreAdjuntoSeguro('')).toBe('desglose');
    expect(nombreAdjuntoSeguro('..')).toBe('desglose');
    expect(nombreAdjuntoSeguro('a'.repeat(500)).length).toBe(200);
  });

  it('remitenteReconocido: sin lista = null; con lista compara correo, dominio y @dominio', () => {
    expect(remitenteReconocido('x@y.example', [])).toBeNull();
    expect(remitenteReconocido('Cortes <cortes@pase.example>', ['pase.example'])).toBe(true);
    expect(remitenteReconocido('cortes@pase.example', ['@pase.example'])).toBe(true);
    expect(remitenteReconocido('cortes@pase.example', ['CORTES@PASE.EXAMPLE'])).toBe(true);
    expect(remitenteReconocido('x@malo.example', ['pase.example'])).toBe(false);
    expect(remitenteReconocido('x@pase.example.malo.example', ['pase.example'])).toBe(false);
    expect(remitenteReconocido(null, ['pase.example'])).toBe(false);
  });
});

describe('urlConDesde', () => {
  it('sin cursor no toca la URL; con cursor añade `desde` sin pisar el resto de la query', () => {
    expect(urlConDesde('https://x.example/c', null)).toBe('https://x.example/c');
    expect(urlConDesde('https://x.example/c?flota=7', '2026-10-01T12:00:00.000Z')).toBe('https://x.example/c?flota=7&desde=2026-10-01T12%3A00%3A00.000Z');
    expect(urlConDesde('https://x.example/c?desde=viejo', '2026-10-01T12:00:00.000Z')).toBe('https://x.example/c?desde=2026-10-01T12%3A00%3A00.000Z');
  });
});

describe('textoAvisoDesglose', () => {
  const d = { proveedor: 'PASE', periodoDesde: '2026-08-01', periodoHasta: '2026-08-10' };
  it('cuenta solo las categorías con casos, en singular o plural, y dice que no acusa', () => {
    const t = textoAvisoDesglose(d, { gpsNoCoincide: 3, sinRespaldo: 1, porVerificar: 0 });
    expect(t).toContain('desglose de PASE (2026-08-01 a 2026-08-10)');
    expect(t).toContain('3 cobros donde el GPS no ubica la unidad en la caseta');
    expect(t).toContain('1 cobro sin respaldo en tus tickets');
    expect(t).not.toContain('por verificar');
    expect(t).toMatch(/no afirma que el cobro sea indebido/);
    expect(t).not.toMatch(/\$\s?\d/); // sin montos
  });
  it('sin proveedor ni periodo no inventa nada', () => {
    const t = textoAvisoDesglose({ proveedor: null, periodoDesde: null, periodoHasta: null }, { gpsNoCoincide: 1, sinRespaldo: 0, porVerificar: 2 });
    expect(t).toContain('en el desglose hay 1 cobro donde el GPS no ubica');
    expect(t).toContain('2 cobros por verificar');
    expect(t).not.toMatch(/null|undefined/);
  });
});

describe('exportación configurable de la bitácora conciliada', () => {
  const q = (s: string) => new URLSearchParams(s);
  const bit = {
    desgloseId: 'd1', proveedor: '=CMD()', periodoDesde: null, periodoHasta: null, sinEvaluarGps: 0, leyendas: [],
    resumen: { total: 1, cuadra: 0, sinRespaldo: 1, porVerificar: 0, montoCuadra: 0, montoSinRespaldo: 50, montoPorVerificar: 0 },
    filas: [{
      indice: 0, fecha: '2026-08-05', hora: '10:30:00', casetaProveedor: 'Plaza; Norte', casetaCatalogo: '', tag: 'IMDM1', unidad: '', monto: 50.5,
      estado: 'sin_respaldo' as const, motivo: 'sin_gasto_sin_gps' as const, explicacion: 'Hay tickets y ninguno respalda este cobro.', viaje: '', diferencia: null,
      gps: 'sin datos' as const, gpsDistanciaM: null, gpsNota: '',
    }],
  };
  it('el layout por defecto existe en el catálogo y trae estado, motivo y explicación (la doctrina viaja)', () => {
    for (const c of COLUMNAS_POR_DEFECTO_PEAJES) expect(CATALOGO_COLUMNAS_PEAJES[c], c).toBeDefined();
    for (const c of ['estado', 'motivo', 'explicacion']) expect(COLUMNAS_POR_DEFECTO_PEAJES).toContain(c);
  });
  it('columnas, separador, decimal y fechas configurables; el texto con el separador se entrecomilla y la fórmula se neutraliza', () => {
    const o = leerOpcionesExportacionPeajes(q('columnas=proveedor,casetaProveedor,fechaCruce,monto,estado&separador=punto_y_coma&decimal=coma&fechas=dmy'));
    if (!o.ok) throw new Error(o.mensaje);
    expect(generarExportacionPeajes(bit as never, o.opciones)).toBe([
      'proveedor;casetaProveedor;fechaCruce;monto;estado',
      '\'=CMD();"Plaza; Norte";05/08/2026;50,50;sin respaldo',
      '',
    ].join('\n'));
  });
  it('rechaza lo desconocido y la combinación ambigua', () => {
    for (const s of ['columnas=inventada', 'columnas=monto,monto', 'separador=pipe', 'decimal=coma', 'fechas=us', 'bom=2']) {
      expect(leerOpcionesExportacionPeajes(q(s)).ok, s).toBe(false);
    }
  });
  it('un nombre de columna tipo prototipo no cuela', () => {
    for (const c of ['constructor', '__proto__', 'hasOwnProperty']) expect(leerOpcionesExportacionPeajes(q(`columnas=${c}`)).ok, c).toBe(false);
  });
});
