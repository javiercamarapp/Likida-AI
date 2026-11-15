import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BITACORA_MUESTRA, PADRON_MUESTRA } from '@/lib/likida/liquidacion_externa/desglose_muestra_tms.fixture';

// POST …/desgloses (muestra-tms): sinónimos Cargo/Abono y `advertencias` por bitácora. Datos sintéticos.

const abrir = vi.fn(async (): Promise<Record<string, unknown>> => ({ ok: true, tenantId: 't-1', rol: 'llave:administracion' }));
vi.mock('@/app/api/v1/_comun', async (orig) => ({ ...((await orig()) as Record<string, unknown>), abrir: () => abrir() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => { throw new Error('sin base en pruebas'); } }) }));

const recibir = vi.fn(async (_t: string, d: { bitacora: string }, ..._r: unknown[]) => ({ estado: 'sin_poliza', claveExterna: `BIT-${d.bitacora}` }));
vi.mock('@/lib/likida/liquidacion_externa/desglose_recibir', () => ({ recibirDesglose: (...a: [string, { bitacora: string }, ...unknown[]]) => recibir(...a) }));
vi.mock('@/lib/likida/liquidacion_externa/repo', async (orig) => ({ ...((await orig()) as Record<string, unknown>), leerPadronOperadores: async () => PADRON_MUESTRA }));
const excepcion = vi.fn(async (..._a: unknown[]) => ({ id: 1, nueva: true }));
vi.mock('@/lib/likida/liquidacion_externa/repo_correo', async (orig) => ({ ...((await orig()) as Record<string, unknown>), abrirExcepcion: (...a: unknown[]) => excepcion(...a) }));
vi.mock('@/lib/likida/liquidacion_externa/desglose_muestra_recepcion', async (orig) => ({ ...((await orig()) as Record<string, unknown>), muestraTmsHabilitada: async () => ({ ok: true }) }));

const { POST } = await import('./route');
const postear = (c: unknown, cab: Record<string, string> = {}) => POST(new Request('https://app.likida.ai/api/v1/liquidaciones-externas/desgloses',
  { method: 'POST', headers: { 'content-type': 'application/json', ...cab }, body: JSON.stringify(c) }));
const json = async (r: Response) => (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const sobre = (b: unknown[]) => ({ formato: 'muestra-tms', version: 1, bitacoras: b });

const limpia = { ...BITACORA_MUESTRA } as Record<string, unknown>;
delete limpia.CampoExtraDesconocido;

beforeEach(() => { recibir.mockClear(); excepcion.mockClear(); });

describe('muestra-tms · Cargo/Abono por la ruta', () => {
  it('Cargo y Abono llegan a recibirDesglose con los mismos montos que Monto', async () => {
    const r = await postear(sobre([{
      ...limpia,
      Percepciones: [{ Descripcion: 'Sueldo semanal', Cargo: 4000 }],
      Deducciones: [{ Descripcion: 'Fonacot', Abono: 200.1 }],
    }]));
    expect(r.status).toBe(200);
    expect(recibir.mock.calls[0][1]).toMatchObject({
      percepciones: [{ concepto: 'Sueldo semanal', monto: 4000 }], deducciones: [{ concepto: 'Fonacot', monto: 200.1 }],
    });
    expect((await json(r)).datos.enRevision).toEqual([]);
  });

  it('Monto y Cargo distintos: en_revision con monto_ambiguo, no se recibe y no se echan valores', async () => {
    const r = await postear(sobre([{ ...limpia, Percepciones: [{ Descripcion: 'Sueldo semanal', Monto: 111.11, Cargo: 222.22 }] }]));
    expect(recibir).not.toHaveBeenCalled();
    const d = (await json(r)).datos;
    expect(d.resultados).toEqual([{ indice: 0, bitacora: '900001', estado: 'en_revision', motivos: [{ codigo: 'monto_ambiguo', campo: 'Percepciones[0].Monto' }] }]);
    expect(JSON.stringify(d)).not.toMatch(/111|222/);
  });

  it('sin sinónimos, un renglón sin Monto sigue en revisión con monto_nulo', async () => {
    const r = await postear(sobre([{ ...limpia, Percepciones: [{ Descripcion: 'Sueldo semanal' }] }]));
    expect((await json(r)).datos.resultados[0].motivos).toEqual([{ codigo: 'monto_nulo', campo: 'Percepciones[0].Monto' }]);
  });
});

describe('muestra-tms · advertencias por bitácora', () => {
  it('retrocompatible: la muestra limpia no trae la llave `advertencias` y el resto de la respuesta no cambia', async () => {
    const d = (await json(await postear(sobre([limpia])))).datos;
    expect(Object.keys(d.resultados[0]).sort()).toEqual(['bitacora', 'estado', 'indice', 'motivos']);
    expect(d.resultados).toHaveLength(1);
    expect(d.resultados[0]).not.toHaveProperty('advertencias');
    expect(Object.keys(d).sort()).toEqual(['enRevision', 'excepciones', 'idempotentes', 'recibidas', 'resultados', 'retenidas']);
  });

  it('la muestra actual con un campo extra: misma aceptación, solo se SUMA `advertencias` (nombre, sin valor)', async () => {
    const sin = (await json(await postear(sobre([limpia])))).datos;
    const con = (await json(await postear(sobre([{ ...limpia, Póliza: 'POL-SECRETA', Extra: { x: 1 } }])))).datos;
    const { advertencias, ...resto } = con.resultados[0];
    expect(resto).toEqual(sin.resultados[0]);
    expect(advertencias).toEqual([{ codigo: 'campo_desconocido', campo: 'Póliza' }, { codigo: 'campo_desconocido', campo: 'Extra' }]);
    expect(JSON.stringify(con)).not.toMatch(/POL-SECRETA/);
    expect(con.recibidas + con.retenidas + con.excepciones.length).toBe(sin.recibidas + sin.retenidas + sin.excepciones.length);
  });

  it('también en revisión y en simulación; tope de 10', async () => {
    const muchos: Record<string, unknown> = {};
    for (let i = 0; i < 30; i++) muchos[`X${i}`] = i;
    const rev = (await json(await postear(sobre([{ ...limpia, ...muchos, Operador: 'Nadie Ficticio' }]), { 'Likida-Simular': 'si' }))).datos;
    expect(rev.simulada).toBe(true);
    expect(rev.resultados[0].estado).toBe('en_revision');
    expect(rev.resultados[0].advertencias).toHaveLength(10);
    expect(excepcion).not.toHaveBeenCalled();
  });

  it('advertencias de una bitácora no se mezclan con la de otra', async () => {
    const d = (await json(await postear(sobre([{ ...limpia, Extra: 1 }, { ...limpia, BitacoraID: 900002 }])))).datos;
    expect(d.resultados[0].advertencias).toEqual([{ codigo: 'campo_desconocido', campo: 'Extra' }]);
    expect(d.resultados[1]).not.toHaveProperty('advertencias');
  });
});
