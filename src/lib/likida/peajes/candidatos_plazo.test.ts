import { describe, it, expect } from 'vitest';
import { candidatosDePlazo, lineasCubiertasPorReclamo } from './candidatos_plazo';

const cand = (indice: number, categoria = 'clase_fuera_de_3_5', fecha: string | null = '2026-09-03', monto = 100) => ({ indice, categoria, fecha, monto });
const reclamo = (o: Partial<Parameters<typeof lineasCubiertasPorReclamo>[1][number]> = {}) =>
  ({ id: 'r1', categoria: 'clase_fuera_de_3_5', estado: 'enviado', nCruces: 1, fechaCobroMasAntiguo: '2026-09-01', ...o });

describe('candidatosDePlazo (la misma definición para la pantalla y el aviso del cron)', () => {
  it('sin reclamos ni decisiones nada está reclamado; lo sin fecha no corre contra el plazo', () => {
    const r = candidatosDePlazo({ desgloseId: 'd1', candidatos: [cand(0), cand(1, 'clase_fuera_de_3_5', null)], reclamosDelArchivo: [] });
    expect(r).toEqual([{ lineaId: '0', desgloseId: 'd1', fechaCruce: '2026-09-03', monto: 100, reclamado: false }]);
  });
  it('un reclamo ENVIADO de la categoría cubre tantos como nCruces, los más nuevos primero', () => {
    const r = candidatosDePlazo({
      desgloseId: 'd1',
      candidatos: [cand(0, 'clase_fuera_de_3_5', '2026-09-01'), cand(1, 'clase_fuera_de_3_5', '2026-09-05')],
      reclamosDelArchivo: [reclamo({ nCruces: 1 })],
    });
    expect(r.map((x) => [x.lineaId, x.reclamado])).toEqual([['0', false], ['1', true]]);
  });
  it('un reclamo solo PREPARADO o RECHAZADO no cubre nada (A37-S15-03)', () => {
    for (const estado of ['preparado', 'rechazado']) {
      const r = candidatosDePlazo({ desgloseId: 'd1', candidatos: [cand(0)], reclamosDelArchivo: [reclamo({ estado })] });
      expect(r[0].reclamado).toBe(false);
    }
  });
  it('un reclamo con decisiones ligadas cubre SOLO esas líneas (A37-A2-06)', () => {
    const r = candidatosDePlazo({
      desgloseId: 'd1', candidatos: [cand(0), cand(1)], reclamosDelArchivo: [reclamo({ nCruces: 2 })],
      decisiones: [{ indice: 1, categoria: 'clase_fuera_de_3_5', accion: 'reclamado', reclamoId: 'r1' }],
    });
    expect(r.map((x) => [x.lineaId, x.reclamado])).toEqual([['0', false], ['1', true]]);
  });
});
