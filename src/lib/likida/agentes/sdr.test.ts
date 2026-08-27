import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL SDR (0217) — el contrato es la CADENCIA que se detiene sola:
//  · una respuesta del prospecto lo saca (el humano toma la conversación);
//  · un rebote o una queja lo sacan (no se insiste a un buzón quemado);
//  · +3/+7 días desde la PRIMERA salida, y dos seguimientos son el final;
//  · el historial ilegible NO decide a ciegas: LANZA.
// ═══════════════════════════════════════════════════════════════════════════

const respuestas = new Map<string, Array<{ data: unknown; error: { message: string } | null }>>();
function builder(tabla: string) {
  const responder = () => {
    const cola = respuestas.get(tabla);
    return cola && cola.length > 0 ? cola.shift()! : { data: [], error: null };
  };
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b, eq: () => b, is: () => b, in: () => b, limit: () => b,
    order: () => b,
    then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve().then(responder).then(res, rej),
  });
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../interruptores', () => ({ estaApagado: async () => false }));
vi.mock('@/lib/llm/openrouter', () => ({ generateResponse: vi.fn() }));
vi.mock('./cola', () => ({ encolarPieza: vi.fn() }));
vi.mock('./corridas', () => ({ registrarCorrida: vi.fn() }));

const { candidatosDeSeguimiento } = await import('./sdr');

const PROSPECTO = { id: 'pr-1', empresa: 'Transportes X', contacto_nombre: null };
const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString();

beforeEach(() => respuestas.clear());

describe('candidatosDeSeguimiento', () => {
  it('una salida hace 4 días sin respuesta: toca el seguimiento 1', async () => {
    respuestas.set('prospecto', [{ data: [PROSPECTO], error: null }]);
    respuestas.set('prospecto_contacto', [{ data: [{ direccion: 'salida', ocurrio_en: hace(4) }], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: [], error: null }]);
    const r = await candidatosDeSeguimiento(5);
    expect(r).toHaveLength(1);
    expect(r[0].numeroSeguimiento).toBe(1);
  });

  it('con RESPUESTA del prospecto: fuera — el humano toma la conversación', async () => {
    respuestas.set('prospecto', [{ data: [PROSPECTO], error: null }]);
    respuestas.set('prospecto_contacto', [{
      data: [
        { direccion: 'salida', ocurrio_en: hace(5) },
        { direccion: 'respuesta', ocurrio_en: hace(3) },
      ], error: null,
    }]);
    expect(await candidatosDeSeguimiento(5)).toHaveLength(0);
  });

  it('con REBOTE o QUEJA de cualquier pieza: fuera — no se insiste a un buzón quemado', async () => {
    respuestas.set('prospecto', [{ data: [PROSPECTO], error: null }]);
    respuestas.set('prospecto_contacto', [{ data: [{ direccion: 'salida', ocurrio_en: hace(5) }], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: [{ id: 'p-rebotada' }], error: null }]);
    expect(await candidatosDeSeguimiento(5)).toHaveLength(0);
  });

  it('la salida es de hace 2 días: aún no toca (+3)', async () => {
    respuestas.set('prospecto', [{ data: [PROSPECTO], error: null }]);
    respuestas.set('prospecto_contacto', [{ data: [{ direccion: 'salida', ocurrio_en: hace(2) }], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: [], error: null }]);
    expect(await candidatosDeSeguimiento(5)).toHaveLength(0);
  });

  it('dos salidas hace 8 días: toca el seguimiento 2 (+7); TRES salidas: la cadencia terminó', async () => {
    respuestas.set('prospecto', [{ data: [PROSPECTO, { ...PROSPECTO, id: 'pr-2' }], error: null }]);
    respuestas.set('prospecto_contacto', [
      { data: [{ direccion: 'salida', ocurrio_en: hace(8) }, { direccion: 'salida', ocurrio_en: hace(4) }], error: null },
      { data: [{ direccion: 'salida', ocurrio_en: hace(20) }, { direccion: 'salida', ocurrio_en: hace(15) }, { direccion: 'salida', ocurrio_en: hace(10) }], error: null },
    ]);
    respuestas.set('cola_aprobacion', [{ data: [], error: null }, { data: [], error: null }]);
    const r = await candidatosDeSeguimiento(5);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: 'pr-1', numeroSeguimiento: 2 });
  });

  it('historial ilegible: LANZA — la cadencia no se decide a ciegas', async () => {
    respuestas.set('prospecto', [{ data: [PROSPECTO], error: null }]);
    respuestas.set('prospecto_contacto', [{ data: null, error: { message: 'db down' } }]);
    await expect(candidatosDeSeguimiento(5)).rejects.toThrow(/historial/);
  });
});
