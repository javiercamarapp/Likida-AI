import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearBaseEnMemoria, type BaseEnMemoria } from '@/lib/pruebas/tablas_en_memoria.fixture';

// ═══════════════════════════════════════════════════════════════════════════
// P9 — el cron del Conductor reparte sus viajes entre flotas (0661) y deja de perseguir lo vencido.
// La semántica del reparto (turnos, rotación, plazo) la demuestra Postgres real en supabase/tests/0661_conductor_reparto_justo.sql;
// aquí se fija lo que hace el CÓDIGO con la respuesta: pide la RPC con el tope y el plazo, conserva el orden del reparto aunque
// la lectura vaya por lotes, no inventa viajes que ya no están abiertos, cae a la lectura anterior sin la 0661, y avisa.
// ═══════════════════════════════════════════════════════════════════════════
const estado: { db: BaseEnMemoria } = { db: undefined as unknown as BaseEnMemoria };
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => estado.db.cliente }));
vi.mock('@/lib/logger', () => ({ logger }));

const { leerViajesActivos, cerrarHitosDeViajesVencidos, DIAS_VIAJE_ABIERTO_VENCIDO } = await import('./trabajo');

const viaje = (id: string, tenant: string, extra: Record<string, unknown> = {}) => ({
  id, tenant_id: tenant, folio: `F-${id}`, origen: null, destino: null, estatus: 'abierto', operador_id: `op-${id}`,
  terminal_id: null, unidad_id: null, aceptado_en: '2026-10-01T10:00:00Z', cita_origen_en: null, cita_destino_en: null,
  eta_origen_en: null, eta_destino_en: null, ...extra,
});

beforeEach(() => { logger.warn.mockClear(); logger.error.mockClear(); });

describe('leerViajesActivos — con el reparto de la 0661', () => {
  it('pide la RPC con el tope, el plazo y una rotación por ventana de 5 min, y conserva el ORDEN del reparto', async () => {
    estado.db = crearBaseEnMemoria({ viaje: [viaje('a1', 'A'), viaje('a2', 'A'), viaje('b1', 'B')] });
    const args: unknown[] = [];
    // El reparto: el más viejo de cada flota primero (a1, b1), luego el segundo de A.
    estado.db.rpcRespuesta('viajes_activos_repartidos', (a) => { args.push(a); return { data: [{ o_id: 'a1' }, { o_id: 'b1' }, { o_id: 'a2' }], error: null }; });
    const r = await leerViajesActivos(400);
    expect(r.map((v) => v.id)).toEqual(['a1', 'b1', 'a2']);
    expect(args[0]).toMatchObject({ p_limite: 400, p_max_dias: DIAS_VIAJE_ABIERTO_VENCIDO });
    expect(typeof (args[0] as { p_rotacion: unknown }).p_rotacion).toBe('number');
  });

  it('un viaje que dejó de estar abierto entre la RPC y la lectura no se inventa', async () => {
    estado.db = crearBaseEnMemoria({ viaje: [viaje('a1', 'A'), viaje('a2', 'A', { estatus: 'liquidado' })] });
    estado.db.rpcRespuesta('viajes_activos_repartidos', () => ({ data: [{ o_id: 'a2' }, { o_id: 'a1' }], error: null }));
    expect((await leerViajesActivos(10)).map((v) => v.id)).toEqual(['a1']);
  });

  it('lee en lotes: 400 ids no caben en una sola URL', async () => {
    const todos = Array.from({ length: 400 }, (_, i) => viaje(`v${String(i).padStart(3, '0')}`, i % 2 ? 'A' : 'B'));
    estado.db = crearBaseEnMemoria({ viaje: todos });
    const orden = todos.map((v) => v.id).reverse();
    estado.db.rpcRespuesta('viajes_activos_repartidos', () => ({ data: orden.map((o_id) => ({ o_id })), error: null }));
    const r = await leerViajesActivos(400);
    expect(r).toHaveLength(400);
    expect(r.map((v) => v.id)).toEqual(orden);
    expect(estado.db.bitacora.filter((b) => b.tabla === 'viaje')).toHaveLength(3);
  });

  it('SIN la 0661 en la base cae a la lectura anterior (los más viejos en bloque)', async () => {
    estado.db = crearBaseEnMemoria({ viaje: [viaje('a2', 'A', { aceptado_en: '2026-10-01T12:00:00Z' }), viaje('a1', 'A'), viaje('s', 'A', { aceptado_en: null })] });
    estado.db.rpcRespuesta('viajes_activos_repartidos', () => ({
      data: null, error: { code: 'PGRST202', message: 'Could not find the function public.viajes_activos_repartidos(p_limite) in the schema cache' },
    }));
    const r = await leerViajesActivos(10);
    expect(r.map((v) => v.id)).toEqual(['a1', 'a2']);
  });

  it('cualquier OTRO error de la RPC sube: no se opera con una lista a medias', async () => {
    estado.db = crearBaseEnMemoria({ viaje: [] });
    estado.db.rpcRespuesta('viajes_activos_repartidos', () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }));
    await expect(leerViajesActivos(10)).rejects.toThrow(/timeout/);
  });
});

describe('cerrarHitosDeViajesVencidos', () => {
  it('pide el cierre con el plazo y devuelve cuántos hitos dejó de perseguir', async () => {
    estado.db = crearBaseEnMemoria({});
    const args: unknown[] = [];
    estado.db.rpcRespuesta('cerrar_hitos_viajes_vencidos', (a) => { args.push(a); return { data: 4, error: null }; });
    expect(await cerrarHitosDeViajesVencidos()).toBe(4);
    expect(args[0]).toMatchObject({ p_max_dias: DIAS_VIAJE_ABIERTO_VENCIDO, p_limite: 500 });
  });

  it('sin la 0661 devuelve 0; con otro error lanza', async () => {
    estado.db = crearBaseEnMemoria({});
    estado.db.rpcRespuesta('cerrar_hitos_viajes_vencidos', () => ({ data: null, error: { code: '42883', message: 'function public.cerrar_hitos_viajes_vencidos(integer, integer) does not exist' } }));
    expect(await cerrarHitosDeViajesVencidos()).toBe(0);
    estado.db.rpcRespuesta('cerrar_hitos_viajes_vencidos', () => ({ data: null, error: { code: '40P01', message: 'deadlock detected' } }));
    await expect(cerrarHitosDeViajesVencidos()).rejects.toThrow(/deadlock/);
  });
});
