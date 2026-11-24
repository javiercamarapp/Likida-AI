import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  calcularDatosFaltantes, leerDatosFaltantes, idParcial,
  type EntradaDatosFaltantes, type LineaMinima, type TagMinimo, type CasetaMinima, type TarifaMinima, type IdFila, type Fuente,
} from './datos_faltantes';

const ok = <T,>(datos: T): Fuente<T> => ({ ok: true, datos });
const falla = (falta: string): Fuente<never> => ({ ok: false, falta });

const tag = (t: string, unidadId: string, eco: string, extra: Partial<TagMinimo> = {}): TagMinimo =>
  ({ tag: t, unidadId, unidadEconomico: eco, activo: true, bajaEn: null, ...extra });
const caseta = (nombre: string, extra: Partial<CasetaMinima> = {}): CasetaMinima =>
  ({ id: `c-${nombre}`, nombre, nombreNorm: nombre.toLowerCase(), alias: [], lat: 19.4, lng: -99.1, radioM: 300, activa: true, ...extra });
const tarifa = (casetaNorm: string, clase: number, extra: Partial<TarifaMinima> = {}): TarifaMinima =>
  ({ casetaNorm, clase, vigenteDesde: '2026-01-01', vigenteHasta: null, ...extra });
const linea = (i: number, extra: Partial<LineaMinima> = {}): LineaMinima =>
  ({ indice: i, fecha: '2026-10-05', caseta: 'caseta norte', tag: 'TAG-0001', clase: 5, unidadArchivo: 'T-10', unidadId: 'u-1', ...extra });

const sana = (): EntradaDatosFaltantes => ({
  tags: ok([tag('TAG-0001', 'u-1', 'T-10')]),
  casetas: ok([caseta('caseta norte')]),
  tarifas: ok([tarifa('caseta norte', 5)]),
  lineas: ok([linea(0), linea(1)]),
});

const fila = (e: EntradaDatosFaltantes, id: IdFila) => calcularDatosFaltantes(e, 2).filas.find((f) => f.id === id)!;

describe('idParcial: el ejemplo nunca es el identificador completo', () => {
  it('recorta TAGs, económicos y nombres', () => {
    expect(idParcial('TAG-0001')).toBe('TAG…01');
    expect(idParcial('T-10')).toBe('T…0');
    expect(idParcial('  ')).toBe('…');
    expect(idParcial('Caseta Ejemplo Norte')).not.toContain('Ejemplo');
  });
});

describe('datos sanos: cada fila se mide y sale completa (cero medido, no cero supuesto)', () => {
  it('las ocho filas quedan en «completo» con casos 0', () => {
    const r = calcularDatosFaltantes(sana(), 2);
    expect(r.filas).toHaveLength(8);
    for (const f of r.filas) expect(f).toMatchObject({ estado: 'completo', casos: 0, ejemplo: null, falta: null });
    expect(r.archivos).toBe(2);
  });
});

describe('(a) TAG sin unidad asignada', () => {
  it('cuenta TAG distintos y cruces; el ejemplo va anonimizado', () => {
    const e = { ...sana(), lineas: ok([linea(0, { tag: 'TAG-0002', unidadId: null }), linea(1, { tag: 'TAG-0002', unidadId: null }), linea(2, { tag: 'TAG-0003', unidadId: null }), linea(3)]) };
    expect(fila(e, 'tag_sin_unidad')).toMatchObject({ estado: 'faltan', casos: 2, detalle: '2 TAG distintos · 3 cruces', ejemplo: 'TAG…02' });
  });
  it('sin ningún renglón con TAG no es «completo»: es sin datos', () => {
    const e = { ...sana(), lineas: ok([linea(0, { tag: null, unidadId: null })]) };
    expect(fila(e, 'tag_sin_unidad')).toMatchObject({ estado: 'sin_datos', casos: null, falta: 'cruces con TAG en los archivos recibidos' });
  });
});

describe('(b) económicos con varios TAG y TAG con dos económicos', () => {
  it('un económico (T-10) con dos TAG activos; una baja no cuenta', () => {
    const e = { ...sana(), tags: ok([tag('TAG-0001', 'u-1', 'T-10'), tag('TAG-0002', 'u-1', 'T-10'), tag('TAG-0003', 'u-2', 'T-11'), tag('TAG-0004', 'u-2', 'T-11', { bajaEn: '2026-09-30' })]) };
    expect(fila(e, 'economico_varios_tags')).toMatchObject({ estado: 'faltan', casos: 1, detalle: '1 económico', ejemplo: 'T…0' });
  });
  it('catálogo de TAGs vacío = sin datos, no cero', () => {
    expect(fila({ ...sana(), tags: ok([]) }, 'economico_varios_tags')).toMatchObject({ estado: 'sin_datos', casos: null, falta: 'el catálogo de TAGs' });
  });
  it('el mismo TAG con T-10 y T-11 en los renglones', () => {
    const e = { ...sana(), lineas: ok([linea(0, { unidadArchivo: 'T-10' }), linea(1, { unidadArchivo: 't-11' }), linea(2, { tag: 'TAG-0002', unidadArchivo: 'T-12' })]) };
    expect(fila(e, 'tag_dos_economicos')).toMatchObject({ estado: 'faltan', casos: 1, ejemplo: 'TAG…01' });
  });
  it('mayúsculas y espacios distintos del mismo económico NO son dos económicos', () => {
    const e = { ...sana(), lineas: ok([linea(0, { unidadArchivo: 'T-10' }), linea(1, { unidadArchivo: ' t-10 ' })]) };
    expect(fila(e, 'tag_dos_economicos')).toMatchObject({ estado: 'completo', casos: 0 });
  });
  it('si ningún renglón trae económico: aún no medible, con la fuente que falta', () => {
    const e = { ...sana(), lineas: ok([linea(0, { unidadArchivo: null }), linea(1, { unidadArchivo: null })]) };
    expect(fila(e, 'tag_dos_economicos')).toMatchObject({ estado: 'no_medible', casos: null, falta: 'el económico por renglón en los archivos de desglose' });
  });
});

describe('(c) casetas sin coordenadas', () => {
  it('cuenta las activas sin lat/lng; una dada de baja no cuenta', () => {
    const e = { ...sana(), casetas: ok([caseta('Caseta Ejemplo Norte', { lat: null, lng: null }), caseta('Caseta Ejemplo Sur', { lng: null }), caseta('Caseta Vieja', { lat: null, lng: null, activa: false }), caseta('Caseta Buena')]) };
    expect(fila(e, 'caseta_sin_coordenadas')).toMatchObject({ estado: 'faltan', casos: 2, detalle: '2 de 3 casetas', ejemplo: 'Cas…te' });
  });
  it('catálogo sin casetas activas = sin datos', () => {
    expect(fila({ ...sana(), casetas: ok([caseta('x', { activa: false })]) }, 'caseta_sin_coordenadas')).toMatchObject({ estado: 'sin_datos', casos: null });
  });
});

describe('(d) casetas y cruces sin tarifa', () => {
  it('una caseta sin ninguna fila en el tarifario', () => {
    const e = { ...sana(), casetas: ok([caseta('caseta norte'), caseta('caseta sur')]) };
    expect(fila(e, 'caseta_sin_tarifa')).toMatchObject({ estado: 'faltan', casos: 1, detalle: '1 de 2 casetas' });
  });
  it('tarifario vacío con casetas: faltan todas (es medido, no «sin datos»)', () => {
    const e = { ...sana(), tarifas: ok([]) };
    expect(fila(e, 'caseta_sin_tarifa')).toMatchObject({ estado: 'faltan', casos: 1 });
  });
  it('un cruce sin tarifa de SU clase; otra clase de la misma caseta no lo cubre', () => {
    const e = { ...sana(), lineas: ok([linea(0, { clase: 5 }), linea(1, { clase: 2 })]) };
    expect(fila(e, 'cruce_sin_tarifa')).toMatchObject({ estado: 'faltan', casos: 1, detalle: '1 cruce' });
  });
  it('una tarifa vencida antes de la fecha del cruce no lo cubre', () => {
    const e = { ...sana(), tarifas: ok([tarifa('caseta norte', 5, { vigenteHasta: '2026-06-30' })]) };
    expect(fila(e, 'cruce_sin_tarifa')).toMatchObject({ estado: 'faltan', casos: 2 });
  });
  it('sin fecha o sin clase en el cruce no se inventa un faltante: basta una tarifa de la caseta', () => {
    const e = { ...sana(), lineas: ok([linea(0, { clase: null, fecha: null })]) };
    expect(fila(e, 'cruce_sin_tarifa')).toMatchObject({ estado: 'completo', casos: 0 });
  });
  it('resuelve la caseta por alias del catálogo', () => {
    const e = { ...sana(), casetas: ok([caseta('caseta norte', { alias: ['CN Km 12'] })]), lineas: ok([linea(0, { caseta: 'CN Km 12' })]) };
    expect(fila(e, 'cruce_sin_tarifa')).toMatchObject({ estado: 'completo', casos: 0 });
  });
  it('tarifario ilegible: aún no medible en ambas filas, nunca cero', () => {
    const e = { ...sana(), tarifas: falla('el tarifario') };
    for (const id of ['caseta_sin_tarifa', 'cruce_sin_tarifa'] as const) expect(fila(e, id)).toMatchObject({ estado: 'no_medible', casos: null, falta: 'el tarifario' });
  });
});

describe('(e) fecha vacía y (f) clase desconocida', () => {
  const e = { ...sana(), lineas: ok([linea(0, { fecha: null, clase: null }), linea(1, { fecha: '2026-02-30' }), linea(2, { clase: 2.5 }), linea(3)]) };
  it('fecha nula o imposible (30 de febrero) cuenta como vacía', () => {
    expect(fila(e, 'cruce_sin_fecha')).toMatchObject({ estado: 'faltan', casos: 2, detalle: '2 de 4 cruces' });
  });
  it('clase nula o no entera cuenta como desconocida', () => {
    expect(fila(e, 'cruce_sin_clase')).toMatchObject({ estado: 'faltan', casos: 2, detalle: '2 de 4 cruces' });
  });
  it('el ejemplo sin TAG ni caseta cae al renglón, sin datos del cliente', () => {
    const solo = { ...sana(), lineas: ok([linea(6, { fecha: null, tag: null, caseta: null })]) };
    expect(fila(solo, 'cruce_sin_fecha').ejemplo).toBe('renglón 7');
  });
});

describe('estados vacío y no medible', () => {
  it('sin archivos de desglose: las seis filas de cruces dicen «sin datos» y las del catálogo se miden igual', () => {
    const r = calcularDatosFaltantes({ ...sana(), lineas: ok([]) }, 0);
    for (const id of ['tag_sin_unidad', 'tag_dos_economicos', 'cruce_sin_tarifa', 'cruce_sin_fecha', 'cruce_sin_clase'] as const) {
      expect(r.filas.find((f) => f.id === id)).toMatchObject({ estado: 'sin_datos', casos: null, falta: 'los archivos de desglose recibidos' });
    }
    expect(r.filas.find((f) => f.id === 'caseta_sin_coordenadas')!.estado).toBe('completo');
  });
  it('si los renglones no se pudieron leer, ninguna fila de cruces es cero', () => {
    const r = calcularDatosFaltantes({ ...sana(), lineas: falla('los renglones de los archivos de desglose') }, 0);
    const deCruces = r.filas.filter((f) => ['tag_sin_unidad', 'tag_dos_economicos', 'cruce_sin_tarifa', 'cruce_sin_fecha', 'cruce_sin_clase'].includes(f.id));
    expect(deCruces).toHaveLength(5);
    for (const f of deCruces) expect(f).toMatchObject({ estado: 'no_medible', casos: null, falta: 'los renglones de los archivos de desglose' });
  });
  it('ninguna fila sin medir lleva un número', () => {
    const r = calcularDatosFaltantes({ tags: falla('t'), casetas: falla('c'), tarifas: falla('r'), lineas: falla('l') }, 0);
    for (const f of r.filas) expect(f).toMatchObject({ estado: 'no_medible', casos: null, ejemplo: null });
  });
  it('cada fila lleva su texto fijo de «qué hace falta»', () => {
    for (const f of calcularDatosFaltantes(sana(), 0).filas) expect(f.resolver.length).toBeGreaterThan(20);
  });
});

describe('leerDatosFaltantes: compone lectores y no vuelve vacía una fuente caída', () => {
  const lectores = (sobre: Partial<Parameters<typeof leerDatosFaltantes>[2]> = {}) => ({
    listarTags: async () => [tag('TAG-0001', 'u-1', 'T-10')],
    listarCasetas: async () => [caseta('caseta norte')],
    listarTarifas: async () => [tarifa('caseta norte', 5)],
    lineasDeDesglose: async (_t: string, d: string) => [{ indice: d === 'd1' ? 0 : 1, fecha: '2026-10-05', caseta: 'caseta norte', tag: 'TAG-0001', monto: 10, clase: 5, unidad_archivo: 'T-10', unidad_id: 'u-1' }],
    ...sobre,
  });

  it('junta los renglones de todos los archivos y cuenta los archivos', async () => {
    const r = await leerDatosFaltantes('t1', ['d1', 'd2'], lectores());
    expect(r.archivos).toBe(2);
    expect(r.filas.find((f) => f.id === 'cruce_sin_fecha')).toMatchObject({ estado: 'completo' });
    expect(r.filas.every((f) => f.estado === 'completo')).toBe(true);
  });
  it('un archivo que falla deja los cruces «no medibles», no a medias', async () => {
    const r = await leerDatosFaltantes('t1', ['d1', 'd2'], lectores({ lineasDeDesglose: async (_t, d) => { if (d === 'd2') throw new Error('timeout'); return []; } }));
    expect(r.filas.find((f) => f.id === 'cruce_sin_clase')).toMatchObject({ estado: 'no_medible', casos: null });
    expect(r.filas.find((f) => f.id === 'caseta_sin_coordenadas')!.estado).toBe('completo');
  });
  it('lista de archivos ilegible (null): cruces no medibles', async () => {
    const r = await leerDatosFaltantes('t1', null, lectores());
    expect(r.filas.find((f) => f.id === 'tag_sin_unidad')).toMatchObject({ estado: 'no_medible', falta: 'la lista de archivos de desglose' });
  });
  it('el catálogo de TAGs caído solo apaga su fila', async () => {
    const r = await leerDatosFaltantes('t1', ['d1'], lectores({ listarTags: async () => { throw new Error('boom'); } }));
    expect(r.filas.find((f) => f.id === 'economico_varios_tags')).toMatchObject({ estado: 'no_medible', falta: 'el catálogo de TAGs' });
  });
});
