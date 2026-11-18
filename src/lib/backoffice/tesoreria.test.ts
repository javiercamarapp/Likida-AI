import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba es pura'); } }));

import { invertirMovimiento, movimientosConciliables, saldoCuentaCent, saldosPorCuenta, validarMovimiento, type MovTesoreria } from './tesoreria';
import { ErrorBo } from './utiles-c';

const HOY = '2026-11-15';
const clave = (f: () => unknown): string | null => { try { f(); return null; } catch (e) { return e instanceof ErrorBo ? e.clave : `otro:${String(e)}`; } };
const e0 = { cuentaId: 'c1', fecha: '2026-11-10', concepto: 'ingreso', monto: 100 };

describe('validarMovimiento: el concepto decide el signo', () => {
  it('ingreso y saldo inicial suman; egreso resta; ajuste admite signo', () => {
    expect(validarMovimiento(e0, HOY).montoCent).toBe(10000);
    expect(validarMovimiento({ ...e0, concepto: 'saldo_inicial' }, HOY).montoCent).toBe(10000);
    expect(validarMovimiento({ ...e0, concepto: 'egreso' }, HOY).montoCent).toBe(-10000);
    expect(validarMovimiento({ ...e0, concepto: 'ajuste', monto: -2.5 }, HOY).montoCent).toBe(-250);
    expect(validarMovimiento({ ...e0, concepto: 'ajuste', monto: 2.5 }, HOY).montoCent).toBe(250);
  });
  it('un monto negativo en ingreso/egreso, cero, futuro, sin cuenta o concepto raro se rechaza', () => {
    expect(clave(() => validarMovimiento({ ...e0, monto: -1 }, HOY))).toBe('tesor.err_monto_positivo');
    expect(clave(() => validarMovimiento({ ...e0, concepto: 'egreso', monto: -1 }, HOY))).toBe('tesor.err_monto_positivo');
    expect(clave(() => validarMovimiento({ ...e0, monto: 0 }, HOY))).toBe('tesor.err_monto');
    expect(clave(() => validarMovimiento({ ...e0, fecha: '2026-11-16' }, HOY))).toBe('tesor.err_fecha_futura');
    expect(clave(() => validarMovimiento({ ...e0, cuentaId: '' }, HOY))).toBe('tesor.err_cuenta');
    expect(clave(() => validarMovimiento({ ...e0, concepto: 'traspaso' }, HOY))).toBe('tesor.err_concepto');
    expect(clave(() => validarMovimiento({ ...e0, concepto: 'reversa' }, HOY))).toBe('tesor.err_concepto');
  });
});

const mov = (o: Partial<MovTesoreria>): MovTesoreria => ({ id: 'm', cuentaId: 'c1', cuentaNombre: 'Banco', fecha: '2026-11-10', concepto: 'egreso', montoCent: -5000, nota: null, reversaDe: null, ...o });

describe('saldo = suma de movimientos', () => {
  it('suma y neutraliza con la reversa', () => {
    const movs = [mov({ id: 'a', concepto: 'saldo_inicial', montoCent: 100_000 }), mov({ id: 'b', montoCent: -5000 }), mov({ id: 'c', concepto: 'reversa', montoCent: 5000, reversaDe: 'b' })];
    expect(saldoCuentaCent(movs)).toBe(100_000);
    expect(saldoCuentaCent([])).toBe(0);
  });
  it('saldosPorCuenta cuenta los movimientos de cada una', () => {
    const r = saldosPorCuenta(
      [{ id: 'c1', nombre: 'Banco', tipo: 'banco', activa: true }, { id: 'c2', nombre: 'Stripe', tipo: 'stripe', activa: true }],
      [mov({ montoCent: 700 }), mov({ id: 'x', cuentaId: 'c2', montoCent: -200 }), mov({ id: 'y', cuentaId: 'c2', montoCent: -100 })],
    );
    expect(r.map((x) => [x.cuenta.id, x.saldoCent, x.movimientos])).toEqual([['c1', 700, 1], ['c2', -300, 2]]);
  });
});

describe('reversa', () => {
  it('monto contrario, enlazada y con motivo obligatorio', () => {
    expect(invertirMovimiento(mov({ id: 'b' }), 'capturado en la cuenta equivocada', HOY)).toEqual({
      cuentaId: 'c1', fecha: HOY, concepto: 'reversa', montoCent: 5000, reversaDe: 'b', motivo: 'capturado en la cuenta equivocada',
    });
    expect(clave(() => invertirMovimiento(mov({}), '  ', HOY))).toBe('tesor.err_motivo');
    expect(clave(() => invertirMovimiento(mov({ concepto: 'reversa' }), 'otra vez', HOY))).toBe('tesor.err_reversar_reversa');
  });
});

describe('movimientosConciliables', () => {
  const movs = [
    mov({ id: 'a' }), mov({ id: 'b' }), mov({ id: 'r', concepto: 'reversa', montoCent: 5000, reversaDe: 'b' }),
    mov({ id: 'i', concepto: 'saldo_inicial', montoCent: 9999 }), mov({ id: 'u' }), mov({ id: 'in', concepto: 'ingreso', montoCent: 800 }),
  ];
  it('excluye reversas, reversados, saldo inicial y ya usados; egresos por omisión', () => {
    expect(movimientosConciliables(movs, new Set(['u'])).map((m) => m.id)).toEqual(['a']);
  });
  it('ingresos si se piden', () => {
    expect(movimientosConciliables(movs, new Set(), 'ingreso').map((m) => m.id)).toEqual(['in']);
  });
});
