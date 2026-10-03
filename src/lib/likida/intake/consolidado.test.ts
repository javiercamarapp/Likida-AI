import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseCfdiXml } from './cfdi_xml';
import type { CfdiLineaXml } from './cfdi_xml';
import type { Gasto } from '@/types/likida';

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

// ═══════════════════════════════════════════════════════════════════════════
// EL DOBLE DE `resolverLineaAMano` — solo lo usan las pruebas de esa sección,
// de más abajo. `conciliarLineas`/`rangoFechasLineas`/`mensajeConsolidadoRecibido`
// son puras y nunca tocan `supabaseAdmin()`, así que este mock no las afecta.
//
// Cuatro operaciones distintas contra tres tablas, cada una con su propia
// respuesta programable por prueba: leer la línea (`cfdi_consolidado_linea`),
// leer el `cfdi_uuid` del XML (`cfdi_xml`), el UPDATE que liga el gasto
// (`gasto`, con el guardia `.is('cfdi_uuid', null)`), y el UPDATE que cierra
// la línea (`cfdi_consolidado_linea` otra vez, `estatus` distinto según el
// camino). Se separan por variable y no por tabla porque `cfdi_consolidado_linea`
// participa dos veces —lectura y escritura— con formas de respuesta distintas.
// ═══════════════════════════════════════════════════════════════════════════
type Resp = { data: unknown; error: { message: string } | null };

let respLineaLectura: Resp = { data: null, error: null };
let respXmlLectura: Resp = { data: null, error: null };
// FASE 1: `ligarLineaAGasto` ahora lee `gasto.ocr_extra` ANTES de ligar
// diésel (lectura+fusión, igual que `updateGastoCfdiXml`) — mock aparte del
// de `cfdi_consolidado_linea`, que antes era el único select fuera de `cfdi_xml`.
let respGastoLectura: Resp = { data: null, error: null };
let respGastoEscritura: Resp = { data: [], error: null };
let respLineaEscritura: Resp = { data: [], error: null };

const filtrosVistos: Array<{ tabla: string; op: string; col: string; val: unknown }> = [];
/** Los payloads de cada `.update(...)`, en orden — para verificar qué se
 *  escribió de verdad (FASE 1: `ocr_extra`/`clave_prod_serv` del gasto). */
const updatesVistos: Array<{ tabla: string; payload: Record<string, unknown> }> = [];

function nodoLectura(tabla: string, resp: () => Resp) {
  const nodo: Record<string, unknown> = {};
  nodo.eq = (col: string, val: unknown) => { filtrosVistos.push({ tabla, op: 'select', col, val }); return nodo; };
  nodo.maybeSingle = () => Promise.resolve(resp());
  return nodo;
}
function nodoEscritura(tabla: string, resp: () => Resp) {
  const nodo: Record<string, unknown> = {};
  nodo.eq = (col: string, val: unknown) => { filtrosVistos.push({ tabla, op: 'update', col, val }); return nodo; };
  nodo.is = (col: string, val: unknown) => { filtrosVistos.push({ tabla, op: 'update', col, val }); return nodo; };
  nodo.select = () => nodo;
  nodo.then = (r: (v: unknown) => unknown) => Promise.resolve(resp()).then(r);
  return nodo;
}

// ═══════════════════════════════════════════════════════════════════════════
// EL DOBLE DEL CAMINO AUTOMÁTICO — `guardarYConciliarConsolidado` (BE-32C8-C1).
//
// El doble de arriba sólo cubre `resolverLineaAMano`: sus nodos tienen `eq` y
// `maybeSingle` y nada más. El camino automático encadena `.order().range()`,
// `.is().gte().lte().gt().limit()` y hace DOS `upsert`, y por eso el arnés de
// `69c4e0d` no pudo entrar por aquí — es literalmente el hallazgo `PRU-32C8-C1`.
//
// `guionSelects` se indexa por la LISTA DE COLUMNAS del `.select(...)`, no por
// tabla y no por orden de llamada. `gasto` se consulta TRES veces con formas
// distintas —`id, cfdi_orden` (sellos), `id, concepto, monto, fecha`
// (candidatos) y `ocr_extra` (el que `ligarLineaAGasto` necesita)— y las tres
// son paginadas, así que una cola posicional se desalinea sola en cuanto una
// pide una página de más. Indexar por columnas hace que el doble no pueda
// contestarle a una consulta lo que era de otra, que es como un doble empieza a
// certificar lo que la prueba quiere oír.
// ═══════════════════════════════════════════════════════════════════════════
// Una entrada puede ser una respuesta fija o una LISTA consumida por páginas:
// `traerTodoDesdeId` vuelve a pedir la misma consulta hasta que una página
// llega vacía, así que una consulta paginada necesita decir dónde se acaba o el
// doble la pagina 100 veces y revienta con `LecturaIncompleta`.
const guionSelects: Record<string, Resp | Resp[]> = {};
function respuestaDe(llave: string): Resp {
  const v = guionSelects[llave];
  if (Array.isArray(v)) return (v.length > 1 ? (v.shift() as Resp) : v[0]);
  return v;
}
const upsertsVistos: Array<{ tabla: string; payload: unknown }> = [];
let respUpsert: Resp = { data: [{ id: 'xml-1' }], error: null };

/** Nodo encadenable que traga cualquier filtro y resuelve al final. */
function nodoCadena(tabla: string, resp: () => Resp) {
  const nodo: Record<string, unknown> = {};
  for (const m of ['eq', 'is', 'gte', 'lte', 'gt', 'order', 'range', 'limit', 'in', 'not', 'select'])
    nodo[m] = (col?: unknown, val?: unknown) => {
      if (m === 'eq' || m === 'is') filtrosVistos.push({ tabla, op: 'select', col: String(col), val });
      return nodo;
    };
  nodo.maybeSingle = () => Promise.resolve(resp());
  nodo.single = () => Promise.resolve(resp());
  nodo.then = (r: (v: unknown) => unknown) => Promise.resolve(resp()).then(r);
  return nodo;
}

const from = vi.fn((tabla: string) => ({
  select: (cols?: unknown) => {
    const llave = `${tabla}|${String(cols ?? '')}`;
    if (llave in guionSelects) return nodoCadena(tabla, () => respuestaDe(llave));
    return tabla === 'cfdi_xml' ? nodoLectura(tabla, () => respXmlLectura)
      : tabla === 'gasto' ? nodoLectura(tabla, () => respGastoLectura)
      : nodoLectura(tabla, () => respLineaLectura);
  },
  upsert: (payload: unknown) => {
    upsertsVistos.push({ tabla, payload });
    return nodoCadena(tabla, () => respUpsert);
  },
  update: (payload: Record<string, unknown>) => {
    updatesVistos.push({ tabla, payload });
    return tabla === 'gasto' ? nodoEscritura(tabla, () => respGastoEscritura) : nodoEscritura(tabla, () => respLineaEscritura);
  },
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (...a: unknown[]) => from(...(a as [string])) }),
}));

const {
  conciliarLineas, rangoFechasLineas, mensajeConsolidadoRecibido, resolverLineaAMano,
  guardarYConciliarConsolidado,
  claveProdServDeLinea, litrosDeLinea, TOLERANCIA_MONTO_MXN, VENTANA_DIAS_FECHA,
} = await import('./consolidado');

const linea = (indice: number, monto: number, fecha?: string, extra?: Partial<CfdiLineaXml>): CfdiLineaXml => ({
  indice, monto, fecha, fuente: fecha ? 'ecc12' : 'concepto_base', ...extra,
});

const gasto = (id: string, monto: number, fecha?: string): Gasto => ({
  id, concepto: 'diesel', monto, fecha,
});

describe('conciliarLineas — el JOIN contra gasto', () => {
  it('candidato único → concilia y liga el gastoId', () => {
    const lineas = [linea(1, 2904.05, '2026-04-03T09:12:00')];
    const gastos = [gasto('g1', 2904.05, '2026-04-03')];
    const r = conciliarLineas(lineas, gastos);
    expect(r).toHaveLength(1);
    expect(r[0].estatus).toBe('conciliada');
    expect(r[0].gastoId).toBe('g1');
    expect(r[0].candidatos).toEqual([]);
  });

  it('sin fecha en la línea → NUNCA intenta match automático, aunque el monto sea único', () => {
    const lineas = [linea(1, 310, undefined)]; // TAG sin ECC12
    const gastos = [gasto('g1', 310, '2026-04-10')];
    const r = conciliarLineas(lineas, gastos);
    expect(r[0].estatus).toBe('por_conciliar');
    expect(r[0].gastoId).toBeNull();
    expect(r[0].candidatos).toEqual([]); // ni siquiera se reporta como candidato: no se evaluó
  });

  it('cero candidatos (ni monto ni fecha cuadran con nada) → por_conciliar, sin inventar', () => {
    const lineas = [linea(1, 5000, '2026-04-03T09:12:00')];
    const gastos = [gasto('g1', 300, '2026-04-03')];
    const r = conciliarLineas(lineas, gastos);
    expect(r[0].estatus).toBe('por_conciliar');
    expect(r[0].gastoId).toBeNull();
    expect(r[0].candidatos).toEqual([]);
  });

  it('dos candidatos igual de razonables (ambiguo) → por_conciliar, con los DOS listados', () => {
    const lineas = [linea(1, 300, '2026-04-03T09:12:00')];
    const gastos = [gasto('g1', 300, '2026-04-03'), gasto('g2', 300.5, '2026-04-04')];
    const r = conciliarLineas(lineas, gastos);
    expect(r[0].estatus).toBe('por_conciliar');
    expect(r[0].gastoId).toBeNull();
    expect(r[0].candidatos.map((c) => c.gastoId).sort()).toEqual(['g1', 'g2']);
  });

  it(`respeta la tolerancia de monto (±$${TOLERANCIA_MONTO_MXN}) pero no más`, () => {
    const dentro = conciliarLineas([linea(1, 100, '2026-04-03T00:00:00')], [gasto('g1', 100 + TOLERANCIA_MONTO_MXN, '2026-04-03')]);
    expect(dentro[0].estatus).toBe('conciliada');

    const fuera = conciliarLineas([linea(1, 100, '2026-04-03T00:00:00')], [gasto('g1', 100 + TOLERANCIA_MONTO_MXN + 0.5, '2026-04-03')]);
    expect(fuera[0].estatus).toBe('por_conciliar');
  });

  it(`respeta la ventana de fecha (±${VENTANA_DIAS_FECHA} día) pero no más`, () => {
    const dentro = conciliarLineas([linea(1, 100, '2026-04-03T00:00:00')], [gasto('g1', 100, '2026-04-04')]);
    expect(dentro[0].estatus).toBe('conciliada');

    const fuera = conciliarLineas([linea(1, 100, '2026-04-03T00:00:00')], [gasto('g1', 100, '2026-04-06')]);
    expect(fuera[0].estatus).toBe('por_conciliar');
  });

  it('un gasto sin fecha NUNCA es candidato, aunque el monto cuadre exacto', () => {
    const lineas = [linea(1, 100, '2026-04-03T00:00:00')];
    const gastos = [gasto('g1', 100, undefined)];
    const r = conciliarLineas(lineas, gastos);
    expect(r[0].estatus).toBe('por_conciliar');
  });

  it('dos líneas del mismo consolidado NO pueden reclamar el mismo gasto', () => {
    // Dos cargas de $500 el mismo día contra UN solo ticket capturado: la
    // primera se lo lleva, a la segunda no le queda candidato.
    const lineas = [linea(1, 500, '2026-04-03T08:00:00'), linea(2, 500, '2026-04-03T20:00:00')];
    const gastos = [gasto('g1', 500, '2026-04-03')];
    const r = conciliarLineas(lineas, gastos);
    expect(r[0].estatus).toBe('conciliada');
    expect(r[0].gastoId).toBe('g1');
    expect(r[1].estatus).toBe('por_conciliar');
    expect(r[1].gastoId).toBeNull();
  });

  it('procesa las líneas EN EL ORDEN del XML y liga cada una a su propio gasto', () => {
    const lineas = [
      linea(1, 2904.05, '2026-04-03T09:12:00'),
      linea(2, 2308.50, '2026-04-11T18:47:00'),
      linea(3, 2656.50, '2026-04-22T07:03:00'),
    ];
    const gastos = [
      gasto('g3', 2656.50, '2026-04-22'),
      gasto('g1', 2904.05, '2026-04-03'),
      gasto('g2', 2308.50, '2026-04-11'),
    ];
    const r = conciliarLineas(lineas, gastos);
    expect(r.map((x) => x.estatus)).toEqual(['conciliada', 'conciliada', 'conciliada']);
    expect(r.map((x) => x.gastoId)).toEqual(['g1', 'g2', 'g3']);
    // El índice de la línea es el que se va a escribir como cfdi_orden.
    expect(r.map((x) => x.linea.indice)).toEqual([1, 2, 3]);
  });

  it('procesa una lista vacía sin lanzar', () => {
    expect(conciliarLineas([], [])).toEqual([]);
  });
});

describe('rangoFechasLineas', () => {
  it('null cuando NINGUNA línea trae fecha (consolidado tipo TAG sin ECC12)', () => {
    expect(rangoFechasLineas([linea(1, 100, undefined), linea(2, 200, undefined)])).toBeNull();
  });

  it('cubre el mínimo y máximo con la ventana aplicada', () => {
    const r = rangoFechasLineas([
      linea(1, 100, '2026-04-03T09:00:00'),
      linea(2, 200, '2026-04-22T07:00:00'),
    ]);
    expect(r).toEqual({ desde: '2026-04-02', hasta: '2026-04-23' });
  });

  it('ignora las líneas sin fecha al calcular el rango, no las cuenta como extremo', () => {
    const r = rangoFechasLineas([
      linea(1, 100, '2026-04-10T09:00:00'),
      linea(2, 200, undefined),
    ]);
    expect(r).toEqual({ desde: '2026-04-09', hasta: '2026-04-11' });
  });
});

describe('mensajeConsolidadoRecibido — el acuse dice la verdad', () => {
  it('todo conciliado: no pide revisión que ya no hace falta', () => {
    const msg = mensajeConsolidadoRecibido({ cfdiXmlId: 'x', totalLineas: 3, conciliadas: 3, porConciliar: 0 });
    expect(msg).toMatch(/quedó ligado/);
    expect(msg).not.toMatch(/revisión|revise/);
  });

  it('nada conciliado: no promete un "listo" que no pasó', () => {
    const msg = mensajeConsolidadoRecibido({ cfdiXmlId: 'x', totalLineas: 3, conciliadas: 0, porConciliar: 3 });
    expect(msg).not.toMatch(/ligado ✅/);
    expect(msg).toMatch(/revise/);
  });

  it('mixto: dice cuántos de cada uno', () => {
    const msg = mensajeConsolidadoRecibido({ cfdiXmlId: 'x', totalLineas: 5, conciliadas: 3, porConciliar: 2 });
    expect(msg).toContain('3');
    expect(msg).toContain('2');
  });
});

describe('resolverLineaAMano — la pantalla que faltaba, contra Supabase mockeado', () => {
  const filaLinea = (o: Record<string, unknown> = {}) => ({
    id: 'linea-1', cfdi_xml_id: 'xml-1', indice: 2, estatus: 'por_conciliar',
    candidatos: [{ gastoId: 'g1', monto: 100, fecha: '2026-04-03' }],
    ...o,
  });

  beforeEach(() => {
    respLineaLectura = { data: filaLinea(), error: null };
    respXmlLectura = { data: { cfdi_uuid: 'uuid-abc' }, error: null };
    respGastoLectura = { data: null, error: null };
    respGastoEscritura = { data: [{ id: 'g1' }], error: null };
    respLineaEscritura = { data: [{ id: 'linea-1' }], error: null };
    filtrosVistos.length = 0;
    updatesVistos.length = 0;
    logger.error.mockClear();
    logger.warn.mockClear();
  });

  it('elige un candidato ofrecido → liga el gasto Y cierra la línea como conciliada', async () => {
    const r = await resolverLineaAMano('t1', 'linea-1', { tipo: 'ligar', gastoId: 'g1' }, 'user-1');
    expect(r).toEqual({ ok: true });

    // El UPDATE de `gasto` va acotado por tenant Y por el guardia
    // `.is('cfdi_uuid', null)` — el mismo mecanismo que el camino automático.
    const filtrosGasto = filtrosVistos.filter((f) => f.tabla === 'gasto');
    expect(filtrosGasto).toContainEqual({ tabla: 'gasto', op: 'update', col: 'id', val: 'g1' });
    expect(filtrosGasto).toContainEqual({ tabla: 'gasto', op: 'update', col: 'tenant_id', val: 't1' });
    expect(filtrosGasto).toContainEqual({ tabla: 'gasto', op: 'update', col: 'cfdi_uuid', val: null });

    // El UPDATE final de la línea repite `estatus = 'por_conciliar'` en el
    // WHERE — el guardia contra la carrera de dos personas resolviendo a la vez.
    const filtrosLinea = filtrosVistos.filter((f) => f.tabla === 'cfdi_consolidado_linea' && f.op === 'update');
    expect(filtrosLinea).toContainEqual({ tabla: 'cfdi_consolidado_linea', op: 'update', col: 'estatus', val: 'por_conciliar' });
  });

  it('"ninguno de estos aplica" → sin_match, sin tocar ningún gasto', async () => {
    const r = await resolverLineaAMano('t1', 'linea-1', { tipo: 'sin_match' }, 'user-1');
    expect(r).toEqual({ ok: true });
    // Nunca se llamó `gasto.update` — ni se leyó el cfdi_xml, que solo hace
    // falta para el camino de "ligar".
    expect(filtrosVistos.some((f) => f.tabla === 'gasto')).toBe(false);
  });

  it('línea que no existe (o de otro tenant — el `.eq(tenant_id)` la esconde) → linea_no_encontrada', async () => {
    respLineaLectura = { data: null, error: null };
    const r = await resolverLineaAMano('t1', 'linea-fantasma', { tipo: 'sin_match' }, 'user-1');
    expect(r).toEqual({ ok: false, motivo: 'linea_no_encontrada' });
  });

  it('línea que YA se resolvió (por otro humano, o por el JOIN automático de un reenvío) → ya_resuelta, no se pisa', async () => {
    respLineaLectura = { data: filaLinea({ estatus: 'conciliada' }), error: null };
    const r = await resolverLineaAMano('t1', 'linea-1', { tipo: 'sin_match' }, 'user-1');
    expect(r).toEqual({ ok: false, motivo: 'ya_resuelta' });
  });

  it('un gastoId que NO está entre los candidatos ofrecidos → candidato_no_ofrecido, no es un buscador libre', async () => {
    const r = await resolverLineaAMano('t1', 'linea-1', { tipo: 'ligar', gastoId: 'g-nunca-ofrecido' }, 'user-1');
    expect(r).toEqual({ ok: false, motivo: 'candidato_no_ofrecido' });
  });

  it('el gasto elegido ya se lo llevó otra línea mientras se revisaba → gasto_ya_no_disponible', async () => {
    // El guardia `.is('cfdi_uuid', null)` del UPDATE no encontró fila: el
    // gasto ya tenía `cfdi_uuid` puesto por alguien más.
    respGastoEscritura = { data: [], error: null };
    const r = await resolverLineaAMano('t1', 'linea-1', { tipo: 'ligar', gastoId: 'g1' }, 'user-1');
    expect(r).toEqual({ ok: false, motivo: 'gasto_ya_no_disponible' });
    // Y NO se intentó cerrar la línea — el gasto no se ligó, cerrarla habría
    // dejado `estatus = 'conciliada'` sin que el gasto correspondiente lo esté.
    expect(filtrosVistos.some((f) => f.tabla === 'cfdi_consolidado_linea' && f.op === 'update')).toBe(false);
  });

  it('el gasto SÍ se ligó pero el cierre de la línea perdió la carrera → ya_resuelta, y se deja rastro en el log', async () => {
    respLineaEscritura = { data: [], error: null };
    const r = await resolverLineaAMano('t1', 'linea-1', { tipo: 'ligar', gastoId: 'g1' }, 'user-1');
    expect(r).toEqual({ ok: false, motivo: 'ya_resuelta' });
    expect(logger.error).toHaveBeenCalledWith('consolidado.marcar_conciliada_a_mano_carrera', expect.objectContaining({ linea: 'linea-1' }));
  });

  it('un error de Postgres al leer la línea no se confunde con "no existe" — error_bd, no linea_no_encontrada', async () => {
    respLineaLectura = { data: null, error: { message: 'fetch failed' } };
    const r = await resolverLineaAMano('t1', 'linea-1', { tipo: 'sin_match' }, 'user-1');
    expect(r).toEqual({ ok: false, motivo: 'error_bd' });
  });

  it('cero candidatos ofrecidos, y aun así alguien manda un gastoId → candidato_no_ofrecido (mismo camino que uno inventado)', async () => {
    respLineaLectura = { data: filaLinea({ candidatos: [] }), error: null };
    const r = await resolverLineaAMano('t1', 'linea-1', { tipo: 'ligar', gastoId: 'g1' }, 'user-1');
    expect(r).toEqual({ ok: false, motivo: 'candidato_no_ofrecido' });
  });

  it('FASE 1 — al ligar una línea con litros+clave YA resueltos, propaga ocr_extra.litros y clave_prod_serv al gasto', async () => {
    respLineaLectura = { data: filaLinea({ litros: 120.5, clave_prod_serv: '15101505' }), error: null };
    // El gasto ya trae OTRO dato en ocr_extra (p.ej. lo que dejó el OCR del
    // ticket) — la fusión no debe borrarlo.
    respGastoLectura = { data: { ocr_extra: { producto: 'Diesel', estacion: 'PEMEX 4521' } }, error: null };

    const r = await resolverLineaAMano('t1', 'linea-1', { tipo: 'ligar', gastoId: 'g1' }, 'user-1');
    expect(r).toEqual({ ok: true });

    const updateGasto = updatesVistos.find((u) => u.tabla === 'gasto');
    expect(updateGasto?.payload).toMatchObject({
      cfdi_uuid: 'uuid-abc',
      cfdi_orden: 2,
      clave_prod_serv: '15101505',
      ocr_extra: { producto: 'Diesel', estacion: 'PEMEX 4521', litros: 120.5 },
      xml_verificado: true,
    });
  });

  // BE-32C7-A1 (auditoría 32, c7). Esta prueba afirmaba `ok: true` y un payload
  // SIN `ocr_extra`, es decir BENDECÍA la pérdida: el `update` sellaba
  // `cfdi_uuid` + `xml_verificado: true` y los litros se perdían para siempre,
  // porque el guardia `.is('cfdi_uuid', null)` impide que una segunda pasada
  // vuelva a entrar y la línea queda `conciliada` (las tres vías que la
  // tocarían anclan a `por_conciliar`). Con `litros` en 0,
  // `cuadre/engine.ts:1790` exige `litros > 0` y se salta el bloque ENTERO del
  // estímulo sin emitir ninguna `diferencia`: `litrosDieselAcreditables` sale
  // de menos y ninguna pantalla sabe que falta algo.
  //
  // El contrato correcto es FALLAR CERRADO: si no se pudo leer `ocr_extra` y
  // hay litros que fusionar, NO se sella nada. La línea se queda
  // `por_conciliar` y los tres llamadores ya saben qué hacer con un `false`
  // (log de error, `siguenPendientes++`, o `ok: false`) — se reintenta, que es
  // justo lo que la pérdida silenciosa impedía.
  it('BE-32C7-A1 — si leer ocr_extra falla con litros por fusionar, NO sella el gasto: falla cerrado y la línea sigue reintentable', async () => {
    respLineaLectura = { data: filaLinea({ litros: 120.5, clave_prod_serv: '15101505' }), error: null };
    // `acotada()` al tope resuelve `{ data: null, error }` — no lanza.
    respGastoLectura = { data: null, error: { message: 'sin respuesta en 1500 ms (tope de consulta)' } };

    const r = await resolverLineaAMano('t1', 'linea-1', { tipo: 'ligar', gastoId: 'g1' }, 'user-1');
    expect(r.ok).toBe(false);

    // Lo esencial: NO se ejecutó NINGÚN update sobre `gasto`. Sin esto el
    // `xml_verificado: true` viajaba con los litros perdidos.
    expect(updatesVistos.find((u) => u.tabla === 'gasto')).toBeUndefined();
    // Y tampoco se cerró la línea: sigue `por_conciliar` para el reintento.
    expect(updatesVistos.find((u) => u.tabla === 'cfdi_consolidado_linea')).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'consolidado.ligar_ocr_extra_ilegible',
      expect.objectContaining({ gasto: 'g1' }),
    );
  });

  // El contraste que prueba que el arreglo es acotado: SIN litros que fusionar
  // (una caseta), `ligarLineaAGasto` nunca lee `ocr_extra`, así que un fallo de
  // esa lectura no puede afectarla y liga igual que siempre.
  it('BE-32C7-A1 — una línea sin diésel liga igual aunque la lectura de ocr_extra estuviera rota (no la consulta)', async () => {
    respLineaLectura = { data: filaLinea({ litros: null, clave_prod_serv: null }), error: null };
    respGastoLectura = { data: null, error: { message: 'sin respuesta en 1500 ms (tope de consulta)' } };

    const r = await resolverLineaAMano('t1', 'linea-1', { tipo: 'ligar', gastoId: 'g1' }, 'user-1');
    expect(r).toEqual({ ok: true });

    const updateGasto = updatesVistos.find((u) => u.tabla === 'gasto');
    expect(updateGasto?.payload).toEqual({
      cfdi_uuid: 'uuid-abc',
      cfdi_orden: 2,
      xml_verificado: true,
    });
  });

  it('FASE 1 — una línea sin litros (p.ej. caseta) liga igual que siempre, sin tocar ocr_extra ni clave_prod_serv', async () => {
    respLineaLectura = { data: filaLinea({ litros: null, clave_prod_serv: null }), error: null };
    const r = await resolverLineaAMano('t1', 'linea-1', { tipo: 'ligar', gastoId: 'g1' }, 'user-1');
    expect(r).toEqual({ ok: true });

    const updateGasto = updatesVistos.find((u) => u.tabla === 'gasto');
    expect(updateGasto?.payload).toEqual({ cfdi_uuid: 'uuid-abc', cfdi_orden: 2, xml_verificado: true });
    // Y ni siquiera se leyó `gasto.ocr_extra`: no hay litros que fusionar.
    expect(filtrosVistos.some((f) => f.tabla === 'gasto' && f.op === 'select')).toBe(false);
  });

  it('AUDITORÍA 19 (fiscal CRÍTICO F1): TODA línea ligada marca xml_verificado — sin esto, engine.ts:1248 nunca acredita IVA/estímulo/litros de un consolidado', async () => {
    // Sin litros/clave (p.ej. una caseta) es el caso más fácil de olvidar:
    // no hay ningún otro campo fiscal que delate que esto es un CFDI
    // verificado, así que si `xml_verificado` faltara aquí nadie más lo notaría.
    respLineaLectura = { data: filaLinea({ litros: null, clave_prod_serv: null }), error: null };
    await resolverLineaAMano('t1', 'linea-1', { tipo: 'ligar', gastoId: 'g1' }, 'user-1');

    const updateGasto = updatesVistos.find((u) => u.tabla === 'gasto');
    expect(updateGasto?.payload).toMatchObject({ xml_verificado: true });
    // Y NO se le inventa un desglose que el estándar no da por línea: el motor
    // debe seguir viendo iva_traslado/ieps_traslado ausentes, no en $0 falso.
    expect(updateGasto?.payload).not.toHaveProperty('iva_traslado');
    expect(updateGasto?.payload).not.toHaveProperty('ieps_traslado');
  });
});

describe('claveProdServDeLinea — FASE 1, la clave SAT de una línea del consolidado', () => {
  it('concepto_base: usa el ClaveProdServ nativo cuando es de la familia de combustibles (15101…)', () => {
    expect(claveProdServDeLinea({ claveProdServ: '15101505' })).toBe('15101505');
  });

  it('concepto_base: un ClaveProdServ ajeno (p.ej. caseta) no cuenta, aunque venga presente', () => {
    expect(claveProdServDeLinea({ claveProdServ: '78101803' })).toBeUndefined();
  });

  it('ecc12: TipoCombustible="Diesel" se traduce a la clave 15101505 del estímulo', () => {
    expect(claveProdServDeLinea({ tipoCombustible: 'Diesel' })).toBe('15101505');
  });

  it('ecc12: cualquier OTRO TipoCombustible se queda sin clave — el estímulo LIF 20-A es solo diésel', () => {
    expect(claveProdServDeLinea({ tipoCombustible: 'Gasolina Regular (Magna)' })).toBeUndefined();
    expect(claveProdServDeLinea({ tipoCombustible: 'Gasolina Premium' })).toBeUndefined();
    expect(claveProdServDeLinea({ tipoCombustible: 'Gas L.P.' })).toBeUndefined();
    expect(claveProdServDeLinea({ tipoCombustible: 'Otros' })).toBeUndefined();
  });

  it('ninguno de los dos dato → sin clave, no se adivina', () => {
    expect(claveProdServDeLinea({})).toBeUndefined();
  });

  // ── LA MAYÚSCULA QUE COSTABA EL MES ENTERO ──────────────────────────────
  // La comparación era `=== 'Diesel'`, exacta hasta la caja. Nadie en este
  // repo ha visto un ECC emitido de verdad (los tres fixtures son sintéticos),
  // así que nadie sabe con qué tipografía escribe ese atributo un emisor real.
  // Con `"DIESEL"` la línea se guardaba SIN clave, `datosDieselDeLinea` no
  // propagaba nada y el gasto llegaba al motor con 0 litros acreditables: el
  // hueco exacto que la Fase 1 vino a cerrar, sobreviviendo dentro del arreglo.
  it('ecc12: la MISMA palabra con otra caja, con acento o con espacios sigue siendo diésel', () => {
    expect(claveProdServDeLinea({ tipoCombustible: 'DIESEL' })).toBe('15101505');
    expect(claveProdServDeLinea({ tipoCombustible: 'diesel' })).toBe('15101505');
    expect(claveProdServDeLinea({ tipoCombustible: 'Diésel' })).toBe('15101505');
    expect(claveProdServDeLinea({ tipoCombustible: 'DIÉSEL' })).toBe('15101505');
    expect(claveProdServDeLinea({ tipoCombustible: '  Diesel  ' })).toBe('15101505');
  });

  // Y hasta dónde NO llega la normalización: sigue siendo la palabra, no una
  // familia de palabras ni un catálogo numérico.
  it('no se adivina: ni una clave numérica de catálogo ni un nombre comercial que CONTENGA "diesel"', () => {
    // `c_ClaveTipoCombustible` no está verificado contra fuente en este repo
    // (no vive en `normas/` ni en `normas/datos/`). Mapear "02" a diésel
    // acreditaría litros de gasolina: una cifra fiscal inventada.
    expect(claveProdServDeLinea({ tipoCombustible: '01' })).toBeUndefined();
    expect(claveProdServDeLinea({ tipoCombustible: '02' })).toBeUndefined();
    // Nombre de producto del monedero, no el tipo de combustible.
    expect(claveProdServDeLinea({ tipoCombustible: 'Diesel Fleet' })).toBeUndefined();
    expect(claveProdServDeLinea({ tipoCombustible: 'Biodiesel' })).toBeUndefined();
  });
});

describe('litrosDeLinea — FASE 1: qué Cantidad es un litro y cuál es un cruce de caseta', () => {
  // La columna se llama `litros` (mig. 0168) y se llenaba con la `Cantidad` de
  // CUALQUIER línea. En un consolidado de TAG cada `cfdi:Concepto` de caseta
  // trae `Cantidad="1"`: la tabla decía que una caseta de $118 tuvo "1 litro".
  it('ecc12: la Cantidad SIEMPRE es volumen — el complemento se llama Estado de Cuenta de COMBUSTIBLES', () => {
    expect(litrosDeLinea({ fuente: 'ecc12', cantidad: 120.5, tipoCombustible: 'Diesel' })).toBe(120.5);
    // Magna tampoco acredita el estímulo, pero SÍ son litros: la clave se
    // queda en null (no aplica LIF 20-A) y el volumen no se pierde.
    expect(litrosDeLinea({ fuente: 'ecc12', cantidad: 110, tipoCombustible: 'Magna' })).toBe(110);
  });

  it('concepto_base de combustible: la Cantidad son litros', () => {
    expect(litrosDeLinea({ fuente: 'concepto_base', cantidad: 200, claveProdServ: '15101505' })).toBe(200);
  });

  it('concepto_base de CASETA: `Cantidad = 1` es UN CRUCE, no un litro → null', () => {
    expect(litrosDeLinea({ fuente: 'concepto_base', cantidad: 1, claveProdServ: '78101803' })).toBeNull();
  });

  it('concepto_base sin clave: no se sabe qué se midió → null, nunca 0', () => {
    expect(litrosDeLinea({ fuente: 'concepto_base', cantidad: 3 })).toBeNull();
  });

  it('sin Cantidad → null ("no se leyó volumen" ≠ "cargó cero litros")', () => {
    expect(litrosDeLinea({ fuente: 'ecc12' })).toBeNull();
    expect(litrosDeLinea({ fuente: 'ecc12', cantidad: Number.NaN })).toBeNull();
  });
});

describe('FASE 1 — equivalencia sobre un ECC12 SINTÉTICO: los litros sobreviven de principio a fin', () => {
  // ⚠️ ESTE FIXTURE NO ES UN ECC REAL, y el nombre de esta constante y de este
  // `describe` lo decían al revés hasta hoy («un ECC12 real», `ECC12_REAL`).
  // Es un XML construido a mano, verificado contra el XSD oficial en su
  // ESTRUCTURA: los RFC son de relleno (`edn010101aa1`, `EST010101AAA`), el
  // UUID es `1111…5555` y el comprobante ni siquiera declara `FormaPago`.
  // El repo NO tiene —ni ha tenido nunca— un CFDI con complemento ECC emitido
  // de verdad: no hay un solo archivo `.xml` en el árbol y los otros dos
  // fixtures ECC (`cfdi_xml.test.ts`, `pruebas-manuales/consolidado-real.
  // prueba.ts`) son este mismo, con otro nombre.
  //
  // Importa decirlo aquí porque el plan de cierre del ciclo pide "prueba de
  // equivalencia contra un ECC real" Y, con el MISMO documento en la mano,
  // resolver la pregunta abierta §6.2 (el `FormaPago = 99`). Un fixture que
  // se llama «real» hace ver esa casilla como palomeada. No lo está: ver
  // `docs/asistencia/ECC-FORMAPAGO-99.md`.
  const ECC12_SINTETICO = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" TipoDeComprobante="I" Fecha="2026-04-30T23:59:00" Total="3300.00" SubTotal="2844.83">
  <cfdi:Emisor Rfc="edn010101aa1"/>
  <cfdi:Receptor Rfc="tin950101abc"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="84111506" ClaveUnidad="ACT" Cantidad="1" Importe="2844.83" Descripcion="Consumo de combustibles del periodo abril 2026"/>
  </cfdi:Conceptos>
  <cfdi:Complemento>
    <ecc12:EstadoDeCuentaCombustible xmlns:ecc12="http://www.sat.gob.mx/ecc12" Version="1.2" TipoOperacion="Tarjeta" NumeroDeCuenta="0009182736" SubTotal="2844.83" Total="3300.00">
      <ecc12:Conceptos>
        <ecc12:ConceptoEstadoDeCuentaCombustible Identificador="1" Fecha="2026-04-03T09:12:00" Rfc="EST010101AAA" ClaveEstacion="4521" Cantidad="120.500" TipoCombustible="Diesel" Unidad="LT" NombreCombustible="Diesel" FolioOperacion="OP-100234" ValorUnitario="24.10" Importe="2904.05"/>
        <ecc12:ConceptoEstadoDeCuentaCombustible Identificador="2" Fecha="2026-04-11T18:47:00" Rfc="EST020202BBB" ClaveEstacion="7710" Cantidad="95.000" TipoCombustible="Diesel" Unidad="LT" NombreCombustible="Diesel" FolioOperacion="OP-100511" ValorUnitario="24.30" Importe="2308.50"/>
        <ecc12:ConceptoEstadoDeCuentaCombustible Identificador="3" Fecha="2026-04-22T07:03:00" Rfc="EST010101AAA" ClaveEstacion="4521" Cantidad="110.000" TipoCombustible="Magna" Unidad="LT" NombreCombustible="Magna" FolioOperacion="OP-100822" ValorUnitario="22.50" Importe="2475.00"/>
      </ecc12:Conceptos>
    </ecc12:EstadoDeCuentaCombustible>
    <tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" UUID="11111111-2222-3333-4444-555555555555"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;

  it('las 2 líneas de diésel llegan con sus litros exactos y la clave 15101505; la de Magna se queda sin clave', () => {
    const xml = parseCfdiXml(ECC12_SINTETICO)!;
    expect(xml.lineas).toHaveLength(3);

    // Lo que ANTES se leía y se tiraba al persistir (guardarYConciliarConsolidado):
    // ahora `cantidad` (litros) y la clave derivada llegan intactos a lo que se
    // guarda en `cfdi_consolidado_linea` y luego se propaga a `gasto`.
    const [diesel1, diesel2, magna] = xml.lineas;
    expect(diesel1.cantidad).toBe(120.5);
    expect(claveProdServDeLinea(diesel1)).toBe('15101505');
    expect(diesel2.cantidad).toBe(95);
    expect(claveProdServDeLinea(diesel2)).toBe('15101505');

    // La Magna NO es diésel: litros presentes, pero SIN clave — el estímulo
    // LIF 20-A no le aplica y `engine.ts` no debe verla como acreditable.
    expect(magna.cantidad).toBe(110);
    expect(claveProdServDeLinea(magna)).toBeUndefined();

    // Y el total de litros de diésel del estado de cuenta es exactamente el
    // que un contador vería en el ECC real, ni uno más ni uno menos.
    const litrosDiesel = xml.lineas
      .filter((l) => claveProdServDeLinea(l) === '15101505')
      .reduce((s, l) => s + (l.cantidad ?? 0), 0);
    expect(litrosDiesel).toBe(215.5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 32 c8 — BE-32C8-C1 (CRÍTICO) / PRU-32C8-C1 (CRÍTICO).
//
// `69c4e0d` (la c7) hizo que `ligarLineaAGasto` FALLE CERRADO cuando no puede
// leer `gasto.ocr_extra`: no sella el gasto y devuelve `false`. Eso está bien y
// su prueba muerde. Pero el arnés entró por `resolverLineaAMano` —el llamador
// MANUAL— y el escenario que el propio commit describe es el AUTOMÁTICO: «llega
// el XML por WhatsApp». Dos auditores lo encontraron por separado.
//
// En el camino automático, `guardarYConciliarConsolidado` ignora ese `false`
// para lo único que importa: `filasLinea` se construye desde `r.estatus`, que
// sigue diciendo `'conciliada'`, con `gasto_id` puesto. Resultado medido antes
// del arreglo, con el `select` de `ocr_extra` en error:
//
//   · el gasto NO se sella (el arreglo de ayer funciona),
//   · pero la línea se escribe `{estatus:'conciliada', gasto_id:'g-217'}`,
//   · y el resumen sale `{conciliadas:1, porConciliar:0}` → el acuse le dice al
//     contralor «los N coincidieron uno a uno».
//
// La pérdida es DEFINITIVA, no un reintento pendiente: el barrido
// (`barrerPorConciliar`) sólo toma líneas `por_conciliar`, así que nunca vuelve
// a mirar ésta; y el reenvío del mismo XML corta en el bloque de reanudación.
// Los litros de diésel se quedan en `cfdi_consolidado_linea.litros` sin que
// nadie los reconcilie, y `cuadre/engine.ts` se salta el bloque del estímulo
// del diésel sin emitir una sola `diferencia`. Nadie se entera.
//
// Lo que este arnés fija: si la ligadura no ocurrió, la línea se escribe
// `por_conciliar` y SIN `gasto_id`, que es lo único que la deja reintentable, y
// el resumen lo dice. Fallar cerrado y decirlo.
describe('AUDITORÍA 32 c8 — el camino AUTOMÁTICO no puede marcar conciliada una línea que no se ligó', () => {
  const XML_CONSOLIDADO = { uuid: 'UUID-C8-0001', tipoComprobante: 'I', lineas: [] as CfdiLineaXml[] };

  function montarGuion() {
    for (const k of Object.keys(guionSelects)) delete guionSelects[k];
    upsertsVistos.length = 0;
    // 1 · `cfdi_xml.upsert(...).select('id')` → el id de la fila del XML.
    respUpsert = { data: { id: 'xml-c8' }, error: null };
    // 2 · líneas ya existentes para este XML: ninguna (primera pasada).
    guionSelects['cfdi_consolidado_linea|estatus'] = { data: [], error: null };
    // 3 · gastos ya sellados con este uuid: ninguno (primera pasada).
    guionSelects['gasto|id, cfdi_orden'] = { data: [], error: null };
    // 4 · candidatos de gasto en el rango: uno que casa exacto.
    guionSelects['gasto|id, concepto, monto, fecha'] = [
      { data: [{ id: 'g-217', concepto: 'diesel', monto: 2904.05, fecha: '2026-04-03' }], error: null },
      { data: [], error: null },
    ];
    // 5 · `ligarLineaAGasto` lee `gasto.ocr_extra` y NO PUEDE. Éste es el
    //     disparador: el arreglo de ayer (`69c4e0d`) devuelve `false` justo aquí.
    respGastoLectura = { data: null, error: { message: 'canceling statement due to statement timeout' } };
  }

  beforeEach(montarGuion);

  it('con la lectura de `ocr_extra` rota, la línea NO se escribe conciliada y NO se queda con el gasto_id', async () => {
    const xml = {
      ...XML_CONSOLIDADO,
      lineas: [linea(1, 2904.05, '2026-04-03T09:12:00', { descripcion: 'DIESEL', claveProdServ: '15101505', cantidad: 300 })],
    } as unknown as Parameters<typeof guardarYConciliarConsolidado>[1];

    const resumen = await guardarYConciliarConsolidado('t-1', xml, '<xml/>');

    const filas = upsertsVistos.find((u) => u.tabla === 'cfdi_consolidado_linea')?.payload as Array<Record<string, unknown>>;
    expect(filas, 'se escribió la tabla de líneas').toBeTruthy();
    expect(filas).toHaveLength(1);
    // Lo que fallaba: `conciliada` + `gasto_id` sobre un gasto que nunca se selló.
    expect(filas[0].estatus).toBe('por_conciliar');
    expect(filas[0].gasto_id).toBeNull();
    // Y el acuse tiene que decir la verdad, no «1 de 1».
    expect(resumen.conciliadas).toBe(0);
    expect(resumen.porConciliar).toBe(1);
  });

  it('cuando la ligadura SÍ ocurre, la línea sigue quedando conciliada con su gasto', async () => {
    montarGuion();
    // Misma secuencia, pero `ocr_extra` se lee bien: `ligarLineaAGasto` sella.
    respGastoLectura = { data: { ocr_extra: {} }, error: null };
    respGastoEscritura = { data: [{ id: 'g-217' }], error: null };

    const xml = {
      ...XML_CONSOLIDADO,
      lineas: [linea(1, 2904.05, '2026-04-03T09:12:00', { descripcion: 'DIESEL', claveProdServ: '15101505', cantidad: 300 })],
    } as unknown as Parameters<typeof guardarYConciliarConsolidado>[1];

    const resumen = await guardarYConciliarConsolidado('t-1', xml, '<xml/>');

    const filas = upsertsVistos.find((u) => u.tabla === 'cfdi_consolidado_linea')?.payload as Array<Record<string, unknown>>;
    expect(filas[0].estatus).toBe('conciliada');
    expect(filas[0].gasto_id).toBe('g-217');
    expect(resumen.conciliadas).toBe(1);
    expect(resumen.porConciliar).toBe(0);
  });
});
