import { describe, expect, it } from 'vitest';
import { NO_DISPONIBLE, OK } from './lectura';
import {
  candadoDeEntidad, diasEntre, diaDeLaSemana, esFechaIso, estaCerrado, estadoObligacion, fechaLimiteNominal, periodosCandidatos, primerDiaDelMes, proximaFecha,
  sumarMeses, ultimoDiaDelMes, type Cumplimiento, type ObligacionFiscal,
} from './fiscal';

const mensual = (extra: Partial<ObligacionFiscal> = {}): ObligacionFiscal => ({
  clave: 'iva_mensual', nombre: 'IVA: declaración mensual', periodicidad: 'mensual', diaLimite: 17, mesLimite: null, mesesDesfase: 1,
  requiereEntidad: true, estadoCatalogo: 'pendiente_de_contador', ...extra,
});
const anual: ObligacionFiscal = { ...mensual(), clave: 'declaracion_anual', periodicidad: 'anual', diaLimite: 31, mesLimite: 3, mesesDesfase: 0 };
const evento: ObligacionFiscal = { ...mensual(), clave: 'conservacion_5_anios', periodicidad: 'evento', diaLimite: null, requiereEntidad: false };

describe('fechas ISO', () => {
  it('esFechaIso rechaza lo que no existe', () => {
    expect(esFechaIso('2026-02-28')).toBe(true);
    expect(esFechaIso('2026-02-30')).toBe(false);
    expect(esFechaIso('2026-13-01')).toBe(false);
    expect(esFechaIso('26-01-01')).toBe(false);
  });
  it('sumarMeses cruza el año hacia los dos lados', () => {
    expect(sumarMeses('2026-11-01', 2)).toBe('2027-01-01');
    expect(sumarMeses('2026-01-15', -1)).toBe('2025-12-01');
    expect(sumarMeses('2026-03-01', -15)).toBe('2024-12-01');
  });
  it('último día del mes, primer día y días entre fechas', () => {
    expect(ultimoDiaDelMes(2028, 2)).toBe(29);
    expect(ultimoDiaDelMes(2026, 2)).toBe(28);
    expect(primerDiaDelMes('2026-10-17')).toBe('2026-10-01');
    expect(diasEntre('2026-10-01', '2026-10-17')).toBe(16);
    expect(diasEntre('2026-10-17', '2026-10-01')).toBe(-16);
    expect(diasEntre('2026-12-31', '2027-01-01')).toBe(1);
  });
  it('día de la semana: 17 de enero de 2026 es sábado', () => {
    expect(diaDeLaSemana('2026-01-17')).toBe(6);
    expect(diaDeLaSemana('2026-01-18')).toBe(0);
    expect(diaDeLaSemana('2026-01-19')).toBe(1);
  });
});

describe('fecha límite nominal', () => {
  it('mensual con desfase 1: el periodo de octubre vence el 17 de noviembre', () => {
    expect(fechaLimiteNominal(mensual(), '2026-10-01')).toBe('2026-11-17');
    expect(fechaLimiteNominal(mensual(), '2026-12-01')).toBe('2027-01-17');
  });
  it('el día límite se recorta al último día de un mes corto', () => {
    expect(fechaLimiteNominal(mensual({ diaLimite: 31 }), '2026-01-01')).toBe('2026-02-28');
  });
  it('desfase 2 (contabilidad electrónica): el periodo de octubre vence el 3 de diciembre', () => {
    expect(fechaLimiteNominal(mensual({ diaLimite: 3, mesesDesfase: 2 }), '2026-10-01')).toBe('2026-12-03');
  });
  it('anual: el ejercicio 2026 vence el 31 de marzo de 2027', () => {
    expect(fechaLimiteNominal(anual, '2026-01-01')).toBe('2027-03-31');
  });
  it('un evento no tiene fecha', () => {
    expect(fechaLimiteNominal(evento, '2026-10-01')).toBeNull();
  });
});

describe('proximaFecha', () => {
  it('con el día 17 en fin de semana devuelve la fecha NOMINAL (no la corre al lunes) y la bandera', () => {
    const p = proximaFecha(mensual(), '2026-01-10');
    expect(p).toEqual({ fecha: '2026-01-17', periodo: '2025-12-01', sujetaADiaInhabil: true, nominal: true });
  });
  it('un día hábil no lleva bandera', () => {
    const p = proximaFecha(mensual(), '2026-11-10');
    expect(p.fecha).toBe('2026-11-17');
    expect(p.sujetaADiaInhabil).toBe(false);
  });
  it('el mismo día límite cuenta como próxima (hoy es el día); el día siguiente salta al mes que sigue', () => {
    expect(proximaFecha(mensual(), '2026-11-17').fecha).toBe('2026-11-17');
    expect(proximaFecha(mensual(), '2026-11-18').fecha).toBe('2026-12-17');
  });
  it('un evento no tiene próxima fecha', () => {
    expect(proximaFecha(evento, '2026-11-10')).toEqual({ fecha: null, periodo: null, sujetaADiaInhabil: false, nominal: true });
  });
  it('anual: tras el 31 de marzo salta al ejercicio siguiente', () => {
    expect(proximaFecha(anual, '2027-03-30').fecha).toBe('2027-03-31');
    expect(proximaFecha(anual, '2027-04-02').fecha).toBe('2028-03-31');
  });
  it('los candidatos de periodo van del más viejo al más nuevo', () => {
    expect(periodosCandidatos(mensual(), '2026-11-10')).toEqual(['2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01']);
    expect(periodosCandidatos(evento, '2026-11-10')).toEqual([]);
  });
});

describe('candado de entidad', () => {
  it('sin RFC (null, vacío o en blanco) está bloqueado: no se rellena nada', () => {
    expect(candadoDeEntidad(OK({ rfc: null }))).toEqual({ bloqueado: true, motivo: 'sin_rfc' });
    expect(candadoDeEntidad(OK({ rfc: '   ' }))).toEqual({ bloqueado: true, motivo: 'sin_rfc' });
    expect(candadoDeEntidad(OK(null))).toEqual({ bloqueado: true, motivo: 'sin_rfc' });
  });
  it('una entidad ilegible también bloquea, con su causa', () => {
    expect(candadoDeEntidad(NO_DISPONIBLE)).toEqual({ bloqueado: true, motivo: 'entidad_no_disponible' });
    expect(candadoDeEntidad({ estado: 'error', mensaje: 'x' })).toEqual({ bloqueado: true, motivo: 'entidad_no_leida' });
  });
  it('con RFC se abre', () => {
    expect(candadoDeEntidad(OK({ rfc: ' ABC010101AB1 ' }))).toEqual({ bloqueado: false, rfc: 'ABC010101AB1' });
  });
});

describe('estado de una obligación', () => {
  const cerrado: Cumplimiento = { clave: 'iva_mensual', periodo: '2026-10-01', estado: 'presentada', paqueteGeneradoEn: null, presentadaPor: 'Javier', presentadaEn: '2026-11-16', acuseRef: 'A1', nota: null };
  const bloqueado = { bloqueado: true, motivo: 'sin_rfc' } as const;
  const abierto = { bloqueado: false, rfc: 'ABC010101AB1' } as const;

  it('sin entidad, lo que requiere entidad «aún no aplica»; lo que no, sigue su curso', () => {
    expect(estadoObligacion(mensual(), bloqueado, null)).toBe('aun_no_aplica');
    expect(estadoObligacion(evento, bloqueado, null)).toBe('sin_fecha');
  });
  it('con entidad: pendiente por omisión, o el estado guardado', () => {
    expect(estadoObligacion(mensual(), abierto, null)).toBe('pendiente');
    expect(estadoObligacion(mensual(), abierto, cerrado)).toBe('presentada');
  });
  it('estaCerrado: presentada o no aplica cierran; pendiente y paquete listo no', () => {
    expect(estaCerrado(cerrado)).toBe(true);
    expect(estaCerrado({ ...cerrado, estado: 'no_aplica' })).toBe(true);
    expect(estaCerrado({ ...cerrado, estado: 'paquete_listo' })).toBe(false);
    expect(estaCerrado(null)).toBe(false);
  });
});
