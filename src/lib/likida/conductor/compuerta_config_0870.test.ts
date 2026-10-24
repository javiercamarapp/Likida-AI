import { beforeEach, describe, expect, it, vi } from 'vitest';

// A37-P-08: `compuertaMovimientoActiva` (y sus metros/ventana/sin-GPS) se leen y se guardan por flota (0870). Apagada por omisión.
const estado: { config: Record<string, unknown> | null } = { config: null };
const upserts: Array<Record<string, unknown>> = [];
let respuestas: Array<{ error: { message: string } | null }> = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: tabla === 'tenant' ? { zona_horaria: 'America/Mexico_City' } : estado.config, error: null }) }) }),
      upsert: (fila: Record<string, unknown>) => { upserts.push(fila); return Promise.resolve(respuestas.shift() ?? { error: null }); },
    }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const { leerConfigConductor, guardarConfigConductor } = await import('./repo');
const { CONFIG_CONDUCTOR_DEFAULT } = await import('./config');

const FILA = {
  activo: true, solicitudes_min: [0, 15, 30, 45], escalar_tras_min: 90, segundo_nivel_min: 30, hora_inicio: 6, hora_fin: 22,
  dias_semana: [1, 2, 3, 4, 5, 6, 7], tope_diario_chofer: 12, anticipo_cita_min: 30, espera_sin_cita_min: 120, espera_carga_min: 120,
  trayecto_sin_eta_min: 480, espera_descarga_min: 120, regreso_min: 30, posponer_min: 30, ventana_correccion_min: 60, usar_llm: true,
  avisar_oficina_llegada: false, avisar_oficina_salida: false, confirmar_al_chofer: true, validar_ubicacion: true,
  tolerancia_ubicacion_m: 150, ventana_ubicacion_min: 30, pedir_ubicacion: true, estadia_alerta_carga_min: null,
  estadia_alerta_descarga_min: null, pedir_foto_evidencia: false,
};
const falta0870 = { error: { message: "Could not find the 'compuerta_movimiento_activa' column of 'agente_conductor_config' in the schema cache" } };

beforeEach(() => { estado.config = null; upserts.length = 0; respuestas = []; });

describe('A37-P-08: la compuerta de movimiento se lee de la base', () => {
  it('con las columnas de la 0870 lee la compuerta encendida y sus parámetros', async () => {
    estado.config = { ...FILA, compuerta_movimiento_activa: true, detenida_metros: 200, detenida_ventana_min: 10, sin_gps_permite: true };
    const c = await leerConfigConductor('t1');
    expect(c).toMatchObject({ compuertaMovimientoActiva: true, detenidaMetros: 200, detenidaVentanaMin: 10, sinGpsPermite: true });
  });

  it('base sin migrar o columna nula: apagada y en valores de partida (fail-closed)', async () => {
    estado.config = { ...FILA };
    expect(await leerConfigConductor('t1')).toMatchObject({ compuertaMovimientoActiva: false, detenidaMetros: CONFIG_CONDUCTOR_DEFAULT.detenidaMetros, sinGpsPermite: false });
    estado.config = { ...FILA, compuerta_movimiento_activa: null, detenida_metros: null };
    expect((await leerConfigConductor('t1')).compuertaMovimientoActiva).toBe(false);
  });
});

describe('A37-P-08: guardar la compuerta', () => {
  it('con la 0870 guarda las cuatro columnas', async () => {
    const r = await guardarConfigConductor('t1', { ...CONFIG_CONDUCTOR_DEFAULT, compuertaMovimientoActiva: true, detenidaMetros: 300 }, undefined);
    expect(r).toBe('ok');
    expect(upserts[0]).toMatchObject({ compuerta_movimiento_activa: true, detenida_metros: 300, detenida_ventana_min: 5, sin_gps_permite: false });
  });

  it('sin la 0870 y en valores de partida guarda lo demás sin esas columnas', async () => {
    respuestas = [falta0870];
    const r = await guardarConfigConductor('t1', { ...CONFIG_CONDUCTOR_DEFAULT, topeDiarioChofer: 8 }, undefined);
    expect(r).toBe('ok');
    expect(upserts[1]).toMatchObject({ tope_diario_chofer: 8 });
    expect(upserts[1]).not.toHaveProperty('compuerta_movimiento_activa');
  });

  it('sin la 0870, encender la compuerta NO se calla: dice que falta la migración', async () => {
    respuestas = [falta0870];
    await expect(guardarConfigConductor('t1', { ...CONFIG_CONDUCTOR_DEFAULT, compuertaMovimientoActiva: true }, undefined)).rejects.toThrow(/0870/);
  });
});
