import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// ESC-15 (escala 50k) — GET /v1/viajes PAGINA EN LA BASE.
//
// Antes: `getViajes(tenant, desplazamiento + limite)` traía la ventana entera
// —hasta 1,000 filas— y se rebanaba en memoria la página de 50; el techo de
// 1,000 es, a 50k viajes/mes, MENOS DE UN DÍA, así que el histórico no tenía
// por dónde recorrerse. Y cada petición pagaba un `count(*)` de la flota.
//
// La "base" de esta prueba aplica DE VERDAD el filtro `.or()` que manda la
// ruta y el `range` que pide: si el cursor se arma mal, aquí se repiten o se
// pierden filas — que es el fallo contra el que advierte `pg.ts`.
// ═══════════════════════════════════════════════════════════════════════════

let tenant: { ok: true; tenantId: string; rol: string } | { ok: false; status: 401; motivo: string } =
  { ok: true, tenantId: 't-1', rol: 'flota_admin' };
vi.mock('@/lib/auth/tenant-api', () => ({ resolverTenantApi: async () => tenant }));
vi.mock('@/lib/auth/llave-api', () => ({ llaveDelHeader: () => null, resolverLlave: async () => ({ ok: false, status: 401, motivo: 'no' }) }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => true, clientIp: () => '1.2.3.4' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));

/** El registro completo de la flota, ya ordenado como lo ordena la base:
 *  created_at DESC, id DESC. Dos filas comparten instante a propósito. */
const TOTAL = 2_500;
const instante = (i: number) => {
  // Estrictamente descendiente… salvo las dos primeras, que COMPARTEN el
  // instante a propósito: el desempate por id es lo único que evita repetir
  // una y saltarse la otra entre dos páginas (la advertencia de `pg.ts`).
  const minutos = i <= 1 ? 0 : i - 1;
  return new Date(Date.UTC(2026, 7, 22) - minutos * 60_000).toISOString().replace('Z', '+00:00');
};
const viajes = Array.from({ length: TOTAL }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(TOTAL - i).padStart(12, '0')}`,
  folio: `V-${TOTAL - i}`, origen: 'MTY', destino: 'CDMX', estatus: 'abierto',
  fecha_inicio: '2026-08-01', intake_pendientes: 0, avisado_en: null, aceptado_en: null,
  escalado_en: null, avisos_enviados: 0,
  created_at: instante(i),
  operador: { nombre: `Chofer ${i}` },
}));

/** El techo del servidor (`max_rows`). Se baja en una prueba para reproducir
 *  el recorte silencioso. */
let maxRows = 1_000;
let errorBase: { message: string } | null = null;
const consultas: Array<{ filtros: Array<[string, unknown]>; or: string | null; rango: [number, number] | null; conteo: boolean }> = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const c = { filtros: [] as Array<[string, unknown]>, or: null as string | null, rango: null as [number, number] | null, conteo: false };
      consultas.push(c);
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: (_cols: string, opt?: { count?: string }) => { c.conteo = opt?.count === 'exact'; return b; },
        eq: (col: string, v: unknown) => { c.filtros.push([col, v]); return b; },
        or: (f: string) => { c.or = f; return b; },
        order: () => b,
        range: (d: number, h: number) => { c.rango = [d, h]; return b; },
        then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => {
          if (errorBase) return Promise.resolve({ data: null, error: errorBase, count: null }).then(res, rej);
          // Como la base: sólo la flota del filtro. Sin `eq('tenant_id')` no
          // sale una sola fila — un olvido en la ruta se ve aquí.
          let filas = c.filtros.some(([col, val]) => col === 'tenant_id' && val === 't-1') ? [...viajes] : [];
          if (c.or) {
            // El MISMO filtro que manda la ruta, interpretado de verdad:
            // `created_at.lt.X,and(created_at.eq.X,id.lt.Y)`
            const m = /^created_at\.lt\.(.+),and\(created_at\.eq\.(.+),id\.lt\.(.+)\)$/.exec(c.or);
            if (!m) throw new Error(`filtro de cursor irreconocible: ${c.or}`);
            const [, menor, igual, id] = m;
            filas = filas.filter((v) => v.created_at < menor || (v.created_at === igual && v.id < id));
          }
          const [d, h] = c.rango ?? [0, maxRows - 1];
          const data = filas.slice(d, Math.min(h + 1, d + maxRows));
          return Promise.resolve({ data, error: null, count: c.conteo ? filas.length : null }).then(res, rej);
        },
      });
      return b;
    },
  }),
}));

const { GET } = await import('./route');

const pedir = async (q = '') => {
  const r = await GET(new Request(`https://app.likida.ai/api/v1/viajes${q}`));
  return { status: r.status, cuerpo: await r.json() };
};

beforeEach(() => {
  tenant = { ok: true, tenantId: 't-1', rol: 'flota_admin' };
  consultas.length = 0;
  maxRows = 1_000;
  errorBase = null;
});

describe('la página la corta la BASE, no la memoria', () => {
  it('una petición = UNA consulta, con el tenant de la sesión y una fila de más', async () => {
    const { status, cuerpo } = await pedir('?limite=50');
    expect(status).toBe(200);
    expect(consultas).toHaveLength(1);
    expect(consultas[0].filtros).toEqual([['tenant_id', 't-1']]);
    // 51: la fila de más es lo que hace `hayMas` un hecho medido.
    expect(consultas[0].rango).toEqual([0, 50]);
    expect(cuerpo.datos).toHaveLength(50);
    expect(cuerpo.datos[0].folio).toBe('V-2500');
  });

  it('el conteo es OPT-IN: sin ?conteo=1 no se pide count(*) y `total` viene null — pero `hayMas` sigue siendo exacto', async () => {
    const { cuerpo } = await pedir('?limite=10');
    expect(consultas[0].conteo).toBe(false);
    expect(cuerpo.pagina.total).toBeNull();
    expect(cuerpo.pagina.hayMas).toBe(true);
  });

  it('con ?conteo=1 sí se pide, y el total es el de la flota', async () => {
    const { cuerpo } = await pedir('?limite=10&conteo=1');
    expect(consultas[0].conteo).toBe(true);
    expect(cuerpo.pagina.total).toBe(TOTAL);
  });

  it('la última página dice hayMas:false y `siguiente` null — no manda al integrador a pedir vacío', async () => {
    let q = '?limite=200';
    let ultima: { datos: unknown[]; pagina: { hayMas: boolean; siguiente: string | null } } | null = null;
    for (let i = 0; i < 20; i++) {
      const { cuerpo } = await pedir(q);
      ultima = cuerpo;
      if (!cuerpo.pagina.siguiente) break;
      q = `?limite=200&despues=${encodeURIComponent(cuerpo.pagina.siguiente)}`;
    }
    expect(ultima!.datos).toHaveLength(100); // 2,500 = 12×200 + 100
    expect(ultima!.pagina.hayMas).toBe(false);
    expect(ultima!.pagina.siguiente).toBeNull();
  });

  it('el anticipo NO sale (área operación): la fila de la API es exactamente la documentada', async () => {
    const { cuerpo } = await pedir('?limite=1');
    expect(Object.keys(cuerpo.datos[0]).sort()).toEqual([
      'aceptadoEn', 'avisadoEn', 'avisosEnviados', 'destino', 'escaladoEn', 'estatus',
      'fechaInicio', 'folio', 'id', 'intakePendientes', 'operador', 'origen',
    ]);
  });
});

describe('el cursor recorre TODO el histórico — lo que la ventana de 1,000 no dejaba', () => {
  it('20 páginas de 150 traen las 2,500 filas SIN repetir ni saltarse una (empate de created_at incluido)', async () => {
    const vistos: string[] = [];
    let q = '?limite=150';
    for (let i = 0; i < 30; i++) {
      const { status, cuerpo } = await pedir(q);
      expect(status, JSON.stringify(cuerpo)).toBe(200);
      vistos.push(...cuerpo.datos.map((v: { id: string }) => v.id));
      if (!cuerpo.pagina.siguiente) break;
      q = `?limite=150&despues=${encodeURIComponent(cuerpo.pagina.siguiente)}`;
    }
    expect(vistos).toHaveLength(TOTAL);
    expect(new Set(vistos).size).toBe(TOTAL);
    // …y en el mismo orden que da la base.
    expect(vistos).toEqual(viajes.map((v) => v.id));
  });

  it('el cursor pasa de la VENTANA de 1,000 donde `desplazamiento` es 400', async () => {
    // El techo por posición sigue vigente para quien lo use…
    expect((await pedir('?limite=200&desplazamiento=900')).status).toBe(400);
    // …y con cursor la fila 2,000 se alcanza sin tocarlo.
    let q = '?limite=200';
    let ultimo = '';
    for (let i = 0; i < 20; i++) {
      const { cuerpo } = await pedir(q);
      ultimo = cuerpo.datos.at(-1).folio;
      if (!cuerpo.pagina.siguiente) break;
      q = `?limite=200&despues=${encodeURIComponent(cuerpo.pagina.siguiente)}`;
    }
    expect(ultimo).toBe('V-1');
  });

  it('con cursor el `range` arranca en 0: la base no pagina por posición dos veces', async () => {
    const { cuerpo } = await pedir('?limite=10');
    consultas.length = 0;
    await pedir(`?limite=10&despues=${encodeURIComponent(cuerpo.pagina.siguiente)}`);
    expect(consultas[0].rango).toEqual([0, 10]);
    expect(consultas[0].or).toMatch(/^created_at\.lt\..+,and\(created_at\.eq\..+,id\.lt\..+\)$/);
  });

  it('un cursor inventado es 400 y NO llega a la base', async () => {
    const { status, cuerpo } = await pedir('?despues=nomames');
    expect(status).toBe(400);
    expect(cuerpo.error.codigo).toBe('parametro_invalido');
    expect(consultas).toEqual([]);
  });

  it('`despues` + `desplazamiento` es 400: dos formas de decir desde dónde no se mezclan', async () => {
    const { cuerpo } = await pedir('?limite=10');
    const r = await pedir(`?limite=10&desplazamiento=10&despues=${encodeURIComponent(cuerpo.pagina.siguiente)}`);
    expect(r.status).toBe(400);
  });
});

describe('lo que ya funcionaba sigue funcionando (compatibilidad del TMS que ya sincroniza)', () => {
  it('`desplazamiento` + `limite` dan la misma ventana de siempre, ahora con `range` real', async () => {
    const { cuerpo } = await pedir('?limite=50&desplazamiento=100');
    expect(consultas[0].rango).toEqual([100, 150]);
    expect(cuerpo.datos.map((v: { folio: string }) => v.folio)).toEqual(
      viajes.slice(100, 150).map((v) => v.folio),
    );
    expect(cuerpo.pagina).toMatchObject({ limite: 50, desplazamiento: 100, devueltos: 50, hayMas: true });
  });

  it('los topes de `limite` y de la ventana no se movieron', async () => {
    expect((await pedir('?limite=201')).status).toBe(400);
    expect((await pedir('?limite=200&desplazamiento=801')).status).toBe(400);
  });

  it('sin credencial: 401 y CERO consultas a la base', async () => {
    tenant = { ok: false, status: 401, motivo: 'Necesitas iniciar sesión.' };
    const { status, cuerpo } = await pedir();
    expect(status).toBe(401);
    expect(cuerpo.error.codigo).toBe('no_autenticado');
    expect(consultas).toEqual([]);
  });

  it('un error de la base es 500 con código, sin filtrar el mensaje de Postgres', async () => {
    errorBase = { message: 'relation "viaje" does not exist' };
    const { status, cuerpo } = await pedir();
    expect(status).toBe(500);
    expect(cuerpo.error.codigo).toBe('error_interno');
    expect(JSON.stringify(cuerpo)).not.toContain('relation');
  });

  it('EL RECORTE SILENCIOSO SIGUE ATRAPADO: max_rows por debajo de la página + conteo = lectura_incompleta, no una página corta', async () => {
    maxRows = 20;
    const { status, cuerpo } = await pedir('?limite=200&conteo=1');
    expect(status).toBe(500);
    expect(cuerpo.error.codigo).toBe('lectura_incompleta');
  });
});
