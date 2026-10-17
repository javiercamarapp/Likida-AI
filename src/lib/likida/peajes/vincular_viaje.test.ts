import { describe, it, expect } from 'vitest';
import { vincularCruces, vincularPorIcident, llaveUnidadVinculo, type CruceAVincular, type CruceIcident } from './vincular_viaje';
import type { ViajeFuente, PosicionConViaje } from './viajes_fuente';
import type { CasetaCatalogo } from './casetas';

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

describe('vincularPorIcident (ruta preferente, fixtures sintéticos)', () => {
  const vi = (id: string, icident: string | null, unidad: string, ini: string, fin: string | null): ViajeFuente =>
    ({ id, folio: null, icident, unidadNumero: unidad, inicio: ini, fin, origen: null, destino: null });
  const cr = (id: number, unidad: string | null, caseta: string | null, fecha: string, hora: string | null): CruceIcident =>
    ({ id, unidadArchivo: unidad, caseta, fecha, hora });
  const pos = (unidad: string, icident: string, poi: string, fh: string): PosicionConViaje =>
    ({ unidad, icident, puntoInteres: poi, fechaHoraLocal: fh, lat: 19.4, lng: -99.1 });

  const VS = [vi('vA', 'D-1', 'TC9001', '2026-09-10', '2026-09-12'), vi('vB', 'D-2', 'TC9001', '2026-09-13', '2026-09-14')];

  it('el Icident coincide: ligado via icident', () => {
    const P = [pos('TC9001', 'D-1', 'Caseta Norte', '2026-09-11T10:10')];
    const [r] = vincularPorIcident([cr(1, 'TC9001', 'Caseta Norte', '2026-09-11', '10:00')], VS, P);
    expect(r).toMatchObject({ estado: 'ligado', viajeId: 'vA', via: 'icident', icident: 'D-1' });
  });

  it('precedencia: resuelve un ambiguo de la ventana a favor del Icident', () => {
    const vs = [vi('a', 'D-1', 'TC9001', '2026-09-10', '2026-09-11'), vi('b', 'D-2', 'TC9001', '2026-09-11', '2026-09-13')];
    const P = [pos('TC9001', 'D-2', 'Caseta Norte', '2026-09-11T09:00')];
    const [r] = vincularPorIcident([cr(1, 'TC9001', 'caseta norte', '2026-09-11', '09:05')], vs, P, { margenDias: 0 });
    expect(r).toMatchObject({ estado: 'ligado', viajeId: 'b', via: 'icident' });
  });

  it('Icident vs ventana en conflicto: conflicto visible, no se decide solo', () => {
    // La ventana dice vA (11 sep); el Icident de la posición apunta a vB.
    const P = [pos('TC9001', 'D-2', 'Caseta Norte', '2026-09-11T10:00')];
    const [r] = vincularPorIcident([cr(1, 'TC9001', 'Caseta Norte', '2026-09-11', '10:00')], VS, P, { margenDias: 0 });
    expect(r.estado).toBe('conflicto');
    expect(r.viajeId).toBeNull();
    expect(r.candidatos).toEqual(['vB', 'vA']);
    expect(r.motivo).toBe('icident_contradice_ventana');
  });

  it('POI con otro nombre que la caseta: liga con la tabla de equivalencias; sin ella no', () => {
    const cat: CasetaCatalogo[] = [{ id: 'c1', nombre: 'Caseta Norte', nombreNorm: 'caseta norte', alias: ['Plaza Cobro Norte'], lat: 0, lng: 0, radioM: 300 }];
    const P = [pos('TC9001', 'D-1', 'Plaza Cobro Norte', '2026-09-11T10:00')];
    const c = [cr(1, 'TC9001', 'Caseta Norte', '2026-09-11', '10:00')];
    expect(vincularPorIcident(c, VS, P, { catalogo: cat })[0]).toMatchObject({ estado: 'ligado', via: 'icident', viajeId: 'vA' });
    expect(vincularPorIcident(c, VS, P)[0]).toMatchObject({ via: 'unidad_ventana', estado: 'ligado', viajeId: 'vA' });
    expect(vincularPorIcident(c, VS, P, { casetaEquivalente: () => true })[0].via).toBe('icident');
  });

  it('sin posiciones (o fuera de ±ventanaMin, otra unidad, otra caseta): cae a unidad+ventana', () => {
    const c = [cr(1, 'TC9001', 'Caseta Norte', '2026-09-11', '10:00')];
    const esperado = vincularCruces(c, VS);
    expect(vincularPorIcident(c, VS, [])).toEqual(esperado);
    expect(vincularPorIcident(c, VS, [pos('TC9001', 'D-2', 'Caseta Norte', '2026-09-11T11:00')], { ventanaMin: 30 })).toEqual(esperado);
    expect(vincularPorIcident(c, VS, [pos('TC9001', 'D-2', 'Caseta Norte', '2026-09-11T10:30')], { ventanaMin: 30 })[0].via).toBe('icident');
    expect(vincularPorIcident(c, VS, [pos('TC9002', 'D-2', 'Caseta Norte', '2026-09-11T10:00')])).toEqual(esperado);
    expect(vincularPorIcident(c, VS, [pos('TC9001', 'D-2', 'Caseta Sur', '2026-09-11T10:00')])).toEqual(esperado);
  });

  it('cruce sin hora o sin caseta: no hay coincidencia por posición', () => {
    const P = [pos('TC9001', 'D-2', 'Caseta Norte', '2026-09-11T10:00')];
    const r = vincularPorIcident([cr(1, 'TC9001', 'Caseta Norte', '2026-09-11', null), cr(2, 'TC9001', null, '2026-09-11', '10:00')], VS, P);
    expect(r.every((x) => x.via === 'unidad_ventana' && x.viajeId === 'vA')).toBe(true);
  });

  it('Icident sin viaje conocido: no inventa, deja la ventana con el motivo', () => {
    const P = [pos('TC9001', 'D-99', 'Caseta Norte', '2026-09-11T10:00')];
    const [r] = vincularPorIcident([cr(1, 'TC9001', 'Caseta Norte', '2026-09-11', '10:00')], VS, P);
    expect(r).toMatchObject({ estado: 'ligado', viajeId: 'vA', via: 'unidad_ventana', motivo: 'icident_sin_viaje', icident: 'D-99' });
  });

  it('dos Icident distintos en la ventana de minutos: ambiguo', () => {
    const P = [pos('TC9001', 'D-1', 'Caseta Norte', '2026-09-11T10:00'), pos('TC9001', 'D-2', 'Caseta Norte', '2026-09-11T10:05')];
    const [r] = vincularPorIcident([cr(1, 'TC9001', 'Caseta Norte', '2026-09-11', '10:00')], VS, P);
    expect(r).toMatchObject({ estado: 'ambiguo', viajeId: null, via: 'icident' });
    expect(r.candidatos.sort()).toEqual(['vA', 'vB']);
  });

  it('Icident sin viaje en ventana (sin_viaje): liga por Icident', () => {
    const P = [pos('TC9001', 'D-1', 'Caseta Norte', '2026-09-20T10:00')];
    const [r] = vincularPorIcident([cr(1, 'TC9001', 'Caseta Norte', '2026-09-20', '10:00')], VS, P, { margenDias: 0 });
    expect(r).toMatchObject({ estado: 'ligado', viajeId: 'vA', via: 'icident' });
  });

  it('cruce que cruza medianoche: la ventana de minutos es continua entre días', () => {
    const vs = [vi('n', 'D-5', 'TC9001', '2026-09-10', '2026-09-11')];
    const P = [pos('TC9001', 'D-5', 'Caseta Norte', '2026-09-11T00:05')];
    const [r] = vincularPorIcident([cr(1, 'TC9001', 'Caseta Norte', '2026-09-10', '23:50')], vs, P);
    expect(r).toMatchObject({ estado: 'ligado', via: 'icident', viajeId: 'n' });
  });

  it('no hay llamada de red: el módulo es puro', async () => {
    const orig = globalThis.fetch;
    let llamado = false;
    globalThis.fetch = (() => { llamado = true; throw new Error('red'); }) as typeof fetch;
    try { vincularPorIcident([cr(1, 'TC9001', 'Caseta Norte', '2026-09-11', '10:00')], VS, []); } finally { globalThis.fetch = orig; }
    expect(llamado).toBe(false);
  });
});
