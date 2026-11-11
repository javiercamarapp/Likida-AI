import { describe, expect, it } from 'vitest';
import { avisosDeTopeEncendidos, diasSinRegistroIa, estadoDeSonda, leerEstadoCreditoIa } from './estado-ia';

describe('estadoDeSonda', () => {
  it('la sonda manda: sin saldo (402) se dice sin saldo', () => {
    expect(estadoDeSonda({ estado: 'sin_saldo', status: 402 }, null)).toEqual({ clave: 'sin_saldo', restanteUsd: null });
  });
  it('llave buena trae el saldo restante si el proveedor lo da, y null si no', () => {
    expect(estadoDeSonda({ estado: 'ok', restanteUsd: 12.5 }, null)).toEqual({ clave: 'ok', restanteUsd: 12.5 });
    expect(estadoDeSonda({ estado: 'ok' }, null)).toEqual({ clave: 'ok', restanteUsd: null });
  });
  it('sin sonda y circuito cerrado NO es «ok»: es sin dato', () => {
    expect(estadoDeSonda(null, { abierto: false, clase: null }).clave).toBe('sin_dato');
    expect(estadoDeSonda(null, null).clave).toBe('sin_dato');
  });
  it('sin sonda pero con el circuito abierto, la mala noticia cierta se dice', () => {
    expect(estadoDeSonda(null, { abierto: true, clase: 'sin_saldo' }).clave).toBe('sin_saldo');
  });
});

describe('leerEstadoCreditoIa', () => {
  const circuito = () => ({ abierto: false, clase: null, reintentarEnMs: 0, fallosEnVentana: 0 });
  it('una sonda que lanza no tumba la lectura: sin dato', async () => {
    const r = await leerEstadoCreditoIa({ sondear: async () => { throw new Error('red'); }, circuito });
    expect(r.clave).toBe('sin_dato');
  });
  it('una sonda que no contesta a tiempo es sin dato, no «ok»', async () => {
    const r = await leerEstadoCreditoIa({ sondear: () => new Promise(() => {}), circuito, esperaMs: 10 });
    expect(r.clave).toBe('sin_dato');
  });
  it('usa lo que contesta la sonda', async () => {
    const r = await leerEstadoCreditoIa({ sondear: async () => ({ estado: 'ok', restanteUsd: 3 }), circuito });
    expect(r).toEqual({ clave: 'ok', restanteUsd: 3 });
  });
});

describe('diasSinRegistroIa', () => {
  const serie = [{ dia: '2026-10-14', costoUsd: 0.4 }, { dia: '2026-10-15', costoUsd: 0.1 }, { dia: '2026-10-20', costoUsd: 0 }];
  it('cuenta desde el último día con gasto, no desde el último día de la serie', () => {
    expect(diasSinRegistroIa(serie, '2026-11-08')).toBe(24);
  });
  it('hoy con gasto es 0 días', () => {
    expect(diasSinRegistroIa([{ dia: '2026-11-08', costoUsd: 1 }], '2026-11-08')).toBe(0);
  });
  it('sin ni un día con gasto es null (sin dato), nunca 0', () => {
    expect(diasSinRegistroIa([{ dia: '2026-11-08', costoUsd: 0 }], '2026-11-08')).toBeNull();
    expect(diasSinRegistroIa([], '2026-11-08')).toBeNull();
  });
});

describe('avisosDeTopeEncendidos', () => {
  it('sigue a IA_GOBIERNO', () => {
    expect(avisosDeTopeEncendidos({ IA_GOBIERNO: 'encendido' } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(avisosDeTopeEncendidos({} as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});
