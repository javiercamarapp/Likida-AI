import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// UN FALLO DE SUPABASE SE PINTABA COMO "AÚN NO HAY LIQUIDACIONES".
//
// supabase-js NO lanza cuando la base falla: reporta el error POR VALOR
// (`{ data: null, error }`), y `shouldThrowOnError` es false por defecto. Como
// `analytics.ts` desestructuraba solo `data` y tiraba el `error` al piso, un
// host inalcanzable, un 500 de PostgREST, una llave rotada o un `grant` que le
// cierre `liquidacion` al service-role producían exactamente lo mismo que un
// tenant vacío: ceros y arreglos vacíos.
//
// Con eso, el `try/catch` de `safe()` en el panel (dashboard/page.tsx) nunca se
// disparaba, `errorCarga` era false y la pantalla que se servía decía "Aún no
// hay liquidaciones". El comprador ve un producto que dice no haber procesado
// nunca nada, y el presentador no puede distinguir "el tenant está vacío" de
// "la base está caída" (auditoría 5, frontend, CRÍTICO).
//
// Lo que se prueba aquí es la TRADUCCIÓN: que un error por valor se convierta
// en una excepción, que es lo único que el panel sabe leer.
// ═══════════════════════════════════════════════════════════════════════════

type Resp = { data: unknown; error: { message: string } | null };

const respuestas = new Map<string, Resp>();
const ERROR_RED = { message: 'TypeError: fetch failed (ENOTFOUND db.supabase.co)' };

/** Imita el query builder de postgrest-js: encadenable y "thenable". */
function crearBuilder(tabla: string) {
  const resp = (): Resp => respuestas.get(tabla) ?? { data: [], error: null };
  const b: Record<string, unknown> = {};
  const self = () => b;
  for (const m of ['select', 'eq', 'order', 'limit', 'in', 'gte', 'lte', 'is', 'not']) b[m] = self;
  b.maybeSingle = () => Promise.resolve(resp());
  b.single = () => Promise.resolve(resp());
  b.then = (ok: (v: Resp) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(resp()).then(ok, fail);
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (t: string) => crearBuilder(t) }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const cuadrarDesdeDB = vi.fn();
vi.mock('./cuadre/desde_db', () => ({ cuadrarDesdeDB: (...a: unknown[]) => cuadrarDesdeDB(...a) }));

const { getKpis, getAcreditables, detectarAnomalias, getLiquidacionDetalle } = await import('./analytics');

const TENANT = 't1';

beforeEach(() => {
  respuestas.clear();
  cuadrarDesdeDB.mockReset();
  cuadrarDesdeDB.mockRejectedValue(new Error('viaje no encontrado'));
});

describe('la base caída LANZA, no devuelve ceros', () => {
  it('getKpis lanza en vez de devolver 0 viajes liquidados', async () => {
    respuestas.set('liquidacion', { data: null, error: ERROR_RED });
    await expect(getKpis(TENANT)).rejects.toThrow(/fetch failed/);
  });

  it('getAcreditables lanza en vez de devolver 0 litros', async () => {
    respuestas.set('liquidacion', { data: null, error: ERROR_RED });
    await expect(getAcreditables(TENANT)).rejects.toThrow(/fetch failed/);
  });

  it('detectarAnomalias lanza en vez de devolver "ninguna anomalía"', async () => {
    // Esta es la peor de las tres: "0 anomalías" por fallo de lectura se lee
    // como "revisamos y todo está limpio".
    respuestas.set('gasto', { data: null, error: ERROR_RED });
    await expect(detectarAnomalias(TENANT)).rejects.toThrow(/fetch failed/);
  });

  it('getLiquidacionDetalle lanza en vez de responder notFound()', async () => {
    // El detalle devolvía null ante error y la página respondía notFound():
    // "Esta página no existe" sobre una liquidación que SÍ existe.
    respuestas.set('liquidacion', { data: null, error: ERROR_RED });
    await expect(getLiquidacionDetalle('liq-1', TENANT)).rejects.toThrow(/fetch failed/);
  });

  it('un fallo al leer los comprobantes NO deja una tabla vacía bajo un total lleno', async () => {
    // Con la reconstrucción caída (el default del beforeEach), los renglones
    // salen de `gasto`; si ESA lectura también falla, hay que lanzar.
    respuestas.set('liquidacion', { data: { id: 'liq-1', viaje_id: 'v1', estatus: 'cuadrada', total_comprobado: 9400, created_at: '2026-07-31T02:00:00Z' }, error: null });
    respuestas.set('gasto', { data: null, error: ERROR_RED });
    await expect(getLiquidacionDetalle('liq-1', TENANT)).rejects.toThrow(/fetch failed/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LA TABLA DE COMPROBANTES TIENE QUE SUMAR EL TOTAL QUE TIENE ARRIBA.
//
// `totalComprobado` excluye duplicados y montos ≤ 0, pero el duplicado se
// PERSISTE: el único unique de la base es por `cfdi_uuid` y por `img_hash`, así
// que dos fotos distintas del mismo ticket de caseta producen dos filas. El
// panel leía `gasto` directo y pintaba las cuatro (auditoría 5, frontend,
// MEDIO 4):
//
//   tarjeta de arriba : Comprobado $9,400.00
//   tabla de abajo    : 4 renglones que suman $10,800.00
//
// El contralor suma la columna con el dedo y le sobran $1,400 — en un producto
// cuyo argumento de venta es "detectamos comprobantes duplicados".
// ═══════════════════════════════════════════════════════════════════════════
describe('los renglones del panel son los mismos que los del PDF', () => {
  const CASETA_DUP = { id: 'g4', concepto: 'caseta', monto: 1400, folio: 'CA-4471' };
  const LIQ_RECONSTRUIDA = {
    totalComprobado: 9400, totalDeducible: 9400, totalNoDeducible: 0, totalPorConfirmar: 0,
    gastos: [
      { id: 'g1', concepto: 'diesel', monto: 4200, folio: 'D-1' },
      { id: 'g2', concepto: 'diesel', monto: 3800, folio: 'D-2' },
      { id: 'g3', concepto: 'caseta', monto: 1400, folio: 'CA-4471' },
      CASETA_DUP,
    ],
    diferencias: [{ tipo: 'duplicado', gastoId: 'g4', nota: 'Comprobante duplicado', monto: 1400 }],
  };

  beforeEach(() => {
    respuestas.set('liquidacion', {
      data: { id: 'liq-1', viaje_id: 'v1', estatus: 'con_diferencias', total_comprobado: 9400, total_anticipo: 10000, diferencia: 600, created_at: '2026-07-31T02:00:00Z' },
      error: null,
    });
    // Si el panel volviera a leer `gasto` directo, pintaría las CUATRO filas.
    respuestas.set('gasto', {
      data: LIQ_RECONSTRUIDA.gastos.map((g) => ({ ...g, ocr_extra: null })),
      error: null,
    });
    cuadrarDesdeDB.mockResolvedValue(LIQ_RECONSTRUIDA);
  });

  it('la suma de los renglones es EXACTAMENTE el total comprobado', async () => {
    const d = await getLiquidacionDetalle('liq-1', TENANT);
    const suma = d!.gastos.reduce((s, g) => s + g.monto, 0);
    expect(suma).toBe(d!.totalComprobado);
    expect(suma).toBe(9400);          // y no 10,800
  });

  it('el orden es estable entre recargas, venga como venga de Postgres', async () => {
    // `getGastos` (repo.ts) no lleva `.order()`: Postgres puede devolver los
    // comprobantes en distinto orden en cada lectura y la tabla se barajaba
    // (auditoría 5, frontend, BAJO 2). El orden se fija al presentarlos.
    const desordenado = {
      ...LIQ_RECONSTRUIDA,
      gastos: [
        { id: 'g3', concepto: 'caseta', monto: 1400, folio: 'CA-4471', fecha: '2026-07-03' },
        { id: 'g1', concepto: 'diesel', monto: 4200, folio: 'D-1', fecha: '2026-07-01' },
        { id: 'g2', concepto: 'diesel', monto: 3800, folio: 'D-2', fecha: '2026-07-02' },
        { ...CASETA_DUP, fecha: '2026-07-03' },
      ],
    };
    cuadrarDesdeDB.mockResolvedValue(desordenado);
    const primera = await getLiquidacionDetalle('liq-1', TENANT);
    // Segunda lectura, con las filas devueltas al revés: la tabla no se mueve.
    cuadrarDesdeDB.mockResolvedValue({ ...desordenado, gastos: [...desordenado.gastos].reverse() });
    const segunda = await getLiquidacionDetalle('liq-1', TENANT);
    expect(primera!.gastos.map((g) => g.folio)).toEqual(['D-1', 'D-2', 'CA-4471']);
    expect(segunda!.gastos.map((g) => g.folio)).toEqual(primera!.gastos.map((g) => g.folio));
  });

  it('el duplicado no se pinta como un comprobante normal, y se dice cuántos faltan', async () => {
    const d = await getLiquidacionDetalle('liq-1', TENANT);
    expect(d!.gastos).toHaveLength(3);
    expect(d!.comprobantesExcluidos).toBe(1);
    expect(d!.comprobantesCuadran).toBe(true);
  });

  it('los montos ≤ 0 tampoco entran: el motor no los cuenta y el papel tampoco', async () => {
    respuestas.set('liquidacion', {
      data: { id: 'liq-1', viaje_id: 'v1', estatus: 'cuadrada', total_comprobado: 4200, total_anticipo: 4200, diferencia: 0, created_at: '2026-07-31T02:00:00Z' },
      error: null,
    });
    cuadrarDesdeDB.mockResolvedValue({
      ...LIQ_RECONSTRUIDA,
      totalComprobado: 4200,
      gastos: [{ id: 'g1', concepto: 'diesel', monto: 4200 }, { id: 'g9', concepto: 'otro', monto: 0 }],
      diferencias: [],
    });
    const d = await getLiquidacionDetalle('liq-1', TENANT);
    expect(d!.gastos.map((g) => g.monto)).toEqual([4200]);
    expect(d!.comprobantesExcluidos).toBe(1);
  });

  it('si la reconstrucción NO cuadra con lo persistido, se descarta entera', async () => {
    // Medido contra el tenant del demo: `VJ-2026-0845` tiene $12,100 guardados
    // y CERO filas en `gasto`. La reconstrucción devuelve 0, y sin este portón
    // el pie de la tabla afirmaba "Total comprobado $12,100.00" debajo de
    // ninguna fila — la misma contradicción, entrando por la otra puerta.
    cuadrarDesdeDB.mockResolvedValue({
      totalComprobado: 0, totalDeducible: 0, totalNoDeducible: 0, totalPorConfirmar: 0,
      gastos: [], diferencias: [],
    });
    const d = await getLiquidacionDetalle('liq-1', TENANT);
    expect(d!.totalComprobado).toBe(9400);
    expect(d!.comprobantesCuadran).toBe(false);   // no se pinta el pie
    expect(d!.deducibilidad).toBeNull();          // ni el desglose
  });

  it('un centavo de diferencia por redondeo NO tira la reconstrucción', async () => {
    cuadrarDesdeDB.mockResolvedValue({ ...LIQ_RECONSTRUIDA, totalComprobado: 9400.01 });
    const d = await getLiquidacionDetalle('liq-1', TENANT);
    expect(d!.comprobantesCuadran).toBe(true);
  });

  it('sin reconstrucción se sirven los crudos, PERO marcados como que pueden no sumar', async () => {
    // El respaldo no puede mentir: si la tabla puede no cuadrar, la pantalla lo
    // dice en vez de dejar que el contralor lo descubra con el dedo.
    cuadrarDesdeDB.mockRejectedValue(new Error('viaje no encontrado'));
    const d = await getLiquidacionDetalle('liq-1', TENANT);
    expect(d!.gastos).toHaveLength(4);
    expect(d!.comprobantesCuadran).toBe(false);
    expect(d!.comprobantesExcluidos).toBe(0);
  });
});

describe('el cero real sigue siendo cero — no todo error', () => {
  it('un tenant vacío devuelve ceros sin lanzar', async () => {
    respuestas.set('liquidacion', { data: [], error: null });
    await expect(getKpis(TENANT)).resolves.toMatchObject({ viajesLiquidados: 0, montoComprobado: 0 });
    await expect(getAcreditables(TENANT)).resolves.toMatchObject({ litrosDiesel: 0, iva: 0, peaje: 0 });
  });

  it('una liquidación que NO existe devuelve null (eso sí es notFound)', async () => {
    respuestas.set('liquidacion', { data: null, error: null });
    await expect(getLiquidacionDetalle('no-existe', TENANT)).resolves.toBeNull();
  });
});

describe('el detalle lleva lo que el panel necesita para no contradecir al PDF', () => {
  beforeEach(() => {
    respuestas.set('liquidacion', {
      data: { id: 'liq-1', viaje_id: 'v1', estatus: 'cuadrada', total_comprobado: 1240, total_anticipo: 1240, diferencia: 0, created_at: '2026-07-31T02:00:00Z' },
      error: null,
    });
    respuestas.set('gasto', {
      data: [{ concepto: 'diesel', monto: 1240, folio: 'A-1', ocr_extra: { producto: 'MAGNA' } }],
      error: null,
    });
  });

  it('trae `ocrExtra` de cada gasto: sin eso el panel no puede decir "Combustible Magna"', async () => {
    // El PDF imprime `etiquetaConcepto(concepto, ocrExtra)` → "Combustible
    // Magna"; el panel imprimía "Diésel" del mismo comprobante porque el select
    // pedía `concepto, monto, folio` y nada más (auditoría 5, arquitectura, ALTO 1).
    const d = await getLiquidacionDetalle('liq-1', TENANT);
    expect(d?.gastos[0].ocrExtra).toMatchObject({ producto: 'MAGNA' });
  });

  it('trae las tres cubetas de deducibilidad reconstruidas con el motor', async () => {
    // El panel no podía decir cuánto de lo comprobado sobrevive una revisión
    // del SAT: las columnas no existen en la base. Se reconstruye con el mismo
    // motor que alimenta al PDF (auditoría 5, frontend, ALTO 2).
    cuadrarDesdeDB.mockResolvedValue({
      totalComprobado: 1240, totalDeducible: 1240, totalNoDeducible: 0, totalPorConfirmar: 0,
      gastos: [{ id: 'g1', concepto: 'diesel', monto: 1240, folio: 'A-1', ocrExtra: { producto: 'MAGNA' } }],
      diferencias: [],
    });
    const d = await getLiquidacionDetalle('liq-1', TENANT);
    expect(d?.deducibilidad).toMatchObject({ totalDeducible: 1240, totalNoDeducible: 0, totalPorConfirmar: 0 });
  });

  it('la fecha NO se recorta a UTC: viaja cruda y se formatea al pintarla', async () => {
    // `.slice(0, 10)` daba "2026-08-01" para una liquidación cerrada el 31 de
    // julio a las 20:00 hora de México (auditoría 5, frontend, MEDIO 3).
    const d = await getLiquidacionDetalle('liq-1', TENANT);
    expect(d?.creadoEn).toBe('2026-07-31T02:00:00Z');
  });

  it('si la reconstrucción falla, el detalle se sirve igual sin el desglose', async () => {
    // La deducibilidad es un extra: que no se pueda reconstruir no puede tirar
    // la pantalla que el contralor sí puede leer.
    cuadrarDesdeDB.mockRejectedValue(new Error('viaje no encontrado'));
    const d = await getLiquidacionDetalle('liq-1', TENANT);
    expect(d?.deducibilidad).toBeNull();
    expect(d?.totalComprobado).toBe(1240);
  });
});
