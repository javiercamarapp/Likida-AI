import { describe, it, expect, vi } from 'vitest';

// A37-S33-08: traerConversacion devolvía los PRIMEROS 200 mensajes. Ahora trae los ÚLTIMOS 200 (orden descendente + limit)
// y los devuelve en orden cronológico. El doble de Supabase honra order/limit sobre filas sintéticas.

type Fila = { rol: string; texto: string; bloques: null; created_at: number; id: string };
const TODAS: Fila[] = Array.from({ length: 250 }, (_, i) => ({ rol: i % 2 === 0 ? 'usuario' : 'asistente', texto: `m${i}`, bloques: null, created_at: Math.floor(i / 2), id: String(i).padStart(4, '0') }));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const ords: Array<[string, boolean]> = [];
      let lim = Infinity;
      const n: Record<string, unknown> = {};
      n.select = () => n; n.eq = () => n;
      n.order = (c: string, o?: { ascending?: boolean }) => { ords.push([c, o?.ascending !== false]); return n; };
      n.limit = (l: number) => { lim = l; return n; };
      n.maybeSingle = () => Promise.resolve({ data: { id: 'c', titulo: 'T' }, error: null });
      n.then = (ok: (v: unknown) => unknown) => {
        if (tabla !== 'chat_mensaje') return Promise.resolve({ data: [], error: null }).then(ok);
        const filas = [...TODAS].sort((a, b) => {
          for (const [c, asc] of ords) {
            const x = (a as Record<string, unknown>)[c] as string | number; const y = (b as Record<string, unknown>)[c] as string | number;
            if (x === y) continue;
            return (x < y ? -1 : 1) * (asc ? 1 : -1);
          }
          return 0;
        }).slice(0, lim);
        return Promise.resolve({ data: filas, error: null }).then(ok);
      };
      return n;
    },
  }),
}));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: async <T,>(p: PromiseLike<T>) => p }));

const { traerConversacion } = await import('./conversaciones');

describe('traerConversacion (A37-S33-08)', () => {
  it('con más de 200 mensajes devuelve los ÚLTIMOS 200, en orden cronológico', async () => {
    const r = await traerConversacion('t', 'u', 'c');
    expect(r!.mensajes).toHaveLength(200);
    expect(r!.mensajes[0].texto).toBe('m50');
    expect(r!.mensajes[199].texto).toBe('m249');
  });
  it('dentro de un intercambio (mismo instante) la pregunta va antes que la respuesta', async () => {
    const r = await traerConversacion('t', 'u', 'c');
    expect(r!.mensajes.slice(0, 2).map((m) => m.rol)).toEqual(['usuario', 'asistente']);
  });
});
