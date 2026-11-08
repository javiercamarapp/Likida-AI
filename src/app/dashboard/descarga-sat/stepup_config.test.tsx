// R7-A3: la configuración de descarga del SAT pide segundo factor reciente al declarar un RFC distinto (o el primero).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

const m = vi.hoisted(() => ({
  config: { rfc: 'AAA010101AAA' } as { rfc: string } | null,
  incompleta: false,
  guardar: vi.fn(async (..._a: unknown[]) => {}),
  aal2Reciente: false,
  nulo: () => null,
  casiTodo: () => new Proxy({}, { has: () => true, get: (_t, k) => (k === '__esModule' ? false : k === 'then' ? undefined : () => null) }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/link', () => ({ default: m.nulo }));
vi.mock('lucide-react', m.casiTodo);
vi.mock('../sufijo', () => ({ sufijoTenant: () => '' }));
vi.mock('../resumen-visual', m.casiTodo);
vi.mock('../estados', m.casiTodo);
vi.mock('@/app/ui-v2/graficas', m.casiTodo);
vi.mock('@/app/ui-v2/componentes', m.casiTodo);
vi.mock('@/app/dashboard/sello-hoy', () => ({ selloHoy: () => '' }));
vi.mock('../../admin/ui/forma', () => ({ FormaConAviso: m.nulo, Campo: m.nulo, Selector: m.nulo }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/seguridad/eventos', () => ({ registrarEventoSeguridad: vi.fn(async () => {}) }));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => ({ tenantId: 't1', rol: 'contador', userId: 'u1' }) }));
vi.mock('@/lib/auth/tenant-atado', () => ({ resolverTenantAtadoOLanza: async () => ({ tenantId: 't1', rol: 'contador', userId: 'u1' }) }));
vi.mock('@/lib/auth/visibilidad', () => ({ puedeVerRuta: () => true }));
vi.mock('@/lib/likida/administracion', () => ({ mensajeParaPantalla: (e: unknown) => String(e) }));
vi.mock('@/lib/likida/sat_descarga', () => ({ estadoDescargaSat: () => ({ configurado: false }) }));
vi.mock('@/lib/likida/sat_descarga/lectura', () => ({
  TOPE_SOLICITUDES: 50,
  leerDescargaSat: async () => ({ config: m.config, solicitudes: [], conteos: null, incompleta: m.incompleta }),
}));
vi.mock('@/lib/likida/sat_descarga/escritura', () => ({
  guardarConfigDescarga: (...a: unknown[]) => m.guardar(...a), verificarCredencial: vi.fn(), pedirRangoManual: vi.fn(),
}));
vi.mock('@/lib/likida/sat_descarga/ciclo', () => ({ VENTANA_MAX_DIAS: 90 }));
vi.mock('@/lib/likida/sat_descarga/peaje_cierre', () => ({ DIAS_AVISO_DEFECTO: 5 }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({ auth: { mfa: {
    listFactors: async () => ({ data: { totp: [{ id: 'f1', status: 'verified' }] }, error: null }),
    getAuthenticatorAssuranceLevel: async () => ({
      data: { currentLevel: m.aal2Reciente ? 'aal2' : 'aal1', currentAuthenticationMethods: m.aal2Reciente ? [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) - 60 }] : [] },
      error: null,
    }),
  } } }),
}));

const { VistaDescargaSat } = await import('./vista');

type Accion = (previo: unknown, fd: FormData) => Promise<{ ok?: string; error?: string }>;
function guardarDe(nodo: ReactNode): Accion | null {
  if (Array.isArray(nodo)) { for (const n of nodo) { const a = guardarDe(n); if (a) return a; } return null; }
  if (!nodo || typeof nodo !== 'object') return null;
  const p = (nodo as ReactElement<Record<string, unknown>>).props ?? {};
  if (typeof p.accion === 'function' && (p.accion as { name: string }).name === 'guardar') return p.accion as Accion;
  return guardarDe(p.children as ReactNode);
}
const forma = (rfc: string, activa = 'activa') => {
  const f = new FormData(); f.set('rfc', rfc); f.set('modo', 'webservice'); f.set('peajeDiasAviso', '5'); f.set('activa', activa); return f;
};
const cargar = async () => guardarDe(await VistaDescargaSat({ searchParams: {}, tenantExiste: true }) as ReactNode)!;

beforeEach(() => {
  vi.clearAllMocks();
  m.config = { rfc: 'AAA010101AAA' }; m.incompleta = false; m.aal2Reciente = false;
  vi.stubEnv('LIKIDA_TOTP_ESCALONADO', 'obligatorio');
});

describe('R7-A3 descarga del SAT: guardar configuración', () => {
  it('un RFC distinto sin AAL2 vigente falla cerrado y no guarda', async () => {
    const r = await (await cargar())(null, forma('BBB020202BBB'));
    expect(r.error).toMatch(/segundo factor/);
    expect(m.guardar).not.toHaveBeenCalled();
  });
  it('la primera configuración (sin RFC previo) también lo pide', async () => {
    m.config = null;
    const r = await (await cargar())(null, forma('AAA010101AAA'));
    expect(r.error).toMatch(/segundo factor/);
    expect(m.guardar).not.toHaveBeenCalled();
  });
  it('si la lectura de lo guardado quedó incompleta, cierra', async () => {
    const accion = await cargar();
    m.incompleta = true;
    expect((await accion(null, forma('AAA010101AAA'))).error).toMatch(/segundo factor/);
    expect(m.guardar).not.toHaveBeenCalled();
  });
  it('el mismo RFC (p. ej. pausar la descarga) no pide el paso', async () => {
    const r = await (await cargar())(null, forma('aaa010101aaa', 'pausada'));
    expect(r.ok).toMatch(/guardada/);
    expect(m.guardar).toHaveBeenCalledTimes(1);
  });
  it('con AAL2 reciente, el RFC nuevo sí se guarda', async () => {
    m.aal2Reciente = true;
    const r = await (await cargar())(null, forma('BBB020202BBB'));
    expect(r.ok).toMatch(/guardada/);
    expect(m.guardar).toHaveBeenCalledTimes(1);
  });
});
