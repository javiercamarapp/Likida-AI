import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Http } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24, LEG-1 (CRÍTICO) — LA CÁMARA TAMBIÉN AVISA ANTES.
//
// Un evento de `evento_seguridad_flota` no es telemetría de un fierro: es la
// CONDUCTA AL VOLANTE de una persona identificada, con lat/lng, hora y a veces
// video. Guardarlo es tratamiento de dato personal, y el art. 16 LFPDPPP pide
// el aviso ANTES. El poller de cámara tiene que pasar por la MISMA compuerta
// que el de GPS y que la jornada: `unidadesSinAvisoPrevio`.
//
// Y si la base no contesta quién va al volante, no se guarda NINGÚN evento de
// esa flota: fallar cerrado. Los huérfanos (sin unidad) no están ligados a
// ninguna persona y siguen entrando como siempre.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../presupuesto', () => ({ acotada: (q: unknown) => q }));
vi.mock('./cofre', () => ({ descifrar: (v: string) => JSON.parse(v) }));
vi.mock('../asistencia_camara', () => ({
  dispararAsistenciaPorEventoCamara: vi.fn(async () => ({ resultado: 'abierta' as const, incidenciaId: 'inc-1', avisado: true })),
}));

const UNIDADES = vi.hoisted(() => [
  { id: 'u-1', tenant_id: 't-1', gps_proveedor: 'samsara', gps_device_id: 'dev-1' },
  { id: 'u-2', tenant_id: 't-1', gps_proveedor: 'samsara', gps_device_id: 'dev-2' },
]);

const estado = vi.hoisted(() => ({
  guardados: [] as Array<Record<string, unknown>>,
  viajes: [] as Array<Record<string, unknown>>,
  operadores: [] as Array<Record<string, unknown>>,
  errorViaje: null as string | null,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api: any = {};
      const filtros: Record<string, unknown> = {};
      let esUpdate = false;
      api.select = () => api;
      api.eq = (c: string, v: unknown) => { filtros[c] = v; return api; };
      api.in = (c: string, v: unknown[]) => { filtros[`in:${c}`] = v; return api; };
      api.not = () => api; api.is = () => api; api.order = () => api; api.limit = () => api;
      api.update = () => { esUpdate = true; return api; };

      const casa = (f: Record<string, unknown>) =>
        Object.entries(filtros).every(([k, v]) =>
          k.startsWith('in:') ? (v as unknown[]).includes(f[k.slice(3)]) : f[k] === v);

      if (tabla === 'unidad') {
        api.then = (res: (v: unknown) => unknown) => res({ data: UNIDADES.filter(casa), error: null });
      } else if (tabla === 'viaje') {
        api.then = (res: (v: unknown) => unknown) => res(
          estado.errorViaje
            ? { data: null, error: { message: estado.errorViaje } }
            : { data: estado.viajes.filter(casa), error: null });
      } else if (tabla === 'operador') {
        api.then = (res: (v: unknown) => unknown) => res({ data: estado.operadores.filter(casa), error: null });
      } else if (tabla === 'evento_seguridad_flota') {
        api.upsert = (fila: Record<string, unknown>) => ({
          select: () => {
            estado.guardados.push(fila);
            return Promise.resolve({ data: [{ id: `fila-${estado.guardados.length}` }], error: null });
          },
        });
        api.then = (res: (v: unknown) => unknown) => res({ data: esUpdate ? null : [], error: null });
      } else {
        api.then = (res: (v: unknown) => unknown) => res({ data: [], error: null });
      }
      return api;
    },
  }),
}));

import { sincronizarEventosDeFlota } from './sincronizar_eventos';

const CRED = JSON.stringify({ token: 'tok-1' });
const AHORA = new Date('2026-09-01T18:00:00Z');

const evento = (id: string, dev: string) => ({
  id,
  startMs: new Date(AHORA.getTime() - 60_000).toISOString(),
  asset: { id: dev },
  behaviorLabels: [{ label: 'Braking' }],
  location: { latitude: 20.9, longitude: -89.5 },
});

const samsaraCon = (eventos: unknown[]): Http => async () => ({
  estado: 200,
  cuerpo: JSON.stringify({ data: eventos, pagination: { hasNextPage: false } }),
});

/** El operador de `unidad` lleva viaje vivo; `aviso` decide si ya se le avisó. */
function alVolante(unidadId: string, operadorId: string, aviso: boolean) {
  estado.viajes.push({ tenant_id: 't-1', unidad_id: unidadId, operador_id: operadorId, estatus: 'abierto' });
  estado.operadores.push({ id: operadorId, tenant_id: 't-1', aviso_privacidad_en: aviso ? '2026-08-01T00:00:00Z' : null });
}

const guardadasDe = () => estado.guardados.map((g) => g.unidad_id);

beforeEach(() => {
  estado.guardados = []; estado.viajes = []; estado.operadores = []; estado.errorViaje = null;
});

describe('LEG-1 · el evento de cámara no se guarda sin aviso previo', () => {
  it('no guarda el evento de la unidad cuyo operador no recibió el aviso', async () => {
    alVolante('u-1', 'op-sin', false);
    alVolante('u-2', 'op-con', true);

    const r = await sincronizarEventosDeFlota(
      't-1', 'samsara', CRED, samsaraCon([evento('e-1', 'dev-1'), evento('e-2', 'dev-2')]), AHORA,
    );

    expect(r.error).toBeUndefined();
    expect(r.sinAvisoPrevio).toBe(1);
    expect(guardadasDe()).toEqual(['u-2']);
    expect(guardadasDe()).not.toContain('u-1');
  });

  // AUDITORÍA 25 (ALTO, REINCIDENTE): esta prueba afirmaba lo CONTRARIO —que
  // el evento de una unidad sin viaje vivo entraba sin aviso— citando el
  // mismo argumento que sí vale para la posición ("sin viaje = sin
  // persona"), pero un evento de cámara puede traer la liga al video de
  // quién va al volante, exista o no un viaje abierto. Corregida: ahora se
  // trata como sin-aviso y NO se guarda (`sinViajeVivo: 'bloquear'`).
  it('la unidad sin viaje vivo NO tiene forma de confirmar el aviso de su conductor: su evento NO entra', async () => {
    const r = await sincronizarEventosDeFlota(
      't-1', 'samsara', CRED, samsaraCon([evento('e-1', 'dev-1')]), AHORA,
    );
    expect(r.sinAvisoPrevio).toBe(1);
    expect(guardadasDe()).toEqual([]);
  });

  it('si la base no contesta, NO se guarda ningún evento de la flota', async () => {
    estado.errorViaje = 'timeout';
    const r = await sincronizarEventosDeFlota(
      't-1', 'samsara', CRED, samsaraCon([evento('e-1', 'dev-1'), evento('e-2', 'dev-2')]), AHORA,
    );
    expect(r.error).toMatch(/no se guardó ningún evento/);
    expect(estado.guardados).toHaveLength(0);
  });
});
