import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL CANDADO DEL MANDATO — auditoría 10 (`docs/auditoria-10/legal.md` y
// `docs/auditoria-10/fiscal.md`, hallazgo ALTO en los dos rubros a la vez).
//
// Estas pruebas ejercitan las funciones PURAS pasándoles el valor explícito
// (`mandatoFiscalAceptado('si')`, `modoEfectivo('emitir', true)`) en vez de
// mutar `process.env` global, salvo el último bloque, que prueba justo que el
// default SÍ lee `process.env` de verdad — es la superficie que consume
// `al_vuelo.ts`, que llama a `modoEfectivo(args.modo ?? 'ensayo')` sin segundo
// argumento.
// ═══════════════════════════════════════════════════════════════════════════

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const { mandatoFiscalAceptado, modoEfectivo, MANDATO_ACEPTADO_VALOR } = await import('./modo');

beforeEach(() => {
  for (const f of Object.values(logger)) f.mockReset();
});

describe('MANDATO_ACEPTADO_VALOR', () => {
  it('es "si", el mismo valor que documenta .env.example', () => {
    expect(MANDATO_ACEPTADO_VALOR).toBe('si');
  });
});

describe('mandatoFiscalAceptado', () => {
  it('true solo con el valor exacto "si"', () => {
    expect(mandatoFiscalAceptado('si')).toBe(true);
  });

  it('false cuando no está puesta (undefined)', () => {
    expect(mandatoFiscalAceptado(undefined)).toBe(false);
  });

  it('false con cualquier variante que no sea el literal exacto', () => {
    for (const valor of ['SI', 'Si', 'true', '1', 'yes', 'sí', ' si', 'si ', '']) {
      expect(mandatoFiscalAceptado(valor), `«${valor}» no debería aceptar el mandato`).toBe(false);
    }
  });
});

describe('modoEfectivo · el candado en sí', () => {
  it('`ensayo` pasa siempre igual, con o sin el mandato — nunca hace falta para NO emitir', () => {
    expect(modoEfectivo('ensayo', false)).toBe('ensayo');
    expect(modoEfectivo('ensayo', true)).toBe('ensayo');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('`emitir` SIN el mandato se degrada a `ensayo`', () => {
    expect(modoEfectivo('emitir', false)).toBe('ensayo');
  });

  it('`emitir` SIN el mandato lo grita en el log, con la fuente del hallazgo', () => {
    modoEfectivo('emitir', false);
    expect(logger.error).toHaveBeenCalledWith('autofactura.mandato_no_aceptado', {
      detalle: 'FACTURACION_MODO=emitir ignorado: falta FACTURACION_MANDATO_ACEPTADO — ver docs/auditoria-10/legal.md',
    });
  });

  it('`emitir` CON el mandato aceptado sí pasa, y no ensucia el log', () => {
    expect(modoEfectivo('emitir', true)).toBe('emitir');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('sin segundo argumento, lee `process.env.FACTURACION_MANDATO_ACEPTADO` de verdad — el candado real, no solo en pruebas con doble', () => {
    const previo = process.env.FACTURACION_MANDATO_ACEPTADO;
    try {
      delete process.env.FACTURACION_MANDATO_ACEPTADO;
      expect(modoEfectivo('emitir')).toBe('ensayo');

      process.env.FACTURACION_MANDATO_ACEPTADO = 'si';
      expect(modoEfectivo('emitir')).toBe('emitir');

      process.env.FACTURACION_MANDATO_ACEPTADO = 'SI'; // mayúsculas no cuentan
      expect(modoEfectivo('emitir')).toBe('ensayo');
    } finally {
      if (previo === undefined) delete process.env.FACTURACION_MANDATO_ACEPTADO;
      else process.env.FACTURACION_MANDATO_ACEPTADO = previo;
    }
  });
});
