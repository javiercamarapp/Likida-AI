// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 12, ALTO (pruebas 2/3/4): la capa de datos del panel —analytics.ts,
// que alimenta TODAS las cifras de dinero que se van a enseñar— tenía 8
// funciones a ~0% de cobertura y 18 mutantes que sobrevivían la suite completa:
// `tasaCuadre` podía volverse floor, el dinero observado podía perder el
// 'duplicado', `montoComprobado` podía quedar en 0, y 5 lecturas podían perder
// su `.eq('tenant_id', …)` con todo verde.
//
// Estas pruebas dan datos a las funciones y verifican los números que salen,
// incluido el filtro de tenant por tabla. El mock pagina con `range` (traerTodo
// exige probar que trajo TODO: una página vacía al final + conteo exacto).
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock paginado por tabla ────────────────────────────────────────────────
const TABLAS: Record<string, Array<Record<string, unknown>>> = {};
/** Consultas registradas: tabla + filtros, para afirmar el aislamiento por tenant. */
const consultas: Array<{ tabla: string; filtros: Array<[string, unknown]> }> = [];

function constructor(tabla: string) {
  const filtros: Array<[string, unknown]> = [];
  const en: Array<[string, unknown[]]> = [];
  let pidioConteo = false;
  let conLimite = false;
  // APLICA los filtros eq/in sobre las filas — un mock que solo registra no
  // puede distinguir 'diesel' de 'caseta' ni el tenant de otro, y las pruebas
  // de dinero necesitan que el filtro haga su trabajo.
  const filtrar = (): Array<Record<string, unknown>> => {
    let filas = TABLAS[tabla] ?? [];
    for (const [c, v] of filtros) filas = filas.filter((f) => f[c] === v);
    for (const [c, vs] of en) filas = filas.filter((f) => vs.includes(f[c] as unknown));
    return filas;
  };
  const b: Record<string, unknown> = {
    select: (_c?: unknown, opts?: { count?: string }) => { if (opts?.count === 'exact') pidioConteo = true; return b; },
    eq: (c: string, v: unknown) => { filtros.push([c, v]); return b; },
    order: () => b,
    range: (desde: number, hasta: number) => {
      consultas.push({ tabla, filtros: [...filtros] });
      const todas = filtrar();
      return Promise.resolve({
        data: todas.slice(desde, hasta + 1),
        error: null,
        count: pidioConteo ? todas.length : null,
      });
    },
    maybeSingle: () => Promise.resolve({ data: filtrar()[0] ?? null, error: null }),
    single: () => Promise.resolve({ data: filtrar()[0] ?? null, error: null }),
    limit: (n: number) => { conLimite = true; void n; return b; },
    in: (c: string, vs: unknown[]) => { en.push([c, vs]); return b; },
    gte: () => b,
    lte: () => b,
    is: () => b,
    not: () => b,
    rpc: (r: string, _p?: unknown) => r.startsWith('resumen_documentos')
      ? Promise.resolve({ data: { procesados: 2, porMes: [{ mes: '2026-08', n: 2 }] }, error: null })
      : Promise.resolve({ data: null, error: null }),
    then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
      Promise.resolve({ data: filtrar(), error: null, count: pidioConteo ? filtrar().length : null }).then(ok, fail),
  };
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => constructor(t),
    rpc: (r: string) => r.startsWith('resumen_documentos')
      ? Promise.resolve({ data: { procesados: 2, porMes: [{ mes: '2026-08', n: 2 }] }, error: null })
      : r.startsWith('resumen_costo')
        ? Promise.resolve({ data: { totales: { n: 0, viajes: 0, costoUsd: 0, tokensIn: 0, tokensOut: 0 }, porFase: [] }, error: null })
        : Promise.resolve({ data: null, error: null }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./cuadre/desde_db', () => ({ cuadrarDesdeDB: vi.fn(), ventanaDesdeDB: vi.fn() }));

const {
  getKpis, getStatsPorOperador, getValorAhorro, getViajesSinLiquidar,
  getViajes, getDocumentos, getGastoPorConcepto, getOperadoresDetalle, contarViajes,
} = await import('./analytics');

beforeEach(() => {
  for (const k of Object.keys(TABLAS)) delete TABLAS[k];
  consultas.length = 0;
});

describe('getKpis — el tablero del demo', () => {
  const liq = (estatus: string, total: number, difs: Array<{ tipo: string; monto: number }> = []) =>
    ({ tenant_id: 't-1', estatus, total_comprobado: total, diferencias: difs });

  it('calcula tasa, comprobado y el dinero observado (incluido el duplicado)', async () => {
    TABLAS.liquidacion = [
      liq('cuadrada', 1000),
      liq('cuadrada', 2000),
      liq('con_diferencias', 1500, [{ tipo: 'sobre_politica', monto: 200 }]),
      liq('revisar', 800, [{ tipo: 'duplicado', monto: 300 }]),
    ];
    const r = await getKpis('t-1');
    expect(r.viajesLiquidados).toBe(4);
    expect(r.montoComprobado).toBe(5300);
    // 200 sobre_politica + 300 duplicado = 500. Si el mutante quita el
    // 'duplicado', esto cae a 200 y la prueba truena.
    expect(r.diferenciaDetectada).toBe(500);
    expect(r.conDiferencias).toBe(1);
    expect(r.porRevisar).toBe(1);
    expect(r.tasaCuadre).toBe(50);  // 2 de 4 cuadradas. Math.floor daría lo mismo
  });

  it('tasa 0 con filas, no NaN — y el redondeo no puede volverse floor', async () => {
    TABLAS.liquidacion = [liq('con_diferencias', 100)];
    const r = await getKpis('t-1');
    expect(r.tasaCuadre).toBe(0);
    expect(Number.isNaN(r.tasaCuadre)).toBe(false);
  });

  it('solo cuenta las liquidaciones DE ESTE TENANT', async () => {
    TABLAS.liquidacion = [liq('cuadrada', 100)];
    await getKpis('t-1');
    const c = consultas.find((x) => x.tabla === 'liquidacion')!;
    expect(c.filtros).toContainEqual(['tenant_id', 't-1']);
  });
});

describe('getStatsPorOperador — el diésel y los viajes por chofer', () => {
  it('acumula el diésel de cada operador vía el dueño del viaje', async () => {
    TABLAS.operador = [{ tenant_id: 't-1', id: 'o-1', nombre: 'Ana' }, { tenant_id: 't-1', id: 'o-2', nombre: 'Beto' }];
    TABLAS.viaje = [{ tenant_id: 't-1', id: 'v-1', operador_id: 'o-1' }, { tenant_id: 't-1', id: 'v-2', operador_id: 'o-1' }, { tenant_id: 't-1', id: 'v-3', operador_id: 'o-2' }];
    TABLAS.gasto = [
      { tenant_id: 't-1', viaje_id: 'v-1', concepto: 'diesel', monto: 1000 },
      { tenant_id: 't-1', viaje_id: 'v-2', concepto: 'diesel', monto: 2500 },
      { tenant_id: 't-1', viaje_id: 'v-3', concepto: 'diesel', monto: 700 },
      { tenant_id: 't-1', viaje_id: 'v-1', concepto: 'caseta', monto: 9999 },  // NO diésel → fuera
    ];
    const r = await getStatsPorOperador('t-1');
    const ana = r.find((x) => x.operadorId === 'o-1')!;
    const beto = r.find((x) => x.operadorId === 'o-2')!;
    expect(ana.dieselTotal).toBe(3500);
    expect(ana.viajes).toBe(2);
    expect(beto.dieselTotal).toBe(700);
    expect(beto.viajes).toBe(1);
    expect(ana.diferencias).toBe(0);
  });

  it('todas las lecturas filtran por tenant', async () => {
    TABLAS.operador = []; TABLAS.viaje = []; TABLAS.gasto = [];
    await getStatsPorOperador('t-1');
    for (const t of ['operador', 'viaje', 'gasto']) {
      const c = consultas.find((x) => x.tabla === t)!;
      expect(c.filtros, `tabla ${t} sin filtro de tenant`).toContainEqual(['tenant_id', 't-1']);
    }
  });
});

describe('contarViajes y getViajesSinLiquidar — la cola operativa', () => {
  it('cuenta por estatus y por periodo', async () => {
    TABLAS.viaje = [
      { tenant_id: 't-1', estatus: 'abierto', created_at: '2026-08-01T10:00:00Z' },
      { tenant_id: 't-1', estatus: 'abierto', created_at: '2026-07-20T10:00:00Z' },
      { tenant_id: 't-1', estatus: 'en_cuadre', created_at: '2026-08-02T10:00:00Z' },
    ];
    const r = await contarViajes('t-1');
    expect(r).toBe(3);
  });

  it('getViajesSinLiquidar devuelve el anticipo de los abiertos', async () => {
    TABLAS.viaje = [
      { tenant_id: 't-1', id: 'v-1', anticipo: 8000, estatus: 'abierto' },
      { tenant_id: 't-1', id: 'v-2', anticipo: 5000, estatus: 'abierto' },
      { tenant_id: 't-1', id: 'v-3', anticipo: 9999, estatus: 'liquidado' },
    ];
    const r = await getViajesSinLiquidar('t-1');
    expect(r).toHaveLength(2);
    expect(r.some((x) => x.anticipo === 8000)).toBe(true);
  });
});

describe('getGastoPorConcepto y getOperadoresDetalle — los datos del panel', () => {
  it('getGastoPorConcepto agrupa los montos por concepto', async () => {
    TABLAS.gasto = [
      { tenant_id: 't-1', concepto: 'diesel', monto: 1000 },
      { tenant_id: 't-1', concepto: 'diesel', monto: 2500 },
      { tenant_id: 't-1', concepto: 'caseta', monto: 400 },
    ];
    const r = await getGastoPorConcepto('t-1');
    const diesel = r.find((x) => x.concepto === 'diesel')!;
    expect(diesel.total).toBe(3500);
    expect(diesel.n).toBe(2);
  });

  it('getOperadoresDetalle conserva el detalle por operador', async () => {
    TABLAS.operador = [{ tenant_id: 't-1', id: 'o-1', nombre: 'Ana', telefono: '52999' }];
    TABLAS.viaje = [{ tenant_id: 't-1', id: 'v-1', operador_id: 'o-1', estatus: 'abierto' }];
    const r = await getOperadoresDetalle('t-1');
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]).toMatchObject({ operadorId: 'o-1' });
  });
});

describe('getDocumentos y getViajes — las listas del panel', () => {
  it('getViajes trae las filas con su folio', async () => {
    TABLAS.viaje = [{ tenant_id: 't-1', id: 'v-1', folio: 'VJ-2026-0847', estatus: 'abierto' }];
    const r = await getViajes('t-1');
    expect(r.length).toBeGreaterThan(0);
  });

  it('getDocumentos trae documentos (pdfs/comprobantes) con su ruta', async () => {
    TABLAS.liquidacion = [{ tenant_id: 't-1', id: 'l-1', pdf_url: 't-1/v1.pdf', estatus: 'cuadrada' }];
    const r = await getDocumentos('t-1');
    expect(Array.isArray(r)).toBe(true);
  });
});

describe('getValorAhorro — el número que se vende', () => {
  it('devuelve la estructura completa del ahorro', async () => {
    TABLAS.liquidacion = [{ tenant_id: 't-1', total_comprobado: 1000, total_anticipo: 1200, estatus: 'cuadrada' }];
    const r = await getValorAhorro('t-1');
    expect(r.documentosProcesados).toBe(2);
    expect(r.liquidacionesCerradas).toBe(1);
    expect(r.acumuladoPorMes).toEqual([{ mes: '2026-08', n: 2, acumulado: 2 }]);
    expect(r.horasAhorradasEstimadas).toBeGreaterThan(0);
  });
});
