import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// Las lecturas y escrituras del ENCARGADO (mig. 0047).
//
// Lo que se prueba aquí no es que las consultas "corran": es cada decisión
// donde un cero honesto y un cero mentiroso se ven idénticos en pantalla.
// ═══════════════════════════════════════════════════════════════════════════

/** Filas por tabla que devolverá el mock en la siguiente llamada. */
let TABLAS: Record<string, unknown[]> = {};
/** Tablas que deben fallar, con su mensaje. */
let FALLAN: Record<string, string> = {};

const escrituras: Array<{ tabla: string; op: string; valores?: unknown; filtros: Array<[string, unknown]> }> = [];

/**
 * Constructor encadenable: todo método devuelve el mismo objeto, y `range`
 * (que es donde `traerTodo` cierra la consulta) resuelve con las filas de la
 * tabla. `single()` cierra las escrituras.
 *
 * `range` REBANA y `count` solo llega si la consulta lo pidió — igual que
 * PostgREST. Un mock que devolviera la tabla entera en cada página describe
 * una base que no existe y hace pasar por bueno el recorte silencioso que
 * `traerTodo` vino a cerrar.
 */
function constructor(tabla: string) {
  const filtros: Array<[string, unknown]> = [];
  const registro: { tabla: string; op: string; valores?: unknown; filtros: Array<[string, unknown]> } =
    { tabla, op: 'select', filtros };
  let pidioConteo = false;

  const resultado = () => FALLAN[tabla]
    ? { data: null, error: { message: FALLAN[tabla] } }
    : { data: TABLAS[tabla] ?? [], error: null };

  const api: Record<string, unknown> = {
    select: (_cols?: unknown, opts?: { count?: string }) => {
      if (opts?.count === 'exact') pidioConteo = true;
      return api;
    },
    eq: (c: string, v: unknown) => { filtros.push([c, v]); return api; },
    is: (c: string, v: unknown) => { filtros.push([c, v]); return api; },
    neq: (c: string, v: unknown) => { filtros.push([`!${c}`, v]); return api; },
    order: () => api,
    range: (desde: number, hasta: number) => {
      if (FALLAN[tabla]) return Promise.resolve(resultado());
      const todas = TABLAS[tabla] ?? [];
      return Promise.resolve({
        data: todas.slice(desde, hasta + 1),
        error: null,
        count: pidioConteo ? todas.length : null,
      });
    },
    insert: (v: unknown) => { registro.op = 'insert'; registro.valores = v; escrituras.push(registro); return api; },
    update: (v: unknown) => { registro.op = 'update'; registro.valores = v; escrituras.push(registro); return api; },
    single: () => Promise.resolve(
      FALLAN[tabla] ? { data: null, error: { message: FALLAN[tabla] } } : { data: { id: `${tabla}-nuevo` }, error: null },
    ),
    // Un update sin `.single()` se espera directo: `then` lo hace thenable.
    then: (res: (v: unknown) => unknown) => Promise.resolve(
      FALLAN[tabla] ? { data: null, error: { message: FALLAN[tabla] } } : { data: null, error: null },
    ).then(res),
  };
  return api;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => constructor(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const {
  getCargaOperadores, getViajesSinAsignar, getUnidades, getIncidencias,
  getTableroOperacion, cambiarEstadoIncidencia, crearViaje, getPods, rechazarPod,
} = await import('./operacion');

beforeEach(() => { TABLAS = {}; FALLAN = {}; escrituras.length = 0; });

describe('getCargaOperadores — "¿a quién NO le cargo otro?"', () => {
  it('cuenta en curso por operador y deja fuera los viajes sin dueño', async () => {
    TABLAS = {
      operador: [
        { id: 'o-1', nombre: 'Ana Ruiz', telefono: '52999', activo: true },
        { id: 'o-2', nombre: 'Beto Lara', telefono: null, activo: true },
      ],
      viaje: [
        { id: 'v-1', operador_id: 'o-1', estatus: 'abierto' },
        { id: 'v-2', operador_id: 'o-1', estatus: 'en_cuadre' },
        { id: 'v-3', operador_id: 'o-1', estatus: 'liquidado' },
        { id: 'v-4', operador_id: 'o-2', estatus: 'abierto' },
        { id: 'v-5', operador_id: null, estatus: 'abierto' },   // sin dueño
      ],
      pod: [], incidencia: [],
    };
    const r = await getCargaOperadores('t-1');
    const ana = r.find((x) => x.operadorId === 'o-1')!;
    expect(ana.enCurso).toBe(2);            // abierto + en_cuadre, NO el liquidado
    expect(ana.abiertos).toBe(1);
    expect(ana.enCuadre).toBe(1);
    expect(ana.liquidados).toBe(1);
    // El viaje sin dueño no le cuenta a nadie: se persigue en otra pantalla.
    expect(r.reduce((s, x) => s + x.enCurso, 0)).toBe(3);
  });

  it('un POD RECHAZADO cuenta como que falta — la evidencia existe pero no sirve', async () => {
    TABLAS = {
      operador: [{ id: 'o-1', nombre: 'Ana', telefono: null, activo: true }],
      viaje: [
        { id: 'v-1', operador_id: 'o-1', estatus: 'abierto' },
        { id: 'v-2', operador_id: 'o-1', estatus: 'abierto' },
      ],
      pod: [
        { viaje_id: 'v-1', estado: 'subido' },
        { viaje_id: 'v-2', estado: 'rechazado' },
      ],
      incidencia: [],
    };
    const [ana] = await getCargaOperadores('t-1');
    expect(ana.sinPod).toBe(1);
  });

  it('ordena por carga descendente', async () => {
    TABLAS = {
      operador: [
        { id: 'o-1', nombre: 'Ana', telefono: null, activo: true },
        { id: 'o-2', nombre: 'Beto', telefono: null, activo: true },
      ],
      viaje: [
        { id: 'v-1', operador_id: 'o-2', estatus: 'abierto' },
        { id: 'v-2', operador_id: 'o-2', estatus: 'abierto' },
        { id: 'v-3', operador_id: 'o-1', estatus: 'abierto' },
      ],
      pod: [], incidencia: [],
    };
    const r = await getCargaOperadores('t-1');
    expect(r.map((x) => x.nombre)).toEqual(['Beto', 'Ana']);
  });

  it('si una de las cuatro consultas falla, LANZA — no devuelve carga cero', async () => {
    TABLAS = { operador: [], viaje: [], pod: [], incidencia: [] };
    FALLAN = { viaje: 'timeout' };
    // Cero viajes por error se leería como "nadie trae nada" y el encargado
    // repartiría trabajo encima de choferes que ya van llenos.
    await expect(getCargaOperadores('t-1')).rejects.toThrow('timeout');
  });
});

describe('getViajesSinAsignar', () => {
  it('pide los que no tienen operador y no están liquidados', async () => {
    TABLAS = { viaje: [{ id: 'v-1', folio: 'VJ-1', origen: 'GDL', destino: 'MTY', fecha_inicio: '2026-08-01', estatus: 'abierto' }] };
    const r = await getViajesSinAsignar('t-1');
    expect(r).toEqual([{ id: 'v-1', folio: 'VJ-1', origen: 'GDL', destino: 'MTY', fechaInicio: '2026-08-01', estatus: 'abierto' }]);
  });
});

describe('getUnidades — el papel que vence primero', () => {
  const hoy = new Date('2026-08-03T12:00:00Z');

  it('elige el vencimiento MÁS PRÓXIMO de los tres, no el primero capturado', async () => {
    TABLAS = {
      unidad: [{
        id: 'u-1', numero_economico: 'C2-08', placas: 'ABC-123-A', marca: null, modelo: null, anio: 2019,
        estado: 'disponible', km_actual: 412000,
        poliza_vence: '2026-12-01',          // lejano, pero capturado primero
        permiso_sict_vence: '2026-07-04',    // YA VENCIDO
        verificacion_vence: '2026-09-01',
        activo: true,
      }],
      mantenimiento: [],
    };
    const [u] = await getUnidades('t-1', hoy);
    expect(u.queVence).toBe('Permiso SICT');
    expect(u.diasAlVencimiento).toBe(-30);   // negativo = vencido, y así se pinta
  });

  it('sin ningún papel capturado devuelve null, no cero — cero se leería como "vence hoy"', async () => {
    TABLAS = {
      unidad: [{
        id: 'u-1', numero_economico: 'C2-09', placas: null, marca: null, modelo: null, anio: null,
        estado: 'taller', km_actual: null,
        poliza_vence: null, permiso_sict_vence: null, verificacion_vence: null, activo: true,
      }],
      mantenimiento: [],
    };
    const [u] = await getUnidades('t-1', hoy);
    expect(u.diasAlVencimiento).toBeNull();
    expect(u.queVence).toBeNull();
  });

  it('cuenta las órdenes de trabajo abiertas de cada unidad', async () => {
    TABLAS = {
      unidad: [{
        id: 'u-1', numero_economico: 'C2-08', placas: null, marca: null, modelo: null, anio: null,
        estado: 'taller', km_actual: null, poliza_vence: null, permiso_sict_vence: null,
        verificacion_vence: null, activo: true,
      }],
      mantenimiento: [{ unidad_id: 'u-1', estado: 'abierta' }, { unidad_id: 'u-1', estado: 'en_proceso' }],
    };
    const [u] = await getUnidades('t-1', hoy);
    expect(u.ordenesAbiertas).toBe(2);
  });
});

describe('getIncidencias — SLA', () => {
  const ahora = new Date('2026-08-03T12:00:00Z');
  const base = {
    id: 'i-1', viaje_id: null, unidad_id: null, tipo: 'averia', prioridad: 'alta',
    descripcion: null, resuelta_en: null,
    abierta_en: '2026-08-03T00:00:00Z',   // 12 h antes
  };

  it('marca vencido solo si HAY SLA pactado y ya se pasó', async () => {
    TABLAS = { incidencia: [{ ...base, estado: 'abierta', sla_horas: 4 }], viaje: [], unidad: [] };
    const [i] = await getIncidencias('t-1', ahora);
    expect(i.horasAbierta).toBe(12);
    expect(i.slaVencido).toBe(true);
  });

  it('sin SLA no está vencida, está SIN PACTAR', async () => {
    TABLAS = { incidencia: [{ ...base, estado: 'abierta', sla_horas: null }], viaje: [], unidad: [] };
    const [i] = await getIncidencias('t-1', ahora);
    expect(i.slaHoras).toBeNull();
    expect(i.slaVencido).toBe(false);
  });

  it('una resuelta no está vencida aunque haya tardado más que el SLA', async () => {
    TABLAS = {
      incidencia: [{ ...base, estado: 'resuelta', sla_horas: 4, resuelta_en: '2026-08-03T10:00:00Z' }],
      viaje: [], unidad: [],
    };
    const [i] = await getIncidencias('t-1', ahora);
    expect(i.horasAbierta).toBe(10);   // se congela al resolver, no sigue corriendo
    expect(i.slaVencido).toBe(false);
  });
});

describe('getTableroOperacion', () => {
  it('cuenta como pendiente el viaje del que NADIE creó el POD', async () => {
    // El peor cero posible: contar filas de `pod` dejaría fuera justo el viaje
    // que nadie ha tocado, y el tablero diría "no falta ninguno".
    TABLAS = {
      viaje: [
        { id: 'v-1', operador_id: 'o-1', estatus: 'abierto' },
        { id: 'v-2', operador_id: 'o-1', estatus: 'abierto' },   // sin fila en `pod`
        { id: 'v-3', operador_id: 'o-1', estatus: 'liquidado' },
      ],
      unidad: [{ estado: 'disponible' }, { estado: 'taller' }, { estado: 'en_ruta' }],
      incidencia: [{ estado: 'abierta' }],
      pod: [{ viaje_id: 'v-1', estado: 'subido' }],
    };
    const t = await getTableroOperacion('t-1');
    expect(t.podPendientes).toBe(1);
    expect(t.viajesActivos).toBe(2);
    expect(t.unidadesDisponibles).toBe(1);
    expect(t.unidadesEnTaller).toBe(1);
    expect(t.incidenciasAbiertas).toBe(1);
  });

  it('porAsignar solo cuenta viajes EN CURSO sin dueño', async () => {
    TABLAS = {
      viaje: [
        { id: 'v-1', operador_id: null, estatus: 'abierto' },
        { id: 'v-2', operador_id: null, estatus: 'liquidado' },   // ya cerró: no se asigna
      ],
      unidad: [], incidencia: [], pod: [],
    };
    expect((await getTableroOperacion('t-1')).porAsignar).toBe(1);
  });
});

describe('getPods — se parte de los VIAJES, no de la tabla pod', () => {
  it('el viaje del que nadie creó registro sale con estado null y PRIMERO', async () => {
    TABLAS = {
      viaje: [
        { id: 'v-1', folio: 'VJ-1', operador_id: 'o-1', estatus: 'abierto' },
        { id: 'v-2', folio: 'VJ-2', operador_id: 'o-1', estatus: 'abierto' },   // nadie lo tocó
        { id: 'v-3', folio: 'VJ-3', operador_id: 'o-1', estatus: 'liquidado' }, // ya cerró
      ],
      pod: [{ id: 'p-1', viaje_id: 'v-1', estado: 'subido', nota: null, capturado_en: null }],
      operador: [{ id: 'o-1', nombre: 'Ana Ruiz', telefono: '52999' }],
    };
    const r = await getPods('t-1');
    // El liquidado no aparece: la evidencia se persigue mientras el viaje vive.
    expect(r.map((x) => x.folio)).toEqual(['VJ-2', 'VJ-1']);
    expect(r[0].estado).toBeNull();
    expect(r[0].operadorNombre).toBe('Ana Ruiz');
    expect(r[1].estado).toBe('subido');
  });

  it('ordena lo que falta antes de lo que llegó', async () => {
    TABLAS = {
      viaje: [
        { id: 'v-1', folio: 'llegó', operador_id: null, estatus: 'abierto' },
        { id: 'v-2', folio: 'rechazado', operador_id: null, estatus: 'abierto' },
        { id: 'v-3', folio: 'pedido', operador_id: null, estatus: 'abierto' },
        { id: 'v-4', folio: 'nadie', operador_id: null, estatus: 'abierto' },
      ],
      pod: [
        { id: 'p-1', viaje_id: 'v-1', estado: 'subido', nota: null, capturado_en: null },
        { id: 'p-2', viaje_id: 'v-2', estado: 'rechazado', nota: null, capturado_en: null },
        { id: 'p-3', viaje_id: 'v-3', estado: 'pendiente', nota: null, capturado_en: null },
      ],
      operador: [],
    };
    const r = await getPods('t-1');
    expect(r.map((x) => x.folio)).toEqual(['nadie', 'pedido', 'rechazado', 'llegó']);
  });
});

describe('escrituras', () => {
  it('crearViaje acota por tenant y nace abierto', async () => {
    await crearViaje('t-1', { folio: 'VJ-9', origen: 'GDL', destino: 'MTY', anticipo: 5000 });
    const w = escrituras.find((e) => e.tabla === 'viaje')!;
    expect(w.op).toBe('insert');
    expect(w.valores).toMatchObject({ tenant_id: 't-1', folio: 'VJ-9', estatus: 'abierto', anticipo: 5000 });
  });

  it('resolver una incidencia FECHA el cierre — el constraint la rechaza si no', async () => {
    const ahora = new Date('2026-08-03T12:00:00Z');
    await cambiarEstadoIncidencia('t-1', 'i-1', 'resuelta', ahora);
    const w = escrituras.find((e) => e.tabla === 'incidencia')!;
    expect(w.valores).toEqual({ estado: 'resuelta', resuelta_en: '2026-08-03T12:00:00.000Z' });
    expect(w.filtros).toEqual([['id', 'i-1'], ['tenant_id', 't-1']]);
  });

  it('reabrir una incidencia BORRA la fecha de cierre', async () => {
    await cambiarEstadoIncidencia('t-1', 'i-1', 'en_proceso');
    const w = escrituras.find((e) => e.tabla === 'incidencia')!;
    expect(w.valores).toEqual({ estado: 'en_proceso', resuelta_en: null });
  });

  it('un insert que falla lanza en vez de devolver un id inventado', async () => {
    FALLAN = { viaje: 'folio duplicado' };
    await expect(crearViaje('t-1', { folio: 'VJ-9' })).rejects.toThrow('folio duplicado');
  });

  it('rechazar un POD NO borra el archivo — solo cambia el estado y anota', async () => {
    // Borrar la ruta dejaría la discusión con el chofer sin la prueba de lo
    // que sí mandó. Además, `pod_subido_tiene_archivo` (0047) solo exige
    // archivo para 'subido', así que la fila rechazada queda consistente.
    await rechazarPod('t-1', 'p-1', 'ilegible, no se ve el sello');
    const w = escrituras.find((e) => e.tabla === 'pod')!;
    expect(w.valores).toEqual({ estado: 'rechazado', nota: 'ilegible, no se ve el sello' });
    expect(w.valores).not.toHaveProperty('storage_path');
    expect(w.filtros).toEqual([['id', 'p-1'], ['tenant_id', 't-1']]);
  });
});
