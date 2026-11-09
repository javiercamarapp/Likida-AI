import { describe, expect, it, vi } from 'vitest';
import type { ResultadoEnvio } from './enviar';
import { conReintentoTransitorio, esTransitorio, MAX_REINTENTOS_CORREO } from './reintento';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const OK: ResultadoEnvio = { ok: true, id: 're_1' };
const r429: ResultadoEnvio = { ok: false, motivo: 'rechazado', detalle: 'HTTP 429', status: 429 };
const r503: ResultadoEnvio = { ok: false, motivo: 'rechazado', detalle: 'HTTP 503', status: 503 };
const r422: ResultadoEnvio = { ok: false, motivo: 'rechazado', detalle: 'HTTP 422', status: 422 };
const rRed: ResultadoEnvio = { ok: false, motivo: 'red', detalle: 'timeout' };

function proveedor(...resultados: ResultadoEnvio[]) {
  const fn = vi.fn(async () => resultados[Math.min(fn.mock.calls.length - 1, resultados.length - 1)]);
  return fn;
}

describe('esTransitorio', () => {
  it('429, 5xx y red son transitorios; 4xx de validación y sin_configurar no', () => {
    expect(esTransitorio(r429)).toBe(true);
    expect(esTransitorio(r503)).toBe(true);
    expect(esTransitorio(rRed)).toBe(true);
    expect(esTransitorio(r422)).toBe(false);
    expect(esTransitorio({ ok: false, motivo: 'sin_configurar' })).toBe(false);
    expect(esTransitorio(OK)).toBe(false);
  });
});

describe('conReintentoTransitorio', () => {
  it('si el primer intento sale, no reintenta (sin duplicar)', async () => {
    const p = proveedor(OK);
    const dormir = vi.fn(async () => {});
    expect(await conReintentoTransitorio(p, dormir)).toEqual(OK);
    expect(p).toHaveBeenCalledTimes(1);
    expect(dormir).not.toHaveBeenCalled();
  });

  it('reintenta ante 429 y 5xx con esperas crecientes y termina en éxito', async () => {
    const p = proveedor(r429, r503, OK);
    const esperas: number[] = [];
    const r = await conReintentoTransitorio(p, async (ms) => { esperas.push(ms); });
    expect(r).toEqual(OK);
    expect(p).toHaveBeenCalledTimes(3);
    expect(esperas).toHaveLength(2);
    expect(esperas[1]).toBeGreaterThan(esperas[0]);
  });

  it('máximo 2 reintentos: con fallo persistente hace 3 intentos y devuelve el último error', async () => {
    const p = proveedor(rRed);
    const r = await conReintentoTransitorio(p, async () => {});
    expect(p).toHaveBeenCalledTimes(1 + MAX_REINTENTOS_CORREO);
    expect(r).toEqual(rRed);
  });

  it('NUNCA reintenta un 4xx de validación', async () => {
    const p = proveedor(r422, OK);
    const r = await conReintentoTransitorio(p, async () => {});
    expect(p).toHaveBeenCalledTimes(1);
    expect(r).toEqual(r422);
  });
});
