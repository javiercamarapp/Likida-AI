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
    respuestas.set('liquidacion', { data: { id: 'liq-1', viaje_id: 'v1', estatus: 'cuadrada', total_comprobado: 9400, created_at: '2026-07-31T02:00:00Z' }, error: null });
    respuestas.set('gasto', { data: null, error: ERROR_RED });
    await expect(getLiquidacionDetalle('liq-1', TENANT)).rejects.toThrow(/fetch failed/);
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
    cuadrarDesdeDB.mockResolvedValue({ totalComprobado: 1240, totalDeducible: 1240, totalNoDeducible: 0, totalPorConfirmar: 0 });
    const d = await getLiquidacionDetalle('liq-1', TENANT);
    expect(d?.deducibilidad).toMatchObject({ totalDeducible: 1240, totalNoDeducible: 0, totalPorConfirmar: 0 });
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
