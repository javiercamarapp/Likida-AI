import { describe, it, expect } from 'vitest';
import { vincularCruces, llaveUnidadVinculo, type CruceAVincular } from './vincular_viaje';
import type { ViajeFuente } from './viajes_fuente';

const viaje = (id: string, unidadNumero: string, inicio: string, fin: string | null): ViajeFuente =>
  ({ id, folio: null, icident: null, unidadNumero, inicio, fin, origen: null, destino: null });
const cruce = (id: number, unidadArchivo: string | null, fecha: string): CruceAVincular => ({ id, unidadArchivo, fecha });

describe('vincularCruces (unidad + ventana)', () => {
  const V = [viaje('v1', 'TC9001', '2026-09-10', '2026-09-12')];

  it('liga el cruce en el día de inicio y en el de fin', () => {
    const r = vincularCruces([cruce(1, 'TC9001', '2026-09-10'), cruce(2, 'TC9001', '2026-09-12')], V, { margenDias: 0 });
    expect(r.map((x) => x.estado)).toEqual(['ligado', 'ligado']);
    expect(r[0]).toMatchObject({ viajeId: 'v1', via: 'unidad_ventana', precision: 'por_dia' });
  });

  it('margen 0 deja fuera el día siguiente; margen 1 lo incluye', () => {
    const c = [cruce(1, 'TC9001', '2026-09-13'), cruce(2, 'TC9001', '2026-09-09')];
    expect(vincularCruces(c, V, { margenDias: 0 }).map((x) => x.estado)).toEqual(['sin_viaje', 'sin_viaje']);
    expect(vincularCruces(c, V, { margenDias: 1 }).map((x) => x.estado)).toEqual(['ligado', 'ligado']);
    expect(vincularCruces(c, V, { margenDias: 2 })[0].estado).toBe('ligado');
  });

  it('dos viajes seguidos de la misma unidad el mismo día: ambiguo, sin elegir', () => {
    const vs = [viaje('a', 'TC9001', '2026-09-10', '2026-09-11'), viaje('b', 'TC9001', '2026-09-11', '2026-09-13')];
    const [r] = vincularCruces([cruce(1, 'TC9001', '2026-09-11')], vs, { margenDias: 0 });
    expect(r.estado).toBe('ambiguo');
    expect(r.viajeId).toBeNull();
    expect(r.candidatos.sort()).toEqual(['a', 'b']);
  });

  it('unidad distinta no liga', () => {
    const [r] = vincularCruces([cruce(1, 'TC9002', '2026-09-11')], V);
    expect(r.estado).toBe('sin_viaje');
  });

  it('normaliza la unidad igual que el número económico', () => {
    const r = vincularCruces([cruce(1, 'tc 9001', '2026-09-11'), cruce(2, 'TC-9001', '2026-09-11')], V);
    expect(r.map((x) => x.estado)).toEqual(['ligado', 'ligado']);
  });

  it('«CAMIONETA» literal y vacíos: sin_unidad, no se fuerzan', () => {
    const r = vincularCruces([cruce(1, 'CAMIONETA', '2026-09-11'), cruce(2, '', '2026-09-11'), cruce(3, null, '2026-09-11'), cruce(4, '  ', '2026-09-11')], V);
    expect(r.every((x) => x.estado === 'sin_unidad' && x.motivo === 'unidad_no_identificada' && x.viajeId === null)).toBe(true);
    expect(llaveUnidadVinculo('Camioneta')).toBeNull();
  });

  it('viaje abierto: ventana inicio + N configurable, sin inventar más', () => {
    const vs = [viaje('ab', 'TC9001', '2026-09-10', null)];
    const c = [cruce(1, 'TC9001', '2026-09-12'), cruce(2, 'TC9001', '2026-09-14')];
    expect(vincularCruces(c, vs, { margenDias: 0, diasViajeAbierto: 2 }).map((x) => x.estado)).toEqual(['ligado', 'sin_viaje']);
    expect(vincularCruces(c, vs, { margenDias: 0 }).map((x) => x.estado)).toEqual(['sin_viaje', 'sin_viaje']);
  });

  it('fecha inválida del cruce: sin_viaje con motivo, no revienta', () => {
    const [r] = vincularCruces([cruce(1, 'TC9001', '2026-02-31')], V);
    expect(r).toMatchObject({ estado: 'sin_viaje', motivo: 'fecha_invalida' });
  });

  it('viajes con fechas corruptas se ignoran sin afectar a los demás', () => {
    const vs = [viaje('mal', 'TC9001', 'xx', null), viaje('inv', 'TC9001', '2026-09-12', '2026-09-10'), ...V];
    const [r] = vincularCruces([cruce(1, 'TC9001', '2026-09-11')], vs);
    expect(r).toMatchObject({ estado: 'ligado', viajeId: 'v1' });
  });

  it('conserva el orden y el id de entrada', () => {
    const r = vincularCruces([cruce(7, 'TC9001', '2026-09-11'), cruce(3, 'X', '2026-09-11')], V);
    expect(r.map((x) => x.id)).toEqual([7, 3]);
  });

  it('9 000 cruces x 800 viajes en menos de 2 s', () => {
    const vs: ViajeFuente[] = [];
    for (let i = 0; i < 800; i++) {
      const d = 1 + (i % 25);
      vs.push(viaje(`v${i}`, `TC${1000 + (i % 40)}`, `2026-09-${String(d).padStart(2, '0')}`, `2026-09-${String(d + 2).padStart(2, '0')}`));
    }
    const cs: CruceAVincular[] = [];
    for (let i = 0; i < 9000; i++) cs.push(cruce(i, `TC${1000 + (i % 45)}`, `2026-09-${String(1 + (i % 27)).padStart(2, '0')}`));
    const t0 = performance.now();
    const r = vincularCruces(cs, vs);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(r).toHaveLength(9000);
  });
});
