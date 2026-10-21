import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// El perfil de tenant (0770) VISTO DESDE LOS GUARDAS: la lectura (con su caché
// y su falla cerrada) y lo que cada puerta hace con ella.
// ═══════════════════════════════════════════════════════════════════════════

const redirect = vi.fn((_: string) => { throw new Error('NEXT_REDIRECT'); });
vi.mock('next/navigation', () => ({ redirect: (a: string) => redirect(a) }));

type Resp = { data: unknown; error: { message: string; code?: string } | null };
let porTenant = new Map<string, Resp>();
let lista: Resp = { data: [], error: null };
let lecturas = 0;
/** Para el test de `acotada()`: cuando está prendido, la consulta de `tenantsConPerfil()` nunca resuelve por su cuenta —
 *  solo el tope de `acotada` (con temporizadores falsos) la hace contestar. */
let colgarLista = false;
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => {
      expect(t).toBe('tenant_perfil');
      const b: Record<string, unknown> = {};
      let tenant: string | null = null;
      b.select = () => b;
      b.eq = (_c: string, v: string) => { tenant = v; return b; };
      b.maybeSingle = async () => { lecturas++; return porTenant.get(tenant ?? '') ?? { data: null, error: null }; };
      b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        (colgarLista ? new Promise(() => {}) : Promise.resolve(lista)).then(res, rej);
      return b;
    },
  }),
}));
const logs = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger: logs }));

const m = await import('./perfil_tenant');

beforeEach(() => {
  m.reiniciarCachePerfil();
  porTenant = new Map();
  lista = { data: [], error: null };
  lecturas = 0;
  colgarLista = false;
  redirect.mockClear();
});

const CON = 't-con';
const SIN = 't-sin';
function conPerfil() { porTenant.set(CON, { data: { perfil: 'cinco_agentes' }, error: null }); }

describe('perfilDeTenant', () => {
  it('sin fila = null (comportamiento de siempre); con fila = el perfil', async () => {
    conPerfil();
    expect(await m.perfilDeTenant(SIN)).toBeNull();
    expect(await m.perfilDeTenant(CON)).toBe('cinco_agentes');
    expect(await m.perfilDeTenant(null)).toBeNull();
    expect(await m.perfilDeTenant(undefined)).toBeNull();
  });

  it('cachea por tenant dentro del TTL y relee al vencer', async () => {
    conPerfil();
    await m.perfilDeTenant(CON, 1000);
    await m.perfilDeTenant(CON, 1000 + m.TTL_PERFIL_MS - 1);
    expect(lecturas).toBe(1);
    await m.perfilDeTenant(CON, 1000 + m.TTL_PERFIL_MS + 1);
    expect(lecturas).toBe(2);
  });

  it('un cambio de perfil se nota al vencer el TTL', async () => {
    expect(await m.perfilDeTenant(CON, 0)).toBeNull();
    conPerfil();
    expect(await m.perfilDeTenant(CON, m.TTL_PERFIL_MS + 1)).toBe('cinco_agentes');
  });

  it('FALLA CERRADO: si la lectura falla y nunca se leyó, asume el perfil restrictivo, y no lo cachea', async () => {
    porTenant.set(CON, { data: null, error: { message: 'caída' } });
    expect(await m.perfilDeTenant(CON, 0)).toBe('cinco_agentes');
    expect(logs.warn).toHaveBeenCalled();
    porTenant.set(CON, { data: null, error: null });
    expect(await m.perfilDeTenant(CON, 1)).toBeNull(); // se recuperó: no quedó pegado el error
  });

  it('si la lectura falla y ya había un valor conocido, conserva ese valor', async () => {
    expect(await m.perfilDeTenant(SIN, 0)).toBeNull();
    porTenant.set(SIN, { data: null, error: { message: 'caída' } });
    expect(await m.perfilDeTenant(SIN, m.TTL_PERFIL_MS + 1)).toBeNull();
  });

  it('la tabla aún no existe (0770 sin aplicar): es "sin perfil", no un error que restrinja a todos', async () => {
    porTenant.set(SIN, { data: null, error: { message: 'relation does not exist', code: '42P01' } });
    expect(await m.perfilDeTenant(SIN)).toBeNull();
    m.reiniciarCachePerfil();
    porTenant.set(SIN, { data: null, error: { message: 'no encontrada', code: 'PGRST205' } });
    expect(await m.perfilDeTenant(SIN)).toBeNull();
  });

  it('un valor de perfil desconocido se trata como restringido, no como "sin perfil"', async () => {
    porTenant.set(CON, { data: { perfil: 'inventado' }, error: null });
    expect(await m.perfilDeTenant(CON)).toBe('cinco_agentes');
  });
});

describe('exigirRutaDePerfil (páginas y server actions)', () => {
  it('sin perfil no hace nada, ni en una ruta de stand-by', async () => {
    await m.exigirRutaDePerfil(SIN, '/dashboard/chat');
    expect(redirect).not.toHaveBeenCalled();
  });
  it('con perfil: una ruta permitida pasa', async () => {
    conPerfil();
    await m.exigirRutaDePerfil(CON, '/dashboard/agentes/peajes');
    await m.exigirRutaDePerfil(CON, '/dashboard');
    expect(redirect).not.toHaveBeenCalled();
  });
  it('con perfil: stand-by y rutas nuevas rebotan a /dashboard (que siempre está permitido: no hay bucle)', async () => {
    conPerfil();
    for (const r of ['/dashboard/chat', '/dashboard/suscripcion', '/dashboard/llaves-api', '/dashboard/modulo-nuevo']) {
      redirect.mockClear();
      await expect(m.exigirRutaDePerfil(CON, r)).rejects.toThrow('NEXT_REDIRECT');
      expect(redirect).toHaveBeenCalledWith('/dashboard');
    }
  });
});

describe('apiDenegadaPorPerfil', () => {
  it('sin perfil nunca niega', async () => {
    expect(await m.apiDenegadaPorPerfil(SIN, '/api/dashboard/chat')).toBe(false);
  });
  it('con perfil niega lo no declarado y deja pasar lo declarado', async () => {
    conPerfil();
    expect(await m.apiDenegadaPorPerfil(CON, '/api/dashboard/chat')).toBe(true);
    expect(await m.apiDenegadaPorPerfil(CON, '/api/v1/clientes')).toBe(true);
    expect(await m.apiDenegadaPorPerfil(CON, '/api/export/poliza')).toBe(true);
    expect(await m.apiDenegadaPorPerfil(CON, '/api/v1/peajes/desgloses')).toBe(false);
    expect(await m.apiDenegadaPorPerfil(CON, '/api/export/liquidaciones')).toBe(false);
  });
});

describe('crons', () => {
  it('nombreDeCron toma el primer segmento bajo /api/cron', () => {
    expect(m.nombreDeCron('/api/cron/facturar/cola')).toBe('facturar');
    expect(m.nombreDeCron('/api/cron/vigia')).toBe('vigia');
  });
  it('los crons de A1–A3 no saltan a nadie (los de A4/A5 «próximamente» sí: ver perfil_proximamente.test.ts); los de stand-by saltan las flotas con perfil', async () => {
    lista = { data: [{ tenant_id: 'a' }, { tenant_id: 'b' }], error: null };
    expect((await m.tenantsConPerfilASaltar('peajes')).size).toBe(0);
    expect([...(await m.tenantsConPerfilASaltar('facturar'))].sort()).toEqual(['a', 'b']);
    expect(m.cronAplicaAPerfil('descarga-sat')).toBe(false);
  });
  it('un cron de stand-by NO corre si no se pudo leer quién tiene perfil (falla cerrado)', async () => {
    lista = { data: null, error: { message: 'caída' } };
    await expect(m.tenantsConPerfilASaltar('facturar')).rejects.toThrow(/no se pudo leer/);
    // los permitidos no leen la tabla: no dependen de ella
    await expect(m.tenantsConPerfilASaltar('peajes')).resolves.toEqual(new Set());
  });
  it('sinTenantsDePerfil filtra por id', () => {
    const filas = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(m.sinTenantsDePerfil(filas, new Set(['b']), (f) => f.id)).toEqual([{ id: 'a' }, { id: 'c' }]);
    expect(m.sinTenantsDePerfil(filas, new Set(), (f) => f.id)).toEqual(filas);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDITORÍA del orquestador (hallazgo medio): `tenantsConPerfil()` era la única
  // consulta de TODA la ruta `/api/cron/escalar` sin `acotada()` — un cuelgue
  // solo lo paraba el backstop GLOBAL de 25s del cliente de Supabase, no el tope
  // fino de 8s del resto del cron. Esta prueba demuestra que SÍ tiene tope ahora:
  // una consulta que nunca resuelve por su cuenta contesta igual al vencer
  // `TOPE_CONSULTA_MS + GRACIA_TOPE_MS` (9.5s), con el mismo error-por-valor que
  // usa el resto del repo (nunca un `throw` nativo de fetch sin capturar).
  // ═══════════════════════════════════════════════════════════════════════════
  it('tenantsConPerfilASaltar (vía tenantsConPerfil) está acotada: una consulta colgada contesta al tope, no se queda esperando para siempre', async () => {
    colgarLista = true;
    vi.useFakeTimers();
    try {
      const p = m.tenantsConPerfilASaltar('facturar');
      // Antes del tope no ha contestado — si no estuviera acotada, nunca contestaría.
      await vi.advanceTimersByTimeAsync(9_000);
      let aun = true;
      p.then(() => { aun = false; }, () => { aun = false; });
      await Promise.resolve();
      expect(aun).toBe(true);
      // Al pasar TOPE_CONSULTA_MS (8s) + la gracia (1.5s) de `acotada`, contesta con el error-por-valor
      // (no una tabla inexistente) y `tenantsConPerfil` lo convierte en un throw: «no se pudo leer».
      await vi.advanceTimersByTimeAsync(600);
      await expect(p).rejects.toThrow(/no se pudo leer|sin respuesta/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('moduloEnStandBy: la puerta del WhatsApp de la fase 1 de «Próximamente»', () => {
  it('con la lista vacía (18-oct-2026: A4/A5 ya encendidos), ningún módulo está en stand-by', async () => {
    conPerfil();
    expect(await m.moduloEnStandBy(CON, 'conductor')).toBe(false);
    expect(await m.moduloEnStandBy(CON, 'vigia')).toBe(false);
    expect(await m.moduloEnStandBy(CON, 'liquidacion')).toBe(false);
    expect(await m.moduloEnStandBy(CON, 'peajes')).toBe(false);
  });

  it('sin perfil (o sin tenant) nada cambia: nunca está en stand-by', async () => {
    conPerfil();
    expect(await m.moduloEnStandBy(SIN, 'conductor')).toBe(false);
    expect(await m.moduloEnStandBy(null, 'vigia')).toBe(false);
  });

  it('un módulo que no está en MODULOS_PROXIMAMENTE_PERFIL nunca es stand-by, ni con el perfil ilegible (la puerta fail-closed de abajo ya no aplica a estos dos)', async () => {
    porTenant.set(CON, { data: null, error: { message: 'timeout' } });
    expect(await m.moduloEnStandBy(CON, 'conductor')).toBe(false);
  });
});
