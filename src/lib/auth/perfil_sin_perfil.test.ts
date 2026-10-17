import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// T-PER-08 · «Sin perfil nada cambia» y falla cerrada de la lectura.
// Fija el contrato de `perfil_tenant.ts` en los DOS sentidos:
//   (1) sin fila + lectura exitosa  → null y TODAS las puertas permiten;
//   (2) tabla ausente               → sin perfil;
//   (3) error transitorio CON valor previo → el último conocido;
//   (4) error transitorio SIN valor previo → hoy se RESTRINGE (decisión de
//       Javier pendiente: ver preguntas-javier.md, T-PER-08). Estas pruebas lo
//       documentan; si Javier elige otra opción, cambian aquí.
// ═══════════════════════════════════════════════════════════════════════════

const redirect = vi.fn((_: string) => { throw new Error('NEXT_REDIRECT'); });
vi.mock('next/navigation', () => ({ redirect: (a: string) => redirect(a) }));

type Resp = { data: unknown; error: { message: string; code?: string } | null };
let porTenant = new Map<string, Resp>();
let lista: Resp = { data: [], error: null };
let lecturas = 0;
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      let tenant: string | null = null;
      b.select = () => b;
      b.eq = (_c: string, v: string) => { tenant = v; return b; };
      b.maybeSingle = async () => { lecturas++; return porTenant.get(tenant ?? '') ?? { data: null, error: null }; };
      b.then = (res: (v: unknown) => unknown) => Promise.resolve(lista).then(res);
      return b;
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const m = await import('./perfil_tenant');
const v = await import('./visibilidad');

beforeEach(() => {
  m.reiniciarCachePerfil();
  porTenant = new Map();
  lista = { data: [], error: null };
  lecturas = 0;
  redirect.mockClear();
});

const SIN = 't-sin';
const OTRO = 't-otro';
const CON = 't-con';
const cronesDeVercel: string[] = (JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8')).crons as { path: string }[])
  .map((c) => m.nombreDeCron(c.path));
const API_EJEMPLO = [
  '/api/dashboard/chat', '/api/v1/clientes', '/api/export/poliza', '/api/v1/peajes/desgloses',
  '/api/mcp', '/api/dashboard/cualquiera/nueva',
];

describe('(1) sin fila y lectura exitosa: TODAS las puertas permiten', () => {
  it('perfilDeTenant devuelve null y perfilRestringido false', async () => {
    expect(await m.perfilDeTenant(SIN)).toBeNull();
    expect(await m.perfilRestringido(SIN)).toBe(false);
    expect(lecturas).toBe(1);
  });

  it('exigirRutaDePerfil no redirige en NINGUNA ruta conocida ni en una nueva sin clasificar', async () => {
    const rutas = [...v.rutasConocidas(), '/dashboard/chat', '/dashboard/suscripcion', '/dashboard/modulo-nuevo-sin-clasificar'];
    expect(rutas.length).toBeGreaterThan(10);
    for (const r of rutas) await m.exigirRutaDePerfil(SIN, r);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('apiDenegadaPorPerfil nunca niega (ni rutas nuevas) y respuestaSiPerfilNiegaApi devuelve null', async () => {
    for (const p of API_EJEMPLO) {
      expect(await m.apiDenegadaPorPerfil(SIN, p)).toBe(false);
      expect(await m.respuestaSiPerfilNiegaApi(SIN, `https://x.test${p}`)).toBeNull();
    }
  });

  it('cada cron de vercel.json corre para la flota sin perfil: nadie que saltar', async () => {
    expect(cronesDeVercel.length).toBeGreaterThanOrEqual(19);
    lista = { data: [], error: null };
    for (const c of cronesDeVercel) {
      expect((await m.tenantsConPerfilASaltar(c)).size).toBe(0);
    }
    expect((await m.tenantsConPerfil()).size).toBe(0);
  });

  it('con OTRA flota con perfil, la flota sin perfil no aparece en la lista a saltar y sus filas pasan', async () => {
    lista = { data: [{ tenant_id: CON }], error: null };
    const saltar = await m.tenantsConPerfilASaltar('facturar');
    expect(saltar.has(SIN)).toBe(false);
    const filas = [{ id: SIN }, { id: CON }, { id: OTRO }];
    expect(m.sinTenantsDePerfil(filas, saltar, (f) => f.id).map((f) => f.id)).toEqual([SIN, OTRO]);
  });

  it('el perfil de una flota no contamina a otra', async () => {
    porTenant.set(CON, { data: { perfil: 'cinco_agentes' }, error: null });
    expect(await m.perfilDeTenant(CON)).toBe('cinco_agentes');
    expect(await m.perfilDeTenant(SIN)).toBeNull();
    await m.exigirRutaDePerfil(SIN, '/dashboard/chat');
    expect(redirect).not.toHaveBeenCalled();
  });

  it('sin tenant (null/undefined/vacío) tampoco hay perfil ni lectura', async () => {
    for (const t of [null, undefined, '']) expect(await m.perfilDeTenant(t)).toBeNull();
    expect(lecturas).toBe(0);
  });
});

describe('(2) tabla ausente: es "sin perfil"', () => {
  it.each(['42P01', 'PGRST205'])('código %s → null, se cachea y las puertas permiten', async (code) => {
    porTenant.set(SIN, { data: null, error: { message: 'no existe', code } });
    expect(await m.perfilDeTenant(SIN, 0)).toBeNull();
    expect(await m.perfilDeTenant(SIN, 1)).toBeNull();
    expect(lecturas).toBe(1);
    await m.exigirRutaDePerfil(SIN, '/dashboard/chat');
    expect(await m.apiDenegadaPorPerfil(SIN, '/api/dashboard/chat')).toBe(false);
  });

  it('en la lista de flotas, tabla ausente = ninguna flota con perfil (los crons corren)', async () => {
    lista = { data: null, error: { message: 'no existe', code: '42P01' } };
    expect((await m.tenantsConPerfil()).size).toBe(0);
    lista = { data: null, error: { message: 'no encontrada', code: 'PGRST205' } };
    expect((await m.tenantsConPerfilASaltar('facturar')).size).toBe(0);
  });
});

describe('(3) error transitorio CON valor previo: se conserva el último conocido', () => {
  it('flota sin perfil que ya se leyó: un bache NO la restringe', async () => {
    expect(await m.perfilDeTenant(SIN, 0)).toBeNull();
    porTenant.set(SIN, { data: null, error: { message: 'caída' } });
    expect(await m.perfilDeTenant(SIN, m.TTL_PERFIL_MS + 1)).toBeNull();
    await m.exigirRutaDePerfil(SIN, '/dashboard/chat');
    expect(redirect).not.toHaveBeenCalled();
  });

  it('flota con perfil que ya se leyó: un bache NO la libera', async () => {
    porTenant.set(CON, { data: { perfil: 'cinco_agentes' }, error: null });
    expect(await m.perfilDeTenant(CON, 0)).toBe('cinco_agentes');
    porTenant.set(CON, { data: null, error: { message: 'caída' } });
    expect(await m.perfilDeTenant(CON, m.TTL_PERFIL_MS + 1)).toBe('cinco_agentes');
    expect(await m.apiDenegadaPorPerfil(CON, '/api/dashboard/chat')).toBe(true);
  });

  it('el error no se cachea: al volver la base se lee el valor nuevo', async () => {
    expect(await m.perfilDeTenant(SIN, 0)).toBeNull();
    porTenant.set(SIN, { data: null, error: { message: 'caída' } });
    await m.perfilDeTenant(SIN, m.TTL_PERFIL_MS + 1);
    porTenant.set(SIN, { data: { perfil: 'cinco_agentes' }, error: null });
    expect(await m.perfilDeTenant(SIN, m.TTL_PERFIL_MS + 2)).toBe('cinco_agentes');
  });
});

describe('(4) error transitorio SIN valor previo: DECISIÓN DE JAVIER PENDIENTE (hoy se restringe)', () => {
  it('DOCUMENTA el efecto: una flota SIN perfil, en un cold start con la base caída, se ve restringida', async () => {
    porTenant.set(SIN, { data: null, error: { message: 'caída' } });
    expect(await m.perfilDeTenant(SIN, 0)).toBe('cinco_agentes'); // viola «sin perfil nada cambia» durante el bache
    await expect(m.exigirRutaDePerfil(SIN, '/dashboard/chat')).rejects.toThrow('NEXT_REDIRECT');
    expect(await m.apiDenegadaPorPerfil(SIN, '/api/dashboard/chat')).toBe(true);
    expect(await m.perfilRestringido(SIN)).toBe(true);
  });

  it('el efecto es transitorio: al segundo intento con la base sana la flota sin perfil vuelve a null', async () => {
    porTenant.set(SIN, { data: null, error: { message: 'caída' } });
    expect(await m.perfilDeTenant(SIN, 0)).toBe('cinco_agentes');
    porTenant.set(SIN, { data: null, error: null });
    expect(await m.perfilDeTenant(SIN, 1)).toBeNull();
    await m.exigirRutaDePerfil(SIN, '/dashboard/chat');
  });

  it('el bache afecta a CUALQUIER flota sin lectura previa, no solo a las que tuvieron perfil', async () => {
    for (const t of [SIN, OTRO]) porTenant.set(t, { data: null, error: { message: 'caída' } });
    expect(await m.perfilDeTenant(SIN, 0)).toBe('cinco_agentes');
    expect(await m.perfilDeTenant(OTRO, 0)).toBe('cinco_agentes');
  });

  it('palanca existente: con siNoSePuedeLeer="permitir" (pipeline del chofer) el mismo bache NO restringe', async () => {
    porTenant.set(SIN, { data: null, error: { message: 'caída' } });
    expect(await m.perfilDeTenant(SIN, 0, 'permitir')).toBeNull();
  });

  it('un cron de stand-by no corre para nadie si la lista no se puede leer (barrido, reintenta el siguiente tick)', async () => {
    lista = { data: null, error: { message: 'caída' } };
    await expect(m.tenantsConPerfilASaltar('facturar')).rejects.toThrow(/no se pudo leer/);
    await expect(m.tenantsConPerfil()).rejects.toThrow(/no se pudo leer/);
  });
});
