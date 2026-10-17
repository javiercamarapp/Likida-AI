import { describe, it, expect } from 'vitest';
import { normalizarAlias, resolverAlias, type AliasCliente } from './equivalencias';

const T1 = '00000000-0000-4000-8000-000000000001';
const T2 = '00000000-0000-4000-8000-000000000002';
const C1 = '10000000-0000-4000-8000-000000000001';
const C2 = '10000000-0000-4000-8000-000000000002';

const alias = (tenantId: string, texto: string, clienteId: string, campo: 'cliente' | 'consignatario' = 'cliente'): AliasCliente =>
  ({ tenantId, textoNormalizado: normalizarAlias(texto), clienteId, campo });

describe('normalizarAlias', () => {
  it('quita acentos, pasa a mayúsculas y colapsa espacios', () => {
    expect(normalizarAlias('  Distribuidora   Ñandú\tdel  Bajío ')).toBe('DISTRIBUIDORA NANDU DEL BAJIO');
  });
  it('nulo o vacío → cadena vacía', () => {
    expect(normalizarAlias(null)).toBe('');
    expect(normalizarAlias(undefined)).toBe('');
    expect(normalizarAlias('   ')).toBe('');
  });
  it('es idempotente', () => {
    const a = normalizarAlias('Cliente  Único');
    expect(normalizarAlias(a)).toBe(a);
  });
  it('no borra puntuación (un alias casi igual no cuenta como igual)', () => {
    expect(normalizarAlias('Cliente S.A.')).not.toBe(normalizarAlias('Cliente SA'));
  });
});

describe('resolverAlias', () => {
  const filas = [alias(T1, 'Cliente Uno', C1), alias(T1, 'Cliente Dos', C2)];

  it('alias exacto con acentos/espacios distintos → ese cliente', () => {
    expect(resolverAlias('  cliente   UNO ', 'cliente', T1, filas)).toEqual({ tipo: 'uno', clienteId: C1 });
    expect(resolverAlias('Clíente Dos', 'cliente', T1, filas)).toEqual({ tipo: 'uno', clienteId: C2 });
  });
  it('texto que no está en la tabla → ninguno (no adivina por parecido)', () => {
    expect(resolverAlias('Cliente Uno Norte', 'cliente', T1, filas)).toEqual({ tipo: 'ninguno' });
    expect(resolverAlias('', 'cliente', T1, filas)).toEqual({ tipo: 'ninguno' });
    expect(resolverAlias(null, 'cliente', T1, filas)).toEqual({ tipo: 'ninguno' });
  });
  it('dos clientes con el mismo alias → ambiguo', () => {
    const dup = [...filas, alias(T1, 'CLIENTE UNO', C2)];
    expect(resolverAlias('Cliente Uno', 'cliente', T1, dup)).toEqual({ tipo: 'ambiguo', clienteIds: [C1, C2] });
  });
  it('el mismo alias repetido para el mismo cliente no es ambigüedad', () => {
    expect(resolverAlias('Cliente Uno', 'cliente', T1, [...filas, alias(T1, 'cliente uno', C1)])).toEqual({ tipo: 'uno', clienteId: C1 });
  });
  it('aislamiento: un alias de otra flota nunca resuelve', () => {
    expect(resolverAlias('Cliente Uno', 'cliente', T1, [alias(T2, 'Cliente Uno', C1)])).toEqual({ tipo: 'ninguno' });
    // y tampoco crea ambigüedad con el de la propia flota
    expect(resolverAlias('Cliente Uno', 'cliente', T1, [alias(T1, 'Cliente Uno', C1), alias(T2, 'Cliente Uno', C2)]))
      .toEqual({ tipo: 'uno', clienteId: C1 });
  });
  it('el campo importa: un alias de consignatario no resuelve al pagador', () => {
    const f = [alias(T1, 'Planta Norte', C1, 'consignatario')];
    expect(resolverAlias('Planta Norte', 'cliente', T1, f)).toEqual({ tipo: 'ninguno' });
    expect(resolverAlias('Planta Norte', 'consignatario', T1, f)).toEqual({ tipo: 'uno', clienteId: C1 });
  });
});
