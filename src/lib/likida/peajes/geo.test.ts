import { describe, it, expect } from 'vitest';
import { haversineM, distanciaPuntoSegmentoM, coordenadasValidas } from './geo';

const CDMX = { lat: 19.4326, lng: -99.1332 };
const PUEBLA = { lat: 19.0414, lng: -98.2063 };

describe('haversineM', () => {
  it('cero entre un punto y él mismo', () => {
    expect(haversineM(CDMX, CDMX)).toBe(0);
  });
  it('CDMX–Puebla en línea recta: 106,591 m (valor calculado de forma independiente con la misma fórmula y radio medio)', () => {
    expect(haversineM(CDMX, PUEBLA)).toBeCloseTo(106_591.4, 0);
  });
  it('es simétrica', () => {
    expect(haversineM(CDMX, PUEBLA)).toBeCloseTo(haversineM(PUEBLA, CDMX), 6);
  });
  it('un grado de latitud ≈ 111.2 km', () => {
    const d = haversineM({ lat: 19, lng: -99 }, { lat: 20, lng: -99 });
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });
  it('cruza el antimeridiano sin romperse', () => {
    const d = haversineM({ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 });
    expect(d).toBeLessThan(25_000);
  });
  it('coordenadas inválidas → NaN, nunca un número falso', () => {
    expect(haversineM({ lat: 91, lng: 0 }, CDMX)).toBeNaN();
    expect(haversineM({ lat: NaN, lng: 0 }, CDMX)).toBeNaN();
    expect(haversineM(CDMX, { lat: 0, lng: 181 })).toBeNaN();
    expect(coordenadasValidas({ lat: 90, lng: -180 })).toBe(true);
  });
});

describe('distanciaPuntoSegmentoM', () => {
  // Segmento este-oeste de ~1.05 km a la latitud de la CDMX.
  const a = { lat: 19.4326, lng: -99.14 };
  const b = { lat: 19.4326, lng: -99.13 };
  it('un punto sobre el segmento: ~0', () => {
    expect(distanciaPuntoSegmentoM({ lat: 19.4326, lng: -99.135 }, a, b)).toBeLessThan(1);
  });
  it('un punto 111 m al norte del segmento: ~111 m', () => {
    const d = distanciaPuntoSegmentoM({ lat: 19.4336, lng: -99.135 }, a, b);
    expect(d).toBeGreaterThan(105);
    expect(d).toBeLessThan(117);
  });
  it('más allá del extremo mide contra el extremo, no contra la recta infinita', () => {
    const p = { lat: 19.4326, lng: -99.12 };
    const d = distanciaPuntoSegmentoM(p, a, b);
    expect(d).toBeCloseTo(haversineM(p, b), -1);
  });
  it('segmento degenerado = distancia al punto', () => {
    const p = { lat: 19.44, lng: -99.14 };
    expect(distanciaPuntoSegmentoM(p, a, a)).toBeCloseTo(haversineM(p, a), -1);
  });
  it('inválido → NaN', () => {
    expect(distanciaPuntoSegmentoM({ lat: 100, lng: 0 }, a, b)).toBeNaN();
  });
});
