import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CfdiLineaXml } from './cfdi_xml';
import type { Gasto } from '@/types/cuadra';

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
let respGastoEscritura: Resp = { data: [], error: null };
let respLineaEscritura: Resp = { data: [], error: null };

const filtrosVistos: Array<{ tabla: string; op: string; col: string; val: unknown }> = [];

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

const from = vi.fn((tabla: string) => ({
  select: () => (tabla === 'cfdi_xml' ? nodoLectura(tabla, () => respXmlLectura) : nodoLectura(tabla, () => respLineaLectura)),
  update: () => (tabla === 'gasto' ? nodoEscritura(tabla, () => respGastoEscritura) : nodoEscritura(tabla, () => respLineaEscritura)),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (...a: unknown[]) => from(...(a as [string])) }),
}));

const {
  conciliarLineas, rangoFechasLineas, mensajeConsolidadoRecibido, resolverLineaAMano,
  TOLERANCIA_MONTO_MXN, VENTANA_DIAS_FECHA,
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
    respGastoEscritura = { data: [{ id: 'g1' }], error: null };
    respLineaEscritura = { data: [{ id: 'linea-1' }], error: null };
    filtrosVistos.length = 0;
    logger.error.mockClear();
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
});
