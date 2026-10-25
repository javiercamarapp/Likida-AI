import { describe, expect, it } from 'vitest';
import { armarAlertaEstadia, correrAlertasEstadia, responderEstadiaDescarga } from './alertas_estadia';
import { CONFIG_CONDUCTOR_DEFAULT, type ConfigConductor } from './config';
import { calcularEstancias } from './estadias_anden';
import { crearPuertos, hitoVacio, viajeBase } from './memoria.fixture';
import type { HitoFila, TipoHito } from './tipos';

// 2026-10-02 18:00Z = 12:00 en México (dentro de la ventana 06–22).
const AHORA = new Date('2026-10-02T18:00:00.000Z');
const cfg = (p: Partial<ConfigConductor> = {}): ConfigConductor => ({ ...CONFIG_CONDUCTOR_DEFAULT, solicitudesMin: [...CONFIG_CONDUCTOR_DEFAULT.solicitudesMin], diasSemana: [...CONFIG_CONDUCTOR_DEFAULT.diasSemana], estadiaAlertaCargaMin: 120, estadiaAlertaDescargaMin: 90, ...p });

function hito(viajeId: string, tipo: TipoHito, iso: string | null, tenantId = 't1'): HitoFila {
  return hitoVacio({ id: `${viajeId}-${tipo}`, tipo, viajeId, tenantId, ...(iso ? { estado: 'recibido', fuente: 'texto', mensajeEn: iso, recibidoEn: iso } : {}) });
}
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();
const sembrar = (viajeId: string, parciales: Partial<Record<TipoHito, string | null>>, tenantId = 't1') =>
  (['llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga', 'regreso'] as TipoHito[]).map((t) => hito(viajeId, t, parciales[t] ?? null, tenantId));

describe('correrAlertasEstadia', () => {
  it('avisa UNA vez al patio cuando la parada en curso rebasa el umbral, con la hora exacta de la llegada', async () => {
    const viajes = [viajeBase({ id: 'v1' })];
    const { puertos, enviados, eventos } = crearPuertos({ viajes, hitos: sembrar('v1', { llegada_carga: hace(150) }), configs: { t1: cfg() } });
    const r = await correrAlertasEstadia(puertos, { ahora: AHORA });
    expect(r).toMatchObject({ alertas: 1, revisadas: 1, fallos: [] });
    expect(enviados).toHaveLength(1);
    expect(enviados[0].texto).toMatch(/Juan Pérez lleva 2 horas y 30 minutos en la carga/);
    expect(enviados[0].texto).toMatch(/hora de su mensaje/);
    expect(enviados[0].plantilla).toBe('aviso_operacion_v1');
    expect(eventos.map((e) => e.evento)).toEqual(['alerta_estadia']);
  });

  it('idempotente: una segunda corrida (o dos solapadas) NO repite el aviso', async () => {
    const { puertos, enviados } = crearPuertos({ viajes: [viajeBase({ id: 'v1' })], hitos: sembrar('v1', { llegada_carga: hace(150) }), configs: { t1: cfg() } });
    const [a, b] = await Promise.all([correrAlertasEstadia(puertos, { ahora: AHORA }), correrAlertasEstadia(puertos, { ahora: AHORA })]);
    expect(a.alertas + b.alertas).toBe(1);
    expect(a.yaReclamadas + b.yaReclamadas).toBe(1);
    expect(enviados).toHaveLength(1);
    await correrAlertasEstadia(puertos, { ahora: new Date(AHORA.getTime() + 600_000) });
    expect(enviados).toHaveLength(1);
  });

  it('no avisa si no ha rebasado el umbral, ni con el umbral apagado, ni con la parada cerrada', async () => {
    const casos: Array<[string, ReturnType<typeof sembrar>, ConfigConductor]> = [
      ['bajo el umbral', sembrar('v1', { llegada_carga: hace(119) }), cfg()],
      ['umbral apagado', sembrar('v1', { llegada_carga: hace(500) }), cfg({ estadiaAlertaCargaMin: null, estadiaAlertaDescargaMin: null })],
      ['parada cerrada', sembrar('v1', { llegada_carga: hace(500), salida_carga: hace(10) }), cfg()],
    ];
    for (const [nombre, hs, config] of casos) {
      const { puertos, enviados } = crearPuertos({ viajes: [viajeBase({ id: 'v1' })], hitos: hs, configs: { t1: config } });
      const r = await correrAlertasEstadia(puertos, { ahora: AHORA });
      expect(r.alertas, nombre).toBe(0);
      expect(enviados, nombre).toHaveLength(0);
    }
  });

  it('el umbral de carga y el de descarga son independientes', async () => {
    const { puertos, enviados } = crearPuertos({
      viajes: [viajeBase({ id: 'v1' })], configs: { t1: cfg({ estadiaAlertaCargaMin: null, estadiaAlertaDescargaMin: 60 }) },
      hitos: sembrar('v1', { llegada_carga: hace(900), salida_carga: hace(800), llegada_descarga: hace(75) }),
    });
    const r = await correrAlertasEstadia(puertos, { ahora: AHORA });
    expect(r.alertas).toBe(1);
    expect(enviados[0].texto).toMatch(/en la descarga/);
  });

  it('nunca fuera de la ventana horaria: espera sin reclamar, y avisa cuando abre', async () => {
    // 04:00Z+... 2026-10-02 08:00Z = 02:00 en México (fuera de 06–22).
    const noche = new Date('2026-10-02T08:00:00.000Z');
    const hs = sembrar('v1', { llegada_carga: new Date(noche.getTime() - 200 * 60_000).toISOString() });
    const { puertos, enviados, reclamos } = crearPuertos({ viajes: [viajeBase({ id: 'v1' })], hitos: hs, configs: { t1: cfg() } });
    const r = await correrAlertasEstadia(puertos, { ahora: noche });
    expect(r).toMatchObject({ alertas: 0, fueraDeVentana: 1 });
    expect(enviados).toHaveLength(0);
    expect(reclamos.size).toBe(0);
    const manana = new Date('2026-10-02T13:00:00.000Z'); // 07:00 MX
    const r2 = await correrAlertasEstadia(puertos, { ahora: manana });
    expect(r2.alertas).toBe(1);
  });

  it('A37-S34-09: sin a quién avisar: se dice (fallo + sinDestinatario) y NO se quema el claim', async () => {
    const { puertos, enviados, reclamos } = crearPuertos({
      viajes: [viajeBase({ id: 'v1' })], hitos: sembrar('v1', { llegada_carga: hace(200) }), configs: { t1: cfg() }, destinatarios: () => [],
    });
    const r = await correrAlertasEstadia(puertos, { ahora: AHORA });
    expect(r).toMatchObject({ alertas: 0, sinDestinatario: 1 });
    expect(r.fallos[0]).toMatch(/no hay a quién avisar/);
    expect(enviados).toHaveLength(0);
    expect(reclamos.size).toBe(0);
  });

  it('un rechazo reintentable YA dejó el texto en el outbox: el claim se cierra y la siguiente corrida NO lo manda otra vez', async () => {
    const { puertos, enviados, reclamos } = crearPuertos({
      viajes: [viajeBase({ id: 'v1' })], hitos: sembrar('v1', { llegada_carga: hace(200) }), configs: { t1: cfg() },
      envio: () => ({ ok: false, reintentable: true, mensaje: '429' }),
    });
    const r1 = await correrAlertasEstadia(puertos, { ahora: AHORA });
    expect(r1).toMatchObject({ alertas: 0, rechazosReintentables: 1 });
    expect([...reclamos.values()][0]).toMatchObject({ ok: true, motivo: 'en_cola_outbox' });
    const r2 = await correrAlertasEstadia(puertos, { ahora: AHORA });
    expect(r2).toMatchObject({ alertas: 0, yaReclamadas: 1 });
    expect(enviados).toHaveLength(0);
  });

  it('un rechazo definitivo (plantilla sin aprobar) deja el claim cerrado con el motivo y NO reintenta cada 5 minutos', async () => {
    const { puertos, reclamos } = crearPuertos({
      viajes: [viajeBase({ id: 'v1' })], hitos: sembrar('v1', { llegada_carga: hace(200) }), configs: { t1: cfg() },
      envio: () => ({ ok: false, reintentable: false, mensaje: 'plantilla sin aprobar' }),
    });
    const r1 = await correrAlertasEstadia(puertos, { ahora: AHORA });
    expect(r1.fallos[0]).toMatch(/plantilla sin aprobar/);
    expect([...reclamos.values()][0]).toMatchObject({ ok: false });
    const r2 = await correrAlertasEstadia(puertos, { ahora: AHORA });
    expect(r2.yaReclamadas).toBe(1);
  });

  it('fuera de la ventana de 24 h la plantilla genérica de operación sale como respaldo', async () => {
    const { puertos, enviados } = crearPuertos({
      viajes: [viajeBase({ id: 'v1' })], hitos: sembrar('v1', { llegada_carga: hace(200) }), configs: { t1: cfg() },
      envio: (e) => ({ ok: true, via: e.plantilla === 'aviso_operacion_v1' ? 'plantilla' : 'texto' }),
    });
    await correrAlertasEstadia(puertos, { ahora: AHORA });
    expect(enviados[0].plantilla).toBe('aviso_operacion_v1');
  });

  it('aislamiento entre flotas: cada una con su umbral y sus destinatarios', async () => {
    const viajes = [viajeBase({ id: 'v1', tenantId: 't1' }), viajeBase({ id: 'v2', tenantId: 't2', operadorId: 'o2', folio: 'B-7' })];
    const hitos = [...sembrar('v1', { llegada_carga: hace(200) }, 't1'), ...sembrar('v2', { llegada_carga: hace(200) }, 't2')];
    const { puertos, enviados } = crearPuertos({
      viajes, hitos, configs: { t1: cfg({ estadiaAlertaCargaMin: null, estadiaAlertaDescargaMin: null }), t2: cfg() },
      destinatarios: (t) => [{ nombre: 'Patio', telefono: t === 't2' ? '5210000000002' : '5210000000001' }],
    });
    const r = await correrAlertasEstadia(puertos, { ahora: AHORA });
    expect(r.alertas).toBe(1);
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({ tenantId: 't2', telefono: '5210000000002' });
  });

  it('una flota con la config ilegible se salta sin tumbar a las demás', async () => {
    const viajes = [viajeBase({ id: 'v1', tenantId: 't1' }), viajeBase({ id: 'v2', tenantId: 't2', operadorId: 'o2' })];
    const hitos = [...sembrar('v1', { llegada_carga: hace(200) }, 't1'), ...sembrar('v2', { llegada_carga: hace(200) }, 't2')];
    const { puertos } = crearPuertos({ viajes, hitos, configs: { t1: 'ilegible', t2: cfg() } });
    const r = await correrAlertasEstadia(puertos, { ahora: AHORA });
    expect(r.alertas).toBe(1);
  });

  it('un agente apagado por la flota no alerta', async () => {
    const { puertos, enviados } = crearPuertos({ viajes: [viajeBase({ id: 'v1' })], hitos: sembrar('v1', { llegada_carga: hace(200) }), configs: { t1: cfg({ activo: false }) } });
    await correrAlertasEstadia(puertos, { ahora: AHORA });
    expect(enviados).toHaveLength(0);
  });

  it('cinco rechazos reintentables seguidos paran la corrida', async () => {
    const viajes = Array.from({ length: 8 }, (_, i) => viajeBase({ id: `v${i}`, operadorId: `o${i}` }));
    const hitos = viajes.flatMap((v) => sembrar(v.id, { llegada_carga: hace(200) }));
    const { puertos } = crearPuertos({ viajes, hitos, configs: { t1: cfg() }, envio: () => ({ ok: false, reintentable: true, mensaje: '429' }) });
    const r = await correrAlertasEstadia(puertos, { ahora: AHORA });
    expect(r.rechazosReintentables).toBe(5);
  });
});

describe('armarAlertaEstadia', () => {
  it('lleva el nombre, la duración y la hora de la llegada; la plantilla cabe en el parámetro de 60 caracteres', () => {
    const v = viajeBase({ id: 'v1', operadorNombre: 'María del Carmen Rodríguez Hernández', folio: 'F-1042' });
    const [e] = calcularEstancias(v, sembrar('v1', { llegada_carga: hace(305) }), AHORA, { validaciones: new Map(), evidencias: new Map() });
    const m = armarAlertaEstadia(v, e, 120, AHORA);
    expect(m.texto).toContain('5 horas y 5 minutos');
    expect(m.texto).toContain('Planta Zapopan');
    expect(m.texto).toContain('Tu alerta está en 2 horas');
    const resumen = (m.plantilla as { parametros: string[] }).parametros[1];
    expect(resumen.length).toBeLessThanOrEqual(60);
  });
});

// ═══ T-A5-45 · R17: la estadía de DESCARGA interactiva ═══════════════════════
const CLIENTE_A = '11111111-1111-4111-8111-111111111111';
const CLIENTE_B = '22222222-2222-4222-8222-222222222222';
const cfgI = (p: Partial<ConfigConductor> = {}) => cfg({ estadiaAlertaCargaMin: null, estadiaAlertaDescargaMin: 120, estadiaDescargaInteractiva: true, estadiaDescargaSinRespuestaMin: 30, ...p });
const unaDescarga = (minutos: number, extra: Partial<HitoFila> = {}) => {
  const hs = sembrar('v1', { llegada_carga: hace(minutos + 600), salida_carga: hace(minutos + 500), llegada_descarga: hace(minutos) });
  return hs.map((h) => (h.tipo === 'llegada_descarga' ? { ...h, ...extra } : h));
};
const montar = (minutos: number, config: ConfigConductor, v = viajeBase({ id: 'v1' }), extra: Partial<HitoFila> = {}) =>
  crearPuertos({ viajes: [v], hitos: unaDescarga(minutos, extra), configs: { t1: config } });

describe('descarga interactiva: la pregunta al chofer (R17, 2 h)', () => {
  it('119 min: nada; 121 min: le pregunta al CHOFER «¿ya inició?» con dos botones y NO avisa al supervisor todavía', async () => {
    const a = montar(119, cfgI());
    expect(await correrAlertasEstadia(a.puertos, { ahora: AHORA })).toMatchObject({ alertas: 0, revisadas: 0 });
    expect(a.enviados).toHaveLength(0);

    const b = montar(121, cfgI());
    const r = await correrAlertasEstadia(b.puertos, { ahora: AHORA });
    expect(r).toMatchObject({ preguntas: 1, alertas: 0, fallos: [] });
    expect(b.enviados).toHaveLength(1);
    expect(b.enviados[0].telefono).toBe('5219990000001'); // el del chofer, no el del patio
    expect(b.enviados[0].texto).toMatch(/Llevas 2 horas y 1 minuto en la descarga .*¿Ya inició la descarga\?/);
    expect(b.enviados[0].botones).toEqual(['estadia_descarga:v1:si', 'estadia_descarga:v1:no']);
    expect(b.enviados[0].contexto).toBe('conductor.pregunta_estadia');
  });

  it('la pregunta se manda UNA sola vez aunque el cron corra otra vez', async () => {
    const m = montar(125, cfgI());
    await correrAlertasEstadia(m.puertos, { ahora: AHORA });
    await correrAlertasEstadia(m.puertos, { ahora: new Date(AHORA.getTime() + 300_000) });
    expect(m.enviados).toHaveLength(1);
  });

  it('sin respuesta: pasada la espera configurable avisa al supervisor con los minutos y con quién se reportó', async () => {
    const antes = montar(149, cfgI(), viajeBase({ id: 'v1' }), { contactoNombre: 'Contacto Prueba' });
    await correrAlertasEstadia(antes.puertos, { ahora: AHORA });
    expect(antes.enviados.map((e) => e.contexto)).toEqual(['conductor.pregunta_estadia']);

    const despues = montar(151, cfgI(), viajeBase({ id: 'v1' }), { contactoNombre: 'Contacto Prueba' });
    await correrAlertasEstadia(despues.puertos, { ahora: AHORA }); // 151 ≥ 120 + 30: la pregunta ya no toca, avisa
    const aviso = despues.enviados.find((e) => e.contexto === 'conductor.alerta_estadia')!;
    expect(aviso.telefono).toBe('5219990000099');
    expect(aviso.texto).toMatch(/2 horas y 31 minutos/);
    expect(aviso.texto).toMatch(/no contestó si ya inició la descarga/);
    expect(aviso.texto).toMatch(/Se reportó con Contacto Prueba/);
  });

  it('la espera sin respuesta es configurable', async () => {
    const m = montar(131, cfgI({ estadiaDescargaSinRespuestaMin: 10 }));
    await correrAlertasEstadia(m.puertos, { ahora: AHORA });
    expect(m.enviados.map((e) => e.contexto)).toEqual(['conductor.alerta_estadia']);
  });

  it('perfil sin la perilla = comportamiento de siempre: aviso directo al patio, sin preguntar', async () => {
    const m = montar(121, cfgI({ estadiaDescargaInteractiva: false }));
    const r = await correrAlertasEstadia(m.puertos, { ahora: AHORA });
    expect(r).toMatchObject({ alertas: 1 });
    expect(r.preguntas).toBeUndefined();
    expect(m.enviados.map((e) => e.contexto)).toEqual(['conductor.alerta_estadia']);
    expect(m.enviados[0].texto).toMatch(/Estadía larga:/);
  });

  it('la CARGA no es interactiva aunque la perilla esté encendida', async () => {
    const hs = sembrar('v1', { llegada_carga: hace(200) });
    const m = crearPuertos({ viajes: [viajeBase({ id: 'v1' })], hitos: hs, configs: { t1: cfgI({ estadiaAlertaCargaMin: 120 }) } });
    const r = await correrAlertasEstadia(m.puertos, { ahora: AHORA });
    expect(r).toMatchObject({ alertas: 1 });
    expect(m.enviados[0].contexto).toBe('conductor.alerta_estadia');
  });

  it('el umbral es POR CLIENTE: 239 vs 241 min con 240 para el convenio, y el resto sigue en 120', async () => {
    const config = cfgI({ estadiaDescargaMinPorCliente: { [CLIENTE_A]: 240 } });
    const a239 = montar(239, config, viajeBase({ id: 'v1', clienteId: CLIENTE_A }));
    await correrAlertasEstadia(a239.puertos, { ahora: AHORA });
    expect(a239.enviados).toHaveLength(0);

    const a241 = montar(241, config, viajeBase({ id: 'v1', clienteId: CLIENTE_A }));
    const r = await correrAlertasEstadia(a241.puertos, { ahora: AHORA });
    expect(r.preguntas).toBe(1);

    const otro = montar(121, config, viajeBase({ id: 'v1', clienteId: CLIENTE_B }));
    expect((await correrAlertasEstadia(otro.puertos, { ahora: AHORA })).preguntas).toBe(1);
    const sinCliente = montar(121, config, viajeBase({ id: 'v1' }));
    expect((await correrAlertasEstadia(sinCliente.puertos, { ahora: AHORA })).preguntas).toBe(1);
  });

  it('una flota sin umbral de flota pero con el de un cliente SÍ corre solo para ese cliente', async () => {
    const config = cfgI({ estadiaAlertaDescargaMin: null, estadiaDescargaMinPorCliente: { [CLIENTE_A]: 240 } });
    const a = montar(250, config, viajeBase({ id: 'v1', clienteId: CLIENTE_A }));
    expect((await correrAlertasEstadia(a.puertos, { ahora: AHORA })).preguntas).toBe(1);
    const b = montar(300, config, viajeBase({ id: 'v1', clienteId: CLIENTE_B }));
    expect((await correrAlertasEstadia(b.puertos, { ahora: AHORA })).revisadas).toBe(0);
  });

  it('nunca fuera de la ventana horaria y la compuerta «unidad detenida» (sin GPS = silencio) la frena sin reclamar', async () => {
    const noche = new Date('2026-10-02T08:00:00.000Z');
    const hs = sembrar('v1', { llegada_carga: new Date(noche.getTime() - 900 * 60_000).toISOString(), llegada_descarga: new Date(noche.getTime() - 200 * 60_000).toISOString() });
    const n = crearPuertos({ viajes: [viajeBase({ id: 'v1' })], hitos: hs, configs: { t1: cfgI() } });
    expect(await correrAlertasEstadia(n.puertos, { ahora: noche })).toMatchObject({ fueraDeVentana: 1 });
    expect(n.enviados).toHaveLength(0);
    expect(n.reclamos.size).toBe(0);

    const c = montar(121, cfgI({ compuertaMovimientoActiva: true }));
    const r = await correrAlertasEstadia(c.puertos, { ahora: AHORA });
    expect(r.compuertaMovimiento).toBe(1);
    expect(c.enviados).toHaveLength(0);
    expect(c.reclamos.size).toBe(0);
  });

  it('un chofer sin teléfono: se dice y el claim queda cerrado, y el supervisor se entera por «sin respuesta»', async () => {
    const m = montar(121, cfgI(), viajeBase({ id: 'v1', operadorTelefono: null }));
    const r = await correrAlertasEstadia(m.puertos, { ahora: AHORA });
    expect(r.fallos[0]).toMatch(/no tiene teléfono/);
    expect(m.enviados).toHaveLength(0);
    const tarde = montar(160, cfgI(), viajeBase({ id: 'v1', operadorTelefono: null }));
    expect((await correrAlertasEstadia(tarde.puertos, { ahora: AHORA })).alertas).toBe(1);
  });
});

describe('descarga interactiva: la respuesta del chofer (responderEstadiaDescarga)', () => {
  const entrada = (m: ReturnType<typeof montar>, respuesta: 'si' | 'no', config = cfgI(), v = viajeBase({ id: 'v1' })) => ({
    viaje: v, hitos: [...m.hitos.values()], config, respuesta, ahora: AHORA,
  });

  it('«no» → aviso inmediato al supervisor con el contacto y los minutos, y el cron NO lo repite', async () => {
    const m = montar(130, cfgI(), viajeBase({ id: 'v1' }), { contactoNombre: 'Contacto Prueba' });
    const out = await responderEstadiaDescarga(m.puertos, entrada(m, 'no'));
    expect(out[0].texto).toMatch(/Ya le avisé a tu supervisor/);
    expect(m.enviados).toHaveLength(1);
    expect(m.enviados[0]).toMatchObject({ telefono: '5219990000099', contexto: 'conductor.alerta_estadia' });
    expect(m.enviados[0].texto).toMatch(/2 horas y 10 minutos/);
    expect(m.enviados[0].texto).toMatch(/AÚN NO inicia/);
    expect(m.enviados[0].texto).toMatch(/Se reportó con Contacto Prueba/);
    await correrAlertasEstadia(m.puertos, { ahora: new Date(AHORA.getTime() + 3_600_000) });
    expect(m.enviados.filter((e) => e.contexto === 'conductor.alerta_estadia')).toHaveLength(1);
  });

  it('«no» dos veces: un solo aviso (idempotente)', async () => {
    const m = montar(130, cfgI());
    await responderEstadiaDescarga(m.puertos, entrada(m, 'no'));
    const otra = await responderEstadiaDescarga(m.puertos, entrada(m, 'no'));
    expect(m.enviados).toHaveLength(1);
    expect(otra[0].texto).toMatch(/Anotado/);
  });

  it('«sí» → no avisa a nadie, se espera el fin de descarga y el cron tampoco avisa después, por mucho que pase', async () => {
    const m = montar(130, cfgI());
    const out = await responderEstadiaDescarga(m.puertos, entrada(m, 'si'));
    expect(out[0].texto).toMatch(/Avísame cuando termines la descarga/);
    expect(m.enviados).toHaveLength(0);
    expect([...m.reclamos.values()][0]).toMatchObject({ ok: true, canal: 'ninguno', motivo: 'chofer_inicio_descarga' });
    const r = await correrAlertasEstadia(m.puertos, { ahora: new Date(AHORA.getTime() + 5 * 3_600_000) });
    expect(r.alertas).toBe(0);
    expect(m.enviados.filter((e) => e.contexto === 'conductor.alerta_estadia')).toHaveLength(0);
  });

  it('con la perilla apagada, o sin llegada, o con la descarga ya cerrada, no avisa y lo dice', async () => {
    const apagada = montar(130, cfgI({ estadiaDescargaInteractiva: false }));
    expect((await responderEstadiaDescarga(apagada.puertos, entrada(apagada, 'no', cfgI({ estadiaDescargaInteractiva: false }))))[0].texto).toMatch(/ya no está vigente/);
    const sin = crearPuertos({ viajes: [viajeBase({ id: 'v1' })], hitos: sembrar('v1', { llegada_carga: hace(200) }), configs: { t1: cfgI() } });
    expect((await responderEstadiaDescarga(sin.puertos, { viaje: viajeBase({ id: 'v1' }), hitos: [...sin.hitos.values()], config: cfgI(), respuesta: 'no', ahora: AHORA }))[0].texto).toMatch(/Todavía no tengo tu llegada/);
    const hs = sembrar('v1', { llegada_carga: hace(500), salida_carga: hace(400), llegada_descarga: hace(200), salida_descarga: hace(10) });
    const cerrada = crearPuertos({ viajes: [viajeBase({ id: 'v1' })], hitos: hs, configs: { t1: cfgI() } });
    expect((await responderEstadiaDescarga(cerrada.puertos, { viaje: viajeBase({ id: 'v1' }), hitos: [...cerrada.hitos.values()], config: cfgI(), respuesta: 'no', ahora: AHORA }))[0].texto).toMatch(/salida de la descarga/);
    expect([apagada, sin, cerrada].flatMap((x) => x.enviados)).toHaveLength(0);
  });

  it('A37-S34-09: sin destinatario configurado «no» NO es silencio: queda el fallo, no se quema el claim y al chofer no se le promete el aviso', async () => {
    const m = crearPuertos({ viajes: [viajeBase({ id: 'v1' })], hitos: unaDescarga(130), configs: { t1: cfgI() }, destinatarios: () => [] });
    const out = await responderEstadiaDescarga(m.puertos, { viaje: viajeBase({ id: 'v1' }), hitos: [...m.hitos.values()], config: cfgI(), respuesta: 'no', ahora: AHORA });
    expect(out[0].texto).not.toMatch(/Ya le avisé/);
    expect(m.reclamos.size).toBe(0);
  });
});
