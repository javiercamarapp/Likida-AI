import { beforeEach, describe, expect, it, vi } from 'vitest';

// A35-A5-01 (0859): la lectura de la marca en la base. Columna ausente o función ausente = apagado.
const estado: { config: Record<string, unknown> | null; rpc: { data: unknown; error: { message: string } | null } | Error } = { config: null, rpc: { data: null, error: null } };
const rpcs: Array<[string, unknown]> = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: tabla === 'tenant' ? { zona_horaria: 'America/Mexico_City' } : estado.config, error: null }) }) }),
    }),
    rpc: async (f: string, a: unknown) => { rpcs.push([f, a]); if (estado.rpc instanceof Error) throw estado.rpc; return estado.rpc; },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { leerAgenteChoferHabilitado, leerConfigConductor } from './repo';

const FILA = {
  activo: true, solicitudes_min: [0, 15, 30, 45], escalar_tras_min: 90, segundo_nivel_min: 30, hora_inicio: 6, hora_fin: 22,
  dias_semana: [1, 2, 3, 4, 5, 6, 7], tope_diario_chofer: 12, anticipo_cita_min: 30, espera_sin_cita_min: 120, espera_carga_min: 120,
  trayecto_sin_eta_min: 480, espera_descarga_min: 120, regreso_min: 30, posponer_min: 30, ventana_correccion_min: 60, usar_llm: true,
  avisar_oficina_llegada: false, avisar_oficina_salida: false, confirmar_al_chofer: true, validar_ubicacion: true,
  tolerancia_ubicacion_m: 150, ventana_ubicacion_min: 30, pedir_ubicacion: true, estadia_alerta_carga_min: null,
  estadia_alerta_descarga_min: null, pedir_foto_evidencia: false,
};

describe('leerConfigConductor y la marca agente_chofer_habilitado', () => {
  beforeEach(() => { estado.config = null; });
  it('base SIN migrar (la fila no trae la columna): apagado', async () => {
    estado.config = FILA;
    expect((await leerConfigConductor('t1')).agenteChoferHabilitado).toBe(false);
  });
  it('sin fila de config (defaults): apagado', async () => {
    expect((await leerConfigConductor('t1')).agenteChoferHabilitado).toBe(false);
  });
  it('columna en false: apagado; solo true la enciende', async () => {
    estado.config = { ...FILA, agente_chofer_habilitado: false };
    expect((await leerConfigConductor('t1')).agenteChoferHabilitado).toBe(false);
    estado.config = { ...FILA, agente_chofer_habilitado: true };
    expect((await leerConfigConductor('t1')).agenteChoferHabilitado).toBe(true);
  });
});

describe('leerAgenteChoferHabilitado (RPC de la 0859)', () => {
  beforeEach(() => { rpcs.length = 0; estado.rpc = { data: null, error: null }; });
  it('llama a la función con la flota y devuelve true solo si la base dice true', async () => {
    estado.rpc = { data: true, error: null };
    expect(await leerAgenteChoferHabilitado('t1')).toEqual({ habilitado: true, razon: 'habilitado' });
    expect(rpcs).toEqual([['conductor_agente_chofer_habilitado', { p_tenant: 't1' }]]);
  });
  it('false, null o cualquier otro valor: apagado', async () => {
    for (const data of [false, null, 'true', 1]) {
      estado.rpc = { data, error: null };
      expect(await leerAgenteChoferHabilitado('t1'), String(data)).toEqual({ habilitado: false, razon: 'apagado' });
    }
  });
  it('función ausente (migración sin aplicar) o base caída: ilegible = no habilitado, sin lanzar', async () => {
    estado.rpc = { data: null, error: { message: 'function public.conductor_agente_chofer_habilitado does not exist' } };
    expect(await leerAgenteChoferHabilitado('t1')).toEqual({ habilitado: false, razon: 'compuerta_ilegible' });
    estado.rpc = new Error('ECONNRESET');
    expect(await leerAgenteChoferHabilitado('t1')).toEqual({ habilitado: false, razon: 'compuerta_ilegible' });
  });
});
