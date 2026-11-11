import { describe, it, expect } from 'vitest';
import { estadoRealDeAgente, type EntradaEstadoReal } from './estado-real';

const base: EntradaEstadoReal = { estado: 'vivo', runnerHabilitado: true, presupuestoDiaUsd: 1, apagado: false, horasSinCorrer: 5, motivoSalto: null };

describe('estadoRealDeAgente', () => {
  it('corriendo solo si vivo, con palanca arriba, presupuesto y corrida reciente', () => {
    expect(estadoRealDeAgente(base)).toBe('corriendo');
  });
  it('un vivo parado por la bandeja NO es «corriendo»', () => {
    expect(estadoRealDeAgente({ ...base, horasSinCorrer: 1600, motivoSalto: 'Contrapresión: bandeja con 100 pendientes' })).toBe('bloqueado_bandeja');
    expect(estadoRealDeAgente({ ...base, horasSinCorrer: null })).toBe('parado');
  });
  it('apagado, sin presupuesto, sin palanca, fuera del runner y no vivo', () => {
    expect(estadoRealDeAgente({ ...base, apagado: true })).toBe('apagado');
    expect(estadoRealDeAgente({ ...base, presupuestoDiaUsd: null })).toBe('sin_presupuesto');
    expect(estadoRealDeAgente({ ...base, apagado: undefined })).toBe('sin_palanca');
    expect(estadoRealDeAgente({ ...base, runnerHabilitado: false })).toBe('fuera_del_runner');
    expect(estadoRealDeAgente({ ...base, estado: 'disenado' })).toBe('no_vivo');
  });
  it('lectura caída es «sin dato», nunca «corriendo»', () => {
    expect(estadoRealDeAgente({ ...base, apagado: null })).toBe('sin_dato');
    expect(estadoRealDeAgente({ ...base, horasSinCorrer: undefined })).toBe('sin_dato');
  });
});
