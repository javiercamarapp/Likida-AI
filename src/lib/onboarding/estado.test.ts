import { describe, expect, it } from 'vitest';
import { claveEstado, crearEstadoLocal, debeInvitar, debeMostrarPista, ESTADO_VACIO, normalizar, onboardingDesactivado, type Almacen } from './estado';
import { PRERREQUISITO_POR_PANTALLA, asistenteDe } from './asistente';
import { PANTALLAS } from './pantallas';

const falso = (): Almacen & { datos: Map<string, string> } => {
  const datos = new Map<string, string>();
  return { datos, getItem: (k) => datos.get(k) ?? null, setItem: (k, v) => { datos.set(k, v); }, removeItem: (k) => { datos.delete(k); } };
};

describe('estado del onboarding', () => {
  it('guarda y lee por ámbito, sin dejar el id en claro en la clave', () => {
    const a = falso();
    const e = crearEstadoLocal('tenant-1:usuario-9', a);
    expect(e.leer()).toEqual(ESTADO_VACIO);
    e.guardar({ visto: true, modo: 'corto' });
    expect(crearEstadoLocal('tenant-1:usuario-9', a).leer()).toMatchObject({ visto: true, modo: 'corto' });
    expect(crearEstadoLocal('tenant-1:otro', a).leer()).toEqual(ESTADO_VACIO);
    expect(claveEstado('tenant-1:usuario-9')).not.toContain('usuario-9');
  });
  it('sin almacén, con JSON roto o con una excepción nunca lanza', () => {
    expect(crearEstadoLocal('x', null).guardar({ visto: true }).visto).toBe(true);
    const roto = falso(); roto.datos.set(claveEstado('x'), '{no es json');
    expect(crearEstadoLocal('x', roto).leer()).toEqual(ESTADO_VACIO);
    const lanza: Almacen = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('cuota'); }, removeItem: () => {} };
    expect(crearEstadoLocal('x', lanza).guardar({ descartado: true }).descartado).toBe(true);
    expect(onboardingDesactivado(lanza)).toBe(false);
  });
  it('normaliza formas raras y recorta las pistas a rutas de /dashboard', () => {
    expect(normalizar({ visto: 'sí', modo: 'raro', pistas: ['/dashboard/x', '/admin', 3] })).toEqual({ visto: false, descartado: false, modo: null, pistas: ['/dashboard/x'] });
  });
  it('invita solo la primera vez, nunca en «ver como» ni con el interruptor apagado', () => {
    const o = { soloLectura: false, desactivado: false };
    expect(debeInvitar(ESTADO_VACIO, o)).toBe(true);
    expect(debeInvitar({ ...ESTADO_VACIO, visto: true }, o)).toBe(false);
    expect(debeInvitar({ ...ESTADO_VACIO, descartado: true }, o)).toBe(false);
    expect(debeInvitar(ESTADO_VACIO, { ...o, soloLectura: true })).toBe(false);
    expect(debeInvitar(ESTADO_VACIO, { ...o, desactivado: true })).toBe(false);
    expect(debeMostrarPista(ESTADO_VACIO, '/dashboard/a', o)).toBe(true);
    expect(debeMostrarPista({ ...ESTADO_VACIO, pistas: ['/dashboard/a'] }, '/dashboard/a', o)).toBe(false);
  });
});

describe('asistente y prerrequisitos', () => {
  it('el asistente depende del perfil y del menú del rol', () => {
    expect(asistenteDe('flota_admin', 'cinco_agentes')?.href).toBe('/dashboard/puesta-en-marcha');
    expect(asistenteDe('flota_admin', null)?.href).toBe('/dashboard/arranque');
    expect(asistenteDe('contador', 'cinco_agentes')).toBeNull();
    expect(asistenteDe('nomina', 'cinco_agentes')).toBeNull();
  });
  it('cada prerrequisito apunta a una pantalla del catálogo y trae su nota', () => {
    // El tipo `IdPaso` de `paso` ya impide un id inventado en compilación; aquí se comprueba la pantalla y la nota.
    for (const [ruta, pre] of Object.entries(PRERREQUISITO_POR_PANTALLA)) {
      expect(Object.hasOwn(PANTALLAS, ruta), ruta).toBe(true);
      expect(pre.nota.length, ruta).toBeGreaterThan(10);
    }
  });
});
