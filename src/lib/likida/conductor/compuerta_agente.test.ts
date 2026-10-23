import { beforeEach, describe, expect, it, vi } from 'vitest';

// A35-A5-01 (0859): la compuerta de datos del Agente 5. Fail-closed: apagada, o ilegible (migración sin aplicar) = NO se envía.
const avisos: Array<[string, unknown]> = [];
vi.mock('@/lib/logger', () => ({
  logger: { warn: (m: string, d: unknown) => avisos.push([m, d]), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { CONFIG_CONDUCTOR_DEFAULT } from './config';
import { aplicarCompuertaAgente, conCompuertaAlChofer, esEnvioAlChofer, type LecturaCompuerta } from './compuerta_agente';

const OK = { ok: true, via: 'texto', id: 'w1', motivo: 'ventana_abierta', ventana: 'abierta' } as const;
const MSG = { texto: 'hola' } as never;

describe('esEnvioAlChofer', () => {
  it('reconoce los contextos que le escriben al chofer y deja pasar escalaciones y avisos al supervisor', () => {
    for (const c of ['conductor.solicitud', 'conductor.recordatorio', 'conductor.pregunta_estadia', 'conductor.senal_vida_n1', 'conductor.senal_vida_n2',
      'conductor.deteccion_parada', 'conductor.reporte_llegada', 'conductor.asignacion_instrucciones', 'conductor.gastos_etc_pregunta']) {
      expect(esEnvioAlChofer(c), c).toBe(true);
    }
    for (const c of ['conductor.escalacion_n1', 'conductor.alerta_estadia', 'conductor.senal_vida_jefe', 'conductor.llegada_sin_confirmar', 'conductor.asignacion_rechazo']) {
      expect(esEnvioAlChofer(c), c).toBe(false);
    }
  });
});

describe('aplicarCompuertaAgente: la config que ve el motor', () => {
  it('por defecto (sin la marca) la flota queda APAGADA aunque activo sea true', () => {
    expect(CONFIG_CONDUCTOR_DEFAULT.activo).toBe(true);
    expect(aplicarCompuertaAgente({ ...CONFIG_CONDUCTOR_DEFAULT }).activo).toBe(false);
    expect(aplicarCompuertaAgente({ ...CONFIG_CONDUCTOR_DEFAULT, agenteChoferHabilitado: false }).activo).toBe(false);
    expect(aplicarCompuertaAgente({ ...CONFIG_CONDUCTOR_DEFAULT, agenteChoferHabilitado: 'true' as never }).activo).toBe(false);
  });
  it('solo `true` explícito la deja como está, y no muta la entrada', () => {
    const c = { ...CONFIG_CONDUCTOR_DEFAULT, agenteChoferHabilitado: true };
    expect(aplicarCompuertaAgente(c)).toBe(c);
    const sin = { ...CONFIG_CONDUCTOR_DEFAULT };
    aplicarCompuertaAgente(sin);
    expect(sin.activo).toBe(true);
  });
});

describe('conCompuertaAlChofer: el envío al chofer pasa por la base', () => {
  beforeEach(() => { avisos.length = 0; });
  const armar = (lectura: LecturaCompuerta | Error) => {
    const enviar = vi.fn(async () => OK);
    const leer = vi.fn(async () => { if (lectura instanceof Error) throw lectura; return lectura; });
    return { enviar, leer, gate: conCompuertaAlChofer(enviar as never, leer) };
  };

  it('compuerta APAGADA: no envía, no llega a Meta, rechazo no reintentable y registro legible', async () => {
    const { enviar, gate } = armar({ habilitado: false, razon: 'apagado' });
    const r = await gate('5215500000000', MSG, 'conductor.solicitud', 't1', new Date());
    expect(enviar).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false, reintentable: false });
    if (!r.ok) expect(r.mensaje).toMatch(/Agente 5 no está habilitado/);
    expect(avisos[0]).toEqual(['conductor.envio_bloqueado_agente_apagado', { tenant: 't1', contexto: 'conductor.solicitud', razon: 'apagado' }]);
  });

  it('compuerta ILEGIBLE (migración 0859 sin aplicar, la función no existe): no envía y lo dice', async () => {
    const { enviar, gate } = armar({ habilitado: false, razon: 'compuerta_ilegible' });
    const r = await gate('5215500000000', MSG, 'conductor.recordatorio', 't1', new Date());
    expect(enviar).not.toHaveBeenCalled();
    if (!r.ok) expect(r.mensaje).toMatch(/migración 0859 sin aplicar/);
    expect(avisos[0][1]).toMatchObject({ razon: 'compuerta_ilegible' });
  });

  it('si la lectura LANZA, también es silencio', async () => {
    const { enviar, gate } = armar(new Error('base caída'));
    const r = await gate('5215500000000', MSG, 'conductor.senal_vida_n1', 't1', new Date());
    expect(enviar).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
  });

  it('habilitada: envía', async () => {
    const { enviar, gate } = armar({ habilitado: true, razon: 'habilitado' });
    expect(await gate('5215500000000', MSG, 'conductor.solicitud', 't1', new Date())).toBe(OK);
    expect(enviar).toHaveBeenCalledOnce();
  });

  it('una escalación al supervisor no consulta la compuerta del chofer', async () => {
    const { enviar, leer, gate } = armar({ habilitado: false, razon: 'apagado' });
    await gate('5215500000001', MSG, 'conductor.escalacion_n1', 't1', new Date());
    expect(leer).not.toHaveBeenCalled();
    expect(enviar).toHaveBeenCalledOnce();
  });

  it('recuerda el veredicto por flota (una lectura por flota, no por mensaje) y no mezcla flotas', async () => {
    const leer = vi.fn(async (t: string): Promise<LecturaCompuerta> => (t === 'A' ? { habilitado: true, razon: 'habilitado' } : { habilitado: false, razon: 'apagado' }));
    const enviar = vi.fn(async () => OK);
    const gate = conCompuertaAlChofer(enviar as never, leer, { reloj: () => 1000 });
    expect((await gate('1', MSG, 'conductor.solicitud', 'A', new Date())).ok).toBe(true);
    expect((await gate('2', MSG, 'conductor.recordatorio', 'A', new Date())).ok).toBe(true);
    expect((await gate('3', MSG, 'conductor.solicitud', 'B', new Date())).ok).toBe(false);
    expect(leer).toHaveBeenCalledTimes(2);
    expect(enviar).toHaveBeenCalledTimes(2);
  });
});
