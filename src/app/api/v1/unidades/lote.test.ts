import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · bloqueante 3/4 — el alta masiva del parque.
//
// `POST /v1/unidades` ya existía para UNA unidad. El lote se le suma, y lo que
// estas pruebas fijan es que sumarlo no rompió nada y que las promesas nuevas
// se cumplen:
//
//   1. LA FORMA DE UNA UNIDAD SIGUE INTACTA. Es la que un integrador ya tiene
//      escrita; si cambiara de conducta al desplegar, se enteraría en
//      producción.
//   2. LAS DOS FORMAS NO SE MEZCLAN. `unidades` + `numeroEconomico` es 400, no
//      una adivinanza sobre cuál quiso el integrador.
//   3. EL LOTE EXIGE PLACA. Una unidad sin placa no se cruza después con una
//      multa, una caseta ni un GPS.
//   4. LO QUE YA ESTABA NO SE PISA. Sale en `duplicadas` y se queda como está:
//      si el TMS remanda la póliza vieja de su exportación, sobrescribir
//      borraría un dato bueno con uno viejo.
//   5. DOS FILAS DEL MISMO LOTE CON LA MISMA PLACA se atrapan ANTES de la
//      base: `importarUnidades` compara contra el parque que leyó antes del
//      upsert y las dos le parecerían nuevas.
// ═══════════════════════════════════════════════════════════════════════════

const abrir = vi.fn(async (_req: Request, _area: string): Promise<Record<string, unknown>> => ({ ok: true, tenantId: 't-1', rol: 'llave:administracion' }));
vi.mock('@/app/api/v1/_comun', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, abrir: (...a: [Request, string]) => abrir(...a) };
});

type Resultado = {
  creadas: Array<{ fila: number; id: string; numeroEconomico: string; placas: string }>;
  duplicadas: Array<{ fila: number; id: string | null; numeroEconomico: string; motivo: string }>;
  errores: Array<{ fila: number; motivo: string }>;
  error?: string;
};
type FilaMotor = { fila: number; numeroEconomico: string; placas: string; polizaVence: string | null };
const importarUnidades = vi.fn(async (
  _t: string,
  filas: FilaMotor[],
  _o: Record<string, unknown>,
): Promise<Resultado> => ({
  creadas: filas.map((f) => ({ fila: f.fila, id: `u-${f.fila}`, numeroEconomico: f.numeroEconomico, placas: f.placas })),
  duplicadas: [], errores: [],
}));
vi.mock('@/lib/likida/importacion/unidades', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  // `validarUnidadImportada` se deja REAL: es la regla que la ruta promete
  // compartir con el panel y con la importación por archivo.
  return { ...real, importarUnidades: (...a: [string, never, never]) => importarUnidades(...a) };
});

const resolverTerminalDeFlota = vi.fn(async (_t: string, id: string | null | undefined): Promise<string | null> => id ?? null);
vi.mock('@/lib/likida/terminales', () => ({ resolverTerminalDeFlota: (...a: [string, string | null]) => resolverTerminalDeFlota(...a) }));

// El camino de UNA unidad: el motor de siempre. El mock es PARCIAL a
// propósito — `validarUnidadImportada` (real) llama a `validarUnidad` de este
// mismo módulo, y sustituirlo entero dejaría al lote sin la validación que la
// ruta promete compartir con el panel.
const crearUnidad = vi.fn(async (_t: string, _u: Record<string, unknown>): Promise<string> => 'u-sola');
vi.mock('@/lib/likida/operacion', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, crearUnidad: (t: string, u: Record<string, unknown>) => crearUnidad(t, u), getUnidades: vi.fn(async () => []) };
});

// La llave natural del camino de UNA unidad va a la base. Aquí no hay base:
// se responde «no existe» para que la prueba mida la ruta y no a Postgres.
const buscarUnidadPorEconomico = vi.fn(async (_t: string, _e: string): Promise<unknown> => null);
vi.mock('@/app/api/v1/_escritura', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, buscarUnidadPorEconomico: (...a: [string, string]) => buscarUnidadPorEconomico(...a) };
});

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
// La capa durable de idempotencia es de CONVENIENCIA y no lanza: sin base
// responde `null` y la petición sigue por la llave natural.
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: () => { throw new Error('sin base en pruebas'); } }),
}));

const { POST } = await import('./route');
const { reiniciarIdempotencia } = await import('../_escritura');
const { DatoInvalido } = await import('@/lib/likida/errores');

const URL_BASE = 'https://app.likida.ai/api/v1/unidades';
let n = 0;
const postear = (cuerpo: unknown, llave = `llave-de-prueba-${++n}`) =>
  POST(new Request(URL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': llave },
    body: JSON.stringify(cuerpo),
  }));

const T1 = { numeroEconomico: 'T-042', placas: 'ABC-123-4' };
const T2 = { numeroEconomico: 'T-043', placas: 'XYZ-987-6' };

beforeEach(() => {
  abrir.mockClear(); importarUnidades.mockClear();
  resolverTerminalDeFlota.mockClear(); crearUnidad.mockClear();
  buscarUnidadPorEconomico.mockClear();
  reiniciarIdempotencia();
  abrir.mockResolvedValue({ ok: true, tenantId: 't-1', rol: 'llave:administracion' });
});

describe('POST /v1/unidades — la forma de UNA unidad no cambió', () => {
  it('sin `unidades`, el cuerpo sigue yendo por `crearUnidad` y contesta 201 con el id', async () => {
    const r = await postear({ numeroEconomico: 'T-042', placas: 'ABC-123-4', anio: 2019 });
    expect(r.status).toBe(201);
    expect(crearUnidad).toHaveBeenCalledTimes(1);
    expect(importarUnidades).not.toHaveBeenCalled();
    expect(await r.json()).toMatchObject({ dato: { id: 'u-sola', numeroEconomico: 'T-042' }, idempotente: false });
  });

  it('la forma de una unidad NO acepta vigencias, y por eso no las inventa', async () => {
    await postear({ numeroEconomico: 'T-042', polizaVence: '2027-01-31' });
    // Lo que llega al motor es lo que `NuevaUnidad` acepta: la póliza no está.
    expect(crearUnidad.mock.calls[0][1]).not.toHaveProperty('polizaVence');
  });

  it('sigue exigiendo `numeroEconomico`', async () => {
    const r = await postear({ placas: 'ABC-123-4' });
    expect(r.status).toBe(400);
    expect(crearUnidad).not.toHaveBeenCalled();
  });
});

describe('POST /v1/unidades — el lote y la forma de una no se mezclan', () => {
  it('`unidades` + `numeroEconomico` en el mismo cuerpo es 400, no una adivinanza', async () => {
    const r = await postear({ numeroEconomico: 'T-042', unidades: [T1] });
    expect(r.status).toBe(400);
    expect(importarUnidades).not.toHaveBeenCalled();
    expect(crearUnidad).not.toHaveBeenCalled();
  });

  it('con `unidades` se abre igual con área `administracion`', async () => {
    await postear({ unidades: [T1] });
    expect(abrir.mock.calls[0][1]).toBe('administracion');
  });

  it('sin `Idempotency-Key` el lote es 400 y no se escribe', async () => {
    const r = await POST(new Request(URL_BASE, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unidades: [T1] }),
    }));
    expect(r.status).toBe(400);
    expect(importarUnidades).not.toHaveBeenCalled();
  });

  it('`unidades: []` es 400, no un 201 silencioso', async () => {
    const r = await postear({ unidades: [] });
    expect(r.status).toBe(400);
    expect(importarUnidades).not.toHaveBeenCalled();
  });

  it('un lote más largo que la tanda es 400 que DICE el tope', async () => {
    const { FILAS_POR_TANDA } = await import('@/lib/likida/importacion/archivo');
    const muchas = Array.from({ length: FILAS_POR_TANDA + 1 }, (_, i) => ({
      numeroEconomico: `T-${i}`, placas: `AA${String(i).padStart(5, '0')}`,
    }));
    const r = await postear({ unidades: muchas });
    expect(r.status).toBe(400);
    expect((await r.json() as { error: { mensaje: string } }).error.mensaje).toContain(String(FILAS_POR_TANDA));
    expect(importarUnidades).not.toHaveBeenCalled();
  });
});

describe('POST /v1/unidades — lo que el lote SÍ captura y SÍ exige', () => {
  it('el lote escribe las TRES vigencias: vienen de una exportación donde ya existen', async () => {
    await postear({
      unidades: [{
        numeroEconomico: 'T-042', placas: 'ABC-123-4',
        polizaVence: '2027-01-31', permisoSictVence: '2026-11-30', verificacionVence: '2026-12-15',
      }],
    });
    expect(importarUnidades.mock.calls[0][1][0]).toMatchObject({
      polizaVence: '2027-01-31', permisoSictVence: '2026-11-30', verificacionVence: '2026-12-15',
    });
  });

  it('el lote EXIGE placa: sin ella la fila es un error que lo dice', async () => {
    const r = await postear({ unidades: [{ numeroEconomico: 'T-042' }] });
    expect(r.status).toBe(400);
    const c = await r.json() as { error: { filas: Array<{ fila: number; motivo: string }> } };
    expect(c.error.filas[0].motivo).toContain('placas');
    expect(importarUnidades).not.toHaveBeenCalled();
  });

  it('la placa se normaliza a MAYÚSCULAS antes de escribir: «abc 123 4» y «ABC-123-4» son la misma', async () => {
    await postear({ unidades: [{ numeroEconomico: 'T-042', placas: 'abc 123 4' }] });
    expect(importarUnidades.mock.calls[0][1][0].placas).toBe('ABC-123-4');
  });

  it('dos filas del MISMO lote con la misma placa: la segunda es error y NO llega al motor', async () => {
    const r = await postear({
      unidades: [
        { numeroEconomico: 'T-042', placas: 'ABC-123-4' },
        { numeroEconomico: 'T-043', placas: 'abc-123-4' },  // la MISMA placa, escrita distinto
      ],
    });
    expect(r.status).toBe(201);
    // Solo la primera llegó a escribirse.
    expect(importarUnidades.mock.calls[0][1].map((f) => f.fila)).toEqual([1]);
    const { dato } = await r.json() as { dato: { errores: Array<{ fila: number; motivo: string }>; recibidas: number } };
    expect(dato.errores).toHaveLength(1);
    expect(dato.errores[0].fila).toBe(2);
    // El error NOMBRA la fila que se queda con la placa, no solo la que falla.
    expect(dato.errores[0].motivo).toContain('fila 1');
  });

  it('dos filas del mismo lote con el mismo número económico: la segunda es error', async () => {
    const r = await postear({
      unidades: [
        { numeroEconomico: 'T-042', placas: 'ABC-123-4' },
        { numeroEconomico: 'T-042', placas: 'XYZ-987-6' },
      ],
    });
    const { dato } = await r.json() as { dato: { errores: Array<{ fila: number }> } };
    expect(dato.errores.map((e) => e.fila)).toEqual([2]);
    expect(importarUnidades.mock.calls[0][1]).toHaveLength(1);
  });
});

describe('POST /v1/unidades — el acuse del lote no miente', () => {
  it('una fila mala no tira el lote, y los tres arreglos SUMAN `recibidas`', async () => {
    importarUnidades.mockImplementationOnce(async (_t, filas) => ({
      creadas: [{ fila: filas[0].fila, id: 'u-1', numeroEconomico: filas[0].numeroEconomico, placas: filas[0].placas }],
      duplicadas: [{ fila: filas[1].fila, id: 'u-viejo', numeroEconomico: filas[1].numeroEconomico, motivo: 'ya estaba (mismo número económico); no se tocó lo que hay' }],
      errores: [],
    }));
    const r = await postear({
      unidades: [
        T1,                                                       // 1: se crea
        T2,                                                       // 2: ya estaba
        { numeroEconomico: 'T-044', placas: 'DDD-111-1', anio: '1899' }, // 3: año imposible
      ],
    });
    expect(r.status).toBe(201);
    const { dato } = await r.json() as { dato: { creadas: unknown[]; duplicadas: unknown[]; errores: Array<{ fila: number }>; recibidas: number } };
    expect(dato.recibidas).toBe(3);
    expect(dato.creadas).toHaveLength(1);
    expect(dato.duplicadas).toHaveLength(1);
    expect(dato.errores.map((e) => e.fila)).toEqual([3]);
    // LA SUMA.
    expect(dato.creadas.length + dato.duplicadas.length + dato.errores.length).toBe(dato.recibidas);
  });

  it('lo que YA ESTABA sale en `duplicadas` con su id y no se pisa', async () => {
    importarUnidades.mockImplementationOnce(async (_t, filas) => ({
      creadas: [],
      duplicadas: [{ fila: filas[0].fila, id: 'u-viejo', numeroEconomico: 'T-042', motivo: 'ya estaba (mismo número económico); no se tocó lo que hay' }],
      errores: [],
    }));
    const r = await postear({ unidades: [{ numeroEconomico: 'T-042', placas: 'ABC-123-4', polizaVence: '2020-01-01' }] });
    const { dato } = await r.json() as { dato: { creadas: unknown[]; duplicadas: Array<{ id: string; motivo: string }> } };
    expect(dato.creadas).toHaveLength(0);
    expect(dato.duplicadas[0].id).toBe('u-viejo');
    expect(dato.duplicadas[0].motivo).toContain('no se tocó');
  });

  it('NINGUNA fila válida es 400 con el detalle por fila y CERO escrituras', async () => {
    const r = await postear({ unidades: [{ placas: '' }, { numeroEconomico: 'T-1' }] });
    expect(r.status).toBe(400);
    const c = await r.json() as { error: { codigo: string; filas: unknown[] } };
    expect(c.error.codigo).toBe('parametro_invalido');
    expect(c.error.filas).toHaveLength(2);
    expect(importarUnidades).not.toHaveBeenCalled();
  });

  it('si NO se pudo leer el parque, NO es 201: no se escribió nada', async () => {
    importarUnidades.mockResolvedValueOnce({
      creadas: [], duplicadas: [], errores: [],
      error: 'No pude leer el parque actual — no importé nada.',
    });
    const r = await postear({ unidades: [T1] });
    expect(r.status).toBeGreaterThanOrEqual(500);
  });
});

describe('POST /v1/unidades — el tenant, el patio y la idempotencia del lote', () => {
  it('el tenant sale de la CREDENCIAL; un `tenant_id` en el cuerpo se ignora', async () => {
    await postear({ unidades: [T1], tenant_id: 't-ajeno' });
    expect(importarUnidades.mock.calls[0][0]).toBe('t-1');
  });

  it('el origen queda anotado como `api`', async () => {
    await postear({ unidades: [T1] });
    expect(importarUnidades.mock.calls[0][2]).toMatchObject({ origen: 'api' });
  });

  it('un patio ajeno es 400 que lo dice, no un 500, y no se escribe nada', async () => {
    resolverTerminalDeFlota.mockRejectedValueOnce(new DatoInvalido('Ese patio no existe en tu flota. Elige uno de la lista o déjalo vacío.'));
    const r = await postear({ unidades: [T1], terminalId: '11111111-2222-3333-4444-555555555555' });
    expect(r.status).toBe(400);
    expect((await r.json() as { error: { mensaje: string } }).error.mensaje).toContain('patio');
    expect(importarUnidades).not.toHaveBeenCalled();
  });

  it('el MISMO lote con la MISMA llave se procesa una sola vez', async () => {
    const llave = 'la-misma-llave-del-lote';
    const cuerpo = { unidades: [T1, T2] };
    const r1 = await postear(cuerpo, llave);
    const c1 = await r1.json();
    const r2 = await postear(cuerpo, llave);

    expect(r1.status).toBe(201);
    expect(await r2.json()).toEqual(c1);
    expect(r2.headers.get('Idempotent-Replayed')).toBe('true');
    expect(importarUnidades).toHaveBeenCalledTimes(1);
  });

  it('la misma llave con OTRO lote es 400: no se descarta el lote nuevo en silencio', async () => {
    const llave = 'llave-del-lote-reusada';
    await postear({ unidades: [T1] }, llave);
    const r = await postear({ unidades: [T2] }, llave);
    expect(r.status).toBe(400);
    expect(importarUnidades).toHaveBeenCalledTimes(1);
  });

  it('el lote y la unidad suelta NO comparten recuerdo: son eventos distintos', async () => {
    const llave = 'una-llave-para-las-dos-formas';
    const r1 = await postear({ numeroEconomico: 'T-042', placas: 'ABC-123-4' }, llave);
    const r2 = await postear({ unidades: [T1] }, llave);
    expect(r1.status).toBe(201);
    // Si compartieran recuerdo, el segundo sería un eco del primero (o un 400
    // por llave reusada) y el motor del lote nunca correría.
    expect(r2.status).toBe(201);
    expect(importarUnidades).toHaveBeenCalledTimes(1);
  });
});
