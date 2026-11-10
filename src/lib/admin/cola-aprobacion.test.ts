import { describe, it, expect, vi, beforeEach } from 'vitest';

type Reg = { tabla: string; op: string; payload: Record<string, unknown> | null; filtros: Array<[string, string, unknown]> };
const regs: Reg[] = [];
const respuestas = new Map<string, Array<{ data: unknown; error: { message: string } | null }>>();
function builder(tabla: string) {
  const r: Reg = { tabla, op: 'select', payload: null, filtros: [] };
  regs.push(r);
  const resp = () => {
    const c = respuestas.get(`${tabla}:${r.op}`);
    return c && c.length ? c.shift()! : { data: [], error: null };
  };
  const b: Record<string, unknown> = {};
  const f = (n: string) => (c: string, v: unknown) => { r.filtros.push([n, c, v]); return b; };
  Object.assign(b, {
    select: () => b,
    update: (p: Record<string, unknown>) => { r.op = 'update'; r.payload = p; return b; },
    eq: f('eq'), lt: f('lt'), in: f('in'),
    order: () => b, range: () => b,
    maybeSingle: () => Promise.resolve(resp()),
    then: (a: (x: unknown) => unknown, c: (e: unknown) => unknown) => Promise.resolve().then(resp).then(a, c),
  });
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));
const anotar = vi.fn(async (..._a: unknown[]) => true);
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: (...a: unknown[]) => anotar(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const m = await import('./cola-aprobacion');
const AHORA = Date.parse('2026-11-10T12:00:00Z');
const fila = (id: string, tipo: string, dias: number) => ({
  id, tipo, agente: 'ag', creado_en: new Date(AHORA - dias * 86_400_000).toISOString(),
});

beforeEach(() => { regs.length = 0; respuestas.clear(); anotar.mockClear(); });

describe('parámetros', () => {
  it('por omisión: 30 días, lote de 50', () => {
    expect(m.normalizarParametros()).toEqual({ dias: 30, limite: 50, tipos: null });
  });
  it('rechaza 0 días, límites absurdos y tipos mal formados', () => {
    expect(() => m.normalizarParametros({ dias: 0 })).toThrow();
    expect(() => m.normalizarParametros({ dias: 1.5 })).toThrow();
    expect(() => m.normalizarParametros({ limite: 201 })).toThrow();
    expect(() => m.normalizarParametros({ tipos: [] })).toThrow();
    expect(() => m.normalizarParametros({ tipos: ['X; drop'] })).toThrow();
  });
  it('días configurables', () => {
    expect(m.normalizarParametros({ dias: 7 }).dias).toBe(7);
    expect(m.corteDeVencimiento(AHORA, 7)).toBe('2026-11-03T12:00:00.000Z');
  });
});

describe('contarVencidas (dry-run)', () => {
  it('cuenta y desglosa sin escribir', async () => {
    respuestas.set('cola_aprobacion:select', [{ data: [fila('1', 'parte_a', 70), fila('2', 'parte_a', 40), fila('3', 'correo_frio', 31)], error: null }]);
    const r = await m.contarVencidas({ dias: 30, limite: 2 }, AHORA);
    expect(r).toMatchObject({ vencidas: 3, enElLote: 2, porTipo: { parte_a: 2, correo_frio: 1 } });
    expect(regs.some((x) => x.op === 'update')).toBe(false);
    expect(regs[0].filtros).toContainEqual(['lt', 'creado_en', '2026-10-11T12:00:00.000Z']);
  });
  it('si la base falla, LANZA (no devuelve 0)', async () => {
    respuestas.set('cola_aprobacion:select', [{ data: null, error: { message: 'caída' } }]);
    await expect(m.contarVencidas({}, AHORA)).rejects.toThrow(/caída/);
  });
});

describe('vaciarVencidas', () => {
  it('dry-run por omisión: no actualiza ni anota', async () => {
    respuestas.set('cola_aprobacion:select', [{ data: [fila('1', 't1', 40)], error: null }]);
    const r = await m.vaciarVencidas('u1', {}, AHORA);
    expect(r).toMatchObject({ dryRun: true, resueltas: 0, restantes: 1 });
    expect(regs.some((x) => x.op === 'update')).toBe(false);
    expect(anotar).not.toHaveBeenCalled();
  });

  it('real: respeta el límite, ancla a pendiente, motiva y firma la bitácora', async () => {
    const filas = [fila('1', 't1', 90), fila('2', 't1', 80), fila('3', 't2', 40)];
    respuestas.set('cola_aprobacion:select', [{ data: filas, error: null }]);
    respuestas.set('app_user:select', [{ data: { email: 'a@x.mx', rol: 'superadmin' }, error: null }]);
    respuestas.set('cola_aprobacion:update', [{ data: [{ id: '1' }, { id: '2' }], error: null }]);
    const r = await m.vaciarVencidas('u1', { dryRun: false, limite: 2 }, AHORA);
    expect(r).toMatchObject({ dryRun: false, resueltas: 2, restantes: 1, ids: ['1', '2'], bitacoraEscrita: true });
    const upd = regs.find((x) => x.op === 'update')!;
    expect(upd.filtros).toContainEqual(['in', 'id', ['1', '2']]);
    expect(upd.filtros).toContainEqual(['eq', 'estado', 'pendiente']);
    expect(upd.payload).toMatchObject({ estado: 'rechazado', resuelto_por: 'u1' });
    expect(String(upd.payload!.motivo_rechazo)).toMatch(/más de 30 días/);
    expect(anotar).toHaveBeenCalledTimes(1);
    expect(anotar.mock.calls[0][0]).toMatchObject({ accion: 'cola.vencidas_archivadas', entidad: 'cola_aprobacion' });
  });

  it('un actor que no es superadmin no escribe nada', async () => {
    respuestas.set('cola_aprobacion:select', [{ data: [fila('1', 't1', 90)], error: null }]);
    respuestas.set('app_user:select', [{ data: { email: 'a@x.mx', rol: 'flota_admin' }, error: null }]);
    await expect(m.vaciarVencidas('u1', { dryRun: false }, AHORA)).rejects.toThrow(/superadmin/);
    expect(regs.some((x) => x.op === 'update')).toBe(false);
  });

  it('error del UPDATE: lanza y no anota', async () => {
    respuestas.set('cola_aprobacion:select', [{ data: [fila('1', 't1', 90)], error: null }]);
    respuestas.set('app_user:select', [{ data: { email: 'a@x.mx', rol: 'superadmin' }, error: null }]);
    respuestas.set('cola_aprobacion:update', [{ data: null, error: { message: 'boom' } }]);
    await expect(m.vaciarVencidas('u1', { dryRun: false }, AHORA)).rejects.toThrow(/boom/);
    expect(anotar).not.toHaveBeenCalled();
  });

  it('sin vencidas: no resuelve nada', async () => {
    const r = await m.vaciarVencidas('u1', { dryRun: false }, AHORA);
    expect(r).toMatchObject({ resueltas: 0, vencidas: 0 });
    expect(regs.some((x) => x.op === 'update')).toBe(false);
  });
});
