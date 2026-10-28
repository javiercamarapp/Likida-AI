import { describe, it, expect } from 'vitest';
import { guardarDeclaraciones, insigniaDeCookie, leerDeclaraciones, valorCookieAvance, claveProgreso, type AlmacenLocal } from './progreso';

function falso(): AlmacenLocal & { datos: Map<string, string> } {
  const datos = new Map<string, string>();
  return { datos, getItem: (k) => datos.get(k) ?? null, setItem: (k, v) => { datos.set(k, v); }, removeItem: (k) => { datos.delete(k); } };
}

describe('progreso del asistente en el navegador', () => {
  it('guarda y lee solo declaraciones válidas, por ámbito', () => {
    const a = falso();
    guardarDeclaraciones(a, 't1:u1', { correoRecibido: true, omitidos: { carta_porte: '  La hace otra área ' } });
    expect(leerDeclaraciones(a, 't1:u1')).toEqual({ correoRecibido: true, omitidos: { carta_porte: 'La hace otra área' } });
    expect(leerDeclaraciones(a, 't2:u1')).toEqual({});
  });
  it('ignora basura, versiones viejas y almacenamiento ausente o roto', () => {
    const a = falso();
    a.datos.set(claveProgreso('x'), '{no es json');
    expect(leerDeclaraciones(a, 'x')).toEqual({});
    a.datos.set(claveProgreso('x'), JSON.stringify({ v: 9, d: { equipoInvitado: true } }));
    expect(leerDeclaraciones(a, 'x')).toEqual({});
    a.datos.set(claveProgreso('x'), JSON.stringify({ v: 1, d: { equipoInvitado: 'sí', omitidos: { inventado: 'x', tms: '' } } }));
    expect(leerDeclaraciones(a, 'x')).toEqual({});
    expect(leerDeclaraciones(null, 'x')).toEqual({});
    const roto: AlmacenLocal = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('cuota'); }, removeItem: () => {} };
    expect(leerDeclaraciones(roto, 'x')).toEqual({});
    expect(guardarDeclaraciones(roto, 'x', {})).toBe(false);
  });
  it('la cookie de la insignia solo acepta N/M y se apaga al completar', () => {
    expect(valorCookieAvance(2, 6)).toBe('2/6');
    expect(valorCookieAvance(9, 6)).toBe('6/6');
    expect(insigniaDeCookie('2/6')).toBe('2/6');
    expect(insigniaDeCookie('6/6')).toBeNull();
    expect(insigniaDeCookie('<b>x</b>')).toBeNull();
    expect(insigniaDeCookie('7/6')).toBeNull();
    expect(insigniaDeCookie(undefined)).toBeNull();
  });
});
