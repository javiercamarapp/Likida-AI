import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';

// Lote A37 «d-peajes-liquidacion-08»: S52-05 (CSV de cursos en Windows-1252), S53-08 (escrituras que dicen «ok»
// sin que cambie ninguna fila), S53-09 (lectura acotada de viajes/unidades) y S53-10 (reimportar no reactiva casetas).

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const D = await import('./datos');
const { importarCursosArchivo } = await import('./cursos_importar');
const V = await import('./viajes_fuente');

const T = 'tenant-1';
const OTRO = 'tenant-2';
const bytes = (t: string) => new TextEncoder().encode(t);
beforeEach(() => { db = crearDbFalsa({}); });

describe('A37-S52-05: el CSV de cursos acepta Windows-1252', () => {
  it('«Querétaro» en latin1 resuelve contra el catálogo en vez de rechazar el lote', async () => {
    const csv = Buffer.from('codigo,nombre,unidad,convenio,casetas\nCUR-1,Ruta uno,C2-08,,Caseta Querétaro\n', 'latin1');
    const guardar = vi.fn(async () => ({ estado: 'ok' as const, creados: 1, actualizados: 0 }));
    const r = await importarCursosArchivo(T, 'cursos.csv', new Uint8Array(csv), {
      resolver: async () => ({
        unidades: [{ id: 'u1', numeroEconomico: 'C2-08' }],
        casetas: [{ id: 'c1', nombreNorm: 'caseta queretaro', alias: [] }],
        convenios: [],
      }),
      guardar,
    });
    expect(r).toMatchObject({ ok: true, creados: 1 });
    expect(guardar).toHaveBeenCalledTimes(1);
  });
});

describe('A37-S53-08: ninguna escritura dice «ok» si no cambió nada', () => {
  const ATIPICO = { id: 'a1', tenant_id: T, estado: 'nuevo', avisado_en: null };

  it('marcarAtipico: si otra pestaña lo cambió entre la lectura y el UPDATE, devuelve motivo (no ok)', async () => {
    db = crearDbFalsa({ peaje_atipico: [{ ...ATIPICO }] });
    // La carrera: la lectura ve 'nuevo' y justo antes del UPDATE alguien lo pasa a 'avisado'.
    const original = db.cliente.from.bind(db.cliente);
    let primera = true;
    db.cliente.from = (t: string) => {
      const q = original(t) as { update: (p: unknown) => unknown };
      if (t === 'peaje_atipico' && primera) {
        const u = q.update.bind(q);
        q.update = (p: unknown) => { if (primera) { primera = false; db.tablas.peaje_atipico[0].estado = 'avisado'; } return u(p); };
      }
      return q;
    };
    const r = await D.marcarAtipico(T, 'a1', { estado: 'avisado' });
    expect(r.ok).toBe(false);
    expect(db.tablas.peaje_atipico[0].estado).toBe('avisado');
  });

  it('marcarAtipico: el camino feliz sigue devolviendo ok', async () => {
    db = crearDbFalsa({ peaje_atipico: [{ ...ATIPICO }] });
    expect(await D.marcarAtipico(T, 'a1', { estado: 'avisado' })).toEqual({ ok: true, estado: 'avisado' });
  });

  it('marcarReclamoRechazado: un reclamo «preparado» o «acreditado» NO se rechaza y no dice ok', async () => {
    db = crearDbFalsa({ peaje_reclamo: [
      { id: 'r1', tenant_id: T, estado: 'preparado' }, { id: 'r2', tenant_id: T, estado: 'acreditado' },
      { id: 'r3', tenant_id: T, estado: 'enviado' }, { id: 'r4', tenant_id: OTRO, estado: 'enviado' },
    ] });
    expect(await D.marcarReclamoRechazado(T, 'r1')).toBe(false);
    expect(await D.marcarReclamoRechazado(T, 'r2')).toBe(false);
    expect(await D.marcarReclamoRechazado(T, 'r4')).toBe(false);
    expect(await D.marcarReclamoRechazado(T, 'r3')).toBe(true);
    expect(db.tablas.peaje_reclamo.map((f) => f.estado)).toEqual(['preparado', 'acreditado', 'rechazado', 'enviado']);
  });

  it('cambiarEstadoCaseta / cambiarEstadoGeocerca: un id inexistente o ajeno devuelve false', async () => {
    db = crearDbFalsa({
      peaje_caseta: [{ id: 'c1', tenant_id: T, activa: true }],
      geocerca: [{ id: 'g1', tenant_id: T, catalogo: 'peajes', activa: true }],
    });
    expect(await D.cambiarEstadoCaseta(T, 'no-existe', false)).toBe(false);
    expect(await D.cambiarEstadoCaseta(OTRO, 'c1', false)).toBe(false);
    expect(await D.cambiarEstadoCaseta(T, 'c1', false)).toBe(true);
    expect(await D.cambiarEstadoGeocerca(T, 'no-existe', false)).toBe(false);
    expect(await D.cambiarEstadoGeocerca(T, 'g1', false)).toBe(true);
  });
});

describe('A37-S53-09: el vínculo cruce→viaje acota lo que lee', () => {
  it('no trae viajes que terminaron antes del rango ni unidades ajenas a esos viajes', async () => {
    db = crearDbFalsa({
      unidad: [
        { id: 'u1', tenant_id: T, numero_economico: 'TC9001' },
        { id: 'u2', tenant_id: T, numero_economico: 'TC9002' },
      ],
      viaje: [
        { id: 'viejo', tenant_id: T, folio: 'F-0', unidad_id: 'u2', fecha_inicio: '2023-01-02', fecha_fin: '2023-01-04', origen: null, destino: null },
        { id: 'v1', tenant_id: T, folio: 'F-1', unidad_id: 'u1', fecha_inicio: '2026-09-02', fecha_fin: '2026-09-04', origen: null, destino: null },
        { id: 'abierto', tenant_id: T, folio: 'F-2', unidad_id: 'u1', fecha_inicio: '2026-09-10', fecha_fin: null, origen: null, destino: null },
      ],
    });
    const r = await V.desdeTablaViajeLocal(T, { desde: '2026-09-01', hasta: '2026-09-30' });
    expect(r.viajes.map((v) => v.id).sort()).toEqual(['abierto', 'v1']);
    const viaje = db.llamadas.find((l) => l.tabla === 'viaje' && l.op === 'select')!;
    expect(viaje.filtros.some(([, o]) => o === 'or')).toBe(true);
    const unidad = db.llamadas.filter((l) => l.tabla === 'unidad' && l.op === 'select');
    expect(unidad.length).toBeGreaterThan(0);
    expect(unidad.every((l) => l.filtros.some(([c, o]) => c === 'id' && o === 'in'))).toBe(true);
  });
});

describe('A37-S53-10: reimportar casetas no reactiva las desactivadas', () => {
  it('una caseta desactivada sigue desactivada tras re-subir el catálogo; una nueva nace activa', async () => {
    await D.importarCasetasArchivo(T, 'a.csv', bytes('nombre;lat;lng\nCaseta Ejemplo Norte;19.5;-99.2\n'), 'captura');
    const norte = db.tablas.peaje_caseta.find((f) => f.nombre === 'Caseta Ejemplo Norte')!;
    expect(await D.cambiarEstadoCaseta(T, String(norte.id), false)).toBe(true);
    const r = await D.importarCasetasArchivo(T, 'b.csv', bytes('nombre;lat;lng\nCaseta Ejemplo Norte;19.6;-99.3\nCaseta Ejemplo Sur;19.1;-99.1\n'), 'captura');
    expect(r).toMatchObject({ ok: true, guardadas: 2, actualizadas: 1 });
    const filas = db.tablas.peaje_caseta;
    expect(filas.find((f) => f.nombre === 'Caseta Ejemplo Norte')).toMatchObject({ activa: false, lat: 19.6, lng: -99.3 });
    expect(filas.find((f) => f.nombre === 'Caseta Ejemplo Sur')).toMatchObject({ activa: true });
  });
});
