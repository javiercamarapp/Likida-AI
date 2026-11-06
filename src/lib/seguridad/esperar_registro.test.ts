import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { esperarRegistro, TOPE_REGISTRO_ANTES_DE_REDIRECT_MS } from './esperar_registro';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('esperarRegistro: espera acotada y fail-closed', () => {
  it('espera a que el registro termine', async () => {
    let listo = false;
    const p = esperarRegistro(new Promise<void>((ok) => setTimeout(() => { listo = true; ok(); }, 50)));
    await vi.advanceTimersByTimeAsync(60);
    await p;
    expect(listo).toBe(true);
  });
  it('un registro colgado no retrasa más que el tope', async () => {
    let termino = false;
    const p = esperarRegistro(new Promise<void>(() => {})).then(() => { termino = true; });
    await vi.advanceTimersByTimeAsync(TOPE_REGISTRO_ANTES_DE_REDIRECT_MS - 1);
    expect(termino).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await p;
    expect(termino).toBe(true);
  });
  it('un registro que rechaza no lanza (la negación sigue)', async () => {
    await expect(esperarRegistro(Promise.reject(new Error('boom')))).resolves.toBeUndefined();
  });
  it('acepta void (mocks sin promesa)', async () => {
    await expect(esperarRegistro(undefined)).resolves.toBeUndefined();
  });
});
