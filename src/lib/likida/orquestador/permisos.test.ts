import { describe, expect, it } from 'vitest';
import { AREA_POR_HERRAMIENTA, areaDeHerramienta, herramientasDelRol, rolPuedeConversar, rolPuedeUsar } from './permisos';

const TODAS = Object.keys(AREA_POR_HERRAMIENTA);

describe('permisos del orquestador por rol', () => {
  it('el jefe de tráfico (encargado) ve operación y NINGUNA herramienta de dinero', () => {
    const v = herramientasDelRol('encargado', TODAS);
    expect(v).toContain('tablero_viajes');
    expect(v).toContain('estado_vigia');
    expect(v).toContain('escalar_a_persona');
    for (const d of ['kpis_flota', 'liquidaciones_flota', 'motor_fiscal', 'estado_cobranza', 'estado_buzon', 'estado_autofactura']) expect(v).not.toContain(d);
  });

  it('el contador ve dinero y NO el tablero de viajes ni al Vigía', () => {
    const v = herramientasDelRol('contador', TODAS);
    expect(v).toEqual(expect.arrayContaining(['kpis_flota', 'estado_buzon', 'estado_cobranza', 'estado_autofactura', 'consultar_normas']));
    for (const o of ['tablero_viajes', 'detalle_viaje', 'estado_vigia', 'salud_agentes']) expect(v).not.toContain(o);
    // Escalar es derivar: el contador también puede pedir que una persona decida.
    expect(v).toContain('escalar_a_persona');
  });

  it('el dueño y el superadmin ven todo', () => {
    expect(herramientasDelRol('flota_admin', TODAS)).toEqual(TODAS);
    expect(herramientasDelRol('superadmin', TODAS)).toEqual(TODAS);
  });

  it('un rol desconocido, vacío o el chofer no ven nada (fail closed)', () => {
    for (const r of ['operador', 'inventado', '', undefined]) {
      expect(herramientasDelRol(r, TODAS)).toEqual([]);
      expect(rolPuedeConversar(r)).toBe(false);
    }
  });

  it('una herramienta que no está en el mapa se niega aunque el rol sea el más alto', () => {
    expect(rolPuedeUsar('flota_admin', 'ejecutar_sql')).toBe(false);
    expect(areaDeHerramienta('constructor')).toBeUndefined();
    expect(areaDeHerramienta('toString')).toBeUndefined();
  });

  it('puede conversar quien ve operación o dinero', () => {
    for (const r of ['encargado', 'contador', 'flota_admin', 'superadmin']) expect(rolPuedeConversar(r)).toBe(true);
  });
});
