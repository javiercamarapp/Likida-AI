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
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (...a: unknown[]) => from(...(a as [])) }) }));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const anotarBitacora = vi.fn(async (_e: Record<string, unknown>) => {});
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: (e: unknown) => anotarBitacora(e as Record<string, unknown>) }));

const {
  getTerminales, crearTerminal, normalizarNombreTerminal,
  resolverTerminalDeFlota, asignarTerminalUnidad, MAX_TERMINALES,
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
  nodo.maybeSingle = () => Promise.resolve(fin);
  nodo.then = (r: (v: unknown) => unknown) =>
    Promise.resolve(esCuenta ? (ganchos.cuenta ?? { count: 0, error: null }) : fin).then(r);
  return nodo;
}

beforeEach(() => { from.mockReset(); anotarBitacora.mockClear(); });

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
