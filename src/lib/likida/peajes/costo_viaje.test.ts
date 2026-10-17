import { describe, it, expect } from 'vitest';
import { costoPorViaje, ROTULO_REFERENCIA, MIN_VIAJES_REFERENCIA, type LineaCosto, type VinculoCosto, type ViajeCosto } from './costo_viaje';

// Costo por viaje (T-A2-23). Fixtures sintéticos: ningún dato real.

const L = (id: string, importe: number, caseta: string | null = 'Caseta Ejemplo Sur'): LineaCosto => ({ id, caseta, importe });
const V = (lineaId: string, extra: Partial<VinculoCosto> = {}): VinculoCosto => ({
  lineaId, estado: 'ligado', viajeId: 'v1', candidatos: [], ...extra,
});
const VJ = (id: string, origen: string | null = 'Ciudad A', destino: string | null = 'Ciudad B'): ViajeCosto => ({ id, folio: `VJ-${id}`, origen, destino });

describe('costoPorViaje: lo que costó cada viaje', () => {
  it('viaje con 3 cruces ligados: suma, nº de cruces y casetas distintas', () => {
    const lineas = [L('a', 100), L('b', 50.5, 'Caseta Ejemplo Norte'), L('c', 100)];
    const r = costoPorViaje({ lineas, vinculos: [V('a'), V('b'), V('c')], viajes: [VJ('v1')] });
    const c = r.get('v1')!;
    expect(c.cruces).toBe(3);
    expect(c.costo).toBe(250.5);
    expect(c.casetasDistintas).toBe(2);
    expect(c.aviso).toBeNull();
    expect(c.folio).toBe('VJ-v1');
    expect(c.fuente).toMatch(/3 cruces ligados/);
  });

  it('suma a centavos sin arrastrar error de coma flotante', () => {
    const r = costoPorViaje({ lineas: [L('a', 0.1), L('b', 0.2)], vinculos: [V('a'), V('b')], viajes: [VJ('v1')] });
    expect(r.get('v1')!.costo).toBe(0.3);
  });

  it('viaje sin cruces ligados: costo 0 con aviso «sin cruces», y los ambiguos NO suman', () => {
    const lineas = [L('a', 100), L('b', 300)];
    const vinculos = [V('a', { estado: 'ambiguo', viajeId: null, candidatos: ['v2', 'v3'] }), V('b', { estado: 'conflicto', viajeId: null, candidatos: ['v2'] })];
    const r = costoPorViaje({ lineas, vinculos, viajes: [VJ('v2'), VJ('v3')] });
    const v2 = r.get('v2')!;
    expect(v2.costo).toBe(0);
    expect(v2.cruces).toBe(0);
    expect(v2.aviso).toMatch(/sin cruces/i);
    expect(v2.ambiguos).toBe(2);
    expect(r.get('v3')!.ambiguos).toBe(1);
  });

  it('un cruce ambiguo no suma al viaje que sí tiene cruces ligados, pero se cuenta aparte', () => {
    const lineas = [L('a', 100), L('b', 999)];
    const vinculos = [V('a'), V('b', { estado: 'ambiguo', viajeId: null, candidatos: ['v1', 'v2'] })];
    const c = costoPorViaje({ lineas, vinculos, viajes: [VJ('v1'), VJ('v2')] }).get('v1')!;
    expect(c.costo).toBe(100);
    expect(c.ambiguos).toBe(1);
  });

  it('sin_viaje y sin_unidad no pertenecen a ningún viaje', () => {
    const r = costoPorViaje({ lineas: [L('a', 100), L('b', 100)], vinculos: [V('a', { estado: 'sin_viaje', viajeId: null }), V('b', { estado: 'sin_unidad', viajeId: null })], viajes: [VJ('v1')] });
    expect(r.size).toBe(0);
  });

  it('un vínculo de una línea ajena al desglose se ignora', () => {
    const c = costoPorViaje({ lineas: [L('a', 100)], vinculos: [V('a'), V('zzz')], viajes: [VJ('v1')] }).get('v1')!;
    expect(c.cruces).toBe(1);
    expect(c.costo).toBe(100);
  });

  it('candidatos a reclamación dentro del viaje: solo los cruces ligados que lo son; null si no se calcularon', () => {
    const lineas = [L('a', 100), L('b', 100), L('c', 100)];
    const vinculos = [V('a'), V('b'), V('c', { viajeId: 'v2' })];
    const viajes = [VJ('v1'), VJ('v2')];
    const con = costoPorViaje({ lineas, vinculos, viajes, lineasCandidatas: new Set(['b', 'c']) });
    expect(con.get('v1')!.candidatos).toBe(1);
    expect(con.get('v2')!.candidatos).toBe(1);
    const sin = costoPorViaje({ lineas, vinculos, viajes, lineasCandidatas: null });
    expect(sin.get('v1')!.candidatos).toBeNull();
  });
});

describe('referencia histórica (mediana por origen→destino)', () => {
  // n viajes Ciudad A → Ciudad B, cada uno con un solo cruce de importe `costos[i]`.
  const escenario = (costos: number[], extraViajes: ViajeCosto[] = []) => {
    const lineas = costos.map((m, i) => L(`l${i}`, m));
    const vinculos = costos.map((_, i) => V(`l${i}`, { viajeId: `v${i}` }));
    const viajes = [...costos.map((_, i) => VJ(`v${i}`)), ...extraViajes];
    return costoPorViaje({ lineas, vinculos, viajes });
  };

  it('el mínimo por defecto es 5 viajes', () => {
    expect(MIN_VIAJES_REFERENCIA).toBe(5);
  });

  it('con 5 viajes aplica: mediana, desviación y el rótulo «no es tarifa»', () => {
    const r = escenario([100, 100, 100, 100, 150]);
    const ref = r.get('v4')!.referencia!;
    expect(ref.aplica).toBe(true);
    expect(ref.nViajes).toBe(5);
    expect(ref.mediana).toBe(100);
    expect(ref.desviacion).toBe(50);
    expect(ref.desviacionPct).toBe(50);
    expect(ref.rotulo).toBe(ROTULO_REFERENCIA);
    expect(ROTULO_REFERENCIA).toBe('referencia histórica, no es tarifa');
  });

  it('con 4 viajes NO aplica: sin mediana ni desviación y con el motivo', () => {
    const ref = escenario([100, 100, 100, 150]).get('v3')!.referencia!;
    expect(ref.aplica).toBe(false);
    expect(ref.mediana).toBeNull();
    expect(ref.desviacion).toBeNull();
    expect(ref.nViajes).toBe(4);
    expect(ref.motivo).toMatch(/menos de 5/);
  });

  it('minViajes se puede cambiar', () => {
    const lineas = [L('a', 100), L('b', 120), L('c', 140)];
    const vinculos = [V('a', { viajeId: 'v1' }), V('b', { viajeId: 'v2' }), V('c', { viajeId: 'v3' })];
    const r = costoPorViaje({ lineas, vinculos, viajes: [VJ('v1'), VJ('v2'), VJ('v3')] }, { minViajes: 3 });
    expect(r.get('v1')!.referencia!.mediana).toBe(120);
  });

  it('mediana con cantidad par de viajes: promedio de los dos centrales', () => {
    const r = escenario([100, 200, 300, 400, 500, 600]);
    expect(r.get('v0')!.referencia!.mediana).toBe(350);
  });

  it('otro origen→destino no entra en la muestra; mayúsculas y acentos no separan rutas', () => {
    const lineas = [0, 1, 2, 3, 4].map((i) => L(`l${i}`, 100));
    const vinculos = [0, 1, 2, 3, 4].map((i) => V(`l${i}`, { viajeId: `v${i}` }));
    const viajes = [VJ('v0', 'Mérida', 'Cancún'), VJ('v1', 'merida', 'CANCUN'), VJ('v2', ' Mérida ', 'Cancún'), VJ('v3', 'Mérida', 'Cancún'), VJ('v4', 'Otra', 'Ruta')];
    const r = costoPorViaje({ lineas, vinculos, viajes });
    expect(r.get('v0')!.referencia!.nViajes).toBe(4);
    expect(r.get('v0')!.referencia!.aplica).toBe(false);
    expect(r.get('v4')!.referencia!.nViajes).toBe(1);
  });

  it('sin origen o destino no hay referencia posible, y se dice', () => {
    const r = costoPorViaje({ lineas: [L('a', 100)], vinculos: [V('a')], viajes: [VJ('v1', null, 'Ciudad B')] });
    const ref = r.get('v1')!.referencia!;
    expect(ref.aplica).toBe(false);
    expect(ref.motivo).toMatch(/origen|destino/);
  });

  it('un viaje sin cruces no cuenta en la muestra y no lleva referencia', () => {
    const lineas = [0, 1, 2, 3, 4].map((i) => L(`l${i}`, 100));
    const vinculos = [0, 1, 2, 3, 4].map((i) => V(`l${i}`, { viajeId: `v${i}` }));
    vinculos.push(V('x', { estado: 'ambiguo', viajeId: null, candidatos: ['vacio'] }));
    const r = costoPorViaje({ lineas: [...lineas, L('x', 70)], vinculos, viajes: [...[0, 1, 2, 3, 4].map((i) => VJ(`v${i}`)), VJ('vacio')] });
    expect(r.get('v0')!.referencia!.nViajes).toBe(5);
    expect(r.get('vacio')!.referencia).toBeNull();
  });

  it('mediana 0 no divide por cero', () => {
    const r = escenario([0, 0, 0, 0, 10]);
    const ref = r.get('v4')!.referencia!;
    expect(ref.mediana).toBe(0);
    expect(ref.desviacionPct).toBeNull();
  });

  it('el resultado no depende del orden de las líneas', () => {
    const lineas = [L('a', 10), L('b', 20), L('c', 30)];
    const vinculos = [V('a'), V('b'), V('c')];
    const x = costoPorViaje({ lineas, vinculos, viajes: [VJ('v1')] }).get('v1');
    const y = costoPorViaje({ lineas: [...lineas].reverse(), vinculos: [...vinculos].reverse(), viajes: [VJ('v1')] }).get('v1');
    expect(y).toEqual(x);
  });
});
