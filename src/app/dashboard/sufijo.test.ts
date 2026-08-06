import { describe, it, expect } from 'vitest';
import { sufijoTenant } from './sufijo';

describe('sufijoTenant — el ?tenant=/?vista=/?rol= que no se puede perder', () => {
  it('sin previsualización devuelve vacío (un rol real entra sin query string)', () => {
    expect(sufijoTenant(undefined)).toBe('');
    expect(sufijoTenant({})).toBe('');
  });

  it('arrastra el tenant del superadmin', () => {
    expect(sufijoTenant({ tenant: 't-otra' })).toBe('?tenant=t-otra');
  });

  it('sin tenant pero con vista demo, arrastra la vista', () => {
    expect(sufijoTenant({ vista: 'demo' })).toBe('?vista=demo');
  });

  it('el rol viaja junto con el tenant o la vista (no se pierde la previsualización)', () => {
    expect(sufijoTenant({ tenant: 't-otra', rol: 'contador' })).toBe('?tenant=t-otra&rol=contador');
    expect(sufijoTenant({ vista: 'demo', rol: 'encargado' })).toBe('?vista=demo&rol=encargado');
  });

  it('codifica valores con caracteres especiales', () => {
    expect(sufijoTenant({ tenant: 't con espacios' })).toBe('?tenant=t%20con%20espacios');
  });
});
