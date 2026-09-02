import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LOS CINCO CUBOS TIENEN QUE SUMAR EL TOTAL.
//
// `sat_descarga_conteos` (0236) devuelve CINCO cifras —`descargados` y su
// reparto en casado/ambiguo/disponible/ignorado, que es el dominio completo
// del CHECK de la 0231—. `ConteosVista` declaraba sólo cuatro y el mapeo
// tiraba `ignorados` en silencio.
//
// El daño no era perder un dato de adorno: era que las tarjetas NO CUADRABAN.
// Un contralor que lee «100 bajados» y debajo 40 + 5 + 20 tiene 35
// comprobantes desaparecidos y ninguna pantalla que le diga a dónde fueron —
// justo en la feature cuyo propósito es que confíe en que no se perdió nada.
// Y los `ignorado` no son marginales: ahí caen TODOS los consolidados ECC
// que ya entraron por su propio camino (`ciclo.ts`).
// ═══════════════════════════════════════════════════════════════════════════

type Resp = { data: unknown; error: { message: string } | null };
let respuestaRpc: Resp = { data: null, error: null };
const rpcs: Array<{ fn: string; args: unknown }> = [];

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: <T,>(q: T) => q }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b; b.eq = () => b; b.order = () => b; b.limit = () => b;
      b.maybeSingle = () => Promise.resolve({ data: null, error: null });
      b.then = (ok: (v: Resp) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
      return b;
    },
    rpc: (fn: string, args: unknown) => {
      rpcs.push({ fn, args });
      return Promise.resolve(respuestaRpc);
    },
  }),
}));

const { leerDescargaSat } = await import('./lectura');

const TENANT = '11111111-1111-1111-1111-111111111111';

beforeEach(() => { rpcs.length = 0; respuestaRpc = { data: null, error: null }; });

describe('conteos de la descarga del SAT', () => {
  it('trae las CINCO cifras, y el reparto suma el total', async () => {
    respuestaRpc = {
      data: [{ descargados: 100, casados: 40, ambiguos: 5, disponibles: 20, ignorados: 35 }],
      error: null,
    };
    const v = await leerDescargaSat(TENANT);

    expect(v.conteos).toEqual({ descargados: 100, casados: 40, ambiguos: 5, disponibles: 20, ignorados: 35 });
    expect(v.incompleta).toBe(false);

    // LA ASERCIÓN QUE IMPORTA: el reparto cuadra contra el total. Con
    // `ignorados` fuera del tipo, esto daba 65 contra 100 y la pantalla no
    // tenía dónde explicar los 35 que faltaban.
    const c = v.conteos!;
    expect(c.casados + c.ambiguos + c.disponibles + c.ignorados).toBe(c.descargados);
  });

  it('cuenta el tenant de la sesión y nada más', async () => {
    respuestaRpc = { data: [{ descargados: 0, casados: 0, ambiguos: 0, disponibles: 0, ignorados: 0 }], error: null };
    await leerDescargaSat(TENANT);
    expect(rpcs).toContainEqual({ fn: 'sat_descarga_conteos', args: { p_tenant: TENANT } });
  });

  it('un buzón vacío son CEROS medidos, no "no se pudo leer"', async () => {
    respuestaRpc = { data: [{ descargados: 0, casados: 0, ambiguos: 0, disponibles: 0, ignorados: 0 }], error: null };
    const v = await leerDescargaSat(TENANT);
    expect(v.conteos).toEqual({ descargados: 0, casados: 0, ambiguos: 0, disponibles: 0, ignorados: 0 });
    expect(v.incompleta).toBe(false);
  });

  it('si la consulta se cae, conteos es null e incompleta true — jamás cinco ceros', async () => {
    // El modo de falla caro de esta pantalla: cinco tarjetas en cero se leen
    // como «el SAT no tenía nada», no como «no pude preguntar».
    respuestaRpc = { data: null, error: { message: 'fetch failed' } };
    const v = await leerDescargaSat(TENANT);
    expect(v.conteos).toBeNull();
    expect(v.incompleta).toBe(true);
  });

  it('una respuesta sin filas tampoco se inventa', async () => {
    respuestaRpc = { data: [], error: null };
    const v = await leerDescargaSat(TENANT);
    expect(v.conteos).toBeNull();
    expect(v.incompleta).toBe(true);
  });
});
