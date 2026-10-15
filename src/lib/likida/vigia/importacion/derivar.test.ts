import { describe, it, expect } from 'vitest';
import {
  derivarEstatusImportacion, estatusACsv, ROTULO_DERIVADO, MENSAJE_INCOHERENCIA,
  type FilaImportacion, type CajaDerivada,
} from './derivar';
import type { EstatusImportacion } from './modelo';
import { construirProgramaSinteticoConOraculo } from '../programa/fixtures';
import { leerProgramaCsv } from '../programa/lector';
import { normalizarPrograma } from '../programa/normalizar';

let linea = 0;
const fila = (p: Partial<FilaImportacion> = {}): FilaImportacion => ({
  lineaCsv: ++linea, fecha: '2026-10-05', tipo: 'IMPORTACION', caja: 'CAJA-001', unidad: 'U-01',
  transito: 'patio_nld', ccp: 'listo', ...p,
});

describe('derivarEstatusImportacion · mapeo y conteo por día', () => {
  it('PATIO NLD → patio, PEND CRUCE → pend_cruce, EN RUTA → en_ruta; CCP LISTO → listo, PEND REQUE → pend_requisito', () => {
    const r = derivarEstatusImportacion([
      fila({ caja: 'C1', transito: 'patio_nld', ccp: 'listo' }),
      fila({ caja: 'C2', transito: 'pend_cruce', ccp: 'pend_reque' }),
      fila({ caja: 'C3', transito: 'en_ruta', ccp: 'listo' }),
    ]);
    const por = Object.fromEntries(r.cajas.map((c) => [c.caja, [c.estado, c.docs]]));
    expect(por).toEqual({ C1: ['patio', 'listo'], C2: ['pend_cruce', 'pend_requisito'], C3: ['en_ruta', 'listo'] });
  });

  it('cuenta cajas por día y por estado, ordenado por fecha', () => {
    const r = derivarEstatusImportacion([
      fila({ fecha: '2026-10-06', caja: 'C9', transito: 'en_ruta' }),
      fila({ fecha: '2026-10-05', caja: 'C1', transito: 'patio_nld' }),
      fila({ fecha: '2026-10-05', caja: 'C2', transito: 'patio_nld' }),
      fila({ fecha: '2026-10-05', caja: 'C3', transito: 'pend_cruce', ccp: 'pend_reque' }),
    ]);
    expect(r.dias.map((d) => d.fecha)).toEqual(['2026-10-05', '2026-10-06']);
    expect(r.dias[0]).toMatchObject({ cajas: 3, sinCaja: 0, porEstado: { patio: 2, pend_cruce: 1, en_ruta: 0, desconocido: 0 }, porDocs: { listo: 2, pend_requisito: 1, desconocido: 0 } });
    expect(r.dias[1].porEstado.en_ruta).toBe(1);
  });

  it('una caja repetida el mismo día cuenta una vez (sin importar mayúsculas) y se queda con el primer dato conocido', () => {
    const r = derivarEstatusImportacion([
      fila({ caja: 'ABC-1', transito: 'vacio', ccp: 'vacio', unidad: null }),
      fila({ caja: 'abc-1', transito: 'en_ruta', ccp: 'listo', unidad: 'U-7' }),
    ]);
    expect(r.cajas).toHaveLength(1);
    expect(r.cajas[0]).toMatchObject({ estado: 'en_ruta', docs: 'listo', unidad: 'U-7' });
    expect(r.dias[0].cajas).toBe(1);
  });

  it('la misma caja en dos días cuenta en cada día', () => {
    const r = derivarEstatusImportacion([fila({ fecha: '2026-10-05' }), fila({ fecha: '2026-10-06' })]);
    expect(r.dias.map((d) => d.cajas)).toEqual([1, 1]);
  });

  it('valores raros o vacíos no se adivinan: quedan «sin estatus»', () => {
    const r = derivarEstatusImportacion([
      fila({ caja: 'C1', transito: 'desconocido', ccp: 'desconocido' }),
      fila({ caja: 'C2', transito: 'vacio', ccp: 'vacio' }),
      fila({ caja: 'C3', transito: 'ok', ccp: 'despachado' }),
    ]);
    expect(r.cajas.every((c) => c.estado === 'desconocido' && c.docs === 'desconocido')).toBe(true);
    expect(r.dias[0].porEstado.desconocido).toBe(3);
  });

  it('filas sin caja se cuentan aparte; filas de otras secciones y sin fecha no entran al conteo', () => {
    const r = derivarEstatusImportacion([
      fila({ caja: null, unidad: 'U-2' }),
      fila({ caja: '  ' }),
      fila({ tipo: 'EXPORTACION' }),
      fila({ fecha: null }),
      fila({ caja: 'C1' }),
    ]);
    expect(r.dias).toHaveLength(1);
    expect(r.dias[0]).toMatchObject({ cajas: 1, sinCaja: 2 });
    expect(r.filasOtrasSecciones).toBe(1);
    expect(r.sinFecha).toBe(1);
    expect(r.filasImportacion).toBe(4);
  });

  it('vacío: sin filas no hay días ni cajas ni comparación', () => {
    const r = derivarEstatusImportacion([]);
    expect(r).toMatchObject({ dias: [], cajas: [], incoherencias: [], comparacion: null, filasImportacion: 0 });
  });
});

describe('derivarEstatusImportacion · incoherencias', () => {
  it('CCP «LISTO» con TRANSITO vacío se señala con su línea y mensaje llano', () => {
    const r = derivarEstatusImportacion([fila({ lineaCsv: 77, caja: 'C1', transito: 'vacio', ccp: 'listo' })]);
    expect(r.incoherencias).toEqual([{
      lineaCsv: 77, fecha: '2026-10-05', caja: 'C1', unidad: 'U-01', codigo: 'listo_sin_transito', mensaje: MENSAJE_INCOHERENCIA.listo_sin_transito,
    }]);
    expect(r.cajas[0].incoherencias).toEqual(['listo_sin_transito']);
  });

  it('EN RUTA con documentos pendientes de requisito se señala', () => {
    const r = derivarEstatusImportacion([fila({ transito: 'en_ruta', ccp: 'pend_reque' })]);
    expect(r.incoherencias.map((i) => i.codigo)).toEqual(['en_ruta_sin_documentos']);
  });

  it('lo coherente no se señala (patio+listo, cruce+pendiente, TRANSITO vacío con CCP vacío)', () => {
    const r = derivarEstatusImportacion([
      fila({ caja: 'A', transito: 'patio_nld', ccp: 'listo' }),
      fila({ caja: 'B', transito: 'pend_cruce', ccp: 'pend_reque' }),
      fila({ caja: 'C', transito: 'vacio', ccp: 'vacio' }),
      fila({ caja: 'D', transito: 'vacio', ccp: 'pend_reque' }),
    ]);
    expect(r.incoherencias).toEqual([]);
  });

  it('una fila incoherente sin caja también se señala', () => {
    const r = derivarEstatusImportacion([fila({ caja: null, transito: 'vacio', ccp: 'listo' })]);
    expect(r.incoherencias).toHaveLength(1);
    expect(r.incoherencias[0].caja).toBeNull();
  });
});

describe('derivarEstatusImportacion · comparación con Track & Trace', () => {
  const tt = (p: Partial<EstatusImportacion>): EstatusImportacion => ({
    caja: 'C1', unidad: null, estado: 'patio', docs: 'listo', fuente: 'track_trace', observadoEn: '2026-10-05T10:00:00-06:00', filaId: null, ...p,
  });

  it('sin datos de T&T → null (la pantalla dice que no hay con qué comparar)', () => {
    expect(derivarEstatusImportacion([fila()]).comparacion).toBeNull();
    expect(derivarEstatusImportacion([fila()], { trackTrace: [] }).comparacion).toBeNull();
  });

  it('cuenta coincidencias, diferencias y cajas que T&T no menciona', () => {
    const r = derivarEstatusImportacion(
      [
        fila({ caja: 'C1', transito: 'patio_nld', ccp: 'listo' }),
        fila({ caja: 'C2', transito: 'en_ruta', ccp: 'listo' }),
        fila({ caja: 'C3', transito: 'pend_cruce', ccp: 'listo' }),
      ],
      { trackTrace: [tt({ caja: 'c1' }), tt({ caja: 'C2', estado: 'patio' })] },
    );
    expect(r.comparacion).toEqual({ comparadas: 2, coinciden: 1, difieren: ['C2'], sinDatoTT: 1 });
  });

  it('un «sin estatus» de cualquiera de las dos fuentes no cuenta como desacuerdo', () => {
    const r = derivarEstatusImportacion(
      [fila({ caja: 'C1', transito: 'vacio', ccp: 'vacio' })],
      { trackTrace: [tt({ caja: 'C1', estado: 'en_ruta', docs: 'pend_requisito' })] },
    );
    expect(r.comparacion).toMatchObject({ comparadas: 1, coinciden: 1, difieren: [] });
  });
});

describe('derivarEstatusImportacion · contra el programa sintético', () => {
  it('deriva sobre un programa completo sin perder cajas ni salirse de importación', () => {
    const { texto } = construirProgramaSinteticoConOraculo({ dias: 3, filasPorSeccion: 20 });
    const { filas } = normalizarPrograma(leerProgramaCsv(texto, { terminal: 'GDL' }));
    const r = derivarEstatusImportacion(filas);
    const impo = filas.filter((f) => f.tipo === 'IMPORTACION');
    expect(r.filasImportacion).toBe(impo.length);
    expect(r.filasOtrasSecciones).toBe(filas.length - impo.length);
    expect(r.filasImportacion).toBeGreaterThan(0);
    const cajasDistintas = new Set(impo.filter((f) => f.caja && f.fecha).map((f) => `${f.fecha}|${f.caja!.trim().toLowerCase()}`));
    expect(r.cajas).toHaveLength(cajasDistintas.size);
    expect(r.dias.reduce((s, d) => s + d.cajas, 0)).toBe(cajasDistintas.size);
    for (const d of r.dias) {
      expect(Object.values(d.porEstado).reduce((a, b) => a + b, 0)).toBe(d.cajas);
      expect(Object.values(d.porDocs).reduce((a, b) => a + b, 0)).toBe(d.cajas);
    }
  });
});

describe('estatusACsv', () => {
  const caja = (p: Partial<CajaDerivada> = {}): CajaDerivada => ({
    fecha: '2026-10-05', caja: 'C1', unidad: 'U-01', estado: 'patio', docs: 'listo', incoherencias: [], ...p,
  });

  it('lleva BOM, encabezado, etiquetas en llano y el rótulo de derivado en cada fila', () => {
    const csv = estatusACsv([caja(), caja({ caja: 'C2', estado: 'pend_cruce', docs: 'pend_requisito' })]);
    const lineas = csv.replace('﻿', '').trimEnd().split('\n');
    expect(csv.startsWith('﻿')).toBe(true);
    expect(lineas[0]).toBe('Fecha,Caja,Unidad,Estatus de la caja,Documentos,Revisar,Fuente');
    expect(lineas[1]).toContain('C1,U-01,En patio,Documentos listos');
    expect(lineas[2]).toContain('Pendiente de cruce,Pendiente de requisito');
    for (const l of lineas.slice(1)) expect(l.endsWith(ROTULO_DERIVADO.includes(',') ? `"${ROTULO_DERIVADO}"` : ROTULO_DERIVADO)).toBe(true);
  });

  it('neutraliza fórmulas en caja y unidad (=, +, -, @)', () => {
    const csv = estatusACsv([
      caja({ caja: '=HYPERLINK("http://x")', unidad: '+1+1' }),
      caja({ caja: '@SUM(A1)', unidad: '-2' }),
    ]);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).toContain(`'+1+1`);
    expect(csv).toContain(`'@SUM(A1)`);
    expect(csv).toContain(`'-2`);
    for (const l of csv.replace('﻿', '').trimEnd().split('\n').slice(1)) {
      for (const c of l.split(',')) expect(/^[=+\-@]/.test(c.replace(/^"/, ''))).toBe(false);
    }
  });

  it('marca en «Revisar» la incoherencia; sin cajas solo trae el encabezado', () => {
    const csv = estatusACsv([caja({ incoherencias: ['listo_sin_transito'] })]);
    expect(csv).toContain('TRANSITO está vacía');
    expect(estatusACsv([]).replace('﻿', '').trimEnd().split('\n')).toHaveLength(1);
  });
});
