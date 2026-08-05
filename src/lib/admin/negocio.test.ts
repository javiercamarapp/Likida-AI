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

// ── El lado RPC ────────────────────────────────────────────────────────────
// `llm_costo` ya no se trae: se agrega en la base con `resumen_costo_ia()`
// (mig. 0062). El mock guarda los argumentos de cada llamada para poder
// comprobar DOS cosas que la migración promete: que la tabla no se recorre por
// PostgREST ni una vez, y que la ventana se manda en NULL a propósito.
const rpcs = new Map<string, Resp>();
const llamadasRpc: Array<{ fn: string; args: unknown }> = [];

/** El resumen que devuelve la 0062 cuando no hay ni una llamada al modelo. */
const RESUMEN_VACIO = {
  totales: { n: 0, costoUsd: 0, tokensIn: 0, tokensOut: 0 },
  porFase: [], porModelo: [], porFaseModelo: [], porDia: [], porTenant: [],
};

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => crearBuilder(t),
    rpc: (fn: string, args: unknown) => {
      llamadasRpc.push({ fn, args });
      return Promise.resolve(rpcs.get(fn) ?? { data: RESUMEN_VACIO, error: null });
    },
  }),
}));

const { getResumenNegocio, getCostoPorFaseModelo, getConversacionesActivas } = await import('./negocio');

describe('getResumenNegocio', () => {
  beforeEach(() => { respuestas.clear(); rangos.clear(); rpcs.clear(); llamadasRpc.length = 0; });

  it('suma costo/tokens de TODOS los tenants y agrupa por fase', async () => {
    respuestas.set('tenant', { data: [{ id: 't1', nombre: 'Transportes Innovativos', plan: 'demo' }], error: null });
    respuestas.set('viaje', { data: [{ id: 'v1', tenant_id: 't1' }, { id: 'v2', tenant_id: 't1' }], error: null });
    // Lo mismo que antes eran tres filas de `llm_costo` ($1.005 + $0.5 en ocr,
    // $0.4272 en cuadre) llega ya sumado por la 0062, SIN redondear: el
    // redondeo a centavos sigue siendo de `round2()`.
    rpcs.set('resumen_costo_ia', {
      data: {
        totales: { n: 3, costoUsd: 1.9322, tokensIn: 1800, tokensOut: 350 },
        porFase: [
          { fase: 'ocr', n: 2, costoUsd: 1.505 },
          { fase: 'cuadre', n: 1, costoUsd: 0.4272 },
        ],
        porModelo: [
          { modelo: 'google/gemini-3.6-flash', n: 2, costoUsd: 1.505 },
          { modelo: 'anthropic/claude-5-sonnet', n: 1, costoUsd: 0.4272 },
        ],
        porFaseModelo: [
          { fase: 'ocr', modelo: 'google/gemini-3.6-flash', n: 2, costoUsd: 1.505 },
          { fase: 'cuadre', modelo: 'anthropic/claude-5-sonnet', n: 1, costoUsd: 0.4272 },
        ],
        porDia: [
          { dia: '2026-08-01', costoUsd: 1.505, tokens: 1800 },
          { dia: '2026-08-02', costoUsd: 0.4272, tokens: 350 },
        ],
        porTenant: [{ tenantId: 't1', costoUsd: 1.9322 }],
      },
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
    rpcs.set('resumen_costo_ia', {
      data: {
        ...RESUMEN_VACIO,
        totales: { n: 2, costoUsd: 25, tokensIn: 300, tokensOut: 0 },
        porDia: [
          // Semana anterior (26-jul a 1-ago): $10 total.
          { dia: '2026-07-28', costoUsd: 10, tokens: 100 },
          // Semana actual (2-ago a 8-ago, recortada por `hoy`): $15 total.
          { dia: '2026-08-02', costoUsd: 15, tokens: 200 },
        ],
      },
      error: null,
    });
    const r = await getResumenNegocio('2026-08-05');
    expect(r.tendenciaCosto).toBe(50); // (15-10)/10 × 100
    expect(r.tendenciaTokens).toBe(100); // (200-100)/100 × 100
  });

  it('un fallo de Supabase LANZA, no se lee como "cero negocio"', async () => {
    respuestas.set('gasto', { data: null, error: { message: 'fetch failed' } });
    await expect(getResumenNegocio()).rejects.toThrow('fetch failed');
  });

  it('un fallo de la RPC de costo LANZA, no se lee como "la IA salió gratis"', async () => {
    rpcs.set('resumen_costo_ia', { data: null, error: { message: 'fetch failed' } });
    await expect(getResumenNegocio()).rejects.toThrow('resumen_costo_ia: fetch failed');
  });

  // ── El modo de fallo que trae consigo mover la suma a la base ─────────────
  //
  // Una rama sin la 0062 aplicada, o una función que cambie de forma, devuelve
  // algo que no es este objeto. Leer `?.totales?.costoUsd ?? 0` sobre eso pinta
  // un cero que nadie midió — indistinguible de "este mes la IA no costó nada",
  // que es la cifra con la que se pone el precio del producto.
  it.each([
    ['null', null],
    ['un objeto vacío', {}],
    ['totales sin costoUsd', { totales: { n: 3 }, porFase: [], porModelo: [], porFaseModelo: [], porDia: [], porTenant: [] }],
    ['sin porFase', { totales: { n: 0, costoUsd: 0, tokensIn: 0, tokensOut: 0 }, porModelo: [], porFaseModelo: [], porDia: [], porTenant: [] }],
  ])('una respuesta con otra forma (%s) LANZA en vez de pintar $0', async (_caso, data) => {
    rpcs.set('resumen_costo_ia', { data, error: null });
    await expect(getResumenNegocio('2026-08-02')).rejects.toThrow(/no tiene la forma esperada/);
  });

  // ── Lo que la 0062 vino a garantizar ──────────────────────────────────────
  //
  // Antes esto paginaba `llm_costo` de mil en mil y LANZABA `LecturaIncompleta`
  // al pasar de 100,000 filas — o sea, a los ~50 días de operación real, con
  // ~2,000 llamadas al modelo diarias. Ahora la tabla no se recorre por
  // PostgREST ni una vez: la suma la hace la base.
  it('no pide NI UNA fila de `llm_costo`: la agrega en SQL', async () => {
    await getResumenNegocio('2026-08-02');
    expect(rangos.get('llm_costo')).toBeUndefined();
    expect(llamadasRpc).toEqual([
      { fn: 'resumen_costo_ia', args: { p_desde: null, p_hasta: null } },
    ]);
  });

  it('790 mil llamadas al modelo cuestan lo mismo que tres: UNA respuesta', async () => {
    // La cifra que reventaba: un año de operación a 30 viajes diarios. Antes
    // esto era `rejects.toThrow(/lectura incompleta/)` y el /admin no cargaba.
    rpcs.set('resumen_costo_ia', {
      data: {
        totales: { n: 790_000, costoUsd: 7_900.123456, tokensIn: 3_950_000, tokensOut: 790_000 },
        porFase: [{ fase: 'ocr', n: 790_000, costoUsd: 7_900.123456 }],
        porModelo: [{ modelo: 'm', n: 790_000, costoUsd: 7_900.123456 }],
        porFaseModelo: [{ fase: 'ocr', modelo: 'm', n: 790_000, costoUsd: 7_900.123456 }],
        porDia: [{ dia: '2026-08-01', costoUsd: 7_900.123456, tokens: 4_740_000 }],
        porTenant: [{ tenantId: 't1', costoUsd: 7_900.123456 }],
      },
      error: null,
    });
    const r = await getResumenNegocio('2026-08-02');
    expect(r.costoIaUsd).toBe(7_900.12);
    expect(r.porFase).toEqual([{ fase: 'ocr', n: 790_000, costoUsd: 7_900.12 }]);
    // Una sola llamada, y el `tokensIn` no desborda el int32 que ya no cabe en
    // `tokens_in` sumado (3.95e6 aquí, ~4e9 en la base: `sum()` da bigint).
    expect(llamadasRpc).toHaveLength(1);
    expect(r.tokensIn).toBe(3_950_000);
  });

  it('pide el total en la primera página, así que una tabla chica cuesta UNA consulta', async () => {
    respuestas.set('gasto', { data: [{ created_at: '2026-08-01T08:00:00Z' }], error: null });
    await getResumenNegocio('2026-08-02');
    expect(rangos.get('gasto')).toEqual([[0, 999]]);
  });
});

// `getCostoPorFaseModelo` sale del MISMO `resumen_costo_ia()`, como un sexto
// corte del `grouping sets`. Antes volvía a arrastrar `llm_costo` entera por
// segunda vez en las páginas que piden las dos cosas (Model Ops, Agente OCR).
describe('getCostoPorFaseModelo', () => {
  beforeEach(() => { respuestas.clear(); rangos.clear(); rpcs.clear(); llamadasRpc.length = 0; });

  it('devuelve el corte fase×modelo de la misma agregación, redondeado a centavos', async () => {
    rpcs.set('resumen_costo_ia', {
      data: {
        ...RESUMEN_VACIO,
        totales: { n: 3, costoUsd: 1.9322, tokensIn: 0, tokensOut: 0 },
        porFaseModelo: [
          { fase: 'ocr', modelo: 'google/gemini-3.6-flash', n: 2, costoUsd: 1.505 },
          { fase: 'cuadre', modelo: 'anthropic/claude-5-sonnet', n: 1, costoUsd: 0.4272 },
        ],
      },
      error: null,
    });
    const r = await getCostoPorFaseModelo();
    expect(r).toEqual([
      { fase: 'ocr', modelo: 'google/gemini-3.6-flash', n: 2, costoUsd: 1.51 },
      { fase: 'cuadre', modelo: 'anthropic/claude-5-sonnet', n: 1, costoUsd: 0.43 },
    ]);
    expect(rangos.get('llm_costo')).toBeUndefined();
    expect(llamadasRpc).toEqual([
      { fn: 'resumen_costo_ia', args: { p_desde: null, p_hasta: null } },
    ]);
  });

  it('un fallo de la RPC LANZA, no devuelve una lista vacía que se lea como "no hubo gasto"', async () => {
    rpcs.set('resumen_costo_ia', { data: null, error: { message: 'fetch failed' } });
    await expect(getCostoPorFaseModelo()).rejects.toThrow('resumen_costo_ia: fetch failed');
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
