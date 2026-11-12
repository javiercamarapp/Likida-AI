import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BITACORA_MUESTRA } from '@/lib/likida/liquidacion_externa/desglose_muestra_tms.fixture';

// POST …/desgloses con `muestra-tms`: lo que se agregó para el piloto del webhook (11-nov-2026). Datos sintéticos.
//   P0-4  `resultados` por bitácora (estado explícito) sin romper los campos de siempre.
//   P0-5  `BitacoraID` alfanumérico: la clave sigue siendo BIT-<id> y dos IDs distintos no chocan.
//   P0-6  `Likida-Simular: si`: mismos `resultados`, y NADA se escribe (ni revisiones, ni excepciones, ni cierres, ni recepción real).

const abrir = vi.fn(async (): Promise<Record<string, unknown>> => ({ ok: true, tenantId: 't-1', rol: 'llave:administracion' }));
vi.mock('@/app/api/v1/_comun', async (orig) => ({ ...((await orig()) as Record<string, unknown>), abrir: () => abrir() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => { throw new Error('sin base en pruebas'); } }) }));

type Fila = { claveExterna: string } & Record<string, unknown>;
const recibir = vi.fn(async (_t: string, d: { bitacora: string }, _deps?: unknown, o?: { simular?: boolean }): Promise<Fila> => (
  o?.simular
    ? { estado: 'simulada', claveExterna: `BIT-${d.bitacora}`, correos: 0, omitidas: 0, retenida: true, omitida: null, motivos: ['sin_poliza'] }
    : { estado: 'creada', claveExterna: `BIT-${d.bitacora}`, liquidacionId: 'x', entregas: 0, retenida: true, motivos: ['sin_poliza'], excepciones: ['sin_poliza'] }));
vi.mock('@/lib/likida/liquidacion_externa/desglose_recibir', () => ({ recibirDesglose: (...a: [string, { bitacora: string }, unknown, { simular?: boolean }]) => recibir(...a) }));
const padron = vi.fn(async (_t: string) => [
  { numeroEmpleado: '1001', nombre: 'Operador Ficticio Uno' }, { numeroEmpleado: '1002', nombre: 'Operador Ficticio Dos' },
]);
vi.mock('@/lib/likida/liquidacion_externa/repo', async (orig) => ({ ...((await orig()) as Record<string, unknown>), leerPadronOperadores: (t: string) => padron(t) }));
const excepcion = vi.fn(async (..._a: unknown[]) => ({ id: 1, nueva: true }));
const listar = vi.fn(async (..._a: unknown[]) => ({ ok: true, valor: [] as unknown[] }));
const resolver = vi.fn(async (..._a: unknown[]) => true);
vi.mock('@/lib/likida/liquidacion_externa/repo_correo', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  abrirExcepcion: (...a: unknown[]) => excepcion(...a), listarExcepciones: (...a: unknown[]) => listar(...a), resolverExcepcion: (...a: unknown[]) => resolver(...a),
}));
vi.mock('@/lib/likida/liquidacion_externa/desglose_muestra_recepcion', async (orig) => ({
  ...((await orig()) as Record<string, unknown>), muestraTmsHabilitada: async () => ({ ok: true }),
}));

const { POST } = await import('./route');
const postear = (c: unknown, cabeceras: Record<string, string> = {}) => POST(new Request('https://app.likida.ai/api/v1/liquidaciones-externas/desgloses',
  { method: 'POST', headers: { 'content-type': 'application/json', ...cabeceras }, body: JSON.stringify(c) }));
const json = async (r: Response) => (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const sobre = (b: unknown[]) => ({ formato: 'muestra-tms', version: 1, bitacoras: b });
const buena = (extra: Record<string, unknown> = {}) => ({ ...BITACORA_MUESTRA, CampoExtraDesconocido: undefined, ...extra });

beforeEach(() => {
  for (const f of [recibir, padron, excepcion, listar, resolver]) f.mockClear();
  abrir.mockResolvedValue({ ok: true, tenantId: 't-1', rol: 'llave:administracion' });
});

describe('P0-4 · resultados por bitácora', () => {
  it('mezcla en un lote: en_revision (operador desconocido), retenida y no_guardada, en el orden en que se mandaron, y los campos de siempre intactos', async () => {
    recibir
      .mockResolvedValueOnce({ estado: 'creada', claveExterna: 'BIT-2', liquidacionId: 'a', entregas: 0, retenida: true, motivos: ['tipo_sin_regla'], excepciones: ['tipo_sin_regla'] })
      .mockResolvedValueOnce({ estado: 'operador_no_encontrado', claveExterna: 'BIT-3' });
    const r = await postear(sobre([
      buena({ BitacoraID: 1, Operador: 'Nadie Ficticio' }),
      buena({ BitacoraID: 2, NumeroEmpleado: '1001' }),
      buena({ BitacoraID: 3, NumeroEmpleado: '1002', Operador: 'Operador Ficticio Dos' }),
    ]));
    const d = (await json(r)).datos;
    expect(d.resultados.map((x: { indice: number; bitacora: string; estado: string }) => [x.indice, x.bitacora, x.estado]))
      .toEqual([[0, '1', 'en_revision'], [1, '2', 'retenida'], [2, '3', 'no_guardada']]);
    expect(d.resultados[0].motivos).toEqual([{ codigo: 'operador_no_encontrado', campo: 'Operador' }]);
    // Compatibilidad: siguen estando los campos anteriores.
    expect(d).toMatchObject({ recibidas: 0, retenidas: 1, idempotentes: 0 });
    expect(d.enRevision).toHaveLength(1);
    expect(d.excepciones.map((e: { motivo: string }) => e.motivo)).toEqual(['tipo_sin_regla', 'operador_no_encontrado']);
    expect(JSON.stringify(d.resultados)).not.toMatch(/Ficticio/);
  });

  it('`indice` es la posición en el lote aunque haya revisiones en medio', async () => {
    const r = await postear(sobre([buena({ BitacoraID: 10, NumeroEmpleado: '1001' }), buena({ BitacoraID: 'mal id', NumeroEmpleado: '1001' }), buena({ BitacoraID: 12, NumeroEmpleado: '1001' })]));
    const res = (await json(r)).datos.resultados as Array<{ indice: number; bitacora: string | null; estado: string }>;
    expect(res.map((x) => [x.indice, x.bitacora, x.estado])).toEqual([[0, '10', 'retenida'], [1, null, 'en_revision'], [2, '12', 'retenida']]);
  });

  it('el `Folio` viaja en el resultado y al servicio, sin sustituir a la bitácora', async () => {
    const r = await postear(sobre([buena({ NumeroEmpleado: '1001', Folio: 1098 })]));
    expect((await json(r)).datos.resultados[0]).toMatchObject({ bitacora: '900001', folio: '1098' });
    expect(recibir.mock.calls[0][1]).toMatchObject({ bitacora: '900001', folio: '1098' });
  });
});

describe('P0-5 · BitacoraID alfanumérico', () => {
  it('llega al servicio con su clave BIT-<id> y dos IDs distintos jamás comparten clave', async () => {
    await postear(sobre([
      buena({ BitacoraID: 'A-1098', NumeroEmpleado: '1001' }), buena({ BitacoraID: 'B-1098', NumeroEmpleado: '1002', Operador: 'Operador Ficticio Dos' }),
      buena({ BitacoraID: '1098', NumeroEmpleado: '1001' }), buena({ BitacoraID: 'a-1098', NumeroEmpleado: '1001' }),
    ]));
    const claves = recibir.mock.calls.map((c) => `BIT-${c[1].bitacora}`);
    expect(claves).toEqual(['BIT-A-1098', 'BIT-B-1098', 'BIT-1098', 'BIT-a-1098']);
    expect(new Set(claves).size).toBe(4);
  });

  it('el mismo ID alfanumérico repetido en el lote manda ambos a revisión', async () => {
    const r = await postear(sobre([buena({ BitacoraID: 'X1', NumeroEmpleado: '1001' }), buena({ BitacoraID: 'X1', NumeroEmpleado: '1002', Operador: 'Operador Ficticio Dos' })]));
    const d = (await json(r)).datos;
    expect(d.resultados.map((x: { estado: string }) => x.estado)).toEqual(['en_revision', 'en_revision']);
    expect(recibir).not.toHaveBeenCalled();
  });
});

describe('P0-6 · modo simulación', () => {
  const lote = () => sobre([buena({ BitacoraID: 1, Operador: 'Nadie Ficticio' }), buena({ BitacoraID: 2, NumeroEmpleado: '1001', Poliza: 'P-1' })]);

  it('mismos resultados, 200 siempre y `simulada: true`; el servicio se llama en simulación', async () => {
    const r = await postear(lote(), { 'Likida-Simular': 'si' });
    expect(r.status).toBe(200);
    const d = (await json(r)).datos;
    expect(d.simulada).toBe(true);
    expect(d.resultados.map((x: { estado: string }) => x.estado)).toEqual(['en_revision', 'retenida']);
    expect(recibir.mock.calls[0][3]).toMatchObject({ simular: true });
  });

  it('NO escribe nada: ni excepciones de revisión, ni cierre de revisiones, ni recepción real', async () => {
    await postear(lote(), { 'likida-simular': 'SI' });
    expect(excepcion).not.toHaveBeenCalled();
    expect(listar).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
    for (const c of recibir.mock.calls) expect(c[3]).toMatchObject({ simular: true });
  });

  it('sin la cabecera (o con `no`) sí escribe: abre la revisión y recibe de verdad', async () => {
    for (const cab of [{}, { 'Likida-Simular': 'no' }] as Array<Record<string, string>>) {
      excepcion.mockClear(); recibir.mockClear();
      const r = await postear(lote(), cab);
      expect(r.status).toBe(201);
      expect((await json(r)).datos.simulada).toBeUndefined();
      expect(excepcion).toHaveBeenCalledTimes(1);
      expect(recibir.mock.calls[0][3]).not.toHaveProperty('simular');
    }
  });

  it('un valor desconocido en la cabecera es 400 (no se adivina: entenderlo mal escribiría datos)', async () => {
    const r = await postear(lote(), { 'Likida-Simular': 'quizas' });
    expect(r.status).toBe(400);
    expect(recibir).not.toHaveBeenCalled(); expect(excepcion).not.toHaveBeenCalled(); expect(padron).not.toHaveBeenCalled();
  });

  it('también vale para el contrato interno: no escribe y responde `resultados`', async () => {
    const r = await postear({ terminal: 'T1', bitacora: 'B-1', poliza: 'P-1', operador: { numeroEmpleado: '1001' }, desde: '2026-10-09', hasta: '2026-10-14',
      percepciones: [{ concepto: 'Sueldo', monto: 10 }], deducciones: [] }, { 'Likida-Simular': 'si' });
    expect(r.status).toBe(200);
    expect((await json(r)).datos).toMatchObject({ simulada: true, resultados: [{ indice: 0, bitacora: 'B-1', estado: 'retenida' }] });
    expect(recibir.mock.calls[0][3]).toMatchObject({ simular: true });
  });
});
