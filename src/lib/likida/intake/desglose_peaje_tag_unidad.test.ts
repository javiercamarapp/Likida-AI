import { describe, it, expect } from 'vitest';
import { cruzarLineasDesglose, type GastoCaseta } from './desglose_peaje';

// El cruce con el TAG ↔ unidad (0375). Los gastos y las líneas son sintéticos.
const g = (id: string, viajeId: string, monto: number, fecha: string, unidadId: string | null = null): GastoCaseta =>
  ({ id, viajeId, monto, fecha, unidadId });

describe('el TAG de la unidad rompe el empate entre dos gastos igual de buenos', () => {
  const gastos = [g('g1', 'v1', 189, '2026-08-05', 'u1'), g('g2', 'v2', 189, '2026-08-05', 'u2')];

  it('SIN TAG dado de alta: sigue ambigua (no se adivina)', () => {
    const [r] = cruzarLineasDesglose([{ fecha: '2026-08-05', monto: 189 }], gastos);
    expect(r.estatus).toBe('no_cuadra');
    expect(r.detalle?.motivo).toBe('ambigua_monto_exacto');
  });

  it('CON el TAG de u2: cuadra contra el gasto de u2 y lo deja dicho', () => {
    const [r] = cruzarLineasDesglose([{ fecha: '2026-08-05', monto: 189, unidadId: 'u2' }], gastos);
    expect(r).toMatchObject({ estatus: 'cuadra', viajeId: 'v2', gastoId: 'g2', diferencia: 0 });
    expect(r.detalle?.desempate).toBe('tag_unidad');
    expect(r.detalle?.alerta).toBeUndefined();
  });

  it('con el TAG de una unidad que no tiene ninguno de los dos gastos: sigue ambigua', () => {
    const [r] = cruzarLineasDesglose([{ fecha: '2026-08-05', monto: 189, unidadId: 'u3' }], gastos);
    expect(r.estatus).toBe('no_cuadra');
  });

  it('si DOS de los empatados son de la unidad del TAG: sigue ambigua', () => {
    const [r] = cruzarLineasDesglose(
      [{ fecha: '2026-08-05', monto: 189, unidadId: 'u1' }],
      [g('g1', 'v1', 189, '2026-08-05', 'u1'), g('g1b', 'v1b', 189, '2026-08-05', 'u1')],
    );
    expect(r.estatus).toBe('no_cuadra');
  });

  it('dos líneas idénticas con el TAG de u1 y u2 se reparten los gastos sin pisarse', () => {
    const r = cruzarLineasDesglose(
      [{ fecha: '2026-08-05', monto: 189, unidadId: 'u2' }, { fecha: '2026-08-05', monto: 189, unidadId: 'u1' }],
      gastos,
    );
    expect(r.map((x) => x.gastoId)).toEqual(['g2', 'g1']);
  });
});

describe('TAG de una unidad y gasto de OTRA: cuadra el monto, se marca para revisión', () => {
  it('alerta unidad_distinta con las dos unidades en el detalle', () => {
    const [r] = cruzarLineasDesglose([{ fecha: '2026-08-05', monto: 189, unidadId: 'u1' }], [g('g2', 'v2', 189, '2026-08-05', 'u2')]);
    expect(r.estatus).toBe('cuadra');
    expect(r.detalle).toMatchObject({ alerta: 'unidad_distinta', unidad_tag: 'u1', unidad_gasto: 'u2' });
  });
  it('si el viaje del gasto no tiene unidad NO hay alerta (no se acusa con el dato a medias)', () => {
    const [r] = cruzarLineasDesglose([{ fecha: '2026-08-05', monto: 189, unidadId: 'u1' }], [g('g2', 'v2', 189, '2026-08-05', null)]);
    expect(r.detalle?.alerta).toBeUndefined();
  });
  it('si el TAG no está dado de alta NO hay alerta', () => {
    const [r] = cruzarLineasDesglose([{ fecha: '2026-08-05', monto: 189, unidadId: null }], [g('g2', 'v2', 189, '2026-08-05', 'u2')]);
    expect(r.detalle?.alerta).toBeUndefined();
  });
});

describe('sin_contraparte lleva el tamaño del fondo (distingue «no hay ticket» de «no hay tickets cargados»)', () => {
  it('fondo vacío', () => {
    const [r] = cruzarLineasDesglose([{ fecha: '2026-08-05', monto: 189 }], []);
    expect(r.detalle).toMatchObject({ motivo: 'sin_gastos_en_ventana', fondo_gastos: 0 });
  });
  it('fondo con gastos de otros días', () => {
    const [r] = cruzarLineasDesglose([{ fecha: '2026-08-05', monto: 189 }], [g('g1', 'v1', 189, '2026-08-20')]);
    expect(r.detalle).toMatchObject({ motivo: 'sin_gastos_en_ventana', fondo_gastos: 1 });
  });
});

describe('«contraparte ya reclamada» solo si lo reclamado HABRÍA cuadrado', () => {
  it('un gasto de otro monto, ya usado por otra línea, NO es la contraparte de esta', () => {
    const r = cruzarLineasDesglose(
      [{ fecha: '2026-08-06', monto: 250 }, { fecha: '2026-08-07', monto: 300 }],
      [g('g2', 'v1', 250, '2026-08-06')],
    );
    expect(r[0].estatus).toBe('cuadra');
    expect(r[1]).toMatchObject({ estatus: 'sin_contraparte', detalle: { motivo: 'sin_gastos_en_ventana' } });
  });
  it('dos líneas idénticas y un solo gasto: la segunda sí es «ya reclamada» (¿cobro duplicado?)', () => {
    const r = cruzarLineasDesglose(
      [{ fecha: '2026-08-06', monto: 250 }, { fecha: '2026-08-06', monto: 250 }],
      [g('g2', 'v1', 250, '2026-08-06')],
    );
    expect(r[1].detalle).toMatchObject({ motivo: 'contraparte_ya_reclamada' });
  });
});
