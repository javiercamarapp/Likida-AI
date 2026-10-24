// A37-S23-08 — el par pregunta/respuesta del Copiloto no comparte created_at:
// con el mismo instante, la lectura (que ordena solo por created_at) podía
// reabrir el par con los roles invertidos.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertMensajes = vi.fn((_filas: Array<Record<string, unknown>>) => ({ error: null as { message: string } | null }));

function builder(tabla: string) {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = () => b;
  b.update = () => b;
  b.single = async () => ({ data: { id: 'c-1' }, error: null });
  b.maybeSingle = async () => ({ data: { id: 'c-1' }, error: null });
  b.insert = (v: unknown) => (tabla === 'copiloto_mensaje' ? insertMensajes(v as Array<Record<string, unknown>>) : b);
  b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res);
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: async <T,>(p: PromiseLike<T>) => p }));

const { guardarIntercambioCopiloto } = await import('./copiloto-historial');

beforeEach(() => insertMensajes.mockClear());

describe('guardarIntercambioCopiloto — orden estable del par', () => {
  it('la respuesta del asistente lleva un created_at ESTRICTAMENTE posterior al de la pregunta', async () => {
    await guardarIntercambioCopiloto({
      userId: 'u-1', conversacionId: 'c-1', pregunta: '¿cuántos viajes?', textoRespuesta: 'Tres.', bloques: [],
    });
    const filas = insertMensajes.mock.calls[0][0];
    const u = filas.find((f) => f.rol === 'usuario')!;
    const a = filas.find((f) => f.rol === 'asistente')!;
    expect(typeof u.created_at).toBe('string');
    expect(Date.parse(String(a.created_at))).toBeGreaterThan(Date.parse(String(u.created_at)));
  });
});
