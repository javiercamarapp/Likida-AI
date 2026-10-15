import { describe, it, expect } from 'vitest';
import { revisarCobros, type LineaCobro } from './reglas_cobro';
import { normalizarNombre, llaveUnidad } from './formatos';

// Fixtures sintéticos: casetas y unidades inventadas. Nada real.
const CASETA = 'Caseta Ejemplo Norte';
const NORM = normalizarNombre(CASETA);
const l = (indice: number, p: Partial<LineaCobro> = {}): LineaCobro => ({
  indice, fecha: '2026-03-05', hora: `10:${String(indice).padStart(2, '0')}:00`, caseta: CASETA, tag: `TAG0000000${indice}`, unidad: 'TC9001', clase: 5, monto: 100, ...p,
});
const prohibidas = { casetasNoCruzar: new Set([NORM]), periodoDesde: '2026-03-01' };
const nc = (r: ReturnType<typeof revisarCobros>) => r.candidatos.filter((c) => c.categoria === 'caseta_no_debe_cruzarse');

describe('caseta que no debe cruzarse: lista vacía, excepciones por unidad y justificación', () => {
  it('con la lista vacía no marca nada y lo dice en reglasNoAplicadas', () => {
    const r = revisarCobros([l(0), l(1)], { periodoDesde: '2026-03-01' });
    expect(nc(r)).toHaveLength(0);
    const nota = r.reglasNoAplicadas.find((x) => x.regla === 'caseta_no_debe_cruzarse');
    expect(nota?.motivo).toMatch(/no hay casetas prohibidas configuradas/i);
  });

  it('con una caseta prohibida, ya no aparece en reglasNoAplicadas y marca todos los cruces', () => {
    const r = revisarCobros([l(0), l(1, { unidad: 'TC9002' })], prohibidas);
    expect(nc(r)).toHaveLength(2);
    expect(r.reglasNoAplicadas.some((x) => x.regla === 'caseta_no_debe_cruzarse')).toBe(false);
  });

  it('la unidad exceptuada no se marca; las demás sí, y una línea sin unidad también', () => {
    const lineas = [l(0, { unidad: 'TC9001' }), l(1, { unidad: 'TC9002' }), l(2, { unidad: null }), l(3, { unidad: ' tc-9001 ' })];
    const r = revisarCobros(lineas, { ...prohibidas, excepcionesPorUnidad: new Map([[NORM, new Set([llaveUnidad('TC9001')])]]) });
    expect(nc(r).map((c) => c.indice)).toEqual([1, 2]);
  });

  it('la excepción es por caseta: la misma unidad en otra caseta prohibida sigue marcándose', () => {
    const OTRA = 'Plaza Ejemplo Sur';
    const r = revisarCobros([l(0, { caseta: OTRA }), l(1)], {
      casetasNoCruzar: new Set([NORM, normalizarNombre(OTRA)]), periodoDesde: '2026-03-01',
      excepcionesPorUnidad: new Map([[NORM, new Set([llaveUnidad('TC9001')])]]),
    });
    expect(nc(r).map((c) => c.indice)).toEqual([0]);
  });

  it('un cruce justificado SIGUE en la lista (historial) con su motivo y cuenta en los totales', () => {
    const r = revisarCobros([l(0), l(1)], { ...prohibidas, justificados: new Map([[1, 'Salida de servicio autorizada']]) });
    const cs = nc(r);
    expect(cs).toHaveLength(2);
    expect(cs.find((c) => c.indice === 1)?.justificacion).toBe('Salida de servicio autorizada');
    expect('justificacion' in (cs.find((c) => c.indice === 0) as object)).toBe(false);
    expect(r.porCategoria.caseta_no_debe_cruzarse).toEqual({ n: 2, monto: 200 });
  });

  it('la justificación solo aplica a esta categoría (un renglón con clase 9 sigue sin justificar)', () => {
    const r = revisarCobros([l(0, { clase: 9 })], { ...prohibidas, justificados: new Map([[0, 'motivo']]) });
    const clase = r.candidatos.find((c) => c.categoria === 'clase_fuera_de_3_5');
    expect(clase).toBeDefined();
    expect('justificacion' in (clase as object)).toBe(false);
  });

  it('barajar las líneas no cambia qué se marca', () => {
    const lineas = [l(0), l(1, { unidad: 'TC9002' }), l(2), l(3, { unidad: 'TC9003' })];
    const reglas = { ...prohibidas, excepcionesPorUnidad: new Map([[NORM, new Set([llaveUnidad('TC9001')])]]) };
    const a = nc(revisarCobros(lineas, reglas)).map((c) => c.indice);
    const b = nc(revisarCobros([...lineas].reverse(), reglas)).map((c) => c.indice);
    expect(b).toEqual(a);
    expect(a).toEqual([1, 3]);
  });
});
