import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LA VIGILANCIA NORMATIVA (diaria 13:30 UTC) — el contrato de la RUTA. Las reglas de barrido, cruce anti-silencio,
// dedup, SAT y leyes viven en `lib/likida/normas/vigilancia/vigilancia.test.ts`; aquí se fija lo que solo decide la
// ruta: la puerta, fallar cerrado, el latido en CADA camino de salida arrastrando el estado, y qué escala a correo.
// El `fetch` es un doble con la forma real del SIDOF; el reloj está congelado (lunes 16-nov-2026 08:00 CDMX).
// ═══════════════════════════════════════════════════════════════════════════

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

let avisoSale = true;
const alertarOperador = vi.fn(async (..._a: unknown[]) => avisoSale);
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: (...a: unknown[]) => alertarOperador(...a) }));

const registrarLatido = vi.fn(async (..._a: unknown[]) => {});
let latidoPrevio: { ultimoLatido: string; estado: string; detalle: Record<string, unknown> } | null = null;
let lecturaFalla = false;
const leerLatido = vi.fn(async (_c: string) => { if (lecturaFalla) throw new Error('connection refused'); return latidoPrevio; });
vi.mock('@/lib/admin/salud', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin/salud')>()),
  registrarLatido: (...a: unknown[]) => registrarLatido(...a),
  leerLatido: (c: string) => leerLatido(c),
}));

let interruptor: 'encendido' | 'apagado' | 'ilegible' = 'encendido';
const leerInterruptor = vi.fn(async (_n: string) => interruptor);
vi.mock('@/lib/likida/interruptores', () => ({ leerInterruptor: (n: string) => leerInterruptor(n) }));

let anular: (() => Promise<never>) | null = null;
vi.mock('@/lib/likida/normas/vigilancia/ejecutar', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/likida/normas/vigilancia/ejecutar')>();
  return { ...real, ejecutarVigilancia: (...a: Parameters<typeof real.ejecutarVigilancia>) => (anular ? anular() : real.ejecutarVigilancia(...a)) };
});

process.env.CRON_SECRET = 'secreto-de-prueba';
const { GET } = await import('./route');

const peticion = (auth?: string) => new Request('http://likida.test/api/cron/vigilancia-normativa', { headers: auth ? { authorization: auth } : {} }) as never;
const OK = 'Bearer secreto-de-prueba';

type Item = { codNota: number; titulo?: string };
/** Un `fetch` doble con la forma real del SIDOF. `dias`: fecha ISO → notas de la matutina (vacío = día sin DOF). */
function sidof(dias: Record<string, Item[]>) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    const mD = /\/diarios\/porFecha\/(\d{2})-(\d{2})-(\d{4})$/.exec(url);
    const mN = /\/notas\/(\d{2})-(\d{2})-(\d{4})$/.exec(url);
    const m = mD ?? mN;
    if (!m) return new Response(null, { status: 404 });
    const mat = dias[`${m[3]}-${m[2]}-${m[1]}`] ?? [];
    if (mD) {
      return mat.length === 0
        ? new Response(JSON.stringify({ messageCode: 404, response: 'NOT_FOUND' }), { status: 404 })
        : new Response(JSON.stringify({ messageCode: 200, response: 'OK', Extraordinaria: null, Vespertina: null, Matutina: [{ codDiario: 1 }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ messageCode: 200, response: 'OK', NotasExtraordinarias: [], NotasVespertinas: [], NotasMatutinas: mat, imagenesDiario: [], audioSumario: [] }), { status: 200 });
  });
}

/** El estado que dejó la corrida anterior (el que `registrarLatido` guardó), con lo semanal y trimestral al día. */
function conEstado(extra: Record<string, unknown> = {}) {
  latidoPrevio = {
    ultimoLatido: '2026-11-15T13:30:00Z', estado: 'ok',
    detalle: { vigilancia: { ultimoDiaBarrido: '2026-11-13', vistos: [], pendientes: [], sat: {}, leyes: {}, ultimoSemanal: '2026-11-16', ultimoTrimestral: '2026-10', retenido: null, diasSinEdicion: [], fallosSeguidos: 0, ...extra } },
  };
}

const ultimoLatido = () => registrarLatido.mock.calls.at(-1) as [string, string, Record<string, unknown>];

let fetchDoble: ReturnType<typeof sidof>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-16T14:00:00Z'));
  interruptor = 'encendido'; anular = null; avisoSale = true; lecturaFalla = false; latidoPrevio = null;
  fetchDoble = sidof({});
  vi.stubGlobal('fetch', fetchDoble);
  alertarOperador.mockClear(); registrarLatido.mockClear(); leerInterruptor.mockClear(); leerLatido.mockClear();
  for (const f of Object.values(logger)) f.mockReset();
  process.env.CRON_SECRET = 'secreto-de-prueba';
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('GET /api/cron/vigilancia-normativa — la puerta', () => {
  it('sin CRON_SECRET: 500, ni un fetch, y el latido «fallo» con su causa', async () => {
    delete process.env.CRON_SECRET;
    conEstado();
    const res = await GET(peticion(OK));
    expect(res.status).toBe(500);
    expect(fetchDoble).not.toHaveBeenCalled();
    expect(leerInterruptor).not.toHaveBeenCalled();
    const [cron, estado, detalle] = ultimoLatido();
    expect([cron, estado, detalle.codigo]).toEqual(['vigilancia-normativa', 'fallo', 'cron_sin_secreto']);
    // El estado viaja intacto: un latido de fallo no puede borrar el cursor.
    expect((detalle.vigilancia as { ultimoDiaBarrido: string }).ultimoDiaBarrido).toBe('2026-11-13');
  });

  it('bearer equivocado o ausente: 401 sin cuerpo, sin escribir latido ni tocar la red', async () => {
    for (const auth of [undefined, 'Bearer otro']) {
      const res = await GET(peticion(auth));
      expect(res.status).toBe(401);
      expect(await res.text()).toBe('');
    }
    expect(registrarLatido).not.toHaveBeenCalled();
    expect(leerInterruptor).not.toHaveBeenCalled();
    expect(fetchDoble).not.toHaveBeenCalled();
  });
});

describe('GET /api/cron/vigilancia-normativa — fallar cerrado, con latido en cada salida', () => {
  it('interruptor ILEGIBLE: 500, latido «fallo» con el estado arrastrado y ni un fetch', async () => {
    conEstado(); interruptor = 'ilegible';
    const res = await GET(peticion(OK));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ corrio: false, codigo: 'interruptor_ilegible', interruptor: 'global' });
    const [, estado, detalle] = ultimoLatido();
    expect(estado).toBe('fallo');
    expect(detalle).toMatchObject({ codigo: 'interruptor_ilegible', ultimo_dia_barrido: '2026-11-13' });
    expect(fetchDoble).not.toHaveBeenCalled();
  });

  it('interruptor APAGADO: no corre; el latido dice «saltado» y conserva el cursor y los avisos pendientes', async () => {
    conEstado({ pendientes: [{ tipo: 'dof', codNota: 5, linea: 'pendiente' }] }); interruptor = 'apagado';
    const res = await GET(peticion(OK));
    expect(await res.json()).toEqual({ corrio: false, saltado: 'interruptor global' });
    const [, estado, detalle] = ultimoLatido();
    expect(estado).toBe('saltado');
    expect(detalle).toMatchObject({ interruptor: 'global', ultimo_dia_barrido: '2026-11-13' });
    expect((detalle.vigilancia as { pendientes: unknown[] }).pendientes).toHaveLength(1);
    expect(fetchDoble).not.toHaveBeenCalled();
    expect(alertarOperador).not.toHaveBeenCalled();
  });

  it('no puede leer su estado (cron_latido): 500, latido «fallo» y NO barre a ciegas', async () => {
    lecturaFalla = true;
    const res = await GET(peticion(OK));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ codigo: 'latido_ilegible' });
    expect(ultimoLatido()[1]).toBe('fallo');
    expect(fetchDoble).not.toHaveBeenCalled();
  });

  it('una excepción inesperada: 500, correo, y el latido «fallo» conserva el estado', async () => {
    conEstado();
    anular = async () => { throw new Error('boom'); };
    const res = await GET(peticion(OK));
    expect(res.status).toBe(500);
    expect(alertarOperador).toHaveBeenCalledWith('cron.vigilancia-normativa', expect.objectContaining({ error: 'boom' }));
    const [, estado, detalle] = ultimoLatido();
    expect(estado).toBe('fallo');
    expect(detalle.ultimo_dia_barrido).toBe('2026-11-13');
  });
});

describe('GET /api/cron/vigilancia-normativa — la corrida', () => {
  it('solo fin de semana sin DOF: latido «ok» y cursor a ayer, pero NO se afirma «sin cambios» (no se leyó ninguna nota)', async () => {
    conEstado(); // cursor 13-nov; faltan sábado 14 y domingo 15, ambos sin edición (diarios 404, notas vacías)
    const res = await GET(peticion(OK));
    const cuerpo = await res.json();
    expect(res.status).toBe(200);
    expect(cuerpo).toMatchObject({ corrio: true, estado: 'ok', ultimoDiaBarrido: '2026-11-15', notas_revisadas: 0, sinCambios: false, nuevos: [] });
    expect(alertarOperador).not.toHaveBeenCalled();
  });

  it('hallazgo nuevo: correo único, latido «ok», codNota en vistos y pendientes vacíos', async () => {
    conEstado({ ultimoDiaBarrido: '2026-11-12' });
    fetchDoble = sidof({
      '2026-11-13': [{ codNota: 5803757, titulo: 'Decreto por el que se expide la Ley de Ingresos de la Federación para el Ejercicio Fiscal de 2027.' }, { codNota: 5803756 }],
      '2026-11-14': [], '2026-11-15': [],
    });
    vi.stubGlobal('fetch', fetchDoble);
    const res = await GET(peticion(OK));
    const cuerpo = await res.json();
    expect(cuerpo).toMatchObject({ corrio: true, estado: 'ok', ultimoDiaBarrido: '2026-11-15', notas_sin_titulo: 1, disparadores: 1, avisoSalio: true, sinCambios: false });
    expect(alertarOperador).toHaveBeenCalledTimes(1);
    const [evento, detalle] = alertarOperador.mock.calls[0] as [string, Record<string, string>];
    expect(evento).toBe('cron.vigilancia-normativa.hallazgos');
    expect(detalle.aviso_01).toContain('sidofqa.segob.gob.mx/dof/sidof/notas/nota/5803757');
    expect(detalle.aviso_01).toContain('Ley de Ingresos');
    expect(detalle.aviso_01).toContain('lif-2026-20-A.yaml');
    expect(detalle.aviso_01).not.toContain('nota_detalle');
    expect(detalle.aviso_02).toBeUndefined(); // un solo hallazgo = una sola línea; un solo correo por corrida
    const [cron, estado, latido] = ultimoLatido();
    expect([cron, estado]).toEqual(['vigilancia-normativa', 'ok']);
    expect(latido).toMatchObject({ ultimo_dia_barrido: '2026-11-15', notas_revisadas: 2, disparadores: 1 });
    const v = latido.vigilancia as { vistos: number[]; pendientes: unknown[] };
    expect(v.vistos).toEqual([5803757]);
    expect(v.pendientes).toEqual([]);
  });

  it('el correo no salió (sin canal o piso): el aviso se queda pendiente, el latido es «parcial» y mañana se reintenta', async () => {
    conEstado({ ultimoDiaBarrido: '2026-11-12' }); avisoSale = false;
    fetchDoble = sidof({ '2026-11-13': [{ codNota: 77, titulo: 'Nota Aclaratoria a la Resolución Miscelánea Fiscal' }], '2026-11-14': [], '2026-11-15': [] });
    vi.stubGlobal('fetch', fetchDoble);
    const cuerpo = await (await GET(peticion(OK))).json();
    expect(cuerpo).toMatchObject({ estado: 'parcial', avisoSalio: false, sinCambios: false });
    const [, estado, latido] = ultimoLatido();
    expect(estado).toBe('parcial');
    const v = latido.vigilancia as { vistos: number[]; pendientes: Array<{ codNota: number }> };
    expect(v.vistos).toEqual([]);
    expect(v.pendientes.map((p) => p.codNota)).toEqual([77]);
    expect(latido.avisos_pendientes).toBe(1);
  });

  it('día sin coincidencias pero con notas leídas: «sin cambios» legítimo, sin correo, latido «ok»', async () => {
    conEstado({ ultimoDiaBarrido: '2026-11-12' });
    fetchDoble = sidof({ '2026-11-13': [{ codNota: 1, titulo: 'Convocatoria de licitación pública' }], '2026-11-14': [], '2026-11-15': [] });
    vi.stubGlobal('fetch', fetchDoble);
    const cuerpo = await (await GET(peticion(OK))).json();
    expect(cuerpo).toMatchObject({ estado: 'ok', sinCambios: true, notas_revisadas: 1 });
    expect(alertarOperador).not.toHaveBeenCalled();
  });

  it('SIDOF «vacío» un día hábil: latido «fallo» con causa, cursor sin avanzar y NUNCA «sin cambios»', async () => {
    conEstado({ ultimoDiaBarrido: '2026-11-12' });
    fetchDoble = sidof({}); // todo vacío, incluido el viernes 13
    vi.stubGlobal('fetch', fetchDoble);
    const cuerpo = await (await GET(peticion(OK))).json();
    expect(cuerpo).toMatchObject({ estado: 'fallo', ultimoDiaBarrido: '2026-11-12', sinCambios: false, codigo: 'dia_habil_sin_notas' });
    const [, estado, latido] = ultimoLatido();
    expect(estado).toBe('fallo');
    expect(latido.codigo).toBe('dia_habil_sin_notas');
    expect(latido.ultimo_dia_barrido).toBe('2026-11-12');
    expect(alertarOperador).not.toHaveBeenCalled(); // una sola mañana con fallo no molesta; la tercera sí
  });

  it('tres corridas seguidas con fallo de la fuente: sí escala a correo', async () => {
    conEstado({ ultimoDiaBarrido: '2026-11-12', fallosSeguidos: 2, retenido: null });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('getaddrinfo ENOTFOUND'); }));
    const res = await GET(peticion(OK));
    expect((await res.json()).sinCambios).toBe(false);
    expect(alertarOperador).toHaveBeenCalledWith('cron.vigilancia-normativa', expect.objectContaining({ codigo: 'vigilancia_fuente_fallo' }));
    expect(ultimoLatido()[1]).toBe('fallo');
    expect(ultimoLatido()[2].ultimo_dia_barrido).toBe('2026-11-12');
  });

  it('sale a la red como un cliente identificado: User-Agent genérico, timeout, solo SIDOF/SAT/diputados y jamás dof.gob.mx', async () => {
    conEstado({ ultimoDiaBarrido: '2026-11-12', ultimoSemanal: null });
    await GET(peticion(OK));
    expect(fetchDoble.mock.calls.length).toBeGreaterThan(0);
    for (const [url, init] of fetchDoble.mock.calls) {
      expect(url).toMatch(/^https:\/\/(sidofqa\.segob\.gob\.mx|www\.sat\.gob\.mx|www\.diputados\.gob\.mx)\//);
      expect((init as { headers: Record<string, string> }).headers['User-Agent']).toBe('LikidaVigilancia/1.0 (+https://likida.ai)');
      expect((init as { signal: unknown }).signal).toBeInstanceOf(AbortSignal);
    }
    expect(fetchDoble.mock.calls.length).toBeLessThanOrEqual(25);
  });

  it('nunca escribe en las fichas: la ruta no importa nada del cargador ni del escritor de normas', async () => {
    const { readFileSync } = await import('node:fs');
    const fuentes = ['src/app/api/cron/vigilancia-normativa/route.ts', ...['ejecutar', 'dof', 'estado', 'aviso', 'http', 'disparadores', 'fechas'].map((f) => `src/lib/likida/normas/vigilancia/${f}.ts`)].map((p) => readFileSync(p, 'utf8')).join('\n');
    expect(fuentes).not.toMatch(/writeFile|appendFile|estado_verificacion\s*[:=]|supabaseAdmin/);
  });
});
