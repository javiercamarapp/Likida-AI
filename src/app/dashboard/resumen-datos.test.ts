import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/likida/analytics', () => ({}));
vi.mock('@/lib/likida/carta_porte_datos', () => ({}));

const R = await import('./resumen-datos');
import type { Insight } from '@/lib/likida/insights/tipos';

describe('semanas de cierres', () => {
  it('8 semanas completas de lunes a hoy; la semana de hoy es parcial', () => {
    // 28-oct-2026 es miércoles: lunes 26. 7 semanas atrás: 9 sep.
    expect(R.diasParaSemanas('2026-10-28')).toBe(3 + 49);
    const serie = [{ dia: '2026-10-28', valor: 4 }, { dia: '2026-10-26', valor: 1 }, { dia: '2026-10-25', valor: 6 }, { dia: '2026-09-09', valor: 2 }];
    const s = R.semanasDeSerie(serie, '2026-10-28');
    expect(s).toHaveLength(8);
    expect(s[0].inicio).toBe('2026-09-07');
    expect(s[7]).toMatchObject({ inicio: '2026-10-26', valor: 5, parcial: true, etiqueta: '26 oct' });
    expect(s[6].valor).toBe(6); // domingo 25 cae en la semana del 19
    expect(s[0].valor).toBe(2);
  });
  it('si hoy es domingo la semana ya está completa', () => {
    expect(R.semanasDeSerie([], '2026-11-01')[7].parcial).toBe(false);
  });
  it('un día fuera de la ventana se ignora (no inventa columnas)', () => {
    const s = R.semanasDeSerie([{ dia: '2025-01-01', valor: 99 }], '2026-10-28');
    expect(s.every((x) => x.valor === 0)).toBe(true);
  });
});

describe('peajes y Carta Porte', () => {
  it('caseta presente se suma; ausente con menos de 3 conceptos es 0 medido; ausente con 3 es desconocido', () => {
    const g = (series: Array<{ nombre: string; valores: number[] }>) => ({ categorias: ['a'], series });
    expect(R.peajesDeGasto(g([{ nombre: 'caseta', valores: [10.5, 4.5] }]))).toBe(15);
    expect(R.peajesDeGasto(g([{ nombre: 'diesel', valores: [5] }]))).toBe(0);
    expect(R.peajesDeGasto(g(['diesel', 'viaticos', 'maniobras'].map((nombre) => ({ nombre, valores: [1] }))))).toBeNull();
  });
  const viaje = (listo: boolean, faltan: number) => ({ checklist: { transportistaListo: listo, faltanCliente: faltan } }) as never;
  it('cuenta completas solo si la lista no está truncada', () => {
    expect(R.cartaPorteCompletas({ viajes: [viaje(true, 0), viaje(true, 2), viaje(false, 0)], total: 3 })).toEqual({ completas: 1, total: 3 });
    expect(R.cartaPorteCompletas({ viajes: [viaje(true, 0)], total: 80 })).toBeNull();
  });
});

describe('periodo', () => {
  it('un valor raro de la URL cae al periodo por omisión', () => {
    expect(R.leerRango('7')).toBe('7');
    expect(R.leerRango('todo')).toBe('todo');
    expect(R.leerRango('x')).toBe('30');
    expect(R.leerRango(undefined)).toBe('30');
  });
});

const insight = (agente: Insight['agente'], severidad: Insight['severidad']): Insight => ({
  id: 'i', agente, severidad, tipo: 'dato', quePaso: 'Pasó algo.', queSignifica: 'Significa algo.', queHacer: 'Haz algo.',
  fuente: { tabla: 't', periodo: 'semana', n: 3 },
});

describe('filas de atención', () => {
  const kpis = (porRevisar: number) => ({ viajesLiquidados: 5, montoComprobado: 0, diferenciaDetectada: 0, conDiferencias: 0, porRevisar, tasaCuadre: 0 });
  it('ordena lo que te toca antes de lo que espera y rellena hasta tres con lo revisado', () => {
    const f = R.filasAtencion({ kpis: kpis(2), escalados: 0 }, [insight('peajes', 'atencion')], '');
    expect(f.map((x) => x.id)).toEqual(['por-revisar', 'insight-peajes', 'escalados-limpio']);
    expect(f[2].sinPendiente).toBe(true);
  });
  it('lectura caída: lo dice, no lo da por limpio', () => {
    const f = R.filasAtencion({ kpis: null, escalados: null }, [], '');
    expect(f.map((x) => x.detalle)).toEqual(['No se pudo leer ahora. No es cero.', 'No se pudo leer ahora. No es cero.']);
  });
  it('el sufijo de tenant se une también a rutas con filtro', () => {
    const f = R.filasAtencion({ kpis: kpis(0), escalados: 1 }, [], '?tenant=x');
    expect(f[0].href).toBe('/dashboard/viajes?filtro=escalados&tenant=x');
  });
});

describe('siguiente acción', () => {
  it('prioridad fija: puesta en marcha, alerta urgente, escalados, por revisar', () => {
    const filas = R.filasAtencion({ kpis: { viajesLiquidados: 1, montoComprobado: 0, diferenciaDetectada: 0, conDiferencias: 0, porRevisar: 1, tasaCuadre: 0 }, escalados: 1 }, [insight('liquidacion', 'urgente')], '');
    const a = R.elegirAcciones({ marcha: { titulo: 'Conectar', resumen: 'r', href: '/m' }, filas });
    expect(a.map((x) => x.id)).toEqual(['marcha', 'insight-liquidacion', 'escalados', 'por-revisar']);
    expect(R.elegirAcciones({ marcha: null, filas: [] })).toEqual([]);
  });
});
