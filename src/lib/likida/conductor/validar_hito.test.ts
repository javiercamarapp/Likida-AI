import { describe, expect, it, vi } from 'vitest';
import { CONFIG_CONDUCTOR_DEFAULT, type ConfigConductor } from './config';
import { hitoVacio, viajeBase } from './memoria.fixture';
import {
  barridoValidacion, validarHitoContraSitio, type CandidatoValidacion, type ConfigValidacion, type DepsValidacion,
} from './validar_hito';
import type { PosicionComparada, SitioValidable, Veredicto } from './validacion';
import type { HitoFila } from './tipos';

const MENSAJE = new Date('2026-10-02T20:00:00.000Z');
const SITIO: SitioValidable = { id: 's1', nombre: 'Planta Zapopan', lat: 20.72, lng: -103.39, radioM: 300 };
const CONFIG: ConfigValidacion = { validarUbicacion: true, toleranciaUbicacionM: 150, ventanaUbicacionMin: 30, pedirUbicacion: true };

function llegada(extra: Partial<HitoFila> = {}): HitoFila {
  return hitoVacio({ id: 'h1', tipo: 'llegada_carga', viajeId: 'v1', estado: 'recibido', fuente: 'texto', mensajeEn: MENSAJE.toISOString(), recibidoEn: MENSAJE.toISOString(), ...extra });
}

function deps(o: { sitio?: SitioValidable | null; gps?: PosicionComparada[]; aplicar?: DepsValidacion['aplicar'] } = {}) {
  const aplicados: Array<{ tenantId: string; hito: HitoFila; v: Veredicto }> = [];
  const d: DepsValidacion = {
    sitio: vi.fn(async () => (o.sitio === undefined ? SITIO : o.sitio)),
    posiciones: vi.fn(async () => o.gps ?? []),
    aplicar: o.aplicar ?? (async (tenantId, hito, v) => { aplicados.push({ tenantId, hito, v }); return 'nuevo'; }),
  };
  return { d, aplicados };
}
const viaje = (unidadId: string | null = 'u1') => ({ id: 'v1', tenantId: 't1', unidadId });
const gps = (p: Partial<PosicionComparada> = {}): PosicionComparada => ({ lat: 20.72, lng: -103.39, medidaEn: new Date(MENSAJE.getTime() + 60_000), fuente: 'gps', ...p });

describe('validarHitoContraSitio', () => {
  it('con GPS cerca del sitio: validado', async () => {
    const { d, aplicados } = deps({ gps: [gps()] });
    const r = await validarHitoContraSitio(d, { viaje: viaje(), hito: llegada(), config: CONFIG, mensajeEn: MENSAJE, ahora: MENSAJE });
    expect(r?.veredicto).toMatchObject({ resultado: 'validado', fuente: 'gps' });
    expect(r?.pedirUbicacion).toBe(false);
    expect(aplicados).toHaveLength(1);
    expect(aplicados[0].tenantId).toBe('t1');
  });

  it('con GPS lejos: sin coincidencia, y NO se le pide el pin (hay posición; pedirlo sería acusarlo)', async () => {
    const { d } = deps({ gps: [gps({ lat: 20.8 })] });
    const r = await validarHitoContraSitio(d, { viaje: viaje(), hito: llegada(), config: CONFIG, mensajeEn: MENSAJE, ahora: MENSAJE });
    expect(r?.veredicto.resultado).toBe('sin_coincidencia');
    expect(r?.pedirUbicacion).toBe(false);
  });

  it('sin GPS ni pin y con sitio: sin dato y SE PIDE el pin', async () => {
    const { d } = deps({ gps: [] });
    const r = await validarHitoContraSitio(d, { viaje: viaje(), hito: llegada(), config: CONFIG, mensajeEn: MENSAJE, ahora: MENSAJE });
    expect(r?.veredicto).toMatchObject({ resultado: 'sin_dato', motivo: 'sin_ubicacion' });
    expect(r?.pedirUbicacion).toBe(true);
  });

  it('sin sitio asignado: sin dato y NO se pide el pin (no hay con qué compararlo), y no consulta el GPS', async () => {
    const { d } = deps({ sitio: null });
    const r = await validarHitoContraSitio(d, { viaje: viaje(), hito: llegada(), config: CONFIG, mensajeEn: MENSAJE, ahora: MENSAJE });
    expect(r?.veredicto).toMatchObject({ resultado: 'sin_dato', motivo: 'sin_sitio' });
    expect(r?.pedirUbicacion).toBe(false);
    expect(d.posiciones).not.toHaveBeenCalled();
  });

  it('con pin dentro del sitio: validado por pin; con pin lejano: sin coincidencia', async () => {
    const { d } = deps({ gps: [] });
    const ok = await validarHitoContraSitio(d, { viaje: viaje(), hito: llegada(), config: CONFIG, mensajeEn: MENSAJE, ahora: MENSAJE, pin: { lat: 20.7201, lng: -103.3901, medidaEn: new Date(MENSAJE.getTime() + 120_000) } });
    expect(ok?.veredicto).toMatchObject({ resultado: 'validado', fuente: 'pin' });
    const lejos = await validarHitoContraSitio(d, { viaje: viaje(), hito: llegada(), config: CONFIG, mensajeEn: MENSAJE, ahora: MENSAJE, pin: { lat: 25, lng: -100, medidaEn: MENSAJE } });
    expect(lejos?.veredicto.resultado).toBe('sin_coincidencia');
    expect(lejos?.pedirUbicacion).toBe(false);
  });

  it('el pin NUNCA vence a una muestra de GPS dentro de la ventana: el camión real decide (adversarial ronda 03)', async () => {
    const { d } = deps({ gps: [gps({ lat: 25, lng: -100, medidaEn: new Date(MENSAJE.getTime() + 60_000) })] });
    const r = await validarHitoContraSitio(d, {
      viaje: viaje(), hito: llegada(), config: CONFIG, mensajeEn: MENSAJE, ahora: MENSAJE,
      pin: { lat: 20.72, lng: -103.39, medidaEn: new Date(MENSAJE.getTime() - 60_000) },
    });
    expect(r?.veredicto).toMatchObject({ resultado: 'sin_coincidencia', fuente: 'gps' });
  });

  it('GPS atrasado: si la unidad SÍ reporta GPS pero aún no hay muestra en la ventana, el pin solo NO valida (queda sin dato y se reintenta)', async () => {
    const gpsActivo = vi.fn(async () => true);
    const { d, aplicados } = deps({ gps: [] });
    d.gpsActivo = gpsActivo;
    const r = await validarHitoContraSitio(d, {
      viaje: viaje(), hito: llegada(), config: CONFIG, mensajeEn: MENSAJE, ahora: MENSAJE,
      pin: { lat: 20.72, lng: -103.39, medidaEn: new Date(MENSAJE.getTime() + 120_000) },
    });
    expect(r?.veredicto).toMatchObject({ resultado: 'sin_dato', motivo: 'ubicacion_fuera_de_ventana' });
    expect(r?.pedirUbicacion).toBe(false); // ya mandó el pin: pedirlo otra vez no sirve
    expect(aplicados[0].v.resultado).toBe('sin_dato');
    expect(gpsActivo).toHaveBeenCalledWith('t1', 'u1', expect.any(Date));
  });

  it('un pin guardado antes por el processor (proveedor whatsapp) tampoco basta cuando la unidad tiene GPS', async () => {
    const { d } = deps({ gps: [gps({ fuente: 'pin' })] });
    d.gpsActivo = async () => true;
    const r = await validarHitoContraSitio(d, { viaje: viaje(), hito: llegada(), config: CONFIG, mensajeEn: MENSAJE, ahora: MENSAJE });
    expect(r?.veredicto).toMatchObject({ resultado: 'sin_dato', motivo: 'ubicacion_fuera_de_ventana' });
  });

  it('unidad SIN historial de GPS (flota sin conector): el pin sigue siendo la evidencia', async () => {
    const { d } = deps({ gps: [] });
    d.gpsActivo = async () => false;
    const r = await validarHitoContraSitio(d, {
      viaje: viaje(), hito: llegada(), config: CONFIG, mensajeEn: MENSAJE, ahora: MENSAJE,
      pin: { lat: 20.72, lng: -103.39, medidaEn: new Date(MENSAJE.getTime() + 120_000) },
    });
    expect(r?.veredicto).toMatchObject({ resultado: 'validado', fuente: 'pin' });
  });

  it('si la consulta de «¿tiene GPS?» falla, no se asume que no: el pin no valida y se reintenta', async () => {
    const { d } = deps({ gps: [] });
    d.gpsActivo = async () => { throw new Error('base caída'); };
    await expect(validarHitoContraSitio(d, { viaje: viaje(), hito: llegada(), config: CONFIG, mensajeEn: MENSAJE, ahora: MENSAJE, pin: { lat: 20.72, lng: -103.39, medidaEn: MENSAJE } })).resolves.toBeNull();
  });

  it('la unidad sin GPS asignado: solo cuenta el pin', async () => {
    const { d } = deps({ gps: [gps()] });
    const r = await validarHitoContraSitio(d, { viaje: viaje(null), hito: llegada(), config: CONFIG, mensajeEn: MENSAJE, ahora: MENSAJE });
    expect(r?.veredicto.motivo).toBe('sin_ubicacion');
    expect(d.posiciones).not.toHaveBeenCalled();
  });

  it('las salidas NO se validan (el camión ya se está yendo)', async () => {
    const { d } = deps();
    expect(await validarHitoContraSitio(d, { viaje: viaje(), hito: llegada({ tipo: 'salida_carga' }), config: CONFIG, mensajeEn: MENSAJE, ahora: MENSAJE })).toBeNull();
    expect(d.sitio).not.toHaveBeenCalled();
  });

  it('con la validación apagada por la flota: no hace nada', async () => {
    const { d } = deps();
    expect(await validarHitoContraSitio(d, { viaje: viaje(), hito: llegada(), config: { ...CONFIG, validarUbicacion: false }, mensajeEn: MENSAJE, ahora: MENSAJE })).toBeNull();
  });

  it('un hito que no está recibido (omitido, esperado) no se valida', async () => {
    const { d } = deps();
    for (const estado of ['esperado', 'omitido', 'escalado'] as const) {
      expect(await validarHitoContraSitio(d, { viaje: viaje(), hito: llegada({ estado }), config: CONFIG, mensajeEn: MENSAJE, ahora: MENSAJE })).toBeNull();
    }
  });

  it('con pedirUbicacion apagado no se pide aunque falte la posición', async () => {
    const { d } = deps();
    const r = await validarHitoContraSitio(d, { viaje: viaje(), hito: llegada(), config: { ...CONFIG, pedirUbicacion: false }, mensajeEn: MENSAJE, ahora: MENSAJE });
    expect(r?.pedirUbicacion).toBe(false);
  });

  it('si el hito cambió mientras se medía (retirado/corregido) no se pide nada', async () => {
    const { d } = deps({ aplicar: async () => 'hito_cambio' });
    const r = await validarHitoContraSitio(d, { viaje: viaje(), hito: llegada(), config: CONFIG, mensajeEn: MENSAJE, ahora: MENSAJE });
    expect(r?.aplicado).toBe('hito_cambio');
    expect(r?.pedirUbicacion).toBe(false);
  });

  it('NUNCA lanza: una base caída devuelve null y no rompe el acuse', async () => {
    const d: DepsValidacion = { sitio: async () => { throw new Error('base caída'); }, posiciones: async () => [], aplicar: async () => 'nuevo' };
    await expect(validarHitoContraSitio(d, { viaje: viaje(), hito: llegada(), config: CONFIG, mensajeEn: MENSAJE, ahora: MENSAJE })).resolves.toBeNull();
  });

  it('pide el GPS en la ventana alrededor de la hora del MENSAJE (± ventana configurada)', async () => {
    const { d } = deps();
    await validarHitoContraSitio(d, { viaje: viaje(), hito: llegada(), config: { ...CONFIG, ventanaUbicacionMin: 45 }, mensajeEn: MENSAJE, ahora: MENSAJE });
    const [, , desde, hasta] = (d.posiciones as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, Date, Date];
    expect(MENSAJE.getTime() - desde.getTime()).toBe(45 * 60_000);
    expect(hasta.getTime() - MENSAJE.getTime()).toBe(45 * 60_000);
  });
});

describe('barridoValidacion', () => {
  const candidato = (id: string, tenant = 't1'): CandidatoValidacion => ({
    hito: llegada({ id, tenantId: tenant }), viaje: viajeBase({ id: `v-${id}`, tenantId: tenant, unidadId: 'u1' }),
  });

  it('reintenta lo sin dato cuando el GPS ya reportó, y cuenta lo que mejoró', async () => {
    const { d, aplicados } = deps({ gps: [gps()] });
    const r = await barridoValidacion({
      candidatos: async () => [candidato('a'), candidato('b')], configDe: async () => ({ ...CONFIG_CONDUCTOR_DEFAULT }), deps: d,
    }, MENSAJE);
    expect(r).toMatchObject({ revisados: 2, validados: 2, sinDato: 0, fallos: 0 });
    expect(aplicados).toHaveLength(2);
  });

  it('lee la config de CADA flota una sola vez y respeta la de cada una (aislamiento)', async () => {
    const { d, aplicados } = deps({ gps: [gps()] });
    const configDe = vi.fn(async (t: string): Promise<ConfigConductor> => ({ ...CONFIG_CONDUCTOR_DEFAULT, validarUbicacion: t === 't1' }));
    const r = await barridoValidacion({ candidatos: async () => [candidato('a'), candidato('b', 't2'), candidato('c')], configDe, deps: d }, MENSAJE);
    expect(configDe).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ revisados: 2, saltados: 1 });
    expect(aplicados.every((x) => x.tenantId === 't1')).toBe(true);
  });

  it('una flota con config ilegible se salta sin tumbar a las demás', async () => {
    const { d } = deps({ gps: [gps()] });
    const r = await barridoValidacion({
      candidatos: async () => [candidato('a', 'malo'), candidato('b')],
      configDe: async (t) => { if (t === 'malo') throw new Error('x'); return { ...CONFIG_CONDUCTOR_DEFAULT }; }, deps: d,
    }, MENSAJE);
    expect(r).toMatchObject({ revisados: 1, validados: 1, fallos: 1 });
  });

  it('respeta el reloj de la corrida', async () => {
    const { d, aplicados } = deps({ gps: [gps()] });
    const r = await barridoValidacion({ candidatos: async () => [candidato('a'), candidato('b')], configDe: async () => ({ ...CONFIG_CONDUCTOR_DEFAULT }), deps: d }, MENSAJE, Date.now() - 1);
    expect(r.revisados).toBe(0);
    expect(aplicados).toHaveLength(0);
  });

  it('un «sin coincidencia» SE REEVALÚA mientras la ventana siga abierta: una muestra posterior más cercana lo valida (adversarial ronda 03)', async () => {
    const { d, aplicados } = deps({ gps: [gps({ medidaEn: new Date(MENSAJE.getTime() + 2 * 60_000) })] });
    const r = await barridoValidacion({
      candidatos: async () => [{ ...candidato('a'), resultadoPrevio: 'sin_coincidencia' }],
      configDe: async () => ({ ...CONFIG_CONDUCTOR_DEFAULT }), deps: d,
    }, new Date(MENSAJE.getTime() + 10 * 60_000));
    expect(r).toMatchObject({ revisados: 1, validados: 1 });
    expect(aplicados).toHaveLength(1);
  });

  it('un «sin coincidencia» ya sin ventana (no pueden llegar más muestras que cuenten) NO se vuelve a medir', async () => {
    const { d, aplicados } = deps({ gps: [gps()] });
    const r = await barridoValidacion({
      candidatos: async () => [{ ...candidato('a'), resultadoPrevio: 'sin_coincidencia' }],
      configDe: async () => ({ ...CONFIG_CONDUCTOR_DEFAULT }), deps: d,
    }, new Date(MENSAJE.getTime() + 3 * 3_600_000));
    expect(r).toMatchObject({ revisados: 0, saltados: 1 });
    expect(aplicados).toHaveLength(0);
  });

  it('idempotente: si la base dice «igual», no cuenta como mejora', async () => {
    const { d } = deps({ gps: [gps({ lat: 25 })], aplicar: async () => 'igual' });
    const r = await barridoValidacion({ candidatos: async () => [candidato('a')], configDe: async () => ({ ...CONFIG_CONDUCTOR_DEFAULT }), deps: d }, MENSAJE);
    expect(r.validados).toBe(0);
    expect(r.sinCoincidencia).toBe(0);
  });
});
