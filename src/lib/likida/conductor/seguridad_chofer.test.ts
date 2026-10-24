import { describe, expect, it } from 'vitest';
import { agruparEmergencias, filtrarViajesAvisables, viajeEnEmergencia } from './seguridad_chofer';
import { filaAViajeCtx } from './repo';

const v = (over: Record<string, unknown> = {}) => ({ id: 'v1', tenantId: 't1', operadorId: 'o1', unidadId: 'u1', ...over }) as never;

describe('A37-A5-02: emergencias abiertas', () => {
  const em = agruparEmergencias([{ tenant_id: 't1', operador_id: 'o9', viaje_id: null, unidad_id: null }, { tenant_id: 't1', operador_id: null, viaje_id: 'v7', unidad_id: 'u5' }]);
  it('detecta por operador, por viaje y por unidad, y solo dentro de SU flota', () => {
    expect(viajeEnEmergencia(v({ operadorId: 'o9' }), em)).toBe(true);
    expect(viajeEnEmergencia(v({ id: 'v7' }), em)).toBe(true);
    expect(viajeEnEmergencia(v({ unidadId: 'u5' }), em)).toBe(true);
    expect(viajeEnEmergencia(v({ operadorId: 'o9', tenantId: 't2' }), em)).toBe(false);
    expect(viajeEnEmergencia(v(), em)).toBe(false);
  });
  it('quita de la lista de trabajo los viajes en emergencia y los de operador no avisable', () => {
    const r = filtrarViajesAvisables([v(), v({ id: 'v2', operadorId: 'o9' }), v({ id: 'v3', operadorAvisable: false })], em);
    expect(r.viajes.map((x) => x.id)).toEqual(['v1']);
    expect(r).toMatchObject({ enEmergencia: 1, operadorNoAvisable: 1 });
  });
});

describe('A37-A5-03: operador de baja u oposición', () => {
  const fila = (op: Record<string, unknown>) => filaAViajeCtx({ id: 'v1', tenant_id: 't1', operador_id: 'o1', estatus: 'abierto', operador: { nombre: 'X', telefono: '1', ...op } });
  it('activo = false o oposición vigente → no avisable; activo normal → avisable', () => {
    expect(fila({ activo: false }).operadorAvisable).toBe(false);
    expect(fila({ activo: true, oposicion_automatizada: '2026-10-01T00:00:00Z' }).operadorAvisable).toBe(false);
    expect(fila({ activo: true, oposicion_automatizada: null }).operadorAvisable).toBe(true);
  });
});
