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
// `.not('id', 'in', …)` (hallazgo ALTO, solo en el catálogo de unidad):
// misma forma que `eqActivo` después — sigue aceptando `order`/`ilike`.
const notLista = vi.fn(() => ({ order: orderLista, ilike: ilikeLista }));
const eqActivo = vi.fn(() => ({ order: orderLista, ilike: ilikeLista, not: notLista }));
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
// A37-S18-04: el UPDATE lleva `.select('id')` para contar filas afectadas.
const eqTenantUpdate = vi.fn(() => ({ select: () => updateResult() }));
const eqViajeUpdate = vi.fn(() => ({ eq: eqTenantUpdate }));
const update = vi.fn(() => ({ eq: eqViajeUpdate }));

// El operador que tenía el viaje ANTES del cambio (`select('operador_id')` + dos `.eq` + `maybeSingle`).
const previoResult = vi.fn();
const selectPrevio = vi.fn(() => ({ eq: () => ({ eq: () => ({ maybeSingle: () => previoResult() }) }) }));

// `unidadesConViajeAbierto` (hallazgo ALTO, repo.ts): `select('unidad_id',
// conteo) .eq(tenant) .in(estatus) .not(unidad_id is null) .order .range` —
// la MISMA escalera paginada que `traerTodo` usa en todo el archivo, pero
// sobre `viaje` y no sobre `operador`/`cliente`/`unidad`.
const abiertasResult = vi.fn();
const rangeAbiertas = vi.fn(() => abiertasResult());
const orderAbiertas = vi.fn(() => ({ range: rangeAbiertas }));
const notAbiertas = vi.fn(() => ({ order: orderAbiertas }));
const inAbiertas = vi.fn(() => ({ not: notAbiertas }));
const eqTenantAbiertas = vi.fn(() => ({ in: inAbiertas }));
const selectAbiertas = vi.fn(() => ({ eq: eqTenantAbiertas }));

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
  // `viaje` sirve a DOS llamadores con formas distintas: `reasignarOperador`
  // (columnas `operador_id`, `selectPrevio`) y `unidadesConViajeAbierto`
  // (columnas `unidad_id`, `selectAbiertas`) — igual que `operador` arriba,
  // se distinguen por las columnas pedidas.
  if (tabla === 'viaje') {
    return { update, select: (cols: string) => (cols.includes('unidad_id') ? selectAbiertas() : selectPrevio()) };
  }
  if (tabla !== 'operador') return { update, select: selectPrevio };
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
    limitLista.mockClear(); orderLista.mockClear(); ilikeLista.mockClear(); notLista.mockClear();
    // Por omisión, ninguna unidad tiene viaje abierto — las pruebas que no
    // son del hallazgo ALTO (abajo) no deben notar que esta consulta existe.
    abiertasResult.mockReset(); abiertasResult.mockResolvedValue({ data: [], error: null, count: 0 });
    rangeAbiertas.mockClear(); orderAbiertas.mockClear(); notAbiertas.mockClear();
    inAbiertas.mockClear(); eqTenantAbiertas.mockClear(); selectAbiertas.mockClear();
  });

  it('la unidad se busca y se ordena por numero_economico, no por nombre', async () => {
    listaResult.mockResolvedValue({ data: [{ id: 'u-1', numero_economico: 'T-014' }], error: null });
    const r = await buscarCatalogo('t-1', 'unidad', 'T-0');
    expect(from).toHaveBeenCalledWith('unidad');
    expect(ilikeLista).toHaveBeenCalledWith('numero_economico', '%T-0%');
    expect(orderLista).toHaveBeenCalledWith('numero_economico');
    expect(r).toEqual([{ id: 'u-1', etiqueta: 'T-014' }]);
  });

  // R15-ux-01 (auditoría 35): dos operadores activos con el MISMO nombre daban dos
  // etiquetas idénticas y el combo resolvía al primero → el viaje y el WhatsApp
  // del anticipo iban al homónimo equivocado. Solo el teléfono es único (0024).
  it('R15-ux-01: homónimos salen con etiqueta distinta (últimos 4 del teléfono) y el mismo id', async () => {
    listaResult.mockResolvedValue({ data: [
      { id: 'o-1', nombre: 'José Hernández', telefono: '+529991114821' },
      { id: 'o-2', nombre: 'José Hernández', telefono: '+529992220077' },
      { id: 'o-3', nombre: 'Ana Ruiz', telefono: '+529993330001' },
    ], error: null });
    const r = await buscarCatalogo('t-1', 'operador', 'jos');
    expect(r.map((o) => o.id)).toEqual(['o-1', 'o-2', 'o-3']);
    expect(r[0].etiqueta).toBe('José Hernández · tel. ···4821');
    expect(r[1].etiqueta).toBe('José Hernández · tel. ···0077');
    // Quien no tiene homónimo conserva su nombre limpio: no se ensucia el rótulo.
    expect(r[2].etiqueta).toBe('Ana Ruiz');
    expect(new Set(r.map((o) => o.etiqueta.toLowerCase())).size).toBe(3);
  });

  it('R15-ux-01: si además coincide el teléfono (o falta) añade ordinal; nunca quedan dos etiquetas iguales', async () => {
    listaResult.mockResolvedValue({ data: [
      { id: 'o-1', nombre: 'Luis Gómez', telefono: null },
      { id: 'o-2', nombre: 'luis gómez', telefono: null },
    ], error: null });
    const r = await buscarCatalogo('t-1', 'operador');
    expect(new Set(r.map((o) => o.etiqueta.toLowerCase())).size).toBe(2);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // HALLAZGO ALTO: el combo de unidades no debía EXCLUIR las que ya están en
  // un viaje abierto — el jefe de tráfico podía elegirlas desde la UI y
  // chocar con el candado de servidor (operacion.ts) en vez de no verlas.
  // ═══════════════════════════════════════════════════════════════════════
  it('el catálogo de UNIDAD consulta primero qué unidades tienen viaje abierto, acotado por tenant', async () => {
    listaResult.mockResolvedValue({ data: [{ id: 'u-1', numero_economico: 'T-014' }], error: null });
    await buscarCatalogo('t-1', 'unidad');
    expect(from).toHaveBeenCalledWith('viaje');
    expect(eqTenantAbiertas).toHaveBeenCalledWith('tenant_id', 't-1');
    expect(inAbiertas).toHaveBeenCalledWith('estatus', ['abierto', 'en_cuadre']);
    expect(notAbiertas).toHaveBeenCalledWith('unidad_id', 'is', null);
  });

  it('el catálogo de UNIDAD EXCLUYE las que ya tienen viaje abierto', async () => {
    abiertasResult.mockResolvedValue({ data: [{ unidad_id: 'u-1' }], error: null, count: 1 });
    listaResult.mockResolvedValue({ data: [{ id: 'u-2', numero_economico: 'T-020' }], error: null });
    const r = await buscarCatalogo('t-1', 'unidad');
    expect(notLista).toHaveBeenCalledWith('id', 'in', '(u-1)');
    expect(r).toEqual([{ id: 'u-2', etiqueta: 'T-020' }]);
  });

  it('con CERO unidades ocupadas, el catálogo de UNIDAD no manda ningún `.not(id, in, …)` — solo lo pide si hay algo que excluir', async () => {
    abiertasResult.mockResolvedValue({ data: [], error: null, count: 0 });
    listaResult.mockResolvedValue({ data: [{ id: 'u-1', numero_economico: 'T-014' }], error: null });
    const r = await buscarCatalogo('t-1', 'unidad');
    expect(notLista).not.toHaveBeenCalled();
    expect(r).toEqual([{ id: 'u-1', etiqueta: 'T-014' }]);
  });

  it('cliente y operador NO consultan viajes abiertos — la exclusión es SOLO de unidad', async () => {
    listaResult.mockResolvedValue({ data: [{ id: 'c-1', nombre: 'ACME' }], error: null });
    await buscarCatalogo('t-1', 'cliente');
    expect(from).not.toHaveBeenCalledWith('viaje');
    from.mockClear();
    listaResult.mockResolvedValue({ data: [{ id: 'o-1', nombre: 'Juan' }], error: null });
    await buscarCatalogo('t-1', 'operador');
    expect(from).not.toHaveBeenCalledWith('viaje');
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
    updateResult.mockReset(); propioResult.mockReset(); previoResult.mockReset(); selectPrevio.mockClear();
    previoResult.mockResolvedValue({ data: { operador_id: 'o-1' }, error: null });
    from.mockClear(); update.mockClear();
  });

  it('actualiza operador_id del viaje, acotado por tenant, cuando el operador SÍ es de esta flota', async () => {
    propioResult.mockResolvedValue({ data: { id: 'o-2', nombre: 'Ana', telefono: '52999', terminal: null }, error: null });
    updateResult.mockResolvedValue({ data: [{ id: 'v-1' }], error: null });

    const r = await reasignarOperador('t-1', 'v-1', 'o-2');
    expect(r).toEqual({ cambio: true, operadorAnteriorId: 'o-1' });

    expect(eqIdPropio).toHaveBeenCalledWith('id', 'o-2');
    expect(eqTenantPropio).toHaveBeenCalledWith('tenant_id', 't-1');
    expect(from).toHaveBeenCalledWith('viaje');
    // A34-01: lo MISMO para el rechazo. La 0855 añadió `viaje_rechazado_requiere_aviso`
    // (`rechazado_en is null or avisado_en is not null`), igual de incondicional que el de la
    // 0058, así que un viaje que el chofer RECHAZÓ explícitamente tampoco se podía reasignar:
    // `avisado_en = null` con `rechazado_en` puesto tumbaba el UPDATE entero.
    // A33-05: la aceptación del chofer ANTERIOR se limpia en el MISMO update. Sin eso,
    // `avisado_en = null` sobre un viaje ya aceptado rompe el CHECK `viaje_aceptado_requiere_aviso`
    // (0058:40-41) y la reasignación entera se cae. Se limpia junto con `aceptado_origen`, igual
    // que `retirar_voluntario` al devolver un viaje a «sin aceptar» (0800:91-93).
    // AUDITORÍA A8 ESCALACIÓN (ALTO, hallazgo 1): hay CAMBIO real de operador
    // (de 'o-1' a 'o-2'), así que el mismo UPDATE que mueve `operador_id`
    // resetea el reloj de aviso/escalación del chofer ANTERIOR — si no, el
    // nuevo chofer hereda el sello de alguien que ya ni tiene el viaje.
    expect(update).toHaveBeenCalledWith({ operador_id: 'o-2', avisado_en: null, escalado_en: null, avisos_enviados: 0, aceptado_en: null, aceptado_origen: null, rechazado_en: null });
    expect(eqViajeUpdate).toHaveBeenCalledWith('id', 'v-1');
    expect(eqTenantUpdate).toHaveBeenCalledWith('tenant_id', 't-1');
  });

  it('dice quién lo tenía: la primera asignación (sin chofer) y el mismo chofer se distinguen del cambio real', async () => {
    propioResult.mockResolvedValue({ data: { id: 'o-2', nombre: 'Ana', telefono: '52999', terminal: null }, error: null });
    updateResult.mockResolvedValue({ data: [{ id: 'v-1' }], error: null });
    previoResult.mockResolvedValue({ data: { operador_id: null }, error: null });
    expect(await reasignarOperador('t-1', 'v-1', 'o-2')).toEqual({ cambio: true, operadorAnteriorId: null });
    previoResult.mockResolvedValue({ data: { operador_id: 'o-2' }, error: null });
    expect(await reasignarOperador('t-1', 'v-1', 'o-2')).toEqual({ cambio: false, operadorAnteriorId: 'o-2' });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AUDITORÍA A8 ESCALACIÓN (ALTO, hallazgo 1): reasignar a OTRO chofer tiene
  // que resetear `avisado_en`/`escalado_en`/`avisos_enviados` — ese reloj es
  // del chofer, no del viaje, y `avisarAlChofer()` solo marca `avisado_en` la
  // PRIMERA vez (`.is('avisado_en', null)`).
  // ═══════════════════════════════════════════════════════════════════════
  describe('AUDITORÍA A8 — reset del reloj de aviso/escalación al reasignar', () => {
    beforeEach(() => {
      propioResult.mockResolvedValue({ data: { id: 'o-2', nombre: 'Ana', telefono: '52999', terminal: null }, error: null });
      updateResult.mockResolvedValue({ data: [{ id: 'v-1' }], error: null });
    });

    it('CAMBIO real de operador (o-1 → o-2): resetea los tres campos en el MISMO update', async () => {
      previoResult.mockResolvedValue({ data: { operador_id: 'o-1' }, error: null });
      const r = await reasignarOperador('t-1', 'v-1', 'o-2');
      expect(r.cambio).toBe(true);
      expect(update).toHaveBeenCalledWith({ operador_id: 'o-2', avisado_en: null, escalado_en: null, avisos_enviados: 0, aceptado_en: null, aceptado_origen: null, rechazado_en: null });
    });

    it('PRIMERA asignación (sin chofer previo): no hay reloj que heredar, pero tampoco hace daño resetearlo — el payload no lleva los tres campos porque ya nacen en null/0', async () => {
      previoResult.mockResolvedValue({ data: { operador_id: null }, error: null });
      await reasignarOperador('t-1', 'v-1', 'o-2');
      // `cambio` es true (null !== 'o-2'), pero no había reloj corriendo — el
      // único contrato que importa es que NO deje un reloj ajeno puesto, y
      // aquí nunca lo hubo.
      expect(update).toHaveBeenCalledWith({ operador_id: 'o-2', avisado_en: null, escalado_en: null, avisos_enviados: 0, aceptado_en: null, aceptado_origen: null, rechazado_en: null });
    });

    it('reasignar al MISMO operador (sin cambio real): NO toca el reloj — sigue corriendo para ese chofer', async () => {
      previoResult.mockResolvedValue({ data: { operador_id: 'o-2' }, error: null });
      const r = await reasignarOperador('t-1', 'v-1', 'o-2');
      expect(r.cambio).toBe(false);
      // Sin los tres campos: un clic repetido de "asignar" sobre el mismo
      // chofer no debe reiniciar un plazo de escalación que ya está corriendo.
      expect(update).toHaveBeenCalledWith({ operador_id: 'o-2' });
    });
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

  it('A37-S18-04: un viaje inexistente o de otra flota (el UPDATE toca 0 filas) NO se reporta como asignado', async () => {
    propioResult.mockResolvedValue({ data: { id: 'o-2', nombre: 'Ana', telefono: '52999', terminal: null }, error: null });
    updateResult.mockResolvedValue({ data: [], error: null });
    await expect(reasignarOperador('t-1', 'v-ajeno', 'o-2')).rejects.toThrow(/no existe en tu flota/);
  });

  it('A37-S18-05: el choque con uq_viaje_abierto_por_operador sale como DatoInvalido con mensaje de pantalla', async () => {
    propioResult.mockResolvedValue({ data: { id: 'o-2', nombre: 'Ana', telefono: '52999', terminal: null }, error: null });
    updateResult.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_viaje_abierto_por_operador"' } });
    const { DatoInvalido } = await import('./errores');
    const e = await reasignarOperador('t-1', 'v-1', 'o-2').catch((x) => x);
    expect(e).toBeInstanceOf(DatoInvalido);
    expect(e.message).toMatch(/ya trae un viaje abierto/);
  });

  it('si el UPDATE falla, lanza con el mensaje', async () => {
    propioResult.mockResolvedValue({ data: { id: 'o-x', nombre: 'X', telefono: null, terminal: null }, error: null });
    updateResult.mockResolvedValue({ error: { message: 'operador no existe' } });
    await expect(reasignarOperador('t-1', 'v-1', 'o-x')).rejects.toThrow('operador no existe');
  });
});
