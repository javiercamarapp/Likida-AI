import { describe, it, expect } from 'vitest';
import { CONFIG_PULL_MUESTRA_TMS, fechaDeParametro, seleccionarContratoDesglose, validarConfigPullMuestra } from './desglose_muestra_pull_config';

describe('configuración del pull muestra-tms', () => {
  it('por omisión el contrato es el supuesto de siempre (apagado)', () => {
    expect(seleccionarContratoDesglose({})).toEqual({ contrato: 'supuesto' });
    expect(seleccionarContratoDesglose({ LIKIDA_TMS_DESGLOSE_CONTRATO: 'supuesto' })).toEqual({ contrato: 'supuesto' });
  });
  it('muestra-tms con los valores por omisión o con ajustes parciales', () => {
    expect(seleccionarContratoDesglose({ LIKIDA_TMS_DESGLOSE_CONTRATO: 'muestra-tms' })).toEqual({ contrato: 'muestra-tms', config: CONFIG_PULL_MUESTRA_TMS });
    const s = seleccionarContratoDesglose({
      LIKIDA_TMS_DESGLOSE_CONTRATO: 'muestra-tms',
      LIKIDA_TMS_DESGLOSE_CONFIG: JSON.stringify({ ruta: '/v2/bitacoras', params: { desde: 'inicio', hasta: 'fin', pagina: null, tam: null }, envoltorio: 'envuelto', rutaLista: 'resultado.filas', formatoFechaParam: 'fecha_mx' }),
    });
    expect(s).toMatchObject({ contrato: 'muestra-tms', config: { ruta: '/v2/bitacoras', envoltorio: 'envuelto', rutaLista: 'resultado.filas', params: { desde: 'inicio', pagina: null } } });
  });
  it('falla cerrado: contrato desconocido, JSON roto, llave desconocida o valores fuera de rango', () => {
    const inv = (c: Record<string, string>) => seleccionarContratoDesglose({ LIKIDA_TMS_DESGLOSE_CONTRATO: 'muestra-tms', ...c }).contrato;
    expect(seleccionarContratoDesglose({ LIKIDA_TMS_DESGLOSE_CONTRATO: 'otro' }).contrato).toBe('invalido');
    expect(inv({ LIKIDA_TMS_DESGLOSE_CONFIG: '{no' })).toBe('invalido');
    expect(inv({ LIKIDA_TMS_DESGLOSE_CONFIG: '{"url":"https://x"}' })).toBe('invalido');
    expect(inv({ LIKIDA_TMS_DESGLOSE_CONFIG: '{"ruta":"https://otro.host/x"}' })).toBe('invalido');
    expect(inv({ LIKIDA_TMS_DESGLOSE_CONFIG: '{"ruta":"/a/../b"}' })).toBe('invalido');
    expect(inv({ LIKIDA_TMS_DESGLOSE_CONFIG: '{"tamano":0}' })).toBe('invalido');
    expect(inv({ LIKIDA_TMS_DESGLOSE_CONFIG: '{"params":{"pagina":"p","tam":null}}' })).toBe('invalido');
    expect(inv({ LIKIDA_TMS_DESGLOSE_CONFIG: '{"params":{"desde":"x","hasta":"x"}}' })).toBe('invalido');
    expect(inv({ LIKIDA_TMS_DESGLOSE_CONFIG: '{"envoltorio":"arreglo","rutaTotalPaginas":"total"}' })).toBe('invalido');
  });
  it('el motivo nombra la llave y nunca el valor', () => {
    const r = validarConfigPullMuestra({ ruta: 'http://secreto.example/x' });
    expect(r).toEqual({ ok: false, motivo: 'valor inválido en «ruta»' });
  });
  it('las fechas de los parámetros: ISO, o hora de México', () => {
    expect(fechaDeParametro('2026-10-15T18:00:00.000Z', 'iso')).toBe('2026-10-15T18:00:00.000Z');
    expect(fechaDeParametro('2026-10-15T18:00:00.000Z', 'fecha_hora_mx')).toBe('2026-10-15 12:00:00');
    expect(fechaDeParametro('2026-10-15T03:00:00.000Z', 'fecha_mx')).toBe('2026-10-14');
  });
});
