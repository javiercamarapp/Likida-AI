import { beforeEach, describe, expect, it, vi } from 'vitest';

const inserts: Array<Record<string, unknown>> = [];
let insertError: { message: string } | null = null;
let filas: Array<Record<string, unknown>> = [];
let selectError: { message: string } | null = null;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      insert: async (v: Record<string, unknown>) => { inserts.push(v); return { error: insertError }; },
      select: () => ({ order: () => ({ limit: async () => ({ data: filas, error: selectError }) }) }),
    }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { registrarEventoSeguridad, getEventosSeguridad } = await import('./eventos');

beforeEach(() => { inserts.length = 0; insertError = null; filas = []; selectError = null; });

describe('registrarEventoSeguridad — best-effort TOTAL', () => {
  it('inserta con defaults (severidad media, tenant null) y recorta el actor', async () => {
    await registrarEventoSeguridad({ origen: 'wa_webhook', tipo: 'firma_invalida', actor: 'x'.repeat(300) });
    expect(inserts[0]).toMatchObject({ origen: 'wa_webhook', tipo: 'firma_invalida', severidad: 'media', tenant_id: null });
    expect((inserts[0].actor as string).length).toBe(120);
  });

  it('un error de la base NO lanza — el camino vigilado jamás se cae por vigilarlo', async () => {
    insertError = { message: 'db down' };
    await expect(registrarEventoSeguridad({ origen: 'copiloto', tipo: 'intent_invalido' })).resolves.toBeUndefined();
  });
});

describe('getEventosSeguridad — el panel no confunde vacío con ciego', () => {
  it('mapea filas', async () => {
    filas = [{ id: '1', origen: 'chat', tipo: 'cifra_sin_respaldo', severidad: 'media', tenant_id: 't1', actor: null, detalle: null, creado_en: '2026-08-17' }];
    const r = await getEventosSeguridad();
    expect(r[0]).toMatchObject({ origen: 'chat', tenantId: 't1' });
  });
  it('LANZA en error de lectura', async () => {
    selectError = { message: 'boom' };
    await expect(getEventosSeguridad()).rejects.toThrow('boom');
  });
});
