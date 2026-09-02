import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 — dos huecos de `comprobante_huerfano` que solo se ven desde
// el cuerpo real de `repo.ts` (las 16 pruebas que lo mockean no pueden):
//
// · WA-7 (MEDIO): los huérfanos SIN monto (fallo de OCR, voucher de terminal)
//   nunca se ofrecen, pero ocupaban el tope de 50 por antigüedad. A partir del
//   huérfano 50 sin monto, el chofer dejaba de ver los que SÍ tienen monto:
//   el filtro tiene que ir en la BASE, antes del `limit`, no en un `.filter`
//   de JavaScript sobre una lista ya recortada.
// · BE-12 (MEDIO): `resolverHuerfanos` se tragaba el error con un log sin
//   ids y el llamador seguía como si los huérfanos ya no existieran — en el
//   siguiente viaje se le volvían a ofrecer al chofer, para siempre.
// ═══════════════════════════════════════════════════════════════════════════

import type { Gasto } from '@/types/likida';

/** Lo que se le pidió a la base, en orden: tabla, método, argumentos. */
let llamadas: Array<{ tabla: string; metodo: string; args: unknown[] }> = [];
let respuesta: { data: unknown; error: unknown } = { data: null, error: null };

const from = vi.fn((tabla: string) => {
  const enlace: Record<string, unknown> = {};
  for (const m of ['insert', 'select', 'update', 'eq', 'is', 'gt', 'order', 'limit', 'in']) {
    enlace[m] = (...a: unknown[]) => { llamadas.push({ tabla, metodo: m, args: a }); return enlace; };
  }
  enlace.then = (r: (v: unknown) => unknown) => Promise.resolve(respuesta).then(r);
  return enlace;
});

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from }) }));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const { getHuerfanos, resolverHuerfanos } = await import('./repo');

const GASTO: Gasto = { id: 'g1', concepto: 'diesel', monto: 850, fecha: '2026-08-01' };

beforeEach(() => {
  llamadas = [];
  respuesta = { data: [], error: null };
  from.mockClear();
  logger.info.mockReset(); logger.warn.mockReset(); logger.error.mockReset();
});

describe('WA-7 · getHuerfanos({ soloConMonto }) — el filtro de monto va en la base, no después del tope de 50', () => {
  it('sin opciones, NO filtra por monto: el panel y la bandeja siguen viendo los ilegibles', async () => {
    await getHuerfanos('t1', 'o1');
    expect(llamadas.find((l) => l.metodo === 'gt')).toBeUndefined();
  });

  it('con soloConMonto, pide gasto->monto > 0 a PostgREST', async () => {
    await getHuerfanos('t1', 'o1', { soloConMonto: true });
    const gt = llamadas.find((l) => l.metodo === 'gt');
    expect(gt, 'el filtro de monto no llegó a la base').toBeTruthy();
    // `->` (jsonb) y no `->>` (texto): con `->>` PostgREST compara "850" > "0"
    // como TEXTO y «$1,000.00» quedaría por debajo de «$9.00».
    expect(gt?.args).toEqual(['gasto->monto', 0]);
  });

  it('el filtro se aplica ANTES del limit(50) — ese es todo el hallazgo', async () => {
    await getHuerfanos('t1', 'o1', { soloConMonto: true });
    const iGt = llamadas.findIndex((l) => l.metodo === 'gt');
    const iLimit = llamadas.findIndex((l) => l.metodo === 'limit');
    expect(iGt).toBeGreaterThanOrEqual(0);
    expect(iLimit).toBeGreaterThan(iGt);
  });

  it('sigue acotando por tenant, por operador y por resuelto_en nulo', async () => {
    await getHuerfanos('t1', 'o1', { soloConMonto: true });
    const eqs = llamadas.filter((l) => l.metodo === 'eq').map((l) => l.args);
    expect(eqs).toContainEqual(['tenant_id', 't1']);
    expect(eqs).toContainEqual(['operador_id', 'o1']);
    expect(llamadas.find((l) => l.metodo === 'is')?.args).toEqual(['resuelto_en', null]);
  });
});

describe('BE-12 · resolverHuerfanos dice si selló, y el log nombra las filas', () => {
  it('sello correcto → true', async () => {
    respuesta = { data: null, error: null };
    await expect(resolverHuerfanos('t1', ['h1'], 'adjuntado', 'v9')).resolves.toBe(true);
  });

  it('sin ids → true (nada que sellar; el llamador no tiene por qué alarmarse)', async () => {
    await expect(resolverHuerfanos('t1', [], 'adjuntado', 'v9')).resolves.toBe(true);
    expect(from).not.toHaveBeenCalled();
  });

  it('fallo de la base → false, y el log trae los ids para poder cazarlos', async () => {
    respuesta = { data: null, error: { message: 'tope de consulta' } };
    await expect(resolverHuerfanos('t1', ['h1', 'h2'], 'adjuntado', 'v9')).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalledWith('huerfano.resolver_error',
      expect.objectContaining({ ids: ['h1', 'h2'], tenant: 't1', viaje: 'v9' }));
  });

  it('el gasto de la fila no se toca: resolver solo sella la fila del huérfano', async () => {
    respuesta = { data: null, error: null };
    await resolverHuerfanos('t1', ['h1'], 'adjuntado', 'v9');
    expect(llamadas.every((l) => l.tabla === 'comprobante_huerfano')).toBe(true);
    expect(Object.keys(llamadas.find((l) => l.metodo === 'update')!.args[0] as object).sort())
      .toEqual(['resolucion', 'resuelto_en', 'viaje_id']);
    expect(GASTO.monto).toBe(850);
  });
});
