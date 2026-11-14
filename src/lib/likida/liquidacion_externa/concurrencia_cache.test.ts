import { describe, it, expect, vi } from 'vitest';
import { leerUnaVez } from './concurrencia';
import { cerrarRevisionesResueltas } from './desglose_muestra_recepcion';

describe('leerUnaVez', () => {
  it('lecturas simultáneas de la misma clave comparten una sola consulta', async () => {
    const leer = vi.fn(async () => { await new Promise((r) => setTimeout(r, 5)); return 'cfg'; });
    const cache = new Map<string, Promise<string>>();
    const r = await Promise.all([leerUnaVez(cache, 't1', leer), leerUnaVez(cache, 't1', leer), leerUnaVez(cache, 't1', leer)]);
    expect(r).toEqual(['cfg', 'cfg', 'cfg']);
    expect(leer).toHaveBeenCalledTimes(1);
  });
  it('un fallo no se queda guardado: la siguiente lectura reintenta', async () => {
    const leer = vi.fn().mockRejectedValueOnce(new Error('red')).mockResolvedValueOnce('ok');
    const cache = new Map<string, Promise<string>>();
    await expect(leerUnaVez(cache, 't1', leer)).rejects.toThrow('red');
    await expect(leerUnaVez(cache, 't1', leer)).resolves.toBe('ok');
  });
});

describe('cerrarRevisionesResueltas en paralelo', () => {
  it('2 lecturas por clave, varias a la vez, sin pasar del tope, y un fallo no bloquea', async () => {
    let vuelo = 0; let max = 0;
    const resolver = vi.fn(async (_t: string, clave: string) => {
      vuelo++; max = Math.max(max, vuelo);
      await new Promise((r) => setTimeout(r, 3));
      vuelo--;
      if (clave === 'BIT-3') throw new Error('red');
      return 1;
    });
    const claves = Array.from({ length: 10 }, (_, i) => `BIT-${i}`);
    const n = await cerrarRevisionesResueltas('t', claves, { resolverExcepciones: resolver, ahora: () => new Date() });
    expect(resolver).toHaveBeenCalledTimes(20);
    expect(n).toBe(18); // BIT-3 falla en sus 2 tipos y no cuenta
    expect(max).toBeGreaterThan(1);
    expect(max).toBeLessThanOrEqual(6);
  });
});

describe('registrarRevisionesMuestra en paralelo', () => {
  it('abre las excepciones de todo un lote en revisión varias a la vez, con su conteo y sin pasar del tope', async () => {
    const { registrarRevisionesMuestra } = await import('./desglose_muestra_recepcion');
    let vuelo = 0; let max = 0;
    const abrir = vi.fn(async () => { vuelo++; max = Math.max(max, vuelo); await new Promise((r) => setTimeout(r, 3)); vuelo--; return { id: 1, nueva: true }; });
    const revs = Array.from({ length: 30 }, (_, i) => ({
      indice: i, bitacora: `B${i}`,
      motivos: i % 3 === 0
        ? [{ codigo: 'operador_no_encontrado', campo: 'NumeroEmpleado' }, { codigo: 'monto_nulo', campo: 'Percepciones[0].Monto' }]
        : [{ codigo: 'operador_no_encontrado', campo: 'NumeroEmpleado' }],
    }));
    const n = await registrarRevisionesMuestra('t', revs as never, (b) => `BIT-${b}`, { abrirExcepcion: abrir, ahora: () => new Date() } as never);
    expect(n).toBe(30 + 10); // 1 de operador por bitácora + 1 de mapeo en las 10 que además traen otro motivo
    expect(abrir).toHaveBeenCalledTimes(40);
    expect(max).toBeGreaterThan(1);
    expect(max).toBeLessThanOrEqual(6);
  });
});
