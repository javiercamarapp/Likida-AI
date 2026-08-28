import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// RES-7: un cron muerto era invisible. La puerta loguea el 401 con código
// estable, el secreto ausente alerta, el latido nunca lanza, y `juzgarLatido`
// llama vencido a lo que lleva cadencia + 20 min sin latir.
// ═══════════════════════════════════════════════════════════════════════════

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));
const alertarOperador = vi.fn(async () => {});
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: (...a: unknown[]) => alertarOperador(...(a as [])) }));
const upsert = vi.fn(async () => ({ error: null as null | { message: string } }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: () => ({ upsert: (...a: unknown[]) => upsert(...(a as [])) }) }),
}));

const { puertaCron, registrarLatido, juzgarLatido, CADENCIA_MS, TOLERANCIA_LATIDO_MS } = await import('./salud');

beforeEach(() => { vi.clearAllMocks(); process.env.CRON_SECRET = 's3cr3t'; });

describe('puertaCron', () => {
  it('sin CRON_SECRET: 500 y ALERTA al operador (antes solo un log)', async () => {
    delete process.env.CRON_SECRET;
    const r = await puertaCron('escalar', new Request('http://x'), 'La escalación no corre sin él.');
    expect(r?.status).toBe(500);
    expect(alertarOperador).toHaveBeenCalledWith('cron.escalar', expect.objectContaining({ codigo: 'cron_sin_secreto' }));
  });

  it('secreto equivocado: 401 sin cuerpo, pero CON log y código cron_401', async () => {
    const r = await puertaCron('purgar', new Request('http://x', { headers: { authorization: 'Bearer otro' } }), '');
    expect(r?.status).toBe(401);
    expect(await r?.text()).toBe('');
    expect(logger.error).toHaveBeenCalledWith('cron.purgar.no_autorizado', { codigo: 'cron_401' });
  });

  it('secreto correcto: null, sin ruido', async () => {
    const r = await puertaCron('purgar', new Request('http://x', { headers: { authorization: 'Bearer s3cr3t' } }), '');
    expect(r).toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('registrarLatido', () => {
  it('escribe el upsert por id y no lanza ni con la base caída', async () => {
    await registrarLatido('wa-pendientes', 'ok', { procesados: 3 });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'wa-pendientes', estado: 'ok' }), { onConflict: 'id' });
    upsert.mockRejectedValueOnce(new Error('caída'));
    await expect(registrarLatido('escalar', 'fallo')).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('cron.latido_sin_escribir', expect.objectContaining({ cron: 'escalar' }));
  });
});

describe('juzgarLatido', () => {
  const ahora = Date.parse('2026-08-22T12:00:00Z');
  it('sin fila: sin_latido (recién desplegado no es muerto)', () => {
    expect(juzgarLatido('escalar', null, null, ahora).estado).toBe('sin_latido');
  });
  it('vencido = su cadencia + 20 min de tolerancia, sea cual sea la cadencia', () => {
    // Relativo a CADENCIA_MS a propósito: si mañana wa-pendientes corre cada
    // minuto en vez de cada cinco, esta prueba sigue midiendo la regla.
    const tope = CADENCIA_MS['wa-pendientes'] + TOLERANCIA_LATIDO_MS;
    expect(juzgarLatido('wa-pendientes', new Date(ahora - (tope - 60_000)).toISOString(), 'ok', ahora).estado).toBe('ok');
    expect(juzgarLatido('wa-pendientes', new Date(ahora - (tope + 60_000)).toISOString(), 'ok', ahora).estado).toBe('vencido');
  });
  it('el cron horario tolera 80 min', () => {
    const r = juzgarLatido('escalar', new Date(ahora - 70 * 60_000).toISOString(), 'parcial', ahora);
    expect(r).toMatchObject({ estado: 'ok', haceMin: 70, ultimoEstado: 'parcial' });
    expect(juzgarLatido('escalar', new Date(ahora - 90 * 60_000).toISOString(), 'ok', ahora).estado).toBe('vencido');
  });
});

describe('CADENCIA_MS espeja vercel.json', () => {
  it('cada cron de vercel.json tiene su cadencia aquí y coincide', () => {
    const cfg = JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons: Array<{ path: string; schedule: string }> };
    const esperada: Record<string, number> = {
      '* * * * *': 60_000, '*/5 * * * *': 300_000, '*/15 * * * *': 900_000,
      '0 * * * *': 3_600_000, '7 * * * *': 3_600_000, '30 * * * *': 3_600_000,
      '0 */4 * * *': 4 * 3_600_000, '15 4 * * *': 86_400_000,
      // 0231: el minuto 25 está desfasado a propósito de la estampida de los
      // minutos 0/5/7/15 — un cron más en el minuto 0 se lleva la cuota de la
      // plataforma y el pool de conexiones a la misma hora que los otros.
      '25 */6 * * *': 6 * 3_600_000,
    };
    for (const c of cfg.crons) {
      const id = c.path.replace('/api/cron/', '') as keyof typeof CADENCIA_MS;
      // Si esto truena por `undefined`, no falta la cadencia en CADENCIA_MS:
      // falta la CADENA de cron en esta tabla. Añádela aquí antes de tocar
      // salud.ts, o el latido juzgará con la cadencia equivocada.
      expect(esperada[c.schedule], `cadencia "${c.schedule}" (${id}) no está en esta tabla`).toBeTypeOf('number');
      expect(CADENCIA_MS[id], `${id} falta en CADENCIA_MS`).toBe(esperada[c.schedule]);
    }
    expect(TOLERANCIA_LATIDO_MS).toBe(20 * 60_000);
  });
});
