import { describe, it, expect, vi, beforeEach } from 'vitest';

// El pipeline del chofer bajo el perfil `cinco_agentes` (0770): `ocr` (leer comprobantes) y `cuadre`
// (cerrar liquidación por WhatsApp) quedan APAGADOS por código, aunque nadie haya movido la palanca;
// `whatsapp` (recepción, que el Conductor usa) sigue viva. Sin perfil, manda la tabla de siempre.

const perfiles = new Map<string, string>();
let filaPalanca: { apagado: boolean } | null = null;
let fallaPerfil = false;
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const b: Record<string, unknown> = {};
      let id = '';
      b.select = () => b;
      b.eq = (c: string, v: string) => { if (c === 'tenant_id') id = v; return b; };
      b.maybeSingle = async () => {
        if (tabla === 'tenant_perfil') {
          if (fallaPerfil) return { data: null, error: { message: 'caída' } };
          return { data: perfiles.has(id) ? { perfil: perfiles.get(id) } : null, error: null };
        }
        return { data: filaPalanca, error: null };
      };
      return b;
    },
  }),
}));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (p: unknown) => p }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { pipelineTenantApagado } = await import('./interruptor_tenant');
const { reiniciarCachePerfil } = await import('@/lib/auth/perfil_tenant');

beforeEach(() => { reiniciarCachePerfil(); perfiles.clear(); filaPalanca = null; fallaPerfil = false; });

describe('pipelineTenantApagado con perfil', () => {
  it('con perfil: ocr y cuadre apagados, whatsapp encendido', async () => {
    perfiles.set('t1', 'cinco_agentes');
    expect(await pipelineTenantApagado('t1', 'ocr')).toBe(true);
    expect(await pipelineTenantApagado('t1', 'cuadre')).toBe(true);
    expect(await pipelineTenantApagado('t1', 'whatsapp')).toBe(false);
  });
  it('sin perfil y sin palanca: todo encendido, como siempre', async () => {
    for (const p of ['whatsapp', 'ocr', 'cuadre'] as const) expect(await pipelineTenantApagado('t2', p)).toBe(false);
  });
  it('sin perfil, la palanca de siempre sigue mandando', async () => {
    filaPalanca = { apagado: true };
    expect(await pipelineTenantApagado('t2', 'ocr')).toBe(true);
  });
  it('si la tabla del perfil no se puede leer NO se apaga el pipeline (palanca operativa, no de incidente)', async () => {
    fallaPerfil = true;
    expect(await pipelineTenantApagado('t3', 'ocr')).toBe(false);
  });
});
