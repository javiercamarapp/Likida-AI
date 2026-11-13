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
  it('1005: la noche configurable de la flota decide el turno (10 a 14: mediodía es noche; 23:00 ya no)', () => {
    const noche = { desdeHora: 10, hastaHora: 14 };
    const dia = destinatariosDelResumen({ crudos: crudos({ noche }), alertas: [alerta()], clienteDeChat: mapa([['g1', CLIENTE_A]]), ahora: new Date(AHORA_DIA) });
    expect(dia.turno).toBe('noche');
    expect(correos(dia)).toContain('noche@ejemplo.test');
    const tarde = destinatariosDelResumen({ crudos: crudos({ noche }), alertas: [alerta()], clienteDeChat: mapa([['g1', CLIENTE_A]]), ahora: new Date(AHORA_NOCHE) });
    expect(tarde.turno).toBe('dia');
    expect(correos(tarde)).not.toContain('noche@ejemplo.test');
  });
  it('1005: sin noche en los crudos sigue de 20 a 7 (igual que antes)', () => {
    expect(destinatariosDelResumen({ crudos: crudos(), alertas: [alerta()], clienteDeChat: mapa([['g1', CLIENTE_A]]), ahora: new Date(AHORA_NOCHE) }).turno).toBe('noche');
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
  it('A2: cada destinatario lleva el alcance de cliente con que se eligio', () => {
    const c = crudos({
      servicio: [{ nombre: 'Servicio A', correo: 'a@ejemplo.test', clienteId: CLIENTE_A }, { nombre: 'Servicio general', correo: 'todos@ejemplo.test', clienteId: null }],
    });
    const r = destinatariosDelResumen({ crudos: c, alertas: [alerta()], clienteDeChat: mapa([['g1', CLIENTE_A]]), ahora: new Date(AHORA_DIA) });
    const de = (correo: string) => r.destinatarios.find((d) => d.correo === correo)!;
    expect(de('a@ejemplo.test').clientes).toEqual([CLIENTE_A]);
    expect(de('todos@ejemplo.test').clientes).toBeNull();
    expect(de('dia@ejemplo.test').clientes).toBeNull();
  });
  it('A2: quien aparece ligado a un cliente y tambien para toda la flota queda para toda la flota; ligado a dos clientes junta ambos', () => {
    const c = crudos({
      servicio: [{ nombre: 'S', correo: 'dia@ejemplo.test', clienteId: CLIENTE_A }, { nombre: 'T', correo: 'dos@ejemplo.test', clienteId: CLIENTE_A }, { nombre: 'T', correo: 'DOS@ejemplo.test', clienteId: CLIENTE_B }],
    });
    const r = destinatariosDelResumen({ crudos: c, alertas: [alerta({ chatId: 'g1' }), alerta({ chatId: 'g2', clave: 'c2' })], clienteDeChat: mapa([['g1', CLIENTE_A], ['g2', CLIENTE_B]]), ahora: new Date(AHORA_DIA) });
    const de = (correo: string) => r.destinatarios.find((d) => d.correo === correo)!;
    expect(de('dia@ejemplo.test').clientes).toBeNull();
    expect([...(de('dos@ejemplo.test').clientes ?? [])].sort()).toEqual([CLIENTE_A, CLIENTE_B]);
  });
});
