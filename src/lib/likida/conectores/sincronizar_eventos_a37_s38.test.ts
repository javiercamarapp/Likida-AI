import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Http } from './tipos';

// A37-S38-03 / A37-S38-04: el cursor del poll de eventos.
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../presupuesto', () => ({ acotada: (q: unknown) => q }));
vi.mock('./cofre', () => ({ descifrar: (v: string) => JSON.parse(v) }));
vi.mock('../asistencia_camara', () => ({ dispararAsistenciaPorEventoCamara: vi.fn(async () => ({ resultado: 'abierta' })) }));

const est = vi.hoisted(() => ({
  finalizaciones: [] as Array<Record<string, unknown>>,
  cuarentena: [] as Array<Record<string, unknown>>,
}));
vi.mock('./poll_durable', () => ({
  procesarPollsEnPool: async (_r: string, _p: string[], _a: number, _o: unknown, fn: (c: unknown) => Promise<unknown>) => {
    const c = { tenantId: 't-1', proveedor: 'samsara', valoresCifrados: JSON.stringify({ token: 'x' }), watermarkEn: null, tailWatermarkEn: null };
    return [{ c, ok: await fn(c) }];
  },
  finalizarPoll: async (_r: string, _c: unknown, res: Record<string, unknown>) => { est.finalizaciones.push(res); },
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const api: Record<string, unknown> = {};
      const cadena = ['select', 'eq', 'in', 'or', 'is', 'order', 'limit', 'gte', 'lte', 'lt', 'gt', 'not', 'range'];
      for (const m of cadena) api[m] = () => api;
      api.maybeSingle = () => Promise.resolve({ data: null, error: null });
      api.upsert = (entrada: Array<Record<string, unknown>>) => {
        if (tabla === 'evento_seguridad_cuarentena') est.cuarentena.push(...entrada);
        const r = { data: entrada, error: null };
        const p = Promise.resolve(r) as Promise<unknown> & { select?: () => Promise<unknown> };
        p.select = () => Promise.resolve(r);
        return p;
      };
      api.then = (res: (v: unknown) => unknown) => res({
        data: tabla === 'unidad' ? [{ id: 'u-1', gps_device_id: 'dev-1' }] : [], error: null,
      });
      return api;
    },
    rpc: async () => ({ data: [], error: null }),
  }),
}));

import { sincronizarEventosTodas } from './sincronizar_eventos';

const sinAsset = { id: 'evt-sin-asset', startMs: '2026-08-26T17:55:00Z', behaviorLabels: [{ label: 'Crash' }] };
const http = (eventos: unknown[]): Http => async () => ({
  estado: 200, cuerpo: JSON.stringify({ data: eventos, pagination: { hasNextPage: false } }),
});

describe('A37-S38: cursor del poll de eventos', () => {
  beforeEach(() => { est.finalizaciones = []; est.cuarentena = []; });

  it('A37-S38-04: un evento sin asset va a cuarentena y NO congela el watermark', async () => {
    const rs = await sincronizarEventosTodas(http([sinAsset]), { ahora: () => Date.parse('2026-08-26T18:00:00Z') });
    expect(rs[0].error).toBeUndefined();
    expect(est.cuarentena.some((q) => q.motivo === 'referencia_incompleta')).toBe(true);
    const fin = est.finalizaciones.at(-1)!;
    expect(fin.completo).toBe(true);
    expect(fin.watermarkEn).toEqual(expect.any(String));
  });

  it('A37-S38-03: si el reloj se agota tras el tail y el histórico no corrió, el watermark NO avanza', async () => {
    let llamadas = 0;
    const venceEn = 1_000;
    // Reloj: vigente en los chequeos del tail, vencido justo antes del histórico.
    const base = Date.parse('2026-08-26T18:00:00Z');
    let vencido = false;
    const peticiones: string[] = [];
    const h: Http = async (p) => {
      peticiones.push(p.url);
      llamadas += 1;
      vencido = true; // al terminar la lectura del tail se agota el presupuesto
      return { estado: 200, cuerpo: JSON.stringify({ data: [], pagination: { hasNextPage: false } }) };
    };
    const ahora = () => (vencido ? base + venceEn + 1 : base);
    const rs = await sincronizarEventosTodas(h, { venceEn: base + venceEn, ahora });
    expect(llamadas).toBe(1); // el histórico no se consultó
    const fin = est.finalizaciones.at(-1)!;
    expect(fin.completo).toBe(false);
    expect(fin.watermarkEn).toBeNull();
    expect(rs[0].backlog).toBe(true);
  });
});
