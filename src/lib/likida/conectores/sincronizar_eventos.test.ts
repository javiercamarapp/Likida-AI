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

// AUDITORÍA 25 (LEG-1, ALTO): la compuerta de privacidad (`unidadesSinAvisoPrevio`)
// ahora exige viaje vivo + aviso confirmado para guardar un evento de cámara
// (`sinViajeVivo: 'bloquear'`) — lo que este archivo prueba es OTRA cosa
// (idempotencia, sello, fan-out), así que sus unidades llevan viaje vivo con
// aviso ya dado, y el candado en sí tiene su propia batería en
// `sincronizar_eventos_aud24.test.ts`.
const VIAJES = vi.hoisted(() => [
  { tenant_id: 't-1', unidad_id: 'u-1', operador_id: 'op-1', estatus: 'abierto' },
  { tenant_id: 't-OTRO', unidad_id: 'u-ajena', operador_id: 'op-ajena', estatus: 'abierto' },
]);
const OPERADORES = vi.hoisted(() => [
  { id: 'op-1', tenant_id: 't-1', aviso_privacidad_en: '2026-08-01T00:00:00Z' },
  { id: 'op-ajena', tenant_id: 't-OTRO', aviso_privacidad_en: '2026-08-01T00:00:00Z' },
]);

// La "tabla" evento_seguridad_flota: unicidad (tenant, proveedor, evento) y,
// desde c2-1, el estado de sellado — el barrido lee lo grave NO sellado, así
// que el mock lo simula de verdad: `sellados` marca las llaves ya procesadas
// y el select de pendientes filtra contra él.
const estado = vi.hoisted(() => ({
  guardados: new Map<string, Record<string, unknown>>(),
  sellados: new Set<string>(),
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
      let esUpdate = false;
      api.select = () => api;
      api.eq = (col: string, val: unknown) => { filtros[col] = val; return api; };
      api.in = (col: string, vals: unknown[]) => { filtros[`in:${col}`] = vals; return api; };
      api.not = () => api;
      api.is = () => api;
      api.order = () => api;
      api.limit = () => api;
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
          esUpdate = true;
          estado.sellos.push(cambios);
          return api;
        };
        api.then = (res: (v: unknown) => unknown) => {
          if (esUpdate) {
            estado.sellados.add(`${filtros.tenant_id}|${filtros.proveedor}|${filtros.evento_id_externo}`);
            return res({ data: null, error: null });
          }
          // El barrido de graves pendientes: grave, con unidad, sin sellar.
          const pendientes = [...estado.guardados.entries()]
            .filter(([llave, f]) =>
              f.tenant_id === filtros.tenant_id && f.proveedor === filtros.proveedor &&
              f.grave === true && f.unidad_id !== null && !estado.sellados.has(llave))
            .map(([, f]) => f);
          return res({ data: pendientes, error: null });
        };
      } else if (tabla === 'conector_credencial') {
        api.then = (res: (v: unknown) => unknown) => res(
          estado.errorCredenciales
            ? { data: null, error: { message: estado.errorCredenciales } }
            : { data: estado.credenciales, error: null },
        );
      } else if (tabla === 'viaje') {
        api.then = (res: (v: unknown) => unknown) => res({
          data: VIAJES.filter((v) =>
            v.tenant_id === filtros.tenant_id &&
            (filtros['in:estatus'] as string[]).includes(v.estatus) &&
            (filtros['in:unidad_id'] as string[]).includes(v.unidad_id)),
          error: null,
        });
      } else if (tabla === 'operador') {
        api.then = (res: (v: unknown) => unknown) => res({
          data: OPERADORES.filter((o) =>
            o.tenant_id === filtros.tenant_id &&
            (filtros['in:id'] as string[]).includes(o.id)),
          error: null,
        });
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
    estado.sellados.clear();
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

  // ── AUDITORÍA FABLE CICLO 2 (c2-1) ─────────────────────────────────────────

  it('c2-1: un disparo que FALLA no se sella — la siguiente corrida lo rebarre y el 🚨 sale', async () => {
    disparar.mockResolvedValueOnce({ resultado: 'fallo' } as never);
    const primera = await sincronizarEventosDeFlota('t-1', 'samsara', CRED, samsaraCon([CHOQUE]), AHORA);
    // El fallo transitorio: nada sellado, nada contado como disparado.
    expect(primera).toMatchObject({ guardados: 1, disparos: 0 });
    expect(estado.sellos).toHaveLength(0);
    // Segunda corrida, misma ventana: el upsert es duplicado (guardados 0)
    // pero el BARRIDO encuentra la fila grave sin sellar y reintenta.
    const segunda = await sincronizarEventosDeFlota('t-1', 'samsara', CRED, samsaraCon([CHOQUE]), AHORA);
    expect(segunda).toMatchObject({ guardados: 0, disparos: 1 });
    expect(disparar).toHaveBeenCalledTimes(2);
    expect(estado.sellos).toHaveLength(1);
  });

  it('c2-1: el barrido corre aunque la ventana venga VACÍA — el pendiente de hace dos corridas no se queda mudo', async () => {
    disparar.mockResolvedValueOnce({ resultado: 'fallo' } as never);
    await sincronizarEventosDeFlota('t-1', 'samsara', CRED, samsaraCon([CHOQUE]), AHORA);
    // El proveedor ya no re-entrega el evento (salió de la ventana), pero la
    // fila grave sin sellar sigue en la tabla: el barrido la levanta igual.
    const r = await sincronizarEventosDeFlota('t-1', 'samsara', CRED, samsaraCon([]), AHORA);
    expect(r).toMatchObject({ leidos: 0, guardados: 0, disparos: 1 });
    expect(disparar).toHaveBeenCalledTimes(2);
    expect(estado.sellos).toHaveLength(1);
    expect(estado.sellos[0]).toMatchObject({ incidencia_id: 'inc-1' });
  });

  it('c2-1: el sello solo se escribe tras un disparo que NO falló — jamás miente', async () => {
    await sincronizarEventosDeFlota('t-1', 'samsara', CRED, samsaraCon([CHOQUE]), AHORA);
    expect(estado.sellos).toHaveLength(1);
    // Tercera corrida: ya sellado, el barrido no lo vuelve a levantar.
    const r = await sincronizarEventosDeFlota('t-1', 'samsara', CRED, samsaraCon([]), AHORA);
    expect(r.disparos).toBe(0);
    expect(disparar).toHaveBeenCalledTimes(1);
  });
});

describe('sincronizarEventosTodas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    estado.guardados.clear();
    estado.sellados.clear();
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

  // ── EL RELOJ DURO (auditoría 21) ──────────────────────────────────────────
  // Esta fase corre EN SERIE después de las posiciones, que solas ya toman
  // ~180 s de un techo de 300: es la fase que Vercel mataba a la mitad, con el
  // barrido de graves (choque/volcadura) sin correr, sin latido y sin alerta.
  // El corte va ANTES de despachar cada flota (patrón `vigilarPortales`/#152);
  // lo que quede lo absorben la ventana traslapada de 30 min y el rebarrido
  // por `procesado_en` NULL, que existen exactamente para esto — pero ahora la
  // corrida termina LIMPIA y lo pendiente se dice, en vez de morir muda.
  it('con el presupuesto vencido no despacha NI UNA flota: ni red, ni disparos — todas sin turno, dichas', async () => {
    estado.credenciales = [
      { tenant_id: 't-1', conector_id: 'samsara', valores_cifrados: CRED },
      { tenant_id: 't-OTRO', conector_id: 'samsara', valores_cifrados: CRED },
    ];
    const http = vi.fn(samsaraCon([CHOQUE]));
    const rs = await sincronizarEventosTodas(http, { venceEn: 100, ahora: () => 100 });

    expect(rs).toHaveLength(2);
    expect(rs.every((r) => r.sinTurno === true)).toBe(true);
    expect(rs.every((r) => r.error === undefined)).toBe(true);
    expect(http).not.toHaveBeenCalled();
    expect(disparar).not.toHaveBeenCalled();
    expect(estado.guardados.size).toBe(0);
  });

  it('el reloj vence a MEDIA corrida: la flota en vuelo termina (su choque SÍ dispara) y las demás quedan sin turno', async () => {
    estado.credenciales = [
      { tenant_id: 't-1', conector_id: 'samsara', valores_cifrados: CRED },
      { tenant_id: 't-OTRO', conector_id: 'samsara', valores_cifrados: CRED },
      { tenant_id: 't-3', conector_id: 'samsara', valores_cifrados: CRED },
    ];
    let reloj = 0;
    const http = vi.fn(async () => {
      reloj = 1_000; // la primera llamada de red consume el presupuesto entero
      return { estado: 200, cuerpo: JSON.stringify({ data: [CHOQUE], pagination: { hasNextPage: false } }) };
    });
    const rs = await sincronizarEventosTodas(http, { venceEn: 500, ahora: () => reloj });

    // La unidad atómica se respeta: la flota en vuelo termina su fase completa,
    // incluido el disparo de asistencia de su choque.
    expect(rs[0].sinTurno).toBeUndefined();
    expect(rs[0].guardados).toBe(1);
    expect(rs[0].disparos).toBe(1);
    // Las siguientes no arrancan, y salen nombradas SIN error: su turno es de
    // la corrida que viene, no un fallo.
    expect(rs[1].sinTurno).toBe(true);
    expect(rs[2].sinTurno).toBe(true);
    expect(rs[1].error).toBeUndefined();
    expect(http).toHaveBeenCalledTimes(1);
  });
});
