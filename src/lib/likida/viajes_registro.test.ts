import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// ESCALA 50k (docs/escala-50k/MAPA.md, "/dashboard/viajes", 22-ago-2026).
// `getViajesRegistro` vivía en analytics.ts con `.range()` = OFFSET (hasta
// 100,000 filas leídas y tiradas por página) y un `.or(ilike)` sin índice.
// Aquí se prueba la versión nueva: cursor keyset opaco, UNA llamada a la RPC
// `viajes_registro_tenant` sin offset, tope 100, `hayMas` por la fila extra,
// fail-closed de FORMA, y los cinco conteos en UNA RPC.
//
// EQUIVALENCIA (regla 2): la reducción vieja (orden + slice en JS sobre un
// dataset sintético) contra la secuencia de páginas por cursor.
// ═══════════════════════════════════════════════════════════════════════════

const llamadas: Array<{ fn: string; args: Record<string, unknown> }> = [];
type Resp = { data: unknown; error: { message: string } | null };
let respuesta: Resp = { data: [], error: null };
let respuestaConteos: Resp = { data: null, error: null };
/** Cuando se fija, decide la respuesta a partir de los argumentos (la RPC simulada). */
let responder: ((fn: string, args: Record<string, unknown>) => Resp) | null = null;

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      llamadas.push({ fn, args });
      const r = responder ? responder(fn, args) : fn === 'conteos_viajes_tenant' ? respuestaConteos : respuesta;
      return Promise.resolve(r);
    },
  }),
}));

const {
  getViajesRegistro, getConteosViajes, codificarCursor, decodificarCursor, sanearBusqueda, TOPE_PAGINA,
} = await import('./viajes_registro');

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function fila(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: UUID(n), folio: `F-${n}`, origen: 'Monterrey', destino: 'CDMX', estatus: 'abierto', anticipo: 100 * n,
    fecha_inicio: n % 5 === 0 ? null : `2026-08-${String(1 + (n % 28)).padStart(2, '0')}`,
    created_at: new Date(Date.UTC(2026, 7, 1, 0, 0, n)).toISOString(),
    intake_pendientes: 0, avisado_en: null, aceptado_en: null, escalado_en: null, avisos_enviados: 0,
    unidad_id: null, operador_nombre: 'Chofer', unidad_eco: null,
    ...extra,
  };
}

beforeEach(() => {
  llamadas.length = 0;
  responder = null;
  respuesta = { data: [], error: null };
  respuestaConteos = { data: null, error: null };
});

describe('cursor opaco', () => {
  it('ida y vuelta', () => {
    const c = { f: '2026-08-20', c: '2026-08-01T00:00:05.000Z', id: UUID(5) };
    expect(decodificarCursor(codificarCursor(c))).toEqual(c);
    const sinFecha = { f: null, c: '2026-08-01T00:00:05.000Z', id: UUID(5) };
    expect(decodificarCursor(codificarCursor(sinFecha))).toEqual(sinFecha);
  });

  it('basura, base64 ajeno, fecha inválida, id que no es uuid → null (nunca lanza)', () => {
    expect(decodificarCursor('')).toBeNull();
    expect(decodificarCursor(undefined)).toBeNull();
    expect(decodificarCursor('%%%')).toBeNull();
    expect(decodificarCursor(Buffer.from('"hola"').toString('base64url'))).toBeNull();
    expect(decodificarCursor(Buffer.from('[1,2]').toString('base64url'))).toBeNull();
    expect(decodificarCursor(Buffer.from(JSON.stringify({ f: 'ayer', c: '2026-08-01T00:00:00Z', id: UUID(1) })).toString('base64url'))).toBeNull();
    expect(decodificarCursor(Buffer.from(JSON.stringify({ f: null, c: 'nunca', id: UUID(1) })).toString('base64url'))).toBeNull();
    expect(decodificarCursor(Buffer.from(JSON.stringify({ f: null, c: '2026-08-01T00:00:00Z', id: '1; drop table' })).toString('base64url'))).toBeNull();
    expect(decodificarCursor('a'.repeat(201))).toBeNull();
  });
});

describe('sanearBusqueda', () => {
  it('quita comodines de LIKE y separadores de PostgREST, colapsa espacios, tope 80', () => {
    expect(sanearBusqueda('  F-12%_(x),y  ')).toBe('F-12 x y');
    expect(sanearBusqueda('a'.repeat(100))).toHaveLength(80);
    expect(sanearBusqueda(undefined)).toBe('');
  });
});

describe('getViajesRegistro — una RPC, sin offset', () => {
  it('primera página: llama a viajes_registro_tenant con cursor nulo y p_limite = porPagina', async () => {
    respuesta = { data: [fila(1), fila(2)], error: null };
    const r = await getViajesRegistro('t1', { porPagina: 2 });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].fn).toBe('viajes_registro_tenant');
    expect(llamadas[0].args).toEqual({
      p_tenant: 't1', p_filtro: 'todos', p_q: null,
      p_cursor_fecha: null, p_cursor_created: null, p_cursor_id: null, p_limite: 2,
    });
    expect(r.filas).toHaveLength(2);
    expect(r.hayMas).toBe(false);
    expect(r.siguiente).toBeNull();
    // Nada de `.range()`/offset en los argumentos.
    expect(JSON.stringify(llamadas[0].args)).not.toMatch(/offset|range|pagina/);
  });

  it('tope 100 aunque pidan 10,000; mínimo 1', async () => {
    await getViajesRegistro('t1', { porPagina: 10_000 });
    expect(llamadas[0].args.p_limite).toBe(TOPE_PAGINA);
    await getViajesRegistro('t1', { porPagina: 0 });
    expect(llamadas[1].args.p_limite).toBe(1);
  });

  it('hayMas por la fila extra: devuelve porPagina filas y un cursor que apunta a la ÚLTIMA devuelta', async () => {
    respuesta = { data: [fila(1), fila(2), fila(3)], error: null };
    const r = await getViajesRegistro('t1', { porPagina: 2 });
    expect(r.filas.map((f) => f.id)).toEqual([UUID(1), UUID(2)]);
    expect(r.hayMas).toBe(true);
    expect(decodificarCursor(r.siguiente)).toEqual({ f: fila(2).fecha_inicio, c: fila(2).created_at, id: UUID(2) });
  });

  it('el cursor de la página anterior viaja a la RPC descompuesto (fecha/created/id)', async () => {
    const cursor = codificarCursor({ f: null, c: '2026-08-01T00:00:05.000Z', id: UUID(5) });
    await getViajesRegistro('t1', { cursor, filtro: 'liquidados', q: 'mont%' });
    expect(llamadas[0].args).toMatchObject({
      p_filtro: 'liquidados', p_q: 'mont', p_cursor_fecha: null, p_cursor_created: '2026-08-01T00:00:05.000Z', p_cursor_id: UUID(5),
    });
  });

  it('cursor corrupto → primera página (no lanza); filtro desconocido → todos', async () => {
    await getViajesRegistro('t1', { cursor: 'no-es-un-cursor', filtro: 'raro' as never });
    expect(llamadas[0].args).toMatchObject({ p_cursor_id: null, p_cursor_fecha: null, p_filtro: 'todos' });
  });

  it('mapea la fila al ViajeRow de siempre (folio cae al id corto, operador/unidad resueltos)', async () => {
    respuesta = { data: [fila(7, { folio: null, unidad_id: UUID(99), unidad_eco: 'T-07', anticipo: '1500.50' })], error: null };
    const { filas } = await getViajesRegistro('t1');
    expect(filas[0]).toEqual({
      id: UUID(7), folio: UUID(7).slice(0, 8), origen: 'Monterrey', destino: 'CDMX', estatus: 'abierto', anticipo: 1500.5,
      operadorNombre: 'Chofer', fechaInicio: '2026-08-08', intakePendientes: 0, unidadId: UUID(99), unidadEco: 'T-07',
      avisadoEn: null, aceptadoEn: null, escaladoEn: null, avisosEnviados: 0,
    });
  });

  it('fail-closed: error de la base lanza; forma ajena (no arreglo, fila sin id) lanza — nunca "[]"', async () => {
    respuesta = { data: null, error: { message: 'boom' } };
    await expect(getViajesRegistro('t1')).rejects.toThrow(/getViajesRegistro: boom/);
    respuesta = { data: { filas: [] }, error: null };
    await expect(getViajesRegistro('t1')).rejects.toThrow(/0154/);
    respuesta = { data: [{ folio: 'sin id' }], error: null };
    await expect(getViajesRegistro('t1')).rejects.toThrow(/sin id\/estatus\/created_at/);
  });
});

describe('EQUIVALENCIA — páginas por cursor vs orden+slice en JS (dataset sintético)', () => {
  // El orden del registro: fecha_inicio desc nulls last, created_at desc, id desc.
  function ordenar(filas: ReturnType<typeof fila>[]) {
    return [...filas].sort((a, b) => {
      if (a.fecha_inicio !== b.fecha_inicio) {
        if (a.fecha_inicio === null) return 1;
        if (b.fecha_inicio === null) return -1;
        return b.fecha_inicio.localeCompare(a.fecha_inicio);
      }
      if (a.created_at !== b.created_at) return b.created_at.localeCompare(a.created_at);
      return b.id.localeCompare(a.id);
    });
  }
  /** Simula la RPC: aplica el keyset sobre el dataset ordenado. */
  function rpcSimulada(dataset: ReturnType<typeof fila>[], args: Record<string, unknown>) {
    const ordenado = ordenar(dataset);
    const lim = Math.min(100, Number(args.p_limite)) + 1;
    if (!args.p_cursor_id) return ordenado.slice(0, lim);
    const pos = ordenado.findIndex((f) => f.id === args.p_cursor_id);
    // Que el cursor se haya descompuesto bien:
    expect(ordenado[pos].fecha_inicio).toBe(args.p_cursor_fecha);
    expect(ordenado[pos].created_at).toBe(args.p_cursor_created);
    return ordenado.slice(pos + 1, pos + 1 + lim);
  }

  it('recorrer todo por cursor da exactamente la lista vieja (orden+OFFSET), sin repetir ni saltar', async () => {
    const dataset = Array.from({ length: 23 }, (_, i) => fila(i + 1));
    // Dos con la MISMA fecha y el MISMO created_at: solo el id desempata.
    dataset[3] = fila(4, { fecha_inicio: '2026-08-10', created_at: dataset[2].created_at });
    dataset[2] = fila(3, { fecha_inicio: '2026-08-10' });
    const viejo = ordenar(dataset).map((f) => f.id);

    responder = (_fn, args) => ({ data: rpcSimulada(dataset, args), error: null });
    const nuevo: string[] = [];
    let cursor: string | null = null;
    let paginas = 0;
    do {
      const r: Awaited<ReturnType<typeof getViajesRegistro>> = await getViajesRegistro('t1', { cursor, porPagina: 5 });
      nuevo.push(...r.filas.map((f) => f.id));
      cursor = r.siguiente;
      paginas++;
    } while (cursor && paginas < 20);

    expect(paginas).toBe(5);
    expect(nuevo).toEqual(viejo);
    expect(new Set(nuevo).size).toBe(23);
  });
});

describe('getConteosViajes — cinco conteos en UNA RPC, degradan a null', () => {
  it('forma correcta → los cinco enteros', async () => {
    respuestaConteos = { data: { total: 7, abiertos: 4, enCuadre: 1, liquidados: 2, escalados: 1 }, error: null };
    expect(await getConteosViajes('t1')).toEqual({ total: 7, abiertos: 4, enCuadre: 1, liquidados: 2, escalados: 1 });
    expect(llamadas).toEqual([{ fn: 'conteos_viajes_tenant', args: { p_tenant: 't1' } }]);
  });

  it('tenant sin viajes → ceros (medición), no null', async () => {
    respuestaConteos = { data: { total: 0, abiertos: 0, enCuadre: 0, liquidados: 0, escalados: 0 }, error: null };
    expect(await getConteosViajes('t1')).toEqual({ total: 0, abiertos: 0, enCuadre: 0, liquidados: 0, escalados: 0 });
  });

  it('error, forma ajena o llave faltante → null (la vista pinta "—"), nunca un 0 inventado', async () => {
    respuestaConteos = { data: null, error: { message: 'boom' } };
    expect(await getConteosViajes('t1')).toBeNull();
    respuestaConteos = { data: [7, 4, 1, 2, 1], error: null };
    expect(await getConteosViajes('t1')).toBeNull();
    respuestaConteos = { data: { total: 7, abiertos: 4, enCuadre: 1, liquidados: 2 }, error: null };
    expect(await getConteosViajes('t1')).toBeNull();
    respuestaConteos = { data: { total: '7', abiertos: 4, enCuadre: 1, liquidados: 2, escalados: 1 }, error: null };
    expect(await getConteosViajes('t1')).toBeNull();
  });
});
