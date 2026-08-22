import { describe, it, expect, vi, beforeEach } from 'vitest';

// listOperadores / reasignarOperador — la lectura y la escritura que Task 3
// del plan de roles necesita para que `encargado`/`flota_admin` puedan mover
// un viaje de un chofer a otro desde el panel.
//
// AUDITORÍA 10, ALTO: `reasignarOperador` escribía `operador_id` en `viaje`
// acotando el UPDATE por `tenant_id` — pero nunca comprobaba que el
// `operadorId` recibido fuera de ESE MISMO tenant. El `<select>` de
// /dashboard/despacho solo ofrece los de `listOperadores(tenantId)`, pero eso
// es una restricción de la UI, no del servidor: un POST directo al server
// action (basta devtools, no hace falta curl) con el `operadorId` de OTRA
// flota dejaba `viaje.tenant_id = A` apuntando a un `operador_id` de B. La
// RLS del chofer (0045_rls_operador.sql, policy `operador_ve_su_viaje`) no
// vuelve a comprobar tenant — solo `operador_id = get_user_operador_id()` —,
// así que el chofer de B, al entrar a /chofer, vería ese viaje (y sus gastos
// y su liquidación) de la flota A. Ahora `reasignarOperador` comprueba
// primero, vía `getOperador(operadorId, tenantId)`, que el operador SÍ es de
// esta flota antes de escribir nada.

// ── FE-2 (22-ago-2026) ──────────────────────────────────────────────────────
// `listOperadores` NO llevaba `.limit()`: a 7,500 choferes PostgREST recortaba
// a 1,000 en silencio y el chofer 1,001 no existía para el despacho. Ahora
// delega en `buscarCatalogo`, que tiene tope (`TOPE_CATALOGO`), ordena y
// admite `q` — por eso la cadena del mock lleva `ilike`, `order` y `limit`.
const listaResult = vi.fn();
const limitLista = vi.fn(() => listaResult());
const orderLista = vi.fn(() => ({ limit: limitLista }));
const ilikeLista = vi.fn(() => ({ order: orderLista }));
const eqActivo = vi.fn(() => ({ order: orderLista, ilike: ilikeLista }));
const eqTenantLista = vi.fn(() => ({ eq: eqActivo }));
const selectLista = vi.fn(() => ({ eq: eqTenantLista }));

const conteoResult = vi.fn();
const eqActivoConteo = vi.fn(() => conteoResult());
const eqTenantConteo = vi.fn(() => ({ eq: eqActivoConteo }));
const selectConteo = vi.fn(() => ({ eq: eqTenantConteo }));

const propioResult = vi.fn();
const eqTenantPropio = vi.fn(() => ({ maybeSingle: () => propioResult() }));
const eqIdPropio = vi.fn(() => ({ eq: eqTenantPropio }));
const selectPropio = vi.fn(() => ({ eq: eqIdPropio }));

const updateResult = vi.fn();
const eqTenantUpdate = vi.fn(() => updateResult());
const eqViajeUpdate = vi.fn(() => ({ eq: eqTenantUpdate }));
const update = vi.fn(() => ({ eq: eqViajeUpdate }));

/**
 * `select()` de la tabla `operador` sirve a DOS llamadores con formas
 * distintas: `listOperadores` (columnas `id, nombre`, filtra activo+tenant,
 * ordena) y `getOperador` (columnas con join a terminal, filtra id+tenant,
 * `maybeSingle`). Se distinguen por las columnas pedidas — es lo único que el
 * mock puede ver antes de que decidan qué `.eq()` encadenar.
 */
const from = vi.fn((tabla: string) => {
  // Los otros dos catálogos de FE-2 usan la MISMA forma de consulta que
  // `listOperadores` — es el punto de `buscarCatalogo`: una sola escalera.
  if (tabla === 'cliente' || tabla === 'unidad') {
    return { select: (_c: string, opts?: unknown) => (opts ? selectConteo() : selectLista()) };
  }
  if (tabla !== 'operador') return { update };
  return {
    // `getOperador` pide el join a `terminal` (lo usa `avisarAlChofer`); es lo
    // único que la distingue de `listOperadores`, que solo pide `id, nombre`.
    // `contarCatalogo` se distingue por su segundo argumento (`{ count }`).
    select: (cols: string, opts?: unknown) => (
      opts ? selectConteo() : cols.includes('terminal') ? selectPropio() : selectLista()
    ),
  };
});
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (...a: unknown[]) => from(...(a as [string])) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { listOperadores, reasignarOperador, buscarCatalogo, contarCatalogo, sanearCatalogo, TOPE_CATALOGO } = await import('./repo');

describe('listOperadores', () => {
  beforeEach(() => {
    listaResult.mockReset(); from.mockClear();
    limitLista.mockClear(); orderLista.mockClear(); ilikeLista.mockClear();
  });

  it('trae solo los activos del tenant, ordenados por nombre', async () => {
    listaResult.mockResolvedValue({ data: [{ id: 'o-1', nombre: 'Juan Pérez' }, { id: 'o-2', nombre: 'Ana Ruiz' }], error: null });
    const r = await listOperadores('t-1');
    expect(from).toHaveBeenCalledWith('operador');
    expect(eqTenantLista).toHaveBeenCalledWith('tenant_id', 't-1');
    expect(eqActivo).toHaveBeenCalledWith('activo', true);
    expect(r).toEqual([{ id: 'o-1', nombre: 'Juan Pérez' }, { id: 'o-2', nombre: 'Ana Ruiz' }]);
  });

  // LA PRUEBA DE FE-2. Sin `.limit()`, PostgREST recorta a 1,000 SIN AVISAR:
  // con 7,500 choferes el 1,001 dejaba de existir para el despacho y nada en
  // la pantalla lo decía. El tope explícito es lo que convierte un recorte
  // invisible en una decisión de producto ("20 y busca para más").
  it('FE-2: la consulta lleva .limit() — nunca se deja al recorte silencioso de PostgREST', async () => {
    listaResult.mockResolvedValue({ data: [], error: null });
    await listOperadores('t-1');
    expect(limitLista).toHaveBeenCalledWith(TOPE_CATALOGO);
    expect(orderLista).toHaveBeenCalledWith('nombre');
  });

  it('con `q` filtra en la BASE, no en memoria', async () => {
    listaResult.mockResolvedValue({ data: [{ id: 'o-9', nombre: 'Hernández' }], error: null });
    await listOperadores('t-1', { q: 'hern' });
    expect(ilikeLista).toHaveBeenCalledWith('nombre', '%hern%');
  });

  it('el límite nunca sube por encima del tope, aunque lo pidan', async () => {
    listaResult.mockResolvedValue({ data: [], error: null });
    await listOperadores('t-1', { limite: 5000 });
    expect(limitLista).toHaveBeenCalledWith(TOPE_CATALOGO);
  });

  it('si la consulta falla, lanza — un listado vacío por error se leería como "sin choferes"', async () => {
    listaResult.mockResolvedValue({ data: null, error: { message: 'timeout' } });
    await expect(listOperadores('t-1')).rejects.toThrow('timeout');
  });
});

describe('buscarCatalogo / contarCatalogo (FE-2)', () => {
  beforeEach(() => {
    listaResult.mockReset(); conteoResult.mockReset(); from.mockClear();
    limitLista.mockClear(); orderLista.mockClear(); ilikeLista.mockClear();
  });

  it('la unidad se busca y se ordena por numero_economico, no por nombre', async () => {
    listaResult.mockResolvedValue({ data: [{ id: 'u-1', numero_economico: 'T-014' }], error: null });
    const r = await buscarCatalogo('t-1', 'unidad', 'T-0');
    expect(from).toHaveBeenCalledWith('unidad');
    expect(ilikeLista).toHaveBeenCalledWith('numero_economico', '%T-0%');
    expect(orderLista).toHaveBeenCalledWith('numero_economico');
    expect(r).toEqual([{ id: 'u-1', etiqueta: 'T-014' }]);
  });

  it('sin `q` no se manda ilike: el arranque del combo son los primeros N', async () => {
    listaResult.mockResolvedValue({ data: [], error: null });
    await buscarCatalogo('t-1', 'cliente');
    expect(from).toHaveBeenCalledWith('cliente');
    expect(ilikeLista).not.toHaveBeenCalled();
  });

  // Un `%` tecleado convertiría la búsqueda en "tráemelos todos" — justo el
  // barrido que este cambio existe para no hacer.
  it('sanea los comodines de LIKE antes de que lleguen a la base', () => {
    expect(sanearCatalogo('  %Juan_  ')).toBe('Juan');
    expect(sanearCatalogo('a,(b)')).toBe('a b');
    expect(sanearCatalogo(undefined)).toBe('');
  });

  it('contarCatalogo pide count exact head y NO trae filas', async () => {
    conteoResult.mockResolvedValue({ count: 7500, error: null });
    expect(await contarCatalogo('t-1', 'operador')).toBe(7500);
    expect(eqTenantConteo).toHaveBeenCalledWith('tenant_id', 't-1');
    expect(eqActivoConteo).toHaveBeenCalledWith('activo', true);
  });

  // `null` ≠ 0: "no se pudo contar" no puede pintarse como "no tienes
  // choferes dados de alta", que manda a dar de alta a alguien que ya existe.
  it('un fallo del conteo devuelve null, nunca cero', async () => {
    conteoResult.mockResolvedValue({ count: null, error: { message: 'caída' } });
    expect(await contarCatalogo('t-1', 'operador')).toBeNull();
  });
});

describe('reasignarOperador', () => {
  beforeEach(() => {
    updateResult.mockReset(); propioResult.mockReset();
    from.mockClear(); update.mockClear();
  });

  it('actualiza operador_id del viaje, acotado por tenant, cuando el operador SÍ es de esta flota', async () => {
    propioResult.mockResolvedValue({ data: { id: 'o-2', nombre: 'Ana', telefono: '52999', terminal: null }, error: null });
    updateResult.mockResolvedValue({ error: null });

    await reasignarOperador('t-1', 'v-1', 'o-2');

    expect(eqIdPropio).toHaveBeenCalledWith('id', 'o-2');
    expect(eqTenantPropio).toHaveBeenCalledWith('tenant_id', 't-1');
    expect(from).toHaveBeenCalledWith('viaje');
    expect(update).toHaveBeenCalledWith({ operador_id: 'o-2' });
    expect(eqViajeUpdate).toHaveBeenCalledWith('id', 'v-1');
    expect(eqTenantUpdate).toHaveBeenCalledWith('tenant_id', 't-1');
  });

  it('AUDITORÍA 10: RECHAZA reasignar a un operador de OTRA flota, y no toca el viaje', async () => {
    // Mismo id, pero `getOperador` filtra por `tenant_id = 't-1'` y ese
    // operador no vive ahí (es de 't-2') — la consulta acotada no lo trae.
    propioResult.mockResolvedValue({ data: null, error: null });

    await expect(reasignarOperador('t-1', 'v-1', 'o-de-otra-flota')).rejects.toThrow(
      'reasignarOperador: el operador no pertenece a esta flota',
    );
    // La prueba de mutación: si alguien borra el candado y deja el UPDATE
    // directo, esta aserción es la que lo atrapa — sin ella, la prueba de
    // arriba (con `propioResult` en éxito) seguiría verde igual.
    expect(update).not.toHaveBeenCalled();
  });

  it('si el UPDATE falla, lanza con el mensaje', async () => {
    propioResult.mockResolvedValue({ data: { id: 'o-x', nombre: 'X', telefono: null, terminal: null }, error: null });
    updateResult.mockResolvedValue({ error: { message: 'operador no existe' } });
    await expect(reasignarOperador('t-1', 'v-1', 'o-x')).rejects.toThrow('operador no existe');
  });
});
