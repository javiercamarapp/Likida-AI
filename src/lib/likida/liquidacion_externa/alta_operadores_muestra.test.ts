import { describe, it, expect } from 'vitest';
import { completarPadronConAltas, type DepsAltaMuestra } from './alta_operadores_muestra';

const T = 't1';
const padron = [{ numeroEmpleado: '100', nombre: 'Ana Ruiz' }];
function deps(permite = true, falla: string[] = []) {
  const insertados: string[] = [];
  const d: DepsAltaMuestra = {
    permite: async () => permite,
    insertar: async (_t, nombre, numero) => { if (falla.includes(numero)) return null; insertados.push(`${numero}|${nombre}`); return {}; },
  };
  return { d, insertados };
}
const sobre = (...b: Array<Record<string, unknown>>) => ({ formato: 'muestra-tms', version: 1, bitacoras: b });

describe('completarPadronConAltas (muestra-tms)', () => {
  it('da de alta el número que no está y lo suma al padrón; el que ya está no se toca', async () => {
    const { d, insertados } = deps();
    const r = await completarPadronConAltas(T, sobre({ BitacoraID: 1, NumeroEmpleado: 200, Operador: 'Luis  Pérez' }, { BitacoraID: 2, NumeroEmpleado: '100', Operador: 'Ana Ruiz' }), padron, { simular: false }, d);
    expect(insertados).toEqual(['200|Luis Pérez']);
    expect(r).toEqual([...padron, { numeroEmpleado: '200', nombre: 'Luis Pérez' }]);
  });

  it('sin nombre utilizable lo rotula con el número; el mismo número en dos bitácoras se da de alta una vez', async () => {
    const { d, insertados } = deps();
    await completarPadronConAltas(T, sobre({ BitacoraID: 1, NumeroEmpleado: '300' }, { BitacoraID: 2, NumeroEmpleado: '300', Operador: 'x' }), [], { simular: false }, d);
    expect(insertados).toEqual(['300|Operador 300']);
  });

  it('sin NumeroEmpleado no se da de alta a nadie (sigue a revisión)', async () => {
    const { d, insertados } = deps();
    const r = await completarPadronConAltas(T, sobre({ BitacoraID: 1, Operador: 'Luis Pérez' }), padron, { simular: false }, d);
    expect(insertados).toEqual([]);
    expect(r).toEqual(padron);
  });

  it('simulación: no escribe, pero el padrón devuelto incluye al nuevo', async () => {
    const { d, insertados } = deps();
    const r = await completarPadronConAltas(T, { BitacoraID: 9, NumeroEmpleado: '400', Operador: 'Marta Gil' }, [], { simular: true }, d);
    expect(insertados).toEqual([]);
    expect(r).toEqual([{ numeroEmpleado: '400', nombre: 'Marta Gil' }]);
  });

  it('flota que no lo permite: el padrón queda igual', async () => {
    const { d, insertados } = deps(false);
    const r = await completarPadronConAltas(T, sobre({ BitacoraID: 1, NumeroEmpleado: '500' }), padron, { simular: false }, d);
    expect(insertados).toEqual([]);
    expect(r).toEqual(padron);
  });

  it('si el insert falla, ese número no entra al padrón (la bitácora va a revisión)', async () => {
    const { d } = deps(true, ['600']);
    const r = await completarPadronConAltas(T, sobre({ BitacoraID: 1, NumeroEmpleado: '600' }, { BitacoraID: 2, NumeroEmpleado: '601' }), [], { simular: false }, d);
    expect(r.map((o) => o.numeroEmpleado)).toEqual(['601']);
  });
});
