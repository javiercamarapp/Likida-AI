import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDoble, despacharRpc, type Doble } from './espejo_0152.pruebas';

/** La base sintética que contestan las RPC de la 0152. */
let DOBLE: Doble = crearDoble('2026-08-14');

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
/** Tablas cuyo UPDATE toca CERO filas (id ajeno, fila borrada). Es la mitad
 *  nueva del mock: sin ella, el `.select('id')` post-update devolvería filas
 *  siempre y la comprobación de filas afectadas sería imposible de probar. */
let TOCAN_CERO: Set<string> = new Set();

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
    // Una ESCRITURA que se espera así devuelve las filas tocadas (como el
    // `.select('id')` de PostgREST): una por defecto, cero si la tabla está
    // en TOCAN_CERO — el caso del id ajeno que el WHERE por tenant no toca.
    then: (res: (v: unknown) => unknown) => Promise.resolve(
      FALLAN[tabla]
        ? { data: null, error: { message: FALLAN[tabla] } }
        : {
          data: registro.op === 'select' ? null : (TOCAN_CERO.has(tabla) ? [] : [{ id: `${tabla}-tocada` }]),
          error: null,
        },
    ).then(res),
  };
  return api;
}

// Las tres lecturas agregadas de la 0152 (tablero, carga, incidencias) ya no
// pasan por `from`: van por RPC, y el doble las despacha contra el ESPEJO EN
// JS de la migración (`espejo_0152.pruebas.ts`). Las escrituras y las lecturas
// que siguen en JS conservan el constructor encadenable de arriba.
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => constructor(t),
    rpc: (fn: string, args: Record<string, unknown>) => Promise.resolve(despacharRpc(DOBLE, fn, args)),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const {
  getCargaOperadores, getViajesSinAsignar, getUnidades, getIncidencias,
  getTableroOperacion, cambiarEstadoIncidencia, crearViaje, asignarUnidad, getPods, rechazarPod,
  DIAS_LIQUIDADOS_CARGA, LIMITE_INCIDENCIAS,
  marcarPodPedido, crearIncidencia, validarUnidad, crearUnidad, editarUnidad,
} = await import('./operacion');
const { DatoInvalido } = await import('./errores');

beforeEach(() => {
  TABLAS = {}; FALLAN = {}; TOCAN_CERO = new Set(); escrituras.length = 0;
  DOBLE = crearDoble('2026-08-14');
});

/** Un viaje de la flota `t-1` con lo mínimo que pide la forma. */
const viajeDe = (id: string, operador: string | null, estatus: string, extra: Record<string, unknown> = {}) =>
  ({ id, tenant_id: 't-1', operador_id: operador, estatus, ...extra });

describe('getCargaOperadores — "¿a quién NO le cargo otro?"', () => {
  it('cuenta en curso por operador y deja fuera los viajes sin dueño', async () => {
    DOBLE.base.operador = [
      { id: 'o-1', tenant_id: 't-1', nombre: 'Ana Ruiz', telefono: '52999', activo: true },
      { id: 'o-2', tenant_id: 't-1', nombre: 'Beto Lara', telefono: null, activo: true },
    ];
    DOBLE.base.viaje = [
      viajeDe('v-1', 'o-1', 'abierto'),
      viajeDe('v-2', 'o-1', 'en_cuadre'),
      viajeDe('v-3', 'o-1', 'liquidado'),
      viajeDe('v-4', 'o-2', 'abierto'),
      viajeDe('v-5', null, 'abierto'),   // sin dueño
    ];
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
    DOBLE.base.operador = [{ id: 'o-1', tenant_id: 't-1', nombre: 'Ana', telefono: null, activo: true }];
    DOBLE.base.viaje = [viajeDe('v-1', 'o-1', 'abierto'), viajeDe('v-2', 'o-1', 'abierto')];
    DOBLE.base.pod = [
      { tenant_id: 't-1', viaje_id: 'v-1', estado: 'subido' },
      { tenant_id: 't-1', viaje_id: 'v-2', estado: 'rechazado' },
    ];
    const [ana] = await getCargaOperadores('t-1');
    expect(ana.sinPod).toBe(1);
  });

  it('ordena por carga descendente', async () => {
    DOBLE.base.operador = [
      { id: 'o-1', tenant_id: 't-1', nombre: 'Ana', telefono: null, activo: true },
      { id: 'o-2', tenant_id: 't-1', nombre: 'Beto', telefono: null, activo: true },
    ];
    DOBLE.base.viaje = [
      viajeDe('v-1', 'o-2', 'abierto'), viajeDe('v-2', 'o-2', 'abierto'), viajeDe('v-3', 'o-1', 'abierto'),
    ];
    const r = await getCargaOperadores('t-1');
    expect(r.map((x) => x.nombre)).toEqual(['Beto', 'Ana']);
  });

  it('FE-3: los VIVOS entran siempre; los LIQUIDADOS solo los de la ventana', async () => {
    const ahora = new Date('2026-08-14T12:00:00Z');
    const hace = (dias: number) => new Date(ahora.getTime() - dias * 86_400_000).toISOString();
    DOBLE.base.operador = [{ id: 'o-1', tenant_id: 't-1', nombre: 'Ana', telefono: null, activo: true }];
    DOBLE.base.viaje = [
      viajeDe('v-1', 'o-1', 'abierto', { created_at: hace(400) }),      // viejísimo y VIVO: cuenta
      viajeDe('v-2', 'o-1', 'liquidado', { created_at: hace(10) }),     // dentro de la ventana
      viajeDe('v-3', 'o-1', 'liquidado', { created_at: hace(200) }),    // fuera: no cuenta
    ];
    const [ana] = await getCargaOperadores('t-1', ahora);
    expect(ana.enCurso).toBe(1);
    expect(ana.liquidados).toBe(1);
    // Y la ventana que se le pide a la base es la documentada, no "todo".
    expect(DOBLE.llamadas[0].args.p_desde).toBe(hace(DIAS_LIQUIDADOS_CARGA));
  });

  it('si la lectura falla, LANZA — no devuelve carga cero', async () => {
    DOBLE.error = { message: 'timeout' };
    // Cero viajes por error se leería como "nadie trae nada" y el encargado
    // repartiría trabajo encima de choferes que ya van llenos.
    await expect(getCargaOperadores('t-1')).rejects.toThrow('timeout');
  });

  it('una forma inesperada LANZA y nombra la migración', async () => {
    DOBLE.formaRota = [{ operadorId: 'o-1' }];
    await expect(getCargaOperadores('t-1')).rejects.toThrow('0152');
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

describe('getIncidencias — SLA y el join que ya no trae 600k viajes', () => {
  const ahora = new Date('2026-08-03T12:00:00Z');
  const base = {
    id: 'i-1', tenant_id: 't-1', viaje_id: null, unidad_id: null, tipo: 'averia', prioridad: 'alta',
    descripcion: null, resuelta_en: null,
    abierta_en: '2026-08-03T00:00:00Z',   // 12 h antes
  };

  it('marca vencido solo si HAY SLA pactado y ya se pasó', async () => {
    DOBLE.base.incidencia = [{ ...base, estado: 'abierta', sla_horas: 4 }];
    const [i] = await getIncidencias('t-1', ahora);
    expect(i.horasAbierta).toBe(12);
    expect(i.slaVencido).toBe(true);
  });

  it('sin SLA no está vencida, está SIN PACTAR', async () => {
    DOBLE.base.incidencia = [{ ...base, estado: 'abierta', sla_horas: null }];
    const [i] = await getIncidencias('t-1', ahora);
    expect(i.slaHoras).toBeNull();
    expect(i.slaVencido).toBe(false);
  });

  it('una resuelta no está vencida aunque haya tardado más que el SLA', async () => {
    DOBLE.base.incidencia = [{ ...base, estado: 'resuelta', sla_horas: 4, resuelta_en: '2026-08-03T10:00:00Z' }];
    const [i] = await getIncidencias('t-1', ahora);
    expect(i.horasAbierta).toBe(10);   // se congela al resolver, no sigue corriendo
    expect(i.slaVencido).toBe(false);
  });

  it('el folio y el número económico llegan resueltos DESDE SQL', async () => {
    DOBLE.base.viaje = [viajeDe('v-1', 'o-1', 'abierto', { folio: 'VJ-77' })];
    DOBLE.base.unidad = [{ id: 'u-1', tenant_id: 't-1', numero_economico: 'T-01', estado: 'en_ruta' }];
    DOBLE.base.incidencia = [{ ...base, viaje_id: 'v-1', unidad_id: 'u-1', estado: 'abierta', sla_horas: null }];
    const [i] = await getIncidencias('t-1', ahora);
    expect(i.folio).toBe('VJ-77');
    expect(i.numeroEconomico).toBe('T-01');
  });

  it('un viaje de OTRA flota no presta su folio', async () => {
    DOBLE.base.viaje = [{ id: 'v-x', tenant_id: 't-2', operador_id: 'o-9', estatus: 'abierto', folio: 'AJENO' }];
    DOBLE.base.incidencia = [{ ...base, viaje_id: 'v-x', estado: 'abierta', sla_horas: null }];
    const [i] = await getIncidencias('t-1', ahora);
    expect(i.folio).toBeNull();
  });

  it('las ABIERTAS salen siempre; las resueltas viejas quedan fuera de la ventana', async () => {
    DOBLE.base.incidencia = [
      { ...base, id: 'i-vieja-abierta', estado: 'abierta', sla_horas: null, abierta_en: '2020-01-01T00:00:00Z' },
      { ...base, id: 'i-vieja-resuelta', estado: 'resuelta', sla_horas: null, abierta_en: '2020-01-01T00:00:00Z', resuelta_en: '2020-01-02T00:00:00Z' },
    ];
    const r = await getIncidencias('t-1', ahora);
    expect(r.map((i) => i.id)).toEqual(['i-vieja-abierta']);
    expect(DOBLE.llamadas[0].args.p_limite).toBe(LIMITE_INCIDENCIAS);
  });

  it('si la lectura falla, LANZA — una lista vacía diría "no hay incidencias"', async () => {
    DOBLE.error = { message: 'base caída' };
    await expect(getIncidencias('t-1', ahora)).rejects.toThrow('base caída');
  });
});

describe('getTableroOperacion', () => {
  it('cuenta como pendiente el viaje del que NADIE creó el POD', async () => {
    // El peor cero posible: contar filas de `pod` dejaría fuera justo el viaje
    // que nadie ha tocado, y el tablero diría "no falta ninguno".
    DOBLE.base.viaje = [
      viajeDe('v-1', 'o-1', 'abierto'),
      viajeDe('v-2', 'o-1', 'abierto'),   // sin fila en `pod`
      viajeDe('v-3', 'o-1', 'liquidado'),
    ];
    DOBLE.base.unidad = [
      { id: 'u-1', tenant_id: 't-1', numero_economico: 'T1', estado: 'disponible' },
      { id: 'u-2', tenant_id: 't-1', numero_economico: 'T2', estado: 'taller' },
      { id: 'u-3', tenant_id: 't-1', numero_economico: 'T3', estado: 'en_ruta' },
    ];
    DOBLE.base.incidencia = [{ id: 'i-1', tenant_id: 't-1', tipo: 'averia', estado: 'abierta', abierta_en: '2026-08-01T00:00:00Z' }];
    DOBLE.base.pod = [{ tenant_id: 't-1', viaje_id: 'v-1', estado: 'subido' }];
    const t = await getTableroOperacion('t-1');
    expect(t.podPendientes).toBe(1);
    expect(t.viajesActivos).toBe(2);
    expect(t.unidadesDisponibles).toBe(1);
    expect(t.unidadesEnTaller).toBe(1);
    expect(t.incidenciasAbiertas).toBe(1);
  });

  it('sinUnidad solo cuenta viajes EN CURSO sin dueño', async () => {
    DOBLE.base.viaje = [
      viajeDe('v-1', null, 'abierto'),
      viajeDe('v-2', null, 'liquidado'),   // ya cerró: no se asigna
    ];
    expect((await getTableroOperacion('t-1')).sinUnidad).toBe(1);
  });

  it('una unidad DADA DE BAJA no cuenta como disponible', async () => {
    DOBLE.base.unidad = [
      { id: 'u-1', tenant_id: 't-1', numero_economico: 'T1', estado: 'disponible', activo: false },
      { id: 'u-2', tenant_id: 't-1', numero_economico: 'T2', estado: 'disponible' },
    ];
    expect((await getTableroOperacion('t-1')).unidadesDisponibles).toBe(1);
  });

  it('si la lectura falla, LANZA — un tablero en ceros se lee como "no falta nada"', async () => {
    DOBLE.error = { message: 'timeout' };
    await expect(getTableroOperacion('t-1')).rejects.toThrow('timeout');
  });

  it('una forma inesperada LANZA y nombra la migración', async () => {
    DOBLE.formaRota = { viajesActivos: 3 };
    await expect(getTableroOperacion('t-1')).rejects.toThrow('0152');
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

  // AUDITORÍA 10, ALTO: `operadorId` se escribía tal cual en el INSERT, sin
  // comprobar que fuera de ESTE tenant. El `<select>` de /dashboard/despacho
  // solo ofrece los de `listOperadores(tenantId)`, pero eso es la UI, no el
  // servidor — un POST directo con el operadorId de otra flota dejaba
  // `viaje.tenant_id = A` apuntando a un operador de B, y la RLS del chofer
  // (0045_rls_operador.sql) no vuelve a comprobar tenant al enseñarle sus
  // viajes, gastos y liquidaciones.
  it('crearViaje ACEPTA un operadorId que sí pertenece al tenant', async () => {
    TABLAS = { operador: [{ id: 'o-1' }] };
    await crearViaje('t-1', { folio: 'VJ-10', operadorId: 'o-1' });
    const w = escrituras.find((e) => e.tabla === 'viaje')!;
    expect(w.valores).toMatchObject({ tenant_id: 't-1', operador_id: 'o-1' });
  });

  it('AUDITORÍA 10: crearViaje RECHAZA un operadorId de OTRA flota, y no inserta el viaje', async () => {
    // La consulta va acotada por `tenant_id`: si el operador es de otro
    // tenant, la lectura no lo trae — como en producción.
    TABLAS = { operador: [] };
    await expect(crearViaje('t-1', { folio: 'VJ-11', operadorId: 'o-de-otra-flota' })).rejects.toThrow(
      'crearViaje: el operador no pertenece a esta flota',
    );
    // Mutación: sin esta aserción, borrar el candado y dejar pasar el INSERT
    // seguiría verde en la prueba de arriba.
    expect(escrituras.find((e) => e.tabla === 'viaje')).toBeUndefined();
  });

  // AUDITORÍA 10, MEDIO — mismo patrón que operadorId, hermano documentado y
  // sin arreglar en la ronda pasada: `unidadId` se escribía tal cual en el
  // INSERT/UPDATE de `viaje`, sin comprobar que la unidad fuera de ESTE
  // tenant. `unidad` no tiene RLS que la exponga a un chofer de otra flota
  // (por eso es MEDIO, no ALTO), pero un flota_admin que adivine el UUID de
  // una unidad ajena podía hacer que su PROPIO panel pintara número
  // económico, placas, marca y modelo de esa unidad vía el join de
  // /dashboard/despacho.
  it('crearViaje ACEPTA un unidadId que sí pertenece al tenant', async () => {
    TABLAS = { unidad: [{ id: 'u-1' }] };
    await crearViaje('t-1', { folio: 'VJ-12', unidadId: 'u-1' });
    const w = escrituras.find((e) => e.tabla === 'viaje')!;
    expect(w.valores).toMatchObject({ tenant_id: 't-1', unidad_id: 'u-1' });
  });

  it('AUDITORÍA 10: crearViaje RECHAZA un unidadId de OTRA flota, y no inserta el viaje', async () => {
    TABLAS = { unidad: [] };
    await expect(crearViaje('t-1', { folio: 'VJ-13', unidadId: 'u-de-otra-flota' })).rejects.toThrow(
      'crearViaje: la unidad no pertenece a esta flota',
    );
    expect(escrituras.find((e) => e.tabla === 'viaje')).toBeUndefined();
  });

  it('asignarUnidad ACEPTA una unidad que sí pertenece al tenant', async () => {
    TABLAS = { unidad: [{ id: 'u-1' }] };
    await asignarUnidad('t-1', 'v-1', 'u-1');
    const w = escrituras.find((e) => e.tabla === 'viaje')!;
    expect(w.valores).toEqual({ unidad_id: 'u-1' });
    expect(w.filtros).toEqual([['id', 'v-1'], ['tenant_id', 't-1']]);
  });

  it('AUDITORÍA 10: asignarUnidad RECHAZA una unidad de OTRA flota, y no toca el viaje', async () => {
    // Mismo id, pero la consulta acotada por tenant_id no la trae — como
    // reasignarOperador/getOperador en repo.ts.
    TABLAS = { unidad: [] };
    await expect(asignarUnidad('t-1', 'v-1', 'u-de-otra-flota')).rejects.toThrow(
      'asignarUnidad: la unidad no pertenece a esta flota',
    );
    // seguiría verde en la prueba de arriba.
    expect(escrituras.find((e) => e.tabla === 'viaje')).toBeUndefined();
  });

  it('asignarUnidad(..., null) desasigna sin comprobar nada — no hay unidad que verificar', async () => {
    TABLAS = {};
    await asignarUnidad('t-1', 'v-1', null);
    const w = escrituras.find((e) => e.tabla === 'viaje')!;
    expect(w.valores).toEqual({ unidad_id: null });
  });

  it('asignarUnidad con un viaje que el UPDATE no tocó LANZA — cero filas no es éxito', async () => {
    // El WHERE por tenant deja en cero filas al viaje ajeno o borrado, y
    // Postgres no lo llama error. Antes esta función volvía en silencio y la
    // pantalla decía "asignada" sobre un viaje que sigue igual — la asimetría
    // con editarCliente (clientes.ts) que la auditoría 4 señaló.
    TABLAS = { unidad: [{ id: 'u-1' }] };
    TOCAN_CERO = new Set(['viaje']);
    await expect(asignarUnidad('t-1', 'v-ajeno', 'u-1')).rejects.toThrow(
      'asignarUnidad: el viaje no existe en esta flota',
    );
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

// ── El alta de unidades (auditoría 4, A5) ──────────────────────────────────

const CRUDO_VACIO = {
  numeroEconomico: '', placas: '', marca: '', modelo: '', anio: '',
  polizaVence: '', permisoSictVence: '', verificacionVence: '',
  gpsProveedor: '', gpsDeviceId: '',
};
const HOY = new Date('2026-08-14T12:00:00Z');

describe('validarUnidad — la regla pura del formulario', () => {
  it('lo mínimo: número económico; todo lo demás vacío sale null, no cadena vacía', () => {
    const v = validarUnidad({ ...CRUDO_VACIO, numeroEconomico: ' 47 ' }, HOY);
    expect(v).toEqual({
      numeroEconomico: '47', placas: null, marca: null, modelo: null, anio: null,
      polizaVence: null, permisoSictVence: null, verificacionVence: null,
      gpsProveedor: null, gpsDeviceId: null,
    });
  });

  it('sin número económico no hay unidad — es la llave con la que la flota la nombra', () => {
    expect(() => validarUnidad(CRUDO_VACIO, HOY)).toThrow(DatoInvalido);
    expect(() => validarUnidad({ ...CRUDO_VACIO, numeroEconomico: '   ' }, HOY)).toThrow(/número económico/);
  });

  it('largos: eco 40, placas 20 — los MISMOS topes que POST /v1/unidades', () => {
    expect(() => validarUnidad({ ...CRUDO_VACIO, numeroEconomico: 'x'.repeat(41) }, HOY)).toThrow(/40/);
    expect(() => validarUnidad({ ...CRUDO_VACIO, numeroEconomico: '47', placas: 'x'.repeat(21) }, HOY)).toThrow(/20/);
  });

  it('el año: entero entre 1950 y añoActual+2 (los modelos se venden adelantados)', () => {
    expect(validarUnidad({ ...CRUDO_VACIO, numeroEconomico: '47', anio: '2028' }, HOY).anio).toBe(2028);
    expect(() => validarUnidad({ ...CRUDO_VACIO, numeroEconomico: '47', anio: '2029' }, HOY)).toThrow(/2028/);
    expect(() => validarUnidad({ ...CRUDO_VACIO, numeroEconomico: '47', anio: '1949' }, HOY)).toThrow(/1950/);
    expect(() => validarUnidad({ ...CRUDO_VACIO, numeroEconomico: '47', anio: '2019.5' }, HOY)).toThrow(/entero/);
  });

  it('una vigencia con forma o fecha imposible se rechaza con palabras, no con un error de Postgres', () => {
    expect(() => validarUnidad({ ...CRUDO_VACIO, numeroEconomico: '47', polizaVence: '14/08/2026' }, HOY)).toThrow(/AAAA-MM-DD/);
    expect(() => validarUnidad({ ...CRUDO_VACIO, numeroEconomico: '47', verificacionVence: '2026-02-30' }, HOY)).toThrow(/no es una fecha que exista/);
    const v = validarUnidad({ ...CRUDO_VACIO, numeroEconomico: '47', permisoSictVence: '2026-12-01' }, HOY);
    expect(v.permisoSictVence).toBe('2026-12-01');
  });
});

describe('crearUnidad y editarUnidad — el escritor del panel', () => {
  const UNIDAD = {
    numeroEconomico: '47', placas: 'ABC-123-A', marca: 'Kenworth', modelo: 'T680', anio: 2019,
    polizaVence: '2026-12-01', permisoSictVence: null, verificacionVence: '2027-01-15',
  };
  const UUID = '00000000-0000-4000-8000-000000000001';

  it('crearUnidad escribe las TRES vigencias y ancla tenant — antes las descartaba sin decirlo', async () => {
    const id = await crearUnidad('t-1', UNIDAD);
    const w = escrituras.find((e) => e.tabla === 'unidad')!;
    expect(w.op).toBe('insert');
    expect(w.valores).toEqual({
      tenant_id: 't-1', numero_economico: '47', placas: 'ABC-123-A', marca: 'Kenworth',
      modelo: 'T680', anio: 2019,
      poliza_vence: '2026-12-01', permiso_sict_vence: null, verificacion_vence: '2027-01-15',
      // Sin amarre de GPS capturado, las dos columnas de la 0176 salen `null`
      // —no cadena vacía—: el poller filtra por `gps_proveedor`, y un '' sería
      // un proveedor que no existe.
      gps_proveedor: null, gps_device_id: null,
    });
    expect(id).toBe('unidad-nuevo');
  });

  it('crearUnidad escribe el amarre de GPS cuando viene completo', async () => {
    await crearUnidad('t-1', { ...UNIDAD, gpsProveedor: 'samsara', gpsDeviceId: '281474976710656' });
    const w = escrituras.find((e) => e.tabla === 'unidad')!;
    expect(w.valores).toMatchObject({ gps_proveedor: 'samsara', gps_device_id: '281474976710656' });
  });

  it('un dispositivo SIN proveedor no llega al insert — el poller nunca lo casaría', async () => {
    await expect(crearUnidad('t-1', { ...UNIDAD, gpsDeviceId: '123' })).rejects.toThrow(/no el proveedor de GPS/);
    expect(escrituras.find((e) => e.tabla === 'unidad')).toBeUndefined();
  });

  it('un proveedor SIN dispositivo tampoco: las posiciones llegarían huérfanas', async () => {
    await expect(crearUnidad('t-1', { ...UNIDAD, gpsProveedor: 'samsara' })).rejects.toThrow(/número de dispositivo/);
    expect(escrituras.find((e) => e.tabla === 'unidad')).toBeUndefined();
  });

  it('un proveedor fuera del catálogo se rechaza con la lista de los que sí hay', async () => {
    await expect(crearUnidad('t-1', { ...UNIDAD, gpsProveedor: 'inventado', gpsDeviceId: '1' }))
      .rejects.toThrow(/no es un proveedor de rastreo del catálogo/);
  });

  it('crearUnidad YA VALIDA: un número económico vacío no llega al insert', async () => {
    // Antes no validaba nada — el hueco que dejaba pasar cualquier cosa que
    // no viniera del formulario (que era el único que validaba, en la UI).
    await expect(crearUnidad('t-1', { numeroEconomico: '  ' })).rejects.toThrow(DatoInvalido);
    expect(escrituras.find((e) => e.tabla === 'unidad')).toBeUndefined();
  });

  it('editarUnidad ancla id + tenant, escribe lo validado y acepta la fila tocada', async () => {
    await editarUnidad('t-1', UUID, UNIDAD);
    const w = escrituras.find((e) => e.tabla === 'unidad')!;
    expect(w.op).toBe('update');
    expect(w.valores).toMatchObject({ numero_economico: '47', poliza_vence: '2026-12-01' });
    expect(w.filtros).toEqual([['id', UUID], ['tenant_id', 't-1']]);
  });

  it('editarUnidad con UPDATE de 0 filas LANZA — un id ajeno no se reporta como guardado', async () => {
    TOCAN_CERO = new Set(['unidad']);
    await expect(editarUnidad('t-1', UUID, UNIDAD)).rejects.toThrow(/No se encontró esa unidad/);
  });

  it('editarUnidad rechaza un id que no es uuid sin tocar la base', async () => {
    await expect(editarUnidad('t-1', 'no-un-uuid', UNIDAD)).rejects.toThrow(/No se reconoce esa unidad/);
    expect(escrituras).toHaveLength(0);
  });
});

// ── AUDITORÍA 12 · MEDIO BACKEND: ids referidos tienen que ser de la flota ──
describe('marcarPodPedido y crearIncidencia — el candado de pertenencia', () => {
  it('marcarPodPedido ACEPTA un viaje y operador de la flota', async () => {
    TABLAS = { viaje: [{ id: 'v-1' }], operador: [{ id: 'o-1' }] };
    await marcarPodPedido('t-1', 'v-1', 'o-1');
    const w = escrituras.find((e) => e.tabla === 'pod')!;
    expect(w.valores).toEqual({ tenant_id: 't-1', viaje_id: 'v-1', operador_id: 'o-1', estado: 'pendiente' });
  });

  it('marcarPodPedido RECHAZA un viaje de OTRA flota y no inserta', async () => {
    TABLAS = { viaje: [] };   // la consulta acotada por tenant no lo trae
    await expect(marcarPodPedido('t-1', 'v-ajeno', null)).rejects.toThrow(
      'marcarPodPedido: el viaje no pertenece a esta flota',
    );
    expect(escrituras.filter((e) => e.tabla === 'pod')).toHaveLength(0);
  });

  it('marcarPodPedido RECHAZA un operador de OTRA flota y no inserta', async () => {
    TABLAS = { viaje: [{ id: 'v-1' }], operador: [] };
    await expect(marcarPodPedido('t-1', 'v-1', 'o-ajeno')).rejects.toThrow(
      'marcarPodPedido: el operador no pertenece a esta flota',
    );
    expect(escrituras.filter((e) => e.tabla === 'pod')).toHaveLength(0);
  });

  it('crearIncidencia ACEPTA viaje y unidad de la flota', async () => {
    TABLAS = { viaje: [{ id: 'v-1' }], unidad: [{ id: 'u-1' }] };
    const id = await crearIncidencia('t-1', { viajeId: 'v-1', unidadId: 'u-1', tipo: 'averia' });
    const w = escrituras.find((e) => e.tabla === 'incidencia')!;
    expect(w.valores).toMatchObject({ tenant_id: 't-1', viaje_id: 'v-1', unidad_id: 'u-1', tipo: 'averia' });
    expect(id).toBe('incidencia-nuevo');
  });

  it('crearIncidencia RECHAZA una unidad de OTRA flota', async () => {
    TABLAS = { viaje: [{ id: 'v-1' }], unidad: [] };
    await expect(crearIncidencia('t-1', { viajeId: 'v-1', unidadId: 'u-ajena', tipo: 'averia' })).rejects.toThrow(
      'crearIncidencia: la unidad no pertenece a esta flota',
    );
    expect(escrituras.filter((e) => e.tabla === 'incidencia')).toHaveLength(0);
  });

  it('crearIncidencia RECHAZA un viaje de OTRA flota', async () => {
    TABLAS = { viaje: [] };
    await expect(crearIncidencia('t-1', { viajeId: 'v-ajeno', tipo: 'averia' })).rejects.toThrow(
      'crearIncidencia: el viaje no pertenece a esta flota',
    );
    expect(escrituras.filter((e) => e.tabla === 'incidencia')).toHaveLength(0);
  });
});
