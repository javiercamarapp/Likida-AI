import { describe, expect, it } from 'vitest';
import { areaPoligonoM2, coordenadasValidas, dentroDeGeocerca, dentroDeMexico, haversineM, leerPoligono, poligonoGuardable, RADIO_TIERRA_M, type Punto } from './geo';

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

// Patio alargado (≈ 600 m de este a oeste × 45 m de norte a sur) a 20.5° N, con una carretera paralela ~70 m al norte.
const M_LAT = 1 / 111_195; // grados de latitud por metro
const M_LNG = 1 / (111_195 * Math.cos((20.5 * Math.PI) / 180));
const C = { lat: 20.5, lng: -103.3 };
const PATIO: Punto[] = [
  { lat: C.lat - 22.5 * M_LAT, lng: C.lng - 300 * M_LNG }, { lat: C.lat - 22.5 * M_LAT, lng: C.lng + 300 * M_LNG },
  { lat: C.lat + 22.5 * M_LAT, lng: C.lng + 300 * M_LNG }, { lat: C.lat + 22.5 * M_LAT, lng: C.lng - 300 * M_LNG },
];
// El círculo que antes lo aproximaba: centro en el promedio, radio = vértice más lejano + 5 %.
const RADIO_VIEJO = Math.ceil(haversineM(C, PATIO[0]) * 1.05);
const CARRETERA = { lat: C.lat + 90 * M_LAT, lng: C.lng }; // 67.5 m al norte del borde del patio
const DENTRO_PATIO = { lat: C.lat + 5 * M_LAT, lng: C.lng + 250 * M_LNG };

describe('dentroDeGeocerca (helper único)', () => {
  const poligonal = { lat: C.lat, lng: C.lng, radioM: RADIO_VIEJO, poligono: PATIO };
  it('el caso que originó el paquete: el círculo que aproximaba el patio acusa a la carretera; el polígono no', () => {
    expect(haversineM(C, CARRETERA)).toBeLessThan(RADIO_VIEJO); // con el círculo viejo estaría «dentro»
    expect(dentroDeGeocerca(CARRETERA, { lat: C.lat, lng: C.lng, radioM: RADIO_VIEJO }).dentro).toBe(true);
    const r = dentroDeGeocerca(CARRETERA, poligonal);
    expect(r).toMatchObject({ dentro: false, metodo: 'poligono', aproximada: false });
    expect(r.distanciaBordeM).toBeGreaterThan(60);
    expect(r.distanciaBordeM).toBeLessThan(75);
  });
  it('un punto en el patio está dentro (distancia al borde 0)', () => {
    expect(dentroDeGeocerca(DENTRO_PATIO, poligonal)).toMatchObject({ dentro: true, distanciaBordeM: 0, metodo: 'poligono' });
  });
  it('el margen de tolerancia se mide al BORDE del polígono, no al centro', () => {
    expect(dentroDeGeocerca(CARRETERA, poligonal, 50).dentro).toBe(false);
    expect(dentroDeGeocerca(CARRETERA, poligonal, 80).dentro).toBe(true);
  });
  it('sin polígono cae al círculo (centro + radio + margen) y no es «aproximada» salvo que se declare', () => {
    const c = { lat: 20, lng: -103, radioM: 100 };
    const a100 = { lat: 20, lng: -103 + 99 / (111_195 * Math.cos((20 * Math.PI) / 180)) };
    expect(dentroDeGeocerca(a100, c)).toMatchObject({ dentro: true, metodo: 'circulo', aproximada: false });
    expect(dentroDeGeocerca({ lat: 20.002, lng: -103 }, c).dentro).toBe(false);
    expect(dentroDeGeocerca({ lat: 20.002, lng: -103 }, c, 100).dentro).toBe(false);
    expect(dentroDeGeocerca({ lat: 20.0012, lng: -103 }, c, 50).dentro).toBe(true);
    expect(dentroDeGeocerca(a100, { ...c, aproximada: true }).aproximada).toBe(true);
  });
  it('un polígono con `aproximada` en la fila NO es aproximado: manda el polígono', () => {
    expect(dentroDeGeocerca(DENTRO_PATIO, { ...poligonal, aproximada: true }).aproximada).toBe(false);
  });
  it('un polígono cóncavo (en L): el hueco de la L está fuera aunque caiga en su círculo', () => {
    const L: Punto[] = [
      { lat: 20, lng: -103 }, { lat: 20, lng: -103 + 200 * M_LNG }, { lat: 20 + 50 * M_LAT, lng: -103 + 200 * M_LNG },
      { lat: 20 + 50 * M_LAT, lng: -103 + 50 * M_LNG }, { lat: 20 + 200 * M_LAT, lng: -103 + 50 * M_LNG }, { lat: 20 + 200 * M_LAT, lng: -103 },
    ];
    const g = { lat: 20 + 60 * M_LAT, lng: -103 + 60 * M_LNG, radioM: 400, poligono: L };
    expect(dentroDeGeocerca({ lat: 20 + 120 * M_LAT, lng: -103 + 150 * M_LNG }, g).dentro).toBe(false); // el hueco
    expect(dentroDeGeocerca({ lat: 20 + 120 * M_LAT, lng: -103 + 20 * M_LNG }, g).dentro).toBe(true); // el brazo vertical
  });
  it('coordenadas inválidas nunca están dentro', () => {
    expect(dentroDeGeocerca({ lat: NaN, lng: -103 }, poligonal).dentro).toBe(false);
    expect(dentroDeGeocerca({ lat: 91, lng: -103 }, { lat: 20, lng: -103, radioM: 100 }).dentro).toBe(false);
  });
});

describe('polígonos: lectura y validación', () => {
  it('leerPoligono acepta {lat,lng} entre 3 y 500 y rechaza lo demás (sin arreglar nada)', () => {
    expect(leerPoligono(PATIO)).toHaveLength(4);
    expect(leerPoligono(null)).toBeNull();
    expect(leerPoligono(PATIO.slice(0, 2))).toBeNull();
    expect(leerPoligono([...PATIO, { lat: 'x', lng: 1 }])).toBeNull();
    expect(leerPoligono([...PATIO, { lat: 95, lng: 1 }])).toBeNull();
    expect(leerPoligono(Array.from({ length: 501 }, (_, i) => ({ lat: 20 + i * 1e-5, lng: -103 })))).toBeNull();
    expect(leerPoligono('POLYGON')).toBeNull();
  });
  it('poligonoGuardable exige área real: una línea o un punto repetido no es un polígono', () => {
    expect(areaPoligonoM2(PATIO)).toBeGreaterThan(26_000); // 600 × 45 = 27,000 m²
    expect(areaPoligonoM2(PATIO)).toBeLessThan(28_000);
    expect(poligonoGuardable(PATIO)).toBe(true);
    expect(poligonoGuardable([{ lat: 20, lng: -103 }, { lat: 20, lng: -103.001 }, { lat: 20, lng: -103.002 }])).toBe(false);
    expect(poligonoGuardable([{ lat: 20, lng: -103 }, { lat: 20, lng: -103 }, { lat: 20, lng: -103 }])).toBe(false);
    expect(poligonoGuardable(null)).toBe(false);
  });
});
