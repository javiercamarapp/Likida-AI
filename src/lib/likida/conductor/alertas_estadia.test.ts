import { describe, expect, it } from 'vitest';
import { armarAlertaEstadia, correrAlertasEstadia } from './alertas_estadia';
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

  it('sin a quién avisar: se dice (fallo + sinDestinatario) y el claim queda cerrado sin ok', async () => {
    const { puertos, enviados, reclamos } = crearPuertos({
      viajes: [viajeBase({ id: 'v1' })], hitos: sembrar('v1', { llegada_carga: hace(200) }), configs: { t1: cfg() }, destinatarios: () => [],
    });
    const r = await correrAlertasEstadia(puertos, { ahora: AHORA });
    expect(r).toMatchObject({ alertas: 0, sinDestinatario: 1 });
    expect(r.fallos[0]).toMatch(/no hay a quién avisar/);
    expect(enviados).toHaveLength(0);
    expect([...reclamos.values()][0]).toMatchObject({ ok: false, motivo: 'sin_destinatario' });
  });

  it('un rechazo reintentable libera el claim y la siguiente corrida lo manda', async () => {
    let falla = true;
    const { puertos, enviados } = crearPuertos({
      viajes: [viajeBase({ id: 'v1' })], hitos: sembrar('v1', { llegada_carga: hace(200) }), configs: { t1: cfg() },
      envio: () => (falla ? { ok: false, reintentable: true, mensaje: '429' } : { ok: true, via: 'texto' }),
    });
    const r1 = await correrAlertasEstadia(puertos, { ahora: AHORA });
    expect(r1).toMatchObject({ alertas: 0, rechazosReintentables: 1 });
    falla = false;
    const r2 = await correrAlertasEstadia(puertos, { ahora: AHORA });
    expect(r2.alertas).toBe(1);
    expect(enviados).toHaveLength(1);
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
