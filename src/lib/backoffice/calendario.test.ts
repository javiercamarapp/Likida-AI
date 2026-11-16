import { describe, expect, it } from 'vitest';
import { armarCalendario, ordenarCalendario, resumenCalendario } from './calendario';
import type { Candado, Cumplimiento, ObligacionFiscal } from './fiscal';

const ob = (clave: string, extra: Partial<ObligacionFiscal> = {}): ObligacionFiscal => ({
  clave, nombre: clave, periodicidad: 'mensual', diaLimite: 17, mesLimite: null, mesesDesfase: 1, requiereEntidad: true, estadoCatalogo: 'pendiente_de_contador', ...extra,
});
const CATALOGO: ObligacionFiscal[] = [
  ob('iva_mensual'),
  ob('declaracion_anual', { periodicidad: 'anual', diaLimite: 31, mesLimite: 3, mesesDesfase: 0 }),
  ob('conservacion_5_anios', { periodicidad: 'evento', diaLimite: null, requiereEntidad: false }),
];
const cumple = (clave: string, periodo: string, estado: Cumplimiento['estado']): Cumplimiento => ({
  clave, periodo, estado, paqueteGeneradoEn: estado === 'paquete_listo' ? '2026-11-10T00:00:00Z' : null,
  presentadaPor: estado === 'presentada' ? 'Javier' : null, presentadaEn: estado === 'presentada' ? '2026-11-12' : null, acuseRef: estado === 'presentada' ? 'ACUSE-1' : null, nota: null,
});
const SIN_RFC: Candado = { bloqueado: true, motivo: 'sin_rfc' };
const CON_RFC: Candado = { bloqueado: false, rfc: 'ABC010101AB1' };
const HOY = '2026-11-16';
// La sociedad se constituyó en octubre: los periodos anteriores no se le exigen (sin esta fecha, el mes anterior sin presentar sale vencido).
const CONSTITUCION = '2026-10-01';

describe('armarCalendario', () => {
  it('sin RFC: lo que requiere entidad «aún no aplica» y NO lleva fecha ni vigencia (no se inventa un calendario)', () => {
    const f = armarCalendario({ obligaciones: CATALOGO, cumplimientos: [], candado: SIN_RFC, hoy: HOY });
    const iva = f.find((x) => x.clave === 'iva_mensual')!;
    expect(iva).toMatchObject({ estado: 'aun_no_aplica', fechaLimite: null, dias: null, vigencia: null, periodo: null });
    expect(f.find((x) => x.clave === 'declaracion_anual')?.estado).toBe('aun_no_aplica');
    // la conservación no requiere entidad: es un evento, sin fecha
    expect(f.find((x) => x.clave === 'conservacion_5_anios')).toMatchObject({ estado: 'sin_fecha', fechaLimite: null });
  });

  it('con RFC: el periodo de octubre vence el 17 de noviembre, a 1 día, y se clasifica por vencer', () => {
    const iva = armarCalendario({ obligaciones: CATALOGO, cumplimientos: [], candado: CON_RFC, constituidaEl: CONSTITUCION, hoy: HOY }).find((x) => x.clave === 'iva_mensual')!;
    expect(iva).toMatchObject({ estado: 'pendiente', periodo: '2026-10-01', fechaLimite: '2026-11-17', dias: 1, sujetaADiaInhabil: false });
    expect(iva.vigencia?.estado).toBe('por_vencer');
  });

  it('sin fecha de constitución, el mes anterior sin presentar sale VENCIDO: no se esconde lo pendiente', () => {
    const iva = armarCalendario({ obligaciones: CATALOGO, cumplimientos: [], candado: CON_RFC, hoy: HOY }).find((x) => x.clave === 'iva_mensual')!;
    expect(iva).toMatchObject({ periodo: '2026-09-01', fechaLimite: '2026-10-17', dias: -30 });
    expect(iva.vigencia?.estado).toBe('vencido');
  });

  it('un periodo pasado sin presentar sale VENCIDO con días negativos (no se salta al siguiente)', () => {
    const iva = armarCalendario({ obligaciones: CATALOGO, cumplimientos: [], candado: CON_RFC, constituidaEl: CONSTITUCION, hoy: '2026-11-20' }).find((x) => x.clave === 'iva_mensual')!;
    expect(iva).toMatchObject({ periodo: '2026-10-01', fechaLimite: '2026-11-17', dias: -3 });
    expect(iva.vigencia?.estado).toBe('vencido');
  });

  it('presentado el periodo vencido, la fila pasa al siguiente periodo', () => {
    const iva = armarCalendario({ obligaciones: CATALOGO, cumplimientos: [cumple('iva_mensual', '2026-10-01', 'presentada')], candado: CON_RFC, constituidaEl: CONSTITUCION, hoy: HOY })
      .find((x) => x.clave === 'iva_mensual')!;
    expect(iva).toMatchObject({ periodo: '2026-11-01', fechaLimite: '2026-12-17', estado: 'pendiente' });
    expect(iva.vigencia?.estado).toBe('vigente');
  });

  it('paquete listo no cierra el periodo: sigue en la fila con su estado', () => {
    const iva = armarCalendario({ obligaciones: CATALOGO, cumplimientos: [cumple('iva_mensual', '2026-10-01', 'paquete_listo')], candado: CON_RFC, constituidaEl: CONSTITUCION, hoy: HOY }).find((x) => x.clave === 'iva_mensual')!;
    expect(iva).toMatchObject({ estado: 'paquete_listo', periodo: '2026-10-01' });
    expect(iva.cumplimiento?.estado).toBe('paquete_listo');
  });

  it('los periodos anteriores a la constitución no se exigen', () => {
    const iva = armarCalendario({ obligaciones: CATALOGO, cumplimientos: [], candado: CON_RFC, constituidaEl: '2026-11-03', hoy: '2026-11-20' }).find((x) => x.clave === 'iva_mensual')!;
    // octubre es anterior a la constitución: la fila arranca en noviembre
    expect(iva.periodo).toBe('2026-11-01');
  });

  it('día límite en fin de semana: fecha nominal con la bandera', () => {
    const f = armarCalendario({ obligaciones: [ob('iva_mensual')], cumplimientos: [], candado: CON_RFC, constituidaEl: '2025-12-01', hoy: '2026-01-10' })[0];
    expect(f.fechaLimite).toBe('2026-01-17');
    expect(f.sujetaADiaInhabil).toBe(true);
  });

  it('la anual toma el ejercicio cuyo vencimiento es el próximo', () => {
    const anual = armarCalendario({ obligaciones: CATALOGO, cumplimientos: [], candado: CON_RFC, constituidaEl: CONSTITUCION, hoy: HOY }).find((x) => x.clave === 'declaracion_anual')!;
    expect(anual.fechaLimite).toBe('2027-03-31');
    expect(anual.periodo).toBe('2026-01-01');
  });
});

describe('resumen y orden', () => {
  it('resumenCalendario cuenta por estado y por vigencia', () => {
    const cumpl = [cumple('iva_mensual', '2026-10-01', 'presentada')];
    const r = resumenCalendario(armarCalendario({ obligaciones: CATALOGO, cumplimientos: cumpl, candado: CON_RFC, constituidaEl: CONSTITUCION, hoy: '2026-11-20' }));
    expect(r.total).toBe(3);
    expect(r.aunNoAplica).toBe(0);
    expect(r.vencidas).toBe(0);
    const sin = resumenCalendario(armarCalendario({ obligaciones: CATALOGO, cumplimientos: [], candado: SIN_RFC, hoy: HOY }));
    expect(sin.aunNoAplica).toBe(2);
    expect(sin.vencidas + sin.porVencer).toBe(0);
  });

  it('ordenarCalendario pone lo vencido primero y lo que no tiene fecha al final', () => {
    const f = ordenarCalendario(armarCalendario({ obligaciones: CATALOGO, cumplimientos: [], candado: CON_RFC, constituidaEl: CONSTITUCION, hoy: '2026-11-20' }));
    expect(f.map((x) => x.clave)).toEqual(['iva_mensual', 'declaracion_anual', 'conservacion_5_anios']);
  });
});
