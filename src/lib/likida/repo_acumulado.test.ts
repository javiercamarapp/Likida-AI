import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA DE ESCALA 15-AGO-2026 (mig. 0112): EL CONTADOR DEL 15% PASÓ DE
// PAGINAR EN JS A UNA RPC QUE YA EXISTÍA, MUERTA, DESDE LA 0084.
//
// `getAcumuladoCombustible` corre EN CADA CUADRE (repo.ts documentaba el
// porqué: 100 páginas = 100,000 cargas, y al pasarlas el CIERRE dejaba de
// cerrar — no solo una pantalla). La versión anterior paginaba a mano contra
// `max_rows` de PostgREST; la migración 0084 (05-ago-2026) YA había escrito
// `sumar_combustible_ejercicio` para esto y estaba aplicada en producción,
// pero NADA en `src/` la llamaba — quedó muerta, y con un bug: no filtraba
// `monto > 0`. La 0112 corrige ese filtro (mismo `create or replace`, misma
// firma) y por fin conecta `getAcumuladoCombustible` a ella.
//
// Lo que este archivo prueba:
//   1. EQUIVALENCIA — la reducción JS VIEJA (`legacyAcumuladoJs`, una copia
//      congelada de la lógica que vivía en repo.ts antes de la 0112) contra
//      la función NUEVA (con la RPC mockeada por un reductor SQL escrito de
//      forma independiente, `sqlEquivalente`, que espeja la migración línea
//      por línea) — sobre el MISMO dataset sintético, con los casos raros
//      que antes solo se veían en producción: mezcla de formas de pago,
//      MONTOS NO POSITIVOS (el bug que tenía la RPC muerta), gastos sin
//      forma de pago, más de una clave del SAT, gastos de OTRO tenant o de
//      OTRO ejercicio.
//   2. Fail-closed: un error de la RPC, o una forma inesperada de la
//      respuesta, LANZAN — nunca una cifra a medias ni un 0 con etiqueta de
//      medido (es el denominador del 15% de combustible en efectivo, RFA
//      2026 regla 2.9).
//   3. El criterio de "combustible" que se manda a la RPC: sin `claves`
//      (vacío o `undefined`) solo cuenta `concepto = 'diesel'` — el MISMO
//      criterio angosto que el `.or()` original.
// ═══════════════════════════════════════════════════════════════════════════

type Fila = {
  tenant_id: string;
  ejercicio: number;
  monto: number;
  forma_pago: string | null;
  concepto: string;
  clave_prod_serv?: string | null;
};

/** n cargas: la mitad en efectivo ('01') a $1 000, la otra mitad con tarjeta a $2 000. */
function cargas(n: number, tenantId = 't1', ejercicio = 2026): Fila[] {
  return Array.from({ length: n }, (_, i) => (i % 2 === 0
    ? { tenant_id: tenantId, ejercicio, monto: 1_000, forma_pago: '01', concepto: 'diesel' }
    : { tenant_id: tenantId, ejercicio, monto: 2_000, forma_pago: '04', concepto: 'diesel' }));
}

/**
 * LA REDUCCIÓN JS VIEJA — copia congelada de `getAcumuladoCombustible` tal
 * como vivía en repo.ts ANTES de la 0112 (solo la aritmética; la paginación
 * contra `max_rows` ya no aplica porque el sum() corre en la base, no hay
 * "página" que perder). Es el oráculo contra el que se mide la RPC.
 */
function legacyAcumuladoJs(
  filas: Fila[],
  tenantId: string,
  ejercicio: number,
  claves?: string[],
): { efectivo: number; totalCombustible: number } {
  let efectivo = 0;
  let totalCombustible = 0;
  for (const g of filas) {
    if (g.tenant_id !== tenantId || g.ejercicio !== ejercicio) continue;
    const esCombustible = g.concepto === 'diesel'
      || (!!claves?.length && !!g.clave_prod_serv && claves.includes(g.clave_prod_serv));
    if (!esCombustible) continue;
    const monto = Number(g.monto);
    if (!Number.isFinite(monto) || monto <= 0) continue;
    totalCombustible += monto;
    if (g.forma_pago === '01') efectivo += monto;
  }
  return { efectivo: round2(efectivo), totalCombustible: round2(totalCombustible) };
}

function round2(n: number): number {
  return Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100;
}

/**
 * EL REDUCTOR SQL — escrito de forma INDEPENDIENTE a `legacyAcumuladoJs`,
 * espejando `sumar_combustible_ejercicio` (0084, corregida por la 0112)
 * línea por línea: mismo `where` (incluido el `monto > 0` que la RPC NO
 * tenía antes de la 0112), mismo `sum(monto) filter (where forma_pago =
 * '01')`. Simula lo que la RPC devolvería sobre el MISMO dataset — es lo que
 * el mock de `.rpc()` usa como respuesta, para que la prueba de equivalencia
 * compare dos IMPLEMENTACIONES DISTINTAS del mismo cálculo, no la misma
 * copiada dos veces. Devuelve `{ total, efectivo }` — los nombres de columna
 * REALES de `returns table (total numeric, efectivo numeric)`.
 */
function sqlEquivalente(
  filas: Fila[],
  tenantId: string,
  ejercicio: number,
  claves: string[] | null,
): { total: number; efectivo: number } {
  const candidatas = filas.filter((g) =>
    g.tenant_id === tenantId
    && g.ejercicio === ejercicio
    && g.monto > 0
    && (g.concepto === 'diesel' || (claves !== null && claves.length > 0 && claves.includes(g.clave_prod_serv ?? ''))));
  const total = candidatas.reduce((s, g) => s + g.monto, 0);
  const efectivo = candidatas.filter((g) => g.forma_pago === '01').reduce((s, g) => s + g.monto, 0);
  return { total, efectivo };
}

const servidor: { filas: Fila[] } = { filas: [] };
const llamadasRpc: Array<{ fn: string; args: Record<string, unknown> }> = [];
/** La RPC se puede forzar a devolver un error o una forma rota, por prueba. */
let forzarError: { message: string } | null = null;
let forzarFormaRota: unknown = undefined;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      llamadasRpc.push({ fn, args });
      if (forzarError) return Promise.resolve({ data: null, error: forzarError });
      if (forzarFormaRota !== undefined) return Promise.resolve({ data: forzarFormaRota, error: null });
      // `returns table` → PostgREST siempre entrega un ARRAY, una fila aquí.
      const fila = sqlEquivalente(
        servidor.filas,
        args.p_tenant as string,
        args.p_anio as number,
        (args.p_claves as string[] | null) ?? null,
      );
      return Promise.resolve({ data: [fila], error: null });
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { getAcumuladoCombustible } = await import('./repo');

beforeEach(() => {
  servidor.filas = [];
  llamadasRpc.length = 0;
  forzarError = null;
  forzarFormaRota = undefined;
});

describe('getAcumuladoCombustible — equivalencia JS viejo vs RPC corregida (mig. 0112)', () => {
  it('2 500 cargas de un tenant: la reducción JS vieja y la RPC dan EL MISMO centavo', async () => {
    servidor.filas = cargas(2_500);
    const legacy = legacyAcumuladoJs(servidor.filas, 't1', 2026);
    const nuevo = await getAcumuladoCombustible('t1', 2026);
    expect(nuevo).toEqual(legacy);
    expect(nuevo).toEqual({ efectivo: 1_250_000, totalCombustible: 3_750_000 });
  });

  it('mezcla de formas de pago, MONTOS NO POSITIVOS y gastos sin forma de pago — el bug que tenía la RPC muerta', async () => {
    servidor.filas = [
      { tenant_id: 't1', ejercicio: 2026, monto: 1_500, forma_pago: '01', concepto: 'diesel' },
      { tenant_id: 't1', ejercicio: 2026, monto: 2_300.55, forma_pago: '04', concepto: 'diesel' },
      { tenant_id: 't1', ejercicio: 2026, monto: 900, forma_pago: null, concepto: 'diesel' },    // sin forma de pago: NO cuenta como efectivo
      { tenant_id: 't1', ejercicio: 2026, monto: 0, forma_pago: '01', concepto: 'diesel' },        // monto 0: fuera
      { tenant_id: 't1', ejercicio: 2026, monto: -400, forma_pago: '01', concepto: 'diesel' },     // negativo: fuera — ESTE es el que la 0084 sin corregir habría sumado
    ];
    const legacy = legacyAcumuladoJs(servidor.filas, 't1', 2026);
    const nuevo = await getAcumuladoCombustible('t1', 2026);
    expect(nuevo).toEqual(legacy);
    // 1,500 (01) + 900 (sin forma, NO cuenta) → efectivo solo el 01
    expect(nuevo.efectivo).toBe(1_500);
    expect(nuevo.totalCombustible).toBe(round2(1_500 + 2_300.55 + 900));
  });

  it('con `claves` del SAT: cuenta concepto=diesel O clave_prod_serv en la lista — mismo criterio que el motor', async () => {
    servidor.filas = [
      { tenant_id: 't1', ejercicio: 2026, monto: 1_000, forma_pago: '01', concepto: 'diesel' },
      { tenant_id: 't1', ejercicio: 2026, monto: 2_000, forma_pago: '01', concepto: 'combustible_generico', clave_prod_serv: '15101514' },
      { tenant_id: 't1', ejercicio: 2026, monto: 3_000, forma_pago: '01', concepto: 'combustible_generico', clave_prod_serv: '99999999' }, // clave NO en la lista: fuera
    ];
    const claves = ['15101505', '15101514', '15101515'];
    const legacy = legacyAcumuladoJs(servidor.filas, 't1', 2026, claves);
    const nuevo = await getAcumuladoCombustible('t1', 2026, claves);
    expect(nuevo).toEqual(legacy);
    expect(nuevo).toEqual({ efectivo: 3_000, totalCombustible: 3_000 });
  });

  it('sin `claves` (vacío o undefined): SOLO cuenta concepto=diesel, no cae al criterio ancho', async () => {
    servidor.filas = [
      { tenant_id: 't1', ejercicio: 2026, monto: 1_000, forma_pago: '01', concepto: 'diesel' },
      { tenant_id: 't1', ejercicio: 2026, monto: 5_000, forma_pago: '01', concepto: 'combustible_generico', clave_prod_serv: '15101505' },
    ];
    const sinArg = await getAcumuladoCombustible('t1', 2026);
    const conVacio = await getAcumuladoCombustible('t1', 2026, []);
    expect(sinArg).toEqual({ efectivo: 1_000, totalCombustible: 1_000 });
    expect(conVacio).toEqual(sinArg);
    // Las dos llamadas mandan `p_claves: null` — el mismo criterio angosto
    // (la firma de la 0084 no tiene default: hay que mandar `null` explícito).
    expect(llamadasRpc.every((l) => l.args.p_claves === null)).toBe(true);
  });

  it('gastos de OTRO tenant o de OTRO ejercicio no contaminan la suma', async () => {
    servidor.filas = [
      ...cargas(4, 't1', 2026),
      ...cargas(10, 't2', 2026),      // otro tenant: fuera
      ...cargas(10, 't1', 2025),      // otro ejercicio: fuera
    ];
    const legacy = legacyAcumuladoJs(servidor.filas, 't1', 2026);
    const nuevo = await getAcumuladoCombustible('t1', 2026);
    expect(nuevo).toEqual(legacy);
    expect(nuevo).toEqual({ efectivo: 2_000, totalCombustible: 6_000 }); // 2 en efectivo + 2 con tarjeta de las 4 de t1/2026
  });

  it('un tenant sin cargas de diésel devuelve ceros, y eso SÍ es una medición', async () => {
    const r = await getAcumuladoCombustible('t1', 2026);
    expect(r).toEqual({ efectivo: 0, totalCombustible: 0 });
  });
});

describe('getAcumuladoCombustible — fail-closed (mig. 0112)', () => {
  it('un error de la RPC (base caída, etc.) LANZA — no una cifra a medias', async () => {
    forzarError = { message: 'TypeError: fetch failed (ENOTFOUND db.supabase.co)' };
    await expect(getAcumuladoCombustible('t1', 2026)).rejects.toThrow(/fetch failed/);
  });

  it('una forma inesperada (¿migración 0112 sin aplicar?) LANZA, no pinta un 0 medido', async () => {
    forzarFormaRota = [{ efectivo: 'no-es-un-numero', total: null }];
    await expect(getAcumuladoCombustible('t1', 2026)).rejects.toThrow(/0112/);
  });

  it('data null (no es el array que promete `returns table`) LANZA', async () => {
    forzarFormaRota = null;
    await expect(getAcumuladoCombustible('t1', 2026)).rejects.toThrow(/0112/);
  });

  it('un array vacío (cero filas, imposible con `coalesce` pero se prueba igual) LANZA', async () => {
    forzarFormaRota = [];
    await expect(getAcumuladoCombustible('t1', 2026)).rejects.toThrow(/0112/);
  });
});

describe('getAcumuladoCombustible — el tenant viaja como argumento de la RPC', () => {
  it('manda p_tenant, p_anio y p_claves a sumar_combustible_ejercicio', async () => {
    servidor.filas = cargas(3);
    await getAcumuladoCombustible('t1', 2026, ['15101505']);
    const llamada = llamadasRpc.find((l) => l.fn === 'sumar_combustible_ejercicio')!;
    expect(llamada.args).toEqual({ p_tenant: 't1', p_anio: 2026, p_claves: ['15101505'] });
  });
});
