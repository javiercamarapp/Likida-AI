import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';

// ═══════════════════════════════════════════════════════════════════════════
// 0480 — LAS DOS PANTALLAS SOBRE LA MISMA TABLA `geocerca` NO SE PISAN.
//
// El choque de la ronda 02: el upsert por (tenant, nombre) del editor de peajes podía cambiar el
// `tipo` de un sitio del catálogo del Conductor. Aquí se prueba la LÓGICA de la app contra una base
// en memoria (qué lee, qué escribe, con qué filtro); que la BASE lo impida también (catálogo
// inmutable + CHECK de pareja) lo prueba supabase/tests/0480_geocerca_catalogos.sql.
// ═══════════════════════════════════════════════════════════════════════════

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const peajes = await import('./datos');
const sitios = await import('../conductor/repo_validacion');

const T = '11111111-1111-4111-8111-111111111111';
const OTRA = '22222222-2222-4222-8222-222222222222';
const ID_SITIO = '33333333-3333-4333-8333-333333333333';
const ID_PEAJE = '44444444-4444-4444-8444-444444444444';

function sembrar() {
  db = crearDbFalsa({
    geocerca: [
      { id: ID_SITIO, tenant_id: T, nombre: 'Planta Zapopan', tipo: 'planta', lat: 20.72, lng: -103.39, radio_m: 300, activa: true, catalogo: 'conductor', codigo: 'PL-ZAP', fuente: 'csv' },
      { id: ID_PEAJE, tenant_id: T, nombre: 'Caseta Norte', tipo: 'restringida', lat: 20.6, lng: -103.1, radio_m: 500, activa: true, catalogo: 'peajes', codigo: null, fuente: 'manual' },
      { id: 'otra', tenant_id: OTRA, nombre: 'Caseta Ajena', tipo: 'restringida', lat: 1, lng: 1, radio_m: 100, activa: true, catalogo: 'peajes', codigo: null, fuente: 'manual' },
    ],
  });
}

describe('editor de geocercas de peajes', () => {
  beforeEach(sembrar);

  it('NO pisa un sitio del Conductor aunque se llame igual: avisa y la fila queda intacta', async () => {
    const r = await peajes.guardarGeocerca(T, { nombre: 'Planta Zapopan', tipo: 'restringida', lat: 1, lng: 1, radioM: 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/Agente Conductor/);
    const fila = db.tablas.geocerca.find((f) => f.id === ID_SITIO)!;
    expect(fila).toMatchObject({ tipo: 'planta', lat: 20.72, lng: -103.39, radio_m: 300, catalogo: 'conductor' });
    // Ni siquiera se intentó el upsert.
    expect(db.llamadas.some((l) => l.tabla === 'geocerca' && l.op === 'upsert')).toBe(false);
  });

  it('el nombre se compara ya normalizado (espacios de más no esquivan el aviso)', async () => {
    const r = await peajes.guardarGeocerca(T, { nombre: '  Planta   Zapopan ', tipo: 'patio', lat: 1, lng: 1, radioM: 100 });
    expect(r.ok).toBe(false);
  });

  it('si la base lo rebota (carrera: el sitio apareció entre la lectura y el upsert, 23514) devuelve el mismo aviso', async () => {
    // El doble no conoce códigos de Postgres: se simula el 23514 con un cliente propio.
    const orig = db.cliente.from;
    db.cliente.from = (t: string) => {
      const q = orig(t) as { upsert?: (...a: unknown[]) => unknown; then?: unknown };
      if (t === 'geocerca' && q.upsert) {
        const up = q.upsert.bind(q);
        q.upsert = (...a: unknown[]) => { up(...a); return Promise.resolve({ data: null, error: { message: 'x', code: '23514' } }); };
      }
      return q;
    };
    const r = await peajes.guardarGeocerca(T, { nombre: 'Nueva Caseta', tipo: 'restringida', lat: 20, lng: -103, radioM: 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/Agente Conductor/);
  });

  it('guarda una geocerca de peajes declarándola de ese catálogo, y la repetida solo se actualiza', async () => {
    expect((await peajes.guardarGeocerca(T, { nombre: 'Caseta Nueva', tipo: 'restringida', lat: 20.1, lng: -103.2, radioM: 400 })).ok).toBe(true);
    expect(db.tablas.geocerca.find((f) => f.nombre === 'Caseta Nueva')).toMatchObject({ tenant_id: T, catalogo: 'peajes', tipo: 'restringida' });
    expect((await peajes.guardarGeocerca(T, { nombre: 'Caseta Norte', tipo: 'patio', lat: 20.65, lng: -103.15, radioM: 250 })).ok).toBe(true);
    expect(db.tablas.geocerca.filter((f) => f.nombre === 'Caseta Norte')).toHaveLength(1);
    expect(db.tablas.geocerca.find((f) => f.id === ID_PEAJE)).toMatchObject({ tipo: 'patio', radio_m: 250 });
  });

  it('solo lista las suyas, de su flota', async () => {
    const l = await peajes.listarGeocercas(T);
    expect(l.map((g) => g.nombre)).toEqual(['Caseta Norte']);
  });

  it('la reclamación SÍ ve los patios que la flota importó de sus tablas (catálogo del Conductor), no solo los capturados a mano', async () => {
    db.tablas.geocerca.push({ id: 'patio-gdl', tenant_id: T, nombre: 'PATIO GDL', tipo: 'patio', lat: 20.6, lng: -103.3, radio_m: 300, activa: true, catalogo: 'conductor', codigo: 'P-GDL', fuente: 'csv' });
    const z = await peajes.listarGeocercas(T, { zonasParaReclamacion: true });
    expect(z.map((g) => g.nombre).sort()).toEqual(['PATIO GDL', 'Caseta Norte'].sort());
    expect((await peajes.listarGeocercas(T)).map((g) => g.nombre)).toEqual(['Caseta Norte']);
  });

  it('la reclamación lee el polígono y la bandera aproximada de la zona; el editor de peajes no los trae', async () => {
    const poli = [{ lat: 20.6, lng: -103.3 }, { lat: 20.6, lng: -103.29 }, { lat: 20.61, lng: -103.29 }];
    db.tablas.geocerca.push({ id: 'patio-poli', tenant_id: T, nombre: 'PATIO POLI', tipo: 'patio', lat: 20.603, lng: -103.293, radio_m: 900, activa: true, catalogo: 'conductor', codigo: 'P-POLI', fuente: 'csv', poligono: poli, aproximada: false });
    db.tablas.geocerca.push({ id: 'patio-aprox', tenant_id: T, nombre: 'PATIO APROX', tipo: 'patio', lat: 20.7, lng: -103.3, radio_m: 300, activa: true, catalogo: 'conductor', codigo: 'P-APR', fuente: 'csv', poligono: null, aproximada: true });
    const z = await peajes.listarGeocercas(T, { zonasParaReclamacion: true });
    expect(z.find((g) => g.nombre === 'PATIO POLI')).toMatchObject({ poligono: poli, aproximada: false, radioM: 900 });
    expect(z.find((g) => g.nombre === 'PATIO APROX')).toMatchObject({ poligono: null, aproximada: true });
    // el editor (catálogo de peajes) no trae el polígono
    expect((await peajes.listarGeocercas(T))[0]).not.toHaveProperty('poligono');
  });

  it('activar/desactivar solo toca las suyas: el id de un sitio del Conductor no hace nada', async () => {
    await peajes.cambiarEstadoGeocerca(T, ID_SITIO, false);
    expect(db.tablas.geocerca.find((f) => f.id === ID_SITIO)!.activa).toBe(true);
    await peajes.cambiarEstadoGeocerca(T, ID_PEAJE, false);
    expect(db.tablas.geocerca.find((f) => f.id === ID_PEAJE)!.activa).toBe(false);
  });
});

describe('catálogo de sitios del Conductor', () => {
  beforeEach(sembrar);

  it('solo lista y edita los suyos: el id de una geocerca de peajes es «no encontrado»', async () => {
    const l = await sitios.listarSitios(T);
    expect(l.sitios.map((s) => s.nombre)).toEqual(['Planta Zapopan']);
    const r = await sitios.guardarSitio(T, {
      id: ID_PEAJE, nombre: 'Caseta Norte', tipo: 'planta', codigo: null, direccion: null, lat: 20, lng: -103, radioM: 100, clienteId: null, padreId: null,
    });
    expect(r).toBe('no_encontrado');
    expect(db.tablas.geocerca.find((f) => f.id === ID_PEAJE)).toMatchObject({ tipo: 'restringida', radio_m: 500 });
    expect(await sitios.cambiarEstadoSitio(T, ID_PEAJE, false)).toBe(false);
  });

  it('el alta manual se declara del catálogo del Conductor (un patio sin código no cae en peajes)', async () => {
    const r = await sitios.guardarSitio(T, {
      nombre: 'Patio Norte', tipo: 'patio', codigo: null, direccion: null, lat: 20.5, lng: -103.3, radioM: 150, clienteId: null, padreId: null,
    });
    expect(r).toBe('ok');
    expect(db.tablas.geocerca.find((f) => f.nombre === 'Patio Norte')).toMatchObject({ tenant_id: T, catalogo: 'conductor', fuente: 'manual' });
  });

  it('asignar el sitio de un viaje solo resuelve sitios del Conductor (un nombre de peajes no sirve)', async () => {
    db.tablas.viaje = [{ id: '55555555-5555-4555-8555-555555555555', tenant_id: T }];
    const r = await sitios.asignarSitiosViaje(T, '55555555-5555-4555-8555-555555555555', { origen: ID_PEAJE });
    expect(r).toBe('sitio_no_encontrado');
    const ok = await sitios.asignarSitiosViaje(T, '55555555-5555-4555-8555-555555555555', { origen: 'PL-ZAP' });
    expect(ok).toBe('ok');
  });
});
