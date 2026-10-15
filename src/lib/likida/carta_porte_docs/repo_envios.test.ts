import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EstadoEnvioTms } from './repo';

// El repositorio de envíos (T-A3-27, 0790) en dos mitades:
//   1) la implementación REAL contra un Supabase de doble que graba cada consulta (filtros, RPC, errores);
//   2) el doble EN MEMORIA que usará el worker: debe cumplir el mismo contrato (reclamo exclusivo, candado único, tenant).
// Espejo del patrón de `repo_worker.test.ts`.

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

type Respuesta = { data: unknown; error: { message: string; code?: string } | null; count?: number | null };
interface Llamada { tabla?: string; rpc?: string; args?: Record<string, unknown>; ops: Array<[string, unknown[]]> }

let rpcs: Record<string, Respuesta> = {};
let porTabla: Respuesta[] = [];
const llamadas: Llamada[] = [];
const AUSENTE = { message: 'Could not find the function public.cp_envio_reclamar in the schema cache', code: 'PGRST202' };

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (nombre: string, args: Record<string, unknown>) => {
      llamadas.push({ rpc: nombre, args, ops: [] });
      return Promise.resolve(rpcs[nombre] ?? { data: null, error: { message: `rpc ${nombre} sin guion` } });
    },
    from: (tabla: string) => {
      const l: Llamada = { tabla, ops: [] };
      llamadas.push(l);
      const n: Record<string, unknown> = {};
      for (const m of ['select', 'update', 'eq', 'in', 'gte', 'order', 'limit', 'maybeSingle']) n[m] = (...a: unknown[]) => { l.ops.push([m, a]); return n; };
      n.then = (ok: (v: Respuesta) => unknown) => Promise.resolve(porTabla.shift() ?? { data: [], error: null }).then(ok);
      return n;
    },
  }),
}));
vi.mock('../presupuesto', () => ({ acotada: async <T,>(p: PromiseLike<T>) => p }));

const real = await import('./repo_envios');
const { repoEnvios, sanearErrores } = real;
const { repoEnviosFalso, estadoEnvios, resetEnvios, sembrarEnvio } = await import('./repo_envios_falso.fixture');

const A = 'tenant-a';
const B = 'tenant-b';
const T0 = new Date('2026-10-02T12:00:00Z');

const filtros = (l: Llamada) => l.ops.filter(([m]) => m === 'eq').map(([, a]) => a as [string, unknown]);
const tenantEnTodas = () => llamadas.filter((l) => l.tabla).every((l) => filtros(l).some(([c, v]) => c === 'tenant_id' && typeof v === 'string'));

beforeEach(() => { rpcs = {}; porTabla = []; llamadas.length = 0; resetEnvios(); estadoEnvios.reloj.ahora = () => new Date(T0); });

describe('sanearErrores: solo ubicación, nunca el contenido', () => {
  it('conserva hoja/fila/campo/código y descarta mensaje y valor', () => {
    const r = sanearErrores([{ hoja: 'Mercancias', fila: 22, campo: 'Fracción Arancelaria', codigo: 'E01', mensaje: 'valor 12345678 inválido', valor: '12345678' }]);
    expect(r).toEqual([{ hoja: 'Mercancias', fila: 22, campo: 'Fracción Arancelaria', codigo: 'E01' }]);
    expect(JSON.stringify(r)).not.toContain('12345678');
  });
  it('acota el texto y la cantidad, y tira lo que no es objeto o no trae ubicación', () => {
    const muchos = Array.from({ length: 80 }, (_, i) => ({ campo: `c${i}` }));
    expect(sanearErrores(muchos)).toHaveLength(50);
    expect(sanearErrores([{ campo: 'x'.repeat(500) }])[0].campo).toHaveLength(80);
    expect(sanearErrores(['texto', null, 7, {}, { mensaje: 'solo mensaje' }, { fila: -1 }, { fila: 2.5 }])).toEqual([]);
  });
});

describe('repoEnvios real — consultas', () => {
  it('leer: ancla tenant e id y devuelve el detalle', async () => {
    porTabla = [{ error: null, data: { id: 'e1', tenant_id: A, documento_id: 'd1', version_doc: 2, idempotency_key: 'llave-1234', estado: 'listo', plantilla: 'normal', intentos: 1, proxima_revision: null, procesando_hasta: null, errores: [], created_at: '2026-10-02T11:00:00Z', updated_at: '2026-10-02T11:00:00Z' } }];
    const e = await repoEnvios.leer(A, 'e1');
    expect(e).toMatchObject({ id: 'e1', tenantId: A, versionDoc: 2, estado: 'listo', errores: [], alertaEnviadaEn: null });
    expect(filtros(llamadas[0])).toEqual([['tenant_id', A], ['id', 'e1']]);
  });

  it('leer: sin fila es null; un error de la base se LANZA (no se lee como «no hay envío»)', async () => {
    porTabla = [{ error: null, data: null }];
    expect(await repoEnvios.leer(A, 'x')).toBeNull();
    porTabla = [{ error: { message: 'statement timeout', code: '57014' }, data: null }];
    await expect(repoEnvios.leer(A, 'x')).rejects.toThrow(/statement timeout/);
  });

  it('actualizar: condicional por estado y por tenant, con updated_at; false si nada coincidió', async () => {
    porTabla = [{ error: null, data: [{ id: 'e1' }] }, { error: null, data: [] }];
    expect(await repoEnvios.actualizar(A, 'e1', ['listo'], { estado: 'enviando', soltarLease: false })).toBe(true);
    const upd = llamadas[0].ops.find(([m]) => m === 'update')![1][0] as Record<string, unknown>;
    expect(upd.estado).toBe('enviando');
    expect(typeof upd.updated_at).toBe('string');
    expect(filtros(llamadas[0])).toEqual([['tenant_id', A], ['id', 'e1']]);
    expect(llamadas[0].ops.find(([m]) => m === 'in')![1]).toEqual(['estado', ['listo']]);
    expect(await repoEnvios.actualizar(A, 'e1', ['listo'], { estado: 'enviando' })).toBe(false);
  });

  it('actualizar: errores saneados, lease suelto, «enviado» exige enviadoEn y sin estado de origen no hay UPDATE', async () => {
    porTabla = [{ error: null, data: [{ id: 'e1' }] }];
    await repoEnvios.actualizar(A, 'e1', ['enviando'], { estado: 'rechazado_tms', errores: [{ hoja: 'H', fila: 3, campo: 'C', codigo: 'X', mensaje: 'secreto' } as never], soltarLease: true, proximaRevision: null });
    const upd = llamadas[0].ops.find(([m]) => m === 'update')![1][0] as Record<string, unknown>;
    expect(upd.errores).toEqual([{ hoja: 'H', fila: 3, campo: 'C', codigo: 'X' }]);
    expect(upd.procesando_hasta).toBeNull();
    expect(upd.proxima_revision).toBeNull();
    llamadas.length = 0;
    await expect(repoEnvios.actualizar(A, 'e1', ['enviando'], { estado: 'enviado' })).rejects.toThrow(/enviadoEn/);
    await expect(repoEnvios.actualizar(A, 'e1', [], { intentos: 1 })).rejects.toThrow(/estado de origen/);
    expect(llamadas).toHaveLength(0);
  });

  it('actualizar: un error de la base se lanza', async () => {
    porTabla = [{ error: { message: 'permiso denegado' }, data: null }];
    await expect(repoEnvios.actualizar(A, 'e1', ['listo'], { intentos: 2 })).rejects.toThrow(/permiso denegado/);
  });

  it('listarPorDocumento: ancla tenant y documento, el más nuevo primero', async () => {
    porTabla = [{ error: null, data: [] }];
    expect(await repoEnvios.listarPorDocumento(A, 'd1')).toEqual([]);
    expect(filtros(llamadas[0])).toEqual([['tenant_id', A], ['documento_id', 'd1']]);
    expect(llamadas[0].ops.find(([m]) => m === 'order')![1]).toEqual(['created_at', { ascending: false }]);
  });

  it('contarPorEstado: un conteo exacto por cada estado, anclado a la flota y a la fecha; todos los estados salen', async () => {
    porTabla = real.ESTADOS_ENVIO.map((_, i) => ({ error: null, data: null, count: i }));
    const r = await repoEnvios.contarPorEstado(A, T0);
    expect(Object.keys(r).sort()).toEqual([...real.ESTADOS_ENVIO].sort());
    expect(r.pendiente_prechequeo).toBe(0);
    expect(r.descartado).toBe(8);
    expect(llamadas).toHaveLength(real.ESTADOS_ENVIO.length);
    for (const l of llamadas) {
      expect(filtros(l).find(([c]) => c === 'tenant_id')).toEqual(['tenant_id', A]);
      expect(l.ops.find(([m]) => m === 'gte')![1]).toEqual(['created_at', T0.toISOString()]);
    }
  });

  it('contarPorEstado: sin conteo en la respuesta o con error se LANZA (jamás un cero inventado)', async () => {
    porTabla = real.ESTADOS_ENVIO.map(() => ({ error: null, data: null, count: null }));
    await expect(repoEnvios.contarPorEstado(A, T0)).rejects.toThrow(/conteo/);
    porTabla = real.ESTADOS_ENVIO.map(() => ({ error: { message: 'boom' }, data: null }));
    await expect(repoEnvios.contarPorEstado(A, T0)).rejects.toThrow(/boom/);
  });

  it('toda consulta a tabla lleva .eq(tenant_id)', async () => {
    porTabla = [{ error: null, data: null }, { error: null, data: [] }, { error: null, data: [] }];
    await repoEnvios.leer(A, 'e'); await repoEnvios.actualizar(A, 'e', ['listo'], { intentos: 1 }); await repoEnvios.listarPorDocumento(A, 'd');
    expect(llamadas).toHaveLength(3);
    expect(tenantEnTodas()).toBe(true);
  });
});

describe('repoEnvios real — reclamo y candado de alerta (RPC de la 0790)', () => {
  it('reclamar: pasa límite y lease, y mapea las filas', async () => {
    rpcs.cp_envio_reclamar = { error: null, data: [{ id: 'e1', tenant_id: A, documento_id: 'd1', estado: 'listo', intentos: 1, idempotency_key: 'llave-1234' }] };
    const r = await repoEnvios.reclamar(10);
    expect(r).toEqual({ ok: true, envios: [{ id: 'e1', tenantId: A, documentoId: 'd1', estado: 'listo', intentos: 1, idempotencyKey: 'llave-1234' }] });
    expect(llamadas[0]).toMatchObject({ rpc: 'cp_envio_reclamar', args: { p_limite: 10, p_lease_segundos: 120 } });
  });

  it('SIN la 0790: `sin_migracion` (el worker queda apagado), no lanza', async () => {
    rpcs.cp_envio_reclamar = { data: null, error: AUSENTE };
    expect(await repoEnvios.reclamar(10)).toEqual({ ok: false, motivo: 'sin_migracion' });
    rpcs.cp_envio_reclamar = { data: null, error: { message: 'no existe', code: '42883' } };
    expect(await repoEnvios.reclamar(10)).toEqual({ ok: false, motivo: 'sin_migracion' });
  });

  it('un error que NO es «la función no existe» se lanza (jamás se lee como «no hay nada que enviar»)', async () => {
    rpcs.cp_envio_reclamar = { data: null, error: { message: 'statement timeout', code: '57014' } };
    await expect(repoEnvios.reclamar(10)).rejects.toThrow(/statement timeout/);
  });

  it('marcarAlerta: ganado / perdido según la RPC; sin 0790 `sin_migracion`; otro error se lanza', async () => {
    rpcs.cp_envio_marcar_alerta = { data: true, error: null };
    expect(await repoEnvios.marcarAlerta(A, 'e1')).toBe('ganado');
    expect(llamadas[0].args).toEqual({ p_tenant: A, p_id: 'e1' });
    rpcs.cp_envio_marcar_alerta = { data: false, error: null };
    expect(await repoEnvios.marcarAlerta(A, 'e1')).toBe('perdido');
    rpcs.cp_envio_marcar_alerta = { data: null, error: AUSENTE };
    expect(await repoEnvios.marcarAlerta(A, 'e1')).toBe('sin_migracion');
    rpcs.cp_envio_marcar_alerta = { data: null, error: { message: 'timeout', code: '57014' } };
    await expect(repoEnvios.marcarAlerta(A, 'e1')).rejects.toThrow(/timeout/);
  });

  it('liberarAlerta: devuelve si soltó; un error se lanza', async () => {
    rpcs.cp_envio_liberar_alerta = { data: true, error: null };
    expect(await repoEnvios.liberarAlerta(A, 'e1')).toBe(true);
    expect(llamadas[0].args).toEqual({ p_tenant: A, p_id: 'e1' });
    rpcs.cp_envio_liberar_alerta = { data: false, error: null };
    expect(await repoEnvios.liberarAlerta(A, 'e1')).toBe(false);
    rpcs.cp_envio_liberar_alerta = { data: null, error: { message: 'x' } };
    await expect(repoEnvios.liberarAlerta(A, 'e1')).rejects.toThrow(/x/);
  });
});

describe('doble en memoria — el mismo contrato', () => {
  it('insertar: idempotente por llave; un solo envío ACTIVO por documento; uno terminal no estorba', async () => {
    const a = await repoEnviosFalso.insertar(A, { documentoId: 'd1', versionDoc: 1, idempotencyKey: 'llave-0001', plantilla: 'normal' });
    expect(a).toMatchObject({ creado: true, envio: { estado: 'pendiente_prechequeo', intentos: 0 } });
    expect(await repoEnviosFalso.insertar(A, { documentoId: 'd1', versionDoc: 1, idempotencyKey: 'llave-0001', plantilla: 'normal' })).toMatchObject({ creado: false });
    expect(await repoEnviosFalso.insertar(A, { documentoId: 'd1', versionDoc: 2, idempotencyKey: 'llave-0002', plantilla: 'normal' })).toBeNull();
    await repoEnviosFalso.actualizar(A, a!.envio.id, ['pendiente_prechequeo'], { estado: 'rechazado_tms' });
    expect(await repoEnviosFalso.insertar(A, { documentoId: 'd1', versionDoc: 2, idempotencyKey: 'llave-0002', plantilla: 'nueva' })).toMatchObject({ creado: true });
    expect((await repoEnviosFalso.listarPorDocumento(A, 'd1')).map((e) => e.versionDoc)).toEqual([2, 1]);
  });

  it('aislamiento por tenant: otra flota no lee, no actualiza, no cuenta ni lista', async () => {
    const e = sembrarEnvio(A, { documentoId: 'd1', estado: 'listo' });
    expect(await repoEnviosFalso.leer(B, e.id)).toBeNull();
    expect(await repoEnviosFalso.actualizar(B, e.id, ['listo'], { estado: 'descartado' })).toBe(false);
    expect(await repoEnviosFalso.marcarAlerta(B, e.id)).toBe('perdido');
    expect(await repoEnviosFalso.listarPorDocumento(B, 'd1')).toEqual([]);
    expect((await repoEnviosFalso.contarPorEstado(B, new Date(0))).listo).toBe(0);
    expect((await repoEnviosFalso.leer(A, e.id))!.estado).toBe('listo');
  });

  it('actualizar es condicional: si otra pasada ya lo movió, devuelve false y no pisa', async () => {
    const e = sembrarEnvio(A, { documentoId: 'd1', estado: 'enviando' });
    expect(await repoEnviosFalso.actualizar(A, e.id, ['enviando'], { estado: 'enviado', enviadoEn: T0.toISOString(), referenciaTms: 'ref-1' })).toBe(true);
    expect(await repoEnviosFalso.actualizar(A, e.id, ['enviando'], { estado: 'error_transitorio' })).toBe(false);
    expect((await repoEnviosFalso.leer(A, e.id))).toMatchObject({ estado: 'enviado', referenciaTms: 'ref-1' });
    await expect(repoEnviosFalso.actualizar(A, e.id, ['enviado'], { estado: 'enviado' })).rejects.toThrow(/enviadoEn/);
  });

  it('actualizar sanea los errores igual que el real', async () => {
    const e = sembrarEnvio(A, { documentoId: 'd1', estado: 'enviando' });
    await repoEnviosFalso.actualizar(A, e.id, ['enviando'], { estado: 'rechazado_tms', errores: [{ hoja: 'M', fila: 22, campo: 'F', mensaje: 'valor 999' } as never] });
    expect((await repoEnviosFalso.leer(A, e.id))!.errores).toEqual([{ hoja: 'M', fila: 22, campo: 'F' }]);
  });

  it('RECLAMO EXCLUSIVO: dos pasadas seguidas no reciben el mismo envío; cada reclamo suma un intento y pone lease', async () => {
    sembrarEnvio(A, { documentoId: 'd1', estado: 'listo' });
    sembrarEnvio(A, { documentoId: 'd2', estado: 'listo' });
    const p1 = await repoEnviosFalso.reclamar(10);
    const p2 = await repoEnviosFalso.reclamar(10);
    expect(p1.ok && p1.envios.map((x) => x.documentoId).sort()).toEqual(['d1', 'd2']);
    expect(p1.ok && p1.envios.every((x) => x.intentos === 1)).toBe(true);
    expect(p2).toEqual({ ok: true, envios: [] });
  });

  it('reclamo concurrente: 20 envíos, dos pasadas en paralelo con tope 12 → 20 reclamados, 0 repetidos', async () => {
    for (let i = 0; i < 20; i++) sembrarEnvio(A, { documentoId: `d${i}`, estado: 'listo' });
    const [x, y] = await Promise.all([repoEnviosFalso.reclamar(12), repoEnviosFalso.reclamar(12)]);
    const ids = [...(x.ok ? x.envios : []), ...(y.ok ? y.envios : [])].map((e) => e.id);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
  });

  it('respeta límite, estados vivos y proxima_revision; un lease vencido se recupera', async () => {
    sembrarEnvio(A, { documentoId: 'd1', estado: 'listo' });
    sembrarEnvio(A, { documentoId: 'd2', estado: 'enviado' });
    sembrarEnvio(A, { documentoId: 'd3', estado: 'rechazado_tms' });
    sembrarEnvio(A, { documentoId: 'd4', estado: 'subido_a_mano' });
    sembrarEnvio(A, { documentoId: 'd5', estado: 'descartado' });
    sembrarEnvio(A, { documentoId: 'd6', estado: 'pendiente_reque', proximaRevision: new Date(T0.getTime() + 60_000).toISOString() });
    sembrarEnvio(A, { documentoId: 'd7', estado: 'enviando', procesandoHasta: new Date(T0.getTime() - 1_000).toISOString() });
    sembrarEnvio(A, { documentoId: 'd8', estado: 'enviando', procesandoHasta: new Date(T0.getTime() + 60_000).toISOString() });
    const r = await repoEnviosFalso.reclamar(10);
    expect(r.ok && r.envios.map((x) => x.documentoId).sort()).toEqual(['d1', 'd7']);
    // El lease vence y la fila vuelve a ser reclamable; "pendiente_reque" cuando le toca.
    estadoEnvios.reloj.ahora = () => new Date(T0.getTime() + 121_000);
    const r2 = await repoEnviosFalso.reclamar(10);
    expect(r2.ok && r2.envios.map((x) => x.documentoId).sort()).toEqual(['d1', 'd6', 'd7', 'd8']);
    const solo1 = await repoEnviosFalso.reclamar(1);
    expect(solo1).toEqual({ ok: true, envios: [] }); // todos con lease vigente
    expect(await repoEnviosFalso.reclamar(0).catch((e: Error) => e.message)).toMatch(/fuera de rango/);
  });

  it('soltarLease deja el envío reclamable cuando le toque', async () => {
    const e = sembrarEnvio(A, { documentoId: 'd1', estado: 'listo' });
    await repoEnviosFalso.reclamar(5);
    expect(await repoEnviosFalso.reclamar(5)).toEqual({ ok: true, envios: [] });
    await repoEnviosFalso.actualizar(A, e.id, ['listo'], { estado: 'error_transitorio', soltarLease: true, proximaRevision: T0.toISOString() });
    const r = await repoEnviosFalso.reclamar(5);
    expect(r.ok && r.envios.map((x) => [x.id, x.estado, x.intentos])).toEqual([[e.id, 'error_transitorio', 2]]);
  });

  it('SIN la 0790 (`sinMigracion`): el reclamo y el candado contestan «sin_migracion» sin lanzar', async () => {
    estadoEnvios.sinMigracion = true;
    expect(await repoEnviosFalso.reclamar(10)).toEqual({ ok: false, motivo: 'sin_migracion' });
    expect(await repoEnviosFalso.marcarAlerta(A, 'e1')).toBe('sin_migracion');
  });

  it('CANDADO DE ALERTA ÚNICA: tres intentos, un solo ganador; soltar permite volver a ganar', async () => {
    const e = sembrarEnvio(A, { documentoId: 'd1', estado: 'pendiente_reque' });
    const r = [await repoEnviosFalso.marcarAlerta(A, e.id), await repoEnviosFalso.marcarAlerta(A, e.id), await repoEnviosFalso.marcarAlerta(A, e.id)];
    expect(r).toEqual(['ganado', 'perdido', 'perdido']);
    expect((await repoEnviosFalso.leer(A, e.id))!.alertaEnviadaEn).not.toBeNull();
    expect(await repoEnviosFalso.liberarAlerta(A, e.id)).toBe(true);
    expect(await repoEnviosFalso.liberarAlerta(A, e.id)).toBe(false);
    expect(await repoEnviosFalso.marcarAlerta(A, e.id)).toBe('ganado');
  });

  it('contarPorEstado: solo lo creado desde la fecha, todos los estados presentes', async () => {
    sembrarEnvio(A, { documentoId: 'd1', estado: 'enviado', createdAt: '2026-10-01T00:00:00Z' });
    sembrarEnvio(A, { documentoId: 'd2', estado: 'enviado', createdAt: '2026-09-01T00:00:00Z' });
    sembrarEnvio(A, { documentoId: 'd3', estado: 'rechazado_tms', createdAt: '2026-10-01T00:00:00Z' });
    sembrarEnvio(B, { documentoId: 'd4', estado: 'enviado', createdAt: '2026-10-01T00:00:00Z' });
    const c = await repoEnviosFalso.contarPorEstado(A, new Date('2026-09-15T00:00:00Z'));
    expect(c).toMatchObject({ enviado: 1, rechazado_tms: 1, listo: 0, descartado: 0 });
    expect(Object.keys(c).sort()).toEqual([...real.ESTADOS_ENVIO].sort());
    const todos: EstadoEnvioTms[] = Object.keys(c) as EstadoEnvioTms[];
    expect(todos).toHaveLength(9);
  });

  it('errores de base: un fallo forzado se lanza, no se lee como vacío', async () => {
    estadoEnvios.fallar.set('reclamar', new Error('base caída'));
    await expect(repoEnviosFalso.reclamar(5)).rejects.toThrow(/base caída/);
  });
});
