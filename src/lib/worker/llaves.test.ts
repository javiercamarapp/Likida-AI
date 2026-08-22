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

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA PROD (22-ago-2026) · SEG-6 — la bitácora guardaba un pedazo del
// secreto.
//
// El actor del evento era `lkw…${llave.slice(-6)}`: seis caracteres REALES de
// la llave, escritos en `evento_seguridad`, que se conserva y que lee el
// panel. El rechazo más común no es el sondeo con basura, es la llave BUENA
// con la capacidad equivocada — y ahí la fila guardaba el sufijo de una
// credencial viva.
//
// El hash ya vive en este archivo y es lo que `worker_llave` indexa: un
// prefijo suyo identifica la llave sin contener un carácter del secreto.
// ═══════════════════════════════════════════════════════════════════════════
describe('SEG-6 — el evento de seguridad no lleva un trozo de la llave', () => {
  const LLAVE_VIVA = 'lkw_secretodeproduccion_XY9Z8W';

  it('la llave buena SIN la capacidad: se registra sin un solo carácter del secreto', async () => {
    fila = { id: 'w1', nombre: 'mac-javier', capacidades: ['bus.latido'], revocada_en: null };
    await resolverLlaveWorker(LLAVE_VIVA, 'bus.ordenes');

    const actor = String(eventos.at(-1)?.actor ?? '');
    expect(actor).not.toContain(LLAVE_VIVA.slice(-6));
    expect(actor).not.toContain('secretodeproduccion');
    // Pero SÍ identifica la llave: es el prefijo del hash que indexa la tabla.
    expect(actor).toBe(`lkw#${hashLlaveWorker(LLAVE_VIVA).slice(0, 8)}`);
  });

  it('y el mismo hash sale para la misma llave: se puede cruzar con worker_llave', async () => {
    fila = null; // desconocida
    await resolverLlaveWorker(LLAVE_VIVA, 'bus.latido');
    const a = String(eventos.at(-1)?.actor);
    eventos.length = 0;
    await resolverLlaveWorker(LLAVE_VIVA, 'bus.latido');
    expect(String(eventos.at(-1)?.actor)).toBe(a);
  });
});
