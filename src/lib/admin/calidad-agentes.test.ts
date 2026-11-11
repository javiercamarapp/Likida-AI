import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Resp = { data?: unknown[] | null; count?: number | null; error: { message: string } | null };
const porTabla = new Map<string, Resp>();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const r = porTabla.get(tabla) ?? { error: { message: 'no mockeada' } };
      const fin = () => Promise.resolve({ data: r.data ?? null, count: r.count ?? (r.data ? r.data.length : null), error: r.error });
      const api: Record<string, unknown> = {};
      for (const m of ['select', 'gte', 'order', 'range']) api[m] = () => api;
      (api as { then: unknown }).then = (res: (v: unknown) => unknown) => fin().then(res);
      return api;
    },
  }),
}));
vi.mock('@/lib/saludo', () => ({ ahoraMs: () => 1_755_000_000_000 }));

const {
  RESOLUTOR_AUTOMATICO_ESPEJO, getCalidadAgentes, percentil, resumirCorridasAgente, resumirRevision, tasa,
} = await import('./calidad-agentes');

beforeEach(() => porTabla.clear());

const pieza = (agente: string, estado: 'pendiente' | 'aprobado' | 'rechazado', extra: Partial<{ cuerpo_final: string | null; resuelto_por_email: string | null }> = {}) =>
  ({ agente, estado, cuerpo_final: null, resuelto_por_email: estado === 'pendiente' ? null : 'javier@x.mx', ...extra });

describe('tasa', () => {
  it('null bajo la muestra mínima o con datos incoherentes', () => {
    expect(tasa(1, 4)).toBeNull();
    expect(tasa(6, 5)).toBeNull();
    expect(tasa(-1, 10)).toBeNull();
    expect(tasa(NaN, 10)).toBeNull();
    expect(tasa(0, 10)).toBe(0); // 0 con muestra es una medición real
    expect(tasa(1, 8)).toBe(0.125);
  });
});

describe('resumirRevision', () => {
  it('cuenta revisión humana y corrección; la auto-aprobación del enviador NO es humana', () => {
    const filas = [
      pieza('redactor', 'aprobado'),
      pieza('redactor', 'aprobado', { cuerpo_final: 'editado' }),
      pieza('redactor', 'rechazado'),
      pieza('redactor', 'pendiente'),
      pieza('redactor', 'aprobado', { resuelto_por_email: RESOLUTOR_AUTOMATICO_ESPEJO }),
    ];
    const r = resumirRevision(filas).get('redactor')!;
    expect(r).toMatchObject({ piezas: 5, revisadasPorHumano: 3, corregidas: 2 });
    expect(r.tasaRevisionHumana).toBe(0.6);
    expect(r.tasaCorreccion).toBeNull(); // 3 revisadas < muestra mínima
  });

  it('muestra pequeña: las tasas son null aunque haya conteos', () => {
    const r = resumirRevision([pieza('sdr', 'aprobado'), pieza('sdr', 'rechazado')]).get('sdr')!;
    expect(r.piezas).toBe(2);
    expect(r.tasaRevisionHumana).toBeNull();
  });

  it('el espejo del resolutor automático coincide con enviador.ts', () => {
    const src = readFileSync(join(__dirname, '../likida/agentes/enviador.ts'), 'utf8');
    expect(src).toContain(`export const RESOLUTOR_AUTOMATICO = '${RESOLUTOR_AUTOMATICO_ESPEJO}'`);
  });
});

describe('resumirCorridasAgente', () => {
  const c = (seg: number | null, costo: number | string | null) => ({
    agente: 'peajes', inicio: '2026-11-01T00:00:00.000Z',
    fin: seg === null ? null : new Date(Date.parse('2026-11-01T00:00:00.000Z') + seg * 1000).toISOString(),
    estado: 'ok' as const, costo_usd: costo,
  });

  it('p50/p95 de rango más cercano y costo solo de lo medido', () => {
    const filas = [1, 2, 3, 4, 100].map((s) => c(s, 0.01));
    const r = resumirCorridasAgente(filas).get('peajes')!;
    expect(r).toMatchObject({ total: 5, medibles: 5, p50Ms: 3000, p95Ms: 100_000, conCosto: 5 });
    expect(r.costoUsdTotal).toBeCloseTo(0.05);
    expect(r.costoPorCorridaUsd).toBeCloseTo(0.01);
  });

  it('sin muestra o sin fin/costo: null, no 0', () => {
    const r = resumirCorridasAgente([c(1, null), c(null, null)]).get('peajes')!;
    expect(r).toMatchObject({ total: 2, medibles: 1, p50Ms: null, p95Ms: null, conCosto: 0, costoUsdTotal: null, costoPorCorridaUsd: null });
  });

  it('costo 0 medido es 0; costo en texto numérico se lee; fin anterior a inicio se descarta', () => {
    const malo = { ...c(1, '0.5'), fin: '2026-10-31T00:00:00.000Z' };
    const r = resumirCorridasAgente([c(1, 0), malo]).get('peajes')!;
    expect(r.medibles).toBe(1);
    expect(r.costoUsdTotal).toBe(0.5);
  });

  it('percentil de lista vacía es null', () => expect(percentil([], 0.5)).toBeNull());
});

describe('getCalidadAgentes', () => {
  it('une las tres fuentes por agente', async () => {
    porTabla.set('cola_aprobacion', { data: Array.from({ length: 5 }, () => pieza('redactor', 'aprobado')), error: null });
    porTabla.set('agente_corrida', {
      data: [{ agente: 'redactor', inicio: '2026-11-01T00:00:00.000Z', fin: '2026-11-01T00:00:02.000Z', estado: 'ok', costo_usd: 0.02 }],
      error: null,
    });
    porTabla.set('orquestador_escalacion', { data: [], count: 3, error: null });
    const r = await getCalidadAgentes();
    expect(r.fuentes).toEqual({ cola: 'ok', corridas: 'ok', escalaciones: 'ok' });
    const red = r.agentes.find((a) => a.agente === 'redactor')!;
    expect(red.revision).toMatchObject({ piezas: 5, tasaRevisionHumana: 1 });
    expect(red.corridas).toMatchObject({ total: 1, p95Ms: null, costoUsdTotal: 0.02 });
    expect(red.escalada).toMatchObject({ escaladas: null, tasa: null });
    const orq = r.agentes.find((a) => a.agente === 'orquestador')!;
    expect(orq.escalada).toMatchObject({ escaladas: 3, tasa: null });
  });

  it('falla cerrada por fuente: lo ilegible es null y se declara, las otras siguen', async () => {
    porTabla.set('cola_aprobacion', { error: { message: 'boom' } });
    porTabla.set('agente_corrida', {
      data: [{ agente: 'peajes', inicio: '2026-11-01T00:00:00.000Z', fin: null, estado: 'fallo', costo_usd: null }],
      error: null,
    });
    // orquestador_escalacion sin mockear => error
    const r = await getCalidadAgentes();
    expect(r.fuentes).toEqual({ cola: 'error', corridas: 'ok', escalaciones: 'error' });
    expect(r.errores.join(' ')).toMatch(/cola_aprobacion: .*boom/);
    const p = r.agentes.find((a) => a.agente === 'peajes')!;
    expect(p.revision).toBeNull();
    expect(p.corridas?.total).toBe(1);
  });

  it('sin datos en ninguna fuente: lista vacía (no agentes inventados)', async () => {
    porTabla.set('cola_aprobacion', { data: [], error: null });
    porTabla.set('agente_corrida', { data: [], error: null });
    porTabla.set('orquestador_escalacion', { data: [], count: 0, error: null });
    expect((await getCalidadAgentes()).agentes).toEqual([]);
  });
});
