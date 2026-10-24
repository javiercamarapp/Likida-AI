// A37-S15-07: al pasar de 50,000 mensajes el histórico se truncaba conservando los MÁS
// VIEJOS, y la pantalla rotula «últimas 4 semanas». Datos sintéticos.
import { describe, it, expect, vi } from 'vitest';

const TOTAL = 51_000;
// Fila i (0 = la más vieja) -> enviado_en creciente.
const fila = (i: number) => ({
  enviado_en: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
  rol: 'cliente', autor_hash: 'h', texto: `m${i}`, id: String(i),
});

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      let desc = false;
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b, eq: () => b,
        order: (col: string, o?: { ascending?: boolean }) => { if (col === 'enviado_en') desc = o?.ascending === false; return b; },
        range: (a: number, z: number) => {
          const idx = Array.from({ length: z - a + 1 }, (_, k) => a + k).filter((k) => k < TOTAL);
          return Promise.resolve({ data: idx.map((k) => fila(desc ? TOTAL - 1 - k : k)), error: null });
        },
      });
      return b;
    },
  }),
}));
vi.mock('../../presupuesto', () => ({ acotada: <T,>(q: T) => q }));

const { leerMensajesHistorial } = await import('./repo');

describe('A37-S15-07 leerMensajesHistorial al truncar', () => {
  it('conserva los más RECIENTES (no los más viejos) y los entrega en orden cronológico', async () => {
    const r = await leerMensajesHistorial('t1', null);
    expect(r!.truncado).toBe(true);
    expect(r!.mensajes).toHaveLength(50_000);
    expect(r!.mensajes.at(-1)!.texto).toBe(`m${TOTAL - 1}`);
    expect(r!.mensajes[0].texto).toBe(`m${TOTAL - 50_000}`);
    expect(r!.mensajes[0].enviadoEn < r!.mensajes.at(-1)!.enviadoEn).toBe(true);
  });
});
