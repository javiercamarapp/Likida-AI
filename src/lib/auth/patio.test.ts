import { describe, it, expect, vi, beforeEach } from 'vitest';

const terminalDeUsuario = vi.fn();
vi.mock('@/lib/likida/terminales', () => ({ terminalDeUsuario: (...a: unknown[]) => terminalDeUsuario(...a) }));

const { alcanceDePatio, dentroDelAlcance, patioParaCrear, movimientoPermitido, exigirDentroDelAlcance, MENSAJE_FUERA_DE_PATIO } = await import('./patio');
const { DatoInvalido } = await import('@/lib/likida/errores');

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';

beforeEach(() => { terminalDeUsuario.mockReset(); });

describe('alcanceDePatio', () => {
  it('el dueño y el soporte de Likida: toda la flota, sin leer nada', async () => {
    expect(await alcanceDePatio('t', 'u', 'flota_admin')).toEqual({ tipo: 'flota' });
    expect(await alcanceDePatio('t', 'u', 'superadmin')).toEqual({ tipo: 'flota' });
    expect(terminalDeUsuario).not.toHaveBeenCalled();
  });

  it('el contador, el chofer, un rol desconocido y «sin rol» no editan el catálogo: null', async () => {
    for (const rol of ['contador', 'operador', 'vendedor', 'sin_rol', 'quien-sabe']) {
      expect(await alcanceDePatio('t', 'u', rol), rol).toBeNull();
    }
    expect(terminalDeUsuario).not.toHaveBeenCalled();
  });

  it('un encargado CON patio queda acotado a ese patio', async () => {
    terminalDeUsuario.mockResolvedValue(A);
    expect(await alcanceDePatio('t', 'u', 'encargado')).toEqual({ tipo: 'patio', terminalId: A });
  });

  it('un encargado SIN patio (oficina central) ve toda la flota', async () => {
    terminalDeUsuario.mockResolvedValue(null);
    expect(await alcanceDePatio('t', 'u', 'encargado')).toEqual({ tipo: 'flota' });
  });

  it('FALLA CERRADO: si el patio del encargado no se pudo leer, niega (no concede toda la flota)', async () => {
    terminalDeUsuario.mockResolvedValue(undefined);
    expect(await alcanceDePatio('t', 'u', 'encargado')).toBeNull();
    terminalDeUsuario.mockImplementation(async () => { throw new Error('se cayó'); });
    expect(await alcanceDePatio('t', 'u', 'encargado')).toBeNull();
  });
});

describe('dentroDelAlcance', () => {
  it('sin alcance niega siempre', () => {
    expect(dentroDelAlcance(null, A)).toBe(false);
    expect(dentroDelAlcance(null, null)).toBe(false);
  });
  it('la flota entera acepta cualquier patio, y «sin patio»', () => {
    expect(dentroDelAlcance({ tipo: 'flota' }, A)).toBe(true);
    expect(dentroDelAlcance({ tipo: 'flota' }, null)).toBe(true);
  });
  it('un jefe con patio solo acepta el suyo: lo de otro patio y lo SIN patio quedan fuera', () => {
    const jefe = { tipo: 'patio', terminalId: A } as const;
    expect(dentroDelAlcance(jefe, A)).toBe(true);
    expect(dentroDelAlcance(jefe, B)).toBe(false);
    expect(dentroDelAlcance(jefe, null)).toBe(false);
  });
});

describe('patioParaCrear / movimientoPermitido', () => {
  it('un jefe con patio crea SIEMPRE en su patio, aunque el formulario pida otro', () => {
    expect(patioParaCrear({ tipo: 'patio', terminalId: A }, B)).toBe(A);
    expect(patioParaCrear({ tipo: 'patio', terminalId: A }, null)).toBe(A);
  });
  it('con la flota entera se respeta lo pedido, y vacío es sin patio', () => {
    expect(patioParaCrear({ tipo: 'flota' }, B)).toBe(B);
    expect(patioParaCrear({ tipo: 'flota' }, '  ')).toBeNull();
    expect(patioParaCrear({ tipo: 'flota' }, undefined)).toBeNull();
  });
  it('un jefe con patio solo puede mover registros a SU patio (no a otro, no a «sin patio»)', () => {
    const jefe = { tipo: 'patio', terminalId: A } as const;
    expect(movimientoPermitido(jefe, A)).toBe(true);
    expect(movimientoPermitido(jefe, B)).toBe(false);
    expect(movimientoPermitido(jefe, null)).toBe(false);
    expect(movimientoPermitido({ tipo: 'flota' }, B)).toBe(true);
  });
});

describe('exigirDentroDelAlcance', () => {
  it('lanza DatoInvalido con el mensaje que la pantalla enseña tal cual', () => {
    expect(() => exigirDentroDelAlcance({ tipo: 'patio', terminalId: A }, B)).toThrow(DatoInvalido);
    expect(() => exigirDentroDelAlcance(null, A)).toThrow(MENSAJE_FUERA_DE_PATIO);
    expect(() => exigirDentroDelAlcance({ tipo: 'patio', terminalId: A }, A)).not.toThrow();
  });
});
