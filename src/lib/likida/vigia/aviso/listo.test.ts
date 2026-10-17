import { describe, expect, it } from 'vitest';
import { construirProgramaSinteticoConOraculo } from '../programa/fixtures';
import { leerProgramaCsv } from '../programa/lector';
import { normalizarPrograma, type Ccp, type Transito } from '../programa/normalizar';
import {
  CONFIG_LISTO_POR_DEFECTO, ROTULO_PROXY, evaluarListo,
  type FilaParaListo, type LeyendaColores, type TipoSeccionAviso,
} from './listo';

const base: FilaParaListo = {
  tipo: 'IMPORTACION', caja: 'C-100', unidad: 'U-101', ccp: 'listo', transito: 'ok',
};
const con = (p: Partial<FilaParaListo>): FilaParaListo => ({ ...base, ...p });

describe('evaluarListo · proxy', () => {
  it('caja + unidad + ccp listo en importación → listo, vía proxy, rotulado', () => {
    const r = evaluarListo(base);
    expect(r).toMatchObject({ listo: true, via: 'proxy', faltantes: [] });
    expect(r.motivo).toContain(ROTULO_PROXY);
    expect(r.conflicto).toBeUndefined();
  });

  it('matriz caja × unidad × ccp en las dos secciones elegibles', () => {
    const cajas = [null, '', '  ', 'C-1'];
    const unidades = [null, '', 'U-1'];
    const ccps: Ccp[] = ['listo', 'despachado', 'pend_reque', 'pend_ccp', 'falta_complemento', 'vacio', 'desconocido'];
    const secciones: TipoSeccionAviso[] = ['IMPORTACION', 'EXPORTACION'];
    for (const tipo of secciones) for (const caja of cajas) for (const unidad of unidades) for (const ccp of ccps) {
      const r = evaluarListo({ tipo, caja, unidad, ccp, transito: 'ok' });
      const faltan: string[] = [];
      if (!(caja && caja.trim())) faltan.push('caja');
      if (!(unidad && unidad.trim())) faltan.push('unidad');
      if (ccp !== 'listo' && ccp !== 'despachado') faltan.push('ccp');
      expect(r.faltantes).toEqual(faltan);
      expect(r.listo).toBe(faltan.length === 0);
      expect(r.via).toBe('proxy');
    }
  });

  it('caja sin unidad → no listo (faltante unidad)', () => {
    const r = evaluarListo(con({ unidad: null }));
    expect(r.listo).toBe(false);
    expect(r.faltantes).toEqual(['unidad']);
  });

  it('unidad sin caja → no listo (faltante caja)', () => {
    expect(evaluarListo(con({ caja: null })).faltantes).toEqual(['caja']);
  });

  it('ccpListos es editable', () => {
    expect(evaluarListo(con({ ccp: 'pend_reque' })).listo).toBe(false);
    expect(evaluarListo(con({ ccp: 'pend_reque' }), { ccpListos: ['pend_reque'] }).listo).toBe(true);
    expect(evaluarListo(con({ ccp: 'listo' }), { ccpListos: ['despachado'] }).listo).toBe(false);
  });
});

describe('evaluarListo · tránsito', () => {
  const transitos: Transito[] = ['patio_nld', 'en_ruta', 'pend_cruce', 'ok', 'patio_otro', 'na', 'vacio', 'desconocido'];

  it('por defecto el tránsito no cuenta', () => {
    for (const t of transitos) expect(evaluarListo(con({ transito: t })).listo).toBe(true);
  });

  it('exigirTransito bloquea pend_cruce y solo ese', () => {
    for (const t of transitos) {
      const r = evaluarListo(con({ transito: t }), { exigirTransito: true });
      expect(r.listo).toBe(t !== 'pend_cruce');
    }
    const r = evaluarListo(con({ transito: 'pend_cruce' }), { exigirTransito: true });
    expect(r.faltantes).toEqual([]);
    expect(r.motivo).toContain('pend_cruce');
  });

  it('los tránsitos bloqueantes son configurables', () => {
    const cfg = { exigirTransito: true, transitosBloqueantes: ['en_ruta'] as Transito[] };
    expect(evaluarListo(con({ transito: 'en_ruta' }), cfg).listo).toBe(false);
    expect(evaluarListo(con({ transito: 'pend_cruce' }), cfg).listo).toBe(true);
  });
});

describe('evaluarListo · secciones', () => {
  it('por defecto solo importación y exportación', () => {
    expect(CONFIG_LISTO_POR_DEFECTO.secciones).toEqual(['IMPORTACION', 'EXPORTACION']);
    expect(evaluarListo(con({ tipo: 'EXPORTACION' })).listo).toBe(true);
    for (const tipo of ['DOMESTICO', 'MOV_VACIO', 'OTRO'] as const) {
      expect(evaluarListo(con({ tipo })).listo).toBe(false);
    }
  });

  it('la flota puede habilitar doméstico y movimiento vacío', () => {
    const cfg = { secciones: ['IMPORTACION', 'EXPORTACION', 'DOMESTICO', 'MOV_VACIO'] as TipoSeccionAviso[] };
    expect(evaluarListo(con({ tipo: 'DOMESTICO' }), cfg).listo).toBe(true);
    expect(evaluarListo(con({ tipo: 'MOV_VACIO' }), cfg).listo).toBe(true);
  });

  it('CANCELACIONES nunca es listo, ni habilitada', () => {
    expect(evaluarListo(con({ tipo: 'CANCELACIONES' })).listo).toBe(false);
    const cfg = { secciones: ['CANCELACIONES', 'IMPORTACION'] as TipoSeccionAviso[] };
    const r = evaluarListo(con({ tipo: 'CANCELACIONES' }), cfg);
    expect(r.listo).toBe(false);
    expect(r.motivo).toContain('CANCELACIONES');
    const leyenda: LeyendaColores = { verde: 'confirmable' };
    expect(evaluarListo(con({ tipo: 'CANCELACIONES', color: 'verde' }), cfg, leyenda).listo).toBe(false);
  });
});

describe('evaluarListo · color', () => {
  const leyenda: LeyendaColores = {
    verde: 'confirmable', azul: 'patio', rojo: 'pendiente', gris: 'ignorar',
  };

  it('sin leyenda nunca se decide por color', () => {
    const r = evaluarListo(con({ color: 'verde', unidad: null }));
    expect(r).toMatchObject({ listo: false, via: 'proxy' });
    expect(r.conflicto).toBeUndefined();
  });

  it('leyenda sin color en la fila, o color sin mapear o «ignorar» → proxy', () => {
    for (const color of [undefined, null, '', 'morado', 'gris']) {
      expect(evaluarListo(con({ color }), undefined, leyenda)).toMatchObject({ listo: true, via: 'proxy' });
    }
  });

  it('color patio/confirmable de acuerdo con el proxy → listo vía color', () => {
    for (const color of ['verde', 'azul']) {
      expect(evaluarListo(con({ color }), undefined, leyenda)).toMatchObject({ listo: true, via: 'color' });
    }
  });

  it('color «listo» pero el proxy dice que falta algo → conflicto, no se avisa', () => {
    const r = evaluarListo(con({ color: 'verde', unidad: null }), undefined, leyenda);
    expect(r).toMatchObject({ listo: false, via: 'color', conflicto: true, faltantes: ['unidad'] });
  });

  it('proxy listo pero color «pendiente» → conflicto, no se avisa', () => {
    const r = evaluarListo(con({ color: 'rojo' }), undefined, leyenda);
    expect(r).toMatchObject({ listo: false, via: 'color', conflicto: true });
  });

  it('color «pendiente» y proxy no listo → no listo, sin conflicto', () => {
    const r = evaluarListo(con({ color: 'rojo', ccp: 'pend_ccp' }), undefined, leyenda);
    expect(r).toMatchObject({ listo: false, via: 'color' });
    expect(r.conflicto).toBeUndefined();
  });

  it('la clave del color no se resuelve por el prototipo', () => {
    const r = evaluarListo(con({ color: 'constructor' }), undefined, leyenda);
    expect(r).toMatchObject({ listo: true, via: 'proxy' });
  });
});

describe('evaluarListo · conteo sobre el oráculo sintético', () => {
  it('el conteo del proxy coincide con el esperado por el oráculo', () => {
    const { texto, oraculo } = construirProgramaSinteticoConOraculo({ dias: 4, filasPorSeccion: 40 });
    const lectura = leerProgramaCsv(texto, { terminal: 'GDL' });
    const { filas } = normalizarPrograma(lectura);

    const contar = (tipo: string) => filas.filter((f) => f.tipo === tipo && evaluarListo(f).listo).length;
    const esperado = (tipo: string) => oraculo.filas.filter((f) =>
      !f.descartable && f.tipo === tipo && !!f.caja && !!f.unidad
      && (f.ccp === 'listo' || f.ccp === 'despachado')).length;

    expect(esperado('IMPORTACION')).toBeGreaterThan(0);
    expect(esperado('EXPORTACION')).toBeGreaterThan(0);
    expect(contar('IMPORTACION')).toBe(esperado('IMPORTACION'));
    expect(contar('EXPORTACION')).toBe(esperado('EXPORTACION'));
    for (const t of ['CANCELACIONES', 'DOMESTICO', 'MOV_VACIO'])
      expect(contar(t)).toBe(0);
  });
});
