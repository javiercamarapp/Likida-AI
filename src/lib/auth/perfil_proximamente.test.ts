import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MODULOS_PROXIMAMENTE_PERFIL, RUTAS_PERFIL_CINCO_AGENTES, API_PERFIL_CINCO_AGENTES, API_PROXIMAMENTE_PERFIL,
  CRONS_PERFIL_CINCO_AGENTES, CRONS_PROXIMAMENTE_PERFIL,
  apiPermitidaEnPerfil, rutaPermitidaEnPerfil, rutaProximamenteEnPerfil, rutaOperativaEnPerfil, moduloProximamenteDeRuta,
  type ModuloPerfil,
} from './visibilidad';

// ═══════════════════════════════════════════════════════════════════════════
// FASE 1 DEL PERFIL `cinco_agentes`, al 18-oct-2026: los cinco agentes (A1-A5)
// están ACTIVOS. No hay módulo «próximamente» hoy — la lista quedó vacía al
// encender A4 (vigía) y A5 (conductor); las pruebas abajo confirman eso y que
// el mecanismo sigue intacto para el próximo módulo que entre en fase 1.
// ═══════════════════════════════════════════════════════════════════════════

const rutasDe = (m: ModuloPerfil) => Object.entries(RUTAS_PERFIL_CINCO_AGENTES).filter(([, v]) => v === m).map(([r]) => r);

describe('módulos «próximamente»', () => {
  it('no hay ninguno hoy: A4 y A5 se encendieron el 18-oct-2026', () => {
    expect([...MODULOS_PROXIMAMENTE_PERFIL]).toEqual([]);
  });

  it('toda ruta de vigía y de conductor es VISIBLE y OPERATIVA, igual que A1-A3', () => {
    for (const r of [...rutasDe('vigia'), ...rutasDe('conductor')]) {
      expect(rutaPermitidaEnPerfil('cinco_agentes', r), r).toBe(true);
      expect(rutaProximamenteEnPerfil('cinco_agentes', r), r).toBe(false);
      expect(rutaOperativaEnPerfil('cinco_agentes', r), r).toBe(true);
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

  it('una ruta ajena al perfil NO es «próximamente» (se niega, no se anuncia), y ninguna ruta hoy lo es', () => {
    expect(rutaProximamenteEnPerfil('cinco_agentes', '/dashboard/chat')).toBe(false);
    expect(rutaProximamenteEnPerfil('cinco_agentes', '/dashboard/agentes/vigia-x')).toBe(false);
    expect(rutaProximamenteEnPerfil('otro', '/dashboard/agentes/vigia')).toBe(false);
    expect(moduloProximamenteDeRuta('cinco_agentes', '/dashboard/agentes/vigia/?tenant=x')).toBe(null);
    expect(moduloProximamenteDeRuta('cinco_agentes', '/dashboard/mapa')).toBe(null);
  });
});

describe('API y crons de A4/A5: ya viven en la lista operativa', () => {
  it('las APIs de A4/A5 pasan bajo el perfil, igual que las de A1-A3 y la base', () => {
    for (const r of ['hitos', 'estadias', 'sitios', 'conductor', 'evidencias']) {
      expect(apiPermitidaEnPerfil('cinco_agentes', `/api/v1/${r}`), r).toBe(true);
    }
    expect(apiPermitidaEnPerfil('cinco_agentes', '/api/export/vigia-faqs')).toBe(true);
    for (const r of ['liquidaciones', 'peajes', 'viajes', 'operadores', 'unidades']) {
      expect(apiPermitidaEnPerfil('cinco_agentes', `/api/v1/${r}`), r).toBe(true);
    }
    expect(apiPermitidaEnPerfil('cinco_agentes', '/api/export/carta-porte-docs')).toBe(true);
  });

  it('no hay ninguna API «próximamente» hoy, y nada se superpone con la lista viva', () => {
    for (const raiz of ['v1', 'export', 'dashboard'] as const) {
      expect(API_PROXIMAMENTE_PERFIL[raiz]).toEqual([]);
      expect(API_PROXIMAMENTE_PERFIL[raiz].filter((r) => API_PERFIL_CINCO_AGENTES[raiz].includes(r))).toEqual([]);
    }
  });

  it('los crons de A4/A5 ya corren para flotas con perfil, igual que los de A1-A3', () => {
    expect([...CRONS_PROXIMAMENTE_PERFIL]).toEqual([]);
    for (const c of ['vigia', 'conductor-hitos', 'liquidaciones-externas', 'peajes', 'carta-porte-docs']) {
      expect(CRONS_PERFIL_CINCO_AGENTES, c).toContain(c);
    }
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

describe('exigirRutaDePerfil con A4/A5 ya encendidos', () => {
  beforeEach(() => { m.reiniciarCachePerfil(); redirect.mockClear(); perfilDeFila = null; });

  it('vigía y conductor bajo el perfil: NO rebotan a ningún lado, pasan como A1-A3', async () => {
    perfilDeFila = 'cinco_agentes';
    for (const r of [
      '/dashboard/agentes/vigia', '/dashboard/agentes/vigia/avisos',
      '/dashboard/agentes/conductores', '/dashboard/viajes-en-vivo', '/dashboard/mapa',
    ]) {
      await expect(m.exigirRutaDePerfil('t', r), r).resolves.toBeUndefined();
    }
    expect(redirect).not.toHaveBeenCalled();
  });

  it('A1, A2, A3 y la base pasan sin rebote', async () => {
    perfilDeFila = 'cinco_agentes';
    for (const r of ['/dashboard/agentes/liquidacion', '/dashboard/agentes/peajes', '/dashboard/carta-porte', '/dashboard/viajes', '/dashboard']) {
      await expect(m.exigirRutaDePerfil('t', r), r).resolves.toBeUndefined();
    }
    expect(redirect).not.toHaveBeenCalled();
  });

  it('una ruta de stand-by (ajena al perfil) sigue rebotando a /dashboard', async () => {
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

  it('crons: con perfil, los de A4/A5 YA NO saltan a las flotas con perfil (corren, como A1-A3)', async () => {
    perfilDeFila = 'cinco_agentes';
    expect((await m.tenantsConPerfilASaltar('vigia')).size).toBe(0);
    expect((await m.tenantsConPerfilASaltar('conductor-hitos')).size).toBe(0);
    expect((await m.tenantsConPerfilASaltar('peajes')).size).toBe(0);
    expect(m.cronAplicaAPerfil('vigia')).toBe(true);
    expect(m.cronAplicaAPerfil('liquidaciones-externas')).toBe(true);
  });

  it('chat y MCP: la flota con perfil sigue restringida (stand-by general, no ligado a A4/A5)', async () => {
    perfilDeFila = 'cinco_agentes';
    expect(await m.perfilRestringido('t')).toBe(true);
    expect(await m.apiDenegadaPorPerfil('t', '/api/dashboard/chat')).toBe(true);
    expect(await m.apiDenegadaPorPerfil('t', '/api/v1/hitos')).toBe(false);
    expect(await m.apiDenegadaPorPerfil('t', '/api/v1/liquidaciones')).toBe(false);
  });
});
