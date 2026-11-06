import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BITACORA_MUESTRA, PADRON_MUESTRA } from '@/lib/likida/liquidacion_externa/desglose_muestra_tms.fixture';

// POST …/desgloses con el formato «muestra-tms» (contrato SUPUESTO hasta la especificación oficial). Datos sintéticos.
//   1. Apagado por defecto: sin habilitación es 403 y no se lee padrón, ni se recibe, ni se abre nada.
//   2. Habilitado: lo seguro entra a `recibirDesglose` (sistemaOrigen propio); lo dudoso queda en revisión y NO se recibe.
//   3. Tenant ajeno: el padrón y las excepciones salen SIEMPRE del tenant de la credencial.
//   4. El formato interno sigue igual (sin `enRevision`, sin tocar padrón ni habilitación).

const abrir = vi.fn(async (): Promise<Record<string, unknown>> => ({ ok: true, tenantId: 't-1', rol: 'llave:administracion' }));
vi.mock('@/app/api/v1/_comun', async (orig) => ({ ...((await orig()) as Record<string, unknown>), abrir: () => abrir() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => { throw new Error('sin base en pruebas'); } }) }));

const recibir = vi.fn(async (_t: string, d: { bitacora: string }, ..._r: unknown[]) => ({ estado: 'sin_poliza', claveExterna: `BIT-${d.bitacora}` }));
vi.mock('@/lib/likida/liquidacion_externa/desglose_recibir', () => ({ recibirDesglose: (...a: [string, { bitacora: string }, ...unknown[]]) => recibir(...a) }));
const padron = vi.fn(async (_t: string) => PADRON_MUESTRA as unknown as Array<{ numeroEmpleado: string; nombre: string }>);
vi.mock('@/lib/likida/liquidacion_externa/repo', async (orig) => ({ ...((await orig()) as Record<string, unknown>), leerPadronOperadores: (t: string) => padron(t) }));
const excepcion = vi.fn(async (..._a: unknown[]) => ({ id: 1, nueva: true }));
vi.mock('@/lib/likida/liquidacion_externa/repo_correo', async (orig) => ({ ...((await orig()) as Record<string, unknown>), abrirExcepcion: (...a: unknown[]) => excepcion(...a) }));
const habilitada = vi.fn(async (_t: string): Promise<{ ok: boolean; motivo?: string }> => ({ ok: true }));
vi.mock('@/lib/likida/liquidacion_externa/desglose_muestra_recepcion', async (orig) => ({ ...((await orig()) as Record<string, unknown>), muestraTmsHabilitada: (t: string) => habilitada(t) }));

const { POST } = await import('./route');
const postear = (c: unknown) => POST(new Request('https://app.likida.ai/api/v1/liquidaciones-externas/desgloses',
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c) }));
const json = async (r: Response) => (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const sobre = (b: unknown[]) => ({ formato: 'muestra-tms', version: 1, bitacoras: b });

beforeEach(() => {
  for (const f of [recibir, padron, excepcion, habilitada]) f.mockClear();
  abrir.mockResolvedValue({ ok: true, tenantId: 't-1', rol: 'llave:administracion' });
  habilitada.mockResolvedValue({ ok: true });
});

describe('muestra-tms · apagado por defecto', () => {
  it('sin habilitación: 403 y no se toca padrón, recepción ni bandeja', async () => {
    habilitada.mockResolvedValueOnce({ ok: false, motivo: 'bandera_apagada' });
    const r = await postear(sobre([BITACORA_MUESTRA]));
    expect(r.status).toBe(403);
    expect(JSON.stringify(await json(r))).not.toMatch(/bandera|LIKIDA_/);
    expect(padron).not.toHaveBeenCalled(); expect(recibir).not.toHaveBeenCalled(); expect(excepcion).not.toHaveBeenCalled();
  });
});

describe('muestra-tms · habilitado', () => {
  it('caso feliz: llega a recibirDesglose con el tenant de la credencial y su origen; queda sin_poliza', async () => {
    const r = await postear(sobre([BITACORA_MUESTRA]));
    expect(r.status).toBe(200);
    expect(padron).toHaveBeenCalledWith('t-1');
    expect(recibir).toHaveBeenCalledTimes(1);
    expect(recibir.mock.calls[0][0]).toBe('t-1');
    expect(recibir.mock.calls[0][1]).toMatchObject({ bitacora: '900001', operador: { numeroEmpleado: '1001' } });
    expect(recibir.mock.calls[0][3]).toMatchObject({ sistemaOrigen: 'tms-muestra-tms' });
    const d = (await json(r)).datos;
    expect(d.excepciones).toEqual([{ clave: 'BIT-900001', motivo: 'sin_poliza' }]);
    expect(d.enRevision).toEqual([]);
  });
  it('operador ausente y ambiguo: no se recibe, queda en revisión y en la bandeja del tenant', async () => {
    const r = await postear(sobre([{ ...BITACORA_MUESTRA, Operador: 'Nadie Ficticio' }, { ...BITACORA_MUESTRA, BitacoraID: 900002, Operador: 'Homónimo Ficticio' }]));
    expect(r.status).toBe(200);
    expect(recibir).not.toHaveBeenCalled();
    const d = (await json(r)).datos;
    expect(d.enRevision.map((x: { bitacora: string }) => x.bitacora)).toEqual(['900001', '900002']);
    expect(JSON.stringify(d)).not.toMatch(/Ficticio/);
    expect(excepcion.mock.calls.map((c) => [c[0], c[1], c[2]])).toEqual([
      ['t-1', 'BIT-900001', 'operador_no_encontrado'], ['t-1', 'BIT-900002', 'operador_no_encontrado']]);
  });
  it('tenant ajeno: el padrón se pide con el tenant de la credencial, aunque el cuerpo diga otro', async () => {
    abrir.mockResolvedValue({ ok: true, tenantId: 't-9', rol: 'llave:administracion' });
    padron.mockResolvedValueOnce([]);
    const r = await postear(sobre([BITACORA_MUESTRA]));
    expect(padron).toHaveBeenCalledWith('t-9');
    expect((await json(r)).datos.enRevision[0].motivos[0].codigo).toBe('operador_no_encontrado');
    expect(excepcion.mock.calls[0][0]).toBe('t-9');
    expect((await postear({ ...sobre([BITACORA_MUESTRA]), tenant_id: 't-1' })).status).toBe(400);
  });
  it('lote vacío y lote enorme: 400 sin procesar nada', async () => {
    expect((await postear(sobre([]))).status).toBe(400);
    expect((await postear(sobre(Array.from({ length: 101 }, (_, i) => ({ ...BITACORA_MUESTRA, BitacoraID: 1000 + i }))))).status).toBe(400);
    expect(recibir).not.toHaveBeenCalled(); expect(excepcion).not.toHaveBeenCalled();
  });
});

describe('formato interno intacto', () => {
  it('un desglose interno no pasa por la habilitación ni por el padrón y su respuesta no trae enRevision', async () => {
    const r = await postear({ terminal: 'T1', bitacora: 'B-0001', poliza: 'P-1', operador: { numeroEmpleado: '1001' }, unidad: '0001', tipoOperador: 'foraneo',
      desde: '2026-10-09', hasta: '2026-10-14', percepciones: [{ concepto: 'Sueldo', monto: 4000 }], deducciones: [{ concepto: 'Anticipo', monto: 1000 }], neto: 3000 });
    expect(r.status).toBe(200);
    expect(habilitada).not.toHaveBeenCalled(); expect(padron).not.toHaveBeenCalled();
    expect(recibir.mock.calls[0][3]).toMatchObject({ sistemaOrigen: 'desglose-bitacora-api' });
    expect(await json(r)).not.toHaveProperty('datos.enRevision');
  });
});
