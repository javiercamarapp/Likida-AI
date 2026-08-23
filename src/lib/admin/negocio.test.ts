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
//
// También como PostgREST: `.eq` FILTRA de verdad y `.limit` recorta (los usan
// las lecturas de `agente_corrida`), y `head: true` cuenta sin mandar NI UNA
// fila (`data: null`) — un mock donde eq/limit fueran no-ops "pasaría" una
// consulta que trae la tabla entera, que es justo lo que esas lecturas
// prometen no hacer. Un fixture puede forzar `count` explícito (incluso
// `null`) para probar el head al que PostgREST no le devolvió conteo.
function crearBuilder(tabla: string) {
  const raw = (): Resp => respuestas.get(tabla) ?? { data: [], error: null };
  let pidioConteo = false;
  let esHead = false;
  let tope: number | null = null;
  const filtros: Array<[string, unknown]> = [];
  const filtradas = (): Array<Record<string, unknown>> => {
    let todas = (raw().data ?? []) as Array<Record<string, unknown>>;
    for (const [col, val] of filtros) todas = todas.filter((f) => f[col] === val);
    return todas;
  };
  const b: Record<string, unknown> = {};
  b.order = () => b; // el orden lo simula el fixture: se declara ya ordenado
  b.eq = (col: string, val: unknown) => { filtros.push([col, val]); return b; };
  b.limit = (n: number) => { tope = n; return b; };
  b.select = (_cols?: unknown, opts?: { count?: string; head?: boolean }) => {
    if (opts?.count === 'exact') pidioConteo = true;
    if (opts?.head) esHead = true;
    return b;
  };
  b.range = (desde: number, hasta: number) => {
    const r = raw();
    if (!rangos.has(tabla)) rangos.set(tabla, []);
    rangos.get(tabla)!.push([desde, hasta]);
    if (r.error) return Promise.resolve(r);
    const todas = filtradas();
    return Promise.resolve({
      data: todas.slice(desde, hasta + 1),
      error: null,
      count: pidioConteo ? todas.length : null,
    });
  };
  b.then = (ok: (v: Resp) => unknown, fail?: (e: unknown) => unknown) => {
    const r = raw();
    if (r.error) return Promise.resolve(r).then(ok, fail);
    const todas = filtradas();
    const count = 'count' in r ? (r.count ?? null) : pidioConteo ? todas.length : null;
    return Promise.resolve({
      data: esHead ? null : tope !== null ? todas.slice(0, tope) : todas,
      error: null,
      count,
    }).then(ok, fail);
  };
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

// ── La 0153, simulada sobre las fixtures ───────────────────────────────────
// `viaje` y `gasto` TAMPOCO se traen desde el 22-ago-2026 (mig. 0153,
// `resumen_negocio()`): se cuentan en la base. El mock hace aquí lo que hace
// la RPC —count(*) por flota; count(*) por DÍA LOCAL DE MÉXICO de las filas
// con `created_at >= p_desde`; totales sin fecha— sobre las MISMAS fixtures
// de `respuestas`, para que cada caso de abajo siga describiendo filas reales
// y no un jsonb armado a mano. Un error sembrado en cualquiera de las dos
// tablas sale como error de la RPC (por valor, como PostgREST).
const diaMxDe = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
function resumenNegocioSql(args: { p_desde: string | null }): Resp {
  const v = respuestas.get('viaje') ?? { data: [], error: null };
  const g = respuestas.get('gasto') ?? { data: [], error: null };
  if (v.error) return { data: null, error: v.error };
  if (g.error) return { data: null, error: g.error };
  const viajes = (v.data ?? []) as Array<{ tenant_id: string }>;
  const gastos = (g.data ?? []) as Array<{ created_at: string }>;
  const porTenant = new Map<string, number>();
  for (const x of viajes) porTenant.set(x.tenant_id, (porTenant.get(x.tenant_id) ?? 0) + 1);
  const desdeMs = args.p_desde === null ? -Infinity : Date.parse(args.p_desde);
  const porDia = new Map<string, number>();
  for (const x of gastos) {
    if (Date.parse(x.created_at) < desdeMs) continue;
    const dia = diaMxDe(x.created_at);
    porDia.set(dia, (porDia.get(dia) ?? 0) + 1);
  }
  return {
    data: {
      viajesTotal: viajes.length,
      viajesPorTenant: [...porTenant].sort(([a], [b]) => a.localeCompare(b)).map(([tenantId, n]) => ({ tenantId, n })),
      facturasTotal: gastos.length,
      facturasPorDia: [...porDia].sort(([a], [b]) => a.localeCompare(b)).map(([dia, n]) => ({ dia, n })),
    },
    error: null,
  };
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => crearBuilder(t),
    rpc: (fn: string, args: unknown) => {
      llamadasRpc.push({ fn, args });
      if (rpcs.has(fn)) return Promise.resolve(rpcs.get(fn));
      if (fn === 'resumen_negocio') return Promise.resolve(resumenNegocioSql(args as { p_desde: string | null }));
      return Promise.resolve({ data: RESUMEN_VACIO, error: null });
    },
  }),
}));

const {
  getResumenNegocio, getCostoPorFaseModelo, getConversacionesActivas,
  getConteosPlataforma, getCorridasRecientes, getUltimaCorridaPorAgente, AGENTES_BITACORA,
  getCorridasFallidas, getLiquidacionesEnRevisar, contarLiquidacionesEnRevisar, LIMITE_LIQUIDACIONES_REVISAR,
  costoIaMesActual, costoIaDeTenant, SEGUNDOS_CACHE_CONSOLA,
} = await import('./negocio');

describe('getResumenNegocio', () => {
  beforeEach(() => { respuestas.clear(); rangos.clear(); rpcs.clear(); llamadasRpc.length = 0; });

  it('suma costo/tokens de TODOS los tenants y agrupa por fase', async () => {
    respuestas.set('tenant', { data: [{ id: 't1', nombre: 'Flota Demo SA de CV', plan: 'demo' }], error: null });
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
    // `politicaPropia` sale del override CRUDO de tenant.config — sin
    // config, false: la flota corre con la política de demo.
    expect(r.flotas).toEqual([{ id: 't1', nombre: 'Flota Demo SA de CV', plan: 'demo', viajes: 2, costoIaUsd: 1.93, politicaPropia: false }]);
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
  it('no pide NI UNA fila de `llm_costo`, `viaje` ni `gasto`: las agrega en SQL', async () => {
    respuestas.set('viaje', { data: [{ id: 'v1', tenant_id: 't1' }], error: null });
    respuestas.set('gasto', { data: [{ created_at: '2026-08-01T08:00:00Z' }], error: null });
    await getResumenNegocio('2026-08-02');
    expect(rangos.get('llm_costo')).toBeUndefined();
    // La 0153: ni `viaje` ni `gasto` cruzan PostgREST por páginas.
    expect(rangos.get('viaje')).toBeUndefined();
    expect(rangos.get('gasto')).toBeUndefined();
    expect(llamadasRpc).toEqual([
      { fn: 'resumen_costo_ia', args: { p_desde: null, p_hasta: null } },
      // `p_desde` = medianoche DE MÉXICO del primer día de la ventana de 7
      // (27-jul con hoy=2-ago): 06:00Z, porque México no tiene horario de
      // verano desde 2022. La RPC bucketea por día local MX desde ahí.
      { fn: 'resumen_negocio', args: { p_desde: '2026-07-27T06:00:00.000Z' } },
    ]);
  });

  // ── ESC-10 · la caché de la consola ──────────────────────────────────────
  it('las dos RPC se cachean 60 s; el catálogo de flotas NO — se edita desde /admin', async () => {
    expect(SEGUNDOS_CACHE_CONSOLA).toBe(60);
    await getResumenNegocio('2026-08-02');
    // `tenant` SIGUE leyéndose en vivo, por páginas: si se cacheara, la flota
    // recién dada de alta no aparecería hasta un minuto después y el
    // `revalidatePath` de esa acción se vería no hacer nada.
    expect(rangos.get('tenant')).toBeDefined();
    // Y las dos RPC entran a la caché SIEMPRE con los mismos argumentos
    // explícitos: `unstable_cache` mete los argumentos en la llave, así que
    // llamar unas veces con `()` y otras con `(null, null)` guardaría DOS
    // entradas idénticas — dos recorridos de `llm_costo` en vez de uno.
    expect(llamadasRpc.filter((l) => l.fn === 'resumen_costo_ia'))
      .toEqual([{ fn: 'resumen_costo_ia', args: { p_desde: null, p_hasta: null } }]);
  });

  it('la ventana de 30 días mueve `p_desde` 30 días atrás (hoy incluido)', async () => {
    await getResumenNegocio('2026-08-02', 30);
    expect(llamadasRpc.find((l) => l.fn === 'resumen_negocio')?.args).toEqual({ p_desde: '2026-07-04T06:00:00.000Z' });
  });

  // ── Lo que la 0153 vino a garantizar ──────────────────────────────────────
  //
  // Con un cliente de 50,000 viajes/mes, `gasto` (300,000 filas/mes) rebasaba
  // las 100,000 filas de `traerTodo` al día ~10 y las 17 páginas de /admin que
  // leen esto dejaban de cargar. Ahora el payload depende del número de
  // FLOTAS y de DÍAS de la ventana, no del de viajes ni comprobantes.
  it('3.6 millones de facturas y 600 mil viajes cuestan lo mismo que tres: UNA respuesta', async () => {
    rpcs.set('resumen_negocio', {
      data: {
        viajesTotal: 600_000,
        viajesPorTenant: [{ tenantId: 't1', n: 600_000 }],
        facturasTotal: 3_600_000,
        facturasPorDia: [{ dia: '2026-08-01', n: 9_800 }, { dia: '2026-08-02', n: 10_200 }],
      },
      error: null,
    });
    respuestas.set('tenant', { data: [{ id: 't1', nombre: 'Grande', plan: 'pro' }], error: null });
    const r = await getResumenNegocio('2026-08-02');
    expect(r.viajesProcesados).toBe(600_000);
    expect(r.facturasTotal).toBe(3_600_000);
    expect(r.flotas[0].viajes).toBe(600_000);
    expect(r.facturasPorDia.slice(-2)).toEqual([{ dia: '2026-08-01', n: 9_800 }, { dia: '2026-08-02', n: 10_200 }]);
    expect(rangos.get('viaje')).toBeUndefined();
    expect(rangos.get('gasto')).toBeUndefined();
  });

  it('un fallo de la RPC de negocio LANZA, no se lee como "cero viajes"', async () => {
    rpcs.set('resumen_negocio', { data: null, error: { message: 'fetch failed' } });
    await expect(getResumenNegocio('2026-08-02')).rejects.toThrow('resumen_negocio: fetch failed');
  });

  // Fail-closed de FORMA: una rama sin la 0153, o una función que cambie de
  // forma, no puede leerse como "0 viajes procesados, 0 facturas".
  it.each([
    ['null', null],
    ['un objeto vacío', {}],
    ['viajesTotal que no es entero', { viajesTotal: 1.5, viajesPorTenant: [], facturasTotal: 0, facturasPorDia: [] }],
    ['viajesTotal negativo', { viajesTotal: -1, viajesPorTenant: [], facturasTotal: 0, facturasPorDia: [] }],
    ['sin facturasPorDia', { viajesTotal: 0, viajesPorTenant: [], facturasTotal: 0 }],
    ['una flota sin tenantId', { viajesTotal: 1, viajesPorTenant: [{ n: 1 }], facturasTotal: 0, facturasPorDia: [] }],
    ['un día con n que no es número', { viajesTotal: 0, viajesPorTenant: [], facturasTotal: 1, facturasPorDia: [{ dia: '2026-08-01', n: '1' }] }],
  ])('una respuesta de negocio con otra forma (%s) LANZA en vez de pintar ceros', async (_caso, data) => {
    rpcs.set('resumen_negocio', { data, error: null });
    await expect(getResumenNegocio('2026-08-02')).rejects.toThrow(/0153/);
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
    // Una sola llamada a la de costo (la otra es la 0153, de viaje/gasto), y
    // el `tokensIn` no desborda el int32 que ya no cabe en `tokens_in` sumado
    // (3.95e6 aquí, ~4e9 en la base: `sum()` da bigint).
    expect(llamadasRpc.filter((l) => l.fn === 'resumen_costo_ia')).toHaveLength(1);
    expect(r.tokensIn).toBe(3_950_000);
  });

  it('`tenant` (la única tabla que sigue viniendo) pide el total en la primera página: UNA consulta', async () => {
    respuestas.set('tenant', { data: [{ id: 't1', nombre: 'Flota', plan: 'demo' }], error: null });
    await getResumenNegocio('2026-08-02');
    expect(rangos.get('tenant')).toEqual([[0, 999]]);
  });

  // ── El bug UTC de facturasPorDia (hallazgo 13-ago-2026) ──────────────────
  //
  // `slice(0, 10)` sobre el timestamptz era el día UTC: una factura de las
  // 7pm de CDMX (01:00Z del día siguiente) contaba en la barra de MAÑANA, y
  // el default de `hoy` (`toISOString().slice(0,10)`) rotulaba la última
  // barra con una fecha que el usuario todavía no vivía.
  it('facturasPorDia agrupa por el DÍA DE MÉXICO, no el UTC', async () => {
    respuestas.set('gasto', {
      data: [
        // 2-ago 19:00 en CDMX (UTC−6) — en UTC ya es 3-ago.
        { created_at: '2026-08-03T01:00:00Z' },
        // 2-ago 06:00 en CDMX — mismo día en ambas zonas.
        { created_at: '2026-08-02T12:00:00Z' },
      ],
      error: null,
    });
    const r = await getResumenNegocio('2026-08-02');
    // Las DOS caen en la barra del 2-ago; ninguna se fuga al 3.
    expect(r.facturasPorDia.at(-1)).toEqual({ dia: '2026-08-02', n: 2 });
    expect(r.facturasPorDia.every((d) => d.dia <= '2026-08-02')).toBe(true);
  });

  it('a las 6pm de CDMX el default de `hoy` sigue siendo HOY (día MX), no mañana (UTC)', async () => {
    vi.useFakeTimers();
    // 00:30Z del 3-ago = 2-ago 18:30 en CDMX — la hora exacta del reporte.
    vi.setSystemTime(new Date('2026-08-03T00:30:00Z'));
    try {
      const r = await getResumenNegocio(); // sin `hoy`: se ejercita el default
      expect(r.facturasPorDia.at(-1)?.dia).toBe('2026-08-02');
    } finally {
      vi.useRealTimers();
    }
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
        tenant: { nombre: 'Flota Demo SA de CV' },
      }],
      error: null,
    });
    const r = await getConversacionesActivas();
    expect(r).toEqual([{
      telefono: '529993700779',
      tenantNombre: 'Flota Demo SA de CV',
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

// Los conteos de plataforma del Inicio: operadores, liquidaciones y
// conversaciones se cuentan con `head: true` (la base cuenta, no viajan
// filas); `app_user` sí se trae —solo `rol`— porque además del total se
// quiere el desglose.
describe('getConteosPlataforma', () => {
  beforeEach(() => { respuestas.clear(); rangos.clear(); rpcs.clear(); llamadasRpc.length = 0; });

  it('cuenta las tres tablas sin traer filas y agrupa app_user por rol', async () => {
    respuestas.set('operador', { data: [{ id: 'o1' }, { id: 'o2' }], error: null });
    respuestas.set('liquidacion', { data: [{ id: 'l1' }], error: null });
    respuestas.set('wa_conversacion', { data: [{ id: 'w1' }, { id: 'w2' }, { id: 'w3' }], error: null });
    // Ya ordenadas por rol, como las devuelve la consulta real.
    respuestas.set('app_user', {
      data: [{ rol: 'contador' }, { rol: 'flota_admin' }, { rol: 'superadmin' }, { rol: 'superadmin' }],
      error: null,
    });
    const r = await getConteosPlataforma();
    expect(r).toEqual({
      operadores: 2,
      liquidaciones: 1,
      conversacionesWa: 3,
      usuarios: 4,
      usuariosPorRol: [
        { rol: 'contador', n: 1 }, { rol: 'flota_admin', n: 1 }, { rol: 'superadmin', n: 2 },
      ],
    });
    // Los head-counts no paginan: ni un `range` sobre esas tablas.
    expect(rangos.get('operador')).toBeUndefined();
    expect(rangos.get('liquidacion')).toBeUndefined();
    expect(rangos.get('wa_conversacion')).toBeUndefined();
    // `app_user` sí, y pide el total en la primera página.
    expect(rangos.get('app_user')).toEqual([[0, 999]]);
  });

  it('base vacía: ceros CONTADOS (0 filas de verdad), no inventados', async () => {
    const r = await getConteosPlataforma();
    expect(r).toEqual({ operadores: 0, liquidaciones: 0, conversacionesWa: 0, usuarios: 0, usuariosPorRol: [] });
  });

  it('un fallo de Supabase LANZA, no se lee como "no hay nadie"', async () => {
    respuestas.set('liquidacion', { data: null, error: { message: 'fetch failed' } });
    await expect(getConteosPlataforma()).rejects.toThrow('fetch failed');
  });

  it('un head SIN conteo LANZA — NULL no es 0', async () => {
    // PostgREST puede responder sin `count` (p. ej. sin `Prefer: count=exact`
    // honrado); leerle `?? 0` afirmaría "cero operadores" sin haber contado.
    respuestas.set('operador', { data: [], error: null, count: null });
    await expect(getConteosPlataforma()).rejects.toThrow(/no devolvió el conteo/);
  });
});

// La bitácora de `agente_corrida` (0102) vista cross-tenant. El fixture se
// declara YA ordenado por `inicio` desc — el orden real lo pone la base
// (`order('inicio', { ascending: false })`), el mock no reordena.
const CORRIDAS = [
  {
    agente: 'liquidacion', estado: 'ok', disparo: 'cron',
    inicio: '2026-08-14T09:00:00Z', fin: '2026-08-14T09:00:03Z',
    tareas_hechas: 2, tareas_total: 2,
    tenant_id: 't1', tenant: { nombre: 'Flota Demo SA de CV' },
  },
  {
    // Una corrida SIN cerrar y sin tareas: `fin`/`tareas_*` en NULL no se
    // convierten en 0 ni en '' — la ficha pinta «—», no una medición.
    agente: 'cobranza', estado: 'fallo', disparo: 'manual',
    inicio: '2026-08-13T09:00:00Z', fin: null,
    tareas_hechas: null, tareas_total: null,
    tenant_id: 't2', tenant: null,
  },
  {
    agente: 'liquidacion', estado: 'parcial', disparo: 'cron',
    inicio: '2026-08-12T09:00:00Z', fin: '2026-08-12T09:00:09Z',
    tareas_hechas: 1, tareas_total: 3,
    tenant_id: 't1', tenant: { nombre: 'Flota Demo SA de CV' },
  },
  {
    // `ventas` (0105) corre para LIKIDA misma: `tenant_id` NULL no es un
    // hueco de datos, es "negocio, no flota" — y el mapeo lo dice.
    agente: 'ventas', estado: 'ok', disparo: 'manual',
    inicio: '2026-08-11T09:00:00Z', fin: '2026-08-11T09:00:12Z',
    tareas_hechas: 5, tareas_total: 5,
    tenant_id: null, tenant: null,
  },
];

describe('getCorridasRecientes', () => {
  beforeEach(() => { respuestas.clear(); rangos.clear(); });

  it('trae las últimas cross-tenant con la flota aplanada y NULL como null', async () => {
    respuestas.set('agente_corrida', { data: CORRIDAS, error: null });
    const r = await getCorridasRecientes();
    expect(r).toEqual([
      {
        agente: 'liquidacion', estado: 'ok', disparo: 'cron',
        inicio: '2026-08-14T09:00:00Z', fin: '2026-08-14T09:00:03Z',
        tareasHechas: 2, tareasTotal: 2,
        tenantId: 't1', tenantNombre: 'Flota Demo SA de CV',
      },
      {
        agente: 'cobranza', estado: 'fallo', disparo: 'manual',
        inicio: '2026-08-13T09:00:00Z', fin: null,
        tareasHechas: null, tareasTotal: null,
        tenantId: 't2', tenantNombre: '—',
      },
      {
        agente: 'liquidacion', estado: 'parcial', disparo: 'cron',
        inicio: '2026-08-12T09:00:00Z', fin: '2026-08-12T09:00:09Z',
        tareasHechas: 1, tareasTotal: 3,
        tenantId: 't1', tenantNombre: 'Flota Demo SA de CV',
      },
      {
        agente: 'ventas', estado: 'ok', disparo: 'manual',
        inicio: '2026-08-11T09:00:00Z', fin: '2026-08-11T09:00:12Z',
        tareasHechas: 5, tareasTotal: 5,
        tenantId: null, tenantNombre: 'Likida (negocio)',
      },
    ]);
  });

  it('respeta el límite pedido', async () => {
    respuestas.set('agente_corrida', { data: CORRIDAS, error: null });
    const r = await getCorridasRecientes(1);
    expect(r).toHaveLength(1);
    expect(r[0].inicio).toBe('2026-08-14T09:00:00Z');
  });

  it('un fallo LANZA, no se lee como "ningún agente ha corrido"', async () => {
    respuestas.set('agente_corrida', { data: null, error: { message: 'fetch failed' } });
    await expect(getCorridasRecientes()).rejects.toThrow('getCorridasRecientes: fetch failed');
  });
});

describe('getUltimaCorridaPorAgente', () => {
  beforeEach(() => { respuestas.clear(); rangos.clear(); });

  it('una entrada POR agente del dominio: la última de los que corrieron, null honesto en el resto', async () => {
    respuestas.set('agente_corrida', { data: CORRIDAS, error: null });
    const r = await getUltimaCorridaPorAgente();
    expect(r).toHaveLength(AGENTES_BITACORA.length);
    const porId = new Map(r.map((a) => [a.agente, a.ultima]));
    // El `.eq('agente')` + `limit(1)` de verdad filtran: liquidacion toma SU
    // fila más reciente (la 'ok' del 14-ago, no la 'parcial' del 12).
    expect(porId.get('liquidacion')).toMatchObject({ estado: 'ok', inicio: '2026-08-14T09:00:00Z', tareasHechas: 2 });
    expect(porId.get('cobranza')).toMatchObject({ estado: 'fallo', tenantNombre: '—' });
    // `ventas` sin tenant (0105): el NULL se traduce a "negocio", no a hueco.
    expect(porId.get('ventas')).toMatchObject({ estado: 'ok', tenantId: null, tenantNombre: 'Likida (negocio)' });
    // Los que no tienen ni una fila: null, no un objeto con ceros.
    expect(porId.get('facturas')).toBeNull();
    expect(porId.get('conductores')).toBeNull();
    expect(porId.get('peajes')).toBeNull();
    expect(porId.get('proveedores')).toBeNull();
  });

  it('con la bitácora vacía, los seis en null — "sin corridas" lo dice la UI, no un cero', async () => {
    const r = await getUltimaCorridaPorAgente();
    expect(r).toHaveLength(AGENTES_BITACORA.length);
    expect(r.every((a) => a.ultima === null)).toBe(true);
  });

  it('un fallo LANZA en vez de responder a medias', async () => {
    respuestas.set('agente_corrida', { data: null, error: { message: 'fetch failed' } });
    await expect(getUltimaCorridaPorAgente()).rejects.toThrow(/getUltimaCorridaPorAgente\/\w+: fetch failed/);
  });
});

// La vista de la bandeja de escalaciones: SOLO las corridas en `fallo`,
// mapeadas con el MISMO `mapearCorrida` que el resto (una corrida no puede
// contarse distinto en dos pantallas).
describe('getCorridasFallidas', () => {
  beforeEach(() => { respuestas.clear(); rangos.clear(); });

  it('filtra por estado=fallo de verdad y conserva el NULL honesto', async () => {
    respuestas.set('agente_corrida', { data: CORRIDAS, error: null });
    const r = await getCorridasFallidas();
    // El fixture trae 4 corridas y solo UNA en fallo (cobranza) — si el
    // `.eq` no filtrara, vendrían las 4.
    expect(r).toEqual([{
      agente: 'cobranza', estado: 'fallo', disparo: 'manual',
      inicio: '2026-08-13T09:00:00Z', fin: null,
      tareasHechas: null, tareasTotal: null,
      tenantId: 't2', tenantNombre: '—',
    }]);
  });

  it('un fallo de lectura LANZA — "0 fallos" sobre una base caída afirmaría que todo corrió bien', async () => {
    respuestas.set('agente_corrida', { data: null, error: { message: 'fetch failed' } });
    await expect(getCorridasFallidas()).rejects.toThrow('getCorridasFallidas: fetch failed');
  });
});

// Las liquidaciones en `revisar` cruzadas — la versión cross-tenant de lo
// que `getKpis` cuenta por-tenant. El dato es el estatus ACTUAL (el upsert
// de guardar_liquidacion_tx lo reescribe sin rastro), y el tipo lo dice.
describe('getLiquidacionesEnRevisar', () => {
  beforeEach(() => { respuestas.clear(); rangos.clear(); });

  const LIQUIDACIONES = [
    {
      id: 'l1', estatus: 'revisar', created_at: '2026-08-10T15:00:00Z',
      tenant_id: 't1', tenant: { nombre: 'Flota Demo SA de CV' }, viaje: { folio: 'V-001' },
    },
    { id: 'l2', estatus: 'cuadrada', created_at: '2026-08-11T15:00:00Z', tenant_id: 't1', tenant: { nombre: 'Flota Demo SA de CV' }, viaje: null },
    {
      // Viaje despachado por WhatsApp: nace sin folio (0092) — null, no ''.
      id: 'l3', estatus: 'revisar', created_at: '2026-08-12T15:00:00Z',
      tenant_id: 't2', tenant: null, viaje: { folio: null },
    },
  ];

  it('trae SOLO las que están en revisar, con folio y flota aplanados', async () => {
    respuestas.set('liquidacion', { data: LIQUIDACIONES, error: null });
    const r = await getLiquidacionesEnRevisar();
    expect(r).toEqual([
      { id: 'l1', creadaEn: '2026-08-10T15:00:00Z', folio: 'V-001', tenantId: 't1', tenantNombre: 'Flota Demo SA de CV' },
      { id: 'l3', creadaEn: '2026-08-12T15:00:00Z', folio: null, tenantId: 't2', tenantNombre: '—' },
    ]);
  });

  it('con la tabla vacía, lista vacía CONTADA — cero de verdad, no inventado', async () => {
    const r = await getLiquidacionesEnRevisar();
    expect(r).toEqual([]);
  });

  it('un fallo de lectura LANZA — una bandeja vacía sobre una base caída diría "nadie espera revisión"', async () => {
    respuestas.set('liquidacion', { data: null, error: { message: 'fetch failed' } });
    await expect(getLiquidacionesEnRevisar()).rejects.toThrow('fetch failed');
  });

  // ── Escala 50k (22-ago-2026): la lista viene ACOTADA y el total CONTADO ───
  it('trae a lo más `limite` filas (las más recientes) y NO pagina la cola entera', async () => {
    const muchas = Array.from({ length: 500 }, (_, i) => ({
      id: `l${i}`, estatus: 'revisar', created_at: `2026-08-${String(1 + (i % 20)).padStart(2, '0')}T00:00:00Z`,
      tenant_id: 't1', tenant: { nombre: 'F' }, viaje: null,
    }));
    respuestas.set('liquidacion', { data: muchas, error: null });
    expect(await getLiquidacionesEnRevisar()).toHaveLength(LIMITE_LIQUIDACIONES_REVISAR);
    expect(await getLiquidacionesEnRevisar(5)).toHaveLength(5);
    expect(rangos.get('liquidacion')).toBeUndefined();
  });

  it('contarLiquidacionesEnRevisar cuenta por head (cero filas cruzan) y solo las `revisar`', async () => {
    respuestas.set('liquidacion', { data: LIQUIDACIONES, error: null });
    expect(await contarLiquidacionesEnRevisar()).toBe(2);
  });

  it('un conteo que no llega como número LANZA — NULL no es 0', async () => {
    respuestas.set('liquidacion', { data: [], error: null, count: null });
    await expect(contarLiquidacionesEnRevisar()).rejects.toThrow(/no devolvió el conteo/);
  });
});


describe('costoIaMesActual — el widget de uso del sidebar (16-ago-2026)', () => {
  beforeEach(() => { rpcs.clear(); llamadasRpc.length = 0; });

  it('pide el MES de México a la agregación SQL y redondea a centavos', async () => {
    rpcs.set('resumen_costo_ia', {
      data: { ...RESUMEN_VACIO, totales: { n: 12, costoUsd: 0.041234, tokensIn: 1, tokensOut: 2 } },
      error: null,
    });
    const r = await costoIaMesActual();
    expect(r.mesUsd).toBe(0.04);
    expect(r.llamadas).toBe(12);
    expect(r.etiquetaMes).toMatch(/agosto|julio|septiembre|enero|febrero|marzo|abril|mayo|junio|octubre|noviembre|diciembre/);
    const arg = llamadasRpc[0].args as { p_desde: string };
    expect(arg.p_desde).toMatch(/-01T06:00:00/); // medianoche MX = 06:00Z
  });

  it('con la base caída LANZA — el widget dice "no se pudo leer", jamás $0', async () => {
    rpcs.set('resumen_costo_ia', { data: null, error: { message: 'db down' } });
    await expect(costoIaMesActual()).rejects.toThrow();
  });
});

describe('costoIaDeTenant — la ficha 360', () => {
  beforeEach(() => { rpcs.clear(); llamadasRpc.length = 0; });

  it('toma la fila del tenant de porTenant; un tenant sin filas es $0 REAL (la agregación corrió)', async () => {
    rpcs.set('resumen_costo_ia', {
      data: { ...RESUMEN_VACIO, porTenant: [{ tenantId: 't-1', costoUsd: 0.123456 }] },
      error: null,
    });
    const r = await costoIaDeTenant('t-1');
    expect(r).toEqual({ historicoUsd: 0.12, d30Usd: 0.12 });
    const otro = await costoIaDeTenant('t-sin-uso');
    expect(otro).toEqual({ historicoUsd: 0, d30Usd: 0 });
  });
});
