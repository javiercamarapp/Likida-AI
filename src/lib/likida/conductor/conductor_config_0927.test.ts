import { beforeEach, describe, expect, it, vi } from 'vitest';

// A39-A5-01/04/06 (0927): la calibración de la compuerta, la cohorte y las perillas de la fase 2 tienen columna, se leen, se guardan
// y se aceptan en el PUT. Apagadas por omisión; sin la migración se dice (no se pierde en silencio).
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
const { validarCambioConfig } = await import('./lectura');
const { CONFIG_CONDUCTOR_DEFAULT } = await import('./config');

const FILA = {
  activo: true, solicitudes_min: [0, 15, 30, 45], escalar_tras_min: 90, segundo_nivel_min: 30, hora_inicio: 6, hora_fin: 22,
  dias_semana: [1, 2, 3, 4, 5, 6, 7], tope_diario_chofer: 12, anticipo_cita_min: 30, espera_sin_cita_min: 120, espera_carga_min: 120,
  trayecto_sin_eta_min: 480, espera_descarga_min: 120, regreso_min: 30, posponer_min: 30, ventana_correccion_min: 60, usar_llm: true,
  avisar_oficina_llegada: false, avisar_oficina_salida: false, confirmar_al_chofer: true, validar_ubicacion: true,
  tolerancia_ubicacion_m: 150, ventana_ubicacion_min: 30, pedir_ubicacion: true, estadia_alerta_carga_min: null,
  estadia_alerta_descarga_min: null, pedir_foto_evidencia: false,
};
const falta0927 = { error: { message: "Could not find the 'poleo_min' column of 'agente_conductor_config' in the schema cache" } };

beforeEach(() => { estado.config = null; upserts.length = 0; respuestas = []; });

describe('A39-A5-04/06: lectura', () => {
  it('con la 0927 lee la cadencia, el umbral, la cohorte y las perillas encendidas', async () => {
    estado.config = {
      ...FILA, poleo_min: 15, poleo_por_clave_min: { lenta: 15 }, detenido_aviso_min: 20, cohorte_piloto: 'voluntarios_abiertos',
      deteccion_parada_activa: true, reporte_llegada_activo: true, patio_entrega_activo: true, exigir_sello_inicio: true, patio_que_manda: 'destino',
      estadia_descarga_min_por_cliente: { '11111111-1111-4111-8111-111111111111': 240 }, detencion_escala_sin_respuesta_min: 30,
    };
    expect(await leerConfigConductor('t1')).toMatchObject({
      poleoMin: 15, poleoPorClaveMin: { lenta: 15 }, detenidoAvisoMin: 20, cohortePiloto: 'voluntarios_abiertos',
      deteccionParadaActiva: true, reporteLlegadaActivo: true, patioEntregaActivo: true, exigirSelloInicio: true, patioQueManda: 'destino',
      estadiaDescargaMinPorCliente: { '11111111-1111-4111-8111-111111111111': 240 }, detencionEscalaSinRespuestaMin: 30,
    });
  });
  it('base sin migrar: todo apagado y en valores de partida (fail-closed)', async () => {
    estado.config = { ...FILA };
    const c = await leerConfigConductor('t1');
    expect(c).toMatchObject({
      deteccionParadaActiva: false, reporteLlegadaActivo: false, patioEntregaActivo: false, exigirSelloInicio: false, gastosEtcActiva: false,
      asignacionBotonesActiva: false, resultadoDescargaActivo: false, pedirDocumentosCierreActivo: false, estadiaDescargaInteractiva: false,
      constanciaReportesActiva: false, patioQueManda: 'entregar_en', detenidoAvisoMin: CONFIG_CONDUCTOR_DEFAULT.detenidoAvisoMin,
    });
    expect(c.poleoMin).toBeUndefined();
  });
});

describe('A39-A5-04/06: escritura', () => {
  it('con la 0927 guarda las columnas (la fila COMPLETA, sin perder las perillas al re-guardar otra cosa)', async () => {
    const r = await guardarConfigConductor('t1', {
      ...CONFIG_CONDUCTOR_DEFAULT, poleoMin: 15, detenidoAvisoMin: 20, cohortePiloto: 'sin_tableta_ni_macros', deteccionParadaActiva: true, gastosEtcActiva: true,
    }, undefined);
    expect(r).toBe('ok');
    expect(upserts[0]).toMatchObject({
      poleo_min: 15, detenido_aviso_min: 20, cohorte_piloto: 'sin_tableta_ni_macros', deteccion_parada_activa: true, gastos_etc_activa: true,
      reporte_llegada_activo: false, patio_que_manda: 'entregar_en',
    });
  });
  it('sin la 0927 y todo en valores de partida guarda lo demás', async () => {
    respuestas = [falta0927];
    expect(await guardarConfigConductor('t1', { ...CONFIG_CONDUCTOR_DEFAULT, topeDiarioChofer: 8 }, undefined)).toBe('ok');
    expect(upserts[1]).toMatchObject({ tope_diario_chofer: 8 });
    expect(upserts[1]).not.toHaveProperty('poleo_min');
    expect(upserts[1]).not.toHaveProperty('deteccion_parada_activa');
  });
  it('sin la 0927, encender una perilla o fijar la cadencia NO se calla: dice que falta la migración', async () => {
    for (const c of [{ poleoMin: 15 }, { deteccionParadaActiva: true }, { detenidoAvisoMin: 30 }, { cohortePiloto: 'voluntarios_abiertos' as const }]) {
      respuestas = [falta0927];
      await expect(guardarConfigConductor('t1', { ...CONFIG_CONDUCTOR_DEFAULT, ...c }, undefined), JSON.stringify(c)).rejects.toThrow(/0927/);
    }
  });
});

describe('A39-A5-01/04/06: el PUT acepta las llaves (antes: 400 «llaves desconocidas»)', () => {
  const ok = (c: Record<string, unknown>) => validarCambioConfig(c, { ...CONFIG_CONDUCTOR_DEFAULT });
  it('compuerta de movimiento, sinGpsPermite, cohorte y perillas', () => {
    const v = ok({ compuertaMovimientoActiva: true, sinGpsPermite: false, cohortePiloto: 'voluntarios_abiertos', deteccionParadaActiva: true, reporteLlegadaActivo: true, poleoMin: 15 });
    if (!('ok' in v)) throw new Error(v.error);
    expect(v.ok.config).toMatchObject({ compuertaMovimientoActiva: true, cohortePiloto: 'voluntarios_abiertos', deteccionParadaActiva: true, reporteLlegadaActivo: true, poleoMin: 15 });
  });
  it('una perilla booleana con texto se rechaza; y `agenteChoferHabilitado` NO es una llave del PUT (la habilitación es del dueño)', () => {
    expect('error' in ok({ deteccionParadaActiva: 'true' })).toBe(true);
    const r = ok({ agenteChoferHabilitado: true });
    expect('error' in r && /desconocidas/.test(r.error)).toBe(true);
  });
});
