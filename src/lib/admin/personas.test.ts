import { describe, expect, it } from 'vitest';
import { armarPersonas, ordenarPorJerarquia, type FilaAppUser } from './personas';

const f = (id: string, over: Partial<FilaAppUser> = {}): FilaAppUser => ({
  id, email: `${id}@x.mx`, nombre: null, rol: 'contador', tenant_id: 't1', activo: true, desactivado_en: null, tenant: { nombre: 'Flota' }, ...over,
});

describe('armarPersonas', () => {
  const auth = new Map([['a', { lastSignInAt: '2026-11-01T10:00:00Z' }], ['b', { lastSignInAt: null }], ['c', { lastSignInAt: null }]]);
  it('distingue último acceso, nunca entró, baja y cuenta fantasma', () => {
    const r = armarPersonas([f('a'), f('b'), f('c', { activo: false }), f('d')], auth);
    expect(r[0]).toMatchObject({ estado: 'activa', nuncaEntro: false, ultimoAcceso: '2026-11-01T10:00:00Z' });
    expect(r[1]).toMatchObject({ estado: 'activa', nuncaEntro: true });
    expect(r[2]).toMatchObject({ estado: 'baja', activa: false });
    expect(r[3]).toMatchObject({ estado: 'sin_acceso', sinCuentaAuth: true, nuncaEntro: false });
  });
  it('si Auth no se pudo leer NO afirma "nunca entró" ni "sin cuenta"', () => {
    const r = armarPersonas([f('a'), f('z', { activo: false })], null);
    expect(r.every((p) => !p.nuncaEntro && !p.sinCuentaAuth && p.ultimoAcceso === null)).toBe(true);
    expect(r[1].estado).toBe('baja');
  });
  it('marca al personal de Likida', () => {
    const [s, v, c] = armarPersonas([f('s', { rol: 'superadmin', tenant_id: null, tenant: null }), f('v', { rol: 'vendedor', tenant_id: null, tenant: null }), f('c')], auth);
    expect([s.esLikida, v.esLikida, c.esLikida]).toEqual([true, true, false]);
  });
  it('ordena por jerarquía y manda lo desconocido al final', () => {
    expect(ordenarPorJerarquia([{ rol: 'contador' }, { rol: 'raro' }, { rol: 'superadmin' }, { rol: 'flota_admin' }]).map((x) => x.rol))
      .toEqual(['superadmin', 'flota_admin', 'contador', 'raro']);
  });
});
