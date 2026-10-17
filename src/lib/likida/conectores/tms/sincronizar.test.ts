import { beforeEach, describe, expect, it, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// T-TMS-12 — el sincronizador. Todo sintético: unidades, Icident, folios, montos y fechas inventados. Ninguna
// prueba duerme de verdad (el reloj es inyectado) y NINGUNA llama a la red: el origen es una función `Http`.
// La base se simula en memoria en las pruebas del núcleo; las dependencias REALES (puertas y consultas) se
// prueban aparte, con los módulos de los agentes sustituidos.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const alertarOperador = vi.fn(async (..._a: unknown[]) => true);
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: (...a: unknown[]) => alertarOperador(...a) }));
vi.mock('../../presupuesto', async (orig) => ({ ...(await orig<Record<string, unknown>>()), acotada: (q: unknown) => q }));

const leerCredencial = vi.fn();
const marcarProbada = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('../credenciales', () => ({ leerCredencial: (...a: unknown[]) => leerCredencial(...a), marcarProbada: (...a: unknown[]) => marcarProbada(...a) }));

const importarViajes = vi.fn();
vi.mock('../../importar_viajes', async (orig) => ({ ...(await orig<Record<string, unknown>>()), importarViajes: (...a: unknown[]) => importarViajes(...a) }));
const buscarPorClave = vi.fn();
vi.mock('../../liquidacion_externa/repo', async (orig) => ({ ...(await orig<Record<string, unknown>>()), buscarPorClave: (...a: unknown[]) => buscarPorClave(...a) }));
const recibirLiquidacionExterna = vi.fn();
vi.mock('../../liquidacion_externa/servicio', () => ({ recibirLiquidacionExterna: (...a: unknown[]) => recibirLiquidacionExterna(...a) }));
const recibirArchivoPeaje = vi.fn();
vi.mock('../../peajes/ingesta', () => ({ recibirArchivoPeaje: (...a: unknown[]) => recibirArchivoPeaje(...a) }));
const asentarPosicionesTms = vi.fn();
vi.mock('./posiciones', async (orig) => ({ ...(await orig<Record<string, unknown>>()), asentarPosicionesTms: (...a: unknown[]) => asentarPosicionesTms(...a) }));

// Una "base" mínima encadenable para las consultas reales (select/eq/is/not/in/maybeSingle/upsert).
interface Fila { [k: string]: unknown }
const tablas: Record<string, Fila[]> = {};
const upserts: Array<{ tabla: string; filas: unknown; opciones: unknown }> = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const filtros: Array<(f: Fila) => boolean> = [];
      let modoUpsert: unknown;
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => { filtros.push((f) => f[c] === v); return q; },
        is: (c: string, v: unknown) => { filtros.push((f) => (v === null ? f[c] === null || f[c] === undefined : f[c] === v)); return q; },
        not: (c: string, op: string, v: unknown) => { filtros.push((f) => !(op === 'is' && v === null ? f[c] === null || f[c] === undefined : f[c] === v)); return q; },
        in: (c: string, vs: unknown[]) => { filtros.push((f) => vs.includes(f[c])); return q; },
        maybeSingle: () => { modoUpsert = 'single'; return q; },
        upsert: (filas: unknown, opciones: unknown) => { upserts.push({ tabla, filas, opciones }); modoUpsert = 'upsert'; return q; },
        then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => {
          if (modoUpsert === 'upsert') return Promise.resolve({ data: null, error: null }).then(res, rej);
          const filas = (tablas[tabla] ?? []).filter((f) => filtros.every((p) => p(f)));
          return Promise.resolve({ data: modoUpsert === 'single' ? (filas[0] ?? null) : filas, error: null }).then(res, rej);
        },
      };
      return q;
    },
  }),
}));

import { parsearArchivoDesglose } from '../../intake/desglose_peaje';
import type { Http } from '../tipos';
import { generarDatos } from './falso/datos';
import { MAPEO_LIQUIDACIONES_SUPUESTO, type LiquidacionTms } from './liquidaciones';
import { MAPEO_PEAJES_SUPUESTO, type FilaPeajeTms } from './peajes';
import { MAPEO_POSICIONES_SUPUESTO } from './posiciones';
import { MAPEO_VIAJES_SUPUESTO, type FilaViajeTms } from './viajes';
import {
  CAPACIDAD_QUE_EJECUTA, depsReales, entregasReales, sincronizarTms,
  type DepsSincronizacion, type EstadoSync, type FlotaTms, type RecursoSincronizable, type ResultadoEntrega,
} from './sincronizar';

const T0 = Date.parse('2026-10-15T12:00:00.000Z');
const TENANT = 'flota-sintetica-1';
const VALORES = { base_url: 'https://tms.ejemplo.test', usuario: 'usuario-sintetico', clave: 'clave-sintetica' };
const MAPEOS = {
  liquidaciones: MAPEO_LIQUIDACIONES_SUPUESTO, peajes: MAPEO_PEAJES_SUPUESTO, viajes: MAPEO_VIAJES_SUPUESTO, posiciones: MAPEO_POSICIONES_SUPUESTO,
};
const flotaCompleta = (): FlotaTms => ({ tenantId: TENANT, valores: { ...VALORES }, mapeos: { ...MAPEOS } });

// ── Datos sintéticos del origen ─────────────────────────────────────────────

type Cruda = Record<string, unknown>;
interface Origen { viajes: Cruda[]; peajes: Cruda[]; posiciones: Cruda[]; nomina: Cruda[]; operadores: Cruda[]; conceptos: Cruda[] }

const dia = (n: number): string => `2026-10-${String(1 + (n % 14)).padStart(2, '0')} 08:${String(n % 60).padStart(2, '0')}:09`;

function origenSintetico(c: { viajes?: number; peajes?: number; posiciones?: number; liquidaciones?: number } = {}): Origen {
  const nViajes = c.viajes ?? 10; const nPeajes = c.peajes ?? 15; const nPos = c.posiciones ?? 100; const nLiq = c.liquidaciones ?? 20;
  const viajes = Array.from({ length: nViajes }, (_, i) => ({
    Icident: `IC-${String(i + 1).padStart(4, '0')}`, unidad: `UNI-${100 + (i % 5)}`, 'Fecha Salida': dia(i), 'Fecha Llegada': `2026-10-15 09:${String(i % 60).padStart(2, '0')}:00`,
    origen: 'Patio Sintético', destino: 'Destino Sintético', estatus: 'Activo',
  }));
  const peajes = Array.from({ length: nPeajes }, (_, i) => ({
    TAG: `TAG-${String(i + 1).padStart(4, '0')}`, Unidad: `UNI-${100 + (i % 5)}`, Caseta: `Caseta Sintética ${1 + (i % 3)}`, Clase: 'T3', Importe: '189.50', Fecha: dia(i + 20), Icident: viajes[i % Math.max(1, nViajes)]?.Icident,
  }));
  const posiciones = Array.from({ length: nPos }, (_, i) => ({
    Icident: viajes[i % Math.max(1, nViajes)]?.Icident, unidad: `UNI-${100 + (i % 5)}`, latitud: 19.4 + (i % 100) / 1000, longitud: -99.1 - (i % 100) / 1000,
    fecha: `2026-10-15 ${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00`, velocidad: 60, rumbo: 90,
  }));
  const datos = generarDatos({ semilla: 7, n: nLiq });
  const nomina: Cruda[] = []; const operadores: Cruda[] = []; const ids = new Map<string, number>();
  const conceptoId = (nombre: string): number => { if (!ids.has(nombre)) ids.set(nombre, ids.size + 1); return ids.get(nombre) as number; };
  let id = 1;
  datos.liquidaciones.forEach((l, i) => {
    const op = 100 + i;
    operadores.push({ ID: op, NumeroEmpleado: `E-${String(op).padStart(4, '0')}` });
    const comunes = { Poliza: `P${l.bitacora}`, Bitacora: l.bitacora, OperadorID: op, FechaInicio: `${l.de.slice(0, 10)} 00:00:00`, FechaFin: `${l.a.slice(0, 10)} 23:59:59` };
    for (const r of l.percepciones) nomina.push({ ID: id++, ...comunes, ConceptoID: conceptoId(r.concepto), Cargo: r.valor, Abono: 0 });
    for (const r of l.deducciones) nomina.push({ ID: id++, ...comunes, ConceptoID: conceptoId(r.concepto), Cargo: 0, Abono: r.valor });
  });
  const conceptos = [...ids].map(([descripcion, ID]) => ({ ID, Clave: `C${String(ID).padStart(3, '0')}`, Descripcion: descripcion, Oculto: 'no' }));
  return { viajes, peajes, posiciones, nomina, operadores, conceptos };
}

interface OpcionesOrigen { tam?: number; avanzarMs?: number; loginMalo?: boolean; fallaPeajes?: boolean; primerTokenVencido?: boolean }

/** Un origen `Http` que cuenta lo que le piden. Con `avanzarMs` mueve el reloj de la prueba por cada petición de datos. */
function crearOrigen(datos: Origen, reloj: { t: number }, op: OpcionesOrigen = {}) {
  const rutas = new Map<string, number>(); let logins = 0; let datosPedidos = 0; let primeraRespondida = false;
  const http: Http = async (pet) => {
    const u = new URL(pet.url);
    if (u.pathname === '/api/login') {
      logins += 1;
      if (op.loginMalo) return { estado: 401, encabezados: {}, cuerpo: '{"error":"no"}' };
      return { estado: 200, encabezados: {}, cuerpo: JSON.stringify({ token: `tok-${logins}` }) };
    }
    datosPedidos += 1; rutas.set(u.pathname, (rutas.get(u.pathname) ?? 0) + 1);
    if (op.avanzarMs) reloj.t += op.avanzarMs;
    if (op.primerTokenVencido && !primeraRespondida) { primeraRespondida = true; return { estado: 401, encabezados: {}, cuerpo: '{}' }; }
    if (op.fallaPeajes && u.pathname === '/api/peajes') return { estado: 503, encabezados: {}, cuerpo: '{}' };
    const tabla = ({
      '/api/viajes': datos.viajes, '/api/peajes': datos.peajes, '/api/posiciones': datos.posiciones,
      '/api/nomina-bitacora': datos.nomina, '/api/operadores': datos.operadores, '/api/conceptos-nomina': datos.conceptos,
    } as Record<string, Cruda[]>)[u.pathname];
    if (!tabla) return { estado: 404, encabezados: {}, cuerpo: '{}' };
    const tam = op.tam ?? Number(u.searchParams.get('tam') ?? 100);
    const pagina = Number(u.searchParams.get('pagina') ?? 1);
    return { estado: 200, encabezados: {}, cuerpo: JSON.stringify({ data: { items: tabla.slice((pagina - 1) * tam, pagina * tam) } }) };
  };
  return { http, rutas, get logins() { return logins; }, get datosPedidos() { return datosPedidos; } };
}

// ── Dependencias en memoria ─────────────────────────────────────────────────

interface Mundo {
  deps: DepsSincronizacion;
  reloj: { t: number };
  estados: Map<string, EstadoSync>;
  huellas: Map<string, string>;
  viajesEntregados: string[];
  liquidacionesEntregadas: string[];
  peajesEntregados: string[];
  posicionesVistas: Set<string>;
  degradaciones: string[];
  fallaEntregaViajes: { activa: boolean };
}

function crearMundo(flotas: () => FlotaTms[], origen: ReturnType<typeof crearOrigen>, reloj: { t: number }): Mundo {
  const estados = new Map<string, EstadoSync>(); const huellas = new Map<string, string>();
  const m: Mundo = {
    reloj, estados, huellas, viajesEntregados: [], liquidacionesEntregadas: [], peajesEntregados: [], posicionesVistas: new Set(), degradaciones: [],
    fallaEntregaViajes: { activa: false },
    deps: undefined as unknown as DepsSincronizacion,
  };
  const k = (t: string, r: string, c?: string) => `${t}|${r}${c === undefined ? '' : `|${c}`}`;
  const ok = (hechas: string[]): ResultadoEntrega => ({ hechas, pendientes: 0 });
  m.deps = {
    ahora: () => reloj.t,
    http: origen.http,
    dormir: async () => undefined,
    // Igual que la lista real: una flota con la credencial degradada ya no se lista.
    listarFlotas: async () => flotas().filter((f) => !m.degradaciones.includes(f.tenantId)),
    leerEstado: async (t, r) => estados.get(k(t, r)) ?? null,
    guardarEstado: async (t, r, e) => { estados.set(k(t, r), JSON.parse(JSON.stringify(e))); },
    huellasPrevias: async (t, r, claves) => new Map(claves.filter((c) => huellas.has(k(t, r, c))).map((c) => [c, huellas.get(k(t, r, c)) as string])),
    guardarHuellas: async (t, r, filas) => { for (const f of filas) huellas.set(k(t, r, f.clave), f.huella); },
    degradar: async (t) => { m.degradaciones.push(t); },
    entregas: {
      viajes: async (_t, filas) => {
        if (m.fallaEntregaViajes.activa) throw new Error('la base no contestó');
        m.viajesEntregados.push(...filas.map((f) => f.folio));
        return ok(filas.map((f) => f.folio));
      },
      liquidaciones: async (_t, items) => { m.liquidacionesEntregadas.push(...items.map((i) => i.clave)); return ok(items.map((i) => i.clave)); },
      peajes: async (_t, filas) => { m.peajesEntregados.push(...filas.map((f) => f.clave)); return ok(filas.map((f) => f.clave)); },
      posiciones: async (_t, lectura) => {
        let nuevas = 0;
        for (const p of lectura.filas) { const c = `${p.deviceId}|${p.medidaEn}`; if (!m.posicionesVistas.has(c)) { m.posicionesVistas.add(c); nuevas += 1; } }
        return { guardadas: nuevas };
      },
    },
  };
  return m;
}

const nuevoReloj = () => ({ t: T0 });
const rec = (r: Awaited<ReturnType<typeof sincronizarTms>>, recurso: RecursoSincronizable, i = 0) => {
  const x = r.flotas[i].recursos.find((y) => y.recurso === recurso);
  if (!x) throw new Error(`falta ${recurso}`);
  return x;
};

beforeEach(() => {
  alertarOperador.mockClear(); leerCredencial.mockReset(); marcarProbada.mockClear();
  importarViajes.mockReset(); buscarPorClave.mockReset(); recibirLiquidacionExterna.mockReset(); recibirArchivoPeaje.mockReset(); asentarPosicionesTms.mockReset();
  for (const k of Object.keys(tablas)) delete tablas[k];
  upserts.length = 0;
});

describe('la capacidad que ejecuta', () => {
  it('este módulo ejecuta `leer_viajes` y lo hace solo para tms_api_lectura', () => {
    expect(CAPACIDAD_QUE_EJECUTA).toBe('leer_viajes');
  });
});

describe('una corrida completa contra el origen sintético', () => {
  it('lee 20 liquidaciones, 15 peajes, 10 viajes y 100 posiciones y los entrega: conteos exactos', async () => {
    const reloj = nuevoReloj(); const o = crearOrigen(origenSintetico(), reloj);
    const m = crearMundo(() => [flotaCompleta()], o, reloj);
    const r = await sincronizarTms(m.deps);

    expect(r.flotas).toHaveLength(1);
    expect(r.filasPorRecurso).toEqual({ liquidaciones: 20, peajes: 15, viajes: 10, posiciones: 100 });
    expect(rec(r, 'liquidaciones')).toMatchObject({ estado: 'ok', leidas: 20, nuevas: 20, omitidas: 0, entregadas: 20 });
    expect(rec(r, 'viajes')).toMatchObject({ estado: 'ok', leidas: 10, nuevas: 10, entregadas: 10 });
    expect(rec(r, 'peajes')).toMatchObject({ estado: 'ok', leidas: 15, nuevas: 15, entregadas: 15 });
    expect(rec(r, 'posiciones')).toMatchObject({ estado: 'ok', leidas: 100, nuevas: 100 });
    expect(m.liquidacionesEntregadas).toHaveLength(20);
    expect(m.viajesEntregados).toHaveLength(10);
    expect(m.peajesEntregados).toHaveLength(15);
    expect(m.posicionesVistas.size).toBe(100);
    expect(r.conError).toBe(0);
    expect(r.parciales).toBe(0);
    expect(r.peticiones).toBeGreaterThan(0);
  });

  it('deja el avance guardado: `desde` se mueve al `hasta` (menos el solape) y no queda cursor ni error', async () => {
    const reloj = nuevoReloj(); const o = crearOrigen(origenSintetico(), reloj);
    const m = crearMundo(() => [flotaCompleta()], o, reloj);
    await sincronizarTms(m.deps);
    const e = m.estados.get(`${TENANT}|viajes`) as EstadoSync;
    expect(e.cursor).toBeNull();
    expect(e.ultimoError).toBeNull();
    expect(e.ultimaOkEn).toBe(new Date(T0).toISOString());
    expect(Date.parse(e.desde as string)).toBe(T0 - 3_600_000);
    expect(e.filasLeidas).toBe(10);
  });

  it('una segunda corrida sobre el mismo origen no vuelve a entregar nada: 0 nuevas', async () => {
    const reloj = nuevoReloj(); const o = crearOrigen(origenSintetico(), reloj);
    const m = crearMundo(() => [flotaCompleta()], o, reloj);
    await sincronizarTms(m.deps);
    const r2 = await sincronizarTms(m.deps);
    expect(rec(r2, 'liquidaciones')).toMatchObject({ leidas: 20, nuevas: 0, omitidas: 20, entregadas: 0 });
    expect(rec(r2, 'viajes')).toMatchObject({ leidas: 10, nuevas: 0, omitidas: 10 });
    expect(rec(r2, 'peajes')).toMatchObject({ leidas: 15, nuevas: 0, omitidas: 15 });
    expect(rec(r2, 'posiciones')).toMatchObject({ leidas: 100, nuevas: 0 });
    expect(m.viajesEntregados).toHaveLength(10);
    expect(m.liquidacionesEntregadas).toHaveLength(20);
    expect(m.peajesEntregados).toHaveLength(15);
  });

  it('una fila corregida en el origen (misma clave, otra huella) se entrega otra vez como `actualizada`', async () => {
    const reloj = nuevoReloj(); const datos = origenSintetico();
    const m = crearMundo(() => [flotaCompleta()], crearOrigen(datos, reloj), reloj);
    await sincronizarTms(m.deps);
    datos.peajes[0] = { ...datos.peajes[0], Importe: '210.00' };
    const r2 = await sincronizarTms(m.deps);
    expect(rec(r2, 'peajes')).toMatchObject({ nuevas: 1, omitidas: 14, entregadas: 1 });
  });
});

describe('opt-in por flota', () => {
  it('sin ninguna flota configurada el sincronizador no llama a nadie', async () => {
    const reloj = nuevoReloj(); const o = crearOrigen(origenSintetico(), reloj);
    const m = crearMundo(() => [], o, reloj);
    const r = await sincronizarTms(m.deps);
    expect(r.flotas).toEqual([]);
    expect(o.logins + o.datosPedidos).toBe(0);
    expect(m.estados.size).toBe(0);
  });

  it('un recurso sin mapeo activo no se sincroniza ni se pide al origen', async () => {
    const reloj = nuevoReloj(); const o = crearOrigen(origenSintetico(), reloj);
    const solo: FlotaTms = { tenantId: TENANT, valores: { ...VALORES }, mapeos: { viajes: MAPEO_VIAJES_SUPUESTO } };
    const m = crearMundo(() => [solo], o, reloj);
    const r = await sincronizarTms(m.deps);
    expect(r.flotas[0].recursos.map((x) => [x.recurso, x.estado])).toEqual([
      ['liquidaciones', 'sin_mapeo'], ['peajes', 'sin_mapeo'], ['viajes', 'ok'], ['posiciones', 'sin_mapeo'],
    ]);
    expect([...o.rutas.keys()]).toEqual(['/api/viajes']);
  });

  it('un mapeo inválido es un error del recurso, dicho con frase, y no abre ninguna petición de datos', async () => {
    const reloj = nuevoReloj(); const o = crearOrigen(origenSintetico(), reloj);
    const roto: FlotaTms = { tenantId: TENANT, valores: { ...VALORES }, mapeos: { viajes: { recurso: 'viajes' } } };
    const m = crearMundo(() => [roto], o, reloj);
    const r = await sincronizarTms(m.deps);
    expect(rec(r, 'viajes').estado).toBe('error');
    expect(rec(r, 'viajes').error).toMatch(/mapeo de viajes no es válido/);
    expect(o.datosPedidos).toBe(0);
  });

  it('una dirección que no es https no se llama', async () => {
    const reloj = nuevoReloj(); const o = crearOrigen(origenSintetico(), reloj);
    const mala: FlotaTms = { tenantId: TENANT, valores: { ...VALORES, base_url: 'http://tms.ejemplo.test' }, mapeos: { viajes: MAPEO_VIAJES_SUPUESTO } };
    const m = crearMundo(() => [mala], o, reloj);
    const r = await sincronizarTms(m.deps);
    expect(rec(r, 'viajes')).toMatchObject({ estado: 'error', error: expect.stringMatching(/https/) });
    expect(o.logins + o.datosPedidos).toBe(0);
  });
});

describe('aislamiento entre recursos', () => {
  it('si peajes falla (503), las liquidaciones, los viajes y las posiciones se sincronizan igual', async () => {
    const reloj = nuevoReloj(); const o = crearOrigen(origenSintetico(), reloj, { fallaPeajes: true });
    const m = crearMundo(() => [flotaCompleta()], o, reloj);
    const r = await sincronizarTms(m.deps);
    expect(rec(r, 'peajes').estado).toBe('error');
    expect(rec(r, 'peajes').error).toBeTruthy();
    expect(rec(r, 'liquidaciones')).toMatchObject({ estado: 'ok', entregadas: 20 });
    expect(rec(r, 'viajes')).toMatchObject({ estado: 'ok', entregadas: 10 });
    expect(rec(r, 'posiciones')).toMatchObject({ estado: 'ok', leidas: 100 });
    // El avance de peajes NO se movió; el de los demás sí.
    expect((m.estados.get(`${TENANT}|peajes`) as EstadoSync).ultimoError).toBeTruthy();
    expect((m.estados.get(`${TENANT}|peajes`) as EstadoSync).desde).toBe(new Date(T0 - 2 * 86_400_000).toISOString());
    expect((m.estados.get(`${TENANT}|viajes`) as EstadoSync).ultimoError).toBeNull();
    expect(r.conError).toBe(1);
  });

  it('si la entrega falla (la base no contesta) no se guardan huellas ni se avanza, y la corrida siguiente lo reintenta completo', async () => {
    const reloj = nuevoReloj(); const o = crearOrigen(origenSintetico(), reloj);
    const solo: FlotaTms = { tenantId: TENANT, valores: { ...VALORES }, mapeos: { viajes: MAPEO_VIAJES_SUPUESTO } };
    const m = crearMundo(() => [solo], o, reloj);
    m.fallaEntregaViajes.activa = true;
    const r1 = await sincronizarTms(m.deps);
    expect(rec(r1, 'viajes')).toMatchObject({ estado: 'error', error: 'la base no contestó' });
    expect(m.huellas.size).toBe(0);
    expect((m.estados.get(`${TENANT}|viajes`) as EstadoSync).desde).toBe(new Date(T0 - 2 * 86_400_000).toISOString());
    m.fallaEntregaViajes.activa = false;
    const r2 = await sincronizarTms(m.deps);
    expect(rec(r2, 'viajes')).toMatchObject({ estado: 'ok', nuevas: 10, entregadas: 10 });
    expect(m.viajesEntregados).toHaveLength(10);
  });
});

describe('credencial rechazada: una sola alarma', () => {
  it('con el login rechazado, tres corridas seguidas dan UNA alarma y después no se vuelve a llamar al origen', async () => {
    const reloj = nuevoReloj(); const o = crearOrigen(origenSintetico(), reloj, { loginMalo: true });
    const m = crearMundo(() => [flotaCompleta()], o, reloj);
    const r1 = await sincronizarTms(m.deps);
    const loginsTrasLaPrimera = o.logins;
    expect(r1.alarmas).toBe(1);
    expect(r1.flotas[0].credencialRechazada).toBe(true);
    // La flota se detiene entera: ni siquiera se intentan los recursos restantes.
    expect(o.datosPedidos).toBe(0);
    const r2 = await sincronizarTms(m.deps);
    const r3 = await sincronizarTms(m.deps);
    expect(m.degradaciones).toEqual([TENANT]);
    expect(r2.flotas).toEqual([]);
    expect(r3.flotas).toEqual([]);
    expect(o.logins).toBe(loginsTrasLaPrimera);
    expect(r1.alarmas + r2.alarmas + r3.alarmas).toBe(1);
  });

  it('la frase de la alarma no lleva la contraseña ni el usuario', async () => {
    const reloj = nuevoReloj(); const o = crearOrigen(origenSintetico(), reloj, { loginMalo: true });
    const frases: string[] = [];
    const m = crearMundo(() => [flotaCompleta()], o, reloj);
    const degradar = m.deps.degradar;
    m.deps.degradar = async (t, d) => { frases.push(d); await degradar(t, d); };
    await sincronizarTms(m.deps);
    expect(frases).toHaveLength(1);
    expect(frases[0]).not.toContain(VALORES.clave);
    expect(frases[0]).not.toContain(VALORES.usuario);
  });
});

describe('presupuesto de la corrida y reanudación', () => {
  it('con el reloj agotado no se abre otro recurso (`sin_turno`) y la corrida siguiente los hace todos', async () => {
    const reloj = nuevoReloj(); const o = crearOrigen(origenSintetico(), reloj, { avanzarMs: 10_000 });
    const m = crearMundo(() => [flotaCompleta()], o, reloj);
    const r1 = await sincronizarTms(m.deps, { venceEn: T0 + 25_000 });
    expect(r1.sinTurno).toBeGreaterThan(0);
    expect(r1.flotas[0].recursos.some((x) => x.estado === 'sin_turno')).toBe(true);
    expect(m.viajesEntregados.length + m.peajesEntregados.length + m.posicionesVistas.size).toBeLessThan(125);

    // La siguiente corrida, sin presupuesto apretado, termina todo lo que faltó.
    const o2 = crearOrigen(origenSintetico(), reloj);
    m.deps.http = o2.http;
    const r2 = await sincronizarTms(m.deps);
    expect(r2.sinTurno).toBe(0);
    expect(m.viajesEntregados).toHaveLength(10);
    expect(m.liquidacionesEntregadas).toHaveLength(20);
    expect(m.peajesEntregados).toHaveLength(15);
    expect(m.posicionesVistas.size).toBe(100);
  });

  it('una lectura cortada por el reloj guarda dónde seguir, NO mueve el `desde`, y la siguiente continúa sin repetir ni perder filas', async () => {
    const reloj = nuevoReloj(); const datos = origenSintetico({ viajes: 10 });
    const o = crearOrigen(datos, reloj, { tam: 4, avanzarMs: 10_000 });
    const solo: FlotaTms = { tenantId: TENANT, valores: { ...VALORES }, mapeos: { viajes: MAPEO_VIAJES_SUPUESTO } };
    const m = crearMundo(() => [solo], o, reloj);

    const r1 = await sincronizarTms(m.deps, { venceEn: T0 + 15_000 });
    expect(rec(r1, 'viajes')).toMatchObject({ estado: 'parcial', backlog: true, leidas: 8, entregadas: 8 });
    const e1 = m.estados.get(`${TENANT}|viajes`) as EstadoSync;
    expect(e1.cursor).toMatchObject({ reanudar: { tipo: 'pagina', pagina: 3 } });
    expect(e1.desde).toBe(new Date(T0 - 2 * 86_400_000).toISOString());

    const r2 = await sincronizarTms(m.deps);
    expect(rec(r2, 'viajes')).toMatchObject({ estado: 'ok', leidas: 2, entregadas: 2 });
    expect(new Set(m.viajesEntregados).size).toBe(10);
    expect(m.viajesEntregados).toHaveLength(10);
    const e2 = m.estados.get(`${TENANT}|viajes`) as EstadoSync;
    expect(e2.cursor).toBeNull();
  });
});

describe('métricas', () => {
  it('cuenta las peticiones al origen y las sesiones renovadas tras un 401', async () => {
    const reloj = nuevoReloj(); const o = crearOrigen(origenSintetico(), reloj, { primerTokenVencido: true });
    const solo: FlotaTms = { tenantId: TENANT, valores: { ...VALORES }, mapeos: { viajes: MAPEO_VIAJES_SUPUESTO } };
    const m = crearMundo(() => [solo], o, reloj);
    const r = await sincronizarTms(m.deps);
    expect(r.renovados401).toBe(1);
    expect(r.flotas[0].renovados401).toBe(1);
    expect(r.peticiones).toBe(o.logins + o.datosPedidos);
    expect(o.logins).toBe(2);
    expect(rec(r, 'viajes').estado).toBe('ok');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LAS DEPENDENCIAS REALES (con los módulos de los agentes sustituidos)
// ═══════════════════════════════════════════════════════════════════════════

const viaje = (folio: string): FilaViajeTms => ({
  folio, origen: null, destino: null, fechaInicio: '2026-10-14', anticipo: null, operadorNombre: null, unidadEco: 'UNI-101', clienteNombre: null,
  ingresoFlete: null, kmRecorridos: null, despacho_ref: folio, salida_en: '2026-10-14T14:05:09.000Z', llegada_en: null,
});
const importacion = (o: Partial<Record<string, string[] | number | string>> = {}) => ({
  creados: 0, saltados: [], operadoresSinAmarrar: [], sinOperador: [], operadorOcupado: [], unidadesSinAmarrar: [], sinUnidad: [], clientesSinAmarrar: [], sinCliente: [], ...o,
});

describe('entregasReales.viajes', () => {
  it('lo que no se pudo amarrar (operador, unidad, cliente) NO se da por entregado y se cuenta como pendiente', async () => {
    importarViajes.mockResolvedValue(importacion({ sinOperador: ['IC-2'], sinUnidad: ['IC-3'] }));
    const e = await entregasReales.viajes(TENANT, [viaje('IC-1'), viaje('IC-2'), viaje('IC-3')]);
    expect(e.hechas).toEqual(['IC-1']);
    expect(e.pendientes).toBe(2);
    expect(e.detalle).toMatch(/2 viaje/);
  });

  it('un error de la puerta se propaga: nada se marca como hecho', async () => {
    importarViajes.mockResolvedValue(importacion({ error: 'base caída' }));
    await expect(entregasReales.viajes(TENANT, [viaje('IC-1')])).rejects.toThrow(/base caída/);
  });
});

const liq = (clave: string, huella: string): LiquidacionTms => ({
  cuerpo: {
    claveExterna: clave, sistemaOrigen: 'tms', operador: { numeroEmpleado: 'E-0001' }, viajes: ['B1'], periodo: { desde: '2026-10-01', hasta: '2026-10-07' },
    conceptos: [{ clave: 'C001', descripcion: 'Viaje', tipo: 'percepcion', monto: 100 }], total: 100, moneda: 'MXN',
  },
  clave, huella, estado: 'nueva', bitacora: 'B1', poliza: 'P1', ocultos: [], sin_catalogar: [], advertencias: [],
});

describe('entregasReales.liquidaciones', () => {
  it('guarda la nueva por la puerta de A1 SIN entregarla', async () => {
    buscarPorClave.mockResolvedValue(null);
    recibirLiquidacionExterna.mockResolvedValue({ liquidacion: { id: 'x' } });
    const e = await entregasReales.liquidaciones(TENANT, [liq('B1-P1', 'h1')]);
    expect(e.hechas).toEqual(['B1-P1']);
    expect(recibirLiquidacionExterna).toHaveBeenCalledTimes(1);
    expect(recibirLiquidacionExterna.mock.calls[0][0]).toBe(TENANT);
    expect(recibirLiquidacionExterna.mock.calls[0][2]).toBe('h1');
  });

  it('una corrección de algo ya recibido NO se sobrescribe: se cuenta como conflicto y se dice', async () => {
    buscarPorClave.mockResolvedValue({ huella: 'h-vieja' });
    const e = await entregasReales.liquidaciones(TENANT, [liq('B1-P1', 'h-nueva')]);
    expect(recibirLiquidacionExterna).not.toHaveBeenCalled();
    expect(e.conflictos).toBe(1);
    expect(e.detalle).toMatch(/no las sobrescribe/);
    expect(e.hechas).toEqual(['B1-P1']);
  });

  it('la carrera de dos corridas (clave única) cuenta como hecha; otro error la deja pendiente para reintentar', async () => {
    buscarPorClave.mockResolvedValue(null);
    recibirLiquidacionExterna.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint'));
    recibirLiquidacionExterna.mockRejectedValueOnce(new Error('storage caído'));
    const e = await entregasReales.liquidaciones(TENANT, [liq('B1-P1', 'h1'), liq('B2-P2', 'h2')]);
    expect(e.hechas).toEqual(['B1-P1']);
    expect(e.pendientes).toBe(1);
  });
});

const peaje = (n: number): FilaPeajeTms => ({
  origen: 'tms', tag: `TAG-${n}`, unidad: 'UNI-101', caseta: 'Caseta Sintética 1', clase: 'T3', importe: 189.5, cruce_en: '2026-10-14T14:05:09.000Z',
  fecha: '2026-10-14', hora: '08:05:09', despacho_ref: 'IC-1', clave: `k-${n}`, huella: `h-${n}`,
});

describe('entregasReales.peajes', () => {
  it('arma un CSV que el lector de desgloses de A2 entiende (fecha, hora, caseta, importe y TAG) y lo encola con origen `api`', async () => {
    recibirArchivoPeaje.mockResolvedValue({ ok: true, id: 'a', duplicado: false, estado: 'pendiente' });
    const e = await entregasReales.peajes(TENANT, [peaje(1), peaje(2)], { desde: '2026-10-13T00:00:00.000Z', hasta: '2026-10-15T00:00:00.000Z' });
    expect(e.hechas).toEqual(['k-1', 'k-2']);
    const [tenant, cuerpo, origen] = recibirArchivoPeaje.mock.calls[0] as [string, { nombre: string; proveedor: string; contenido: Buffer }, string];
    expect(tenant).toBe(TENANT);
    expect(origen).toBe('api');
    expect(cuerpo.nombre).toBe('tms-peajes-2026-10-13-2026-10-15.csv');
    const lectura = await parsearArchivoDesglose(cuerpo.nombre, cuerpo.contenido);
    if (!lectura.ok) throw new Error(lectura.motivo);
    expect(lectura.lineas).toHaveLength(2);
    expect(lectura.lineas[0]).toMatchObject({ fecha: '2026-10-14', caseta: 'Caseta Sintética 1', monto: 189.5, tag: 'TAG-1', hora: '08:05:09' });
  });

  it('si la cola rechaza el archivo (llena) se propaga el error y nada queda como hecho', async () => {
    recibirArchivoPeaje.mockResolvedValue({ ok: false, codigo: 'cola_llena', motivo: 'Hay 50 archivos pendientes' });
    await expect(entregasReales.peajes(TENANT, [peaje(1)], { desde: '2026-10-13T00:00:00.000Z', hasta: '2026-10-15T00:00:00.000Z' })).rejects.toThrow(/50 archivos/);
  });
});

describe('entregasReales.posiciones', () => {
  it('pasa por la ruta única de A5 y devuelve lo guardado', async () => {
    asentarPosicionesTms.mockResolvedValue({ guardadas: 7, error: undefined });
    const e = await entregasReales.posiciones(TENANT, { filas: [], descartadasPorCoordenada: 0 });
    expect(e).toEqual({ guardadas: 7, error: undefined });
  });
});

describe('depsReales.degradar', () => {
  it('marca la credencial con el error (sin veredicto de éxito) y avisa al operador una vez', async () => {
    await depsReales().degradar(TENANT, 'frase de prueba');
    expect(marcarProbada).toHaveBeenCalledWith(TENANT, 'tms_api_lectura', { ok: false, detalle: 'frase de prueba', verificadoContra: null });
    expect(alertarOperador).toHaveBeenCalledTimes(1);
    expect(alertarOperador.mock.calls[0][0]).toBe('cron.tms.credencial');
  });

  it('si ya no hay credencial activa, igual avisa y no lanza', async () => {
    marcarProbada.mockRejectedValueOnce(new Error('sin credencial'));
    await expect(depsReales().degradar(TENANT, 'x')).resolves.toBeUndefined();
    expect(alertarOperador).toHaveBeenCalledTimes(1);
  });
});

describe('depsReales: quién entra (opt-in) y cómo se guarda el avance', () => {
  const cred = (tenant: string, o: Fila = {}): Fila => ({ tenant_id: tenant, conector_id: 'tms_api_lectura', activo: true, probada_en: '2026-10-15T10:00:00Z', ultimo_error: null, ...o });
  const mapeo = (tenant: string, recurso: string, o: Fila = {}): Fila => ({ tenant_id: tenant, recurso, mapeo: { recurso }, activo: true, ...o });

  it('solo se listan las flotas con credencial activa, PROBADA, sin error vigente y con al menos un mapeo activo', async () => {
    tablas.conector_credencial = [
      cred('t-buena'),
      cred('t-sin-probar', { probada_en: null }),
      cred('t-con-error', { ultimo_error: 'rechazada' }),
      cred('t-sin-mapeo'),
      cred('t-inactiva', { activo: false }),
      cred('t-otro-conector', { conector_id: 'samsara' }),
    ];
    tablas.tms_mapeo = [
      mapeo('t-buena', 'viajes'), mapeo('t-buena', 'peajes', { activo: false }), mapeo('t-buena', 'recurso_raro'),
      mapeo('t-sin-probar', 'viajes'), mapeo('t-con-error', 'viajes'), mapeo('t-inactiva', 'viajes'),
    ];
    leerCredencial.mockResolvedValue({ ...VALORES });
    const flotas = await depsReales().listarFlotas();
    expect(flotas.map((f) => f.tenantId)).toEqual(['t-buena']);
    expect(Object.keys(flotas[0].mapeos)).toEqual(['viajes']);
    expect(leerCredencial).toHaveBeenCalledTimes(1);
    expect(leerCredencial).toHaveBeenCalledWith('t-buena', 'tms_api_lectura');
  });

  it('sin ninguna credencial no consulta mapeos ni descifra nada', async () => {
    tablas.conector_credencial = [];
    expect(await depsReales().listarFlotas()).toEqual([]);
    expect(leerCredencial).not.toHaveBeenCalled();
  });

  it('el estado se guarda por (flota, recurso) y se lee con su cursor', async () => {
    const d = depsReales();
    await d.guardarEstado(TENANT, 'viajes', { desde: '2026-10-14T00:00:00.000Z', cursor: { hasta: '2026-10-15T00:00:00.000Z', reanudar: { tipo: 'pagina', pagina: 3 } }, ultimaOkEn: null, ultimoError: null, filasLeidas: 8 });
    expect(upserts[0]).toMatchObject({ tabla: 'tms_sincronizacion', opciones: { onConflict: 'tenant_id,recurso' } });
    expect(upserts[0].filas).toMatchObject({ tenant_id: TENANT, recurso: 'viajes', filas_leidas: 8, cursor: { reanudar: { pagina: 3 } } });
    tablas.tms_sincronizacion = [{ tenant_id: TENANT, recurso: 'viajes', cursor: { hasta: 'h', reanudar: { tipo: 'pagina', pagina: 3 } }, desde: 'd', ultima_ok_en: null, ultimo_error: null, filas_leidas: 8 }];
    expect(await d.leerEstado(TENANT, 'viajes')).toMatchObject({ desde: 'd', cursor: { hasta: 'h', reanudar: { pagina: 3 } }, filasLeidas: 8 });
    expect(await d.leerEstado(TENANT, 'peajes')).toBeNull();
  });

  it('las huellas se guardan por lotes de 500 con la llave (flota, recurso, clave)', async () => {
    const filas = Array.from({ length: 1200 }, (_, i) => ({ clave: `k-${i}`, huella: `h-${i}` }));
    await depsReales().guardarHuellas(TENANT, 'peajes', filas);
    expect(upserts.map((u) => (u.filas as unknown[]).length)).toEqual([500, 500, 200]);
    expect(upserts[0].opciones).toEqual({ onConflict: 'tenant_id,recurso,clave_externa' });
  });

  it('las huellas previas se leen por flota y recurso', async () => {
    tablas.tms_ingesta = [
      { tenant_id: TENANT, recurso: 'peajes', clave_externa: 'k-1', huella: 'h-1' },
      { tenant_id: TENANT, recurso: 'viajes', clave_externa: 'k-1', huella: 'otra' },
      { tenant_id: 'otra-flota', recurso: 'peajes', clave_externa: 'k-1', huella: 'ajena' },
    ];
    const previas = await depsReales().huellasPrevias(TENANT, 'peajes', ['k-1', 'k-2']);
    expect([...previas]).toEqual([['k-1', 'h-1']]);
  });
});
