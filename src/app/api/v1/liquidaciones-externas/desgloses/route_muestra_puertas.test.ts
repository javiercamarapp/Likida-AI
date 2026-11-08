import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BITACORA_MUESTRA, PADRON_MUESTRA } from '@/lib/likida/liquidacion_externa/desglose_muestra_tms.fixture';

// R7-B3 · LIKIDA_TMS_MUESTRA con la habilitación REAL (`muestraTmsHabilitada` sin simular): bandera, los dos interruptores y el envío por
// correo de la flota; los topes (100 bitácoras, 100 renglones por bloque, 2 MB); el tenant sale de la llave. Sin Postgres: lo que toca la
// base (interruptores, config de envío, padrón, recepción, bandeja) se sustituye por dobles. `route_muestra.test.ts` cubre el resto
// del comportamiento con la habilitación simulada.

const abrir = vi.fn(async (): Promise<Record<string, unknown>> => ({ ok: true, tenantId: 't-1', rol: 'llave:administracion' }));
vi.mock('@/app/api/v1/_comun', async (orig) => ({ ...((await orig()) as Record<string, unknown>), abrir: () => abrir() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => { throw new Error('sin base en pruebas'); } }) }));

const interruptores: Record<string, 'encendido' | 'apagado' | 'ilegible'> = {};
vi.mock('@/lib/likida/interruptores', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  leerInterruptor: async (n: string) => interruptores[n] ?? 'apagado',
}));
let config: { ok: true; valor: { activa: boolean; canal: string } } | { ok: false } | 'lanza' = { ok: true, valor: { activa: true, canal: 'correo' } };
vi.mock('@/lib/likida/liquidacion_externa/repo_correo', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  leerConfigCorreo: async () => { if (config === 'lanza') throw new Error('base caída'); return config; },
  abrirExcepcion: (...a: unknown[]) => excepcion(...a),
  listarExcepciones: async () => ({ ok: true, valor: [] }),
  resolverExcepcion: async () => true,
}));
const excepcion = vi.fn(async (..._a: unknown[]) => ({ id: 1, nueva: true }));
const recibir = vi.fn(async (_t: string, d: { bitacora: string }, ..._r: unknown[]) => ({ estado: 'sin_poliza', claveExterna: `BIT-${d.bitacora}` }));
vi.mock('@/lib/likida/liquidacion_externa/desglose_recibir', () => ({ recibirDesglose: (...a: [string, { bitacora: string }, ...unknown[]]) => recibir(...a) }));
const padron = vi.fn(async (_t: string) => PADRON_MUESTRA as unknown as Array<{ numeroEmpleado: string; nombre: string }>);
vi.mock('@/lib/likida/liquidacion_externa/repo', async (orig) => ({ ...((await orig()) as Record<string, unknown>), leerPadronOperadores: (t: string) => padron(t) }));

const { POST } = await import('./route');
const postear = (c: unknown) => POST(new Request('https://app.likida.ai/api/v1/liquidaciones-externas/desgloses',
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof c === 'string' ? c : JSON.stringify(c) }));
const json = async (r: Response) => (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const sobre = (b: unknown[]) => ({ formato: 'muestra-tms', version: 1, bitacoras: b });
/** Un 400 de validación: no se recibió ni se abrió nada (leer el padrón es solo lectura y la ruta lo hace antes de validar el sobre). */
const sinEscrituras = () => { expect(recibir).not.toHaveBeenCalled(); expect(excepcion).not.toHaveBeenCalled(); };
const sinEfectos = () => { expect(padron).not.toHaveBeenCalled(); expect(recibir).not.toHaveBeenCalled(); expect(excepcion).not.toHaveBeenCalled(); };

beforeEach(() => {
  for (const f of [recibir, padron, excepcion, abrir]) f.mockClear();
  abrir.mockResolvedValue({ ok: true, tenantId: 't-1', rol: 'llave:administracion' });
  interruptores.global = 'encendido'; interruptores['agente:liquidacion'] = 'encendido';
  config = { ok: true, valor: { activa: true, canal: 'correo' } };
  vi.stubEnv('LIKIDA_TMS_MUESTRA', 'si');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('muestra-tms · cada capa de la habilitación, SIN simular, niega con 403 y no toca nada', () => {
  it('bandera de plataforma apagada (sin variable, vacía o con otro valor) ⇒ 403 aunque todo lo demás esté encendido', async () => {
    for (const v of ['', 'no', 'true', '1']) {
      vi.stubEnv('LIKIDA_TMS_MUESTRA', v);
      const r = await postear(sobre([BITACORA_MUESTRA]));
      expect(r.status, `valor «${v}»`).toBe(403);
    }
    vi.unstubAllEnvs();
    delete process.env.LIKIDA_TMS_MUESTRA;
    expect((await postear(sobre([BITACORA_MUESTRA]))).status).toBe(403);
    sinEfectos();
  });

  it.each([
    ['interruptor global apagado', () => { interruptores.global = 'apagado'; }],
    ['interruptor agente:liquidacion apagado', () => { interruptores['agente:liquidacion'] = 'apagado'; }],
    ['interruptor ilegible', () => { interruptores.global = 'ilegible'; }],
    ['envío de la flota sin activar', () => { config = { ok: true, valor: { activa: false, canal: 'correo' } }; }],
    ['canal que no es correo', () => { config = { ok: true, valor: { activa: true, canal: 'whatsapp' } }; }],
    ['configuración ilegible', () => { config = { ok: false }; }],
    ['la lectura de la configuración lanza', () => { config = 'lanza'; }],
  ])('%s ⇒ 403 y sin padrón, recepción ni bandeja', async (_n, apagar) => {
    apagar();
    const r = await postear(sobre([BITACORA_MUESTRA]));
    expect(r.status).toBe(403);
    expect(JSON.stringify(await json(r))).not.toMatch(/bandera|LIKIDA_|interruptor|agente:/i);
    sinEfectos();
  });

  it('con todo encendido: 200 y llega a recibirDesglose', async () => {
    const r = await postear(sobre([BITACORA_MUESTRA]));
    expect(r.status).toBe(200);
    expect(recibir).toHaveBeenCalledTimes(1);
  });
});

describe('muestra-tms · topes (400 y no se procesa NADA)', () => {
  const bitacora = (i: number) => ({ ...BITACORA_MUESTRA, BitacoraID: 900_000 + i });

  it('100 bitácoras entran; 101 son 400', async () => {
    expect((await postear(sobre(Array.from({ length: 100 }, (_, i) => bitacora(i))))).status).toBeLessThan(300);
    expect(recibir).toHaveBeenCalledTimes(100);
    recibir.mockClear(); padron.mockClear(); excepcion.mockClear();
    const r = await postear(sobre(Array.from({ length: 101 }, (_, i) => bitacora(i))));
    expect(r.status).toBe(400);
    sinEscrituras();
  });

  it('101 renglones en un bloque son 400 (Percepciones y Deducciones), 100 sí pasan', async () => {
    const renglones = (n: number) => Array.from({ length: n }, (_, i) => ({ Descripcion: 'Bono de puntualidad', Monto: 1 + i % 3 }));
    expect((await postear(sobre([{ ...BITACORA_MUESTRA, Percepciones: renglones(101) }]))).status).toBe(400);
    expect((await postear(sobre([{ ...BITACORA_MUESTRA, Deducciones: renglones(101) }]))).status).toBe(400);
    sinEscrituras();
    expect((await postear(sobre([{ ...BITACORA_MUESTRA, Percepciones: renglones(100), Deducciones: [] }]))).status).toBeLessThan(500);
  });

  it('un cuerpo de más de 2 MB es 400 sin procesar nada; uno justo por debajo del tope no lo corta el tope', async () => {
    const enorme = sobre([{ ...BITACORA_MUESTRA, Relleno: 'x'.repeat(2_100_000) }]);
    const r = await postear(enorme);
    expect(r.status).toBe(400);
    expect(JSON.stringify(await json(r))).toMatch(/2000000|bytes/);
    sinEscrituras();
    const casi = await postear(sobre([{ ...BITACORA_MUESTRA, Relleno: 'x'.repeat(1_900_000) }]));
    expect(casi.status).toBe(200); // el campo extra se ignora
  });
});

describe('muestra-tms · el tenant sale de la llave y jamás del cuerpo', () => {
  it('un tenant escrito dentro de una bitácora o en el sobre no cambia la flota', async () => {
    abrir.mockResolvedValue({ ok: true, tenantId: 't-llave', rol: 'llave:administracion' });
    const r = await postear(sobre([{ ...BITACORA_MUESTRA, tenant_id: 't-ajeno', tenantId: 't-ajeno' }]));
    expect(r.status).toBe(200);
    expect(padron).toHaveBeenCalledWith('t-llave');
    expect(recibir.mock.calls.every((c) => c[0] === 't-llave')).toBe(true);
    expect(JSON.stringify(recibir.mock.calls)).not.toContain('t-ajeno');
    expect((await postear({ ...sobre([BITACORA_MUESTRA]), tenant_id: 't-ajeno' })).status).toBe(400);
  });
  it('si la llave no abre, nada se lee ni se evalúa', async () => {
    abrir.mockResolvedValue({ ok: false, respuesta: new Response('no', { status: 401 }) });
    expect((await postear(sobre([BITACORA_MUESTRA]))).status).toBe(401);
    sinEfectos();
  });
});
