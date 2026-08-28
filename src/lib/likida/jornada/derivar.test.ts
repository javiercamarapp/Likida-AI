import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL DERIVADOR — lo que esta suite se niega a dejar pasar.
//
// Este motor convierte hechos que Likida YA tenía (la hora en que el operador
// aceptó su viaje por WhatsApp, las posiciones de su unidad) en marcas del
// registro de jornada del art. 132 fr. XXXIV de la LFT. O sea: escribe un
// documento laboral. Las cuatro cosas que se fijan aquí son las cuatro maneras
// en que ese documento podría salir MINTIENDO sin que nadie se entere:
//
//   1. EL RELOJ. `venceEn` no solo se recibe: se CONSULTA antes de tomar
//      trabajo nuevo, y lo que no alcanzó se cuenta en `cortadosPorReloj` sin
//      dejar nada a medias.
//   2. EL TOPE. `listaTruncada` distingue «no había más» de «no cupo». La
//      lista sale ordenada por `aceptado_en` ascendente, así que una ventana
//      que rebasa el tope devuelve SIEMPRE los mismos viajes viejos y los
//      recientes no se derivan nunca.
//   3. LA LISTA ILEGIBLE LANZA. Un resultado en ceros se leería como «no había
//      nada que hacer», y el cron pintaría verde sobre un expediente vacío.
//   4. `ya_estaba` NO ES UN FALLO. Es el resultado esperado del índice único de
//      la 0241 cuando el operador YA había declarado su marca: la precedencia
//      del declarado sobre el derivado es una restricción de la base, no un
//      `if`, y contarla como fallo pondría el cron en rojo por funcionar bien.
// ═══════════════════════════════════════════════════════════════════════════

const { logger } = vi.hoisted(() => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger }));
// `acotada` solo pone un tope de tiempo a la consulta; aquí estorba y no es lo
// que se está probando (tiene su propia suite).
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: async (p: unknown) => p }));

// ── LA BASE DOBLADA ────────────────────────────────────────────────────────
// Solo dos tablas: `viaje` (la lista de trabajo) y `posicion` (los extremos de
// GPS del día). El escritor —`asegurarDiaJornada` / `asentarMarca`— se dobla
// aparte, más abajo: tiene su propio contrato y su propia suite.
interface FilaViaje {
  id: string;
  tenant_id: string;
  operador_id: string;
  unidad_id: string | null;
  aceptado_en: string;
}
let viajes: FilaViaje[] = [];
let errorViajes: { message: string } | null = null;
/** `${unidadId}|${dia}` → los `medida_en` de ese día, en orden ascendente. */
let posiciones = new Map<string, string[]>();
let errorGps: { message: string } | null = null;

interface Estado { tabla: string; ascendente: boolean; unidad: string; dia: string }

function resolver(e: Estado): { data: unknown; error: { message: string } | null } {
  if (e.tabla === 'viaje') {
    return errorViajes ? { data: null, error: errorViajes } : { data: viajes, error: null };
  }
  if (errorGps) return { data: null, error: errorGps };
  const lista = posiciones.get(`${e.unidad}|${e.dia}`) ?? [];
  if (lista.length === 0) return { data: null, error: null };
  // El motor pide la primera y la última con dos consultas que solo difieren en
  // el `order`; el doble contesta según esa misma bandera.
  return { data: { medida_en: e.ascendente ? lista[0] : lista[lista.length - 1] }, error: null };
}

function builder(tabla: string) {
  const e: Estado = { tabla, ascendente: true, unidad: '', dia: '' };
  const b: Record<string, unknown> = {};
  const igual = () => b;
  Object.assign(b, {
    select: igual, not: igual, lte: igual, limit: igual, is: igual, in: igual, maybeSingle: igual,
    eq: (col: string, v: unknown) => { if (col === 'unidad_id') e.unidad = String(v); return b; },
    // El `gte` de posiciones lleva `inicioDiaMx(dia)`: de ahí sale el día.
    gte: (_col: string, v: unknown) => { e.dia = String(v).slice(0, 10); return b; },
    order: (_col: string, o?: { ascending?: boolean }) => { e.ascendente = o?.ascending !== false; return b; },
    then: (res: (x: unknown) => unknown, rej: (x: unknown) => unknown) =>
      Promise.resolve(resolver(e)).then(res, rej),
  });
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (t: string) => builder(t) }),
}));

// ── EL ESCRITOR DOBLADO ────────────────────────────────────────────────────
// `diaMxDe` queda REAL a propósito: agrupar por el día del CHOFER (no por el
// UTC del servidor) es parte de lo que esta suite comprueba en la deduplicación.
const asegurarDiaJornada = vi.fn(async (_t: string, o: string, d: string) =>
  ({ id: `j-${o}-${d}` }) as { id: string } | { error: string });
let resultadoAsiento: 'asentado' | 'ya_estaba' | 'fallo' = 'asentado';
const asentarMarca = vi.fn(async (_m: unknown) => resultadoAsiento);
vi.mock('./repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./repo')>()),
  asegurarDiaJornada: (t: string, o: string, d: string) => asegurarDiaJornada(t, o, d),
  asentarMarca: (m: unknown) => asentarMarca(m),
}));

import { derivarJornadas, TOPE_VIAJES_POR_CORRIDA } from './derivar';

/** Mediodía de México del 20-ago-2026: el ancla de toda la suite. */
const AHORA = new Date('2026-08-20T18:00:00Z');
const DIA = '2026-08-20';
const T = 't-1';

function viaje(n: number, operador: string, unidad: string | null, hora = '15:00'): FilaViaje {
  return {
    id: `v-${n}`, tenant_id: T, operador_id: operador, unidad_id: unidad,
    aceptado_en: `${DIA}T${hora}:00.000Z`,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  viajes = [];
  errorViajes = null;
  posiciones = new Map();
  errorGps = null;
  resultadoAsiento = 'asentado';
});

describe('derivarJornadas — el reloj de la corrida', () => {
  it('con `venceEn` YA VENCIDO no asienta nada y lo cuenta todo como cortado', async () => {
    // La prueba de que el motor CONSULTA el reloj, no solo lo recibe: sin la
    // consulta barrería la lista entera hasta que Vercel lo matara a media
    // escritura, y el latido nunca se escribiría.
    viajes = [viaje(1, 'op-a', 'u-1'), viaje(2, 'op-b', 'u-2'), viaje(3, 'op-c', 'u-3')];
    const r = await derivarJornadas({ ahora: AHORA, venceEn: Date.now() - 1_000 });

    expect(r.revisados).toBe(3);
    expect(r.cortadosPorReloj).toBe(3);
    expect(r.asentados).toBe(0);
    // El corte va ANTES de tocar un par (operador, día), nunca a medias: lo que
    // no alcanzó queda intacto y la corrida siguiente lo encabeza.
    expect(asegurarDiaJornada).not.toHaveBeenCalled();
    expect(asentarMarca).not.toHaveBeenCalled();
  });

  it('con `venceEn` futuro no corta nada y sí asienta', async () => {
    viajes = [viaje(1, 'op-a', 'u-1')];
    posiciones.set(`u-1|${DIA}`, [`${DIA}T14:00:00.000Z`, `${DIA}T23:00:00.000Z`]);
    const r = await derivarJornadas({ ahora: AHORA, venceEn: Date.now() + 60_000 });

    expect(r.cortadosPorReloj).toBe(0);
    // Tres marcas: el inicio derivado del hito de aceptación, y las dos puntas
    // del GPS de la unidad.
    expect(r.asentados).toBe(3);
    expect(r.fallos).toEqual([]);
  });

  it('sin `venceEn` el motor NO corta — el reloj es del llamador, no del motor', async () => {
    viajes = [viaje(1, 'op-a', null)];
    const r = await derivarJornadas({ ahora: AHORA });
    expect(r.cortadosPorReloj).toBe(0);
    expect(r.asentados).toBe(1);
  });
});

describe('derivarJornadas — la ventana que no cupo', () => {
  it('`listaTruncada` es true al TOCAR el tope, y se mide sobre los viajes crudos', async () => {
    // Los `TOPE` viajes son del MISMO operador y el MISMO día: deduplican a un
    // solo expediente. La truncación se mide sobre la CONSULTA —que sí se
    // recortó—, no sobre la lista de trabajo ya deduplicada.
    viajes = Array.from({ length: TOPE_VIAJES_POR_CORRIDA }, (_, i) => viaje(i, 'op-a', null));
    const r = await derivarJornadas({ ahora: AHORA, venceEn: Date.now() + 60_000 });

    expect(r.listaTruncada).toBe(true);
    expect(r.revisados).toBe(1);
    // WARN, no info: es una corrida que no barrió su ventana.
    expect(logger.warn).toHaveBeenCalledWith('jornada.derivar.lista_truncada', expect.anything());
  });

  it('`listaTruncada` es false cuando la consulta trajo MENOS que el tope', async () => {
    viajes = Array.from({ length: TOPE_VIAJES_POR_CORRIDA - 1 }, (_, i) => viaje(i, `op-${i}`, null));
    const r = await derivarJornadas({ ahora: AHORA, venceEn: Date.now() + 60_000 });
    expect(r.listaTruncada).toBe(false);
  });
});

describe('derivarJornadas — la lista de trabajo ilegible', () => {
  it('LANZA en vez de devolver ceros: un cero se leería como «no había nada que hacer»', async () => {
    errorViajes = { message: 'la base no contestó' };
    await expect(derivarJornadas({ ahora: AHORA })).rejects.toThrow(/no se pudo leer la lista de trabajo/);
    // Y no toca el expediente de nadie con la base en ese estado.
    expect(asegurarDiaJornada).not.toHaveBeenCalled();
  });
});

describe('derivarJornadas — un expediente por (tenant, operador, día)', () => {
  it('dos viajes del mismo operador el mismo día producen UN solo expediente', async () => {
    viajes = [viaje(1, 'op-a', 'u-1', '13:00'), viaje(2, 'op-a', 'u-1', '20:00')];
    const r = await derivarJornadas({ ahora: AHORA, venceEn: Date.now() + 60_000 });

    expect(r.revisados).toBe(1);
    expect(asegurarDiaJornada).toHaveBeenCalledTimes(1);
    expect(asegurarDiaJornada).toHaveBeenCalledWith(T, 'op-a', DIA);
  });

  it('dos operadores distintos el mismo día son DOS expedientes', async () => {
    viajes = [viaje(1, 'op-a', null), viaje(2, 'op-b', null)];
    const r = await derivarJornadas({ ahora: AHORA, venceEn: Date.now() + 60_000 });
    expect(r.revisados).toBe(2);
    expect(asegurarDiaJornada).toHaveBeenCalledTimes(2);
  });

  it('el expediente que no se pudo abrir es un fallo con nombre, y no detiene a los demás', async () => {
    asegurarDiaJornada.mockResolvedValueOnce({ error: 'se cayó' });
    viajes = [viaje(1, 'op-a', null), viaje(2, 'op-b', null)];
    const r = await derivarJornadas({ ahora: AHORA, venceEn: Date.now() + 60_000 });

    expect(r.fallos).toHaveLength(1);
    expect(r.fallos[0]).toContain('op-a');
    expect(r.asentados).toBe(1);   // el segundo operador sí se derivó
  });
});

describe('derivarJornadas — la marca que ya estaba', () => {
  it('`ya_estaba` cuenta como `yaEstaban`, NUNCA como fallo', async () => {
    // Es el índice único de la 0241 haciendo su trabajo: el operador ya había
    // declarado su marca y la derivada rebota. Contarlo como fallo pondría el
    // cron en rojo justo cuando la precedencia del declarado funcionó.
    resultadoAsiento = 'ya_estaba';
    viajes = [viaje(1, 'op-a', 'u-1')];
    posiciones.set(`u-1|${DIA}`, [`${DIA}T14:00:00.000Z`, `${DIA}T23:00:00.000Z`]);
    const r = await derivarJornadas({ ahora: AHORA, venceEn: Date.now() + 60_000 });

    expect(r.yaEstaban).toBe(3);
    expect(r.asentados).toBe(0);
    expect(r.fallos).toEqual([]);
  });

  it('un `fallo` de escritura sí se cuenta como fallo', async () => {
    resultadoAsiento = 'fallo';
    viajes = [viaje(1, 'op-a', null)];
    const r = await derivarJornadas({ ahora: AHORA, venceEn: Date.now() + 60_000 });
    expect(r.fallos).toHaveLength(1);
    expect(r.yaEstaban).toBe(0);
  });
});

describe('derivarJornadas — el día sin GPS', () => {
  it('unidad asignada y CERO posiciones sube `diasSinGps`, y no inventa una marca', async () => {
    // «No hubo de dónde derivar» no es «no hubo jornada»: se cuenta y se dice.
    viajes = [viaje(1, 'op-a', 'u-1')];
    posiciones = new Map();   // la unidad no reportó una sola posición ese día
    const r = await derivarJornadas({ ahora: AHORA, venceEn: Date.now() + 60_000 });

    expect(r.diasSinGps).toBe(1);
    // Solo la marca del hito de aceptación: del GPS no salió ninguna.
    expect(r.asentados).toBe(1);
    expect(r.fallos).toEqual([]);
  });

  it('varios días sin GPS se suman, uno por par (operador, día)', async () => {
    viajes = [viaje(1, 'op-a', 'u-1'), viaje(2, 'op-b', 'u-2')];
    const r = await derivarJornadas({ ahora: AHORA, venceEn: Date.now() + 60_000 });
    expect(r.diasSinGps).toBe(2);
  });

  it('un viaje SIN unidad no cuenta como día sin GPS: no había unidad que consultar', async () => {
    viajes = [viaje(1, 'op-a', null)];
    const r = await derivarJornadas({ ahora: AHORA, venceEn: Date.now() + 60_000 });
    expect(r.diasSinGps).toBe(0);
    expect(r.asentados).toBe(1);
  });

  it('el GPS ilegible es un fallo con nombre — no se confunde con «no hubo posiciones»', async () => {
    errorGps = { message: 'la base no contestó' };
    viajes = [viaje(1, 'op-a', 'u-1')];
    const r = await derivarJornadas({ ahora: AHORA, venceEn: Date.now() + 60_000 });

    expect(r.diasSinGps).toBe(0);
    expect(r.fallos).toHaveLength(1);
    expect(r.fallos[0]).toContain('gps u-1');
  });

  it('una sola posición en el día da inicio y NO un fin igual al inicio', async () => {
    // Un fin idéntico al inicio se leería como una jornada de cero minutos —
    // una afirmación sobre la jornada del trabajador que nadie hizo.
    viajes = [viaje(1, 'op-a', 'u-1')];
    posiciones.set(`u-1|${DIA}`, [`${DIA}T14:00:00.000Z`]);
    const r = await derivarJornadas({ ahora: AHORA, venceEn: Date.now() + 60_000 });

    expect(r.asentados).toBe(2);   // hito + primera posición, sin fin
    const tipos = asentarMarca.mock.calls.map((c) => (c[0] as { tipo: string }).tipo);
    expect(tipos).not.toContain('fin_jornada');
  });
});
