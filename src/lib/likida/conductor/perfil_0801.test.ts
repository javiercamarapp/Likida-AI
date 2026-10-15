import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// T-A5-07 (migración 0801): perfil de seguimiento, umbrales de «sin señal de vida» y perillas de la flota.
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

import { CONFIG_CONDUCTOR_DEFAULT, validarConfigConductor } from './config';
import { cuerpoDesdeFormulario, valoresDeForma } from './config_forma';
import { validarCambioConfig } from './lectura';
import { guardarConfigConductor, leerConfigConductor } from './repo';

// Una fila de una base SIN la 0801 (ni las columnas nuevas): como la que hay hoy en producción.
const FILA_SIN_0801 = {
  activo: true, solicitudes_min: [0, 15, 30, 45], escalar_tras_min: 90, segundo_nivel_min: 30, hora_inicio: 6, hora_fin: 22,
  dias_semana: [1, 2, 3, 4, 5, 6, 7], tope_diario_chofer: 12, anticipo_cita_min: 30, espera_sin_cita_min: 120, espera_carga_min: 120,
  trayecto_sin_eta_min: 480, espera_descarga_min: 120, regreso_min: 30, posponer_min: 30, ventana_correccion_min: 60, usar_llm: true,
  avisar_oficina_llegada: false, avisar_oficina_salida: false, confirmar_al_chofer: true, validar_ubicacion: true,
  tolerancia_ubicacion_m: 150, ventana_ubicacion_min: 30, pedir_ubicacion: true, estadia_alerta_carga_min: null,
  estadia_alerta_descarga_min: null, pedir_foto_evidencia: false,
};

beforeEach(() => { estado.config = null; upserts.length = 0; respuestas = []; });

describe('0801: los valores de partida son el comportamiento de hoy', () => {
  it('perfil completo, umbrales 45/60/20/20/120 y perillas apagadas', () => {
    expect(CONFIG_CONDUCTOR_DEFAULT).toMatchObject({
      perfilSeguimiento: 'completo', gpsObsoletoMin: 45, detenidoMin: 60, segundoAvisoMin: 20, escalarSenalMin: 20, silencioRespuestaMin: 120,
      mostrarEstadosFrontera: false, aplicarSalidaDelTms: false, lineaBaseLlamadasPorViaje: null, lineaBaseRegistradaEn: null,
    });
  });

  it('la ventana de horario NO cambia a 9:30–13:00: sigue siendo la del cliente (6 a 22)', () => {
    expect(CONFIG_CONDUCTOR_DEFAULT).toMatchObject({ horaInicio: 6, horaFin: 22 });
  });
});

describe('0801: validación', () => {
  it('acepta el perfil «esenciales» y lo conserva', () => {
    const v = validarConfigConductor({ perfilSeguimiento: 'esenciales' });
    expect('ok' in v && v.ok.perfilSeguimiento).toBe('esenciales');
  });

  it("perfilSeguimiento = 'otro' es un error en palabras llanas", () => {
    const v = validarConfigConductor({ perfilSeguimiento: 'otro' as never });
    expect(v).toEqual({ error: expect.stringMatching(/esenciales.*completo/) });
  });

  it.each(['gpsObsoletoMin', 'detenidoMin', 'segundoAvisoMin', 'escalarSenalMin', 'silencioRespuestaMin'] as const)('%s: rango 5–720, fuera de rango es error', (campo) => {
    expect('ok' in validarConfigConductor({ [campo]: 5 })).toBe(true);
    expect('ok' in validarConfigConductor({ [campo]: 720 })).toBe(true);
    expect('error' in validarConfigConductor({ [campo]: 4 })).toBe(true);
    expect('error' in validarConfigConductor({ [campo]: 721 })).toBe(true);
    expect('error' in validarConfigConductor({ [campo]: 12.5 })).toBe(true);
    expect('error' in validarConfigConductor({ [campo]: 'mucho' as never })).toBe(true);
  });

  it('la línea base admite nula, un número de 0 a 1000 y una fecha AAAA-MM-DD real', () => {
    const v = validarConfigConductor({ lineaBaseLlamadasPorViaje: 3.5, lineaBaseRegistradaEn: '2026-03-01' });
    expect('ok' in v && v.ok).toMatchObject({ lineaBaseLlamadasPorViaje: 3.5, lineaBaseRegistradaEn: '2026-03-01' });
    expect('error' in validarConfigConductor({ lineaBaseLlamadasPorViaje: -1 })).toBe(true);
    expect('error' in validarConfigConductor({ lineaBaseLlamadasPorViaje: 1001 })).toBe(true);
    expect('error' in validarConfigConductor({ lineaBaseRegistradaEn: '2026-02-31' })).toBe(true);
    expect('error' in validarConfigConductor({ lineaBaseRegistradaEn: 'ayer' })).toBe(true);
  });

  it('el PUT acepta las llaves nuevas y las fusiona con la config vigente', () => {
    const v = validarCambioConfig({ perfilSeguimiento: 'esenciales', gpsObsoletoMin: 30, mostrarEstadosFrontera: true }, { ...CONFIG_CONDUCTOR_DEFAULT });
    expect('ok' in v && v.ok.config).toMatchObject({ perfilSeguimiento: 'esenciales', gpsObsoletoMin: 30, mostrarEstadosFrontera: true, detenidoMin: 60 });
    const malo = validarCambioConfig({ perfilSeguimiento: 'otro' }, { ...CONFIG_CONDUCTOR_DEFAULT });
    expect('error' in malo).toBe(true);
  });
});

describe('0801: leer la config (compatibilidad hacia atrás)', () => {
  it('con la fila SIN las columnas nuevas, devuelve los valores de partida', async () => {
    estado.config = FILA_SIN_0801;
    const c = await leerConfigConductor('t1');
    expect(c).toMatchObject({
      perfilSeguimiento: 'completo', gpsObsoletoMin: 45, detenidoMin: 60, segundoAvisoMin: 20, escalarSenalMin: 20, silencioRespuestaMin: 120,
      mostrarEstadosFrontera: false, aplicarSalidaDelTms: false, lineaBaseLlamadasPorViaje: null, lineaBaseRegistradaEn: null,
    });
  });

  it('con las columnas presentes, las lee (numeric y date llegan como texto)', async () => {
    estado.config = {
      ...FILA_SIN_0801, perfil_seguimiento: 'esenciales', gps_obsoleto_min: 30, detenido_min: 90, segundo_aviso_min: 10, escalar_senal_min: 15,
      silencio_respuesta_min: 240, mostrar_estados_frontera: true, aplicar_salida_del_tms: true, linea_base_llamadas_por_viaje: '4.5', linea_base_registrada_en: '2026-03-01',
    };
    const c = await leerConfigConductor('t1');
    expect(c).toMatchObject({
      perfilSeguimiento: 'esenciales', gpsObsoletoMin: 30, detenidoMin: 90, segundoAvisoMin: 10, escalarSenalMin: 15, silencioRespuestaMin: 240,
      mostrarEstadosFrontera: true, aplicarSalidaDelTms: true, lineaBaseLlamadasPorViaje: 4.5, lineaBaseRegistradaEn: '2026-03-01',
    });
  });
});

describe('0801: guardar la config (round-trip y base sin migrar)', () => {
  const personalizada = { ...CONFIG_CONDUCTOR_DEFAULT, perfilSeguimiento: 'esenciales' as const, gpsObsoletoMin: 30, detenidoMin: 90, lineaBaseLlamadasPorViaje: 4.5, lineaBaseRegistradaEn: '2026-03-01' };

  it('guarda las columnas nuevas y lo guardado se lee igual', async () => {
    expect(await guardarConfigConductor('t1', personalizada, undefined)).toBe('ok');
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ perfil_seguimiento: 'esenciales', gps_obsoleto_min: 30, detenido_min: 90, linea_base_llamadas_por_viaje: 4.5, linea_base_registrada_en: '2026-03-01' });
    estado.config = { ...FILA_SIN_0801, ...upserts[0] };
    const leida = await leerConfigConductor('t1');
    expect(leida).toMatchObject({ perfilSeguimiento: 'esenciales', gpsObsoletoMin: 30, detenidoMin: 90, lineaBaseLlamadasPorViaje: 4.5, lineaBaseRegistradaEn: '2026-03-01' });
  });

  const falta0801 = { error: { message: "Could not find the 'perfil_seguimiento' column of 'agente_conductor_config' in the schema cache" } };

  it('sin la 0801 y con todo en su valor de partida, guarda lo demás sin las columnas nuevas', async () => {
    respuestas = [falta0801];
    expect(await guardarConfigConductor('t1', { ...CONFIG_CONDUCTOR_DEFAULT, topeDiarioChofer: 8 }, undefined)).toBe('ok');
    expect(upserts).toHaveLength(2);
    expect(upserts[1]).toMatchObject({ tope_diario_chofer: 8 });
    for (const col of ['perfil_seguimiento', 'gps_obsoleto_min', 'detenido_min', 'segundo_aviso_min', 'escalar_senal_min', 'silencio_respuesta_min', 'mostrar_estados_frontera', 'aplicar_salida_del_tms', 'linea_base_llamadas_por_viaje', 'linea_base_registrada_en']) {
      expect(upserts[1]).not.toHaveProperty(col);
    }
  });

  it('sin la 0801, pedir otro perfil NO se calla: dice que falta la migración', async () => {
    respuestas = [falta0801];
    await expect(guardarConfigConductor('t1', { ...CONFIG_CONDUCTOR_DEFAULT, perfilSeguimiento: 'esenciales' }, undefined)).rejects.toThrow(/0801/);
    expect(upserts).toHaveLength(1);
  });
});

describe('0801: el formulario de hoy no pisa lo nuevo', () => {
  function formularioDeHoy(): FormData {
    const fd = new FormData();
    const v = valoresDeForma({ ...CONFIG_CONDUCTOR_DEFAULT });
    for (const [k, val] of Object.entries(v)) {
      if (['perfilSeguimiento', 'gpsObsoletoMin', 'detenidoMin', 'segundoAvisoMin', 'escalarSenalMin', 'silencioRespuestaMin'].includes(k)) continue;
      fd.set(`f_${k}`, val);
    }
    for (const d of [1, 2, 3, 4, 5, 6, 7]) fd.set(`f_dia_${d}`, 'si');
    fd.set('c_filas', '0');
    return fd;
  }

  it('sin la sección del perfil en el formulario, el cuerpo no trae las llaves nuevas y se conservan las vigentes', () => {
    const cuerpo = cuerpoDesdeFormulario(formularioDeHoy());
    expect('ok' in cuerpo).toBe(true);
    if (!('ok' in cuerpo)) return;
    expect(cuerpo.ok).not.toHaveProperty('perfilSeguimiento');
    expect(cuerpo.ok).not.toHaveProperty('gpsObsoletoMin');
    const vigente = { ...CONFIG_CONDUCTOR_DEFAULT, perfilSeguimiento: 'esenciales' as const, gpsObsoletoMin: 30 };
    const v = validarCambioConfig(cuerpo.ok, vigente);
    expect('ok' in v && v.ok.config).toMatchObject({ perfilSeguimiento: 'esenciales', gpsObsoletoMin: 30 });
  });

  it('con la sección del perfil, el cuerpo la trae y se valida', () => {
    const fd = formularioDeHoy();
    fd.set('f_perfilSeguimiento', 'esenciales');
    fd.set('f_gpsObsoletoMin', '30'); fd.set('f_detenidoMin', '60'); fd.set('f_segundoAvisoMin', '20'); fd.set('f_escalarSenalMin', '20'); fd.set('f_silencioRespuestaMin', '120');
    const cuerpo = cuerpoDesdeFormulario(fd);
    expect('ok' in cuerpo).toBe(true);
    if (!('ok' in cuerpo)) return;
    const v = validarCambioConfig(cuerpo.ok, { ...CONFIG_CONDUCTOR_DEFAULT });
    expect('ok' in v && v.ok.config).toMatchObject({ perfilSeguimiento: 'esenciales', gpsObsoletoMin: 30, mostrarEstadosFrontera: false });
  });
});

describe('0801: la migración', () => {
  const sql = readFileSync(join(__dirname, '../../../../supabase/migrations/0801_conductor_perfil_seguimiento_y_umbrales.sql'), 'utf8');
  const ejecutable = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').toLowerCase();

  it('es aditiva e idempotente: add column if not exists y constraints con drop if exists', () => {
    const altas = ejecutable.match(/add column/g) ?? [];
    expect(altas.length).toBe(10);
    expect(ejecutable.match(/add column if not exists/g)?.length).toBe(10);
    expect(ejecutable.match(/add constraint/g)?.length).toBe(ejecutable.match(/drop constraint if exists/g)?.length);
  });

  it('no redefine función alguna ni borra datos', () => {
    expect(ejecutable).not.toMatch(/create (or replace )?function/);
    expect(ejecutable).not.toMatch(/\bdrop (table|column|function)\b|\bdelete from\b|\btruncate\b/);
  });

  it('trae las diez columnas con los valores de partida de la ficha', () => {
    for (const frag of ["perfil_seguimiento text not null default 'completo'", 'gps_obsoleto_min smallint not null default 45', 'detenido_min smallint not null default 60',
      'segundo_aviso_min smallint not null default 20', 'escalar_senal_min smallint not null default 20', 'silencio_respuesta_min smallint not null default 120',
      'mostrar_estados_frontera boolean not null default false', 'aplicar_salida_del_tms boolean not null default false',
      'linea_base_llamadas_por_viaje numeric null', 'linea_base_registrada_en date null']) {
      expect(ejecutable).toContain(frag);
    }
    expect(ejecutable).toContain("check (perfil_seguimiento in ('esenciales', 'completo'))");
  });
});
