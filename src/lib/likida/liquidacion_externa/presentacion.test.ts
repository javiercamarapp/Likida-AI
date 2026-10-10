import { describe, it, expect } from 'vitest';
import { dinero, periodoTexto, cuerpoMensaje, primerNombre } from './presentacion';

describe('dinero: la moneda va SIEMPRE explícita', () => {
  it('pesos y dólares no se confunden', () => {
    expect(dinero(1234.5, 'MXN')).toBe('$1,234.50 MXN');
    expect(dinero(1234.5, 'USD')).toBe('US$1,234.50 USD');
  });
  it('negativos (el chofer debe) y cero medido', () => {
    expect(dinero(-750.4, 'MXN')).toContain('750.40');
    expect(dinero(-750.4, 'MXN')).toMatch(/-/);
    expect(dinero(0, 'MXN')).toBe('$0.00 MXN');
  });
});

describe('periodoTexto', () => {
  it('un solo día no se dice como rango', () => {
    expect(periodoTexto('2026-09-01', '2026-09-01')).not.toContain(' al ');
  });
  it('un rango dice «del … al …» con los días del calendario SIN correrse (las fechas son de día, no instantes)', () => {
    const t = periodoTexto('2026-09-01', '2026-09-07');
    expect(t).toContain(' al ');
    expect(t).toMatch(/01 sep 2026/);
    expect(t).toMatch(/07 sep 2026/);
  });
});

describe('primerNombre / cuerpoMensaje', () => {
  it('toma el primer nombre y lo acota', () => {
    expect(primerNombre('  Juan   Pérez  ')).toBe('Juan');
    expect(primerNombre('')).toBe('Hola');
    expect(primerNombre('X'.repeat(100))).toHaveLength(40);
  });

  it('el cuerpo trae periodo, total con moneda y la invitación a responder; cabe en el límite de Meta', () => {
    const t = cuerpoMensaje({ nombre: 'Juan Pérez', desde: '2026-09-01', hasta: '2026-09-07', total: 2499.75, moneda: 'MXN', sistemaOrigen: 'SAP' });
    expect(t).toContain('Hola Juan');
    expect(t).toContain('(SAP)');
    expect(t).toContain('$2,499.75 MXN');
    expect(t).toContain('Respóndeme con un botón');
    expect(t.length).toBeLessThanOrEqual(1024);
  });

  it('sin sistema de origen no deja paréntesis vacíos', () => {
    const t = cuerpoMensaje({ nombre: 'Ana', desde: '2026-09-01', hasta: '2026-09-07', total: 1, moneda: 'USD', sistemaOrigen: null });
    expect(t).not.toContain('()');
    expect(t).not.toContain('null');
  });
});
