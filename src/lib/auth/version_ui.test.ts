import { describe, it, expect, vi, beforeEach } from 'vitest';

// La bandera del rediseño: resolución (env → cookie del superadmin → fila) y lectura con falla hacia v1.

type Resp = { data: unknown; error: { message: string; code?: string } | null };
let porTenant = new Map<string, Resp>();
let lecturas = 0;
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => {
      expect(t).toBe('tenant_ui');
      let tenant = '';
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = (_c: string, v: string) => { tenant = v; return b; };
      b.maybeSingle = async () => { lecturas++; return porTenant.get(tenant) ?? { data: null, error: null }; };
      return b;
    },
  }),
}));
vi.mock('next/navigation', () => ({ redirect: () => { throw new Error('NEXT_REDIRECT'); } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { versionUi, COOKIE_UI } = await import('./version_ui');
const { reiniciarCacheUi, versionUiDeTenant, TTL_PERFIL_MS } = await import('./perfil_tenant');

const jar = (v?: string) => ({ get: (n: string) => (n === COOKIE_UI && v ? { value: v } : undefined) });
const SIN_ENV = {} as NodeJS.ProcessEnv;

beforeEach(() => { reiniciarCacheUi(); porTenant = new Map(); lecturas = 0; });

describe('versionUi', () => {
  it('sin fila = v1', async () => {
    expect(await versionUi('t1', 'flota_admin', jar(), SIN_ENV)).toBe('v1');
  });
  it('con fila v2 = v2, y otro tenant no se contagia (sin fuga de caché)', async () => {
    porTenant.set('t-v2', { data: { version: 'v2' }, error: null });
    expect(await versionUi('t-v2', 'flota_admin', jar(), SIN_ENV)).toBe('v2');
    expect(await versionUi('t-otro', 'flota_admin', jar(), SIN_ENV)).toBe('v1');
    expect(await versionUi('t-v2', 'flota_admin', jar(), SIN_ENV)).toBe('v2');
  });
  it('LIKIDA_UI_V2_FORZAR=1 fuerza v2 sin consultar la base', async () => {
    expect(await versionUi('t1', 'flota_admin', jar(), { LIKIDA_UI_V2_FORZAR: '1' } as NodeJS.ProcessEnv)).toBe('v2');
    expect(lecturas).toBe(0);
  });
  it('LIKIDA_UI_V2_FORZAR se ignora en producción', async () => {
    const env = { LIKIDA_UI_V2_FORZAR: '1', VERCEL_ENV: 'production' } as NodeJS.ProcessEnv;
    expect(await versionUi('t1', 'flota_admin', jar(), env)).toBe('v1');
  });
  it('la cookie solo la honra el superadmin', async () => {
    expect(await versionUi('t1', 'superadmin', jar('v2'), SIN_ENV)).toBe('v2');
    expect(await versionUi('t1', 'flota_admin', jar('v2'), SIN_ENV)).toBe('v1');
    expect(await versionUi('t1', 'contador', jar('v2'), SIN_ENV)).toBe('v1');
  });
  it('la cookie v1 del superadmin gana a una fila v2; un valor raro se ignora', async () => {
    porTenant.set('t1', { data: { version: 'v2' }, error: null });
    expect(await versionUi('t1', 'superadmin', jar('v1'), SIN_ENV)).toBe('v1');
    expect(await versionUi('t1', 'superadmin', jar('xx'), SIN_ENV)).toBe('v2');
  });
  it('sin tenant = v1', async () => {
    expect(await versionUi(null, 'superadmin', jar(), SIN_ENV)).toBe('v1');
  });
});

describe('versionUiDeTenant: falla hacia v1', () => {
  it('tabla ausente (42P01 / PGRST205) = v1', async () => {
    porTenant.set('a', { data: null, error: { message: 'x', code: '42P01' } });
    porTenant.set('b', { data: null, error: { message: 'x', code: 'PGRST205' } });
    expect(await versionUiDeTenant('a')).toBe('v1');
    expect(await versionUiDeTenant('b')).toBe('v1');
  });
  it('error de lectura sin valor previo = v1; con valor previo conserva el último conocido', async () => {
    porTenant.set('t', { data: null, error: { message: 'caído' } });
    expect(await versionUiDeTenant('t')).toBe('v1');
    porTenant.set('t', { data: { version: 'v2' }, error: null });
    const t0 = 1_000;
    expect(await versionUiDeTenant('t', t0)).toBe('v2');
    porTenant.set('t', { data: null, error: { message: 'caído' } });
    expect(await versionUiDeTenant('t', t0 + TTL_PERFIL_MS + 1)).toBe('v2');
  });
  it('cachea 30 s y un valor desconocido es v1', async () => {
    porTenant.set('t', { data: { version: 'v9' }, error: null });
    expect(await versionUiDeTenant('t', 0)).toBe('v1');
    await versionUiDeTenant('t', 10);
    expect(lecturas).toBe(1);
  });
});
