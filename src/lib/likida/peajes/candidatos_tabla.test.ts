import { describe, it, expect } from 'vitest';
import {
  filasDeCandidatos, normalizarFiltros, filtrosAQuery, tablaDeCandidatos, filasFiltradas, aplicaAccion, validarMotivoAccion,
  TAMANO_PAGINA, claveFila, type DecisionGuardada, type FilaCandidato,
} from './candidatos_tabla';
import type { CandidatoCobro } from './reglas_cobro';
import type { CruceAtipico } from './cruces_atipicos';

const cand = (indice: number, p: Partial<CandidatoCobro> = {}): CandidatoCobro => ({
  indice, categoria: 'clase_fuera_de_3_5', fecha: '2026-03-05', hora: '10:00:00', caseta: 'Plaza Ejemplo Sur', tag: `TAG${indice}`, unidad: 'TC9001',
  clase: 9, monto: 100, quePaso: `pasó ${indice}`, queSignifica: 'significa', queHacer: 'hacer', referencia: 'r', ...p,
});
const atip = (indices: number[], p: Partial<CruceAtipico> = {}): CruceAtipico => ({
  senal: 'repeticion_caseta', unidad: 'TC9002', indices, fecha: '2026-03-06', caseta: 'Caseta Ejemplo Norte', monto: 400, quePaso: 'a', queSignifica: 'b', queHacer: 'c', ...p,
});
const dec = (indice: number, categoria: string, accion: DecisionGuardada['accion'], motivo: string | null = null): DecisionGuardada => ({
  indice, categoria, accion, motivo, actor: 'panel:flota_admin', creadoEn: '2026-03-20T10:00:00Z',
});

describe('filasDeCandidatos', () => {
  it('une candidatos y atípicos, y cada uno trae su estado desde las decisiones', () => {
    const filas = filasDeCandidatos([cand(1), cand(2)], [atip([7, 8, 9])], [dec(1, 'clase_fuera_de_3_5', 'reclamado'), dec(7, 'atipico_repeticion_caseta', 'justificado', 'Ruta autorizada')]);
    expect(filas).toHaveLength(3);
    expect(filas.find((f) => f.indice === 1)?.estado).toBe('reclamado');
    expect(filas.find((f) => f.indice === 2)?.estado).toBe('pendiente');
    const a = filas.find((f) => f.categoria === 'atipico_repeticion_caseta')!;
    expect(a).toMatchObject({ estado: 'justificado', motivo: 'Ruta autorizada', indices: [7, 8, 9], indice: 7 });
  });

  it('una caseta que no debe cruzarse con su justificación vieja se muestra justificada aunque no haya decisión', () => {
    const [f] = filasDeCandidatos([cand(3, { categoria: 'caseta_no_debe_cruzarse', justificacion: 'Salida autorizada' })], [], []);
    expect(f).toMatchObject({ estado: 'justificado', motivo: 'Salida autorizada' });
  });

  it('la decisión es por renglón Y categoría: el mismo renglón en otra categoría sigue pendiente', () => {
    const filas = filasDeCandidatos([cand(4), cand(4, { categoria: 'extemporaneo' })], [], [dec(4, 'extemporaneo', 'descartado', 'ya cobrado')]);
    expect(filas.find((f) => f.categoria === 'clase_fuera_de_3_5')?.estado).toBe('pendiente');
    expect(filas.find((f) => f.categoria === 'extemporaneo')?.estado).toBe('descartado');
  });
});

describe('filtros y orden', () => {
  const filas = filasDeCandidatos([
    cand(1, { monto: 50, unidad: 'TC9001', caseta: 'Plaza Ejemplo Sur', fecha: '2026-03-02' }),
    cand(2, { monto: 300, unidad: 'TC9002', caseta: 'Caseta Ejemplo Norte', fecha: '2026-03-08', categoria: 'extemporaneo' }),
    cand(3, { monto: 300, unidad: 'TC9001', caseta: 'Plaza Ejemplo Sur', fecha: null }),
    cand(4, { monto: 120, unidad: 'TC9003', caseta: 'Plaza Ejemplo Sur', fecha: '2026-03-10' }),
  ], [], [dec(4, 'clase_fuera_de_3_5', 'descartado', 'ya revisado')]);
  const f = (q: Record<string, string>) => normalizarFiltros(q);

  it('por categoría, estado, unidad y caseta (sin distinguir mayúsculas ni acentos de caja)', () => {
    expect(filasFiltradas(filas, f({ cat: 'extemporaneo' })).map((x) => x.indice)).toEqual([2]);
    expect(filasFiltradas(filas, f({ estado: 'descartado' })).map((x) => x.indice)).toEqual([4]);
    expect(filasFiltradas(filas, f({ unidad: 'tc9001' })).map((x) => x.indice).sort()).toEqual([1, 3]);
    expect(filasFiltradas(filas, f({ caseta: 'NORTE' })).map((x) => x.indice)).toEqual([2]);
  });

  it('por fecha: sin fecha no pasa un filtro de fecha, y los extremos cuentan', () => {
    expect(filasFiltradas(filas, f({ desde: '2026-03-02', hasta: '2026-03-08' })).map((x) => x.indice).sort()).toEqual([1, 2]);
    expect(filasFiltradas(filas, f({})).map((x) => x.indice)).toContain(3);
    expect(filasFiltradas(filas, f({ desde: '2026-01-01' })).map((x) => x.indice)).not.toContain(3);
  });

  it('orden por monto (desempate estable por renglón) y por fecha', () => {
    expect(filasFiltradas(filas, f({})).map((x) => x.indice)).toEqual([2, 3, 4, 1]);
    expect(filasFiltradas(filas, f({ orden: 'monto_asc' })).map((x) => x.indice)).toEqual([1, 4, 2, 3]);
    expect(filasFiltradas(filas, f({ orden: 'fecha' })).map((x) => x.indice)).toEqual([1, 2, 4, 3]);
  });

  it('totales de todo lo filtrado, por estado, con dinero redondeado', () => {
    const t = tablaDeCandidatos(filas, f({}));
    expect(t.total).toBe(4);
    expect(t.monto).toBe(770);
    expect(t.porEstado.pendiente).toEqual({ n: 3, monto: 650 });
    expect(t.porEstado.descartado).toEqual({ n: 1, monto: 120 });
    expect(t.porEstado.reclamado).toEqual({ n: 0, monto: 0 });
  });
});

describe('normalizarFiltros: lo que llega por la URL no rompe ni filtra de más', () => {
  it('valores inválidos se ignoran', () => {
    const n = normalizarFiltros({ cat: '<script>', estado: 'borrado', desde: '2026-13', hasta: 'x', orden: 'caos', pag: '-4', unidad: ' TC1 ' });
    expect(n).toEqual({ categoria: '', estado: '', unidad: 'TC1', caseta: '', desde: '', hasta: '', orden: 'monto_desc', pagina: 1 });
  });
  it('texto largo se recorta a 60 y una lista toma el primer valor', () => {
    expect(normalizarFiltros({ caseta: 'x'.repeat(200) }).caseta).toHaveLength(60);
    expect(normalizarFiltros({ cat: ['extemporaneo', 'otro'] }).categoria).toBe('extemporaneo');
  });
  it('ida y vuelta por query string', () => {
    const f = normalizarFiltros({ cat: 'atipico_salto_imposible', estado: 'pendiente', unidad: 'TC9', desde: '2026-03-01', orden: 'fecha', pag: '3' });
    expect(normalizarFiltros(Object.fromEntries(new URLSearchParams(filtrosAQuery(f))))).toEqual(f);
    expect(filtrosAQuery(normalizarFiltros({}))).toBe('');
  });
});

describe('paginación con un archivo de 60 000 líneas: nunca todo al cliente', () => {
  const muchas: FilaCandidato[] = filasDeCandidatos(
    Array.from({ length: 60_000 }, (_, i) => cand(i, { monto: (i % 977) + 1, fecha: '2026-03-05' })), [], []);

  it('una página trae a lo más 50 filas y los totales cubren los 60 000', () => {
    const t = tablaDeCandidatos(muchas, normalizarFiltros({ pag: '2' }));
    expect(t.filas).toHaveLength(TAMANO_PAGINA);
    expect(t.total).toBe(60_000);
    expect(t.paginas).toBe(1200);
    expect(t.pagina).toBe(2);
  });

  it('la paginación es estable: las páginas no se solapan ni se saltan filas, y repetir da lo mismo', () => {
    const vistas = new Set<string>();
    for (let p = 1; p <= 4; p++) {
      const t = tablaDeCandidatos(muchas, normalizarFiltros({ pag: String(p) }));
      for (const fila of t.filas) { expect(vistas.has(fila.clave)).toBe(false); vistas.add(fila.clave); }
    }
    expect(vistas.size).toBe(4 * TAMANO_PAGINA);
    const a = tablaDeCandidatos(muchas, normalizarFiltros({ pag: '3' })).filas.map((x) => x.clave);
    const b = tablaDeCandidatos(muchas, normalizarFiltros({ pag: '3' })).filas.map((x) => x.clave);
    expect(a).toEqual(b);
  });

  it('una página fuera de rango cae en la última, y sin resultados hay una página vacía', () => {
    expect(tablaDeCandidatos(muchas, normalizarFiltros({ pag: '99999' })).pagina).toBe(1200);
    const vacia = tablaDeCandidatos(muchas, normalizarFiltros({ unidad: 'no-existe' }));
    expect(vacia).toMatchObject({ total: 0, paginas: 1, pagina: 1, filas: [] });
  });
});

describe('qué acción aplica a una fila', () => {
  const [pend, sinFecha, atipica] = filasDeCandidatos([cand(1), cand(2, { fecha: null })], [atip([5])], []);
  it('solo lo pendiente se decide', () => {
    const [ya] = filasDeCandidatos([cand(9)], [], [dec(9, 'clase_fuera_de_3_5', 'reclamado')]);
    expect(aplicaAccion(ya!, 'descartado')).toEqual({ ok: false, motivo: 'ya_decidido' });
    expect(aplicaAccion(pend!, 'descartado')).toEqual({ ok: true });
  });
  it('un atípico no se reclama (es un aviso, no un cobro) pero sí se justifica o descarta', () => {
    expect(aplicaAccion(atipica!, 'reclamado')).toEqual({ ok: false, motivo: 'no_reclamable' });
    expect(aplicaAccion(atipica!, 'justificado')).toEqual({ ok: true });
  });
  it('sin fecha no se reclama (no hay de dónde contar el plazo)', () => {
    expect(aplicaAccion(sinFecha!, 'reclamado')).toEqual({ ok: false, motivo: 'sin_fecha' });
  });
  it('claveFila es renglón|categoría', () => { expect(claveFila(3, 'extemporaneo')).toBe('3|extemporaneo'); });
});

describe('el motivo de descartar y justificar', () => {
  it('es obligatorio, de 3 a 300 caracteres; reclamar no lo lleva', () => {
    expect(validarMotivoAccion('descartado', '')).toMatchObject({ ok: false });
    expect(validarMotivoAccion('justificado', '   ')).toMatchObject({ ok: false });
    expect(validarMotivoAccion('descartado', 'ab')).toMatchObject({ ok: false });
    expect(validarMotivoAccion('descartado', 'x'.repeat(301))).toMatchObject({ ok: false });
    expect(validarMotivoAccion('descartado', undefined)).toMatchObject({ ok: false });
    expect(validarMotivoAccion('descartado', '  Ya cobrado antes  ')).toEqual({ ok: true, motivo: 'Ya cobrado antes' });
    expect(validarMotivoAccion('reclamado', 'lo que sea')).toEqual({ ok: true, motivo: null });
  });
});


describe('A37-A2-05: las categorías internas no se reclaman al proveedor', () => {
  it('«caseta que no debe cruzarse» y «unidad inmovilizada» no se pueden marcar como reclamadas (sí descartar o justificar)', () => {
    const filas = filasDeCandidatos([cand(1, { categoria: 'caseta_no_debe_cruzarse' }), cand(2, { categoria: 'unidad_inmovilizada' })], [], []);
    for (const f of filas) {
      expect(aplicaAccion(f, 'reclamado')).toEqual({ ok: false, motivo: 'no_reclamable' });
      expect(aplicaAccion(f, 'justificado')).toEqual({ ok: true });
    }
  });
});
