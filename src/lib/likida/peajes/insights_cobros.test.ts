import { describe, expect, it } from 'vitest';
import { insightsDeCobros, PALABRAS_PROHIBIDAS_INSIGHTS, type EntradaInsights } from './insights_cobros';

const base: EntradaInsights = {
  cruces: { total: 1000, evaluados: 900 },
  categorias: [
    { categoria: 'duplicado_exacto', n: 10, monto: 1200.5, atendidos: 4 },
    { categoria: 'extemporaneo', n: 30, monto: 5000, atendidos: 6 },
    { categoria: 'clase_fuera_de_3_5', n: 60, monto: 20000, atendidos: 10 },
  ],
  acreditacion: { reclamado: 10000, acreditado: 4000, diferencia: 6000 },
  porVencer: { cruces: 12, monto: 3000 },
  atipicosNuevos: 5,
  sinViaje: 40,
};

const textos = (x: unknown): string[] => {
  if (typeof x === 'string') return [x];
  if (Array.isArray(x)) return x.flatMap(textos);
  if (x && typeof x === 'object') return Object.values(x).flatMap(textos);
  return [];
};

describe('insightsDeCobros: tarjetas', () => {
  it('una tarjeta por categoria con candidatos, en orden fijo, con n, monto y fuente', () => {
    const r = insightsDeCobros(base);
    expect(r.tarjetas.map((t) => t.id)).toEqual(['clase_fuera_de_3_5', 'extemporaneo', 'duplicado_exacto']);
    const t = r.tarjetas[0];
    expect(t).toMatchObject({ n: 60, monto: 20000 });
    expect(t.titulo).toBeTruthy();
    expect(t.quePaso).toContain('60');
    expect(t.queSignifica).toMatch(/Candidato: validar con el proveedor/);
    expect(t.queHacer).toBeTruthy();
    expect(t.fuente).toBeTruthy();
  });

  it('sin candidatos: una sola tarjeta «nada que reclamar»', () => {
    const r = insightsDeCobros({ ...base, categorias: [{ categoria: 'extemporaneo', n: 0, monto: 0, atendidos: 0 }] });
    expect(r.tarjetas).toHaveLength(1);
    expect(r.tarjetas[0]).toMatchObject({ id: 'sin_candidatos', n: 0, monto: 0 });
    expect(r.tarjetas[0].quePaso).toMatch(/nada que reclamar/i);
  });

  it('tarifa inferida: el importe sobre tarifa queda «por confirmar»', () => {
    const r = insightsDeCobros({
      ...base,
      categorias: [{ categoria: 'importe_sobre_tarifa', n: 7, monto: 900, atendidos: 0, tarifaConfirmada: false }],
    });
    expect(r.tarjetas[0].queSignifica).toMatch(/por confirmar/i);
    const conf = insightsDeCobros({
      ...base,
      categorias: [{ categoria: 'importe_sobre_tarifa', n: 7, monto: 900, atendidos: 0, tarifaConfirmada: true }],
    });
    expect(conf.tarjetas[0].queSignifica).not.toMatch(/por confirmar/i);
  });

  it('categorias repetidas se suman; atendidos nunca supera a n; entradas invalidas valen 0', () => {
    const r = insightsDeCobros({
      ...base,
      categorias: [
        { categoria: 'extemporaneo', n: 3, monto: 30, atendidos: 1 },
        { categoria: 'extemporaneo', n: 2, monto: 20, atendidos: 9 },
        { categoria: 'duplicado_exacto', n: Number.NaN, monto: -5, atendidos: 1 },
      ],
    });
    expect(r.tarjetas).toHaveLength(1);
    expect(r.tarjetas[0]).toMatchObject({ id: 'extemporaneo', n: 5, monto: 50 });
    expect(r.kpis.pctRevisado.valor).toBe(60); // 1 + min(9, 2) = 3 de 5
  });

  it('una categoria critica se dice con todas sus letras', () => {
    const r = insightsDeCobros({ ...base, categorias: [{ categoria: 'unidad_inmovilizada', n: 2, monto: 300, atendidos: 0 }] });
    expect(r.tarjetas[0].queSignifica).toMatch(/taller|siniestro|inmovilizada/i);
  });
});

describe('insightsDeCobros: KPIs', () => {
  it('% revisado = atendidos / candidatos, separado de cruces evaluados automaticamente', () => {
    const r = insightsDeCobros(base);
    expect(r.kpis.pctRevisado.valor).toBe(20); // 20 de 100
    expect(r.kpis.crucesEvaluados).toMatchObject({ valor: 90, n: 900, total: 1000 });
    expect(r.kpis.pctRevisado.id).not.toBe(r.kpis.crucesEvaluados.id);
    expect(r.kpis.pctRevisado.titulo).not.toBe(r.kpis.crucesEvaluados.titulo);
    expect(r.kpis.pctRevisado.detalle).toMatch(/20 de 100/);
  });

  it('0 cruces o 0 candidatos: no divide por cero, el valor es «sin dato» y el texto lo dice', () => {
    const r = insightsDeCobros({ ...base, cruces: { total: 0, evaluados: 0 }, categorias: [] });
    expect(r.kpis.crucesEvaluados.valor).toBeNull();
    expect(r.kpis.pctRevisado.valor).toBeNull();
    expect(r.kpis.crucesEvaluados.detalle).toMatch(/sin cruces|no hay cruces/i);
    expect(r.kpis.pctRevisado.detalle).toMatch(/no hay candidatos/i);
    for (const k of Object.values(r.kpis)) expect(Number.isNaN(k.valor as number)).toBe(false);
  });

  it('evaluados nunca superan el total', () => {
    const r = insightsDeCobros({ ...base, cruces: { total: 10, evaluados: 50 } });
    expect(r.kpis.crucesEvaluados).toMatchObject({ valor: 100, n: 10, total: 10 });
  });

  it('reclamado vs acreditado vs pendiente, con su fuente', () => {
    const r = insightsDeCobros(base);
    expect(r.kpis.reclamado.valor).toBe(10000);
    expect(r.kpis.acreditado.valor).toBe(4000);
    expect(r.kpis.pendiente.valor).toBe(6000);
    expect(r.kpis.reclamado.fuente).toMatch(/reclamo|nota/i);
  });

  it('acreditado mayor que reclamado: pendiente 0 y aviso para revisar', () => {
    const r = insightsDeCobros({ ...base, acreditacion: { reclamado: 100, acreditado: 150, diferencia: -50 } });
    expect(r.kpis.pendiente.valor).toBe(0);
    expect(r.kpis.acreditado.detalle).toMatch(/revis/i);
  });

  it('sin reclamos: reclamado, acreditado y pendiente en 0 con mensaje', () => {
    const r = insightsDeCobros({ ...base, acreditacion: { reclamado: 0, acreditado: 0, diferencia: 0 } });
    expect(r.kpis.reclamado.valor).toBe(0);
    expect(r.kpis.reclamado.detalle).toMatch(/ningún reclamo|aún no/i);
  });

  it('por vencer en 30 dias, atipicos nuevos y sin viaje; dato no disponible = sin dato, no 0', () => {
    const r = insightsDeCobros(base);
    expect(r.kpis.porVencer).toMatchObject({ valor: 12, monto: 3000 });
    expect(r.kpis.atipicosNuevos.valor).toBe(5);
    expect(r.kpis.sinViaje.valor).toBe(40);
    const s = insightsDeCobros({ ...base, atipicosNuevos: null, sinViaje: null, porVencer: null });
    expect(s.kpis.atipicosNuevos.valor).toBeNull();
    expect(s.kpis.sinViaje.valor).toBeNull();
    expect(s.kpis.porVencer.valor).toBeNull();
    expect(s.kpis.sinViaje.detalle).toMatch(/no disponible/i);
  });

  it('el ahorro de tiempo NO se rotula como dato: falta la linea base del cliente', () => {
    const r = insightsDeCobros(base);
    expect(r.ahorroDeTiempo.disponible).toBe(false);
    expect(r.ahorroDeTiempo.motivo).toMatch(/minutos/i);
    expect(JSON.stringify(r)).not.toMatch(/% de ahorro|porcentaje de ahorro/i);
  });
});

describe('insightsDeCobros: determinismo y lenguaje', () => {
  it('con las categorias barajadas el resultado es identico', () => {
    const a = insightsDeCobros(base);
    const b = insightsDeCobros({ ...base, categorias: [...base.categorias].reverse() });
    expect(b).toEqual(a);
  });

  it('no muta la entrada', () => {
    const copia = JSON.parse(JSON.stringify(base));
    insightsDeCobros(base);
    expect(base).toEqual(copia);
  });

  it('ningun texto trae jerga ni valores rotos', () => {
    const casos: EntradaInsights[] = [
      base,
      { ...base, cruces: { total: 0, evaluados: 0 }, categorias: [], porVencer: null, atipicosNuevos: null, sinViaje: null },
      {
        ...base,
        categorias: [
          { categoria: 'unidad_inmovilizada', n: 1, monto: 1, atendidos: 0 },
          { categoria: 'tag_dado_de_baja', n: 1, monto: 1, atendidos: 0 },
          { categoria: 'caseta_no_debe_cruzarse', n: 1, monto: 1, atendidos: 0 },
          { categoria: 'importe_sobre_tarifa', n: 1, monto: 1, atendidos: 0, tarifaConfirmada: false },
        ],
      },
    ];
    for (const c of casos) {
      const todo = textos(insightsDeCobros(c)).join(' \n ').toLowerCase();
      for (const p of PALABRAS_PROHIBIDAS_INSIGHTS) expect(todo, p).not.toContain(p);
      expect(todo).not.toMatch(/undefined|\bnan\b|\[object/);
    }
    expect(PALABRAS_PROHIBIDAS_INSIGHTS).toEqual(expect.arrayContaining(['sección', 'ratio', 'null']));
  });
});
