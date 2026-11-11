import { describe, expect, it, vi } from 'vitest';

const permanente = vi.hoisted(() => vi.fn((ruta: string) => { throw new Error(`NEXT_REDIRECT:${ruta}`); }));
vi.mock('next/navigation', () => ({ permanentRedirect: permanente }));

import { destinoConConsulta, redirigirPermanente } from './redirigir-permanente';

describe('destinoConConsulta', () => {
  it('sin consulta devuelve el destino tal cual', () => {
    expect(destinoConConsulta('/admin/consumo')).toBe('/admin/consumo');
    expect(destinoConConsulta('/admin/consumo', {})).toBe('/admin/consumo');
  });
  it('conserva la consulta de la dirección vieja', () => {
    expect(destinoConConsulta('/admin/consumo', { tenant: 't-1', periodo: '30d' })).toBe('/admin/consumo?tenant=t-1&periodo=30d');
  });
  it('conserva los valores repetidos y omite los indefinidos', () => {
    expect(destinoConConsulta('/admin/x', { a: ['1', '2'], b: undefined })).toBe('/admin/x?a=1&a=2');
  });
  it('añade a la consulta del destino sin pisar lo que el destino ya fija', () => {
    expect(destinoConConsulta('/admin/x?vista=tabla', { tenant: 't-1', vista: 'otra' })).toBe('/admin/x?vista=tabla&tenant=t-1');
  });
  it('codifica los caracteres especiales', () => {
    expect(destinoConConsulta('/admin/x', { q: 'a b&c' })).toBe('/admin/x?q=a+b%26c');
  });
});

describe('redirigirPermanente', () => {
  it('usa permanentRedirect (308) con la consulta conservada y nunca regresa', () => {
    expect(() => redirigirPermanente('/admin/consumo', { tenant: 't-1' })).toThrow('NEXT_REDIRECT:/admin/consumo?tenant=t-1');
    expect(permanente).toHaveBeenCalledWith('/admin/consumo?tenant=t-1');
  });
});
