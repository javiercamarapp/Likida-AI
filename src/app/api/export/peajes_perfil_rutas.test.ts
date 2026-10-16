import { describe, it, expect, vi, beforeEach } from 'vitest';

// T-A2-31 · «sin fuga de pantallas, prueba por ruta».
// Cada ruta de export de peajes que es stand-by bajo el perfil `cinco_agentes`
// (bitácora del estímulo RMF 9.1.8, bitácora conciliada con GPS y reporte de
// reclamación con GPS) se llama con la puerta REAL (`resolverTenantApi` + perfil):
// una flota con perfil recibe 403 sin que se lea ni un dato; la flota sin perfil
// sigue igual; y si el perfil no se puede leer, falla cerrado.

const perfiles = new Map<string, { data: unknown; error: { message: string } | null }>();
function builder(tabla: string) {
  const b: Record<string, unknown> = {};
  let id = '';
  b.select = () => b;
  b.eq = (_c: string, v: string) => { id = v; return b; };
  b.maybeSingle = async () => (tabla === 'tenant_perfil' ? (perfiles.get(id) ?? { data: null, error: null }) : { data: null, error: null });
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => true, clientIp: () => '1.2.3.4' }));
let tenantDeSesion = 't-sin-perfil';
vi.mock('@/lib/auth/session', () => ({
  getSessionTenant: async () => ({ tenantId: tenantDeSesion, rol: 'flota_admin', userId: 'u-1', nombre: 'Prueba' }),
}));
vi.mock('@/lib/auth/tenant-demo', () => ({ tenantDemo: () => 't-demo' }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({}) }));

// Los lectores de datos: si la puerta falla, NINGUNO debe llamarse.
const lecturas = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
vi.mock('@/lib/likida/intake/desglose_peaje', async (orig) => ({
  ...(await orig<Record<string, unknown>>()), bitacoraRmf918: (...a: unknown[]) => lecturas(...a),
}));
vi.mock('@/lib/likida/peajes/bitacora_conciliada', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  bitacoraConciliada: (...a: unknown[]) => lecturas(...a), reporteReclamacion: (...a: unknown[]) => lecturas(...a),
}));
vi.mock('@/lib/likida/peajes/revision_cobros', async (orig) => ({
  ...(await orig<Record<string, unknown>>()), revisionDeDesglose: (...a: unknown[]) => lecturas(...a),
}));

const { reiniciarCachePerfil } = await import('@/lib/auth/perfil_tenant');
const bitacoraPeaje = (await import('./bitacora-peaje/route')).GET;
const bitacoraConciliada = (await import('./bitacora-conciliada/route')).GET;
const reclamacion = (await import('./peajes-reclamacion/route')).GET;
const revision = (await import('./peajes-revision/route')).GET;

const RUTAS = {
  'bitacora-peaje': bitacoraPeaje,
  'bitacora-conciliada': bitacoraConciliada,
  'peajes-reclamacion': reclamacion,
} as const;
const llamar = (GET: (r: Request) => Promise<Response>, ruta: string) =>
  GET(new Request(`https://app.likida.ai/api/export/${ruta}?desglose=d1`));

beforeEach(() => {
  reiniciarCachePerfil();
  perfiles.clear();
  lecturas.mockReset(); lecturas.mockResolvedValue(null);
  tenantDeSesion = 't-sin-perfil';
});

describe('una flota con perfil cinco_agentes llamando por URL directa a un export stand-by', () => {
  for (const [ruta, GET] of Object.entries(RUTAS)) {
    it(`${ruta} → 403 y no se lee ningún dato`, async () => {
      tenantDeSesion = 't-cinco';
      perfiles.set('t-cinco', { data: { perfil: 'cinco_agentes' }, error: null });
      const r = await llamar(GET, ruta);
      expect(r.status).toBe(403);
      expect(lecturas).not.toHaveBeenCalled();
    });
    it(`${ruta} → falla cerrado: si el perfil no se puede leer, también 403`, async () => {
      tenantDeSesion = 't-ilegible';
      perfiles.set('t-ilegible', { data: null, error: { message: 'caída' } });
      const r = await llamar(GET, ruta);
      expect(r.status).toBe(403);
      expect(lecturas).not.toHaveBeenCalled();
    });
    it(`${ruta} → sin perfil la ruta sigue igual (llega al lector de datos)`, async () => {
      tenantDeSesion = 't-sin-perfil';
      const r = await llamar(GET, ruta);
      expect(r.status).toBe(404); // el lector devuelve null → «el desglose no existe en tu flota»: la puerta pasó
      expect(lecturas).toHaveBeenCalledTimes(1);
    });
  }
});

describe('lo que la flota SÍ pidió sigue vivo bajo el perfil', () => {
  it('peajes-revision (revisión de cobros) llega a su lector con perfil cinco_agentes', async () => {
    tenantDeSesion = 't-cinco';
    perfiles.set('t-cinco', { data: { perfil: 'cinco_agentes' }, error: null });
    const r = await llamar(revision, 'peajes-revision');
    expect(r.status).toBe(404); // lector devuelve null → pasó la puerta del perfil
    expect(lecturas).toHaveBeenCalledTimes(1);
  });
});
