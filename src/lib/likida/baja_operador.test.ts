import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 20 · H2 (ALTO) — LA BAJA DE UN CHOFER NO EXISTÍA, Y MEDIO SISTEMA
// ASUMÍA QUE SÍ.
//
// `operador.activo` está en el esquema desde la 0001. El índice
// `uq_operador_telefono_activo` (0024) se diseñó PARCIAL (`where activo`)
// exactamente para que el teléfono se libere con la baja. Y `processor.ts:971`
// documenta el caso: "un operador DADO DE BAJA (activo=false — la única forma
// de inactivar del panel)". Pero NINGÚN camino de `src/` escribía nunca
// `activo = false`: ese "camino del panel" no existía.
//
// Lo que eso costaba, en el mundo: un chofer renuncia y
//   1. el bot de WhatsApp le sigue contestando como operador de la flota,
//   2. sigue saliendo en los buscadores de despacho y recibiendo viajes,
//   3. su teléfono queda bloqueado —globalmente— para cualquier otra flota.
//
// Estas pruebas fijan el ciclo completo: la escritura, su aislamiento entre
// flotas, su rastro en bitácora, y EL EFECTO EN CASCADA (1) — que es el que
// nadie ve al hacer clic y por eso es el que más fácil se rompe después.
// ═══════════════════════════════════════════════════════════════════════════

// ── El doble de Supabase ───────────────────────────────────────────────────
//
// APLICA LOS FILTROS de verdad. Un doble que ignore `.eq()` y devuelva siempre
// las filas del fixture no puede distinguir "la consulta filtra por activo" de
// "la consulta trae a todos": las dos se ven idénticas, y la prueba del efecto
// en cascada sería teatro. Aquí `.eq()` recorta el array, así que borrar el
// `.eq('activo', true)` de `resolveOperador` pone la prueba en rojo.

interface Escritura { tabla: string; op: 'insert' | 'update'; valores: Record<string, unknown>; filtros: Array<[string, unknown]> }

let TABLAS: Record<string, Array<Record<string, unknown>>> = {};
let escrituras: Escritura[] = [];
/** El bache transitorio de Supabase en la lectura del alta anterior. */
let LECTURA_PREVIA_FALLA = false;

function enlace(tabla: string) {
  let filas = () => TABLAS[tabla] ?? [];
  const filtros: Array<[string, unknown]> = [];
  let escritura: Escritura | null = null;
  let tope: number | undefined;

  const api: Record<string, unknown> = {
    select: () => api,
    eq: (col: string, val: unknown) => {
      filtros.push([col, val]);
      const previas = filas;
      filas = () => previas().filter((f) => f[col] === val);
      return api;
    },
    in: (col: string, vals: unknown[]) => {
      const previas = filas;
      filas = () => previas().filter((f) => (vals as unknown[]).includes(f[col]));
      return api;
    },
    order: () => api,
    limit: (n: number) => { tope = n; return api; },
    insert: (v: Record<string, unknown>) => {
      escritura = { tabla, op: 'insert', valores: v, filtros };
      escrituras.push(escritura);
      return api;
    },
    update: (v: Record<string, unknown>) => {
      escritura = { tabla, op: 'update', valores: v, filtros };
      escrituras.push(escritura);
      return api;
    },
    maybeSingle: () => {
      // La ÚNICA lectura de este módulo que termina en `maybeSingle` es el
      // pre-read del alta anterior — por eso el interruptor de abajo alcanza
      // para simular ese bache transitorio sin tocar el resto.
      if (LECTURA_PREVIA_FALLA) {
        return Promise.resolve({ data: null, error: { message: 'canceling statement due to statement timeout' } });
      }
      const r = filas();
      return Promise.resolve({ data: r.length > 0 ? r[0] : null, error: null });
    },
    then: (res: (v: unknown) => unknown) => {
      // Un UPDATE devuelve las filas TOCADAS (el `.select('id')` de PostgREST):
      // el filtro por tenant las deja en cero cuando el id es de otra flota, y
      // ese cero es justo lo que `actualizarOperador` tiene que ver.
      const r = filas();
      const data = escritura ? r.map((f) => ({ id: f.id })) : (tope != null ? r.slice(0, tope) : r);
      return Promise.resolve({ data, error: null }).then(res);
    },
  };
  return api;
}

const rpc = vi.fn(async () => ({ data: null, error: null }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (t: string) => enlace(t), rpc: (...a: unknown[]) => rpc(...(a as [])) }),
}));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./config', () => ({ getConfig: vi.fn() }));

const { actualizarOperador } = await import('./administracion');
const { resolveOperador } = await import('./conv');
const { DatoInvalido } = await import('./errores');

/** Dos flotas, y en la primera el chofer que se va. */
const OP_ID = '11111111-1111-4111-8111-111111111111';
const AJENO = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  escrituras = [];
  LECTURA_PREVIA_FALLA = false;
  rpc.mockClear();
  TABLAS = {
    operador: [
      { id: OP_ID, tenant_id: 't-1', nombre: 'Juan Pérez', telefono: '529993700779', activo: true },
      { id: AJENO, tenant_id: 't-2', nombre: 'Ana de la otra flota', telefono: '525550000001', activo: true },
    ],
    bitacora_auditoria: [],
  };
});

const escrituraDe = (tabla: string) => escrituras.find((e) => e.tabla === tabla);

// ═══════════════════════════════════════════════════════════════════════════
describe('la baja del chofer se puede ESCRIBIR desde el panel', () => {
  it('`activo: false` llega a la columna, anclado al tenant en el WHERE', async () => {
    await actualizarOperador('t-1', OP_ID, { activo: false }, { id: 'u-jefe' });

    const w = escrituraDe('operador')!;
    expect(w.op).toBe('update');
    expect(w.valores).toEqual({ activo: false });
    // El tenant SIEMPRE en el where: sin él, el UUID de un operador de otra
    // flota lo daría de baja igual.
    expect(w.filtros).toContainEqual(['tenant_id', 't-1']);
    expect(w.filtros).toContainEqual(['id', OP_ID]);
  });

  it('la baja NO BORRA la fila: el historial fiscal y laboral del chofer se conserva', async () => {
    await actualizarOperador('t-1', OP_ID, { activo: false });
    // Ni un delete, ni un update que vacíe nombre o teléfono: solo la bandera.
    expect(escrituras.filter((e) => e.tabla === 'operador')).toHaveLength(1);
    expect(escrituraDe('operador')!.valores).toEqual({ activo: false });
  });

  it('y el camino de vuelta existe: se puede reactivar', async () => {
    TABLAS.operador[0].activo = false;
    await actualizarOperador('t-1', OP_ID, { activo: true });
    expect(escrituraDe('operador')!.valores).toEqual({ activo: true });
  });

  it('la baja convive con los otros campos en el MISMO guardado (es un checkbox del formulario)', async () => {
    await actualizarOperador('t-1', OP_ID, { nombre: 'Juan Pérez Ruiz', activo: false });
    expect(escrituraDe('operador')!.valores).toEqual({ nombre: 'Juan Pérez Ruiz', activo: false });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('AISLAMIENTO ENTRE FLOTAS — un flota_admin solo da de baja a SU gente', () => {
  it('con el UUID de un operador de OTRA flota, el UPDATE toca cero filas y se DICE', async () => {
    // El punto no es que "falle": es que Postgres NO llama error a un update
    // de cero filas. Sin mirar las filas afectadas, la pantalla diría "dado de
    // baja" sobre un chofer de otra empresa que sigue trabajando.
    await expect(actualizarOperador('t-1', AJENO, { activo: false }))
      .rejects.toBeInstanceOf(DatoInvalido);
  });

  it('y NO queda una entrada de bitácora afirmando una baja que no ocurrió', async () => {
    await actualizarOperador('t-1', AJENO, { activo: false }).catch(() => {});
    // El UPDATE se intenta —con el tenant en el WHERE, que es lo que lo
    // salva—, pero toca cero filas. Anotar de todos modos dejaría en el
    // expediente un "fulano dio de baja a mengano" que jamás pasó: peor que no
    // anotar, porque una bitácora que miente no se puede usar para nada.
    expect(escrituraDe('operador')!.filtros).toContainEqual(['tenant_id', 't-1']);
    expect(escrituraDe('bitacora_auditoria')).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('BITÁCORA — quién dio de baja a quién, y cuándo', () => {
  it('la baja se anota con su propio nombre (`operador.baja`), no escondida en un "editado"', async () => {
    await actualizarOperador('t-1', OP_ID, { activo: false }, { id: 'u-jefe', email: 'duenio@flota.mx' });

    const b = escrituraDe('bitacora_auditoria')!;
    expect(b.valores).toMatchObject({
      tenant_id: 't-1',
      accion: 'operador.baja',
      entidad: 'operador',
      entidad_id: OP_ID,
      actor_id: 'u-jefe',
      actor_email: 'duenio@flota.mx',
    });
  });

  it('la reactivación tiene su propia acción', async () => {
    TABLAS.operador[0].activo = false;
    await actualizarOperador('t-1', OP_ID, { activo: true }, { id: 'u-jefe' });
    expect(escrituraDe('bitacora_auditoria')!.valores).toMatchObject({ accion: 'operador.reactivado' });
  });

  it('si la LECTURA PREVIA falla, se cae a `operador.editado` y se dice por qué', async () => {
    // Revisión de Fable (29-ago-2026): el `error` del pre-read se descartaba,
    // así que un bache transitorio de Supabase dejaba `previo = null` y de ahí
    // el código concluía "cambió el alta". Un guardado rutinario de licencia
    // se anotaba como `operador.reactivado`: nunca escondía una baja real,
    // pero llenaba de reactivaciones inventadas justo el registro que existe
    // para reconstruir quién movió el alta de quién.
    //
    // "No pude preguntar" ≠ "era distinto": ante la duda, el nombre que no
    // afirma nada. Y el UPDATE sigue adelante — la baja que el usuario pidió
    // tiene que ocurrir aunque la bitácora se quede corta de nombre.
    LECTURA_PREVIA_FALLA = true;
    await actualizarOperador('t-1', OP_ID, { licencia: 'B-99', activo: true });

    expect(escrituraDe('operador')!.valores).toMatchObject({ activo: true });
    const b = escrituraDe('bitacora_auditoria')!;
    expect(b.valores).toMatchObject({ accion: 'operador.editado' });
    expect((b.valores.detalle as Record<string, unknown>).alta_previa_ilegible).toBe(true);
  });

  it('corregir la licencia SIN cambiar el alta sigue siendo `operador.editado`', async () => {
    // La forma manda `activo` en CADA guardado (es un checkbox, no un parche).
    // Sin leer el valor anterior, toda corrección de licencia quedaría anotada
    // como "reactivado" y la bitácora se llenaría de bajas que nunca pasaron —
    // hasta volverse inútil justo el día que alguien la necesite.
    await actualizarOperador('t-1', OP_ID, { licencia: 'B-99', activo: true });
    expect(escrituraDe('bitacora_auditoria')!.valores).toMatchObject({ accion: 'operador.editado' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('EFECTO EN CASCADA — el bot de WhatsApp deja de atenderlo', () => {
  // Es el efecto que nadie ve al hacer clic: la pantalla dice "dado de baja" y
  // el chofer sigue mandando fotos de tickets desde su celular. Si esto se
  // rompe, se rompe EN SILENCIO — el gasto de un ex empleado se seguiría
  // anotando en la liquidación de la flota.

  it('un operador ACTIVO resuelve por su teléfono (línea base)', async () => {
    const op = await resolveOperador('5219993700779');
    expect(op?.operadorId).toBe(OP_ID);
    expect(op?.tenantId).toBe('t-1');
  });

  it('DADO DE BAJA, el mismo teléfono ya NO resuelve: el webhook lo trata como desconocido', async () => {
    TABLAS.operador[0].activo = false;
    // `null` es lo que `processor.ts` lee como "no está dado de alta como
    // operador" y por lo que deriva al camino de cuenta de oficina / respuesta
    // honesta. NO es un throw: eso significaría "no pude preguntar".
    expect(await resolveOperador('5219993700779')).toBeNull();
  });

  it('la baja de MI chofer no apaga al de la otra flota', async () => {
    TABLAS.operador[0].activo = false;
    const otro = await resolveOperador('525550000001');
    expect(otro?.tenantId).toBe('t-2');
  });

  it('el teléfono QUEDA LIBRE: la fila de baja ya no es la que resuelve, así que otra flota puede reusarlo', async () => {
    // El índice `uq_operador_telefono_activo` (0024) es parcial `where activo`
    // justo para permitir esto — la rotación normal de un chofer entre flotas.
    TABLAS.operador[0].activo = false;
    TABLAS.operador.push({
      id: '33333333-3333-4333-8333-333333333333',
      tenant_id: 't-3', nombre: 'Juan Pérez', telefono: '529993700779', activo: true,
    });

    const op = await resolveOperador('5219993700779');
    // Una sola fila ACTIVA con ese número ⇒ sin ambigüedad, y el gasto se
    // anota en la flota que de verdad lo contrató.
    expect(op?.tenantId).toBe('t-3');
  });
});
