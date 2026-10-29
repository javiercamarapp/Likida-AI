import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// repo_correo.ts — lo que añade la migración 0940 (A1-01): fecha de corte del arranque y entregas que nacen `omitida`. Misma técnica que `repo_correo.test.ts`
// (la base es un registrador de cadenas). Todo sintético.
// ═══════════════════════════════════════════════════════════════════════════

type Op = [string, ...unknown[]];
interface Llamada { tabla: string; ops: Op[] }
type Resp = { data?: unknown; error?: { message: string; code?: string } | null; count?: number | null };
const llamadas: Llamada[] = [];
let respuestas: Resp[] = [];

function constructor(tabla: string) {
  const ll: Llamada = { tabla, ops: [] };
  llamadas.push(ll);
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'in', 'gte', 'gt', 'lt', 'or', 'is', 'not', 'order', 'range', 'limit', 'neq']) {
    b[m] = (...a: unknown[]) => { ll.ops.push([m, ...a]); return b; };
  }
  const resolver = (): Resp => respuestas.shift() ?? { data: [], error: null, count: 0 };
  b.maybeSingle = async () => { ll.ops.push(['maybeSingle']); return resolver(); };
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(resolver()).then(res, rej);
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: constructor }) }));
vi.mock('../presupuesto', async (orig) => ({ ...(await orig<typeof import('../presupuesto')>()), acotada: (q: unknown) => q }));
const warn = vi.fn();
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: (...a: unknown[]) => warn(...a), error: vi.fn() } }));
vi.mock('@/lib/auth/perfil_tenant', () => ({ perfilDeTenant: async () => (globalThis as { __perfilPrueba?: string | null }).__perfilPrueba ?? null }));

const r = await import('./repo_correo');
const { DatoInvalido } = await import('../errores');

const T = 'tenant-sintetico-1';
const sinColumna0940 = { data: null, error: { message: 'column liquidacion_correo_config.no_enviar_antes_de does not exist', code: '42703' } };
const select = (l: Llamada) => String(l.ops.find((o) => o[0] === 'select')?.[1]);
const upsert = (l: Llamada) => l.ops.find((o) => o[0] === 'upsert')?.[1] as Record<string, unknown>;

beforeEach(() => { (globalThis as { __perfilPrueba?: string | null }).__perfilPrueba = null; llamadas.length = 0; respuestas = []; warn.mockClear(); });

describe('A1-01 · lectura de la fecha de corte', () => {
  it('traduce no_enviar_antes_de (date) a AAAA-MM-DD; sin fila o sin valor ⇒ sin corte', async () => {
    respuestas = [{ data: { canal: 'correo', activa: true, no_enviar_antes_de: '2026-11-02' }, error: null }];
    const c = await r.leerConfigCorreo(T);
    expect(c.ok && c.valor.noEnviarAntes).toBe('2026-11-02');
    expect(select(llamadas[0])).toContain('no_enviar_antes_de');
    respuestas = [{ data: { canal: 'correo', activa: true, no_enviar_antes_de: null }, error: null }];
    expect((await r.leerConfigCorreo(T)).ok && true).toBe(true);
    respuestas = [{ data: null, error: null }];
    const d = await r.leerConfigCorreo(T);
    expect(d.ok && d.valor.noEnviarAntes).toBeNull();
  });

  it('una base con la 0933 pero SIN la 0940 vuelve a leer con las columnas de la 0933 (los revisores no se pierden) y no hay corte', async () => {
    respuestas = [sinColumna0940, { data: { canal: 'correo', activa: true, revisores: [{ departamento: 'nomina', correo: 'n@ejemplo.test' }], primer_mes_hasta: '2026-11-14' }, error: null }];
    const c = await r.leerConfigCorreo(T);
    expect(c.ok && c.valor).toMatchObject({ noEnviarAntes: null, primerMesHasta: '2026-11-14', revisores: [{ departamento: 'nomina', correo: 'n@ejemplo.test' }] });
    expect(llamadas).toHaveLength(2);
    expect(select(llamadas[1])).toContain('revisores');
    expect(select(llamadas[1])).not.toContain('no_enviar_antes_de');
    expect(warn).toHaveBeenCalledWith('liqcorreo.config_sin_0940', expect.anything());
  });
});

describe('H759-2 · base sin la 0940 bajo cinco_agentes', () => {
  it('lanza en vez de leer «sin corte» (fail-closed); sin perfil sigue leyendo sin la columna', async () => {
    (globalThis as { __perfilPrueba?: string | null }).__perfilPrueba = 'cinco_agentes';
    respuestas = [sinColumna0940, { data: { canal: 'correo', activa: true }, error: null }];
    await expect(r.leerConfigCorreo(T)).rejects.toThrow(/fecha de corte/);
    expect(llamadas).toHaveLength(1); // no hizo la segunda lectura sin la columna
    llamadas.length = 0;
    (globalThis as { __perfilPrueba?: string | null }).__perfilPrueba = null;
    respuestas = [sinColumna0940, { data: { canal: 'correo', activa: true }, error: null }];
    const c = await r.leerConfigCorreo(T);
    expect(c.ok && c.valor.noEnviarAntes).toBeNull();
  });
});

describe('A1-01 · guardar la fecha de corte', () => {
  const base = { ...r.CONFIG_CORREO_POR_DEFECTO, canal: 'correo' as const };

  it('upsert anclado al tenant con la fecha; null se guarda como null (quitar el corte)', async () => {
    respuestas = [{ data: [{ tenant_id: T }], error: null }];
    await r.guardarConfigCorreo(T, { ...base, noEnviarAntes: '2026-11-02' }, 'oficina');
    expect(upsert(llamadas[0])).toMatchObject({ tenant_id: T, no_enviar_antes_de: '2026-11-02' });
    respuestas = [{ data: [{ tenant_id: T }], error: null }];
    await r.guardarConfigCorreo(T, { ...base, noEnviarAntes: null }, 'oficina');
    expect(upsert(llamadas[1])).toMatchObject({ no_enviar_antes_de: null });
  });

  it('una fecha que no es un día se rechaza antes de tocar la base', async () => {
    for (const mala of ['02/11/2026', '2026-13-45', '2026-11-2', 'mañana']) {
      await expect(r.guardarConfigCorreo(T, { ...base, noEnviarAntes: mala }, null)).rejects.toThrow(DatoInvalido);
    }
    expect(llamadas).toHaveLength(0);
  });

  it('base SIN la 0940: con corte que guardar dice qué falta y no finge; sin corte guarda como siempre', async () => {
    respuestas = [sinColumna0940];
    await expect(r.guardarConfigCorreo(T, { ...base, noEnviarAntes: '2026-11-02' }, null)).rejects.toThrow(/migración 0940/);
    llamadas.length = 0;
    respuestas = [sinColumna0940, { data: [{ tenant_id: T }], error: null }];
    await r.guardarConfigCorreo(T, { ...base, noEnviarAntes: null }, null);
    expect(llamadas).toHaveLength(2);
    expect('no_enviar_antes_de' in upsert(llamadas[1])).toBe(false);
  });
});

describe('Ola 10 · activar el envio sin fecha de corte (solo perfil cinco_agentes)', () => {
  const activa = { ...r.CONFIG_CORREO_POR_DEFECTO, canal: 'correo' as const, activa: true, responderA: 'respuestas@ejemplo.test' };
  const poner = (p: string | null) => { (globalThis as { __perfilPrueba?: string | null }).__perfilPrueba = p; };

  it('cinco_agentes: activar SIN fecha de corte se rechaza antes de tocar la base', async () => {
    poner('cinco_agentes');
    await expect(r.guardarConfigCorreo(T, { ...activa, noEnviarAntes: null }, 'oficina')).rejects.toThrow(/fecha de corte/);
    expect(llamadas).toHaveLength(0);
  });

  it('cinco_agentes: activar CON fecha de corte guarda; dejar apagado sin fecha tambien guarda', async () => {
    poner('cinco_agentes');
    respuestas = [{ data: [{ tenant_id: T }], error: null }];
    await r.guardarConfigCorreo(T, { ...activa, noEnviarAntes: '2026-11-02' }, 'oficina');
    expect(upsert(llamadas[0])).toMatchObject({ activa: true, no_enviar_antes_de: '2026-11-02' });
    respuestas = [{ data: [{ tenant_id: T }], error: null }];
    await r.guardarConfigCorreo(T, { ...activa, activa: false, noEnviarAntes: null }, 'oficina');
    const ups = llamadas.filter((l) => l.ops.some((o) => o[0] === 'upsert'));
    expect(upsert(ups[ups.length - 1])).toMatchObject({ activa: false });
  });

  it('flota sin perfil (ya activa): activar sin fecha de corte sigue guardando como siempre', async () => {
    poner(null);
    respuestas = [{ data: [{ tenant_id: T }], error: null }];
    await r.guardarConfigCorreo(T, { ...activa, noEnviarAntes: null }, 'oficina');
    expect(upsert(llamadas[0])).toMatchObject({ activa: true, no_enviar_antes_de: null });
  });
});

describe('A1-01/A1-02 · entregas omitidas', () => {
  it('insertarEntregas: una entrega omitida viaja con estado y motivo; una normal no lleva estado (nace pendiente)', async () => {
    respuestas = [{ data: [{ id: 'a' }, { id: 'b' }], error: null }];
    await r.insertarEntregas(T, [
      { liquidacionExternaId: 'l1', rol: 'operador', correo: 'Op@Ejemplo.test', estado: 'omitida', ultimoError: 'omitida: antes del corte' },
      { liquidacionExternaId: 'l1', rol: 'rh', correo: 'rh@ejemplo.test' },
    ]);
    const filas = llamadas[0].ops.find((o) => o[0] === 'insert')?.[1] as Array<Record<string, unknown>>;
    expect(filas[0]).toMatchObject({ estado: 'omitida', ultimo_error: 'omitida: antes del corte', correo: 'op@ejemplo.test' });
    expect('estado' in filas[1]).toBe(false);
  });

  it('omitirEntregasPendientes: UPDATE anclado a la flota y a las liquidaciones, solo desde pendiente/enviando, y devuelve cuántas cambió', async () => {
    respuestas = [{ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], error: null }];
    const n = await r.omitirEntregasPendientes(T, ['l1', 'l2'], 'omitida: reemplazada por una corrección');
    expect(n).toBe(3);
    const ops = llamadas[0].ops;
    expect(ops).toContainEqual(['eq', 'tenant_id', T]);
    expect(ops).toContainEqual(['in', 'liquidacion_externa_id', ['l1', 'l2']]);
    expect(ops).toContainEqual(['in', 'estado', ['pendiente', 'enviando']]);
    expect(ops.find((o) => o[0] === 'update')?.[1]).toMatchObject({ estado: 'omitida', ultimo_error: 'omitida: reemplazada por una corrección', claim_token: null, claim_expira_en: null });
  });

  it('omitirEntregasPendientes: sin liquidaciones no toca la base; un error de base se lanza (nunca «0 omitidas» en silencio)', async () => {
    expect(await r.omitirEntregasPendientes(T, [], 'x')).toBe(0);
    expect(llamadas).toHaveLength(0);
    respuestas = [{ data: null, error: { message: 'conexión rota' } }];
    await expect(r.omitirEntregasPendientes(T, ['l1'], 'x')).rejects.toThrow(/conexión rota/);
  });
});
