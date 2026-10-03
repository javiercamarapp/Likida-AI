import { describe, it, expect } from 'vitest';
import { decidirEnvio, INTENCIONES_AUTOENVIABLES, CONFIANZA_MINIMA_AUTOENVIO, type EntradaPolitica } from './politica';

const bueno = (c: Partial<EntradaPolitica> = {}): EntradaPolitica => ({
  config: { habilitado: true, modoAprobacion: 'autoenviar_bajo_riesgo', autoenviarMinAprobaciones: 5 },
  clasificacion: { intencion: 'ubicacion', confianza: 0.9, senales: [] },
  borrador: { riesgo: 'bajo', faltantes: [], tareas: [], requiereHumano: false, origen: 'plantilla' },
  conversacion: { control: 'agente', molestiaNivel: 0, escalamientoNivel: 0 },
  aprobacionesSinEditar: 5,
  ...c,
});

describe('política de envío', () => {
  it('modo «siempre»: todo pasa por el gerente, aunque sea perfecto', () => {
    expect(decidirEnvio(bueno({ config: { habilitado: true, modoAprobacion: 'siempre', autoenviarMinAprobaciones: 1 } })))
      .toEqual({ accion: 'aprobar', motivo: 'modo_siempre_aprobar' });
  });

  it('autoenviar_bajo_riesgo con TODO en regla: sale solo', () => {
    expect(decidirEnvio(bueno())).toEqual({ accion: 'autoenviar', motivo: 'bajo_riesgo_validado' });
  });

  it('el agente apagado no hace nada (falla cerrado)', () => {
    expect(decidirEnvio(bueno({ config: { habilitado: false, modoAprobacion: 'autoenviar_bajo_riesgo', autoenviarMinAprobaciones: 1 } })).accion).toBe('ninguna');
  });

  it('un hilo en manos de un humano: el agente no redacta ni envía', () => {
    expect(decidirEnvio(bueno({ conversacion: { control: 'humano', molestiaNivel: 0, escalamientoNivel: 0 } })).accion).toBe('ninguna');
  });

  it('solo las intenciones de dato y el saludo son autoenviables', () => {
    for (const intencion of ['queja', 'pide_humano', 'otro', 'baja', 'factura_pod'] as const) {
      expect(decidirEnvio(bueno({ clasificacion: { intencion, confianza: 1, senales: [] } })).accion, intencion).toBe('aprobar');
    }
    for (const intencion of INTENCIONES_AUTOENVIABLES) {
      expect(decidirEnvio(bueno({ clasificacion: { intencion, confianza: 1, senales: [] } })).accion, intencion).toBe('autoenviar');
    }
  });

  it('cualquier señal (inyección, folio ajeno…) obliga a aprobar', () => {
    for (const s of ['inyeccion', 'folio_ajeno', 'modelo_caido']) {
      expect(decidirEnvio(bueno({ clasificacion: { intencion: 'ubicacion', confianza: 1, senales: [s] } })).motivo).toBe('clasificacion_con_senales');
    }
  });

  it('confianza menor al umbral: aprobar', () => {
    expect(decidirEnvio(bueno({ clasificacion: { intencion: 'ubicacion', confianza: CONFIANZA_MINIMA_AUTOENVIO - 0.01, senales: [] } })).motivo).toBe('confianza_baja');
    expect(decidirEnvio(bueno({ clasificacion: { intencion: 'ubicacion', confianza: CONFIANZA_MINIMA_AUTOENVIO, senales: [] } })).accion).toBe('autoenviar');
  });

  it('borrador con faltantes, tareas humanas, riesgo medio/alto o de modelo: aprobar', () => {
    const b = (x: Partial<EntradaPolitica['borrador']>) => bueno({ borrador: { ...bueno().borrador, ...x } });
    expect(decidirEnvio(b({ faltantes: ['eta'] })).motivo).toBe('faltan_datos_o_hay_tareas');
    expect(decidirEnvio(b({ tareas: ['entrega_de_archivo'] })).motivo).toBe('faltan_datos_o_hay_tareas');
    expect(decidirEnvio(b({ riesgo: 'medio' })).motivo).toBe('riesgo_no_bajo');
    expect(decidirEnvio(b({ riesgo: 'alto' })).motivo).toBe('riesgo_no_bajo');
    expect(decidirEnvio(b({ requiereHumano: true })).motivo).toBe('requiere_humano');
    expect(decidirEnvio(b({ origen: 'modelo' })).motivo).toBe('redaccion_de_modelo');
  });

  it('un cliente molesto o ya escalado NO recibe respuestas automáticas', () => {
    expect(decidirEnvio(bueno({ conversacion: { control: 'agente', molestiaNivel: 1, escalamientoNivel: 0 } })).motivo).toBe('conversacion_con_molestia');
    expect(decidirEnvio(bueno({ conversacion: { control: 'agente', molestiaNivel: 0, escalamientoNivel: 1 } })).motivo).toBe('conversacion_con_molestia');
  });

  it('el autoenvío se GANA: faltan aprobaciones sin editar de esa intención', () => {
    expect(decidirEnvio(bueno({ aprobacionesSinEditar: 4 })).motivo).toBe('intencion_aun_no_validada');
    expect(decidirEnvio(bueno({ aprobacionesSinEditar: 0 })).motivo).toBe('intencion_aun_no_validada');
    expect(decidirEnvio(bueno({ aprobacionesSinEditar: 5 })).accion).toBe('autoenviar');
  });

  it('el umbral configurable cambia lo que hace falta', () => {
    const cfg = { habilitado: true, modoAprobacion: 'autoenviar_bajo_riesgo' as const, autoenviarMinAprobaciones: 20 };
    expect(decidirEnvio(bueno({ config: cfg, aprobacionesSinEditar: 19 })).accion).toBe('aprobar');
    expect(decidirEnvio(bueno({ config: cfg, aprobacionesSinEditar: 20 })).accion).toBe('autoenviar');
  });
});
