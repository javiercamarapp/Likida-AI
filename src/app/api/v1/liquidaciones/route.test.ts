import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24, BLOQUEANTE 6 — `GET /v1/liquidaciones` por llave API.
//
// El hueco: el TMS del piloto no tenía cómo traerse el cierre de un viaje (el
// único camino era un CSV con sesión de navegador). Lo que se prueba aquí es
// lo que hace útil al endpoint y no solo presente:
//   · abre con área `dinero` (hay pesos), no con `operacion`;
//   · por omisión trae LO ASENTABLE (aprobada + ajustada) y lo DECLARA;
//   · un `?revision=` desconocido es 400, no un default silencioso;
//   · pagina por llave `(created_at, id)`, con una fila de más;
//   · una página corta con total que dice que faltan filas NO se sirve como
//     la última.
// ═══════════════════════════════════════════════════════════════════════════

const abrir = vi.fn(async (_req: Request, _area: string): Promise<Record<string, unknown>> => ({ ok: true, tenantId: 't-1', rol: 'llave:dinero' }));
vi.mock('@/app/api/v1/_comun', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, abrir: (...a: [Request, string]) => abrir(...a) };
});
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
// AUDITORÍA 25 (BE-C1a/BE-C1b): `revision.ts` importa ahora `revision_recalculo.ts`
// (el recálculo del ajuste), que arrastra `repo.ts` y de ahí `conv.ts`, que sí
// usa `PRESUPUESTO_WEBHOOK_MS` — un mock que solo daba `acotada` rompía esa
// cadena aunque esta ruta nunca ejercita el camino de ajuste. `importOriginal`
// conserva el resto del módulo real y solo sustituye `acotada`.
vi.mock('@/lib/likida/presupuesto', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  acotada: (q: unknown) => q,
}));

interface Consulta {
  eq: Array<[string, unknown]>; in: Array<[string, unknown]>; or: string | null;
  orden: Array<[string, boolean]>; rango: [number, number] | null; opciones: Record<string, unknown> | undefined;
}
let consulta: Consulta;
let filas: Array<Record<string, unknown>> = [];
let conteo: number | null = null;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      consulta = { eq: [], in: [], or: null, orden: [], rango: null, opciones: undefined };
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: (_c: string, opt?: Record<string, unknown>) => { consulta.opciones = opt; return b; },
        eq: (c: string, v: unknown) => { consulta.eq.push([c, v]); return b; },
        in: (c: string, v: unknown) => { consulta.in.push([c, v]); return b; },
        or: (f: string) => { consulta.or = f; return b; },
        order: (c: string, o?: { ascending?: boolean }) => { consulta.orden.push([c, o?.ascending !== false]); return b; },
        range: (d: number, h: number) => { consulta.rango = [d, h]; return b; },
        then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => {
          const [d, h] = consulta.rango ?? [0, filas.length - 1];
          return Promise.resolve({ data: filas.slice(d, h + 1), error: null, count: conteo }).then(res, rej);
        },
      });
      return b;
    },
  }),
}));

const { GET } = await import('./route');

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const fila = (i: number, revision = 'aprobada') => ({
  id: U(i), viaje_id: U(500 + i), created_at: `2026-08-${String(28 - (i % 28)).padStart(2, '0')}T10:00:00+00:00`,
  total_comprobado: 4900, total_anticipo: 5000, diferencia: 100, estatus: 'cuadrada',
  diferencias: [{ tipo: 'x' }], revision, revisada_por_email: 'contralor@flota.mx',
  revisada_en: '2026-08-29T10:00:00+00:00', motivo: null, ajustes: null,
  iva_acreditable: 300, ieps_acreditable: 50, litros_diesel_acreditables: 120.5,
  viaje: { folio: `F-${i}` },
});
const pedir = (qs = '') => GET(new Request(`https://app.likida.ai/api/v1/liquidaciones${qs}`));

beforeEach(() => { abrir.mockClear(); filas = []; conteo = null; });

describe('GET /v1/liquidaciones', () => {
  it('abre con área `dinero`: el jefe de tráfico no ve el dinero de la flota', async () => {
    filas = [fila(1)];
    await pedir();
    expect(abrir.mock.calls[0][1]).toBe('dinero');
  });

  it('si la puerta no abre, devuelve SU respuesta sin leer la base', async () => {
    abrir.mockResolvedValueOnce({ ok: false, respuesta: new Response('no', { status: 401 }) });
    const r = await pedir();
    expect(r.status).toBe(401);
  });

  it('por omisión trae SOLO lo asentable (aprobada o ajustada) y lo dice en la respuesta', async () => {
    filas = [fila(1)];
    const r = await pedir();
    expect(r.status).toBe(200);
    expect(consulta.in).toEqual([['revision', ['aprobada', 'ajustada']]]);
    const cuerpo = await r.json() as { filtro: { revision: string; significado: string }; datos: Array<Record<string, unknown>> };
    expect(cuerpo.filtro.revision).toBe('firmadas');
    expect(cuerpo.filtro.significado).toMatch(/pendiente/);
    expect(cuerpo.datos[0]).toMatchObject({
      folio: 'F-1', revision: 'aprobada', revisadaPor: 'contralor@flota.mx',
      anticipo: 5000, comprobado: 4900, diferencia: 100, hallazgos: 1, litrosDieselAcreditables: 120.5,
    });
  });

  it('`?revision=pendiente` filtra por esa revisión; `?revision=todas` no filtra', async () => {
    filas = [fila(1, 'pendiente')];
    await pedir('?revision=pendiente');
    expect(consulta.eq).toEqual([['tenant_id', 't-1'], ['revision', 'pendiente']]);
    await pedir('?revision=todas');
    expect(consulta.eq).toEqual([['tenant_id', 't-1']]);
    expect(consulta.in).toEqual([]);
  });

  it('un `?revision=` desconocido es 400 — no se recorta en silencio al default', async () => {
    const r = await pedir('?revision=aprobadas');
    expect(r.status).toBe(400);
    const { error } = await r.json() as { error: { codigo: string } };
    expect(error.codigo).toBe('parametro_invalido');
  });

  it('pagina por llave (created_at, id) descendente, con una fila de más, y emite cursor', async () => {
    filas = Array.from({ length: 4 }, (_, i) => fila(i));
    const r = await pedir('?limite=3');
    expect(consulta.orden).toEqual([['created_at', false], ['id', false]]);
    expect(consulta.rango).toEqual([0, 3]);
    const cuerpo = await r.json() as { datos: unknown[]; pagina: { hayMas: boolean; siguiente: string | null; total: number | null } };
    expect(cuerpo.datos).toHaveLength(3);
    expect(cuerpo.pagina.hayMas).toBe(true);
    expect(cuerpo.pagina.siguiente).toBeTruthy();
    expect(cuerpo.pagina.total).toBeNull();

    const { decodificarCursor } = await import('../_comun');
    const cur = decodificarCursor(cuerpo.pagina.siguiente!)!;
    expect(cur.id).toBe(filas[2].id);
    await pedir(`?limite=3&despues=${cuerpo.pagina.siguiente}`);
    expect(consulta.or).toBe(`created_at.lt.${cur.creadoEn},and(created_at.eq.${cur.creadoEn},id.lt.${cur.id})`);
  });

  it('una página corta con total que dice que faltan filas NO se sirve como la última', async () => {
    filas = [fila(1)];
    conteo = 900;
    const r = await pedir('?limite=50&conteo=1');
    // 500 y no 400: la petición estaba bien, quien no entregó fue la base
    // (`lectura_incompleta` en `_comun.ts` — reintentar no lo arregla).
    expect(r.status).toBe(500);
    const { error } = await r.json() as { error: { codigo: string } };
    expect(error.codigo).toBe('lectura_incompleta');
  });
});
