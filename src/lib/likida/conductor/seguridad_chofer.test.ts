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

describe('A39-A5-02: solo los voluntarios vigentes del piloto reciben mensajes proactivos', () => {
  const fila = (op: Record<string, unknown>) => filaAViajeCtx({ id: 'v1', tenant_id: 't1', operador_id: 'o1', estatus: 'abierto', operador: { nombre: 'X', telefono: '1', activo: true, ...op } });
  it('agente_voluntario = true → voluntario; false, null o columna ausente → NO (fail-closed)', () => {
    expect(fila({ agente_voluntario: true }).operadorVoluntario).toBe(true);
    expect(fila({ agente_voluntario: false }).operadorVoluntario).toBe(false);
    expect(fila({ agente_voluntario: null }).operadorVoluntario).toBe(false);
    expect(fila({}).operadorVoluntario).toBe(false);
  });
  it('el viaje aceptado por actividad de un no voluntario (o de uno dado de baja) sale de la lista de trabajo', () => {
    const em = agruparEmergencias([]);
    const lista = [
      fila({ agente_voluntario: true }),
      { ...fila({ agente_voluntario: false }), id: 'v2' }, // aceptado por el chofer / la oficina, pero sin voluntariado vigente
    ];
    const r = filtrarViajesAvisables(lista, em);
    expect(r.viajes.map((x) => x.id)).toEqual(['v1']);
    expect(r.noVoluntario).toBe(1);
  });
  it('un doble sin la marca (undefined) no se quita: solo el false explícito', () => {
    expect(filtrarViajesAvisables([v()], agruparEmergencias([])).viajes).toHaveLength(1);
  });
});
