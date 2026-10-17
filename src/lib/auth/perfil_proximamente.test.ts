import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MODULOS_PROXIMAMENTE_PERFIL, RUTAS_PERFIL_CINCO_AGENTES, API_PERFIL_CINCO_AGENTES, API_PROXIMAMENTE_PERFIL,
  CRONS_PERFIL_CINCO_AGENTES, CRONS_PROXIMAMENTE_PERFIL,
  apiPermitidaEnPerfil, rutaPermitidaEnPerfil, rutaProximamenteEnPerfil, rutaOperativaEnPerfil, moduloProximamenteDeRuta,
  rutaProximamente, puedeVerRuta, type ModuloPerfil,
} from './visibilidad';

// ═══════════════════════════════════════════════════════════════════════════
// FASE 1 DEL PERFIL `cinco_agentes`: A1, A2 y A3 ACTIVOS; A4 (vigía) y A5
// (conductor) VISIBLES como «Próximamente» y apagados. Sin base de datos.
// ═══════════════════════════════════════════════════════════════════════════

const rutasDe = (m: ModuloPerfil) => Object.entries(RUTAS_PERFIL_CINCO_AGENTES).filter(([, v]) => v === m).map(([r]) => r);

describe('módulos «próximamente»', () => {
  it('son exactamente vigía y conductor', () => {
    expect([...MODULOS_PROXIMAMENTE_PERFIL].sort()).toEqual(['conductor', 'vigia']);
  });

  it('toda ruta de vigía y de conductor es «próximamente»: se ve pero no se opera', () => {
    for (const r of [...rutasDe('vigia'), ...rutasDe('conductor')]) {
      expect(rutaPermitidaEnPerfil('cinco_agentes', r), r).toBe(true);        // visible
      expect(rutaProximamenteEnPerfil('cinco_agentes', r), r).toBe(true);     // bloqueada
      expect(rutaOperativaEnPerfil('cinco_agentes', r), r).toBe(false);
      expect(puedeVerRuta('flota_admin', r, 'cinco_agentes'), r).toBe(puedeVerRuta('flota_admin', r)); // el menú la muestra
    }
    expect(rutasDe('vigia').length).toBeGreaterThan(0);
    expect(rutasDe('conductor').length).toBeGreaterThan(0);
  });

  it('A1, A2, A3 y la base siguen OPERATIVAS, igual que hoy', () => {
    for (const m of ['liquidacion', 'peajes', 'carta_porte', 'base'] as const) {
      for (const r of rutasDe(m)) {
        expect(rutaOperativaEnPerfil('cinco_agentes', r), r).toBe(true);
        expect(rutaProximamenteEnPerfil('cinco_agentes', r), r).toBe(false);
      }
    }
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    expect(rutaOperativaEnPerfil('cinco_agentes', `/dashboard/${id}`)).toBe(true);
  });

  it('una ruta ajena al perfil NO es «próximamente» (se niega, no se anuncia)', () => {
    expect(rutaProximamenteEnPerfil('cinco_agentes', '/dashboard/chat')).toBe(false);
    expect(rutaProximamenteEnPerfil('cinco_agentes', '/dashboard/agentes/vigia-x')).toBe(false);
    expect(rutaProximamenteEnPerfil('otro', '/dashboard/agentes/vigia')).toBe(false);
    expect(moduloProximamenteDeRuta('cinco_agentes', '/dashboard/agentes/vigia/?tenant=x')).toBe('vigia');
    expect(moduloProximamenteDeRuta('cinco_agentes', '/dashboard/mapa')).toBe('conductor');
  });

  it('cada módulo tiene su pantalla única', () => {
    expect(rutaProximamente('vigia')).toBe('/dashboard/proximamente/vigia');
    expect(rutaProximamente('conductor')).toBe('/dashboard/proximamente/conductor');
  });
});

describe('API, crons, chat y MCP siguen apagados para A4/A5', () => {
  it('las APIs de A4/A5 se niegan bajo el perfil; las de A1–A3 y la base pasan', () => {
    for (const r of API_PROXIMAMENTE_PERFIL.v1) expect(apiPermitidaEnPerfil('cinco_agentes', `/api/v1/${r}`), r).toBe(false);
    for (const r of API_PROXIMAMENTE_PERFIL.export) expect(apiPermitidaEnPerfil('cinco_agentes', `/api/export/${r}`), r).toBe(false);
    expect(apiPermitidaEnPerfil('cinco_agentes', '/api/v1/hitos')).toBe(false);
    expect(apiPermitidaEnPerfil('cinco_agentes', '/api/v1/conductor/algo')).toBe(false);
    expect(apiPermitidaEnPerfil('cinco_agentes', '/api/export/vigia-faqs')).toBe(false);
    for (const r of ['liquidaciones', 'peajes', 'viajes', 'operadores', 'unidades']) {
      expect(apiPermitidaEnPerfil('cinco_agentes', `/api/v1/${r}`), r).toBe(true);
    }
    expect(apiPermitidaEnPerfil('cinco_agentes', '/api/export/carta-porte-docs')).toBe(true);
  });

  it('ninguna API «próximamente» está a la vez en la lista viva', () => {
    for (const raiz of ['v1', 'export', 'dashboard'] as const) {
      expect(API_PROXIMAMENTE_PERFIL[raiz].filter((r) => API_PERFIL_CINCO_AGENTES[raiz].includes(r))).toEqual([]);
    }
  });

  it('los crons de A4/A5 no están en la lista que corre para flotas con perfil; los de A1–A3 sí', () => {
    expect([...CRONS_PROXIMAMENTE_PERFIL].sort()).toEqual(['conductor-hitos', 'vigia']);
    for (const c of CRONS_PROXIMAMENTE_PERFIL) expect(CRONS_PERFIL_CINCO_AGENTES, c).not.toContain(c);
    for (const c of ['liquidaciones-externas', 'peajes', 'carta-porte-docs']) expect(CRONS_PERFIL_CINCO_AGENTES, c).toContain(c);
  });
});

// ── exigirRutaDePerfil: la puerta de páginas y server actions ───────────────

const redirect = vi.fn((_: string) => { throw new Error('NEXT_REDIRECT'); });
vi.mock('next/navigation', () => ({ redirect: (a: string) => redirect(a) }));
let perfilDeFila: string | null = null;
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = async () => ({ data: perfilDeFila ? { perfil: perfilDeFila } : null, error: null });
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: perfilDeFila ? [{ tenant_id: 'x' }] : [], error: null }).then(res);
      return b;
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const m = await import('./perfil_tenant');

describe('exigirRutaDePerfil con «próximamente»', () => {
  beforeEach(() => { m.reiniciarCachePerfil(); redirect.mockClear(); perfilDeFila = null; });

  it('vigía y conductor bajo el perfil: NO rebotan a /dashboard, van a su pantalla «Próximamente»', async () => {
    perfilDeFila = 'cinco_agentes';
    for (const [ruta, modulo] of [
      ['/dashboard/agentes/vigia', 'vigia'], ['/dashboard/agentes/vigia/avisos', 'vigia'],
      ['/dashboard/agentes/conductores', 'conductor'], ['/dashboard/viajes-en-vivo', 'conductor'], ['/dashboard/mapa', 'conductor'],
    ] as const) {
      m.reiniciarCachePerfil(); redirect.mockClear();
      await expect(m.exigirRutaDePerfil('t', ruta)).rejects.toThrow('NEXT_REDIRECT');
      expect(redirect).toHaveBeenCalledTimes(1);
      expect(redirect).toHaveBeenCalledWith(`/dashboard/proximamente/${modulo}`);
      expect(redirect).not.toHaveBeenCalledWith('/dashboard');
    }
  });

  it('A1, A2, A3 y la base pasan sin rebote', async () => {
    perfilDeFila = 'cinco_agentes';
    for (const r of ['/dashboard/agentes/liquidacion', '/dashboard/agentes/peajes', '/dashboard/carta-porte', '/dashboard/viajes', '/dashboard']) {
      await expect(m.exigirRutaDePerfil('t', r), r).resolves.toBeUndefined();
    }
    expect(redirect).not.toHaveBeenCalled();
  });

  it('una ruta de stand-by sigue rebotando a /dashboard', async () => {
    perfilDeFila = 'cinco_agentes';
    await expect(m.exigirRutaDePerfil('t', '/dashboard/chat')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('SIN fila de perfil nada cambia: las pantallas de A4/A5 abren como siempre', async () => {
    perfilDeFila = null;
    await expect(m.exigirRutaDePerfil('t', '/dashboard/agentes/vigia')).resolves.toBeUndefined();
    await expect(m.exigirRutaDePerfil('t', '/dashboard/agentes/conductores')).resolves.toBeUndefined();
    await expect(m.exigirRutaDePerfil('t', '/dashboard/chat')).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('crons: con perfil, los de A4/A5 saltan a las flotas con perfil; los de A1–A3 no', async () => {
    perfilDeFila = 'cinco_agentes';
    expect((await m.tenantsConPerfilASaltar('vigia')).size).toBe(1);
    expect((await m.tenantsConPerfilASaltar('conductor-hitos')).size).toBe(1);
    expect((await m.tenantsConPerfilASaltar('peajes')).size).toBe(0);
    expect(m.cronAplicaAPerfil('vigia')).toBe(false);
    expect(m.cronAplicaAPerfil('liquidaciones-externas')).toBe(true);
  });

  it('chat y MCP: la flota con perfil sigue restringida', async () => {
    perfilDeFila = 'cinco_agentes';
    expect(await m.perfilRestringido('t')).toBe(true);
    expect(await m.apiDenegadaPorPerfil('t', '/api/dashboard/chat')).toBe(true);
    expect(await m.apiDenegadaPorPerfil('t', '/api/v1/hitos')).toBe(true);
    expect(await m.apiDenegadaPorPerfil('t', '/api/v1/liquidaciones')).toBe(false);
  });
});
