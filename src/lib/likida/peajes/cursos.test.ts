import { describe, it, expect } from 'vitest';
import { distanciaAPolilineaM, evaluarCurso, vigenteEn, MAX_DESFASE_CORREDOR_MIN, type CursoAplicable } from './cursos';

// ═══════════════════════════════════════════════════════════════════════════
// LOS CURSOS (rutas autorizadas): «¿este pase estaba dentro del curso de la unidad?».
// La doctrina que se fija: fuera de curso SOLO si todos los cursos aplicables se pudieron evaluar y ninguno
// autoriza el pase; sin curso o con dato insuficiente NO es evidencia en contra de nadie.
// ═══════════════════════════════════════════════════════════════════════════

const K1 = 'caseta-1'; const K2 = 'caseta-2'; const K3 = 'caseta-3';
const PASE = Date.parse('2026-08-05T16:30:00.000Z');

function porCasetas(p: Partial<CursoAplicable> = {}): CursoAplicable {
  return {
    id: 'c1', codigo: 'CUR-1', nombre: 'Planta A a Planta B', tipo: 'casetas', casetaIds: [K1, K2], casetaNombres: ['Caseta Uno', 'Caseta Dos'],
    corredor: null, vigenteDesde: null, vigenteHasta: null, ...p,
  };
}
// Corredor sintético: de oeste a este por la latitud 19.5 (≈ 11 km), buffer 500 m. 1° de longitud a 19.5° ≈ 105 km.
const POLI = [{ lat: 19.5, lng: -99.30 }, { lat: 19.5, lng: -99.20 }];
function corredor(p: Partial<CursoAplicable> = {}): CursoAplicable {
  return {
    id: 'c2', codigo: 'COR-1', nombre: 'Corredor Norte', tipo: 'corredor', casetaIds: [], casetaNombres: [],
    corredor: { polilinea: POLI, bufferM: 500 }, vigenteDesde: null, vigenteHasta: null, ...p,
  };
}
const base = { fecha: '2026-08-05', casetaId: K1, cruceMs: PASE, muestras: [] as Array<{ t: number; lat: number; lng: number }> };

describe('distancia a una polilínea', () => {
  it('un punto sobre el segmento está a ~0 m y uno a 0.01° de latitud al norte a ~1,113 m', () => {
    expect(distanciaAPolilineaM({ lat: 19.5, lng: -99.25 }, POLI)).toBeLessThan(1);
    const d = distanciaAPolilineaM({ lat: 19.51, lng: -99.25 }, POLI);
    expect(d).toBeGreaterThan(1_100); expect(d).toBeLessThan(1_125);
  });
  it('más allá del extremo mide contra el vértice, no contra la recta infinita', () => {
    const d = distanciaAPolilineaM({ lat: 19.5, lng: -99.19 }, POLI); // 0.01° de longitud pasado el extremo este ≈ 1,050 m
    expect(d).toBeGreaterThan(1_000); expect(d).toBeLessThan(1_100);
  });
  it('de varios segmentos gana el más cercano; un vértice solo es un punto; vacía es infinita', () => {
    const l = [{ lat: 19.5, lng: -99.30 }, { lat: 19.5, lng: -99.20 }, { lat: 19.6, lng: -99.20 }];
    expect(distanciaAPolilineaM({ lat: 19.55, lng: -99.2 }, l)).toBeLessThan(1);
    expect(distanciaAPolilineaM({ lat: 19.5, lng: -99.2 }, [{ lat: 19.5, lng: -99.2 }])).toBe(0);
    expect(distanciaAPolilineaM({ lat: 19.5, lng: -99.2 }, [])).toBe(Number.POSITIVE_INFINITY);
  });
  it('un segmento degenerado (dos vértices iguales) no divide entre cero', () => {
    const d = distanciaAPolilineaM({ lat: 19.51, lng: -99.2 }, [{ lat: 19.5, lng: -99.2 }, { lat: 19.5, lng: -99.2 }]);
    expect(Number.isFinite(d)).toBe(true); expect(d).toBeGreaterThan(1_100);
  });
});

describe('vigencia', () => {
  it('el curso vale entre sus fechas, inclusivas; sin fechas, siempre; una fecha ilegible no lo descarta', () => {
    const c = { vigenteDesde: '2026-08-01', vigenteHasta: '2026-08-31' };
    expect(vigenteEn(c, '2026-08-01')).toBe(true);
    expect(vigenteEn(c, '2026-08-31')).toBe(true);
    expect(vigenteEn(c, '2026-07-31')).toBe(false);
    expect(vigenteEn(c, '2026-09-01')).toBe(false);
    expect(vigenteEn({ vigenteDesde: null, vigenteHasta: null }, '2030-01-01')).toBe(true);
    expect(vigenteEn(c, '')).toBe(true);
  });
});

describe('evaluar el curso por casetas autorizadas', () => {
  it('la caseta está en el curso: dentro', () => {
    expect(evaluarCurso({ ...base, cursos: [porCasetas()] })).toEqual({ estado: 'dentro', curso: 'Planta A a Planta B' });
  });
  it('la caseta NO está en el curso: fuera, con el curso y sus casetas autorizadas', () => {
    const r = evaluarCurso({ ...base, casetaId: K3, cursos: [porCasetas()] });
    expect(r).toMatchObject({ estado: 'fuera', corredor: null });
    expect(r.estado === 'fuera' && r.cursos).toEqual([{ nombre: 'Planta A a Planta B', tipo: 'casetas', casetaNombres: ['Caseta Uno', 'Caseta Dos'] }]);
  });
  it('sin curso aplicable no hay nada que evaluar: sin_curso, jamás fuera', () => {
    expect(evaluarCurso({ ...base, cursos: [] })).toEqual({ estado: 'sin_curso' });
  });
  it('un curso fuera de su vigencia no aplica', () => {
    expect(evaluarCurso({ ...base, casetaId: K3, cursos: [porCasetas({ vigenteDesde: '2026-09-01' })] })).toEqual({ estado: 'sin_curso' });
    expect(evaluarCurso({ ...base, casetaId: K3, cursos: [porCasetas({ vigenteHasta: '2026-08-04' })] })).toEqual({ estado: 'sin_curso' });
  });
  it('la caseta sin resolver en el catálogo es dato insuficiente, no una acusación', () => {
    expect(evaluarCurso({ ...base, casetaId: null, cursos: [porCasetas()] })).toEqual({ estado: 'sin_dato', motivo: 'caseta_sin_resolver' });
  });
  it('un curso de casetas SIN casetas no autoriza ni desautoriza: es como no tener curso (ronda 17)', () => {
    const vacio = porCasetas({ casetaIds: [], casetaNombres: [] });
    expect(evaluarCurso({ ...base, casetaId: K3, cursos: [vacio] })).toEqual({ estado: 'sin_curso' });
    expect(evaluarCurso({ ...base, casetaId: null, cursos: [vacio] })).toEqual({ estado: 'sin_curso' });
    // y no estorba a otro curso que sí tiene casetas
    expect(evaluarCurso({ ...base, casetaId: K3, cursos: [vacio, porCasetas()] })).toMatchObject({ estado: 'fuera' });
    expect(evaluarCurso({ ...base, cursos: [vacio, porCasetas()] })).toEqual({ estado: 'dentro', curso: 'Planta A a Planta B' });
  });
  it('con varios cursos basta que UNO autorice el pase; fuera solo si ninguno lo autoriza', () => {
    const otro = porCasetas({ id: 'c3', codigo: 'CUR-2', nombre: 'Ruta alterna', casetaIds: [K3], casetaNombres: ['Caseta Tres'] });
    expect(evaluarCurso({ ...base, casetaId: K3, cursos: [porCasetas(), otro] })).toEqual({ estado: 'dentro', curso: 'Ruta alterna' });
    const r = evaluarCurso({ ...base, casetaId: 'otra', cursos: [porCasetas(), otro] });
    expect(r.estado === 'fuera' && r.cursos.map((c) => c.nombre)).toEqual(['Planta A a Planta B', 'Ruta alterna']);
  });
});

describe('evaluar el corredor (polilínea + buffer)', () => {
  const enCorredor = { t: PASE + 60_000, lat: 19.5, lng: -99.25 };
  const aLoLejos = { t: PASE + 60_000, lat: 19.51, lng: -99.25 }; // ≈ 1,113 m al norte, más allá de los 500 m
  it('la posición más cercana al pase dentro del buffer: dentro', () => {
    expect(evaluarCurso({ ...base, muestras: [enCorredor], cursos: [corredor()] })).toEqual({ estado: 'dentro', curso: 'Corredor Norte' });
  });
  it('la posición fuera del buffer: fuera, con la distancia medida y el buffer', () => {
    const r = evaluarCurso({ ...base, muestras: [aLoLejos], cursos: [corredor()] });
    expect(r.estado).toBe('fuera');
    if (r.estado === 'fuera') {
      expect(r.corredor).toMatchObject({ nombre: 'Corredor Norte', bufferM: 500 });
      expect(r.corredor?.distanciaM).toBeGreaterThan(1_100);
    }
  });
  it('gana la posición MÁS CERCANA EN EL TIEMPO al pase, no la más cercana al corredor', () => {
    const lejosPeroCerca = { t: PASE + 30_000, lat: 19.51, lng: -99.25 };
    const dentroPeroTarde = { t: PASE + 8 * 60_000, lat: 19.5, lng: -99.25 };
    expect(evaluarCurso({ ...base, muestras: [dentroPeroTarde, lejosPeroCerca], cursos: [corredor()] }).estado).toBe('fuera');
  });
  it('sin posición cercana al pase (o con el pase sin hora) es dato insuficiente, nunca fuera', () => {
    const tarde = { t: PASE + (MAX_DESFASE_CORREDOR_MIN + 1) * 60_000, lat: 19.51, lng: -99.25 };
    expect(evaluarCurso({ ...base, muestras: [tarde], cursos: [corredor()] })).toEqual({ estado: 'sin_dato', motivo: 'corredor_sin_posicion' });
    expect(evaluarCurso({ ...base, muestras: [], cursos: [corredor()] })).toEqual({ estado: 'sin_dato', motivo: 'corredor_sin_posicion' });
    expect(evaluarCurso({ ...base, cruceMs: null, muestras: [aLoLejos], cursos: [corredor()] })).toEqual({ estado: 'sin_dato', motivo: 'corredor_sin_posicion' });
  });
  it('un corredor con menos de 2 vértices no se evalúa (dato insuficiente)', () => {
    expect(evaluarCurso({ ...base, muestras: [aLoLejos], cursos: [corredor({ corredor: { polilinea: [POLI[0]], bufferM: 500 } })] }).estado).toBe('sin_dato');
  });
  it('coordenadas no finitas en las muestras se ignoran', () => {
    expect(evaluarCurso({ ...base, muestras: [{ t: PASE, lat: Number.NaN, lng: -99.25 }, aLoLejos], cursos: [corredor()] }).estado).toBe('fuera');
  });
});

describe('casetas y corredor juntos', () => {
  it('fuera solo si AMBOS lo dejan fuera; si uno no se puede evaluar, sin dato; si uno lo autoriza, dentro', () => {
    const lejos = { t: PASE, lat: 19.51, lng: -99.25 };
    const dentro = { t: PASE, lat: 19.5, lng: -99.25 };
    expect(evaluarCurso({ ...base, casetaId: K3, muestras: [lejos], cursos: [porCasetas(), corredor()] }).estado).toBe('fuera');
    expect(evaluarCurso({ ...base, casetaId: K3, muestras: [], cursos: [porCasetas(), corredor()] })).toEqual({ estado: 'sin_dato', motivo: 'corredor_sin_posicion' });
    expect(evaluarCurso({ ...base, casetaId: K3, muestras: [dentro], cursos: [porCasetas(), corredor()] }).estado).toBe('dentro');
    expect(evaluarCurso({ ...base, casetaId: K1, muestras: [lejos], cursos: [porCasetas(), corredor()] }).estado).toBe('dentro');
  });
});
