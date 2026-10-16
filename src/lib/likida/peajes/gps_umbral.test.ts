import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';
import { evaluarCruceGps, MARGEN_LEJOS_M, type Muestra } from './cruce_gps';
import { validarMargenLejos, margenLejosEfectivo, MARGEN_LEJOS_MIN_M, MARGEN_LEJOS_MAX_M } from './gps_umbral';

// T-A2-24: el margen «lejos de la caseta» deja de ser constante: es un parámetro por flota (default = el valor de siempre)
// para fijar 200/500 m cuando el cliente decida. Fixtures sintéticos.
let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const D = await import('./datos');

const T = 'flota-1';
const OTRO = 'flota-2';
const MIN = 60_000;
const CASETA = { id: 'c1', lat: 19.5, lng: -99.2, radioM: 300 };
const CRUCE = Date.parse('2026-08-05T17:30:00.000Z');
/** Dos posiciones que envuelven el cobro, ambas a ~900 m al norte de la caseta (900 > 300 + 500, pero < 300 + 1000). */
const A_900_M: Muestra[] = [
  { lat: 19.5 + 900 / 111_195, lng: -99.2, t: CRUCE - MIN },
  { lat: 19.5 + 900 / 111_195, lng: -99.2, t: CRUCE + MIN },
];

beforeEach(() => { db = crearDbFalsa({}); });

describe('evaluarCruceGps con margen por flota', () => {
  it('sin margen explícito se comporta como siempre (1000 m): a 900 m NO afirma que no coincide', () => {
    expect(MARGEN_LEJOS_M).toBe(1000);
    expect(evaluarCruceGps(CRUCE, CASETA, A_900_M).veredicto).toBe('sin_datos');
    expect(evaluarCruceGps(CRUCE, CASETA, A_900_M, MARGEN_LEJOS_M).veredicto).toBe('sin_datos');
  });
  it('con 500 m (la flota lo fijó) los mismos 900 m ya son «no coincide»; con 200 m también', () => {
    expect(evaluarCruceGps(CRUCE, CASETA, A_900_M, 500).veredicto).toBe('no_coincide');
    expect(evaluarCruceGps(CRUCE, CASETA, A_900_M, 200).veredicto).toBe('no_coincide');
  });
  it('un margen inválido (0, negativo, NaN) cae al de siempre: nunca afirma de más', () => {
    for (const m of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(evaluarCruceGps(CRUCE, CASETA, A_900_M, m).veredicto, String(m)).toBe('sin_datos');
  });
  it('sin posiciones sigue siendo sin_datos con su motivo, sea cual sea el margen («no hay datos no es evidencia»)', () => {
    for (const m of [200, 500, 1000]) {
      expect(evaluarCruceGps(CRUCE, CASETA, [], m)).toMatchObject({ veredicto: 'sin_datos', motivo: 'sin_posiciones_ventana' });
    }
  });
  it('una posición dentro del radio confirma aunque el margen sea el mínimo', () => {
    expect(evaluarCruceGps(CRUCE, CASETA, [{ lat: 19.5, lng: -99.2, t: CRUCE }], 200).veredicto).toBe('confirma');
  });
});

describe('validarMargenLejos / margenLejosEfectivo (puras)', () => {
  it('acepta enteros dentro de rango y los devuelve', () => {
    expect(validarMargenLejos(200)).toEqual({ ok: true, valor: 200 });
    expect(validarMargenLejos(500)).toEqual({ ok: true, valor: 500 });
    expect(validarMargenLejos(MARGEN_LEJOS_MIN_M).ok).toBe(true);
    expect(validarMargenLejos(MARGEN_LEJOS_MAX_M).ok).toBe(true);
  });
  it('rechaza con mensaje llano lo fuera de rango, no entero o no numérico (no lo «arregla»)', () => {
    for (const x of [0, 10, MARGEN_LEJOS_MAX_M + 1, 250.5, '500', null, undefined, Number.NaN]) {
      const r = validarMargenLejos(x);
      expect(r.ok, String(x)).toBe(false);
      if (!r.ok) expect(r.motivo).toMatch(/metros/);
    }
  });
  it('lo guardado y válido se usa; lo corrupto o ausente cae al de siempre', () => {
    expect(margenLejosEfectivo(500)).toBe(500);
    for (const x of [undefined, null, 'x', -1, 99999, 12.5]) expect(margenLejosEfectivo(x), String(x)).toBe(MARGEN_LEJOS_M);
  });
});

describe('guardar y leer el margen de la flota', () => {
  it('sin fila: el de siempre; guarda 500, lo relee, y la flota ajena sigue en el de siempre', async () => {
    expect(await D.leerMargenLejosM(T)).toBe(MARGEN_LEJOS_M);
    expect(await D.guardarMargenLejosM(T, 500)).toEqual({ ok: true, valor: 500 });
    expect(await D.leerMargenLejosM(T)).toBe(500);
    expect(await D.leerMargenLejosM(OTRO)).toBe(MARGEN_LEJOS_M);
    expect(db.tablas.peaje_atipico_config).toHaveLength(1);
  });
  it('un valor fuera de rango se rechaza y no escribe nada', async () => {
    const r = await D.guardarMargenLejosM(T, 5);
    expect(r.ok).toBe(false);
    expect(db.tablas.peaje_atipico_config ?? []).toHaveLength(0);
  });
  it('guardar el margen conserva el plazo, el interruptor del detector y el destinatario; y al revés', async () => {
    await D.guardarConfigAvisos(T, { plazo: { meses: 5 } });
    await D.guardarUmbralesPeajes(T, { activo: true });
    expect((await D.guardarMargenLejosM(T, 200)).ok).toBe(true);
    let c = await D.leerConfigPeajes(T);
    expect(c.avisos.plazo.meses).toBe(5);
    expect(c.atipicosActivo).toBe(true);
    await D.guardarConfigAvisos(T, { plazo: { meses: 6 } });
    c = await D.leerConfigPeajes(T);
    expect(c.avisos.plazo.meses).toBe(6);
    expect(await D.leerMargenLejosM(T)).toBe(200);
    expect(db.tablas.peaje_atipico_config).toHaveLength(1);
  });
  it('si la base falla al leer, LANZA (un error no se lee como «el de siempre» en la pantalla de configuración)', async () => {
    db.fallar('peaje_atipico_config.select', 'base caída');
    await expect(D.leerMargenLejosM(T)).rejects.toThrow(/base caída/);
  });
});
