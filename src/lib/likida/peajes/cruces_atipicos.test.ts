import { describe, it, expect } from 'vitest';
import { detectarAtipicos, validarUmbrales, UMBRALES_ATIPICOS_DEFAULT, type LineaAtipica } from './cruces_atipicos';

const l = (indice: number, p: Partial<LineaAtipica> = {}): LineaAtipica => ({
  indice, fecha: '2026-03-05', hora: '10:00:00', caseta: 'Caseta Ejemplo Norte', tag: 'IMDM00000001', unidad: '101', monto: 100, ...p,
});
const NORTE = { nombre: 'Caseta Ejemplo Norte', lat: 25.0, lng: -100.0 };
const SUR = { nombre: 'Caseta Ejemplo Sur', lat: 19.4, lng: -99.1 }; // ≈ 700 km

describe('repetición de la misma caseta', () => {
  it('4 cruces de la misma unidad por la misma caseta en 4 horas = una señal (con el umbral por defecto)', () => {
    const r = detectarAtipicos([l(0, { hora: '01:00:00' }), l(1, { hora: '02:10:00' }), l(2, { hora: '03:20:00' }), l(3, { hora: '04:30:00' })]);
    const rep = r.atipicos.filter((a) => a.senal === 'repeticion_caseta');
    expect(rep).toHaveLength(1);
    expect(rep[0]).toMatchObject({ unidad: '101', indices: [0, 1, 2, 3], monto: 400 });
    expect(rep[0].quePaso).toMatch(/4 veces/);
  });
  it('3 cruces no alcanzan; 4 repartidos en más de la ventana tampoco; otra unidad no se mezcla', () => {
    expect(detectarAtipicos([l(0, { hora: '01:00:00' }), l(1, { hora: '02:00:00' }), l(2, { hora: '03:00:00' })]).atipicos).toHaveLength(0);
    expect(detectarAtipicos([l(0, { hora: '01:00:00' }), l(1, { hora: '05:00:00' }), l(2, { hora: '09:00:00' }), l(3, { hora: '13:00:00' })]).atipicos).toHaveLength(0);
    const mezcla = [0, 1, 2, 3].map((i) => l(i, { hora: `0${i + 1}:00:00`, unidad: i % 2 ? '101' : '102', tag: i % 2 ? 'IMDM00000001' : 'IMDM00000002' }));
    expect(detectarAtipicos(mezcla).atipicos).toHaveLength(0);
  });
  it('el umbral es configurable y una racha larga es UNA señal, no una por cruce', () => {
    const seis = Array.from({ length: 6 }, (_, i) => l(i, { hora: `0${i + 1}:00:00` }));
    expect(detectarAtipicos(seis, [], { repeticiones: 4 }).atipicos.filter((a) => a.senal === 'repeticion_caseta')).toHaveLength(1);
    expect(detectarAtipicos(seis.slice(0, 3), [], { repeticiones: 3 }).atipicos).toHaveLength(1);
  });
  it('usa el TAG cuando no hay unidad', () => {
    const r = detectarAtipicos(Array.from({ length: 4 }, (_, i) => l(i, { hora: `0${i + 1}:00:00`, unidad: null })));
    expect(r.atipicos[0].unidad).toBe('IMDM00000001');
  });
});

describe('horario anómalo (solo si la flota lo configura)', () => {
  it('por defecto NO se aplica y lo dice; con franja configurada marca los cruces dentro', () => {
    const lineas = [l(0, { hora: '02:30:00' }), l(1, { hora: '12:00:00' })];
    expect(detectarAtipicos(lineas).noAplicadas.find((n) => n.senal === 'horario_anomalo')?.motivo).toMatch(/no ha definido/);
    const r = detectarAtipicos(lineas, [], { horario: { desde: '01:00', hasta: '04:59' } });
    expect(r.atipicos.filter((a) => a.senal === 'horario_anomalo').map((a) => a.indices[0])).toEqual([0]);
  });
  it('una franja que cruza medianoche', () => {
    const r = detectarAtipicos([l(0, { hora: '23:30:00' }), l(1, { hora: '00:15:00' }), l(2, { hora: '12:00:00' })], [], { horario: { desde: '23:00', hasta: '04:00' } });
    expect(r.atipicos.map((a) => a.indices[0]).sort()).toEqual([0, 1]);
  });
});

describe('salto imposible entre casetas lejanas', () => {
  const lineas = [l(0, { hora: '10:00:00', caseta: 'Caseta Ejemplo Norte' }), l(1, { hora: '11:00:00', caseta: 'Caseta Ejemplo Sur' })];
  it('≈ 700 km en 1 hora excede 130 km/h: señal con la velocidad exigida', () => {
    const r = detectarAtipicos(lineas, [NORTE, SUR]);
    const s = r.atipicos.filter((a) => a.senal === 'salto_imposible');
    expect(s).toHaveLength(1);
    expect(s[0].indices).toEqual([0, 1]);
    expect(s[0].quePaso).toMatch(/km\/h/);
  });
  it('el mismo trayecto en 8 horas es plausible', () => {
    const lento = [lineas[0], { ...lineas[1], hora: '18:30:00' }];
    expect(detectarAtipicos(lento, [NORTE, SUR]).atipicos.filter((a) => a.senal === 'salto_imposible')).toHaveLength(0);
  });
  it('SIN coordenadas no se mide ni se inventa: se dice que la señal no se aplicó', () => {
    const r = detectarAtipicos(lineas, []);
    expect(r.atipicos).toHaveLength(0);
    expect(r.noAplicadas.find((n) => n.senal === 'salto_imposible')?.motivo).toMatch(/coordenadas/);
    // con coordenadas solo de una caseta, tampoco
    const parcial = detectarAtipicos(lineas, [NORTE]);
    expect(parcial.atipicos).toHaveLength(0);
    expect(parcial.noAplicadas.find((n) => n.senal === 'salto_imposible')?.motivo).toMatch(/1 pares/);
  });
  it('el umbral de velocidad es configurable', () => {
    const tresYMedia = [lineas[0], { ...lineas[1], hora: '13:30:00' }]; // ≈ 625 km en 3.5 h ≈ 180 km/h
    expect(detectarAtipicos(tresYMedia, [NORTE, SUR]).atipicos).toHaveLength(1);
    expect(detectarAtipicos(tresYMedia, [NORTE, SUR], { velocidadMaxKmh: 250 }).atipicos).toHaveLength(0);
  });
  it('un umbral inválido se dice y se usan los de partida', () => {
    const r = detectarAtipicos(lineas, [NORTE, SUR], { velocidadMaxKmh: 900 });
    expect(r.atipicos).toHaveLength(1);
    expect(r.noAplicadas.some((n) => /no son válidos/.test(n.motivo))).toBe(true);
  });
});

describe('umbrales', () => {
  it('validación', () => {
    expect(validarUmbrales({}).ok).toBe(true);
    expect(validarUmbrales({ repeticiones: 1 }).ok).toBe(false);
    expect(validarUmbrales({ velocidadMaxKmh: 10 }).ok).toBe(false);
    expect(validarUmbrales({ horario: { desde: '25:00', hasta: '04:00' } }).ok).toBe(false);
    expect(UMBRALES_ATIPICOS_DEFAULT.horario).toBeNull();
  });
  it('sin hora ni unidad: las señales que la necesitan se declaran no aplicadas', () => {
    const r = detectarAtipicos([l(0, { hora: null })]);
    expect(r.noAplicadas.map((n) => n.senal)).toEqual(expect.arrayContaining(['repeticion_caseta', 'salto_imposible']));
  });
});
