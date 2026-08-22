import { describe, it, expect, vi } from 'vitest';

// El pulso para el monitor externo (D4): la única promesa es que el status
// HTTP diga la verdad — 200 solo con la base respondiendo, 503 si no — y que
// el cuerpo no filtre un solo dato de negocio.

let dbFalla = false;
/** Las filas de `cron_latido` (RES-7). */
let latidos: Array<{ id: string; ultimo_latido: string; estado: string }> = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => ({
      select: async () => tabla === 'cron_latido'
        ? { data: latidos, error: null }
        : (dbFalla ? { count: null, error: { message: 'caída' } } : { count: 0, error: null }),
    }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const alertarOperador = vi.fn(async () => {});
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: (...a: unknown[]) => alertarOperador(...(a as [])) }));

const { GET } = await import('./route');

describe('/api/health', () => {
  it('con la base viva: 200, ok true, y el cuerpo solo trae pulso (nada de negocio)', async () => {
    dbFalla = false;
    const r = await GET();
    expect(r.status).toBe(200);
    const c = await r.json();
    expect(c.ok).toBe(true);
    expect(c.db).toBe('ok');
    expect(Object.keys(c).sort()).toEqual(['crons', 'db', 'hora', 'ok', 'sentry', 'version']);
    // Sin latidos todavía no es un cron muerto: nada que alertar.
    expect(c.crons['wa-pendientes']).toBe('sin_latido');
    expect(alertarOperador).not.toHaveBeenCalled();
    // Ni tablas, ni tenants, ni correos: el health es público a propósito.
    expect(JSON.stringify(c)).not.toMatch(/tenant_id|@|supabase/i);
  });

  // RES-7: un cron que lleva 21 min sin latir (cada minuto + 20 de tolerancia)
  // sale `vencido` y el operador recibe UNA alerta — antes era invisible.
  it('un cron vencido se dice en `crons` y alerta al operador; el status sigue midiendo la base', async () => {
    dbFalla = false;
    alertarOperador.mockClear();
    latidos = [
      // Tres horas sin latir: vencido con cualquier cadencia de las cortas.
      { id: 'wa-pendientes', ultimo_latido: new Date(Date.now() - 180 * 60_000).toISOString(), estado: 'ok' },
      { id: 'escalar', ultimo_latido: new Date(Date.now() - 30 * 60_000).toISOString(), estado: 'ok' },
    ];
    const r = await GET();
    expect(r.status).toBe(200);
    const c = await r.json();
    expect(c.crons).toMatchObject({ 'wa-pendientes': 'vencido', escalar: 'ok', purgar: 'sin_latido' });
    expect(alertarOperador).toHaveBeenCalledWith('cron.sin_latido', expect.objectContaining({ codigo: 'cron_sin_latido' }));
    latidos = [];
  });

  it('con la base caída: 503 y ok false — lo que un monitor entiende sin leer el cuerpo', async () => {
    dbFalla = true;
    const r = await GET();
    expect(r.status).toBe(503);
    expect((await r.json()).ok).toBe(false);
  });
});
