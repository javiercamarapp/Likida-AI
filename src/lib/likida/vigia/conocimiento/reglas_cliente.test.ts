import { describe, it, expect } from 'vitest';
import { REGLAS_POR_OMISION, mezclarReglas, reglasDeCliente, minutosDeHora, ESTADOS_PLANTA_POR_OMISION, CAMPOS_QR_POR_OMISION } from './reglas_cliente';

describe('reglas por cliente: valores genéricos y mezcla segura', () => {
  it('la omisión no inventa cifras ni horarios: lo no configurado es null', () => {
    expect(REGLAS_POR_OMISION.horarioLimiteDatos).toBeNull();
    expect(REGLAS_POR_OMISION.horaPublicacionDatos).toBeNull();
    expect(REGLAS_POR_OMISION.plazoPodHoras).toBeNull();
    expect(REGLAS_POR_OMISION.documentoPod).toBeNull();
    expect(REGLAS_POR_OMISION.zonaHoraria).toBeNull();
  });
  it('trae los 6 estados de planta y los 8 campos de QR por omisión', () => {
    expect(REGLAS_POR_OMISION.estadosPlanta).toHaveLength(6);
    expect(REGLAS_POR_OMISION.estadosPlanta).toEqual([...ESTADOS_PLANTA_POR_OMISION]);
    expect(REGLAS_POR_OMISION.camposQr).toHaveLength(8);
    expect(REGLAS_POR_OMISION.camposQr).toEqual([...CAMPOS_QR_POR_OMISION]);
  });
  it('mezcla lo válido y conserva lo demás', () => {
    const r = reglasDeCliente({ horarioLimiteDatos: '20:00', canal: 'ambos', exigePdf: true, plazoPodHoras: 12, quienAutoriza: { salida: 'flota' }, requisitosPlanta: { qrRequerido: true } });
    expect(r.horarioLimiteDatos).toBe('20:00');
    expect(r.canal).toBe('ambos');
    expect(r.exigePdf).toBe(true);
    expect(r.plazoPodHoras).toBe(12);
    expect(r.quienAutoriza.salida).toBe('flota');
    expect(r.quienAutoriza.cobros).toBe('gerencia');
    expect(r.requisitosPlanta.qrRequerido).toBe(true);
    expect(r.requisitosPlanta.prealertaRequerida).toBe(false);
  });
  it('ignora valores con forma inválida sin lanzar', () => {
    const r = reglasDeCliente({ horarioLimiteDatos: '25:99', canal: 'paloma', plazoPodHoras: -3, camposQr: [], estadosPlanta: 'x', quienAutoriza: { salida: 'cualquiera' }, exigePdf: 'si' });
    expect(r).toEqual(REGLAS_POR_OMISION);
    expect(reglasDeCliente(null)).toEqual(REGLAS_POR_OMISION);
    expect(reglasDeCliente('texto')).toEqual(REGLAS_POR_OMISION);
    expect(reglasDeCliente([1])).toEqual(REGLAS_POR_OMISION);
  });
  it('un null explícito vuelve a «no configurado»', () => {
    const base = mezclarReglas(REGLAS_POR_OMISION, { horarioLimiteDatos: '16:00' });
    expect(mezclarReglas(base, { horarioLimiteDatos: null }).horarioLimiteDatos).toBeNull();
  });
  it('no muta la base ni comparte listas con ella', () => {
    const r = mezclarReglas(REGLAS_POR_OMISION, { camposFichaObligatorios: ['linea'] });
    expect(r.camposFichaObligatorios).toEqual(['linea']);
    expect(REGLAS_POR_OMISION.camposFichaObligatorios.length).toBeGreaterThan(1);
  });
  it('minutosDeHora', () => {
    expect(minutosDeHora('08:30')).toBe(510);
    expect(minutosDeHora('24:00')).toBeNull();
    expect(minutosDeHora(null)).toBeNull();
  });
});
