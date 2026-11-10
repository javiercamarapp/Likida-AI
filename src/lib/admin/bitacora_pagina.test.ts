import { describe, expect, it, vi, beforeEach } from 'vitest';

// La Bitácora consultable (F7): filtros saneados, total real, orden estable y tabla de accesos tolerante.
type Resp = { data: unknown; error: { message: string; code?: string } | null; count?: number | null };
const resp: { actual: Resp; porTabla: Record<string, Resp> } = { actual: { data: [], error: null, count: 0 }, porTabla: {} };
const llamadas: Array<[string, ...unknown[]]> = [];

function builder(tabla: string) {
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'ilike', 'eq', 'is', 'gte', 'lte', 'order', 'range', 'in', 'limit']) {
    b[m] = (...a: unknown[]) => { llamadas.push([`${tabla}.${m}`, ...a]); return b; };
  }
  b.then = (ok: (v: Resp) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(resp.porTabla[tabla] ?? resp.actual).then(ok, fail);
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));

const { leerPaginaBitacora, leerPaginaAccesos, normalizarFiltroBitacora, FILAS_BITACORA } = await import('./bitacora');

const UUID = '3f2b8c1e-5a47-4d0e-9b61-0c2f7a8d9e10';
beforeEach(() => { resp.actual = { data: [], error: null, count: 0 }; resp.porTabla = {}; llamadas.length = 0; });

describe('normalizarFiltroBitacora', () => {
  it('descarta lo inválido: ids que no son uuid, fechas mal formadas y comodines de LIKE', () => {
    expect(normalizarFiltroBitacora({ accion: "Flota.Creada% '", actorId: 'no-uuid', tenantId: "x' or 1=1", desde: '10/11/2026', hasta: '2026-11-10' }))
      .toEqual({ accion: 'flota.creada', hasta: '2026-11-10' });
  });
  it('acepta uuid, «plataforma» y días AAAA-MM-DD', () => {
    expect(normalizarFiltroBitacora({ actorId: UUID, tenantId: 'plataforma', desde: '2026-11-01' })).toEqual({ actorId: UUID, tenantId: 'plataforma', desde: '2026-11-01' });
  });
});

describe('leerPaginaBitacora', () => {
  it('pide el total exacto, ordena por fecha y id (páginas que no repiten) y calcula el rango', async () => {
    resp.actual = { data: [], error: null, count: 120 };
    const r = await leerPaginaBitacora({}, 3);
    expect(r).toMatchObject({ total: 120, pagina: 3, paginas: 3, filas: [] });
    expect(llamadas).toContainEqual(['bitacora_auditoria.range', 2 * FILAS_BITACORA, 3 * FILAS_BITACORA - 1]);
    expect(llamadas.filter((l) => l[0] === 'bitacora_auditoria.order').map((l) => l[1])).toEqual(['ocurrio_en', 'id']);
    expect(llamadas.find((l) => l[0] === 'bitacora_auditoria.select')?.[2]).toEqual({ count: 'exact' });
  });
  it('aplica cada filtro sobre la columna correcta; «plataforma» busca las acciones sin flota', async () => {
    await leerPaginaBitacora({ accion: 'usuario', actorId: UUID, tenantId: 'plataforma', desde: '2026-11-01', hasta: '2026-11-09' }, 1);
    expect(llamadas).toContainEqual(['bitacora_auditoria.ilike', 'accion', '%usuario%']);
    expect(llamadas).toContainEqual(['bitacora_auditoria.eq', 'actor_id', UUID]);
    expect(llamadas).toContainEqual(['bitacora_auditoria.is', 'tenant_id', null]);
    expect(llamadas).toContainEqual(['bitacora_auditoria.gte', 'ocurrio_en', '2026-11-01T00:00:00-06:00']);
    expect(llamadas).toContainEqual(['bitacora_auditoria.lte', 'ocurrio_en', '2026-11-09T23:59:59.999-06:00']);
  });
  it('LANZA si la base falla: una bitácora vacía sobre una base caída diría que nadie tocó nada', async () => {
    resp.actual = { data: null, error: { message: 'timeout' }, count: null };
    await expect(leerPaginaBitacora({}, 1)).rejects.toThrow('timeout');
  });
  it('mapea actor y flota sin inventar: sin join queda null', async () => {
    resp.actual = { data: [{ id: 7, tenant_id: null, actor_id: null, actor_email: null, accion: 'interruptor.apagado', entidad: 'interruptor', entidad_id: 'x', detalle: null, ocurrio_en: '2026-11-09T10:00:00Z', tenant: null, actor: null }], error: null, count: 1 };
    const r = await leerPaginaBitacora({}, 1);
    expect(r.filas[0]).toMatchObject({ id: 7, tenantId: null, tenantNombre: null, actor: null });
  });
});

describe('leerPaginaAccesos', () => {
  it('una tabla que aún no existe NO es un error: existe=false', async () => {
    resp.porTabla.superadmin_acceso = { data: null, error: { message: 'relation "public.superadmin_acceso" does not exist', code: '42P01' }, count: null };
    expect(await leerPaginaAccesos({}, 1)).toMatchObject({ existe: false, total: 0 });
  });
  it('cualquier otro error LANZA', async () => {
    resp.porTabla.superadmin_acceso = { data: null, error: { message: 'timeout' }, count: null };
    await expect(leerPaginaAccesos({}, 1)).rejects.toThrow('timeout');
  });
  it('resuelve nombres de persona y flota aparte y solo trae la ruta (nunca el detalle)', async () => {
    resp.porTabla.superadmin_acceso = { data: [{ id: 1, creado_en: '2026-11-09T10:00:00Z', actor: UUID, tenant_id: 't1', tipo: 'descarga', ruta: '/admin/facturas' }], error: null, count: 1 };
    resp.porTabla.app_user = { data: [{ id: UUID, nombre: 'Ana' }], error: null };
    resp.porTabla.tenant = { data: [{ id: 't1', nombre: 'Flota Uno' }], error: null };
    const r = await leerPaginaAccesos({}, 1);
    expect(r.filas).toEqual([{ id: 1, creadoEn: '2026-11-09T10:00:00Z', actor: 'Ana', tenantNombre: 'Flota Uno', tipo: 'descarga', ruta: '/admin/facturas' }]);
    expect(llamadas.find((l) => l[0] === 'superadmin_acceso.select')?.[1]).not.toContain('detalle');
  });
});
