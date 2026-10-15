import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TZ_MX } from '@/lib/formato';

// T-A5-01: leerConfigConductor trae la zona de la flota de `tenant.zona_horaria` (no de agente_conductor_config).
const estado: { config: Record<string, unknown> | null; tenant: Record<string, unknown> | null } = { config: null, tenant: null };
const avisos: Array<[string, unknown]> = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: tabla === 'tenant' ? estado.tenant : estado.config, error: null }) }),
      }),
    }),
  }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { warn: (m: string, d: unknown) => avisos.push([m, d]), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { leerConfigConductor } from './repo';

const FILA_CONFIG = {
  activo: true, solicitudes_min: [0, 15, 30, 45], escalar_tras_min: 90, segundo_nivel_min: 30, hora_inicio: 6, hora_fin: 22,
  dias_semana: [1, 2, 3, 4, 5, 6, 7], tope_diario_chofer: 12, anticipo_cita_min: 30, espera_sin_cita_min: 120, espera_carga_min: 120,
  trayecto_sin_eta_min: 480, espera_descarga_min: 120, regreso_min: 30, posponer_min: 30, ventana_correccion_min: 60, usar_llm: true,
  avisar_oficina_llegada: false, avisar_oficina_salida: false, confirmar_al_chofer: true, validar_ubicacion: true,
  tolerancia_ubicacion_m: 150, ventana_ubicacion_min: 30, pedir_ubicacion: true, estadia_alerta_carga_min: null,
  estadia_alerta_descarga_min: null, pedir_foto_evidencia: false,
};

describe('leerConfigConductor y la zona de la flota', () => {
  beforeEach(() => { estado.config = null; estado.tenant = null; avisos.length = 0; });

  it('lee la zona del tenant', async () => {
    estado.config = FILA_CONFIG; estado.tenant = { zona_horaria: 'America/Matamoros' };
    expect((await leerConfigConductor('t1')).zonaHoraria).toBe('America/Matamoros');
  });

  it('sin fila de config, igual trae la zona del tenant (defaults + zona)', async () => {
    estado.tenant = { zona_horaria: 'America/Cancun' };
    const c = await leerConfigConductor('t1');
    expect(c.zonaHoraria).toBe('America/Cancun');
    expect(c.horaInicio).toBe(6);
  });

  it('tenant con la zona de México: nada cambia', async () => {
    estado.config = FILA_CONFIG; estado.tenant = { zona_horaria: TZ_MX };
    expect((await leerConfigConductor('t1')).zonaHoraria).toBe(TZ_MX);
    expect(avisos).toHaveLength(0);
  });

  it('zona inválida: cae a México y avisa (no truena)', async () => {
    estado.config = FILA_CONFIG; estado.tenant = { zona_horaria: 'No/Existe' };
    const c = await leerConfigConductor('t1');
    expect(c.zonaHoraria).toBe(TZ_MX);
    expect(avisos.map((a) => a[0])).toContain('conductor.zona_invalida');
  });

  it('tenant sin renglón: México, sin aviso', async () => {
    estado.config = FILA_CONFIG;
    expect((await leerConfigConductor('t1')).zonaHoraria).toBe(TZ_MX);
    expect(avisos).toHaveLength(0);
  });
});
