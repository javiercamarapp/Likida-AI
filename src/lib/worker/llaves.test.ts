import { beforeEach, describe, expect, it, vi } from 'vitest';

let fila: Record<string, unknown> | null = null;
let selError: { message: string } | null = null;
const eventos: Array<Record<string, unknown>> = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: fila, error: selError }) }) }),
      update: () => ({ eq: () => ({ then: (res: (v: unknown) => unknown) => Promise.resolve(undefined).then(res) }) }),
    }),
  }),
}));
vi.mock('@/lib/seguridad/eventos', () => ({
  registrarEventoSeguridad: async (e: Record<string, unknown>) => { eventos.push(e); },
}));

const { resolverLlaveWorker, hashLlaveWorker } = await import('./llaves');

beforeEach(() => { fila = null; selError = null; eventos.length = 0; });

describe('resolverLlaveWorker — fallar cerrado con el MISMO mensaje', () => {
  const LLAVE = 'lkw_abcdefghijklmnop123456';

  it('llave válida con la capacidad: pasa', async () => {
    fila = { id: 'w1', nombre: 'mac-javier', capacidades: ['bus.latido', 'bus.ordenes'], revocada_en: null };
    expect(await resolverLlaveWorker(LLAVE, 'bus.latido')).toMatchObject({ ok: true, workerId: 'w1' });
  });

  it('desconocida, revocada o sin capacidad: MISMO rechazo + evento de seguridad', async () => {
    const r1 = await resolverLlaveWorker(LLAVE, 'bus.latido');            // no existe
    fila = { id: 'w1', nombre: 'x', capacidades: ['bus.latido'], revocada_en: '2026-01-01' };
    const r2 = await resolverLlaveWorker(LLAVE, 'bus.latido');            // revocada
    fila = { id: 'w1', nombre: 'x', capacidades: ['bus.pieza'], revocada_en: null };
    const r3 = await resolverLlaveWorker(LLAVE, 'bus.latido');            // sin alcance
    expect(r1.ok).toBe(false); expect(r2.ok).toBe(false); expect(r3.ok).toBe(false);
    if (!r1.ok && !r2.ok && !r3.ok) {
      expect(r1.error).toBe(r2.error);
      expect(r2.error).toBe(r3.error);
    }
    expect(eventos).toHaveLength(3);
  });

  it('sin llave o con formato ajeno: rechazo sin tocar la base', async () => {
    expect((await resolverLlaveWorker(null, 'bus.ordenes')).ok).toBe(false);
    expect((await resolverLlaveWorker('sb_secreta', 'bus.ordenes')).ok).toBe(false);
  });

  it('base caída: rechazo con causa DISTINTA (reintentable), sin evento', async () => {
    selError = { message: 'down' };
    const r = await resolverLlaveWorker(LLAVE, 'bus.latido');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('reintenta');
    expect(eventos).toHaveLength(0);
  });

  it('el hash es sha256 estable', () => {
    expect(hashLlaveWorker('lkw_x')).toBe(hashLlaveWorker('lkw_x'));
    expect(hashLlaveWorker('lkw_x')).toMatch(/^[0-9a-f]{64}$/);
  });
});
