import { describe, expect, it } from 'vitest';
import { coordenadasValidas, dentroDeMexico, haversineM, RADIO_TIERRA_M } from './geo';

describe('haversineM', () => {
  it('un grado de latitud son ~111.2 km (se verifica a mano: R·π/180)', () => {
    const d = haversineM({ lat: 20, lng: -103 }, { lat: 21, lng: -103 });
    expect(d).toBeCloseTo((RADIO_TIERRA_M * Math.PI) / 180, 0);
    expect(Math.round(d)).toBe(111_195);
  });

  it('el mismo punto está a cero metros', () => {
    expect(haversineM({ lat: 20.72, lng: -103.39 }, { lat: 20.72, lng: -103.39 })).toBe(0);
  });

  it('es simétrica', () => {
    const a = { lat: 19.4326, lng: -99.1332 };
    const b = { lat: 19.427, lng: -99.1677 };
    expect(haversineM(a, b)).toBeCloseTo(haversineM(b, a), 6);
  });

  it('Zócalo → Ángel de la Independencia: ~3.7 km', () => {
    const d = haversineM({ lat: 19.4326, lng: -99.1332 }, { lat: 19.427, lng: -99.1677 });
    expect(d).toBeGreaterThan(3_600);
    expect(d).toBeLessThan(3_800);
  });

  it('decenas de metros: 0.0005° de longitud a 20° N son ~52 m', () => {
    const d = haversineM({ lat: 20, lng: -103 }, { lat: 20, lng: -102.9995 });
    expect(d).toBeGreaterThan(50);
    expect(d).toBeLessThan(54);
  });

  it('no revienta con puntos antipodales (el argumento de asin se acota)', () => {
    const d = haversineM({ lat: 0, lng: 0 }, { lat: 0, lng: 180 });
    expect(Number.isFinite(d)).toBe(true);
    expect(Math.round(d)).toBe(Math.round(Math.PI * RADIO_TIERRA_M));
  });
});

describe('coordenadasValidas / dentroDeMexico', () => {
  it('rechaza lo que no es coordenada', () => {
    expect(coordenadasValidas(NaN, 0)).toBe(false);
    expect(coordenadasValidas(Infinity, 0)).toBe(false);
    expect(coordenadasValidas('20', -103)).toBe(false);
    expect(coordenadasValidas(null, undefined)).toBe(false);
    expect(coordenadasValidas(91, 0)).toBe(false);
    expect(coordenadasValidas(0, -181)).toBe(false);
  });
  it('acepta los extremos del rango geográfico', () => {
    expect(coordenadasValidas(90, 180)).toBe(true);
    expect(coordenadasValidas(-90, -180)).toBe(true);
  });
  it('la caja de México incluye Tijuana y Mérida y excluye Madrid y la longitud con signo perdido', () => {
    expect(dentroDeMexico(32.5, -117)).toBe(true);
    expect(dentroDeMexico(20.97, -89.62)).toBe(true);
    expect(dentroDeMexico(40.4, -3.7)).toBe(false);
    expect(dentroDeMexico(20.7, 103.4)).toBe(false);
  });
});
