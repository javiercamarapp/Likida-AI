import { describe, it, expect } from 'vitest';
import { flotaDelPie } from './nav-utiles';

const A = { id: 'a', nombre: 'Flota A' };
const B = { id: 'b', nombre: 'Flota B' };

describe('flotaDelPie: el nombre del pie sigue a ?tenant= del superadmin', () => {
  it('sin ?tenant= manda la organización del servidor (cookie o sesión)', () => {
    expect(flotaDelPie({ organizacion: A, flotas: [A, B], tenantUrl: null })).toEqual(A);
  });
  it('con ?tenant= de otra flota muestra ESA, no la de la cookie', () => {
    expect(flotaDelPie({ organizacion: A, flotas: [A, B], tenantUrl: 'b' })).toEqual(B);
  });
  it('sin lista (quien no es superadmin) no cambia nada: manda la organización de su sesión', () => {
    expect(flotaDelPie({ organizacion: A, tenantUrl: 'b' })).toEqual(A);
  });
  it('lista caída (null): «Sin dato», nunca un nombre equivocado', () => {
    expect(flotaDelPie({ organizacion: A, flotas: null, tenantUrl: 'b' })).toBeNull();
  });
  it('?tenant= que no está en la lista: «Sin dato»', () => {
    expect(flotaDelPie({ organizacion: A, flotas: [A, B], tenantUrl: 'zzz' })).toBeNull();
  });
  it('?tenant= igual a la organización del servidor la devuelve tal cual (sin depender de la lista)', () => {
    expect(flotaDelPie({ organizacion: A, flotas: null, tenantUrl: 'a' })).toEqual(A);
  });
});
