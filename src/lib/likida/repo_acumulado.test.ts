import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL CONTADOR DEL 15% LEÍA LO QUE POSTGREST QUISIERA DARLE.
//
// `getAcumuladoCombustible` pedía todos los gastos de diésel del ejercicio sin
// `.limit()` ni `.range()`. Eso no quiere decir "trae todo": `max_rows` (Settings
// → API) recorta la respuesta SIN error y SIN aviso, y el default de Supabase son
// 1 000 filas. Una flota de 50 operadores hace ~18 000 cargas al año.
//
// El número que sale de aquí es el DENOMINADOR del 15% de combustible en
// efectivo de la RFA 2026 regla 2.9. Recortado, hace parecer holgada a una flota
// que ya se pasó — el error exacto que el comentario de la función dice evitar.
//
// El servidor de mentira de abajo hace lo ÚNICO que hacía falta para que esto se
// viera: respetar `max_rows`. Ningún test lo hacía, y por eso el recorte pasó
// tres auditorías.
// ═══════════════════════════════════════════════════════════════════════════

type Fila = { monto: number; forma_pago: string | null };

/** Estado del "servidor": el dataset y su tope de filas por respuesta. */
const servidor: { filas: Fila[]; maxRows: number; peticiones: Array<[number, number]>; mentirCount: number | null } = {
  filas: [], maxRows: 1_000, peticiones: [], mentirCount: null,
};

function constructor() {
  let desde = 0;
  let hasta = Number.MAX_SAFE_INTEGER;
  let pideCount = false;
  const b = {
    select(_cols: string, opts?: { count?: string }) { pideCount = opts?.count === 'exact'; return b; },
    eq() { return b; },
    gte() { return b; },
    lte() { return b; },
    or() { return b; },
    order() { return b; },
    range(f: number, t: number) { desde = f; hasta = t; return b; },
    then(res: (v: unknown) => void) {
      servidor.peticiones.push([desde, hasta]);
      const pedidas = hasta - desde + 1;
      const data = servidor.filas.slice(desde, desde + Math.min(pedidas, servidor.maxRows));
      res({ data, error: null, count: pideCount ? (servidor.mentirCount ?? servidor.filas.length) : null });
    },
  };
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => constructor() }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { getAcumuladoCombustible } = await import('./repo');

/** n cargas: la mitad en efectivo ('01') a $1 000, la otra mitad con tarjeta a $2 000. */
function cargas(n: number): Fila[] {
  return Array.from({ length: n }, (_, i) => (i % 2 === 0
    ? { monto: 1_000, forma_pago: '01' }
    : { monto: 2_000, forma_pago: '04' }));
}

beforeEach(() => { servidor.filas = []; servidor.maxRows = 1_000; servidor.peticiones = []; servidor.mentirCount = null; });

describe('getAcumuladoCombustible contra el max_rows de PostgREST', () => {
  it('con 2 500 cargas y un tope de 1 000, suma las 2 500', async () => {
    // Antes de paginar, esto devolvía la suma de las primeras 1 000: efectivo
    // $500 000 y total $1 500 000. O sea el 40% del combustible del ejercicio,
    // presentado como si fuera el ejercicio entero.
    servidor.filas = cargas(2_500);
    const r = await getAcumuladoCombustible('t1', 2026);
    expect(r.efectivo).toBe(1_250_000);            // 1 250 cargas × $1 000
    expect(r.totalCombustible).toBe(3_750_000);    // + 1 250 × $2 000
    expect(servidor.peticiones).toHaveLength(3);   // 1 000 + 1 000 + 500
  });

  it('un tenant que cabe en una página sigue costando UNA consulta', async () => {
    // La paginación no puede volverse un impuesto sobre el caso normal: el
    // `count` viene en la misma respuesta, así que saber que ya se leyó todo no
    // cuesta un viaje de red extra.
    servidor.filas = cargas(300);
    const r = await getAcumuladoCombustible('t1', 2026);
    expect(r.totalCombustible).toBe(450_000);
    expect(servidor.peticiones).toHaveLength(1);
  });

  it('funciona aunque el tope del servidor sea MENOR que la página que se pide', async () => {
    // `max_rows` es del proyecto, no del cliente. Si alguien lo baja a 400, el
    // recorte vuelve a caer del lado del servidor y la paginación tiene que
    // seguirle el paso en vez de creerse que ya terminó.
    servidor.filas = cargas(1_000);
    servidor.maxRows = 400;
    const r = await getAcumuladoCombustible('t1', 2026);
    expect(r.totalCombustible).toBe(1_500_000);
    expect(servidor.peticiones).toHaveLength(3);   // 400 + 400 + 200
  });

  it('sin datos devuelve ceros, y eso SÍ es una medición', async () => {
    const r = await getAcumuladoCombustible('t1', 2026);
    expect(r).toEqual({ efectivo: 0, totalCombustible: 0 });
    expect(servidor.peticiones).toHaveLength(1);
  });

  it('si no se pudo leer todo, LANZA en vez de devolver una cifra baja', async () => {
    // Fail-closed, igual que el resto del camino del dinero. Devolver el
    // acumulado de la mitad de las cargas es afirmar un número fiscal que no se
    // midió, y a la baja es la dirección que nadie revisa.
    servidor.filas = cargas(500);
    servidor.mentirCount = 50_000;     // el servidor dice que hay 50 000 y entrega 500
    await expect(getAcumuladoCombustible('t1', 2026)).rejects.toThrow(/solo se leyeron 500 de 50000/);
  });
});
