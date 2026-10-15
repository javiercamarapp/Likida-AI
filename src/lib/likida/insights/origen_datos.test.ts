import { describe, it, expect, afterEach } from 'vitest';
import {
  origenDe,
  peorOrigen,
  heredarOrigen,
  rotuloResumen,
  TENANT_SINTETICO_KIT,
  TEXTO_BANDA,
} from './origen_datos';
import type { Insight } from './tipos';

const REAL = '22222222-2222-4222-8222-222222222222';
const DEMO_ENV = '33333333-3333-4333-8333-333333333333';
const previo = process.env.DEMO_TENANT_ID;
afterEach(() => {
  if (previo === undefined) delete process.env.DEMO_TENANT_ID;
  else process.env.DEMO_TENANT_ID = previo;
});

const dato: Insight = {
  id: 'x1',
  agente: 'peajes',
  tipo: 'dato',
  severidad: 'info',
  quePaso: 'Hubo 3 casos sintéticos.',
  queSignifica: 'Lectura de prueba.',
  queHacer: 'Nada.',
  fuente: { tabla: 'tabla_sintetica', periodo: 'semana de prueba', n: 3 },
};

describe('origenDe', () => {
  it('tenant real sin filas → real', () => {
    expect(origenDe(REAL)).toBe('real');
  });
  it('tenant sintético del kit → simulado', () => {
    expect(origenDe(TENANT_SINTETICO_KIT)).toBe('simulado');
  });
  it('flota de ejemplo (DEMO_TENANT_ID) → ejemplo', () => {
    process.env.DEMO_TENANT_ID = DEMO_ENV;
    expect(origenDe(DEMO_ENV)).toBe('ejemplo');
  });
  it('sin tenant → real', () => {
    expect(origenDe(null)).toBe('real');
    expect(origenDe(undefined)).toBe('real');
  });
  it('fila con folio DEMO- en tenant real → simulado', () => {
    expect(origenDe(REAL, { folio: 'DEMO-24001' })).toBe('simulado');
  });
  it('fila con teléfono 28999… (con o sin lada 52) → simulado', () => {
    expect(origenDe(REAL, { telefono: '2899900001' })).toBe('simulado');
    expect(origenDe(REAL, { telefono: '+52 28999 00002' })).toBe('simulado');
  });
  it('fila con marca explícita de origen → esa marca', () => {
    expect(origenDe(REAL, { origen: 'ejemplo' })).toBe('ejemplo');
  });
  it('fila mezclada (una real, una sintética) → banda (simulado)', () => {
    expect(origenDe(REAL, [{ folio: 'F-1' }, { folio: 'DEMO-2' }])).toBe('simulado');
  });
  it('todas las filas reales → real', () => {
    expect(origenDe(REAL, [{ folio: 'F-1' }, { telefono: '5512345678' }])).toBe('real'); // grep-limpio:ok (fixture sintético no-28999)
  });
  it('mezcla ejemplo + simulado → manda simulado', () => {
    expect(origenDe(REAL, [{ origen: 'ejemplo' }, { origen: 'simulado' }])).toBe('simulado');
  });
  it('tenant real con fila nula → real', () => {
    expect(origenDe(REAL, null)).toBe('real');
  });
});

describe('peorOrigen / heredarOrigen / rotuloResumen', () => {
  it('peorOrigen sin argumentos es real y respeta el orden', () => {
    expect(peorOrigen()).toBe('real');
    expect(peorOrigen('real', 'ejemplo')).toBe('ejemplo');
    expect(peorOrigen('ejemplo', 'simulado', 'real')).toBe('simulado');
  });
  it('un Insight hereda el tipo y trae rótulo visible', () => {
    const h = heredarOrigen(dato, 'simulado');
    expect(h.tipo).toBe('simulado');
    expect('rotulo' in h && h.rotulo).toBe(TEXTO_BANDA.simulado);
    expect(h.quePaso).toBe(dato.quePaso);
    expect(h.fuente).toEqual(dato.fuente);
  });
  it('con origen real el Insight queda idéntico', () => {
    expect(heredarOrigen(dato, 'real')).toBe(dato);
  });
  it('el Resumen suma el rótulo solo si no es real', () => {
    expect(rotuloResumen('real')).toBeNull();
    expect(rotuloResumen('ejemplo')).toBe('Dato de ejemplo');
    expect(rotuloResumen('simulado')).toBe('Dato simulado');
  });
});
