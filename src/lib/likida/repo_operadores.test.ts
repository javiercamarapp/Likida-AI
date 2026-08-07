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

const listaResult = vi.fn();
const eqActivo = vi.fn(() => ({ order: () => listaResult() }));
const eqTenantLista = vi.fn(() => ({ eq: eqActivo }));
const selectLista = vi.fn(() => ({ eq: eqTenantLista }));

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
  if (tabla !== 'operador') return { update };
  return {
    // `getOperador` pide el join a `terminal` (lo usa `avisarAlChofer`); es lo
    // único que la distingue de `listOperadores`, que solo pide `id, nombre`.
    select: (cols: string) => (cols.includes('terminal') ? selectPropio() : selectLista()),
  };
});
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (...a: unknown[]) => from(...(a as [string])) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { listOperadores, reasignarOperador } = await import('./repo');

describe('listOperadores', () => {
  beforeEach(() => { listaResult.mockReset(); from.mockClear(); });

  it('trae solo los activos del tenant, ordenados por nombre', async () => {
    listaResult.mockResolvedValue({ data: [{ id: 'o-1', nombre: 'Juan Pérez' }, { id: 'o-2', nombre: 'Ana Ruiz' }], error: null });
    const r = await listOperadores('t-1');
    expect(from).toHaveBeenCalledWith('operador');
    expect(eqTenantLista).toHaveBeenCalledWith('tenant_id', 't-1');
    expect(eqActivo).toHaveBeenCalledWith('activo', true);
    expect(r).toEqual([{ id: 'o-1', nombre: 'Juan Pérez' }, { id: 'o-2', nombre: 'Ana Ruiz' }]);
  });

  it('si la consulta falla, lanza — un listado vacío por error se leería como "sin choferes"', async () => {
    listaResult.mockResolvedValue({ data: null, error: { message: 'timeout' } });
    await expect(listOperadores('t-1')).rejects.toThrow('timeout');
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
