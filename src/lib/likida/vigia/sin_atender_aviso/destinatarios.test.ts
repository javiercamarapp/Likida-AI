import { describe, expect, it } from 'vitest';
import { destinatariosDelResumen } from './destinatarios';
import { alerta, AHORA_DIA, AHORA_NOCHE, CLIENTE_A, CLIENTE_B, crudos } from './fixtures';

const mapa = (pares: Array<[string, string]>) => new Map(pares);
const correos = (r: ReturnType<typeof destinatariosDelResumen>) => r.destinatarios.map((d) => d.correo).sort();

describe('destinatarios del resumen', () => {
  it('de día: servicio y gerente de siempre; la guardia de noche no', () => {
    const r = destinatariosDelResumen({ crudos: crudos(), alertas: [alerta()], clienteDeChat: mapa([['g1', CLIENTE_A]]), ahora: new Date(AHORA_DIA) });
    expect(r.turno).toBe('dia');
    expect(correos(r)).toEqual(['dia@ejemplo.test', 'servicio1@ejemplo.test']);
  });
  it('de noche: además de los de siempre entra la guardia de noche', () => {
    const r = destinatariosDelResumen({ crudos: crudos(), alertas: [alerta()], clienteDeChat: mapa([['g1', CLIENTE_A]]), ahora: new Date(AHORA_NOCHE) });
    expect(r.turno).toBe('noche');
    expect(correos(r)).toContain('noche@ejemplo.test');
  });
  it('el dueño solo recibe si hay una alerta alta en un grupo crítico', () => {
    const base = { crudos: crudos(), clienteDeChat: mapa([['g1', CLIENTE_A]]), ahora: new Date(AHORA_DIA) };
    expect(correos(destinatariosDelResumen({ ...base, alertas: [alerta({ nivel: 'alta' })] }))).not.toContain('dueno@ejemplo.test');
    expect(correos(destinatariosDelResumen({ ...base, alertas: [alerta({ nivel: 'alta', critico: true })] }))).toContain('dueno@ejemplo.test');
  });
  it('el servicio de OTRO cliente no recibe el resumen de este grupo', () => {
    const c = crudos({ servicio: [{ nombre: 'Servicio B', correo: 'b@ejemplo.test', clienteId: CLIENTE_B }] });
    const r = destinatariosDelResumen({ crudos: c, alertas: [alerta()], clienteDeChat: mapa([['g1', CLIENTE_A]]), ahora: new Date(AHORA_DIA) });
    expect(correos(r)).not.toContain('b@ejemplo.test');
  });
  it('sin correos configurados no hay destinatarios; sin repetir y con tope de 10', () => {
    expect(destinatariosDelResumen({ crudos: crudos({ servicio: [], nivel1: [], nivel2: [] }), alertas: [alerta()], clienteDeChat: mapa([]), ahora: new Date(AHORA_DIA) }).destinatarios).toEqual([]);
    const muchos = crudos({ servicio: Array.from({ length: 15 }, (_, i) => ({ nombre: `S${i}`, correo: `s${i}@ejemplo.test`, clienteId: null })), nivel1: [{ nombre: 'x', correo: 'S1@ejemplo.test', turno: 'siempre' }] });
    const r = destinatariosDelResumen({ crudos: muchos, alertas: [alerta()], clienteDeChat: mapa([]), ahora: new Date(AHORA_DIA) });
    expect(r.destinatarios).toHaveLength(10);
    expect(new Set(r.destinatarios.map((d) => d.correo)).size).toBe(10);
  });
  it('si el turno deja vacío al nivel, nadie queda sin cobertura', () => {
    const c = crudos({ servicio: [], nivel1: [{ nombre: 'Guardia noche', correo: 'noche@ejemplo.test', turno: 'noche' }] });
    const r = destinatariosDelResumen({ crudos: c, alertas: [alerta()], clienteDeChat: mapa([]), ahora: new Date(AHORA_DIA) });
    expect(correos(r)).toEqual(['noche@ejemplo.test']);
    expect(r.cayoATodos).toBe(true);
  });
});
