import { describe, it, expect, vi, beforeEach } from 'vitest';

// getResumenNegocio — la consola de superadmin (docs/superpowers/plans/
// 2026-08-02-panel-superadmin.md). Cruza TENANTS, no filtra por tenant_id a
// propósito: es la única función de este repo con permiso de ver todas las
// flotas a la vez, y por eso vive fuera de analytics.ts (que es
// tenant-scoped en cada línea) — mezclar los dos hace fácil que alguien
// copie un patrón de aquí a una consulta de cliente y filtre de menos.
type Resp = { data: unknown; error: { message: string } | null };
const respuestas = new Map<string, Resp>();

function crearBuilder(tabla: string) {
  const resp = (): Resp => respuestas.get(tabla) ?? { data: [], error: null };
  const b: Record<string, unknown> = {};
  const self = () => b;
  for (const m of ['select', 'eq', 'order', 'limit']) b[m] = self;
  b.then = (ok: (v: Resp) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(resp()).then(ok, fail);
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => crearBuilder(t) }) }));

const { getResumenNegocio, getConversacionesActivas } = await import('./negocio');

describe('getResumenNegocio', () => {
  beforeEach(() => { respuestas.clear(); });

  it('suma costo/tokens de TODOS los tenants y agrupa por fase', async () => {
    respuestas.set('tenant', { data: [{ id: 't1', nombre: 'Transportes Innovativos', plan: 'demo' }], error: null });
    respuestas.set('viaje', { data: [{ id: 'v1', tenant_id: 't1' }, { id: 'v2', tenant_id: 't1' }], error: null });
    respuestas.set('llm_costo', {
      data: [
        { tenant_id: 't1', fase: 'ocr', modelo: 'google/gemini-3.6-flash', tokens_in: 1000, tokens_out: 200, costo_usd: 1.005, created_at: '2026-08-01T10:00:00Z' },
        { tenant_id: 't1', fase: 'ocr', modelo: 'google/gemini-3.6-flash', tokens_in: 500, tokens_out: 100, costo_usd: 0.5, created_at: '2026-08-01T14:00:00Z' },
        { tenant_id: 't1', fase: 'cuadre', modelo: 'anthropic/claude-5-sonnet', tokens_in: 300, tokens_out: 50, costo_usd: 0.4272, created_at: '2026-08-02T09:00:00Z' },
      ],
      error: null,
    });
    const r = await getResumenNegocio();
    expect(r.tenants).toBe(1);
    expect(r.flotas).toEqual([{ id: 't1', nombre: 'Transportes Innovativos', plan: 'demo', viajes: 2, costoIaUsd: 1.93 }]);
    expect(r.viajesProcesados).toBe(2);
    expect(r.costoIaUsd).toBe(1.93);
    expect(r.tokensIn).toBe(1800);
    expect(r.tokensOut).toBe(350);
    expect(r.porFase).toEqual([
      { fase: 'ocr', n: 2, costoUsd: 1.51 },
      { fase: 'cuadre', n: 1, costoUsd: 0.43 },
    ]);
    expect(r.porModelo).toEqual([
      { modelo: 'google/gemini-3.6-flash', n: 2, costoUsd: 1.51 },
      { modelo: 'anthropic/claude-5-sonnet', n: 1, costoUsd: 0.43 },
    ]);
    expect(r.porDia).toEqual([
      { dia: '2026-08-01', costoUsd: 1.51, tokens: 1800 },
      { dia: '2026-08-02', costoUsd: 0.43, tokens: 350 },
    ]);
  });

  it('sin datos (Likida recién arrancando), ceros — no un error ni un crash', async () => {
    const r = await getResumenNegocio();
    expect(r).toEqual({
      tenants: 0, flotas: [], viajesProcesados: 0, costoIaUsd: 0, tokensIn: 0, tokensOut: 0,
      porFase: [], porModelo: [], porDia: [],
    });
  });

  it('un fallo de Supabase LANZA, no se lee como "cero negocio"', async () => {
    respuestas.set('llm_costo', { data: null, error: { message: 'fetch failed' } });
    await expect(getResumenNegocio()).rejects.toThrow('fetch failed');
  });
});

// `estado` es una máquina de estados (qué espera el bot de este teléfono),
// NO un historial de mensajes — Likida no guarda el texto de WhatsApp. Esto
// prueba que se lee tal cual, sin inventar un "hilo de conversación" que no
// existe.
describe('getConversacionesActivas', () => {
  beforeEach(() => { respuestas.clear(); });

  it('trae el estado real, más reciente primero, con el nombre de la flota', async () => {
    respuestas.set('wa_conversacion', {
      data: [{
        telefono: '529993700779', updated_at: '2026-08-02T20:00:00Z',
        estado: { esperando: 'foto_comprobante', viajeId: 'v1' },
        tenant: { nombre: 'Transportes Innovativos' },
      }],
      error: null,
    });
    const r = await getConversacionesActivas();
    expect(r).toEqual([{
      telefono: '529993700779',
      tenantNombre: 'Transportes Innovativos',
      estado: { esperando: 'foto_comprobante', viajeId: 'v1' },
      actualizadaEn: '2026-08-02T20:00:00Z',
    }]);
  });

  it('sin tenant ligado, "—" en vez de reventar', async () => {
    respuestas.set('wa_conversacion', {
      data: [{ telefono: '529990000000', updated_at: '2026-08-02T20:00:00Z', estado: {}, tenant: null }],
      error: null,
    });
    const r = await getConversacionesActivas();
    expect(r[0].tenantNombre).toBe('—');
  });

  it('un fallo de Supabase lanza', async () => {
    respuestas.set('wa_conversacion', { data: null, error: { message: 'fetch failed' } });
    await expect(getConversacionesActivas()).rejects.toThrow('fetch failed');
  });
});
