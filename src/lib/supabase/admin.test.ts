import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LA RED DEL SERVICE-ROLE — paso 0.5 de la máquina de automejora.
//
// El crítico histórico (3 rondas de auditoría): un fallback silencioso de
// SUPABASE_SERVICE_ROLE_KEY a la ANON key. Hoy `admin.ts` ya NO lo tiene —
// lanza si falta la key — y esta prueba es la RED ESTRUCTURAL que impide
// reintroducirlo: si alguien vuelve a escribir `?? ANON_KEY` para "que no
// truene", esta prueba truena en su lugar. Un cliente admin corriendo con
// ANON no salta RLS y TODAS las lecturas del panel devolverían vacío — la
// base caída disfrazada de "no hay datos", el peor fallo posible del repo.
// ═══════════════════════════════════════════════════════════════════════════

const ENV_ORIGINAL = { ...process.env };

beforeEach(() => { vi.resetModules(); });
afterEach(() => { process.env = { ...ENV_ORIGINAL }; });

describe('supabaseAdmin falla CERRADO sin la service-role key', () => {
  it('sin SERVICE_ROLE_KEY lanza — aunque la ANON esté presente y disponible', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ejemplo.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-presente-y-tentadora';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { supabaseAdmin } = await import('./admin');
    expect(() => supabaseAdmin()).toThrowError(/service-role/i);
  });

  it('sin URL también lanza — nunca un cliente a medias', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-presente';
    const { supabaseAdmin } = await import('./admin');
    expect(() => supabaseAdmin()).toThrowError(/service-role/i);
  });

  it('la fuente del cliente es EXACTAMENTE la service-role key (ninguna otra env)', async () => {
    // La red estructural: se lee el archivo y se afirma que la ANON key no
    // aparece en él. Si un refactor legítimo la necesitara algún día, este
    // test obliga a que esa decisión se tome DE FRENTE, no en un `??`.
    const { readFileSync } = await import('node:fs');
    const fuente = readFileSync(new URL('./admin.ts', import.meta.url), 'utf8');
    expect(fuente).not.toContain('ANON_KEY');
    expect(fuente).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });
});
