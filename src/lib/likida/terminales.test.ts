// ═══════════════════════════════════════════════════════════════════════════
// LOS PATIOS — el escritor que `terminal` nunca tuvo (auditoría 24).
//
// La tabla existe desde la 0001 y la referencian `operador` y `viaje`, pero
// nada en `src/` la escribía. Lo que estas pruebas fijan es lo que hace que
// un patio sirva de patio y no de campo de texto libre:
//
//   1. «Patio Norte» ES UN PATIO, no ochocientas cadenas. El nombre se
//      normaliza y la unicidad de la base lo remata; el choque se dice en
//      palabras de quien capturó, no con el nombre del índice.
//   2. UN PATIO AJENO NO SE PUEDE USAR. Un uuid con forma correcta pero de
//      OTRA flota se rebota ANTES de escribir, con un mensaje que lo explica.
//      Es la misma línea que la FK compuesta de la 0298 defiende en la base:
//      dos redes para el mismo error, porque colgar 200 unidades del patio de
//      otra flota es un cruce de datos entre clientes.
//   3. UNA LECTURA A MEDIAS NO ES UN SELECTOR. `getTerminales` falla cerrado:
//      un selector corto mandaría unidades a «sin patio» sin que nadie lo note.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

const from = vi.fn();
const rpc = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (...a: unknown[]) => from(...(a as [])),
    rpc: (...a: unknown[]) => rpc(...(a as [])),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const anotarBitacora = vi.fn(async (_e: Record<string, unknown>) => {});
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: (e: unknown) => anotarBitacora(e as Record<string, unknown>) }));

const {
  getTerminales, crearTerminal, normalizarNombreTerminal,
  resolverTerminalDeFlota, asignarTerminalUnidad, MAX_TERMINALES,
  getTerminalesConConteos, editarTerminal, eliminarTerminal, terminalDeRegistro, terminalesDeRegistros,
  terminalDeUsuario, asignarTerminalOperador, asignarTerminalJefe, getJefesDeTrafico, contarSinPatio, asignarSinPatio,
} = await import('./terminales');
const { DatoInvalido } = await import('./errores');

const UUID = '11111111-2222-3333-4444-555555555555';
const UUID2 = '99999999-8888-7777-6666-555555555555';

/** Nodo encadenable de supabase-js. `fin` es lo que responde al final de la
 *  cadena (con `await`, `.maybeSingle()` o `.select()`), y `alInsert`/
 *  `alUpdate` capturan lo que se quiso escribir. */
function cadena(fin: unknown, ganchos: {
  alInsert?: (f: Record<string, unknown>) => void;
  alUpdate?: (f: Record<string, unknown>) => void;
  alDelete?: () => void;
  cuenta?: { count: number | null; error: unknown };
} = {}) {
  const nodo: Record<string, unknown> = {};
  let esCuenta = false;
  nodo.select = (_c?: unknown, opciones?: { count?: string; head?: boolean }) => {
    if (opciones?.head) esCuenta = true;
    return nodo;
  };
  for (const m of ['eq', 'in', 'limit', 'order', 'range', 'neq', 'is']) nodo[m] = () => nodo;
  nodo.insert = (f: Record<string, unknown>) => { ganchos.alInsert?.(f); return nodo; };
  nodo.update = (f: Record<string, unknown>) => { ganchos.alUpdate?.(f); return nodo; };
  nodo.delete = () => { ganchos.alDelete?.(); return nodo; };
  nodo.maybeSingle = () => Promise.resolve(fin);
  nodo.then = (r: (v: unknown) => unknown) =>
    Promise.resolve(esCuenta ? (ganchos.cuenta ?? { count: 0, error: null }) : fin).then(r);
  return nodo;
}

beforeEach(() => { from.mockReset(); rpc.mockReset(); anotarBitacora.mockClear(); });

describe('normalizarNombreTerminal', () => {
  it('colapsa los espacios: «Patio   Norte » y «Patio Norte» son el MISMO patio', () => {
    expect(normalizarNombreTerminal('  Patio   Norte ')).toBe('Patio Norte');
  });

  it('rechaza un nombre de una letra y uno larguísimo, diciendo el tope', () => {
    expect(() => normalizarNombreTerminal('N')).toThrow(DatoInvalido);
    expect(() => normalizarNombreTerminal('x'.repeat(81))).toThrow(/80/);
  });
});

describe('crearTerminal', () => {
  it('guarda el nombre normalizado y la ciudad, anclados al tenant de la sesión', async () => {
    let insertado: Record<string, unknown> = {};
    from.mockImplementation(() => cadena({ data: { id: UUID }, error: null }, {
      alInsert: (f) => { insertado = f; },
      cuenta: { count: 3, error: null },
    }));

    const id = await crearTerminal('t-1', { nombre: '  Patio   Norte ', ciudad: ' Monterrey ' }, { id: 'u-1' });

    expect(id).toBe(UUID);
    expect(insertado).toEqual({ tenant_id: 't-1', nombre: 'Patio Norte', ciudad: 'Monterrey' });
  });

  it('una ciudad vacía se guarda `null`, no como cadena vacía', async () => {
    let insertado: Record<string, unknown> = {};
    from.mockImplementation(() => cadena({ data: { id: UUID }, error: null }, {
      alInsert: (f) => { insertado = f; }, cuenta: { count: 0, error: null },
    }));
    await crearTerminal('t-1', { nombre: 'Patio Sur', ciudad: '   ' });
    expect(insertado.ciudad).toBeNull();
  });

  it('el choque de nombre se dice EN PALABRAS, no con el nombre del índice', async () => {
    from.mockImplementation(() => cadena(
      { data: null, error: { message: 'duplicate key value violates unique constraint "uq_terminal_tenant_nombre"' } },
      { cuenta: { count: 1, error: null } },
    ));
    await expect(crearTerminal('t-1', { nombre: 'Patio Norte' }))
      .rejects.toThrow(/Ya tienes un patio llamado «Patio Norte»/);
  });

  it('un fallo cualquiera de la base NO se disfraza de error de captura', async () => {
    // Un `DatoInvalido` sale verbatim a la pantalla; un fallo del sistema no
    // debe hacerlo, o el usuario intenta corregir algo que no capturó él.
    from.mockImplementation(() => cadena({ data: null, error: { message: 'connection reset' } }, { cuenta: { count: 1, error: null } }));
    const e = await crearTerminal('t-1', { nombre: 'Patio Norte' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(DatoInvalido);
  });

  it('el tope de patios se respeta y se dice, en vez de crear el 201', async () => {
    from.mockImplementation(() => cadena({ data: { id: UUID }, error: null }, {
      cuenta: { count: MAX_TERMINALES, error: null },
    }));
    await expect(crearTerminal('t-1', { nombre: 'Patio 201' })).rejects.toThrow(DatoInvalido);
  });

  it('si NO se pudo contar, no se crea: fallar cerrado, no saltarse el tope', async () => {
    from.mockImplementation(() => cadena({ data: { id: UUID }, error: null }, {
      cuenta: { count: null, error: { message: 'se cayó' } },
    }));
    await expect(crearTerminal('t-1', { nombre: 'Patio Norte' })).rejects.toThrow(/no se pudo contar/);
  });

  it('un nombre inválido se rechaza ANTES de tocar la base', async () => {
    await expect(crearTerminal('t-1', { nombre: 'N' })).rejects.toThrow(DatoInvalido);
    expect(from).not.toHaveBeenCalled();
  });

  it('deja rastro en la bitácora con el id del patio', async () => {
    from.mockImplementation(() => cadena({ data: { id: UUID }, error: null }, { cuenta: { count: 0, error: null } }));
    await crearTerminal('t-1', { nombre: 'Patio Norte' }, { id: 'u-1' });
    expect(anotarBitacora.mock.calls[0][0]).toMatchObject({
      tenantId: 't-1', accion: 'terminal.creada', actor: { id: 'u-1' },
      detalle: { terminalId: UUID, nombre: 'Patio Norte' },
    });
  });
});

describe('resolverTerminalDeFlota — la puerta que impide colgar unidades de otra flota', () => {
  it('vacío es «sin patio», y eso siempre es válido: no se consulta nada', async () => {
    expect(await resolverTerminalDeFlota('t-1', null)).toBeNull();
    expect(await resolverTerminalDeFlota('t-1', '   ')).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('algo que no es uuid se rechaza sin consultar', async () => {
    await expect(resolverTerminalDeFlota('t-1', 'patio-norte')).rejects.toThrow(DatoInvalido);
    expect(from).not.toHaveBeenCalled();
  });

  it('un uuid BIEN FORMADO pero de OTRA flota se rebota diciendo qué pasó', async () => {
    // Es el caso caro: colgar 200 unidades del patio de otra flota es un
    // cruce de datos entre clientes. La consulta filtra por tenant, así que
    // «de otra flota» y «no existe» contestan lo mismo — a propósito.
    from.mockImplementation(() => cadena({ data: null, error: null }));
    await expect(resolverTerminalDeFlota('t-1', UUID))
      .rejects.toThrow(/no existe en tu flota/);
  });

  it('una lectura caída LANZA como fallo del sistema, no como «no existe»', async () => {
    // Tratarla como «no existe» dejaría pasar un patio bueno como si fuera
    // ajeno, y el usuario corregiría algo que estaba bien.
    from.mockImplementation(() => cadena({ data: null, error: { message: 'se cayó' } }));
    const e = await resolverTerminalDeFlota('t-1', UUID).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(DatoInvalido);
  });

  it('un patio propio devuelve su id tal cual', async () => {
    from.mockImplementation(() => cadena({ data: { id: UUID }, error: null }));
    expect(await resolverTerminalDeFlota('t-1', ` ${UUID} `)).toBe(UUID);
  });
});

describe('asignarTerminalUnidad', () => {
  it('el UPDATE va anclado al tenant y se mira cuántas filas tocó', async () => {
    let actualizado: Record<string, unknown> = {};
    from.mockImplementation((tabla: string) =>
      tabla === 'terminal'
        ? cadena({ data: { id: UUID }, error: null })
        : cadena({ data: [{ id: UUID2 }], error: null }, { alUpdate: (f) => { actualizado = f; } }));

    await asignarTerminalUnidad('t-1', UUID2, UUID, { id: 'u-1' });
    expect(actualizado).toEqual({ terminal_id: UUID });
    expect(anotarBitacora.mock.calls[0][0]).toMatchObject({
      accion: 'unidad.terminal', entidad: 'unidad', entidadId: UUID2, detalle: { terminalId: UUID },
    });
  });

  it('una unidad de OTRA flota toca CERO filas y sale como error, no como «asignada»', async () => {
    from.mockImplementation((tabla: string) =>
      tabla === 'terminal' ? cadena({ data: { id: UUID }, error: null }) : cadena({ data: [], error: null }));
    await expect(asignarTerminalUnidad('t-1', UUID2, UUID)).rejects.toThrow(/No se encontró esa unidad/);
    expect(anotarBitacora).not.toHaveBeenCalled();
  });

  it('descolgar (patio `null`) es válido y no consulta el catálogo de patios', async () => {
    let actualizado: Record<string, unknown> = {};
    from.mockImplementation(() => cadena({ data: [{ id: UUID2 }], error: null }, { alUpdate: (f) => { actualizado = f; } }));
    await asignarTerminalUnidad('t-1', UUID2, null);
    expect(actualizado).toEqual({ terminal_id: null });
  });

  it('una unidad que no es uuid se rechaza antes de resolver el patio', async () => {
    await expect(asignarTerminalUnidad('t-1', 'abc', UUID)).rejects.toThrow(DatoInvalido);
    expect(from).not.toHaveBeenCalled();
  });
});

describe('getTerminales', () => {
  it('ordena por nombre en español y deja `null` la ciudad ausente', async () => {
    from.mockImplementation(() => cadena({
      data: [
        { id: 'b', nombre: 'Zapopan', ciudad: '' },
        { id: 'a', nombre: 'Ángeles', ciudad: 'CDMX' },
        { id: 'c', nombre: 'Bodega', ciudad: null },
      ],
      error: null,
      count: 3,
    }));
    const r = await getTerminales('t-1');
    expect(r.map((t) => t.nombre)).toEqual(['Ángeles', 'Bodega', 'Zapopan']);
    expect(r.find((t) => t.nombre === 'Zapopan')?.ciudad).toBeNull();
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// W2 «producto»: editar, borrar, contar y asignar patios.
// ═══════════════════════════════════════════════════════════════════════════

describe('getTerminalesConConteos — los números los cuenta la base, sobre la flota entera', () => {
  it('une cada patio con su fila de la RPC; el patio sin fila sale con ceros REALES (existe, está vacío)', async () => {
    from.mockImplementation(() => cadena({ data: [
      { id: UUID, nombre: 'Patio Norte', ciudad: 'Monterrey' },
      { id: UUID2, nombre: 'Patio Sur', ciudad: null },
    ], error: null, count: 2 }));
    rpc.mockResolvedValue({ data: [{ terminal_id: UUID, operadores: 40, unidades: 38, jefes: 2 }], error: null });
    const r = await getTerminalesConConteos('t-1');
    expect(rpc).toHaveBeenCalledWith('terminales_conteos_tenant', { p_tenant: 't-1' });
    expect(r).toEqual([
      { id: UUID, nombre: 'Patio Norte', ciudad: 'Monterrey', operadores: 40, unidades: 38, jefes: 2 },
      { id: UUID2, nombre: 'Patio Sur', ciudad: null, operadores: 0, unidades: 0, jefes: 0 },
    ]);
  });

  it('una flota sin patios no llama a la RPC y devuelve vacío (no un renglón inventado)', async () => {
    from.mockImplementation(() => cadena({ data: [], error: null, count: 0 }));
    expect(await getTerminalesConConteos('t-1')).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('si la RPC falla LANZA: unos conteos a medias dirían «patio vacío» de uno con camiones', async () => {
    from.mockImplementation(() => cadena({ data: [{ id: UUID, nombre: 'Patio Norte', ciudad: null }], error: null, count: 1 }));
    rpc.mockResolvedValue({ data: null, error: { message: 'se cayó' } });
    await expect(getTerminalesConConteos('t-1')).rejects.toThrow(/getTerminalesConConteos/);
  });
});

describe('editarTerminal', () => {
  it('normaliza, ancla al tenant y deja rastro con entidad terminal', async () => {
    let actualizado: Record<string, unknown> = {};
    from.mockImplementation(() => cadena({ data: [{ id: UUID }], error: null }, { alUpdate: (f) => { actualizado = f; } }));
    await editarTerminal('t-1', UUID, { nombre: '  Patio   Norte 2 ', ciudad: ' ' }, { id: 'u-1' });
    expect(actualizado).toEqual({ nombre: 'Patio Norte 2', ciudad: null });
    expect(anotarBitacora.mock.calls[0][0]).toMatchObject({ accion: 'terminal.editada', entidad: 'terminal', entidadId: UUID, tenantId: 't-1' });
  });

  it('un patio de OTRA flota toca cero filas y sale como error, sin bitácora', async () => {
    from.mockImplementation(() => cadena({ data: [], error: null }));
    await expect(editarTerminal('t-1', UUID, { nombre: 'Otro' })).rejects.toThrow(/No se encontró ese patio/);
    expect(anotarBitacora).not.toHaveBeenCalled();
  });

  it('el choque de nombre con OTRO patio se dice en palabras', async () => {
    from.mockImplementation(() => cadena({ data: null, error: { message: 'duplicate key value violates unique constraint "uq_terminal_tenant_nombre"' } }));
    await expect(editarTerminal('t-1', UUID, { nombre: 'Patio Sur' })).rejects.toThrow(/Ya tienes otro patio llamado «Patio Sur»/);
  });

  it('un id que no es uuid se rechaza sin tocar la base', async () => {
    await expect(editarTerminal('t-1', 'patio', { nombre: 'Patio Sur' })).rejects.toThrow(DatoInvalido);
    expect(from).not.toHaveBeenCalled();
  });
});

describe('eliminarTerminal', () => {
  it('borra anclado al tenant y la bitácora guarda cuántos quedaron SIN patio', async () => {
    let borro = false;
    from.mockImplementation(() => cadena({ data: [{ id: UUID, nombre: 'Patio Norte', ciudad: null }], error: null, count: 1 }, { alDelete: () => { borro = true; } }));
    rpc.mockResolvedValue({ data: [{ terminal_id: UUID, operadores: 5, unidades: 4, jefes: 0 }], error: null });
    // Las dos lecturas y el delete comparten el mismo falso: el `delete().select('id')` responde con una fila.
    const r = await eliminarTerminal('t-1', UUID, { id: 'u-1' });
    expect(borro).toBe(true);
    expect(r).toEqual({ operadores: 5, unidades: 4, jefes: 0 });
    expect(anotarBitacora.mock.calls[0][0]).toMatchObject({
      accion: 'terminal.eliminada', entidad: 'terminal', detalle: { nombre: 'Patio Norte', quedaronSinPatio: { operadores: 5, unidades: 4, jefes: 0 } },
    });
  });

  it('un patio CON jefes de tráfico NO se borra: sin patio un jefe vería toda la flota (alcance ampliado en silencio)', async () => {
    let borro = false;
    from.mockImplementation(() => cadena({ data: [{ id: UUID, nombre: 'Patio Norte', ciudad: null }], error: null, count: 1 }, { alDelete: () => { borro = true; } }));
    rpc.mockResolvedValue({ data: [{ terminal_id: UUID, operadores: 5, unidades: 4, jefes: 2 }], error: null });
    await expect(eliminarTerminal('t-1', UUID, { id: 'u-1' })).rejects.toThrow(/tiene 2 jefes de tráfico asignados.*sin que nadie lo decidiera/);
    expect(borro).toBe(false);
    expect(anotarBitacora).not.toHaveBeenCalled();
  });

  it('un patio que no es de la flota no se borra (ni se llega al delete)', async () => {
    let borro = false;
    from.mockImplementation(() => cadena({ data: [], error: null }, { alDelete: () => { borro = true; } }));
    await expect(eliminarTerminal('t-1', UUID)).rejects.toThrow(/No se encontró ese patio/);
    expect(borro).toBe(false);
  });
});

describe('terminalDeRegistro / terminalesDeRegistros — el patio sale de la base, no del formulario', () => {
  it('devuelve el patio del registro de ESTA flota', async () => {
    from.mockImplementation(() => cadena({ data: { id: UUID2, terminal_id: UUID }, error: null }));
    expect(await terminalDeRegistro('operador', 't-1', UUID2)).toEqual({ encontrado: true, terminalId: UUID });
  });

  it('sin patio es `null` (encontrado), y de otra flota es «no encontrado»', async () => {
    from.mockImplementation(() => cadena({ data: { id: UUID2, terminal_id: null }, error: null }));
    expect(await terminalDeRegistro('unidad', 't-1', UUID2)).toEqual({ encontrado: true, terminalId: null });
    from.mockImplementation(() => cadena({ data: null, error: null }));
    expect(await terminalDeRegistro('unidad', 't-1', UUID2)).toEqual({ encontrado: false, terminalId: null });
  });

  it('una lectura caída LANZA (no se confunde con «no existe»)', async () => {
    from.mockImplementation(() => cadena({ data: null, error: { message: 'se cayó' } }));
    await expect(terminalDeRegistro('operador', 't-1', UUID2)).rejects.toThrow(/terminalDeRegistro/);
  });

  it('un id basura ni consulta', async () => {
    expect(await terminalDeRegistro('operador', 't-1', "x' or 1=1")).toEqual({ encontrado: false, terminalId: null });
    expect(from).not.toHaveBeenCalled();
  });

  it('por lote: un solo in(), ids repetidos o basura se descartan', async () => {
    from.mockImplementation(() => cadena({ data: [{ id: UUID, terminal_id: UUID2 }, { id: UUID2, terminal_id: null }], error: null }));
    const m = await terminalesDeRegistros('operador', 't-1', [UUID, UUID, UUID2, 'basura']);
    expect(from).toHaveBeenCalledTimes(1);
    expect(m.get(UUID)).toBe(UUID2);
    expect(m.get(UUID2)).toBeNull();
    expect(m.has('basura')).toBe(false);
  });
});

describe('terminalDeUsuario', () => {
  it('lee el patio del jefe; sin patio es null', async () => {
    from.mockImplementation(() => cadena({ data: { terminal_id: UUID }, error: null }));
    expect(await terminalDeUsuario('t-1', UUID2)).toBe(UUID);
    from.mockImplementation(() => cadena({ data: { terminal_id: null }, error: null }));
    expect(await terminalDeUsuario('t-1', UUID2)).toBeNull();
  });

  it('no poder leerlo (error o sin fila) es `undefined`: el llamador falla CERRADO', async () => {
    from.mockImplementation(() => cadena({ data: null, error: { message: 'x' } }));
    expect(await terminalDeUsuario('t-1', UUID2)).toBeUndefined();
    from.mockImplementation(() => cadena({ data: null, error: null }));
    expect(await terminalDeUsuario('t-1', UUID2)).toBeUndefined();
  });
});

describe('asignarTerminalOperador', () => {
  it('valida el patio contra la flota, ancla el UPDATE y deja rastro', async () => {
    let actualizado: Record<string, unknown> = {};
    from.mockImplementation((tabla: string) => tabla === 'terminal'
      ? cadena({ data: { id: UUID }, error: null })
      : cadena({ data: [{ id: UUID2 }], error: null }, { alUpdate: (f) => { actualizado = f; } }));
    await asignarTerminalOperador('t-1', UUID2, UUID, { id: 'u-1' });
    expect(actualizado).toEqual({ terminal_id: UUID });
    expect(anotarBitacora.mock.calls[0][0]).toMatchObject({ accion: 'operador.terminal', entidad: 'operador', entidadId: UUID2 });
  });

  it('un patio de otra flota se rebota ANTES de escribir', async () => {
    let escribio = false;
    from.mockImplementation((tabla: string) => tabla === 'terminal'
      ? cadena({ data: null, error: null })
      : cadena({ data: [{ id: UUID2 }], error: null }, { alUpdate: () => { escribio = true; } }));
    await expect(asignarTerminalOperador('t-1', UUID2, UUID)).rejects.toThrow(/no existe en tu flota/);
    expect(escribio).toBe(false);
  });

  it('un operador de otra flota toca cero filas', async () => {
    from.mockImplementation((tabla: string) => tabla === 'terminal'
      ? cadena({ data: { id: UUID }, error: null }) : cadena({ data: [], error: null }));
    await expect(asignarTerminalOperador('t-1', UUID2, UUID)).rejects.toThrow(/No se encontró ese operador/);
  });
});

describe('asignarTerminalJefe / getJefesDeTrafico', () => {
  it('solo actualiza usuarios con rol encargado de ESTA flota; cero filas = error que lo explica', async () => {
    from.mockImplementation((tabla: string) => tabla === 'terminal'
      ? cadena({ data: { id: UUID }, error: null }) : cadena({ data: [], error: null }));
    await expect(asignarTerminalJefe('t-1', UUID2, UUID)).rejects.toThrow(/rol «Encargado»/);
  });

  it('asigna y firma con entidad app_user', async () => {
    from.mockImplementation((tabla: string) => tabla === 'terminal'
      ? cadena({ data: { id: UUID }, error: null }) : cadena({ data: [{ id: UUID2 }], error: null }));
    await asignarTerminalJefe('t-1', UUID2, UUID, { id: 'u-1' });
    expect(anotarBitacora.mock.calls[0][0]).toMatchObject({ accion: 'app_user.terminal', entidad: 'app_user', entidadId: UUID2, detalle: { terminalId: UUID } });
  });

  it('soltar el patio (null) no consulta terminales', async () => {
    from.mockImplementation(() => cadena({ data: [{ id: UUID2 }], error: null }));
    await asignarTerminalJefe('t-1', UUID2, null);
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('app_user');
  });

  it('lista los jefes ordenados por nombre, con su patio', async () => {
    from.mockImplementation(() => cadena({ data: [
      { id: UUID, nombre: 'Zoe', email: 'z@x.mx', terminal_id: null },
      { id: UUID2, nombre: 'Ana', email: 'a@x.mx', terminal_id: UUID },
    ], error: null, count: 2 }));
    const j = await getJefesDeTrafico('t-1');
    expect(j.map((x) => x.nombre)).toEqual(['Ana', 'Zoe']);
    expect(j[0].terminalId).toBe(UUID);
  });
});

describe('contarSinPatio / asignarSinPatio — el arranque de una flota que ya cargó su gente', () => {
  it('cuenta operadores y unidades ACTIVOS sin patio', async () => {
    from.mockImplementation((t: string) => cadena({ data: null, error: null }, { cuenta: { count: t === 'operador' ? 37 : 12, error: null } }));
    expect(await contarSinPatio('t-1')).toEqual({ operadores: 37, unidades: 12 });
  });

  it('una lectura caída LANZA (no se afirma «0 sin patio»)', async () => {
    from.mockImplementation(() => cadena({ data: null, error: null }, { cuenta: { count: null, error: { message: 'se cayó' } } }));
    await expect(contarSinPatio('t-1')).rejects.toThrow(/contarSinPatio/);
  });

  it('un solo UPDATE condicionado a «sin patio», y la bitácora lleva cuántos y los ids', async () => {
    let actualizado: Record<string, unknown> = {};
    from.mockImplementation((t: string) => t === 'terminal'
      ? cadena({ data: { id: UUID }, error: null })
      : cadena({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], error: null }, { alUpdate: (f) => { actualizado = f; } }));
    const n = await asignarSinPatio('unidad', 't-1', UUID, { id: 'u-1' });
    expect(n).toBe(3);
    expect(actualizado).toEqual({ terminal_id: UUID });
    expect(anotarBitacora.mock.calls[0][0]).toMatchObject({
      accion: 'unidad.terminal_masivo', entidad: 'terminal', entidadId: UUID, detalle: { movidos: 3, ids: ['a', 'b', 'c'] },
    });
  });

  it('si no había nada sin patio mueve 0 y NO deja bitácora', async () => {
    from.mockImplementation((t: string) => t === 'terminal' ? cadena({ data: { id: UUID }, error: null }) : cadena({ data: [], error: null }));
    expect(await asignarSinPatio('operador', 't-1', UUID)).toBe(0);
    expect(anotarBitacora).not.toHaveBeenCalled();
  });

  it('un patio de otra flota o vacío se rebota antes de escribir', async () => {
    let escribio = false;
    from.mockImplementation((t: string) => t === 'terminal'
      ? cadena({ data: null, error: null })
      : cadena({ data: [{ id: 'a' }], error: null }, { alUpdate: () => { escribio = true; } }));
    await expect(asignarSinPatio('operador', 't-1', UUID)).rejects.toThrow(/no existe en tu flota/);
    await expect(asignarSinPatio('operador', 't-1', '')).rejects.toThrow(/Elige el patio/);
    expect(escribio).toBe(false);
  });
});
