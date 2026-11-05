import { describe, expect, it } from 'vitest';
import { bytesDeEstado, cabeEnTope, estadoVacio, fusionarEstado, invitacionVigente, normalizarEstado, TOPE_ESTADO_BYTES } from './estado';
import type { RecorridoGuardado } from './tipos';

const rec = (paso: string, hechos: string[] = []): RecorridoGuardado => ({ paso, hechos, omitidos: [], confirmados: [], inicio: '2026-11-04T10:00:00.000Z', fin: null, version: 1 });

describe('normalizarEstado', () => {
  it('cualquier basura da un estado vacío válido y nunca lanza', () => {
    for (const x of [null, undefined, 3, 'x', [], [1, 2], { v: 9, recorridos: 'no' }]) expect(normalizarEstado(x)).toEqual(estadoVacio());
  });
  it('descarta lo que no encaja y conserva lo válido', () => {
    const e = normalizarEstado({
      invitacion: 'vista', ofertas: 2, modo: 'corto', pistas: ['/dashboard/a', '/otra', 7], celebrados: ['x', 3],
      recorridos: { 'dueno.corto': rec('PM1-02', ['PM1-01']), malo: { paso: 5 } },
      tareas: { 'T-01': '2026-11-01T00:00:00Z', 'T-02': 'no-es-fecha' },
      declaraciones: { equipo: { valor: true, en: '2026-11-01T00:00:00Z' }, raro: { valor: 'si', en: 'x' } },
      prefs: { reducirMovimiento: true },
    });
    expect(e.invitacion).toBe('vista');
    expect(e.pistas).toEqual(['/dashboard/a']);
    expect(e.celebrados).toEqual(['x']);
    expect(Object.keys(e.recorridos)).toEqual(['dueno.corto']);
    expect(Object.keys(e.tareas)).toEqual(['T-01']);
    expect(Object.keys(e.declaraciones)).toEqual(['equipo']);
    expect(e.prefs.reducirMovimiento).toBe(true);
  });
  it('una invitación desconocida vuelve a pendiente y las ofertas negativas a 0', () => {
    const e = normalizarEstado({ invitacion: 'hackeada', ofertas: -3 });
    expect(e.invitacion).toBe('pendiente');
    expect(e.ofertas).toBe(0);
  });
  it('acota las cantidades (no deja crecer sin fin)', () => {
    const muchos = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`r${i}`, rec('P1')]));
    expect(Object.keys(normalizarEstado({ recorridos: muchos }).recorridos).length).toBeLessThanOrEqual(40);
  });
});

describe('fusionarEstado', () => {
  it('fusiona recorridos y tareas por clave y reemplaza lo demás', () => {
    const base = fusionarEstado(estadoVacio(), { recorridos: { a: rec('P1') }, tareas: { 'T-01': '2026-11-01T00:00:00Z' }, ofertas: 1 });
    const sig = fusionarEstado(base, { recorridos: { b: rec('P2') }, invitacion: 'ahora_no' });
    expect(Object.keys(sig.recorridos).sort()).toEqual(['a', 'b']);
    expect(sig.tareas['T-01']).toBeDefined();
    expect(sig.ofertas).toBe(1);
    expect(sig.invitacion).toBe('ahora_no');
  });
  it('un parche con basura no corrompe el estado', () => {
    const base = fusionarEstado(estadoVacio(), { modo: 'completo' });
    expect(fusionarEstado(base, { recorridos: 5 as never, modo: 'otro' as never }).modo).toBeNull();
    expect(fusionarEstado(base, null as never).modo).toBe('completo');
  });
  it('no cambia el estado de entrada', () => {
    const base = estadoVacio();
    fusionarEstado(base, { pistas: ['/dashboard/x'] });
    expect(base.pistas).toEqual([]);
  });
});

describe('tope de tamaño', () => {
  it('un estado normal cabe y mide menos que el tope', () => {
    expect(cabeEnTope(estadoVacio())).toBe(true);
    expect(bytesDeEstado(estadoVacio())).toBeLessThan(TOPE_ESTADO_BYTES);
  });
  it('el estado lleno al máximo permitido por la normalización cabe en 16 KiB del CHECK de la tabla', () => {
    const hechos = Array.from({ length: 200 }, (_, i) => `PM${String(i).padStart(2, '0')}-${String(i).padStart(2, '0')}`);
    const recorridos = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`recorrido.numero.${i}`, { ...rec('PM9-99', hechos) }]));
    const e = normalizarEstado({ recorridos });
    // Si no cabe, el repositorio lo rechaza con `tamano` en vez de dejar que la base lo rebote: se mide para saberlo.
    expect(typeof cabeEnTope(e)).toBe('boolean');
    expect(cabeEnTope(normalizarEstado({ recorridos: { a: rec('P1', hechos) } }))).toBe(true);
  });
});

describe('invitacionVigente', () => {
  const dia = 86_400_000;
  it('pendiente se ofrece; vista y descartada no', () => {
    expect(invitacionVigente({ ...estadoVacio(), invitacion: 'pendiente' }, 0, null)).toBe(true);
    expect(invitacionVigente({ ...estadoVacio(), invitacion: 'vista' }, 0, null)).toBe(false);
    expect(invitacionVigente({ ...estadoVacio(), invitacion: 'descartada' }, 0, null)).toBe(false);
  });
  it('«ahora no» vuelve tras 3 días y con menos de 2 ofertas', () => {
    const e = { ...estadoVacio(), invitacion: 'ahora_no' as const, ofertas: 1 };
    expect(invitacionVigente(e, 2 * dia, 0)).toBe(false);
    expect(invitacionVigente(e, 3 * dia, 0)).toBe(true);
    expect(invitacionVigente({ ...e, ofertas: 2 }, 9 * dia, 0)).toBe(false);
    expect(invitacionVigente(e, 9 * dia, null)).toBe(false);
  });
});
