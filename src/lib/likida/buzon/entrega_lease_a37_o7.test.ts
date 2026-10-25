import { describe, it, expect, vi } from 'vitest';
import type { Entrega } from './entrega_pura';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const { enviarLote } = await import('./entrega');

// A37-O7-02: el lease del claim se fija con el RELOJ REAL, no con la fecha de creación del lote (que solo fija el
// contenido determinista). Un lote creado hace >5 min no puede nacer con el lease ya vencido.
describe('A37-O7-02 — el claim usa el reloj real', () => {
  it('reclamarLote recibe deps.ahora(), no creadoEn', async () => {
    const creado = new Date('2026-10-23T10:00:00.000Z');
    const reloj = new Date('2026-10-23T10:30:00.000Z');
    const reclamarLote = vi.fn(async () => null);
    const lote = { id: 'L1', tenantId: 'T', creadoEn: creado.toISOString(), estado: 'pendiente', intentos: 0 } as unknown as Entrega;
    const deps = { ahora: () => reloj, repo: { reclamarLote } } as never;
    const r = await enviarLote(deps, lote);
    expect(r.estado).toBe('no_tomado');
    const usado = (reclamarLote.mock.calls[0] as unknown as [Entrega, Date])[1];
    expect(usado.toISOString()).toBe(reloj.toISOString());
  });
});
