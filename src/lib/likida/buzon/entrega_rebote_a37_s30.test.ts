import { describe, it, expect, vi } from 'vitest';

// A37-S30-04: un rebote parcial (1 de N destinatarios del MISMO correo) no libera las facturas para reenviarlas a todos.
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const llamadas: Array<{ tabla: string; op: string; fila?: unknown }> = [];
let loteFila: Record<string, unknown> = {};
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      let op = 'select'; let fila: unknown;
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b, eq: () => b, in: () => b, limit: () => b,
        update: (f: unknown) => { op = 'update'; fila = f; return b; },
        insert: (f: unknown) => { op = 'insert'; fila = f; return b; },
        then: (res: (x: unknown) => unknown) => {
          llamadas.push({ tabla, op, fila });
          const data = tabla === 'buzon_entrega' ? [loteFila] : tabla === 'factura_proveedor' ? [{ id: 'f1' }] : [];
          return Promise.resolve({ data, error: null }).then(res);
        },
      });
      return b;
    },
  }),
}));

const { confirmarPorResend } = await import('./entrega_repo');

describe('A37-S30-04 — rebote parcial', () => {
  it('con VARIOS destinatarios no suelta las facturas (no se reenvían a quien ya las recibió)', async () => {
    llamadas.length = 0;
    loteFila = { id: 'L1', tenant_id: 'T', estado: 'enviada', destinatarios: ['a@x.mx', 'b@x.mx', 'c@x.mx'] };
    expect(await confirmarPorResend('re_1', 'rebotada')).toBe('aplicada');
    expect(llamadas.some((c) => c.tabla === 'factura_proveedor')).toBe(false);
    const ev = llamadas.find((c) => c.tabla === 'buzon_entrega_evento')!.fila as { detalle: string };
    expect(ev.detalle).toContain('NO se liberaron');
  });
  it('con UN destinatario sigue soltando las facturas para rearmar', async () => {
    llamadas.length = 0;
    loteFila = { id: 'L1', tenant_id: 'T', estado: 'enviada', destinatarios: ['a@x.mx'] };
    expect(await confirmarPorResend('re_1', 'rebotada')).toBe('aplicada');
    expect(llamadas.some((c) => c.tabla === 'factura_proveedor' && c.op === 'update')).toBe(true);
  });
});
