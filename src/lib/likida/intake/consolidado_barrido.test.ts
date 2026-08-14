import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL BARRIDO — `barrerPorConciliar` contra Supabase mockeado (auditoría 4, B1).
//
// El hueco que motiva la función: una línea `por_conciliar` solo se resolvía
// si un humano la ligaba a mano, contra una lista de candidatos congelada el
// día del XML — el gasto que llegó DESPUÉS ni aparecía. Lo que estas pruebas
// fijan, en orden de importancia:
//
//   1. El gasto nuevo amarra la línea con el MISMO sello y el MISMO guardia
//      de los otros dos caminos, y la línea se cierra anclada a tenant Y a
//      `estatus = 'por_conciliar'`.
//   2. Cuando el guardia niega el gasto, la línea SE QUEDA pendiente — nunca
//      se marca conciliada una línea cuyo gasto se llevó otro.
//   3. La columna `candidatos` se refresca cuando el fondo de hoy cambió — es
//      lo que `resolverLineaAMano` le ofrece al contador — y NO se reescribe
//      por un puro reordenamiento del SELECT.
//   4. Un error de lectura LANZA: "no hay nada que barrer" y "no pude leer la
//      cola" llevan a acuses opuestos.
// ═══════════════════════════════════════════════════════════════════════════

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

type Resp = { data: unknown; error: { message: string } | null };

let respLineas: Resp;
let respXml: Resp;
let respGastos: Resp;
let respGastoUpdate: Resp;
let respLineaUpdate: Resp;

/** Cada UPDATE a `gasto` (el sello de `ligarLineaAGasto`): payload y filtros. */
let sellos: Array<{ fila: Record<string, unknown>; por: Array<[string, unknown]> }>;
/** Cada UPDATE a `cfdi_consolidado_linea` (marcar o refrescar): payload y filtros. */
let escriturasLinea: Array<{ fila: Record<string, unknown>; por: Array<[string, unknown]> }>;

function lecturable(resp: () => Resp) {
  const nodo: Record<string, unknown> = {};
  for (const m of ['eq', 'is', 'in', 'gte', 'lte', 'limit']) nodo[m] = () => nodo;
  nodo.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
    Promise.resolve(resp()).then(ok, err);
  return nodo;
}

/** El update encadena `.eq()`/`.is()` cuantas veces haga falta y solo se
 *  resuelve al esperarlo, para que la prueba vea TODOS los filtros con que se
 *  ancló — el mismo criterio del mock de `escalar_viaje.test.ts`. */
function escribible(
  destino: Array<{ fila: Record<string, unknown>; por: Array<[string, unknown]> }>,
  fila: Record<string, unknown>,
  resp: () => Resp,
) {
  const por: Array<[string, unknown]> = [];
  const nodo: Record<string, unknown> = {};
  nodo.eq = (col: string, val: unknown) => { por.push([col, val]); return nodo; };
  nodo.is = (col: string, val: unknown) => { por.push([col, val]); return nodo; };
  nodo.select = () => nodo;
  nodo.then = (ok: (v: unknown) => unknown) => {
    destino.push({ fila, por });
    return Promise.resolve(resp()).then(ok);
  };
  return nodo;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => ({
      select: () => {
        if (tabla === 'cfdi_consolidado_linea') return lecturable(() => respLineas);
        if (tabla === 'cfdi_xml') return lecturable(() => respXml);
        return lecturable(() => respGastos);
      },
      update: (fila: Record<string, unknown>) =>
        (tabla === 'gasto'
          ? escribible(sellos, fila, () => respGastoUpdate)
          : escribible(escriturasLinea, fila, () => respLineaUpdate)),
    }),
  }),
}));

const { barrerPorConciliar } = await import('./consolidado');

/** Una fila de `cfdi_consolidado_linea` como la devuelve el SELECT del barrido. */
const filaPendiente = (o: Record<string, unknown> = {}) => ({
  id: 'l-1', cfdi_xml_id: 'xml-1', indice: 1, fuente: 'ecc12', fecha: '2026-08-10',
  monto: 500, descripcion: 'DIESEL', estacion_rfc: null, estacion_clave: null,
  folio_operacion: null, candidatos: null,
  ...o,
});

const gasto = (id: string, monto = 500, fecha = '2026-08-10') => ({ id, concepto: 'diesel', monto, fecha });

beforeEach(() => {
  respLineas = { data: [], error: null };
  respXml = { data: [{ id: 'xml-1', cfdi_uuid: 'uuid-1' }], error: null };
  respGastos = { data: [], error: null };
  respGastoUpdate = { data: [{ id: 'g' }], error: null };
  respLineaUpdate = { data: [{ id: 'l' }], error: null };
  sellos = [];
  escriturasLinea = [];
  for (const f of Object.values(logger)) f.mockReset();
});

describe('barrerPorConciliar', () => {
  it('sin pendientes: resumen en ceros, ni un update, y el log lo registra igual', async () => {
    const r = await barrerPorConciliar('t1');
    expect(r).toEqual({ revisadas: 0, conciliadas: 0, candidatosRefrescados: 0, siguenPendientes: 0 });
    expect(sellos).toEqual([]);
    expect(escriturasLinea).toEqual([]);
    expect(logger.info).toHaveBeenCalledWith('peajes.barrido', { tenant: 't1', revisadas: 0, conciliadas: 0, candidatosRefrescados: 0, siguenPendientes: 0 });
  });

  it('UN ERROR DE LECTURA LANZA: una base caída no es una cola vacía', async () => {
    respLineas = { data: null, error: { message: 'timeout' } };
    await expect(barrerPorConciliar('t1')).rejects.toThrow(/timeout/);
    expect(sellos).toEqual([]);
  });

  it('si los candidatos no se pueden leer, LANZA en vez de barrer contra un fondo vacío', async () => {
    // Barrer con "cero gastos disponibles" por un error de red refrescaría
    // TODAS las colas a "sin candidatos" — le quitaría al contador justo lo
    // que tenía para elegir.
    respLineas = { data: [filaPendiente()], error: null };
    respGastos = { data: null, error: { message: 'fetch failed' } };
    await expect(barrerPorConciliar('t1')).rejects.toThrow(/fetch failed/);
    expect(escriturasLinea).toEqual([]);
  });

  it('camino feliz: el gasto que llegó DESPUÉS del XML amarra la línea', async () => {
    respLineas = { data: [filaPendiente()], error: null };
    respGastos = { data: [gasto('g-9')], error: null };

    const r = await barrerPorConciliar('t1');

    expect(r).toEqual({ revisadas: 1, conciliadas: 1, candidatosRefrescados: 0, siguenPendientes: 0 });
    // El sello es el de `ligarLineaAGasto`: uuid + orden, anclado a tenant y
    // con el guardia de disponibilidad.
    expect(sellos).toHaveLength(1);
    expect(sellos[0].fila).toEqual({ cfdi_uuid: 'uuid-1', cfdi_orden: 1 });
    expect(sellos[0].por).toContainEqual(['id', 'g-9']);
    expect(sellos[0].por).toContainEqual(['tenant_id', 't1']);
    expect(sellos[0].por).toContainEqual(['cfdi_uuid', null]);
    // La línea se cierra con su autor y anclada a estatus: dos barridos (o un
    // humano en paralelo) no pueden cerrarla dos veces.
    expect(escriturasLinea).toHaveLength(1);
    expect(escriturasLinea[0].fila).toMatchObject({ estatus: 'conciliada', gasto_id: 'g-9', resuelto_por: 'barrido' });
    expect(typeof escriturasLinea[0].fila.resuelto_en).toBe('string');
    expect(escriturasLinea[0].por).toContainEqual(['id', 'l-1']);
    expect(escriturasLinea[0].por).toContainEqual(['tenant_id', 't1']);
    expect(escriturasLinea[0].por).toContainEqual(['estatus', 'por_conciliar']);
  });

  it('el guardia niega el gasto (otro lo reclamó): la línea SE QUEDA pendiente, sin marcar', async () => {
    respLineas = { data: [filaPendiente()], error: null };
    respGastos = { data: [gasto('g-9')], error: null };
    respGastoUpdate = { data: [], error: null };   // cero filas: el guardia lo negó

    const r = await barrerPorConciliar('t1');

    expect(r).toEqual({ revisadas: 1, conciliadas: 0, candidatosRefrescados: 0, siguenPendientes: 1 });
    expect(escriturasLinea).toEqual([]);   // ni conciliada ni refresco a medias
  });

  it('si la línea no se pudo marcar tras el sello, cuenta pendiente y se grita — el sello no se deshace', async () => {
    respLineas = { data: [filaPendiente()], error: null };
    respGastos = { data: [gasto('g-9')], error: null };
    respLineaUpdate = { data: null, error: { message: 'blip de red' } };

    const r = await barrerPorConciliar('t1');

    expect(r.conciliadas).toBe(0);
    expect(r.siguenPendientes).toBe(1);
    expect(logger.error).toHaveBeenCalledWith('barrido.marcar_conciliada_error', expect.objectContaining({ linea: 'l-1', gasto: 'g-9' }));
  });

  it('línea ambigua: no liga, pero le refresca al contador lo que hoy hay para elegir', async () => {
    // Guardada con CERO candidatos (el día del XML no había nada); hoy hay
    // dos del mismo monto — sigue siendo decisión humana, pero ya con opciones.
    respLineas = { data: [filaPendiente({ candidatos: null })], error: null };
    respGastos = { data: [gasto('g-a'), gasto('g-b')], error: null };

    const r = await barrerPorConciliar('t1');

    expect(r).toEqual({ revisadas: 1, conciliadas: 0, candidatosRefrescados: 1, siguenPendientes: 1 });
    expect(sellos).toEqual([]);
    expect(escriturasLinea).toHaveLength(1);
    expect(escriturasLinea[0].fila.candidatos).toEqual([
      { gastoId: 'g-a', monto: 500, fecha: '2026-08-10' },
      { gastoId: 'g-b', monto: 500, fecha: '2026-08-10' },
    ]);
    expect(escriturasLinea[0].por).toContainEqual(['estatus', 'por_conciliar']);
  });

  it('los mismos candidatos en otro orden NO se reescriben: el orden del SELECT no es noticia', async () => {
    respLineas = {
      data: [filaPendiente({
        candidatos: [
          { gastoId: 'g-b', monto: 500, fecha: '2026-08-10' },
          { gastoId: 'g-a', monto: 500, fecha: '2026-08-10' },
        ],
      })],
      error: null,
    };
    respGastos = { data: [gasto('g-a'), gasto('g-b')], error: null };

    const r = await barrerPorConciliar('t1');

    expect(r).toEqual({ revisadas: 1, conciliadas: 0, candidatosRefrescados: 0, siguenPendientes: 1 });
    expect(escriturasLinea).toEqual([]);
  });

  it('un gasto que un consolidado liga SALE del fondo del siguiente — y la lista vieja que lo ofrecía se refresca', async () => {
    respLineas = {
      data: [
        filaPendiente({ id: 'l-1', cfdi_xml_id: 'xml-1' }),
        filaPendiente({
          id: 'l-2', cfdi_xml_id: 'xml-2',
          candidatos: [{ gastoId: 'g-1', monto: 500, fecha: '2026-08-10' }],
        }),
      ],
      error: null,
    };
    respXml = { data: [{ id: 'xml-1', cfdi_uuid: 'uuid-1' }, { id: 'xml-2', cfdi_uuid: 'uuid-2' }], error: null };
    respGastos = { data: [gasto('g-1')], error: null };

    const r = await barrerPorConciliar('t1');

    // El grupo xml-1 se lleva a g-1; para xml-2 ya no está disponible, así que
    // su línea sigue pendiente y su lista —que aún lo ofrecía— queda vacía:
    // ofrecerle a un contador un gasto ya sellado es un clic a un error.
    expect(r).toEqual({ revisadas: 2, conciliadas: 1, candidatosRefrescados: 1, siguenPendientes: 1 });
    expect(sellos).toHaveLength(1);
    expect(sellos[0].fila).toEqual({ cfdi_uuid: 'uuid-1', cfdi_orden: 1 });
    const refresco = escriturasLinea.find((e) => e.por.some(([c, v]) => c === 'id' && v === 'l-2'));
    expect(refresco?.fila.candidatos).toBeNull();
  });

  it('una línea sin fecha nunca liga sola — la regla dura del matcher se respeta también aquí', async () => {
    respLineas = { data: [filaPendiente({ fecha: null, fuente: 'concepto_base' })], error: null };
    // Sin rango de fechas ni siquiera se consulta el fondo; si se consultara,
    // este dato haría un match de monto que la regla prohíbe.
    respGastos = { data: [gasto('g-9')], error: null };

    const r = await barrerPorConciliar('t1');

    expect(r).toEqual({ revisadas: 1, conciliadas: 0, candidatosRefrescados: 0, siguenPendientes: 1 });
    expect(sellos).toEqual([]);
    expect(escriturasLinea).toEqual([]);   // [] contra null guardado no es un cambio
  });
});
