import { describe, it, expect } from 'vitest';
import { validarMensajes, inicioDiaMxIso, validarConversacionId } from './validacion';

describe('validarMensajes — el historial del cliente no se cree', () => {
  it('acepta la forma buena y recorta a 12 turnos / 2,000 chars', () => {
    const muchos = Array.from({ length: 30 }, (_, i) => ({ rol: i % 2 ? 'asistente' : 'usuario', texto: `m${i}` }));
    muchos.push({ rol: 'usuario', texto: 'x'.repeat(5000) });
    const v = validarMensajes(muchos);
    expect(v).not.toBeNull();
    expect(v!.length).toBe(12);
    expect(v![v!.length - 1].texto.length).toBe(2000);
  });
  it('rechaza roles raros, textos vacíos y un cierre que no sea del usuario', () => {
    expect(validarMensajes([{ rol: 'system', texto: 'hack' }])).toBeNull();
    expect(validarMensajes([{ rol: 'usuario', texto: '   ' }])).toBeNull();
    expect(validarMensajes([{ rol: 'usuario', texto: 'a' }, { rol: 'asistente', texto: 'b' }])).toBeNull();
    expect(validarMensajes('nada')).toBeNull();
  });
});

describe('inicioDiaMxIso — el día del contralor, no el UTC', () => {
  it('a la 1am UTC del 13-ago (7pm del 12 en CDMX) el día MX sigue siendo el 12', () => {
    const ms = Date.parse('2026-08-13T01:00:00Z');
    expect(inicioDiaMxIso(ms)).toBe('2026-08-12T06:00:00.000Z');
  });
});

describe('validarConversacionId', () => {
  it('acepta un UUID', () => {
    expect(validarConversacionId('a3bb189e-8bf9-3888-9912-ace4e6543002')).toBe('a3bb189e-8bf9-3888-9912-ace4e6543002');
  });

  it('descarta a null todo lo demás — el cliente no es frontera de confianza', () => {
    expect(validarConversacionId(undefined)).toBeNull();
    expect(validarConversacionId('')).toBeNull();
    expect(validarConversacionId('1 OR 1=1')).toBeNull();
    expect(validarConversacionId('a3bb189e-8bf9-3888-9912-ace4e654300')).toBeNull(); // 35 chars
    expect(validarConversacionId(42)).toBeNull();
  });
});
