import { describe, it, expect } from 'vitest';
import { CONFIG_SIN_ATENDER_POR_OMISION as D, normalizarConfigSinAtender, validarConfigSinAtender } from './config';
import { detectarSinAtenderChat } from './detectar';
import { chat, cli, eq, T0_MS } from './fixtures';
import type { ConfigSinAtender } from './tipos';

// Escenarios SINTÉTICOS de lo medido en 5 grupos reales (≈33,000 mensajes): la insistencia avisaba al 2.º mensaje aunque el equipo
// contestara al minuto (≈45 % de las alertas eran ruido), un «gracias» pegado a la petición la borraba, y un «enterado» la cerraba.
const cfg = (p: Partial<ConfigSinAtender> = {}): ConfigSinAtender => normalizarConfigSinAtender({ ...D, ...p }).config;
const ahora = (min: number) => T0_MS + min * 60_000;

describe('insistenciaEsperaMin · repregunta que de verdad quedó sin atender', () => {
  const dosSeguidos = [eq(0, 'buen día'), cli(1, 'nos ayudan con el sello'), cli(2, 'me confirman por favor')];

  it('por omisión (0) avisa al segundo mensaje, como siempre', () => {
    const r = detectarSinAtenderChat(chat(dosSeguidos), cfg(), ahora(3));
    expect(r.alertas).toHaveLength(1);
    expect(r.alertas[0].motivos).toContain('insistencia');
  });

  it('con 10 min NO avisa mientras el equipo aún puede estar contestando', () => {
    expect(detectarSinAtenderChat(chat(dosSeguidos), cfg({ insistenciaEsperaMin: 10 }), ahora(3)).alertas).toEqual([]);
  });

  it('con 10 min SÍ avisa cuando la repregunta lleva 12 minutos sin respuesta', () => {
    const r = detectarSinAtenderChat(chat(dosSeguidos), cfg({ insistenciaEsperaMin: 10 }), ahora(13));
    expect(r.alertas).toHaveLength(1);
    expect(r.alertas[0].motivos).toContain('insistencia');
  });

  it('el umbral de espera de siempre sigue funcionando aparte', () => {
    const r = detectarSinAtenderChat(chat([eq(0, 'hola'), cli(1, 'necesito el estatus')]), cfg({ insistenciaEsperaMin: 10 }), ahora(60));
    expect(r.alertas[0].motivos).toEqual(['espera_sobre_umbral']);
  });
});

describe('acusesVaciosNoCierran · «enterado» no es atención', () => {
  const hilo = [cli(0, 'nos apoyan con los datos de la unidad por favor'), eq(5, 'enterado')];

  it('por omisión un acuse cierra el pendiente (comportamiento anterior)', () => {
    expect(detectarSinAtenderChat(chat(hilo), cfg(), ahora(120)).alertas).toEqual([]);
  });

  it('encendido, el acuse no cierra y el hilo alerta pasado el umbral', () => {
    const r = detectarSinAtenderChat(chat(hilo), cfg({ acusesVaciosNoCierran: true }), ahora(120));
    expect(r.alertas).toHaveLength(1);
    expect(r.alertas[0].mensajesSinAtender).toBe(1);
  });

  it('encendido, una respuesta con el dato SÍ cierra', () => {
    const r = detectarSinAtenderChat(chat([cli(0, 'nos apoyan con los datos de la unidad por favor'), eq(5, 'enterado'), eq(40, 'la unidad es la 1234, sale a las 6')]), cfg({ acusesVaciosNoCierran: true }), ahora(120));
    expect(r.alertas).toEqual([]);
  });

  it('encendido, un acuse sin nada pendiente no inventa un hilo', () => {
    expect(detectarSinAtenderChat(chat([eq(0, 'hola'), eq(1, 'enterado')]), cfg({ acusesVaciosNoCierran: true }), ahora(120)).alertas).toEqual([]);
  });
});

describe('cortesiaCierraTrasMin · el «gracias» pegado a la petición no la cierra', () => {
  const hilo = [eq(0, 'buen día'), cli(1, 'nos ayudan con la ccp de cruce de las cajas'), cli(2, 'gracias')];

  it('por omisión el «gracias» cierra el hilo (la petición desaparecía)', () => {
    expect(detectarSinAtenderChat(chat(hilo), cfg(), ahora(300)).alertas).toEqual([]);
  });

  it('con 5 min, un «gracias» a los 1-2 min de la petición no la cierra', () => {
    const r = detectarSinAtenderChat(chat(hilo), cfg({ cortesiaCierraTrasMin: 5 }), ahora(300));
    expect(r.alertas).toHaveLength(1);
    expect(r.alertas[0].mensajesSinAtender).toBe(1);
  });

  it('con 5 min, un «gracias» 20 min después (el cliente ya lo resolvió) sí cierra', () => {
    const r = detectarSinAtenderChat(chat([eq(0, 'buen día'), cli(1, 'nos ayudan con la ccp de cruce de las cajas'), cli(21, 'gracias')]), cfg({ cortesiaCierraTrasMin: 5 }), ahora(300));
    expect(r.alertas).toEqual([]);
  });
});

describe('soloPeticiones · un aviso del cliente no es un pendiente', () => {
  const aviso = [eq(0, 'buen día'), cli(1, 'la caja ya quedó en el patio de la planta')];

  it('por omisión un aviso sin respuesta alerta pasado el umbral', () => {
    expect(detectarSinAtenderChat(chat(aviso), cfg(), ahora(60)).alertas).toHaveLength(1);
  });

  it('encendido, ese aviso no alerta', () => {
    expect(detectarSinAtenderChat(chat(aviso), cfg({ soloPeticiones: true }), ahora(60)).alertas).toEqual([]);
  });

  it('encendido, una petición sí alerta', () => {
    expect(detectarSinAtenderChat(chat([eq(0, 'buen día'), cli(1, 'me confirman la hora de salida por favor')]), cfg({ soloPeticiones: true }), ahora(60)).alertas).toHaveLength(1);
  });
});

describe('configuración de las opciones nuevas', () => {
  it('los valores por omisión no cambian el comportamiento', () => {
    expect(D.insistenciaEsperaMin).toBe(0);
    expect(D.acusesVaciosNoCierran).toBe(false);
    expect(D.cortesiaCierraTrasMin).toBe(0);
    expect(D.soloPeticiones).toBe(false);
  });
  it('se acotan y se validan con mensaje llano', () => {
    const { config, avisos } = normalizarConfigSinAtender({ insistenciaEsperaMin: 9999, cortesiaCierraTrasMin: -3 });
    expect(config.insistenciaEsperaMin).toBe(120);
    expect(config.cortesiaCierraTrasMin).toBe(0);
    expect(avisos.length).toBe(2);
    const mal = validarConfigSinAtender({ insistenciaEsperaMin: 500 });
    expect(mal.ok).toBe(false);
    expect(validarConfigSinAtender({ insistenciaEsperaMin: 10, acusesVaciosNoCierran: true }).ok).toBe(true);
  });
});
