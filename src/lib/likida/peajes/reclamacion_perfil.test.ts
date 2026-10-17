import { describe, it, expect } from 'vitest';
import { construirReclamacion, LEYENDAS_RECLAMACION, type LineaReclamable } from './reclamacion';
import { MOTIVOS_VISIBLES_CINCO_AGENTES, leyendasDePerfil, TEXTO_SIN_POSICIONES, TEXTO_CANDIDATO } from './reclamacion_perfil';

// T-A2-24: bajo el perfil `cinco_agentes` el reporte con GPS enseña SOLO `gps_lejos_de_caseta` (+ el doble cobro, que no es GPS);
// los motivos de zona y de curso son stand-by. Fixtures sintéticos.
const CASETA = { lat: 19.5, lng: -99.2, radioM: 300 };
const CRUCE = Date.parse('2026-08-05T17:30:00.000Z');
const base = (o: Partial<LineaReclamable>): LineaReclamable => ({
  indice: 0, fecha: '2026-08-05', hora: '11:30:00', caseta: 'Caseta Ejemplo', casetaCatalogo: 'Caseta Ejemplo', tag: 'TAG-1', unidad: 'U-1', monto: 100,
  cruceMs: CRUCE, gps: 'sin datos', gpsDistanciaM: null, gpsNota: '', casetaGeo: CASETA, muestras: [], casetaId: 'c1', cursos: [], ...o,
});
const CURSO_QUE_NO_AUTORIZA = [{ id: 'k1', codigo: 'K1', nombre: 'Ruta ejemplo', tipo: 'casetas' as const, casetaIds: ['otra'], casetaNombres: ['Otra'], corredor: null, vigenteDesde: null, vigenteHasta: null }];

describe('motivos visibles bajo cinco_agentes', () => {
  it('lista cerrada: gps_lejos_de_caseta y doble_cobro; fuera_de_curso y zona NO', () => {
    expect([...MOTIVOS_VISIBLES_CINCO_AGENTES].sort()).toEqual(['doble_cobro', 'gps_lejos_de_caseta']);
    expect(MOTIVOS_VISIBLES_CINCO_AGENTES).not.toContain('fuera_de_curso');
    expect(MOTIVOS_VISIBLES_CINCO_AGENTES).not.toContain('unidad_en_zona_no_autorizada');
  });
  it('sin zonas ni cursos (lo que el perfil entrega al armar el reporte) el reporte no puede traer fuera_de_curso ni zona', () => {
    const lineas = [
      base({ indice: 0, gps: 'no coincide', gpsDistanciaM: 8000, monto: 250 }),
      base({ indice: 1, tag: 'TAG-2', gps: 'sin datos', cursos: [] }),
    ];
    const r = construirReclamacion(lineas, []);
    expect(r.cruces.map((c) => c.motivo)).toEqual(['gps_lejos_de_caseta']);
    for (const m of ['fuera_de_curso', 'unidad_en_zona_no_autorizada'] as const) expect(r.resumen.porMotivo[m].n).toBe(0);
  });
  it('con cursos cargados SÍ habría fuera_de_curso (por eso el perfil no los entrega): y un doble cobro no se esconde detrás', () => {
    const conCurso = construirReclamacion([base({ indice: 0, gps: 'confirma', cursos: CURSO_QUE_NO_AUTORIZA })], []);
    expect(conCurso.cruces.map((c) => c.motivo)).toEqual(['fuera_de_curso']);
    const sinCurso = construirReclamacion([
      base({ indice: 0, gps: 'confirma', hora: '11:30:00' }),
      base({ indice: 1, gps: 'confirma', hora: '11:35:00', cruceMs: CRUCE + 5 * 60_000 }),
    ], []);
    expect(sinCurso.cruces.map((c) => c.motivo)).toEqual(['doble_cobro']);
  });
  it('sin posiciones: todo «sin datos», reporte vacío por diseño (no hay datos no es evidencia)', () => {
    const r = construirReclamacion([base({ indice: 0 }), base({ indice: 1, tag: 'TAG-2', gps: 'sin datos', gpsNota: 'sin posiciones' })], []);
    expect(r.cruces).toHaveLength(0);
    expect(r.resumen).toMatchObject({ reclamables: 0, montoReclamable: 0, sinDatos: 2, confirmadas: 0 });
    expect(TEXTO_SIN_POSICIONES).toMatch(/posiciones y casetas con ubicaci[óo]n/);
    expect(TEXTO_SIN_POSICIONES).toMatch(/no hay datos no es evidencia/i);
  });
});

describe('leyendas del perfil', () => {
  it('quita las leyendas de los motivos en stand-by y añade la de «candidato»', () => {
    const l = leyendasDePerfil();
    expect(l.join(' ')).not.toMatch(/Unidad en zona no autorizada|Cruce fuera de curso|Los cursos salen/);
    expect(l.join(' ')).toMatch(/GPS lejos de la caseta/);
    expect(l.join(' ')).toMatch(/Posible doble cobro/);
    expect(l).toContain(TEXTO_CANDIDATO);
    expect(TEXTO_CANDIDATO).toMatch(/candidato/i);
    expect(l.length).toBeLessThan(LEYENDAS_RECLAMACION.length + 1);
  });
});
