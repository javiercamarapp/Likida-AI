import { describe, it, expect } from 'vitest';
import { casarNota, resumirAcreditacion, type ReclamoParaCasar } from './notas_credito';

const rec = (id: string, monto: number, fecha = '2026-08-01'): ReclamoParaCasar => ({ id, estado: 'enviado', montoReclamable: monto, fechaCobroMasAntiguo: fecha });

describe('casarNota', () => {
  it('nota 250 y un reclamo de 250: casado seguro, sin confirmar solo', () => {
    const r = casarNota({ importe: 250 }, [rec('a', 250), rec('b', 700)]);
    expect(r).toMatchObject({ tipo: 'seguro', reclamoIds: ['a'], confirmado: false });
  });

  it('nota 400 con reclamos 250/150/300: sugiere {250,150}', () => {
    const r = casarNota({ importe: 400 }, [rec('a', 250), rec('b', 150), rec('c', 300)]);
    expect(r.tipo).toBe('sugerido');
    if (r.tipo === 'sugerido') { expect(r.opciones).toEqual([['a', 'b']]); expect(r.ambiguo).toBe(false); expect(r.confirmado).toBe(false); }
  });

  it('ambigüedad: dos subconjuntos válidos se listan y ninguno se elige', () => {
    const r = casarNota({ importe: 400 }, [rec('a', 250, '2026-07-01'), rec('b', 150, '2026-07-02'), rec('c', 300, '2026-07-03'), rec('d', 100, '2026-07-04')]);
    expect(r.tipo).toBe('sugerido');
    if (r.tipo === 'sugerido') {
      expect(r.ambiguo).toBe(true);
      expect(r.opciones).toEqual(expect.arrayContaining([['a', 'b'], ['c', 'd']]));
      expect(r.confirmado).toBe(false);
    }
  });

  it('dos reclamos del mismo monto: ambos como opción, ninguno seguro', () => {
    const r = casarNota({ importe: 250 }, [rec('a', 250), rec('b', 250)]);
    expect(r).toMatchObject({ tipo: 'sugerido', ambiguo: true, opciones: [['a'], ['b']] });
  });

  it('nota mayor que todo lo reclamado: sin casar y alerta', () => {
    const r = casarNota({ importe: 1100 }, [rec('a', 250), rec('b', 150)]);
    expect(r).toMatchObject({ tipo: 'sin_casar', alertas: ['nota_mayor_que_reclamado'] });
  });

  it('nada coincide: nota sin casar', () => {
    expect(casarNota({ importe: 333 }, [rec('a', 250), rec('b', 150)])).toMatchObject({ tipo: 'sin_casar', alertas: [] });
  });

  it('redondeo: 0.1 + 0.2 casa con 0.30', () => {
    expect(casarNota({ importe: 0.3 }, [rec('a', 0.1), rec('b', 0.2)])).toMatchObject({ tipo: 'sugerido', opciones: [['a', 'b']] });
  });

  it('importe inválido o no positivo no casa', () => {
    expect(casarNota({ importe: 0 }, [rec('a', 10)])).toMatchObject({ tipo: 'sin_casar', alertas: ['importe_invalido'] });
    expect(casarNota({ importe: Number.NaN }, [rec('a', 10)])).toMatchObject({ alertas: ['importe_invalido'] });
  });

  it('ignora reclamos sin saldo reclamable', () => {
    expect(casarNota({ importe: 250 }, [rec('a', 0), rec('b', 250)])).toMatchObject({ tipo: 'seguro', reclamoIds: ['b'] });
  });

  it('con 40 reclamos no se cuelga: cae a «demasiados, casa a mano»', () => {
    const muchos = Array.from({ length: 40 }, (_, i) => rec(`r${i}`, 10 + i, `2026-08-${String((i % 28) + 1).padStart(2, '0')}`));
    const t0 = Date.now();
    const r = casarNota({ importe: 1001 }, muchos);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.tipo).toBe('demasiados');
    if (r.tipo === 'demasiados') expect(r.mensaje).toMatch(/a mano/);
  });

  it('con 40 reclamos, un monto exacto único aún se casa (búsqueda lineal)', () => {
    const muchos = Array.from({ length: 40 }, (_, i) => rec(`r${i}`, 10 + i));
    expect(casarNota({ importe: 49 }, muchos)).toMatchObject({ tipo: 'seguro', reclamoIds: ['r39'] });
  });

  it('25 reclamos patológicos terminan acotados', () => {
    const iguales = Array.from({ length: 25 }, (_, i) => rec(`r${i}`, 1, `2026-08-${String((i % 28) + 1).padStart(2, '0')}`));
    const t0 = Date.now();
    const r = casarNota({ importe: 12 }, iguales);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(['sugerido', 'demasiados']).toContain(r.tipo);
    if (r.tipo === 'sugerido') { expect(r.opciones.length).toBeLessThanOrEqual(10); expect(r.truncado).toBe(true); }
  });

  it('no muta la lista de entrada', () => {
    const lista = [rec('b', 150, '2026-09-01'), rec('a', 250, '2026-07-01')];
    const copia = JSON.stringify(lista);
    casarNota({ importe: 400 }, lista);
    expect(JSON.stringify(lista)).toBe(copia);
  });
});

describe('resumirAcreditacion', () => {
  const base = { estado: 'enviado' as const, fechaCobroMasAntiguo: '2026-08-01' };
  it('acreditado vs reclamado, sin confirmar y plazo vencido', () => {
    const r = resumirAcreditacion([
      { id: 'a', ...base, montoReclamado: 1000, montoAcreditado: 250, estado: 'acreditado_parcial' },
      { id: 'b', ...base, montoReclamado: 500, montoAcreditado: 0, fechaCobroMasAntiguo: '2026-05-01' },
      { id: 'c', ...base, montoReclamado: 300, montoAcreditado: 300, estado: 'acreditado' },
    ], '2026-10-14');
    expect(r.reclamado).toBe(1800);
    expect(r.acreditado).toBe(550);
    expect(r.diferencia).toBe(1250);
    expect(r.sinConfirmar).toEqual(['a', 'b']);
    expect(r.superaronPlazoSinRespuesta).toEqual(['b']);
    expect(r.alertas).toEqual([]);
  });

  it('acreditado mayor que reclamado alerta', () => {
    const r = resumirAcreditacion([{ id: 'a', ...base, montoReclamado: 100, montoAcreditado: 150, estado: 'acreditado' }], '2026-10-14');
    expect(r.alertas).toEqual(['acreditado_mayor_que_reclamado']);
    expect(r.diferencia).toBe(-50);
  });

  it('un reclamo solo preparado no cuenta como «sin confirmar»', () => {
    const r = resumirAcreditacion([{ id: 'a', ...base, estado: 'preparado', montoReclamado: 100, montoAcreditado: 0 }], '2026-10-14');
    expect(r.sinConfirmar).toEqual([]);
  });
});

describe('A37-A2-04: Reclamado y Pendiente no suman preparados ni rechazados', () => {
  const base = { fechaCobroMasAntiguo: '2026-08-01' };
  it('un preparado de 40,000 (nunca enviado) y un rechazado de 25,000 NO inflan lo reclamado ni lo pendiente', () => {
    const r = resumirAcreditacion([
      { id: 'p', ...base, estado: 'preparado', montoReclamado: 40000, montoAcreditado: 0 },
      { id: 'x', ...base, estado: 'rechazado', montoReclamado: 25000, montoAcreditado: 0 },
      { id: 'e', ...base, estado: 'enviado', montoReclamado: 1000.1, montoAcreditado: 0.1 },
    ], '2026-10-14');
    expect(r.reclamado).toBe(1000.1);
    expect(r.acreditado).toBe(0.1);
    expect(r.pendiente).toBe(1000);
  });

  it('el pendiente es de reclamos abiertos: lo acreditado de más en uno no compensa el saldo de otro', () => {
    const r = resumirAcreditacion([
      { id: 'a', ...base, estado: 'acreditado', montoReclamado: 100, montoAcreditado: 150 },
      { id: 'b', ...base, estado: 'enviado', montoReclamado: 300, montoAcreditado: 0 },
    ], '2026-10-14');
    expect(r.pendiente).toBe(300);
  });
});

