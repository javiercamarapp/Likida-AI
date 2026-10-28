import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Http } from './tipos';

// AUDITORÍA 39, Ola 8 (lote O8-6): A39-S38-02 (la atribución histórica de privacidad trataba `viaje.fecha_fin` NULL como
// «abierto para siempre» y no paginaba) y A39-S38-03 (la fila mínima bloqueaba a la completa y la cuarentena se marcaba
// resuelta sin reparar nada). Datos sintéticos.

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../presupuesto', () => ({ acotada: (q: unknown) => q }));
vi.mock('./cofre', () => ({ descifrar: (v: string) => JSON.parse(v) }));

const disparar = vi.hoisted(() => vi.fn(async () => ({ resultado: 'abierta' as const, incidenciaId: 'inc-1', avisoEstado: 'no_requerido' as const })));
vi.mock('../asistencia_camara', () => ({ dispararAsistenciaPorEventoCamara: disparar }));

type Fila = Record<string, unknown>;
const estado = vi.hoisted(() => ({
  guardados: new Map<string, Record<string, unknown>>(),
  viajes: [] as Array<Record<string, unknown>>,
  operadores: [] as Array<Record<string, unknown>>,
  /** Lo que `count` dice que hay del lado de la base en la consulta de viajes (null = el doble no manda count). */
  conteoViajes: null as number | null,
  rangosViaje: [] as Array<[number, number]>,
  filtrosOr: [] as string[],
  updates: [] as Array<{ cambios: Record<string, unknown>; filtros: Record<string, unknown> }>,
  /** Cuántas filas dice haber actualizado el update de promoción (simula la carrera). */
  filasPromovidas: 1,
  errorLecturaMinimas: false,
  claimsCuarentena: [] as Array<Record<string, unknown>>,
  finalizaciones: [] as Array<Record<string, unknown>>,
}));

const rpc = vi.hoisted(() => vi.fn(async (nombre: string, args: Record<string, unknown>) => {
  if (nombre === 'reclamar_cuarentena_eventos') return { data: estado.claimsCuarentena, error: null };
  if (nombre === 'finalizar_cuarentena_evento') { estado.finalizaciones.push(args); return { data: true, error: null }; }
  if (nombre === 'reclamar_eventos_seguridad') return { data: [], error: null };
  return { data: null, error: { message: `rpc inesperado ${nombre}` } };
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc,
    from: (tabla: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api: any = {};
      const filtros: Record<string, unknown> = {};
      let cambios: Record<string, unknown> | null = null;
      let rango: [number, number] | null = null;
      api.select = () => api;
      api.eq = (c: string, v: unknown) => { filtros[c] = v; return api; };
      api.in = (c: string, v: unknown[]) => { filtros[`in:${c}`] = v; return api; };
      api.not = () => api;
      api.is = () => api;
      api.order = () => api;
      api.limit = () => api;
      api.or = (f: string) => { if (tabla === 'viaje') estado.filtrosOr.push(f); return api; };
      api.range = (d: number, h: number) => { rango = [d, h]; if (tabla === 'viaje') estado.rangosViaje.push([d, h]); return api; };
      api.maybeSingle = () => Promise.resolve({ data: { zona_horaria: 'America/Mexico_City' }, error: null });
      api.update = (c: Record<string, unknown>) => { cambios = c; return api; };
      if (tabla === 'unidad') {
        api.then = (res: (v: unknown) => unknown) => res({ data: [{ id: 'u-1', tenant_id: 't-1', gps_proveedor: 'samsara', gps_device_id: 'dev-1' }], error: null });
      } else if (tabla === 'evento_seguridad_flota') {
        api.upsert = (filas: Fila[]) => ({
          select: () => {
            const nuevas = filas.filter((f) => {
              const llave = `${f.tenant_id}|${f.proveedor}|${f.evento_id_externo}`;
              if (estado.guardados.has(llave)) return false;
              estado.guardados.set(llave, f);
              return true;
            });
            return Promise.resolve({ data: nuevas.map((f) => ({ id: `fila-${f.evento_id_externo}`, evento_id_externo: f.evento_id_externo })), error: null });
          },
        });
        api.then = (res: (v: unknown) => unknown) => {
          if (cambios) {
            estado.updates.push({ cambios, filtros: { ...filtros } });
            const llave = `${filtros.tenant_id}|${filtros.proveedor}|${filtros.evento_id_externo}`;
            const previa = estado.guardados.get(llave);
            // La promoción solo toca la fila si sigue siendo mínima (el .eq('privacidad_minima', true)).
            if (filtros.privacidad_minima === true && previa?.privacidad_minima === true && estado.filasPromovidas > 0) {
              estado.guardados.set(llave, { ...previa, ...cambios });
              return res({ data: [{ id: 'x' }], error: null });
            }
            return res({ data: [], error: null });
          }
          if (filtros.privacidad_minima === true) {
            if (estado.errorLecturaMinimas) return res({ data: null, error: { message: 'lectura caída' } });
            const ids = (filtros['in:evento_id_externo'] ?? []) as string[];
            const minimas = [...estado.guardados.values()].filter((f) => f.privacidad_minima === true && ids.includes(String(f.evento_id_externo)));
            return res({ data: minimas, error: null });
          }
          return res({ data: [], error: null });
        };
      } else if (tabla === 'viaje') {
        api.then = (res: (v: unknown) => unknown) => {
          const todas = estado.viajes.filter((v) => v.tenant_id === filtros.tenant_id && (filtros['in:unidad_id'] as string[]).includes(String(v.unidad_id)));
          const [d, h] = rango ?? [0, 999];
          return res({ data: todas.slice(d, h + 1), error: null, count: estado.conteoViajes ?? todas.length });
        };
      } else if (tabla === 'operador') {
        api.then = (res: (v: unknown) => unknown) => res({
          data: estado.operadores.filter((o) => o.tenant_id === filtros.tenant_id && (filtros['in:id'] as string[]).includes(String(o.id))),
          error: null,
        });
      } else if (tabla === 'evento_seguridad_cuarentena') {
        api.upsert = (filas: Fila[]) => ({ select: () => Promise.resolve({ data: filas, error: null }) });
      } else {
        api.then = (res: (v: unknown) => unknown) => res({ data: [], error: null });
      }
      return api;
    },
  }),
}));

import { sincronizarEventosDeFlota } from './sincronizar_eventos';

const CRED = JSON.stringify({ token: 'tok-1' });
const AHORA = new Date('2026-09-03T18:00:00Z');
const samsaraCon = (eventos: unknown[]): Http => async () => ({
  estado: 200,
  cuerpo: JSON.stringify({ data: eventos, pagination: { hasNextPage: false } }),
});
const CHOQUE = {
  id: 'evt-choque', startMs: '2026-09-03T17:55:00Z', asset: { id: 'dev-1' },
  location: { latitude: 20.97, longitude: -89.62 },
  behaviorLabels: [{ label: 'Crash' }], inboxEventUrl: 'https://video.test/privado', maxAccelerationGForce: 8.7,
};
const viaje = (id: string, operador: string, extra: Record<string, unknown> = {}) => ({
  id, folio: `F-${id}`, tenant_id: 't-1', unidad_id: 'u-1', operador_id: operador,
  estatus: 'liquidado', fecha_inicio: '2026-08-01', fecha_fin: null, aceptado_en: null,
  regreso_en: null, descarga_en: null, llegada_en: null, tms_llegada_en: null, ...extra,
});
const operador = (id: string, aviso: string | null = '2026-07-01T00:00:00Z') => ({ id, tenant_id: 't-1', aviso_privacidad_en: aviso });
const fila = (clave: string) => estado.guardados.get(`t-1|samsara|${clave}`);

beforeEach(() => {
  vi.clearAllMocks();
  estado.guardados.clear();
  estado.viajes = [];
  estado.operadores = [operador('op-a'), operador('op-b')];
  estado.conteoViajes = null;
  estado.rangosViaje = [];
  estado.filtrosOr = [];
  estado.updates = [];
  estado.filasPromovidas = 1;
  estado.errorLecturaMinimas = false;
  estado.claimsCuarentena = [];
  estado.finalizaciones = [];
});

describe('A39-S38-02 · fecha_fin NULL ya no es «abierto para siempre»', () => {
  it('B (fail-open de privacidad): el viaje viejo LIQUIDADO del chofer A no cubre el evento de hoy del chofer B', async () => {
    // A: viaje de agosto, liquidado, sin fecha_fin ni marcas (ningún flujo escribe fecha_fin). B conduce hoy sin viaje registrado.
    estado.viajes = [viaje('v-a', 'op-a')];
    const r = await sincronizarEventosDeFlota('t-1', 'samsara', CRED, samsaraCon([CHOQUE]), AHORA);
    expect(r.guardados).toBe(1);
    const f = fila('evt-choque')!;
    expect(f.privacidad_minima).toBe(true);
    expect(f.viaje_id).toBeNull();
    expect(f.operador_id).toBeNull();
    expect(f.lat).toBeNull();
  });

  it('A: dos viajes históricos cerrados no vuelven ambiguo el evento de hoy; lo cubre el viaje que sigue abierto', async () => {
    estado.viajes = [
      viaje('v-viejo-1', 'op-a', { fecha_inicio: '2026-08-01' }),
      viaje('v-viejo-2', 'op-a', { fecha_inicio: '2026-08-10' }),
      viaje('v-vivo', 'op-b', { estatus: 'abierto', fecha_inicio: '2026-09-02' }),
    ];
    await sincronizarEventosDeFlota('t-1', 'samsara', CRED, samsaraCon([CHOQUE]), AHORA);
    const f = fila('evt-choque')!;
    expect(f.privacidad_minima).toBe(false);
    expect(f.viaje_id).toBe('v-vivo');
    expect(f.operador_id).toBe('op-b');
    expect(f.lat).toBe(20.97);
  });

  it('un viaje cerrado con marcas de actividad (regreso) cubre hasta esa marca, no más', async () => {
    estado.viajes = [viaje('v-cerrado', 'op-a', { fecha_inicio: '2026-09-01', regreso_en: '2026-09-03T20:00:00Z' })]; // 14:00 hora de México del 3
    await sincronizarEventosDeFlota('t-1', 'samsara', CRED, samsaraCon([CHOQUE]), AHORA);
    expect(fila('evt-choque')).toMatchObject({ privacidad_minima: false, viaje_id: 'v-cerrado', operador_id: 'op-a' });
    estado.guardados.clear();
    estado.viajes = [viaje('v-cerrado', 'op-a', { fecha_inicio: '2026-09-01', regreso_en: '2026-09-02T20:00:00Z' })];
    await sincronizarEventosDeFlota('t-1', 'samsara', CRED, samsaraCon([CHOQUE]), AHORA);
    expect(fila('evt-choque')).toMatchObject({ privacidad_minima: true, viaje_id: null });
  });

  it('un viaje cerrado sin marcas cubre solo su día de inicio', async () => {
    estado.viajes = [viaje('v-hoy', 'op-a', { fecha_inicio: '2026-09-03' })];
    await sincronizarEventosDeFlota('t-1', 'samsara', CRED, samsaraCon([CHOQUE]), AHORA);
    expect(fila('evt-choque')).toMatchObject({ privacidad_minima: false, viaje_id: 'v-hoy' });
  });

  it('la consulta ACOTA a la base lo que antes era «fecha_fin is null» sin límite, y pide el conteo', async () => {
    estado.viajes = [viaje('v-vivo', 'op-b', { estatus: 'abierto', fecha_inicio: '2026-09-02' })];
    await sincronizarEventosDeFlota('t-1', 'samsara', CRED, samsaraCon([CHOQUE]), AHORA);
    const filtro = estado.filtrosOr.find((f) => f.includes('fecha_fin.gte')) ?? '';
    expect(filtro).toContain('and(fecha_fin.is.null,estatus.in.(abierto,en_cuadre))');
    expect(filtro).toContain('regreso_en.gte.');
    expect(filtro).not.toMatch(/(^|,)fecha_fin\.is\.null(,|$)/);
  });

  it('PAGINA: un viaje correcto que cae fuera de las primeras 1,000 filas se lee en la página siguiente', async () => {
    const relleno = Array.from({ length: 1000 }, (_, i) => viaje(`v-r${i}`, 'op-a', { fecha_inicio: '2026-01-01', fecha_fin: '2026-01-02' }));
    estado.viajes = [...relleno, viaje('v-correcto', 'op-b', { estatus: 'abierto', fecha_inicio: '2026-09-02' })];
    await sincronizarEventosDeFlota('t-1', 'samsara', CRED, samsaraCon([CHOQUE]), AHORA);
    expect(estado.rangosViaje).toEqual([[0, 999], [1000, 1999]]);
    expect(fila('evt-choque')).toMatchObject({ privacidad_minima: false, viaje_id: 'v-correcto' });
  });
});

describe('A39-S38-03 · la fila mínima se PROMUEVE y la cuarentena no se resuelve sin reparar', () => {
  const minima = () => ({
    tenant_id: 't-1', proveedor: 'samsara', evento_id_externo: 'evt-choque', unidad_id: 'u-1',
    privacidad_minima: true, grave: true, ocurrido_en: '2026-09-03T17:00:00.000Z',
    asset_id: null, etiquetas: [], lat: null, lng: null, url_evento: null, max_g: null, viaje_id: null, operador_id: null, viaje_folio: null,
  });

  it('un fallo transitorio dejó la fila mínima; al reintentar con autorización válida se completa (ubicación, video y G)', async () => {
    estado.guardados.set('t-1|samsara|evt-choque', minima());
    estado.viajes = [viaje('v-vivo', 'op-b', { estatus: 'abierto', fecha_inicio: '2026-09-02' })];
    const r = await sincronizarEventosDeFlota('t-1', 'samsara', CRED, samsaraCon([CHOQUE]), AHORA);
    expect(r.guardados).toBe(0); // el upsert la ignora: la promoción es lo que la completa
    expect(estado.updates).toHaveLength(1);
    expect(estado.updates[0].filtros).toMatchObject({ evento_id_externo: 'evt-choque', privacidad_minima: true });
    expect(fila('evt-choque')).toMatchObject({
      privacidad_minima: false, lat: 20.97, lng: -89.62, max_g: 8.7, url_evento: 'https://video.test/privado',
      viaje_id: 'v-vivo', operador_id: 'op-b', ocurrido_en: '2026-09-03T17:55:00.000Z',
    });
    // Promover no toca el sello de procesado: la alerta mínima no se repite.
    expect(estado.updates[0].cambios).not.toHaveProperty('procesado_en');
  });

  it('una fila ya completa NO se toca (no hay un update por cada duplicado de la ventana traslapada)', async () => {
    estado.viajes = [viaje('v-vivo', 'op-b', { estatus: 'abierto', fecha_inicio: '2026-09-02' })];
    await sincronizarEventosDeFlota('t-1', 'samsara', CRED, samsaraCon([CHOQUE]), AHORA);
    await sincronizarEventosDeFlota('t-1', 'samsara', CRED, samsaraCon([CHOQUE]), AHORA);
    expect(estado.updates).toHaveLength(0);
  });

  it('sin autorización, la fila mínima se queda mínima (no se promueve por la puerta de atrás)', async () => {
    estado.guardados.set('t-1|samsara|evt-choque', minima());
    estado.viajes = [viaje('v-a', 'op-a')]; // viejo liquidado
    await sincronizarEventosDeFlota('t-1', 'samsara', CRED, samsaraCon([CHOQUE]), AHORA);
    expect(estado.updates).toHaveLength(0);
    expect(fila('evt-choque')).toMatchObject({ privacidad_minima: true, lat: null });
  });

  /** La primera lectura (la de la cuarentena) devuelve el choque; la ventana normal viene vacía. */
  const soloEnRelectura = (): Http => {
    let n = 0;
    return async () => ({ estado: 200, cuerpo: JSON.stringify({ data: (n += 1) === 1 ? [CHOQUE] : [], pagination: { hasNextPage: false } }) });
  };
  const recuperado = () => {
    estado.claimsCuarentena = [{ evento_id_externo: 'evt-choque', ocurrido_en: '2026-09-03T17:55:00Z', motivo: 'viaje_ambiguo', claim_token: 'q-1' }];
    estado.viajes = [viaje('v-vivo', 'op-b', { estatus: 'abierto', fecha_inicio: '2026-09-02' })];
  };

  it('cuarentena: la relectura autorizada PROMUEVE la fila mínima y solo entonces resuelve el claim', async () => {
    estado.guardados.set('t-1|samsara|evt-choque', minima());
    recuperado();
    await sincronizarEventosDeFlota('t-1', 'samsara', CRED, soloEnRelectura(), AHORA);
    expect(fila('evt-choque')).toMatchObject({ privacidad_minima: false, lat: 20.97 });
    expect(estado.finalizaciones).toHaveLength(1);
    expect(estado.finalizaciones[0]).toMatchObject({ p_resuelto: true });
  });

  it('cuarentena: si la promoción no afectó ninguna fila, el claim NO se da por resuelto', async () => {
    estado.guardados.set('t-1|samsara|evt-choque', minima());
    estado.filasPromovidas = 0;
    recuperado();
    await sincronizarEventosDeFlota('t-1', 'samsara', CRED, soloEnRelectura(), AHORA);
    expect(fila('evt-choque')).toMatchObject({ privacidad_minima: true });
    expect(estado.finalizaciones).toHaveLength(1);
    expect(estado.finalizaciones[0]).toMatchObject({ p_resuelto: false });
  });

  it('cuarentena: si no se pudo ni leer si la fila es mínima, el claim NO se resuelve', async () => {
    estado.guardados.set('t-1|samsara|evt-choque', minima());
    estado.errorLecturaMinimas = true;
    recuperado();
    const r = await sincronizarEventosDeFlota('t-1', 'samsara', CRED, soloEnRelectura(), AHORA);
    expect(estado.finalizaciones[0]).toMatchObject({ p_resuelto: false });
    expect(r.backlog).toBe(true);
  });
});
