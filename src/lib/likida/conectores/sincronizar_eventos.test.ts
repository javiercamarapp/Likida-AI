import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Http } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// EL POLLER DE EVENTOS — probado con el LECTOR REAL de Samsara (el http es
// falso, el mapeo no). Lo que se defiende aquí:
//  · idempotencia: la ventana traslapada re-entrega y NO duplica ni re-dispara;
//  · el disparo exige nuevo + grave + con unidad, las tres a la vez;
//  · el mapa asset→unidad respeta la flota (mismo device id en otro tenant
//    NO se lo lleva);
//  · sin scope de eventos se REPORTA, no se finge ni tumba la corrida.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../presupuesto', () => ({ acotada: (q: unknown) => q }));
vi.mock('./cofre', () => ({ descifrar: (v: string) => JSON.parse(v) }));

const disparar = vi.hoisted(() => vi.fn(async () => ({ resultado: 'abierta' as const, incidenciaId: 'inc-1', avisado: true })));
vi.mock('../asistencia_camara', () => ({ dispararAsistenciaPorEventoCamara: disparar }));

// Unidades de DOS flotas con el MISMO device id — el candado de aislamiento.
const UNIDADES = vi.hoisted(() => [
  { id: 'u-1', tenant_id: 't-1', gps_proveedor: 'samsara', gps_device_id: 'dev-1' },
  { id: 'u-ajena', tenant_id: 't-OTRO', gps_proveedor: 'samsara', gps_device_id: 'dev-1' },
]);

// La "tabla" evento_seguridad_flota: unicidad (tenant, proveedor, evento).
const estado = vi.hoisted(() => ({
  guardados: new Map<string, Record<string, unknown>>(),
  sellos: [] as Array<Record<string, unknown>>,
  credenciales: [] as Array<Record<string, unknown>>,
  errorCredenciales: null as string | null,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api: any = {};
      const filtros: Record<string, unknown> = {};
      api.select = () => api;
      api.eq = (col: string, val: unknown) => { filtros[col] = val; return api; };
      api.in = (col: string, vals: unknown[]) => { filtros[`in:${col}`] = vals; return api; };
      if (tabla === 'unidad') {
        api.then = (res: (v: unknown) => unknown) => res({
          data: UNIDADES.filter((u) =>
            u.tenant_id === filtros.tenant_id &&
            u.gps_proveedor === filtros.gps_proveedor &&
            (filtros['in:gps_device_id'] as unknown[]).includes(u.gps_device_id)),
          error: null,
        });
      } else if (tabla === 'evento_seguridad_flota') {
        api.upsert = (fila: Record<string, unknown>, _opts: unknown) => ({
          select: () => {
            const llave = `${fila.tenant_id}|${fila.proveedor}|${fila.evento_id_externo}`;
            if (estado.guardados.has(llave)) return Promise.resolve({ data: [], error: null });
            estado.guardados.set(llave, fila);
            return Promise.resolve({ data: [{ id: `fila-${estado.guardados.size}` }], error: null });
          },
        });
        api.update = (cambios: Record<string, unknown>) => {
          estado.sellos.push(cambios);
          return api;
        };
        api.then = (res: (v: unknown) => unknown) => res({ data: null, error: null });
      } else if (tabla === 'conector_credencial') {
        api.then = (res: (v: unknown) => unknown) => res(
          estado.errorCredenciales
            ? { data: null, error: { message: estado.errorCredenciales } }
            : { data: estado.credenciales, error: null },
        );
      }
      return api;
    },
  }),
}));

import { sincronizarEventosDeFlota, sincronizarEventosTodas } from './sincronizar_eventos';

const CRED = JSON.stringify({ token: 'tok-1' });

// Un `Http` que contesta como el stream v2 de Samsara con los eventos dados.
const samsaraCon = (eventos: unknown[], estadoHttp = 200): Http => async () => ({
  estado: estadoHttp,
  cuerpo: JSON.stringify({ data: eventos, pagination: { hasNextPage: false } }),
});

const AHORA = new Date('2026-08-26T18:00:00Z');
const CHOQUE = {
  id: 'evt-choque',
  startMs: '2026-08-26T17:55:00Z',
  asset: { id: 'dev-1' },
  location: { latitude: 20.97, longitude: -89.62 },
  behaviorLabels: [{ label: 'Crash' }],
  maxAccelerationGForce: 2.4,
};
const FRENADO = {
  id: 'evt-frenado',
  startMs: '2026-08-26T17:56:00Z',
  asset: { id: 'dev-1' },
  behaviorLabels: [{ label: 'Braking' }],
};

describe('sincronizarEventosDeFlota', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    estado.guardados.clear();
    estado.sellos = [];
    estado.credenciales = [];
    estado.errorCredenciales = null;
  });

  it('guarda TODO, dispara SOLO el grave, y sella la fila con la incidencia', async () => {
    const r = await sincronizarEventosDeFlota('t-1', 'samsara', CRED, samsaraCon([CHOQUE, FRENADO]), AHORA);
    expect(r).toMatchObject({ leidos: 2, guardados: 2, huerfanos: 0, disparos: 1 });
    expect(disparar).toHaveBeenCalledTimes(1);
    expect(disparar).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't-1', unidadId: 'u-1', eventoIdExterno: 'evt-choque',
      etiquetas: ['Crash'], lat: 20.97, lng: -89.62, maxG: 2.4,
    }));
    // La fila del choque quedó marcada grave; la del frenado no.
    const filas = [...estado.guardados.values()];
    expect(filas.find((f) => f.evento_id_externo === 'evt-choque')?.grave).toBe(true);
    expect(filas.find((f) => f.evento_id_externo === 'evt-frenado')?.grave).toBe(false);
    // El sello lleva la incidencia del disparo.
    expect(estado.sellos).toHaveLength(1);
    expect(estado.sellos[0]).toMatchObject({ incidencia_id: 'inc-1' });
  });

  it('la ventana traslapada re-entrega y NO vuelve a disparar (idempotencia)', async () => {
    await sincronizarEventosDeFlota('t-1', 'samsara', CRED, samsaraCon([CHOQUE]), AHORA);
    const segunda = await sincronizarEventosDeFlota('t-1', 'samsara', CRED, samsaraCon([CHOQUE]), AHORA);
    expect(segunda).toMatchObject({ leidos: 1, guardados: 0, disparos: 0 });
    expect(disparar).toHaveBeenCalledTimes(1);
  });

  it('un vehículo que ninguna unidad reclama es HUÉRFANO: se guarda, no dispara', async () => {
    const r = await sincronizarEventosDeFlota('t-1', 'samsara', CRED,
      samsaraCon([{ ...CHOQUE, asset: { id: 'dev-desconocido' } }]), AHORA);
    expect(r).toMatchObject({ guardados: 1, huerfanos: 1, disparos: 0 });
    expect(disparar).not.toHaveBeenCalled();
  });

  it('el mismo device id en OTRA flota no se mapea: el filtro por tenant manda', async () => {
    // t-OTRO tiene una unidad con dev-1 — pero la corrida es de t-OTRO y su
    // unidad ES u-ajena; la corrida de t-1 jamás debe ver u-ajena.
    const r = await sincronizarEventosDeFlota('t-OTRO', 'samsara', CRED, samsaraCon([CHOQUE]), AHORA);
    expect(disparar).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-OTRO', unidadId: 'u-ajena' }));
    expect(r.huerfanos).toBe(0);
  });

  it('sin el scope de eventos: se reporta con nombre, no revienta la corrida', async () => {
    const r = await sincronizarEventosDeFlota('t-1', 'samsara', CRED, samsaraCon([], 403), AHORA);
    expect(r.sinPermiso).toBe(true);
    expect(r.error).toContain('Read Safety Events & Scores');
    expect(disparar).not.toHaveBeenCalled();
  });

  it('un evento con coordenadas imposibles no cruza a Postgres (segunda barrera)', async () => {
    const r = await sincronizarEventosDeFlota('t-1', 'samsara', CRED,
      samsaraCon([{ ...CHOQUE, location: { latitude: 999, longitude: -89.62 } }]), AHORA);
    expect(r).toMatchObject({ leidos: 0, guardados: 0, disparos: 0 });
  });
});

describe('sincronizarEventosTodas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    estado.guardados.clear();
    estado.sellos = [];
    estado.credenciales = [];
    estado.errorCredenciales = null;
  });

  it('itera las flotas con credencial y junta los resultados', async () => {
    estado.credenciales = [
      { tenant_id: 't-1', conector_id: 'samsara', valores_cifrados: CRED },
      { tenant_id: 't-OTRO', conector_id: 'samsara', valores_cifrados: CRED },
    ];
    const rs = await sincronizarEventosTodas(samsaraCon([CHOQUE]));
    expect(rs).toHaveLength(2);
    expect(rs.map((r) => r.tenantId).sort()).toEqual(['t-1', 't-OTRO']);
    expect(rs.every((r) => r.guardados === 1)).toBe(true);
  });

  it('si la lectura de credenciales falla, LANZA — un [] silencioso pintaría verde una base caída', async () => {
    estado.errorCredenciales = 'base caída';
    await expect(sincronizarEventosTodas(samsaraCon([]))).rejects.toThrow('eventos.credenciales');
  });
});
