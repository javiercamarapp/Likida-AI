import { describe, it, expect, vi, beforeEach } from 'vitest';

// getResumenNegocio — la consola de superadmin (docs/superpowers/plans/
// 2026-08-02-panel-superadmin.md). Cruza TENANTS, no filtra por tenant_id a
// propósito: es la única función de este repo con permiso de ver todas las
// flotas a la vez, y por eso vive fuera de analytics.ts (que es
// tenant-scoped en cada línea) — mezclar los dos hace fácil que alguien
// copie un patrón de aquí a una consulta de cliente y filtre de menos.
type Resp = { data: unknown; error: { message: string } | null; count?: number | null };
const respuestas = new Map<string, Resp>();
/** Los `range(desde, hasta)` que pidió cada tabla — para comprobar que se
 *  pagina UNA vez cuando el `count` ya dijo que no falta nada. */
const rangos = new Map<string, Array<[number, number]>>();

// El mock pagina COMO POSTGREST: `range` rebana, y `count` solo viene si la
// consulta lo pidió con `.select(cols, { count: 'exact' })`. Un mock que
// devolviera la tabla entera en cada `range` describiría una base que no
// existe —`range(1000, 1999)` sobre tres filas devuelve `[]`, no las tres— y
// es justo esa ficción la que dejaba pasar el recorte silencioso.
function crearBuilder(tabla: string) {
  const resp = (): Resp => respuestas.get(tabla) ?? { data: [], error: null };
  let pidioConteo = false;
  const b: Record<string, unknown> = {};
  const self = () => b;
  for (const m of ['eq', 'order', 'limit']) b[m] = self;
  b.select = (_cols?: unknown, opts?: { count?: string }) => {
    if (opts?.count === 'exact') pidioConteo = true;
    return b;
  };
  b.range = (desde: number, hasta: number) => {
    const r = resp();
    if (!rangos.has(tabla)) rangos.set(tabla, []);
    rangos.get(tabla)!.push([desde, hasta]);
    if (r.error) return Promise.resolve(r);
    const todas = (r.data ?? []) as unknown[];
    return Promise.resolve({
      data: todas.slice(desde, hasta + 1),
      error: null,
      count: pidioConteo ? todas.length : null,
    });
  };
  b.then = (ok: (v: Resp) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(resp()).then(ok, fail);
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => crearBuilder(t) }) }));

const { getResumenNegocio, getConversacionesActivas } = await import('./negocio');

describe('getResumenNegocio', () => {
  beforeEach(() => { respuestas.clear(); rangos.clear(); });

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
    respuestas.set('gasto', {
      data: [
        { created_at: '2026-08-01T08:00:00Z' }, { created_at: '2026-08-01T09:00:00Z' },
        { created_at: '2026-08-02T07:00:00Z' },
      ],
      error: null,
    });
    const r = await getResumenNegocio('2026-08-02');
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
    // Facturas por día: SIEMPRE las 7 fechas (0 donde no hubo actividad),
    // no solo las que tuvieron gasto — si no, la gráfica de barras
    // comprimiría una semana en 1-2 barras.
    expect(r.facturasPorDia).toEqual([
      { dia: '2026-07-27', n: 0 }, { dia: '2026-07-28', n: 0 }, { dia: '2026-07-29', n: 0 },
      { dia: '2026-07-30', n: 0 }, { dia: '2026-07-31', n: 0 },
      { dia: '2026-08-01', n: 2 }, { dia: '2026-08-02', n: 1 },
    ]);
    // Total histórico: TODAS las filas de gasto, sin filtro de fecha — no
    // solo las de la ventana de 7 días de arriba.
    expect(r.facturasTotal).toBe(3);
    // Sin 7 días previos con datos (Likida lleva 2 días), no hay contra qué
    // comparar — null, no "creció infinito".
    expect(r.tendenciaCosto).toBeNull();
    expect(r.tendenciaTokens).toBeNull();
  });

  it('sin datos (Likida recién arrancando), ceros — no un error ni un crash', async () => {
    const r = await getResumenNegocio('2026-08-02');
    expect(r).toEqual({
      tenants: 0, flotas: [], viajesProcesados: 0, costoIaUsd: 0, tokensIn: 0, tokensOut: 0,
      porFase: [], porModelo: [], porDia: [],
      facturasPorDia: [
        { dia: '2026-07-27', n: 0 }, { dia: '2026-07-28', n: 0 }, { dia: '2026-07-29', n: 0 },
        { dia: '2026-07-30', n: 0 }, { dia: '2026-07-31', n: 0 },
        { dia: '2026-08-01', n: 0 }, { dia: '2026-08-02', n: 0 },
      ],
      facturasTotal: 0,
      tendenciaCosto: null, tendenciaTokens: null,
    });
  });

  it('con dos semanas de historia, la tendencia es el % real de cambio', async () => {
    respuestas.set('tenant', { data: [], error: null });
    respuestas.set('viaje', { data: [], error: null });
    respuestas.set('llm_costo', {
      data: [
        // Semana anterior (26-jul a 1-ago): $10 total.
        { tenant_id: 't1', fase: 'ocr', modelo: 'm', tokens_in: 100, tokens_out: 0, costo_usd: 10, created_at: '2026-07-28T10:00:00Z' },
        // Semana actual (2-ago a 8-ago, recortada por `hoy`): $15 total.
        { tenant_id: 't1', fase: 'ocr', modelo: 'm', tokens_in: 200, tokens_out: 0, costo_usd: 15, created_at: '2026-08-02T10:00:00Z' },
      ],
      error: null,
    });
    const r = await getResumenNegocio('2026-08-05');
    expect(r.tendenciaCosto).toBe(50); // (15-10)/10 × 100
    expect(r.tendenciaTokens).toBe(100); // (200-100)/100 × 100
  });

  it('un fallo de Supabase LANZA, no se lee como "cero negocio"', async () => {
    respuestas.set('llm_costo', { data: null, error: { message: 'fetch failed' } });
    await expect(getResumenNegocio()).rejects.toThrow('fetch failed');
  });

  // ── El día que crezca de verdad es el mes 1 ───────────────────────────────
  //
  // `llm_costo` recibe una fila POR LLAMADA al modelo. Sin paginar, PostgREST
  // recortaba a `max_rows` en silencio y esta consola —donde se decide el
  // precio del producto— reportaba una fracción del gasto de IA sin marca de
  // estar incompleta.
  it('pagina `llm_costo`: la fila 1,001 entra en el total', async () => {
    const filas = Array.from({ length: 1_001 }, () => ({
      tenant_id: 't1', fase: 'ocr', modelo: 'm', tokens_in: 1, tokens_out: 0,
      costo_usd: 0.01, created_at: '2026-08-01T10:00:00Z',
    }));
    respuestas.set('llm_costo', { data: filas, error: null });
    const r = await getResumenNegocio('2026-08-02');
    expect(r.porFase[0].n).toBe(1_001);
    expect(r.costoIaUsd).toBe(10.01);
    expect(rangos.get('llm_costo')).toEqual([[0, 999], [1000, 1999]]);
  });

  it('pide el total en la primera página, así que una tabla chica cuesta UNA consulta', async () => {
    respuestas.set('gasto', { data: [{ created_at: '2026-08-01T08:00:00Z' }], error: null });
    await getResumenNegocio('2026-08-02');
    expect(rangos.get('gasto')).toEqual([[0, 999]]);
  });

  it('si la lectura no cabe en las 100 páginas, LANZA — no reporta una fracción del gasto', async () => {
    // 150,000 filas es lo que produce una flota con volumen real en un año.
    // Enseñar el costo de las primeras 100,000 como si fuera el total es
    // exactamente la cifra con la que se pondría mal el precio.
    respuestas.set('llm_costo', {
      data: Array.from({ length: 150_000 }, () => ({
        tenant_id: 't1', fase: 'ocr', modelo: 'm', tokens_in: 1, tokens_out: 0,
        costo_usd: 0.01, created_at: '2026-08-01T10:00:00Z',
      })),
      error: null,
    });
    await expect(getResumenNegocio('2026-08-02')).rejects.toThrow(/lectura incompleta/);
  });
});

// `estado` SÍ trae el historial de mensajes (`{ turns: ConvTurn[] }`, misma
// forma que conv.ts lee/escribe) — no una máquina de estados sin texto,
// como decía el comentario anterior de la función. Se corrigió tras verlo
// mal renderizado (JSON crudo desbordando la tarjeta).
describe('getConversacionesActivas', () => {
  beforeEach(() => { respuestas.clear(); rangos.clear(); });

  it('trae los turnos reales, más reciente primero, con el nombre de la flota', async () => {
    respuestas.set('wa_conversacion', {
      data: [{
        telefono: '529993700779', updated_at: '2026-08-02T20:00:00Z',
        estado: { turns: [{ role: 'user', content: 'Listo' }, { role: 'assistant', content: 'Listo, cuadré tu viaje' }] },
        tenant: { nombre: 'Transportes Innovativos' },
      }],
      error: null,
    });
    const r = await getConversacionesActivas();
    expect(r).toEqual([{
      telefono: '529993700779',
      tenantNombre: 'Transportes Innovativos',
      turns: [{ role: 'user', content: 'Listo' }, { role: 'assistant', content: 'Listo, cuadré tu viaje' }],
      actualizadaEn: '2026-08-02T20:00:00Z',
    }]);
  });

  it('sin turns (conversación recién creada) o estado ajeno, lista vacía en vez de reventar', async () => {
    respuestas.set('wa_conversacion', {
      data: [{ telefono: '529990000000', updated_at: '2026-08-02T20:00:00Z', estado: {}, tenant: null }],
      error: null,
    });
    const r = await getConversacionesActivas();
    expect(r[0].tenantNombre).toBe('—');
    expect(r[0].turns).toEqual([]);
  });

  it('un fallo de Supabase lanza', async () => {
    respuestas.set('wa_conversacion', { data: null, error: { message: 'fetch failed' } });
    await expect(getConversacionesActivas()).rejects.toThrow('fetch failed');
  });
});
