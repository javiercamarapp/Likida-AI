import { describe, it, expect } from 'vitest';
import { CONFIG_CONDUCTOR_DEFAULT, dentroDeVentana, horaYDiaMx, inicioDiaMx, validarConfigConductor } from './config';

describe('validarConfigConductor', () => {
  it('los defaults son válidos y son 0/+15/+30/+45, escalar a los 90', () => {
    const v = validarConfigConductor({});
    expect('ok' in v && v.ok).toMatchObject({ solicitudesMin: [0, 15, 30, 45], escalarTrasMin: 90, horaInicio: 6, horaFin: 22, topeDiarioChofer: 12 });
  });

  it.each<[string, Parameters<typeof validarConfigConductor>[0], RegExp]>([
    ['escalera desordenada', { solicitudesMin: [0, 30, 15] }, /ascendente/],
    ['escalera repetida', { solicitudesMin: [0, 15, 15] }, /ascendente/],
    ['escalera vacía', { solicitudesMin: [] }, /entre 1 y 6/],
    ['escalera de siete', { solicitudesMin: [0, 1, 2, 3, 4, 5, 6] }, /entre 1 y 6/],
    ['escalera con texto', { solicitudesMin: [0, 'x' as unknown as number] }, /entre 1 y 6/],
    ['escalera negativa', { solicitudesMin: [-1, 5] }, /entre 1 y 6/],
    ['hora fin antes que inicio', { horaInicio: 10, horaFin: 9 }, /terminar después/],
    ['hora inicio 24', { horaInicio: 24 }, /inicio/],
    ['hora fin 0', { horaFin: 0 }, /fin/],
    ['sin días', { diasSemana: [] }, /día permitido/],
    ['día 8', { diasSemana: [1, 8] }, /día permitido/],
    ['escalar antes del último recordatorio', { escalarTrasMin: 40 }, /DESPUÉS del último/],
    ['escalar a 5 min', { escalarTrasMin: 5 }, /10 a 1,440/],
    ['segundo nivel 1 min', { segundoNivelMin: 1 }, /segundo nivel/],
    ['tope diario 0', { topeDiarioChofer: 0 }, /tope diario/],
    ['aplazamiento 1', { posponerMin: 1 }, /aplazamiento/],
    ['ventana de corrección 1', { ventanaCorreccionMin: 1 }, /corrección/],
    ['espera con decimales', { esperaCargaMin: 1.5 }, /espera de carga/],
  ])('rechaza: %s', (_n, cruda, patron) => {
    const v = validarConfigConductor(cruda);
    expect('error' in v && v.error).toMatch(patron);
  });

  it('normaliza: días únicos y ordenados, cadenas numéricas, booleanos', () => {
    const v = validarConfigConductor({ diasSemana: [3, 1, 3, 2], posponerMin: '45' as unknown as number, usarLlm: 0 as unknown as boolean });
    expect('ok' in v && v.ok).toMatchObject({ diasSemana: [1, 2, 3], posponerMin: 45, usarLlm: false });
  });

  it('una escalera de un solo valor es válida', () => {
    expect('ok' in validarConfigConductor({ solicitudesMin: [0], escalarTrasMin: 20 })).toBe(true);
  });

  it('los defaults del código están congelados (nadie los muta por referencia)', () => {
    expect(Object.isFrozen(CONFIG_CONDUCTOR_DEFAULT)).toBe(true);
  });
});

describe('la ventana de la flota (hora de México)', () => {
  const mx = (hhmm: string, dia = '2026-10-02') => new Date(`${dia}T${hhmm}:00-06:00`);
  const v = { horaInicio: 6, horaFin: 22, diasSemana: [1, 2, 3, 4, 5, 6] };

  it('incluye la hora de inicio y excluye la de fin', () => {
    expect(dentroDeVentana(v, mx('05:59'))).toBe(false);
    expect(dentroDeVentana(v, mx('06:00'))).toBe(true);
    expect(dentroDeVentana(v, mx('21:59'))).toBe(true);
    expect(dentroDeVentana(v, mx('22:00'))).toBe(false);
  });

  it('la hora es la de México, no la del servidor (UTC)', () => {
    // 03:00Z son las 21:00 del día anterior en México: dentro de la ventana.
    expect(dentroDeVentana(v, new Date('2026-10-03T03:00:00Z'))).toBe(true);
    // 12:00Z son las 06:00 en México.
    expect(dentroDeVentana(v, new Date('2026-10-02T12:00:00Z'))).toBe(true);
    expect(dentroDeVentana(v, new Date('2026-10-02T11:59:00Z'))).toBe(false);
  });

  it('los días van en ISO (domingo = 7)', () => {
    expect(horaYDiaMx(mx('10:00', '2026-10-04')).dia).toBe(7);
    expect(horaYDiaMx(mx('10:00', '2026-10-05')).dia).toBe(1);
    expect(dentroDeVentana(v, mx('10:00', '2026-10-04'))).toBe(false);
    expect(dentroDeVentana(v, mx('10:00', '2026-10-05'))).toBe(true);
  });

  it('medianoche cuenta como hora 0 (no 24)', () => {
    expect(horaYDiaMx(mx('00:00')).hora).toBe(0);
    expect(dentroDeVentana({ horaInicio: 0, horaFin: 24, diasSemana: [1, 2, 3, 4, 5, 6, 7] }, mx('00:30'))).toBe(true);
  });

  it('el inicio del día de México (para el tope diario)', () => {
    expect(inicioDiaMx(mx('10:00')).toISOString()).toBe('2026-10-02T06:00:00.000Z');
    expect(inicioDiaMx(new Date('2026-10-03T03:00:00Z')).toISOString()).toBe('2026-10-02T06:00:00.000Z');
    expect(inicioDiaMx(mx('00:00')).toISOString()).toBe('2026-10-02T06:00:00.000Z');
    expect(inicioDiaMx(mx('23:59')).toISOString()).toBe('2026-10-02T06:00:00.000Z');
  });
});

describe('validarConfigConductor — validación de ubicación y estadías (0385)', () => {
  it('los defaults: valida con 150 m de tolerancia, ventana de 30 min, pide ubicación, sin alertas de estadía ni foto', () => {
    const v = validarConfigConductor({});
    expect('ok' in v && v.ok).toMatchObject({
      validarUbicacion: true, toleranciaUbicacionM: 150, ventanaUbicacionMin: 30, pedirUbicacion: true,
      estadiaAlertaCargaMin: null, estadiaAlertaDescargaMin: null, pedirFotoEvidencia: false,
    });
  });

  it('acepta valores propios y la alerta vacía/null la apaga', () => {
    const v = validarConfigConductor({ toleranciaUbicacionM: 0, ventanaUbicacionMin: 120, estadiaAlertaCargaMin: 180, estadiaAlertaDescargaMin: null, pedirFotoEvidencia: true });
    expect('ok' in v && v.ok).toMatchObject({ toleranciaUbicacionM: 0, ventanaUbicacionMin: 120, estadiaAlertaCargaMin: 180, estadiaAlertaDescargaMin: null, pedirFotoEvidencia: true });
  });

  it.each<[string, Parameters<typeof validarConfigConductor>[0], RegExp]>([
    ['tolerancia negativa', { toleranciaUbicacionM: -1 }, /tolerancia/],
    ['tolerancia de 9 km', { toleranciaUbicacionM: 9000 }, /tolerancia/],
    ['tolerancia con decimales', { toleranciaUbicacionM: 12.5 }, /tolerancia/],
    ['ventana de 1 min', { ventanaUbicacionMin: 1 }, /ventana/],
    ['ventana de 10 h', { ventanaUbicacionMin: 600 }, /ventana/],
    ['alerta de 5 min', { estadiaAlertaCargaMin: 5 }, /alerta de estadía de carga/],
    ['alerta de 4 días', { estadiaAlertaDescargaMin: 6000 }, /alerta de estadía de descarga/],
    ['alerta no numérica (no se toma por «apagada»)', { estadiaAlertaCargaMin: 'pronto' as unknown as number }, /alerta de estadía de carga/],
    ['margen de acercamiento negativo', { margenAcercamientoM: -1 }, /margen de acercamiento/],
    ['margen de acercamiento de 60 km', { margenAcercamientoM: 60_000 }, /margen de acercamiento/],
    ['margen de acercamiento con decimales', { margenAcercamientoM: 100.5 }, /margen de acercamiento/],
  ])('rechaza %s', (_n, cruda, re) => {
    const v = validarConfigConductor(cruda);
    expect('error' in v && v.error).toMatch(re);
  });

  it('0635: la detección de hitos por GPS nace ENCENDIDA y el aviso de señal de vida APAGADO; ambos se pueden ajustar', () => {
    expect(CONFIG_CONDUCTOR_DEFAULT).toMatchObject({ detectarHitosGps: true, avisarSenalVida: false });
    const v = validarConfigConductor({ detectarHitosGps: false, avisarSenalVida: true });
    expect('ok' in v && v.ok).toMatchObject({ detectarHitosGps: false, avisarSenalVida: true });
  });

  it('0604: el aviso por llegada sin confirmar nace APAGADO y el margen de acercamiento en 5,000 m; ambos se pueden ajustar', () => {
    expect(CONFIG_CONDUCTOR_DEFAULT).toMatchObject({ avisarLlegadaSinConfirmar: false, margenAcercamientoM: 5000 });
    const v = validarConfigConductor({ avisarLlegadaSinConfirmar: true, margenAcercamientoM: 0 });
    expect('ok' in v && v.ok).toMatchObject({ avisarLlegadaSinConfirmar: true, margenAcercamientoM: 0 });
    const tope = validarConfigConductor({ margenAcercamientoM: 50_000 });
    expect('ok' in tope && tope.ok.margenAcercamientoM).toBe(50_000);
  });
});
