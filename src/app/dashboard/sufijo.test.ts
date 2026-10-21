import { describe, it, expect } from 'vitest';
import { sufijoTenant, querystringCompleto } from './sufijo';

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

// HALLAZGO MEDIO (auditoría de este repo, 21-oct-2026): esta es la otra
// mitad — el querystring REAL (filtros, paginación) que `sufijoTenant` no
// cubre, para colgarlo del redirect a /login cuando la sesión expira a
// media navegación (ver guard.ts y las pruebas de `requireSessionTenant`
// en guard.test.ts).
describe('querystringCompleto — el querystring real para el redirect de /login', () => {
  it('sin searchParams devuelve vacío', () => {
    expect(querystringCompleto(undefined)).toBe('');
  });

  it('con searchParams vacío devuelve vacío', () => {
    expect(querystringCompleto({})).toBe('');
  });

  it('serializa los filtros reales de una página (viajes: f, q, c)', () => {
    expect(querystringCompleto({ f: 'abiertos', q: 'ACME', c: 'cursor-abc' }))
      .toBe('?f=abiertos&q=ACME&c=cursor-abc');
  });

  it('omite claves undefined o cadena vacía (un searchParams típico de Next trae varias)', () => {
    expect(querystringCompleto({ f: 'abiertos', q: undefined, c: '' })).toBe('?f=abiertos');
  });

  it('también incluye tenant/vista/rol — la previsualización de superadmin se pierde igual al expirar', () => {
    expect(querystringCompleto({ tenant: 't-7', f: 'escalados' })).toBe('?tenant=t-7&f=escalados');
  });

  it('codifica valores con caracteres especiales', () => {
    expect(querystringCompleto({ q: 'flota & cía' })).toBe('?q=flota+%26+c%C3%ADa');
  });
});
