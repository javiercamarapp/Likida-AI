import { describe, it, expect } from 'vitest';
import {
  evaluarCruceGps, planificarGps, sinDatos, VENTANA_GPS_MIN, type Muestra, type CasetaGeo,
} from './cruce_gps';
import type { CasetaCatalogo } from './casetas';

// Una caseta sintética (NO es una plaza real) y trayectorias construidas a mano.
const CASETA: CasetaGeo = { id: 'c1', lat: 19.5, lng: -99.2, radioM: 300 };
const T0 = Date.UTC(2026, 7, 5, 16, 30, 0); // el cobro
const MIN = 60_000;
// 0.001° de latitud ≈ 111 m.
const m = (dtMin: number, dLat: number, dLng = 0): Muestra => ({ lat: CASETA.lat + dLat, lng: CASETA.lng + dLng, t: T0 + dtMin * MIN });

describe('evaluarCruceGps — confirma', () => {
  it('una posición dentro del radio, en el minuto del cobro', () => {
    const r = evaluarCruceGps(T0, CASETA, [m(0, 0.001)]);
    expect(r).toMatchObject({ veredicto: 'confirma', via: 'muestra' });
    if (r.veredicto === 'confirma') expect(r.distanciaM).toBeGreaterThan(105);
  });
  it('un camión a 90 km/h entre dos posiciones de 2 min que pasa POR la caseta (sin posición dentro del radio)', () => {
    // 3 km antes y 3 km después de la caseta, sobre la misma línea.
    const r = evaluarCruceGps(T0, CASETA, [m(-1, -0.027), m(1, 0.027)]);
    expect(r).toMatchObject({ veredicto: 'confirma', via: 'trayectoria' });
  });
  it('el orden de las muestras no importa', () => {
    const a = evaluarCruceGps(T0, CASETA, [m(1, 0.027), m(-1, -0.027)]);
    expect(a.veredicto).toBe('confirma');
  });
  it('el borde del radio cuenta como dentro', () => {
    // ~300 m al norte: 0.0027° ≈ 300.2 m → fuera; 0.0026° ≈ 289 m → dentro.
    expect(evaluarCruceGps(T0, CASETA, [m(0, 0.0026)]).veredicto).toBe('confirma');
  });
});

describe('evaluarCruceGps — no_coincide SOLO con datos suficientes', () => {
  it('dos posiciones que envuelven el cobro, a 4 min una de otra, a ~9 km de la caseta', () => {
    const r = evaluarCruceGps(T0, CASETA, [m(-2, 0.08), m(2, 0.08, 0.01)]);
    expect(r.veredicto).toBe('no_coincide');
    if (r.veredicto === 'no_coincide') expect(r.distanciaM).toBeGreaterThan(5000);
  });
  it('si la trayectoria entre dos posiciones lejanas pasa por la caseta, NO acusa: confirma', () => {
    const r = evaluarCruceGps(T0, CASETA, [m(-3, -0.05), m(3, 0.05)]);
    expect(r.veredicto).toBe('confirma');
  });
  it('un hueco de 10 min entre las posiciones que envuelven el cobro NO alcanza para afirmar (una curva podría pasar por la caseta)', () => {
    const r = evaluarCruceGps(T0, CASETA, [m(-5, 0.08), m(5, 0.08)]);
    expect(r).toMatchObject({ veredicto: 'sin_datos', motivo: 'muestras_insuficientes' });
  });
  it('posiciones lejanas pero que NO envuelven el cobro (todas antes): sin datos, no acusa', () => {
    const r = evaluarCruceGps(T0, CASETA, [m(-15, 0.08), m(-10, 0.08), m(-5, 0.08)]);
    expect(r).toMatchObject({ veredicto: 'sin_datos', motivo: 'muestras_insuficientes' });
    if (r.veredicto === 'sin_datos') expect(r.distanciaM).toBeGreaterThan(5000);
  });
  it('lejos, pero no tanto como radio + margen (1 km): no afirma', () => {
    // ~600 m de la caseta: fuera del radio (300), dentro del margen (300+1000).
    const r = evaluarCruceGps(T0, CASETA, [m(-2, 0.0054), m(2, 0.0054)]);
    expect(r.veredicto).toBe('sin_datos');
  });
});

describe('evaluarCruceGps — sin datos', () => {
  it('sin posiciones en la ventana', () => {
    expect(evaluarCruceGps(T0, CASETA, [])).toEqual(sinDatos('sin_posiciones_ventana'));
  });
  it('coordenadas basura y tiempos NaN se ignoran, no contaminan', () => {
    const r = evaluarCruceGps(T0, CASETA, [{ lat: 999, lng: 0, t: T0 }, { lat: NaN, lng: 0, t: T0 }, { lat: 1, lng: 1, t: NaN }]);
    expect(r).toEqual(sinDatos('sin_posiciones_ventana'));
  });
  it('una sola posición lejana no acusa', () => {
    expect(evaluarCruceGps(T0, CASETA, [m(0, 0.2)]).veredicto).toBe('sin_datos');
  });
  it('un tramo cuya hora no corresponde al cobro (±5 min) no confirma por trayectoria', () => {
    const r = evaluarCruceGps(T0, CASETA, [m(-19, -0.027), m(-17, 0.027)]);
    expect(r.veredicto).not.toBe('confirma');
  });
});

const catalogo: CasetaCatalogo[] = [
  { id: 'c1', nombre: 'Caseta Ejemplo Norte', nombreNorm: 'caseta ejemplo norte', alias: ['Ej Norte'], lat: 19.5, lng: -99.2, radioM: 300 },
  { id: 'c2', nombre: 'Caseta Ejemplo Sur', nombreNorm: 'caseta ejemplo sur', alias: [], lat: 19.0, lng: -99.0, radioM: 400 },
];
const linea = (o: Partial<Parameters<typeof planificarGps>[0][number]> = {}) => ({
  id: 'l1', fecha: '2026-08-05', cruceEn: '2026-08-05T16:30:00.000Z', caseta: 'Caseta Ejemplo Norte', unidadId: 'u1', ...o,
});

describe('planificarGps — cada línea o es evaluable o dice por qué no', () => {
  it('línea completa → lista, con su ventana de ±20 min', () => {
    const [p] = planificarGps([linea()], catalogo);
    expect(p.listo).toBe(true);
    if (p.listo) {
      expect(p.caseta.id).toBe('c1');
      expect(Date.parse(p.hasta) - Date.parse(p.desde)).toBe(2 * VENTANA_GPS_MIN * MIN);
    }
  });
  it('sin fecha → sin_fecha (primero)', () => {
    const [p] = planificarGps([linea({ fecha: null, cruceEn: null })], catalogo);
    expect(p).toMatchObject({ listo: false, veredicto: { motivo: 'sin_fecha' } });
  });
  it('sin hora → sin_hora (el archivo no la traía)', () => {
    const [p] = planificarGps([linea({ cruceEn: null })], catalogo);
    expect(p).toMatchObject({ listo: false, veredicto: { motivo: 'sin_hora' } });
  });
  it('hora ilegible → sin_hora', () => {
    const [p] = planificarGps([linea({ cruceEn: 'no-es-fecha' })], catalogo);
    expect(p).toMatchObject({ listo: false, veredicto: { motivo: 'sin_hora' } });
  });
  it('sin unidad → sin_unidad, conservando la caseta resuelta', () => {
    const [p] = planificarGps([linea({ unidadId: null })], catalogo);
    expect(p).toMatchObject({ listo: false, casetaId: 'c1', veredicto: { motivo: 'sin_unidad' } });
  });
  it('caseta fuera del catálogo → sin_caseta; catálogo vacío también', () => {
    expect(planificarGps([linea({ caseta: 'Plaza Desconocida' })], catalogo)[0]).toMatchObject({ listo: false, veredicto: { motivo: 'sin_caseta' } });
    expect(planificarGps([linea()], [])[0]).toMatchObject({ listo: false, veredicto: { motivo: 'sin_caseta' } });
  });
  it('nombre que casa con dos casetas → caseta_ambigua (no se adivina)', () => {
    const [p] = planificarGps([linea({ caseta: 'Caseta Ejemplo' })], [
      { ...catalogo[0], nombreNorm: 'ejemplo', alias: [] }, { ...catalogo[1], nombreNorm: 'ejemplo', alias: [] },
    ]);
    expect(p).toMatchObject({ listo: false, veredicto: { motivo: 'caseta_ambigua' } });
  });
});
