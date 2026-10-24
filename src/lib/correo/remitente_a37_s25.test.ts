import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));
vi.mock('@/lib/likida/agentes/enviador', () => ({ suprimirCorreo: vi.fn() }));
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { remitenteReconocido, direccionDeEncabezado } from './remitente';
import { extraerCorreo } from './respuesta_campana';

// A37-S25-04: el nombre visible del From no es la dirección.
describe('A37-S25-04 — dirección real del encabezado', () => {
  it('ignora el nombre visible entre comillas', () => {
    expect(direccionDeEncabezado('"compras@cliente.test" <x@evil.test>')).toBe('x@evil.test');
    expect(extraerCorreo('"compras@cliente.test" <x@evil.test>')).toBe('x@evil.test');
  });
  it('ignora comentarios y nombre sin comillas', () => {
    expect(direccionDeEncabezado('compras@cliente.test (jefe) <X@Evil.test>')).toBe('x@evil.test');
  });
  it('acepta la forma simple y la de nombre normal', () => {
    expect(direccionDeEncabezado('Ana <Ana@Flota.test>')).toBe('ana@flota.test');
    expect(direccionDeEncabezado('ana@flota.test')).toBe('ana@flota.test');
    expect(direccionDeEncabezado('sin direccion')).toBeNull();
  });
  it('el spoof no pasa el filtro de remitentes', () => {
    expect(remitenteReconocido('"compras@cliente.test" <x@evil.test>', ['compras@cliente.test'])).toBe(false);
    expect(remitenteReconocido('"x" <compras@cliente.test>', ['compras@cliente.test'])).toBe(true);
    expect(remitenteReconocido('a@b.test', [])).toBeNull();
  });
});
