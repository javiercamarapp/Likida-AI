import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · bloqueante 3/4 — el alta masiva de choferes.
//
// Lo que se fija aquí no es que la ruta "funcione": es que las cuatro promesas
// que hace el acuse sean ciertas, porque un integrador que dé el lote por
// entregado cuando no lo estaba pone a un chofer a trabajar sin poder reportar
// un gasto.
//
//   1. EL ÁREA. Escribir es `administracion`, leer es `operacion`. Si el POST
//      abriera con `operacion`, una llave de tablero daría de alta personal.
//   2. UNA FILA MALA NO TIRA EL LOTE, y `creados + duplicados + errores` suma
//      SIEMPRE `recibidas`. Si no sumara, alguna fila se perdió en silencio y
//      nadie se enteraría.
//   3. NINGUNA FILA VÁLIDA NO ES UN 201 VACÍO. Un 201 con `creados: []` haría
//      que el TMS tachara el lote como entregado.
//   4. SI NO SE PUDO LEER EL PADRÓN, NO SE CONTESTA 201. `importarOperadores`
//      devuelve `error` y no escribió nada: contestar 201 sería afirmar un
//      alta que no ocurrió.
//
// Y la que sostiene a las otras: EL TENANT SALE DE LA CREDENCIAL. Un
// `tenant_id` en el cuerpo no se lee ni cambia la huella de idempotencia.
// ═══════════════════════════════════════════════════════════════════════════

const abrir = vi.fn(async (_req: Request, _area: string): Promise<Record<string, unknown>> => ({ ok: true, tenantId: 't-1', rol: 'llave:administracion' }));
vi.mock('@/app/api/v1/_comun', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, abrir: (...a: [Request, string]) => abrir(...a) };
});

type Resultado = {
  creados: Array<{ fila: number; id: string; telefono: string }>;
  duplicados: Array<{ fila: number; id: string | null; telefono: string; motivo: string }>;
  errores: Array<{ fila: number; motivo: string }>;
  avisoPendiente: number;
  error?: string;
};
const importarOperadores = vi.fn(async (
  _t: string,
  filas: Array<{ fila: number; telefono: string }>,
  _o: Record<string, unknown>,
): Promise<Resultado> => ({
  creados: filas.map((f) => ({ fila: f.fila, id: `o-${f.fila}`, telefono: f.telefono })),
  duplicados: [], errores: [], avisoPendiente: filas.length,
}));
vi.mock('@/lib/likida/importacion/operadores', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  // `validarOperadorImportado` se deja REAL a propósito: es la regla que la
  // ruta promete compartir con el panel y con la importación por archivo, y
  // mockearla probaría una validación de mentira.
  return { ...real, importarOperadores: (...a: [string, never, never]) => importarOperadores(...a) };
});

const resolverTerminalDeFlota = vi.fn(async (_t: string, id: string | null | undefined): Promise<string | null> => id ?? null);
vi.mock('@/lib/likida/terminales', () => ({ resolverTerminalDeFlota: (...a: [string, string | null]) => resolverTerminalDeFlota(...a) }));

const getOperadoresRegistro = vi.fn(async (_t: string, _o: Record<string, unknown>): Promise<Record<string, unknown>> => ({ filas: [], total: 0, pagina: 1, paginas: 1, q: '' }));
vi.mock('@/lib/likida/administracion', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, getOperadoresRegistro: (...a: [string, Record<string, unknown>]) => getOperadoresRegistro(...a) };
});

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
// La capa durable de idempotencia es de CONVENIENCIA y no lanza: sin base
// responde `null` y la petición sigue. Se simula caída para que estas pruebas
// midan la ruta y no a Postgres.
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: () => { throw new Error('sin base en pruebas'); } }),
}));

const { GET, POST } = await import('./route');
const { reiniciarIdempotencia } = await import('../_escritura');
const { DatoInvalido } = await import('@/lib/likida/errores');

const URL_BASE = 'https://app.likida.ai/api/v1/operadores';
let n = 0;
const postear = (cuerpo: unknown, llave = `llave-de-prueba-${++n}`) =>
  POST(new Request(URL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': llave },
    body: JSON.stringify(cuerpo),
  }));

const CHOFER = { nombre: 'Juan Pérez', telefono: '5512345678' };

beforeEach(() => {
  abrir.mockClear(); importarOperadores.mockClear();
  resolverTerminalDeFlota.mockClear(); getOperadoresRegistro.mockClear();
  reiniciarIdempotencia();
  abrir.mockResolvedValue({ ok: true, tenantId: 't-1', rol: 'llave:administracion' });
});

describe('POST /v1/operadores — la puerta', () => {
  it('abre con área `administracion`: dar de alta personal NO es una operación de tablero', async () => {
    await postear(CHOFER);
    expect(abrir.mock.calls[0][1]).toBe('administracion');
  });

  it('si la puerta no abre, no se escribe nada', async () => {
    abrir.mockResolvedValueOnce({ ok: false, respuesta: new Response('no', { status: 403 }) });
    const r = await postear(CHOFER);
    expect(r.status).toBe(403);
    expect(importarOperadores).not.toHaveBeenCalled();
  });

  it('sin `Idempotency-Key` es 400 y no se escribe: una escritura sin llave no se puede reintentar sin riesgo', async () => {
    const r = await POST(new Request(URL_BASE, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(CHOFER),
    }));
    expect(r.status).toBe(400);
    expect(importarOperadores).not.toHaveBeenCalled();
  });
});

describe('POST /v1/operadores — la forma del cuerpo', () => {
  it('los campos en la raíz son un lote de UNO', async () => {
    const r = await postear(CHOFER);
    expect(r.status).toBe(201);
    expect(importarOperadores.mock.calls[0][1]).toHaveLength(1);
    expect((await r.json() as { dato: { recibidas: number } }).dato.recibidas).toBe(1);
  });

  it('`operadores: []` es 400, NO un 201 silencioso: un lote vacío es casi siempre el filtro del integrador devolviendo 0', async () => {
    const r = await postear({ operadores: [] });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: { codigo: 'parametro_invalido' } });
    expect(importarOperadores).not.toHaveBeenCalled();
  });

  it('`operadores` que no es lista es 400', async () => {
    const r = await postear({ operadores: 'Juan' });
    expect(r.status).toBe(400);
    expect(importarOperadores).not.toHaveBeenCalled();
  });

  it('un lote más largo que la tanda es 400 que DICE el tope, en vez de recortar en silencio', async () => {
    const { FILAS_POR_TANDA } = await import('@/lib/likida/importacion/archivo');
    const muchos = Array.from({ length: FILAS_POR_TANDA + 1 }, (_, i) => ({
      nombre: `Chofer ${i}`, telefono: `55${String(10000000 + i)}`,
    }));
    const r = await postear({ operadores: muchos });
    expect(r.status).toBe(400);
    expect((await r.json() as { error: { mensaje: string } }).error.mensaje).toContain(String(FILAS_POR_TANDA));
    expect(importarOperadores).not.toHaveBeenCalled();
  });

  it('un elemento del lote que no es objeto es 400 antes de tocar la base', async () => {
    const r = await postear({ operadores: [CHOFER, 'Juan'] });
    expect(r.status).toBe(400);
    expect(importarOperadores).not.toHaveBeenCalled();
  });
});

describe('POST /v1/operadores — una fila mala no tira el lote', () => {
  it('las buenas se escriben, las malas salen por su número de fila, y los tres arreglos SUMAN `recibidas`', async () => {
    const r = await postear({
      operadores: [
        CHOFER,                                          // fila 1: bien
        { nombre: 'Ok', telefono: '5512345670' },        // fila 2: nombre de 2 letras → mal
        { nombre: 'Ana Ruiz', telefono: '123' },         // fila 3: teléfono corto → mal
        { nombre: 'Luis Mora', telefono: '5598765432' }, // fila 4: bien
      ],
    });
    expect(r.status).toBe(201);
    const { dato } = await r.json() as { dato: { creados: unknown[]; duplicados: unknown[]; errores: Array<{ fila: number }>; recibidas: number } };

    // Solo las dos buenas llegaron al motor, y con su fila REAL del cuerpo
    // (4, no 2): el integrador señala ese índice en su propio arreglo.
    expect(importarOperadores.mock.calls[0][1].map((f) => f.fila)).toEqual([1, 4]);

    expect(dato.errores.map((e) => e.fila)).toEqual([2, 3]);
    expect(dato.recibidas).toBe(4);
    // LA SUMA. Si no diera 4, alguna fila se habría perdido en silencio.
    expect(dato.creados.length + dato.duplicados.length + dato.errores.length).toBe(dato.recibidas);
  });

  it('cada error de fila dice QUÉ corregir, no «inválido»', async () => {
    const r = await postear({ operadores: [{ nombre: 'Ana Ruiz', telefono: '' }] });
    expect(r.status).toBe(400);
    const c = await r.json() as { error: { filas: Array<{ fila: number; motivo: string }> } };
    expect(c.error.filas[0].fila).toBe(1);
    // No basta con que diga «inválido»: tiene que decir POR QUÉ ese campo no
    // se puede dejar para después.
    expect(c.error.filas[0].motivo).toContain('identidad del chofer');
  });

  it('los errores del motor (otra flota, de baja) se mezclan con los de forma, ordenados por fila', async () => {
    importarOperadores.mockImplementationOnce(async (_t, filas) => ({
      creados: [{ fila: filas[1].fila, id: 'o-x', telefono: filas[1].telefono }],
      duplicados: [],
      errores: [{ fila: filas[0].fila, motivo: 'ese teléfono ya es de un chofer activo de otra flota' }],
      avisoPendiente: 1,
    }));
    const r = await postear({
      operadores: [
        { nombre: 'Juan Pérez', telefono: '5512345678' },  // 1: el motor lo rechaza
        { nombre: 'Luis Mora', telefono: '5598765432' },   // 2: bien
        { nombre: 'X', telefono: '5511111111' },           // 3: nombre corto, error de forma
      ],
    });
    const { dato } = await r.json() as { dato: { errores: Array<{ fila: number }> } };
    expect(dato.errores.map((e) => e.fila)).toEqual([1, 3]);
  });

  it('NINGUNA fila válida es 400 con el detalle por fila y CERO escrituras — nunca un 201 con `creados: []`', async () => {
    const r = await postear({ operadores: [{ nombre: 'A', telefono: '1' }, { nombre: 'B', telefono: '2' }] });
    expect(r.status).toBe(400);
    const c = await r.json() as { error: { codigo: string; filas: unknown[] } };
    expect(c.error.codigo).toBe('parametro_invalido');
    expect(c.error.filas).toHaveLength(2);
    expect(importarOperadores).not.toHaveBeenCalled();
  });
});

describe('POST /v1/operadores — el tenant y el patio', () => {
  it('el tenant sale de la CREDENCIAL; un `tenant_id` en el cuerpo se ignora', async () => {
    await postear({ ...CHOFER, tenant_id: 't-ajeno', tenantId: 't-ajeno' });
    expect(importarOperadores.mock.calls[0][0]).toBe('t-1');
  });

  it('el origen queda anotado como `api`, no como `panel`', async () => {
    await postear(CHOFER);
    expect(importarOperadores.mock.calls[0][2]).toMatchObject({ origen: 'api' });
  });

  it('el patio se resuelve contra la flota ANTES de escribir; uno ajeno es 400 que lo dice, no un 500', async () => {
    resolverTerminalDeFlota.mockRejectedValueOnce(new DatoInvalido('Ese patio no existe en tu flota. Elige uno de la lista o déjalo vacío.'));
    const r = await postear({ operadores: [CHOFER], terminalId: '11111111-2222-3333-4444-555555555555' });
    expect(r.status).toBe(400);
    expect((await r.json() as { error: { mensaje: string } }).error.mensaje).toContain('patio');
    expect(importarOperadores).not.toHaveBeenCalled();
  });

  it('el patio del lote llega al motor', async () => {
    const patio = '11111111-2222-3333-4444-555555555555';
    await postear({ operadores: [CHOFER], terminalId: patio });
    expect(importarOperadores.mock.calls[0][2]).toMatchObject({ terminalId: patio });
  });
});

describe('POST /v1/operadores — idempotencia y fallar cerrado', () => {
  it('el MISMO lote con la MISMA llave se procesa una sola vez y devuelve la misma respuesta', async () => {
    const llave = 'la-misma-llave-de-siempre';
    const cuerpo = { operadores: [CHOFER, { nombre: 'Luis Mora', telefono: '5598765432' }] };

    const r1 = await postear(cuerpo, llave);
    const c1 = await r1.json();
    const r2 = await postear(cuerpo, llave);
    const c2 = await r2.json();

    expect(r1.status).toBe(201);
    expect(c2).toEqual(c1);
    expect(r2.headers.get('Idempotent-Replayed')).toBe('true');
    // LA PROMESA: el motor corrió UNA vez, no dos.
    expect(importarOperadores).toHaveBeenCalledTimes(1);
  });

  it('la misma llave con OTRO contenido es 400: contestar la respuesta vieja descartaría el lote nuevo en silencio', async () => {
    const llave = 'una-llave-reusada-mal';
    await postear({ operadores: [CHOFER] }, llave);
    const r = await postear({ operadores: [{ nombre: 'Otro Chofer', telefono: '5500000000' }] }, llave);
    expect(r.status).toBe(400);
    expect(importarOperadores).toHaveBeenCalledTimes(1);
  });

  it('reordenar las llaves del JSON NO es otro lote: la huella es de lo NORMALIZADO', async () => {
    const llave = 'llave-con-json-reordenado';
    const r1 = await postear({ operadores: [{ nombre: 'Juan Pérez', telefono: '5512345678' }] }, llave);
    const r2 = await postear({ operadores: [{ telefono: '5512345678', nombre: 'Juan Pérez' }] }, llave);
    expect(r2.status).toBe(r1.status);
    expect(r2.headers.get('Idempotent-Replayed')).toBe('true');
  });

  it('si NO se pudo leer el padrón, NO es 201: no se escribió nada y decirlo «creado» sería mentir', async () => {
    importarOperadores.mockResolvedValueOnce({
      creados: [], duplicados: [], errores: [], avisoPendiente: 0,
      error: 'No pude leer el padrón actual — no importé a nadie.',
    });
    const r = await postear({ operadores: [CHOFER] });
    expect(r.status).toBeGreaterThanOrEqual(500);
  });
});

describe('GET /v1/operadores', () => {
  it('abre con área `operacion`: el jefe de tráfico debe ver que a un chofer se le venció la licencia', async () => {
    await GET(new Request(URL_BASE));
    expect(abrir.mock.calls[0][1]).toBe('operacion');
  });

  it('`total` es el CONTEO de la base, no el largo de la página', async () => {
    getOperadoresRegistro.mockResolvedValueOnce({
      filas: [{
        operadorId: 'o-1', nombre: 'Juan Pérez', telefono: '525512345678', numeroEmpleado: null,
        rfc: 'PEPJ800101ABC', activo: true, viajes: 2, licencia: null, licenciaTipo: null,
        licenciaVence: null, terminalId: null, terminalNombre: null, avisoPrivacidadEn: null,
      }],
      total: 837, pagina: 1, paginas: 34, q: '',
    });
    const r = await GET(new Request(`${URL_BASE}?limite=25`));
    const c = await r.json() as { datos: unknown[]; pagina: { total: number; devueltos: number } };
    expect(c.pagina.total).toBe(837);
    expect(c.pagina.devueltos).toBe(1);
  });

  it('el RFC NO viaja en la respuesta aunque la fila lo traiga', async () => {
    getOperadoresRegistro.mockResolvedValueOnce({
      filas: [{
        operadorId: 'o-1', nombre: 'Juan Pérez', telefono: '525512345678', numeroEmpleado: null,
        rfc: 'PEPJ800101ABC', activo: true, viajes: 0, licencia: null, licenciaTipo: null,
        licenciaVence: null, terminalId: null, terminalNombre: null, avisoPrivacidadEn: null,
      }],
      total: 1, pagina: 1, paginas: 1, q: '',
    });
    const r = await GET(new Request(URL_BASE));
    expect(JSON.stringify(await r.json())).not.toContain('PEPJ800101ABC');
  });

  it('una licencia SIN capturar es `sin_dato` con días `null` — no `vigente` ni 0', async () => {
    getOperadoresRegistro.mockResolvedValueOnce({
      filas: [{
        operadorId: 'o-1', nombre: 'Juan Pérez', telefono: '525512345678', numeroEmpleado: null,
        rfc: null, activo: true, viajes: 0, licencia: null, licenciaTipo: null,
        licenciaVence: null, terminalId: null, terminalNombre: null, avisoPrivacidadEn: null,
      }],
      total: 1, pagina: 1, paginas: 1, q: '',
    });
    const r = await GET(new Request(URL_BASE));
    const c = await r.json() as { datos: Array<{ licencia: { estado: string; diasAlVencimiento: number | null } }> };
    expect(c.datos[0].licencia.estado).toBe('sin_dato');
    expect(c.datos[0].licencia.diasAlVencimiento).toBeNull();
  });

  it('una licencia VENCIDA da días negativos y estado `vencido`', async () => {
    // 10 días, no «ayer»: un ayer calculado en UTC puede ser HOY en el día de
    // México y la prueba parpadearía cada noche entre `vencido` y `por_vencer`.
    const hace10 = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    getOperadoresRegistro.mockResolvedValueOnce({
      filas: [{
        operadorId: 'o-1', nombre: 'Juan Pérez', telefono: '525512345678', numeroEmpleado: null,
        rfc: null, activo: true, viajes: 0, licencia: 'A-1', licenciaTipo: 'E',
        licenciaVence: hace10, terminalId: null, terminalNombre: null, avisoPrivacidadEn: null,
      }],
      total: 1, pagina: 1, paginas: 1, q: '',
    });
    const r = await GET(new Request(URL_BASE));
    const c = await r.json() as { datos: Array<{ licencia: { estado: string; diasAlVencimiento: number } }> };
    expect(c.datos[0].licencia.estado).toBe('vencido');
    expect(c.datos[0].licencia.diasAlVencimiento).toBeLessThan(0);
  });

  it('la búsqueda y la página llegan al lector; una `q` larguísima es 400', async () => {
    await GET(new Request(`${URL_BASE}?q=ramirez&limite=25&desplazamiento=50`));
    expect(getOperadoresRegistro.mock.calls[0][1]).toMatchObject({ q: 'ramirez', pagina: 3, porPagina: 25 });

    const r = await GET(new Request(`${URL_BASE}?q=${'a'.repeat(200)}`));
    expect(r.status).toBe(400);
  });

  it('una lectura caída se DICE (5xx), no se pinta como padrón vacío', async () => {
    getOperadoresRegistro.mockRejectedValueOnce(new Error('se cayó la base'));
    const r = await GET(new Request(URL_BASE));
    expect(r.status).toBeGreaterThanOrEqual(500);
  });
});
