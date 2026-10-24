// A37-S20-02: la action de guardar política escribe en la MISMA flota que pinta
// la página (resolverTenantEfectivo con sp) y relee las reglas por ruta de ESA
// flota al guardar, no las del render.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

const m = vi.hoisted(() => ({
  resolver: vi.fn(async (_ruta: string, _sp: unknown) => ({ tenantId: 't-demo', rol: 'superadmin', userId: 'u-1' })),
  guardar: vi.fn(async (..._a: unknown[]) => {}),
  porRuta: [{ concepto: 'diesel', topeMonto: 300, requiereCfdi: false, ruta: 'RUTA-A' }] as Array<Record<string, unknown>>,
  getConfig: vi.fn(async (_t: string) => ({
    politica: [{ concepto: 'diesel', topeMonto: 500, requiereCfdi: true }, ...m.porRuta],
    estimulos: { viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000, peajeFactor: 0.5 },
    tabulador: { umbralDesviacion: 0.2 },
  })),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: m.resolver }));
vi.mock('@/lib/likida/config', () => ({ getConfig: m.getConfig }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { config: { politica: [] } }, error: null }) }) }) }) }),
}));
vi.mock('@/lib/likida/administracion', async (original) => ({
  ...(await original<typeof import('@/lib/likida/administracion')>()),
  guardarPolitica: (...a: unknown[]) => m.guardar(...a),
}));

const { default: PoliticasPage } = await import('./page');

type Accion = (previo: unknown, fd: FormData) => Promise<{ ok?: string; error?: string }>;
function accionDe(nodo: ReactNode): Accion | null {
  if (Array.isArray(nodo)) { for (const n of nodo) { const a = accionDe(n); if (a) return a; } return null; }
  if (!nodo || typeof nodo !== 'object') return null;
  const el = nodo as ReactElement<{ accion?: Accion; children?: ReactNode }>;
  if (typeof el.props?.accion === 'function') return el.props.accion;
  return accionDe(el.props?.children);
}

beforeEach(() => { vi.clearAllMocks(); m.porRuta = [{ concepto: 'diesel', topeMonto: 300, requiereCfdi: false, ruta: 'RUTA-A' }]; });

describe('A37-S20-02 política: la action usa el mismo tenant que la página', () => {
  it('pasa sp al resolutor y guarda en la flota que él devuelve', async () => {
    const accion = accionDe(await PoliticasPage({ searchParams: Promise.resolve({ vista: 'demo' }) }) as ReactNode)!;
    m.resolver.mockClear();
    const r = await accion(null, new FormData());
    expect(m.resolver).toHaveBeenCalledWith('/dashboard/politicas', { vista: 'demo' });
    expect(r.ok).toBeTruthy();
    expect(m.guardar.mock.calls[0][0]).toBe('t-demo');
  });

  it('relee las reglas por ruta al guardar: no sobrescribe con las del render obsoleto', async () => {
    const accion = accionDe(await PoliticasPage({ searchParams: Promise.resolve({}) }) as ReactNode)!;
    m.porRuta = [{ concepto: 'diesel', topeMonto: 250, requiereCfdi: false, ruta: 'RUTA-B' }]; // otra sesión las cambió
    await accion(null, new FormData());
    const guardada = m.guardar.mock.calls[0][1] as Array<{ ruta?: string }>;
    expect(guardada.filter((p) => p.ruta).map((p) => p.ruta)).toEqual(['RUTA-B']);
  });
});
