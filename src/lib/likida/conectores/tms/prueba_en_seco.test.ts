import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PeticionHttp, RespuestaHttp } from '../tipos';

// R7-B1: la prueba en seco lee una muestra acotada, normaliza con el mapeo y reporta POR NOMBRE; no escribe nada y no filtra valores.
const logs: unknown[][] = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => { throw new Error('la prueba en seco no debe tocar la base en estas pruebas'); },
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: (...a: unknown[]) => logs.push(a), warn: (...a: unknown[]) => logs.push(a), error: (...a: unknown[]) => logs.push(a), debug: vi.fn() },
}));

const { analizarMuestra, pruebaEnSecoTms, pruebaEnSecoDeFlota, MAX_FILAS_EN_SECO } = await import('./prueba_en_seco');
const { MAPEO_VIAJES_SUPUESTO } = await import('./viajes');
const { MAPEO_LIQUIDACIONES_SUPUESTO } = await import('./liquidaciones');
type Mapeo = import('./mapeo').MapeoTms;

// Valores CENTINELA: si alguno aparece en el reporte o en los logs, la prueba en seco filtró un dato del origen.
const SENTINELA_TEXTO = 'SENTINELA-TEXTO-9137';
const SENTINELA_NUMERO = '9137,5abc';

const VALORES = { base_url: 'https://tms.ejemplo.test', usuario: 'usuario-seco', clave: 'clave-seca-7731' };
const viaje = (i: number, extra: Record<string, unknown> = {}) => ({
  Icident: `SINT-${i}`, unidad: `U${i}`, 'Fecha Salida': '2026-11-05 08:00:00', 'Fecha Llegada': '2026-11-05 18:00:00',
  origen: 'A', destino: 'B', estatus: 'cerrado', operador: 'Operador Sintético', ...extra,
});

interface Origen { http: (p: PeticionHttp) => Promise<RespuestaHttp>; peticiones: PeticionHttp[] }
function origen(tablas: Record<string, unknown>, opciones: { loginMalo?: boolean } = {}): Origen {
  const peticiones: PeticionHttp[] = [];
  const json = (estado: number, c: unknown): RespuestaHttp => ({ estado, encabezados: { 'content-type': 'application/json' }, cuerpo: JSON.stringify(c) });
  return {
    peticiones,
    http: async (p) => {
      peticiones.push(p);
      const u = new URL(p.url);
      if (u.pathname === '/api/login') return opciones.loginMalo ? json(401, {}) : json(200, { token: 'tok-seco-1' });
      if (p.metodo !== 'GET' && p.metodo !== 'POST') throw new Error('método inesperado');
      return u.pathname in tablas ? json(200, tablas[u.pathname]) : json(404, {});
    },
  };
}
const pagina = (items: unknown[]) => ({ data: { items } });
const soloViajes = { viajes: MAPEO_VIAJES_SUPUESTO as unknown };

beforeEach(() => { logs.length = 0; });

describe('analizarMuestra (pura)', () => {
  it('muestra sana: limpia, con conteos', () => {
    const r = analizarMuestra('viajes', MAPEO_VIAJES_SUPUESTO, pagina([viaje(1), viaje(2)]));
    expect(r).toMatchObject({ estado: 'limpio', filasLeidas: 2, filasMapeables: 2, filasRechazadas: 0, faltantesRequeridos: [], tiposQueNoCuadran: [] });
  });
  it('campo requerido ausente: lo dice POR NOMBRE (destino y fuente) y cuenta las filas', () => {
    const sinUnidad = (i: number) => { const v = viaje(i) as Record<string, unknown>; delete v.unidad; return v; };
    const r = analizarMuestra('viajes', MAPEO_VIAJES_SUPUESTO, pagina([viaje(1), sinUnidad(2), sinUnidad(3)]));
    expect(r.estado).toBe('con_hallazgos');
    expect(r.faltantesRequeridos).toEqual([{ campo: 'unidadEco', fuente: 'unidad', filas: 2 }]);
    expect(r.filasMapeables).toBe(1);
    expect(r.filasRechazadas).toBe(2);
  });
  it('un campo opcional ausente se reporta aparte y no ensucia el veredicto', () => {
    const sinDestino = viaje(1) as Record<string, unknown>; delete sinDestino.destino;
    const r = analizarMuestra('viajes', MAPEO_VIAJES_SUPUESTO, pagina([sinDestino]));
    expect(r.estado).toBe('limpio');
    expect(r.opcionalesAusentes).toEqual([{ campo: 'destino', fuente: 'destino', filas: 1 }]);
  });
  it('campos extra de la respuesta se ignoran: se listan por nombre, sin efecto en el veredicto', () => {
    const r = analizarMuestra('viajes', MAPEO_VIAJES_SUPUESTO, pagina([viaje(1, { campo_nuevo: 'x', otro: 1 }), viaje(2, { campo_nuevo: 'y' })]));
    expect(r.estado).toBe('limpio');
    expect(r.camposDesconocidos).toEqual([{ campo: 'campo_nuevo', filas: 2 }, { campo: 'otro', filas: 1 }]);
    expect(r.filasMapeables).toBe(2);
  });
  it('tipos que no cuadran: fecha que no sigue el formato, booleano raro; solo el TIPO observado, nunca el valor', () => {
    const r = analizarMuestra('viajes', MAPEO_VIAJES_SUPUESTO, pagina([viaje(1, { 'Fecha Salida': SENTINELA_TEXTO })]));
    expect(r.estado).toBe('con_hallazgos');
    expect(r.tiposQueNoCuadran).toEqual([{ campo: 'salida_en', fuente: 'Fecha Salida', esperado: 'fecha_local', recibido: 'texto', filas: 1 }]);
    expect(JSON.stringify(r)).not.toContain(SENTINELA_TEXTO);
  });
  it('B2 · importes como texto: ambiguo («1.234» y «1,234») se marca; con decimal declarado se acepta; no numérico es tipo que no cuadra', () => {
    const nomina = MAPEO_LIQUIDACIONES_SUPUESTO.nomina;
    const fila = (cargo: unknown) => ({ ID: 1, Poliza: 'P1', Bitacora: 'B1', OperadorID: 1, ConceptoID: 1, Cargo: cargo, Abono: 0, Desglose: '', FechaInicio: '2026-11-01 00:00:00', FechaFin: '2026-11-02 00:00:00' });
    expect(analizarMuestra('n', nomina, pagina([fila('1.234')])).tiposQueNoCuadran).toEqual([
      expect.objectContaining({ campo: 'cargo', esperado: 'numero', recibido: 'texto', ambiguo: true, filas: 1 })]);
    expect(analizarMuestra('n', nomina, pagina([fila('1,234')])).tiposQueNoCuadran[0]).toMatchObject({ campo: 'cargo', ambiguo: true });
    const noNumerico = analizarMuestra('n', nomina, pagina([fila(SENTINELA_NUMERO)]));
    expect(noNumerico.tiposQueNoCuadran[0]).toMatchObject({ campo: 'cargo', recibido: 'texto' });
    expect(noNumerico.tiposQueNoCuadran[0]).not.toHaveProperty('ambiguo');
    expect(JSON.stringify(noNumerico)).not.toContain('9137');
    // declarado en el mapeo: la misma muestra pasa
    const declarado = { ...nomina, campos: { ...nomina.campos, cargo: { fuente: 'Cargo', transformar: 'numero', decimal: '.' } } } as Mapeo;
    expect(analizarMuestra('n', declarado, pagina([fila('1.234')])).estado).toBe('limpio');
    const coma = { ...nomina, campos: { ...nomina.campos, cargo: { fuente: 'Cargo', transformar: 'numero', decimal: ',' } } } as Mapeo;
    expect(analizarMuestra('n', coma, pagina([fila('1,234')])).estado).toBe('limpio');
  });
  it('acota la muestra a maxFilas (nunca más de 20)', () => {
    const muchas = Array.from({ length: 80 }, (_, i) => viaje(i));
    expect(analizarMuestra('viajes', MAPEO_VIAJES_SUPUESTO, pagina(muchas)).filasLeidas).toBe(MAX_FILAS_EN_SECO);
    expect(analizarMuestra('viajes', MAPEO_VIAJES_SUPUESTO, pagina(muchas), 5).filasLeidas).toBe(5);
  });
  it('clave repetida dentro de la muestra se cuenta', () => {
    const r = analizarMuestra('viajes', MAPEO_VIAJES_SUPUESTO, pagina([viaje(1), viaje(1)]));
    expect(r.clavesRepetidas).toBe(1);
    expect(r.estado).toBe('con_hallazgos');
  });
  it('raíz ausente, no-lista, muestra vacía y mapeo inválido: error/hallazgo con frase propia', () => {
    expect(analizarMuestra('v', MAPEO_VIAJES_SUPUESTO, { otro: [] })).toMatchObject({ estado: 'error', error: expect.stringContaining('data.items') });
    expect(analizarMuestra('v', MAPEO_VIAJES_SUPUESTO, { data: { items: 'x' } }).estado).toBe('error');
    expect(analizarMuestra('v', MAPEO_VIAJES_SUPUESTO, pagina([]))).toMatchObject({ estado: 'con_hallazgos', filasLeidas: 0 });
    expect(analizarMuestra('v', { ...MAPEO_VIAJES_SUPUESTO, ruta: 'sin-barra' } as Mapeo, pagina([viaje(1)])).estado).toBe('error');
  });
  it('filas que no son objetos no rompen la prueba', () => {
    const r = analizarMuestra('viajes', MAPEO_VIAJES_SUPUESTO, pagina([viaje(1), 'texto', null, [1]]));
    expect(r.estado).toBe('con_hallazgos');
    expect(r.filasLeidas).toBe(4);
  });
});

describe('pruebaEnSecoTms', () => {
  it('pide UNA página de a lo más 20 registros, solo lee y deja el reporte limpio', async () => {
    const o = origen({ '/api/viajes': pagina(Array.from({ length: 50 }, (_, i) => viaje(i))) });
    const r = await pruebaEnSecoTms({ valores: VALORES, mapeos: soloViajes, http: o.http, ahora: () => Date.parse('2026-11-06T12:00:00Z'), maxFilas: 500 });
    expect(r).toMatchObject({ accesoOk: true, limpio: true, maxFilas: 20 });
    expect(r.mapeos.find((m) => m.mapeo === 'viajes')).toMatchObject({ estado: 'limpio', filasLeidas: 20 });
    const datos = o.peticiones.filter((p) => !p.url.endsWith('/api/login'));
    expect(datos).toHaveLength(1); // sin paginar
    const q = new URL(datos[0].url).searchParams;
    expect(q.get('tam')).toBe('20');
    expect(q.get('pagina')).toBe('1');
    expect(new Date(q.get('hasta')!).getTime() - new Date(q.get('desde')!).getTime()).toBe(2 * 86_400_000);
    // solo lectura: ninguna petición de datos con otro método que el del mapeo (GET) y la base no se tocó (el mock lanzaría)
    expect(datos.every((p) => p.metodo === 'GET')).toBe(true);
    expect(r.mapeos.filter((m) => m.estado === 'sin_mapeo').map((m) => m.mapeo)).toEqual(['liquidaciones', 'peajes', 'posiciones']);
  });
  it('liquidaciones: los tres sub-mapeos se prueban por separado', async () => {
    const o = origen({
      '/api/nomina-bitacora': pagina([{ ID: 1, Poliza: 'P1', Bitacora: 'B1', OperadorID: 1, ConceptoID: 1, Cargo: 100, Abono: 0, Desglose: '', FechaInicio: '2026-11-01 00:00:00', FechaFin: '2026-11-02 00:00:00' }]),
      '/api/operadores': pagina([{ ID: 1, NumeroEmpleado: 'E1', Telefono: '5500000000' }]),
      '/api/conceptos-nomina': pagina([{ ID: 1, Clave: 'C1', Descripcion: 'Sueldo', Oculto: 'no' }]),
    });
    const r = await pruebaEnSecoTms({ valores: VALORES, mapeos: { liquidaciones: MAPEO_LIQUIDACIONES_SUPUESTO }, http: o.http });
    expect(r.mapeos.filter((m) => m.mapeo.startsWith('liquidaciones.')).map((m) => [m.mapeo, m.estado])).toEqual([
      ['liquidaciones.nomina', 'limpio'], ['liquidaciones.operadores', 'limpio'], ['liquidaciones.conceptos', 'limpio']]);
    expect(r.limpio).toBe(true);
  });
  it('un recurso sin ruta (404) o con JSON malo es error de ESE mapeo y los demás siguen', async () => {
    const o = origen({ '/api/viajes': pagina([viaje(1)]) });
    const r = await pruebaEnSecoTms({
      valores: VALORES, http: o.http,
      mapeos: { viajes: MAPEO_VIAJES_SUPUESTO, peajes: { ...MAPEO_VIAJES_SUPUESTO, recurso: 'peajes', ruta: '/api/peajes-no-existe' } },
    });
    expect(r.mapeos.find((m) => m.mapeo === 'viajes')?.estado).toBe('limpio');
    expect(r.mapeos.find((m) => m.mapeo === 'peajes')).toMatchObject({ estado: 'error', error: expect.stringContaining('404') });
    expect(r.limpio).toBe(false);
  });
  it('credencial rechazada: accesoOk=false, los siguientes mapeos no se intentan y la clave no aparece', async () => {
    const o = origen({}, { loginMalo: true });
    const r = await pruebaEnSecoTms({ valores: VALORES, mapeos: { viajes: MAPEO_VIAJES_SUPUESTO, posiciones: MAPEO_VIAJES_SUPUESTO }, http: o.http });
    expect(r.accesoOk).toBe(false);
    expect(r.limpio).toBe(false);
    expect(o.peticiones.filter((p) => p.url.endsWith('/api/login'))).toHaveLength(1);
    expect(JSON.stringify(r)).not.toMatch(/clave-seca|usuario-seco/);
  });
  it('dirección no https: no llama a nadie', async () => {
    const o = origen({});
    const r = await pruebaEnSecoTms({ valores: { ...VALORES, base_url: 'http://tms.ejemplo.test' }, mapeos: soloViajes, http: o.http });
    expect(r).toMatchObject({ accesoOk: false, peticiones: 0 });
    expect(o.peticiones).toHaveLength(0);
  });
  it('sin ningún mapeo no hay nada que declarar limpio', async () => {
    const r = await pruebaEnSecoTms({ valores: VALORES, mapeos: {}, http: origen({}).http });
    expect(r.limpio).toBe(false);
  });
  it('NO filtra valores del origen: ni en el reporte ni en los logs, aunque haya filas malas', async () => {
    const o = origen({ '/api/viajes': pagina([viaje(1, { 'Fecha Salida': SENTINELA_TEXTO, operador: SENTINELA_TEXTO, extra_SENTINELA: SENTINELA_TEXTO }), viaje(2)]) });
    const r = await pruebaEnSecoTms({ valores: VALORES, mapeos: soloViajes, http: o.http });
    const todo = JSON.stringify([r, logs]);
    expect(todo).not.toContain(SENTINELA_TEXTO);
    expect(todo).not.toMatch(/tok-seco|clave-seca|usuario-seco|Operador Sintético/);
    // pero los NOMBRES de campo sí están: es lo que sirve para corregir el mapeo
    expect(todo).toContain('salida_en');
    expect(todo).toContain('extra_SENTINELA');
  });
});

describe('pruebaEnSecoDeFlota', () => {
  it('sin credencial activa: no llama a nadie y lo dice', async () => {
    const o = origen({});
    const r = await pruebaEnSecoDeFlota('t1', { http: o.http }, { credencial: async () => null, mapeosActivos: async () => soloViajes });
    expect(r).toMatchObject({ accesoOk: false, peticiones: 0 });
    expect(r.error).toMatch(/credencial/);
    expect(o.peticiones).toHaveLength(0);
  });
  it('usa la credencial y el mapeo ACTIVO de la flota pedida (el tenant es el argumento, nunca algo de los datos)', async () => {
    const o = origen({ '/api/viajes': pagina([viaje(1)]) });
    const credencial = vi.fn(async () => VALORES);
    const mapeosActivos = vi.fn(async () => soloViajes);
    const r = await pruebaEnSecoDeFlota('t-7', { http: o.http }, { credencial, mapeosActivos });
    expect(credencial).toHaveBeenCalledWith('t-7');
    expect(mapeosActivos).toHaveBeenCalledWith('t-7');
    expect(r.limpio).toBe(true);
  });
  it('un borrador de mapeos se prueba sin leer ni tocar el activo', async () => {
    const o = origen({ '/api/viajes': pagina([viaje(1)]) });
    const mapeosActivos = vi.fn(async () => ({}));
    const r = await pruebaEnSecoDeFlota('t1', { http: o.http, borrador: soloViajes }, { credencial: async () => VALORES, mapeosActivos });
    expect(mapeosActivos).not.toHaveBeenCalled();
    expect(r.limpio).toBe(true);
  });
});

describe('R7-B1 · desgloses por bitácora (la lectura del pull de liquidaciones-externas)', () => {
  const AHORA = Date.parse('2026-10-15T18:00:00.000Z');
  const dia = (n: number) => `2026-10-14T${String(8 + (n % 10)).padStart(2, '0')}:00:00.000Z`;
  const fila = (n: number, extra: Record<string, unknown> = {}) => ({
    bitacora: `B-${n}`, poliza: `P-${n}`, terminal: 'T1', operador_numero: 'E-1', operador: 'Operador Sintético', unidad: '526', tipo_operador: 'foraneo',
    de: dia(n), a: '2026-10-14T20:00:00.000Z', dias: 6, enviado: false,
    percepciones: [{ desglose: 'Sueldo', concepto: 'SUELDO', valor: 4000 }], deducciones: [{ desglose: 'Anticipo', concepto: 'ANTICIPO', valor: 1000 }],
    ...extra,
  });
  const lista = (items: unknown[]) => ({ data: { items, total_paginas: 1 } });
  const correr = (items: unknown[], extra: Partial<Parameters<typeof pruebaEnSecoTms>[0]> = {}) => {
    const o = origen({ '/api/liquidaciones': lista(items) });
    return pruebaEnSecoTms({ valores: VALORES, mapeos: {}, http: o.http, ahora: () => AHORA, desgloses: true, ...extra }).then((r) => ({ r, o }));
  };

  it('muestra sana: una página de ≤20, limpia', async () => {
    const { r, o } = await correr(Array.from({ length: 40 }, (_, i) => fila(i)));
    const d = r.mapeos.find((m) => m.mapeo === 'desgloses')!;
    expect(d).toMatchObject({ estado: 'limpio', filasLeidas: 20, filasMapeables: 20, filasRechazadas: 0, camposInvalidos: [] });
    expect(r.limpio).toBe(true);
    const datos = o.peticiones.filter((p) => !p.url.endsWith('/api/login'));
    expect(datos).toHaveLength(1);
    expect(new URL(datos[0].url).searchParams.get('tam')).toBe('20');
    expect(new URL(datos[0].url).searchParams.get('pagina')).toBe('1');
  });

  it('sin póliza NO es un hallazgo (la guarda sin_poliza la resuelve después); campos extra se listan por nombre', async () => {
    const { r } = await correr([fila(1, { poliza: null, campo_nuevo: 'x' })]);
    const d = r.mapeos.find((m) => m.mapeo === 'desgloses')!;
    expect(d.estado).toBe('limpio');
    expect(d.camposDesconocidos).toEqual([{ campo: 'campo_nuevo', filas: 1 }]);
  });

  it('un campo que el mapeo no puede leer se nombra (sin valores); fecha de cursor ilegible también', async () => {
    const malas = [
      fila(1, { operador_numero: null }), fila(2, { operador_numero: undefined }), fila(3, { de: SENTINELA_TEXTO }),
    ];
    const { r } = await correr(malas);
    const d = r.mapeos.find((m) => m.mapeo === 'desgloses')!;
    expect(d.estado).toBe('con_hallazgos');
    expect(d.filasLeidas).toBe(3);
    expect(d.filasRechazadas).toBe(3);
    const nombres = d.camposInvalidos.map((c) => c.campo);
    expect(nombres).toContain('desde'); // la fecha ilegible: se nombra el campo del contrato (`desde`), no su valor
    expect(nombres).toContain('numeroEmpleado');
    expect(JSON.stringify([r, logs])).not.toContain(SENTINELA_TEXTO);
    expect(r.limpio).toBe(false);
  });

  it('una raíz de lista distinta se dice por nombre', async () => {
    const o = origen({ '/api/liquidaciones': { otra: [] } });
    const r = await pruebaEnSecoTms({ valores: VALORES, mapeos: {}, http: o.http, ahora: () => AHORA, desgloses: true });
    expect(r.mapeos.find((m) => m.mapeo === 'desgloses')).toMatchObject({ estado: 'error', error: expect.stringContaining('data.items') });
  });

  it('desgloses=false (por omisión) no hace esa petición', async () => {
    const o = origen({ '/api/liquidaciones': lista([fila(1)]) });
    await pruebaEnSecoTms({ valores: VALORES, mapeos: {}, http: o.http, ahora: () => AHORA });
    expect(o.peticiones.some((p) => p.url.includes('/api/liquidaciones'))).toBe(false);
  });
});
