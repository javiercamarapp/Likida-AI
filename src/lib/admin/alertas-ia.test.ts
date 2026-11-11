import { describe, expect, it, vi } from 'vitest';
import {
  alertasIaDeDetalle, correrAlertasIa, evaluarIaSinRegistro, evaluarTasaRespaldo, HORAS_SIN_REGISTRO_IA,
  MUESTRA_MINIMA_RESPALDO, type SenalesIa,
} from './alertas-ia';
import { alertasExtra } from './fuentes-alerta-extra';

// F16: series SINTÉTICAS (ningún dato real). Las reglas: 0 filas de llm_costo en N horas con viajes abiertos = 1 alerta
// agrupada; respaldo > 5 % con muestra mínima de 20 = 1 alerta; con menos de 20 llamadas, «sin medir» y no alerta.

const AHORA = Date.UTC(2026, 10, 10, 18, 0, 0); // minuto 0: toca la pasada de 15 min
const ENV = { ALERTAS_IA_GUARDIA: 'encendido' } as unknown as NodeJS.ProcessEnv;
const primario = (f: string) => ({ ocr: 'google/gemini-3.1-flash-lite', cuadre: 'anthropic/claude-sonnet-5', chat: 'google/gemini-3.5-flash-lite' } as Record<string, string>)[f] ?? null;
const filasDe = (n: number, respaldo: number) => [
  ...Array.from({ length: n - respaldo }, () => ({ fase: 'ocr', modelo: 'google/gemini-3.1-flash-lite' })),
  ...Array.from({ length: respaldo }, () => ({ fase: 'ocr', modelo: 'anthropic/claude-haiku-4.5' })),
];
const senales = (o: Partial<SenalesIa>): SenalesIa => ({ filasEnVentana: 40, viajesAbiertos: 5, filasRespaldo: filasDe(40, 0), ...o });

describe('evaluarIaSinRegistro', () => {
  it('0 filas con viajes abiertos es alerta', () => {
    expect(evaluarIaSinRegistro({ filasEnVentana: 0, viajesAbiertos: 3 })).toMatchObject({ estado: 'alerta', horas: HORAS_SIN_REGISTRO_IA });
  });
  it('0 filas sin viajes abiertos es lo esperado', () => {
    expect(evaluarIaSinRegistro({ filasEnVentana: 0, viajesAbiertos: 0 }).estado).toBe('ok');
  });
  it('con filas no alerta', () => {
    expect(evaluarIaSinRegistro({ filasEnVentana: 1, viajesAbiertos: 9 }).estado).toBe('ok');
  });
  it('lectura caída es sin_medir, nunca ok', () => {
    expect(evaluarIaSinRegistro({ filasEnVentana: null, viajesAbiertos: 3 }).estado).toBe('sin_medir');
    expect(evaluarIaSinRegistro({ filasEnVentana: 0, viajesAbiertos: null }).estado).toBe('sin_medir');
  });
});

describe('evaluarTasaRespaldo', () => {
  it('un respaldo mayor al umbral con muestra mínima alerta', () => {
    const r = evaluarTasaRespaldo(filasDe(40, 4), primario); // 10 %
    expect(r).toMatchObject({ estado: 'alerta', muestra: 40, enRespaldo: 4 });
    expect(r.tasa).toBeCloseTo(0.1);
  });
  it('justo en el umbral (5 %) no alerta', () => {
    expect(evaluarTasaRespaldo(filasDe(40, 2), primario).estado).toBe('ok');
  });
  it('una muestra menor a la mínima es «sin medir» y no alerta aunque todo sea respaldo', () => {
    const r = evaluarTasaRespaldo(filasDe(MUESTRA_MINIMA_RESPALDO - 1, MUESTRA_MINIMA_RESPALDO - 1), primario);
    expect(r).toMatchObject({ estado: 'sin_medir', tasa: null });
  });
  it('las fases que no se miden no cuentan para la muestra', () => {
    const r = evaluarTasaRespaldo([...filasDe(25, 0), ...Array.from({ length: 50 }, () => ({ fase: 'whatsapp', modelo: 'x' }))], primario);
    expect(r.muestra).toBe(25);
    expect(r.estado).toBe('ok');
  });
  it('lectura caída es sin_medir', () => {
    expect(evaluarTasaRespaldo(null, primario).estado).toBe('sin_medir');
  });
});

describe('correrAlertasIa', () => {
  const corre = (s: SenalesIa, previo = null as ReturnType<typeof alertasIaDeDetalle>, env = ENV) => {
    const avisar = vi.fn(async () => true);
    return correrAlertasIa(AHORA, previo, { env, leer: async () => s, avisar, primarioDeFase: primario }).then((r) => ({ r, avisar }));
  };

  it('apagada por omisión: no lee ni avisa', async () => {
    const leer = vi.fn();
    const r = await correrAlertasIa(AHORA, null, { env: {} as unknown as NodeJS.ProcessEnv, leer });
    expect(r.estado).toBe('apagado');
    expect(leer).not.toHaveBeenCalled();
  });
  it('fuera del cuarto de hora se omite', async () => {
    const r = await correrAlertasIa(AHORA + 7 * 60_000, null, { env: ENV, leer: async () => senales({}) });
    expect(r.estado).toBe('omitido');
  });
  it('0 filas de llm_costo con viajes abiertos produce UNA alerta agrupada', async () => {
    const { r, avisar } = await corre(senales({ filasEnVentana: 0, viajesAbiertos: 7 }));
    expect(avisar).toHaveBeenCalledTimes(1);
    expect(avisar).toHaveBeenCalledWith('guardia.ia_sin_registro', expect.objectContaining({ codigo: 'ia_sin_registro' }));
    expect(r.avisos).toEqual(['ia_sin_registro']);
  });
  it('un respaldo mayor al umbral con muestra mínima produce UNA alerta', async () => {
    const { avisar } = await corre(senales({ filasRespaldo: filasDe(40, 8) }));
    expect(avisar).toHaveBeenCalledTimes(1);
    expect(avisar).toHaveBeenCalledWith('guardia.ia_respaldo_alto', expect.anything());
  });
  it('una muestra menor a la mínima da «sin medir» y no alerta', async () => {
    const { r, avisar } = await corre(senales({ filasRespaldo: filasDe(10, 10) }));
    expect(avisar).not.toHaveBeenCalled();
    expect(r.detalle?.respaldo.estado).toBe('sin_medir');
  });
  it('no repite el aviso mientras la alerta siga activa (solo al entrar)', async () => {
    const primera = await corre(senales({ filasEnVentana: 0, viajesAbiertos: 7 }));
    const segunda = await corre(senales({ filasEnVentana: 0, viajesAbiertos: 7 }), primera.r.detalle ?? null);
    expect(segunda.avisar).not.toHaveBeenCalled();
    expect(segunda.r.detalle?.sinRegistro.estado).toBe('alerta');
  });
  it('un aviso que no pudo salir se reporta, no se da por entregado', async () => {
    const r = await correrAlertasIa(AHORA, null, { env: ENV, leer: async () => senales({ filasEnVentana: 0 }), avisar: async () => false, primarioDeFase: primario });
    expect(r.avisos).toEqual(['ia_sin_registro_no_salio']);
  });
  it('si la lectura lanza, devuelve error y no lanza', async () => {
    const r = await correrAlertasIa(AHORA, null, { env: ENV, leer: async () => { throw new Error('base caída'); } });
    expect(r.estado).toBe('error');
  });
});

describe('la campana lee el detalle que dejó la guardia', () => {
  const guardia = (alertasIa: unknown) => ({ guardia: { estado: 'ok' as const, haceMin: 1, ultimoEstado: 'ok' as const, detalle: { alertasIa } } });
  it('suma las dos alertas cuando el último latido las trae', async () => {
    const { r } = await (async () => {
      const avisar = vi.fn(async () => true);
      const r = await correrAlertasIa(AHORA, null, { env: ENV, leer: async () => senales({ filasEnVentana: 0, viajesAbiertos: 2, filasRespaldo: filasDe(40, 10) }), avisar, primarioDeFase: primario });
      return { r };
    })();
    const ids = alertasExtra({ latidos: guardia(r.detalle) }).map((a) => a.id);
    expect(ids).toEqual(['ia_sin_registro', 'ia_respaldo_alto']);
  });
  it('un latido sin alertasIa (apagado) no suma nada', () => {
    expect(alertasExtra({ latidos: guardia(undefined) })).toEqual([]);
  });
  it('un detalle con forma ajena se descarta', () => {
    expect(alertasIaDeDetalle({ alertasIa: { sinRegistro: { estado: 'raro' }, respaldo: { estado: 'ok' } } })).toBeNull();
  });
});
