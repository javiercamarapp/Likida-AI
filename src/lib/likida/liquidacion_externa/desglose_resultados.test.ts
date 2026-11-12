import { describe, it, expect } from 'vitest';
import { ESTADOS_ENTREGADA, estadoDeConflicto, estadoDeRecepcion, leerSimulacion } from './desglose_resultados';
import { bitacoraVisible } from './desglose_contrato';
import type { ResultadoDesglose } from './desglose_recibir';

const creada = (p: Partial<Extract<ResultadoDesglose, { estado: 'creada' }>> = {}): ResultadoDesglose => ({
  estado: 'creada', liquidacionId: 'l', claveExterna: 'BIT-1', entregas: 1, retenida: false, motivos: [], excepciones: [], ...p,
});

describe('estadoDeRecepcion', () => {
  it('cada resultado del servicio cae en UN estado explícito', () => {
    expect(estadoDeRecepcion(creada())).toEqual({ estado: 'recibida', motivos: [] });
    expect(estadoDeRecepcion(creada({ retenida: true, motivos: ['sin_poliza', 'tipo_sin_regla'], excepciones: ['sin_poliza', 'tipo_sin_regla'] })))
      .toEqual({ estado: 'retenida', motivos: [{ codigo: 'sin_poliza' }, { codigo: 'tipo_sin_regla' }] });
    expect(estadoDeRecepcion({ estado: 'idempotente', liquidacionId: 'l', claveExterna: 'BIT-1' })).toEqual({ estado: 'idempotente', motivos: [] });
    expect(estadoDeRecepcion({ estado: 'correccion_pendiente', liquidacionId: 'l', claveExterna: 'BIT-1' }).estado).toBe('correccion_pendiente');
    expect(estadoDeRecepcion({ estado: 'operador_no_encontrado', claveExterna: 'BIT-1' })).toEqual({ estado: 'no_guardada', motivos: [{ codigo: 'operador_no_encontrado' }] });
    expect(estadoDeRecepcion({ estado: 'sin_poliza', claveExterna: 'BIT-1' })).toEqual({ estado: 'no_guardada', motivos: [{ codigo: 'sin_poliza' }] });
    expect(estadoDeConflicto()).toEqual({ estado: 'no_guardada', motivos: [{ codigo: 'bitacora_duplicada' }] });
  });

  it('una recibida con avisos (sin correo del operador) sigue siendo recibida y los lista', () => {
    expect(estadoDeRecepcion(creada({ excepciones: ['operador_sin_correo'] }))).toEqual({ estado: 'recibida', motivos: [{ codigo: 'operador_sin_correo' }] });
  });

  it('el histórico omitido se guarda (recibida) y lo dice', () => {
    expect(estadoDeRecepcion(creada({ omitida: 'anterior_al_corte' }))).toEqual({ estado: 'recibida', motivos: [{ codigo: 'anterior_al_corte' }] });
  });

  it('la simulación da el mismo estado que daría el envío real', () => {
    const sim = (retenida: boolean, motivos: Array<'sin_poliza'> = []): ResultadoDesglose => ({ estado: 'simulada', claveExterna: 'BIT-1', correos: 0, omitidas: 0, retenida, omitida: null, motivos });
    expect(estadoDeRecepcion(sim(false)).estado).toBe('recibida');
    expect(estadoDeRecepcion(sim(true, ['sin_poliza']))).toEqual({ estado: 'retenida', motivos: [{ codigo: 'sin_poliza' }] });
  });

  it('entregada = recibida | retenida | idempotente | correccion_pendiente', () => {
    expect([...ESTADOS_ENTREGADA].sort()).toEqual(['correccion_pendiente', 'idempotente', 'recibida', 'retenida']);
  });
});

describe('leerSimulacion', () => {
  it('«si» simula; ausente, vacío o «no» no', () => {
    for (const v of ['si', 'SI', ' Sí ', 'true', '1']) expect(leerSimulacion(v)).toEqual({ ok: true, simular: true });
    for (const v of [null, '', ' ', 'no', 'false', '0']) expect(leerSimulacion(v)).toEqual({ ok: true, simular: false });
  });
  it('cualquier otro valor se rechaza (no se escribiría lo que el integrador creía simular)', () => {
    for (const v of ['quizas', 'yes', 'simular']) expect(leerSimulacion(v).ok).toBe(false);
  });
});

describe('bitacoraVisible', () => {
  it('el folio manda; sin folio (null, vacío) se muestra la bitácora', () => {
    expect(bitacoraVisible({ bitacora: 'X-9', folioOrigen: '1098' })).toBe('1098');
    for (const f of [null, undefined, '', '  ']) expect(bitacoraVisible({ bitacora: 'X-9', folioOrigen: f })).toBe('X-9');
  });
});
