import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 6 · CRÍTICO del rubro pruebas — LAS TRES FUNCIONES QUE DECIDEN DE
// QUIÉN ES EL DINERO NO TENÍAN NI UNA PRUEBA DIRECTA.
//
// `resolveOperador` (a quién se le carga el gasto), `getOpenViaje` (a qué viaje)
// e `intakeDelta` (si la barrera deja cerrar). Los tres arneses que ejecutan
// `processInbound` las MOCKEAN para que siempre tengan éxito, así que ni el
// camino de fallo ni el de ambigüedad corrían en ninguna parte — y son
// exactamente los que la ronda 5 encontró rotos, con el producto afirmando "no
// te tengo registrado" y "ese viaje ya quedó cerrado 👍" cuando la base
// simplemente no había contestado.
//
// El backend verificó por LECTURA que estaban bien; esto es la red que avisa el
// día que alguien las deshaga sin querer, que es como se rompió este rubro en la
// ronda 4.
// ═══════════════════════════════════════════════════════════════════════════

const maybeSingle = vi.fn();
const limit = vi.fn();
const rpc = vi.fn();

/**
 * Enlace encadenable y AWAITABLE a la vez, como el query builder real:
 * `resolveOperador` termina en `.limit(2)` y lo espera; `getOpenViaje` encadena
 * `.limit(1).maybeSingle()`. Un stub que solo soporta una de las dos formas hace
 * que la otra lance y la prueba mida cualquier cosa menos lo que dice medir.
 *
 * AUDITORÍA 7 · CRÍTICO PR-1 del rubro pruebas — el `.limit(n)` de aquí
 * IGNORABA `n` (estaba en la lista de métodos que solo devuelven `e`, sin
 * mirar el argumento). El `then()` delegaba en el mock externo `limit()` sin
 * pasarle cuántas filas pidió el código real. Resultado: cambiar
 * `resolveOperador` de `.limit(2)` a `.limit(1)` —justo el bug de "devuelve una
 * fila arbitraria y decide el tenant con ella", dinero de una flota anotado en
 * la de otra— era INVISIBLE para esta suite: las 11 pruebas seguían verdes.
 *
 * El fix: `.limit(n)` guarda `n` en una variable capturada, y `then()` trunca
 * el array de `data` a ese tamaño antes de resolver — replicando el efecto
 * real de Postgrest. Así, `.limit(1)` con un mock de DOS filas SÍ cambia el
 * resultado (una fila, no dos) y `resolveOperador` deja de ver la ambigüedad.
 */
let limiteFilas: number | undefined;
const enlace = () => {
  const e: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'in', 'order', 'not', 'gte']) e[m] = () => e;
  e.limit = (n: number) => { limiteFilas = n; return e; };
  e.maybeSingle = maybeSingle;
  e.then = (r: (v: unknown) => unknown, j?: (v: unknown) => unknown) =>
    limit().then((res: { data: unknown[] | null; error: unknown }) => {
      const truncado = res.data && limiteFilas != null ? res.data.slice(0, limiteFilas) : res.data;
      return r({ ...res, data: truncado });
    }, j);
  return e;
};

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: () => enlace(), rpc }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { resolveOperador, getOpenViaje, intakeDelta, ConsultaFallida, OperadorAmbiguo } =
  await import('./conv');

beforeEach(() => { maybeSingle.mockReset(); limit.mockReset(); rpc.mockReset(); limiteFilas = undefined; });

// ── resolveOperador: a quién se le carga el gasto ───────────────────────────

describe('resolveOperador', () => {
  it('un teléfono conocido resuelve a su operador', async () => {
    limit.mockResolvedValue({ data: [{ id: 'op1', tenant_id: 't1', nombre: 'Juan' }], error: null });
    const op = await resolveOperador('5219993700779');
    expect(op?.operadorId).toBe('op1');
    expect(op?.tenantId).toBe('t1');
  });

  it('un teléfono desconocido devuelve null: eso SÍ es "no hay"', async () => {
    limit.mockResolvedValue({ data: [], error: null });
    expect(await resolveOperador('5219990000000')).toBeNull();
  });

  it('si la base NO CONTESTA, lanza en vez de decir "no te tengo registrado"', async () => {
    // El CRÍTICO de la ronda 5. Devolver null aquí le dice a un operador dado de
    // alta que no existe, y el mensaje que sí hizo su trabajo se pierde.
    limit.mockResolvedValue({ data: null, error: { message: 'canceling statement due to statement timeout' } });
    await expect(resolveOperador('5219993700779')).rejects.toBeInstanceOf(ConsultaFallida);
  });

  it('con DOS operadores activos para el mismo teléfono, se niega a elegir', async () => {
    // Adivinar aquí carga el gasto a quien no fue. Pide dos filas justamente
    // para poder detectarlo.
    limit.mockResolvedValue({
      data: [
        { id: 'op1', tenant_id: 't1', nombre: 'Juan' },
        { id: 'op2', tenant_id: 't2', nombre: 'Pedro' },
      ],
      error: null,
    });
    await expect(resolveOperador('5219993700779')).rejects.toBeInstanceOf(OperadorAmbiguo);
  });
});

// ── getOpenViaje: a qué viaje se le carga ───────────────────────────────────

describe('getOpenViaje', () => {
  it('devuelve el viaje abierto del operador', async () => {
    maybeSingle.mockResolvedValue({ data: { id: 'v1' }, error: null });
    expect(await getOpenViaje('t1', 'op1')).toBe('v1');
  });

  it('sin viaje abierto devuelve null', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await getOpenViaje('t1', 'op1')).toBeNull();
  });

  it('si la base NO CONTESTA, lanza en vez de decir "ya quedó cerrado 👍"', async () => {
    // El otro lado del CRÍTICO: afirmar un cierre que nadie ejecutó hace que el
    // operador deje de mandar comprobantes.
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'TypeError: fetch failed' } });
    await expect(getOpenViaje('t1', 'op1')).rejects.toBeInstanceOf(ConsultaFallida);
  });
});

// ── intakeDelta: si la barrera de ráfaga deja cerrar ────────────────────────

describe('intakeDelta', () => {
  it('devuelve el contador de fotos en vuelo', async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    expect(await intakeDelta('v1', 1)).toBe(3);
  });

  it('ante un error de la RPC devuelve null, NO 0', async () => {
    // El más caro de los cuatro: 0 abre la barrera, la liquidación cierra sin la
    // última foto, y si era el diésel de $8,000 el operador lo paga de su bolsa.
    rpc.mockResolvedValue({ data: null, error: { message: 'function intake_delta does not exist' } });
    expect(await intakeDelta('v1', 1)).toBeNull();
  });

  it('una EXCEPCIÓN sí se propaga, y eso también es fail-closed', async () => {
    // Distinto del error por valor a propósito. `esperarIntake` solo abre la
    // barrera cuando el contador es un número <= 0; una excepción sube hasta el
    // catch de `processInbound`, que le dice al operador que no se pudo
    // consultar y libera el claim. Lo que NO puede pasar es que se convierta en
    // un 0 y la liquidación cierre sin la última foto.
    rpc.mockImplementation(() => { throw new TypeError('fetch failed'); });
    await expect(intakeDelta('v1', 1)).rejects.toThrow('fetch failed');
  });

  it('un cero REAL sigue siendo cero: no todo null es fallo', async () => {
    rpc.mockResolvedValue({ data: 0, error: null });
    expect(await intakeDelta('v1', 0)).toBe(0);
  });
});
