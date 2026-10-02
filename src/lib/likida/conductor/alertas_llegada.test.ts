import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
// El módulo importa los puertos reales (Supabase): esta prueba arma los suyos en memoria y no toca la base.
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));

const { armarAvisoLlegadaSinConfirmar, correrAlertasLlegadaSinConfirmar, HORAS_MAXIMAS_LLEGADA_SIN_CONFIRMAR } = await import('./alertas_llegada');
const { CONFIG_CONDUCTOR_DEFAULT } = await import('./config');
const { crearPuertos, hitoVacio, viajeBase } = await import('./memoria.fixture');
const { plantillaDeCatalogo, validarCatalogo } = await import('@/lib/meta/plantillas_catalogo');
type ConfigConductor = import('./config').ConfigConductor;
type HitoFila = import('./tipos').HitoFila;
type TipoHito = import('./tipos').TipoHito;
type VeredictoFila = import('./repo_validacion').VeredictoFila;
type PuertosAlertaLlegada = import('./alertas_llegada').PuertosAlertaLlegada;

// 2026-10-02 18:00Z = 12:00 en México (dentro de la ventana 06–22).
const AHORA = new Date('2026-10-02T18:00:00.000Z');
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();
const cfg = (p: Partial<ConfigConductor> = {}): ConfigConductor => ({
  ...CONFIG_CONDUCTOR_DEFAULT, solicitudesMin: [...CONFIG_CONDUCTOR_DEFAULT.solicitudesMin], diasSemana: [...CONFIG_CONDUCTOR_DEFAULT.diasSemana],
  avisarLlegadaSinConfirmar: true, ...p,
});

function hitos(viajeId: string, llegadaCarga: string | null, extra: Partial<HitoFila> = {}, tenantId = 't1'): HitoFila[] {
  return (['llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga', 'regreso'] as TipoHito[]).map((tipo) => hitoVacio({
    id: `${viajeId}-${tipo}`, tipo, viajeId, tenantId,
    ...(tipo === 'llegada_carga' && llegadaCarga ? { estado: 'recibido', fuente: 'texto', mensajeEn: llegadaCarga, recibidoEn: llegadaCarga, ...extra } : {}),
  }));
}

const veredicto = (hitoId: string, resultado: VeredictoFila['resultado'], motivo: VeredictoFila['motivo'] = null): VeredictoFila => ({
  hitoId, ciclo: 1, resultado, motivo, fuente: resultado === 'sin_dato' ? null : 'gps', distanciaM: resultado === 'sin_coincidencia' ? 900 : null,
  radioM: 300, toleranciaM: 150, sitioId: 's1', medidaEn: null,
});

/** Los puertos en memoria del Conductor más las dos lecturas propias del aviso. */
function armar(o: {
  viajes?: Array<ReturnType<typeof viajeBase>>; hitos: HitoFila[]; config?: ConfigConductor; veredictos?: VeredictoFila[];
  conSitio?: boolean; envio?: Parameters<typeof crearPuertos>[0]['envio']; destinatarios?: Parameters<typeof crearPuertos>[0]['destinatarios'];
}) {
  const viajes = o.viajes ?? [viajeBase({ id: 'v1', origen: 'Planta Zapopan' })];
  const base = crearPuertos({ viajes, hitos: o.hitos, configs: { t1: o.config ?? cfg() }, envio: o.envio, destinatarios: o.destinatarios });
  const puertos: PuertosAlertaLlegada = {
    ...base.puertos,
    veredictosDe: async () => o.veredictos ?? [],
    sitiosDe: async (ids) => new Map(ids.map((id) => [id, { origen: o.conSitio ?? true, destino: o.conSitio ?? true }])),
  };
  return { puertos, enviados: base.enviados, eventos: base.eventos };
}

describe('correrAlertasLlegadaSinConfirmar', () => {
  it('con sitio y sin posición que la respalde: avisa UNA vez al patio, con la hora del mensaje del chofer y sin acusar', async () => {
    const { puertos, enviados, eventos } = armar({ hitos: hitos('v1', hace(30)), veredictos: [veredicto('v1-llegada_carga', 'sin_dato', 'sin_ubicacion')] });
    const r = await correrAlertasLlegadaSinConfirmar(puertos, { ahora: AHORA });
    expect(r).toMatchObject({ avisos: 1, revisadas: 1, fallos: [] });
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({ telefono: '5219990000099', plantilla: 'conductor_llegada_sin_confirmar_v1', contexto: 'conductor.llegada_sin_confirmar' });
    expect(enviados[0].texto).toMatch(/Juan Pérez avisó a las .* \(hora de su mensaje\) que llegó a la carga de Planta Zapopan \(viaje F-1042\)/);
    expect(enviados[0].texto).toMatch(/ninguna posición/);
    expect(enviados[0].texto).not.toMatch(/mintió|falso/i);
    expect(eventos.map((e) => e.evento)).toEqual(['alerta_llegada_sin_confirmar']);
  });

  it('sin veredicto todavía y con sitio también avisa (la validación pudo no correr)', async () => {
    const { puertos, enviados } = armar({ hitos: hitos('v1', hace(30)) });
    expect(await correrAlertasLlegadaSinConfirmar(puertos, { ahora: AHORA })).toMatchObject({ avisos: 1 });
    expect(enviados[0].texto).toMatch(/ninguna posición/);
  });

  it('el viaje SIN SITIO: avisa que no hay con qué conciliar el «ya llegué» y que falta asignar el sitio', async () => {
    const { puertos, enviados } = armar({ hitos: hitos('v1', hace(30)), conSitio: false });
    const r = await correrAlertasLlegadaSinConfirmar(puertos, { ahora: AHORA });
    expect(r.avisos).toBe(1);
    expect(enviados[0].texto).toMatch(/el viaje no tiene sitio asignado/);
  });

  it('también con el veredicto «sin sitio» guardado (el viaje perdió su sitio después)', async () => {
    const { puertos, enviados } = armar({ hitos: hitos('v1', hace(30)), veredictos: [veredicto('v1-llegada_carga', 'sin_dato', 'sin_sitio')] });
    expect((await correrAlertasLlegadaSinConfirmar(puertos, { ahora: AHORA })).avisos).toBe(1);
    expect(enviados[0].texto).toMatch(/no tiene sitio asignado/);
  });

  it('«sin coincidencia»: avisa que la posición cae fuera del sitio, diciendo que puede ser una muestra vieja', async () => {
    const { puertos, enviados } = armar({ hitos: hitos('v1', hace(30)), veredictos: [veredicto('v1-llegada_carga', 'sin_coincidencia')] });
    expect((await correrAlertasLlegadaSinConfirmar(puertos, { ahora: AHORA })).avisos).toBe(1);
    expect(enviados[0].texto).toMatch(/cae fuera del sitio.*muestra vieja/);
  });

  it('idempotente: una segunda corrida, o dos solapadas, NO repiten el aviso', async () => {
    const { puertos, enviados } = armar({ hitos: hitos('v1', hace(30)) });
    const [a, b] = await Promise.all([correrAlertasLlegadaSinConfirmar(puertos, { ahora: AHORA }), correrAlertasLlegadaSinConfirmar(puertos, { ahora: AHORA })]);
    expect(a.avisos + b.avisos).toBe(1);
    expect(a.yaReclamados + b.yaReclamados).toBe(1);
    await correrAlertasLlegadaSinConfirmar(puertos, { ahora: new Date(AHORA.getTime() + 600_000) });
    expect(enviados).toHaveLength(1);
  });

  it('APAGADO por omisión: sin la perilla, o con la validación de ubicación apagada, no manda nada ni lee hitos', async () => {
    for (const config of [cfg({ avisarLlegadaSinConfirmar: false }), cfg({ validarUbicacion: false }), cfg({ activo: false })]) {
      const { puertos, enviados } = armar({ hitos: hitos('v1', hace(30)), config });
      const hitosDe = vi.spyOn(puertos, 'hitosDe');
      expect(await correrAlertasLlegadaSinConfirmar(puertos, { ahora: AHORA })).toMatchObject({ avisos: 0, revisadas: 0 });
      expect(enviados).toHaveLength(0);
      expect(hitosDe).not.toHaveBeenCalled();
    }
    expect(CONFIG_CONDUCTOR_DEFAULT.avisarLlegadaSinConfirmar).toBe(false);
  });

  it('no avisa lo que no es excepción: validada, declarada por la oficina, o recién llegada (el GPS reporta con retraso)', async () => {
    const casos: Array<[string, HitoFila[], VeredictoFila[]]> = [
      ['validada por GPS', hitos('v1', hace(30), { estado: 'validado', validadoPor: 'gps', validadoEn: hace(20) }), [veredicto('v1-llegada_carga', 'validado')]],
      ['declarada por la oficina', hitos('v1', hace(30), { fuente: 'oficina' }), []],
      ['hace 3 minutos', hitos('v1', hace(3)), [veredicto('v1-llegada_carga', 'sin_dato', 'sin_ubicacion')]],
      ['sin llegada', hitos('v1', null), []],
    ];
    for (const [nombre, hs, v] of casos) {
      const { puertos, enviados } = armar({ hitos: hs, veredictos: v });
      const r = await correrAlertasLlegadaSinConfirmar(puertos, { ahora: AHORA });
      expect(r.avisos, nombre).toBe(0);
      expect(enviados, nombre).toHaveLength(0);
    }
  });

  it('una llegada muy vieja no dispara avisos al encender la perilla', async () => {
    const { puertos, enviados } = armar({ hitos: hitos('v1', hace(HORAS_MAXIMAS_LLEGADA_SIN_CONFIRMAR * 60 + 5)) });
    expect((await correrAlertasLlegadaSinConfirmar(puertos, { ahora: AHORA })).avisos).toBe(0);
    expect(enviados).toHaveLength(0);
  });

  it('fuera de la ventana horaria de la flota espera sin reclamar, y avisa cuando abre', async () => {
    const noche = new Date('2026-10-03T06:00:00.000Z'); // 00:00 en México
    const hs = hitos('v1', new Date(noche.getTime() - 30 * 60_000).toISOString());
    const { puertos, enviados } = armar({ hitos: hs });
    expect(await correrAlertasLlegadaSinConfirmar(puertos, { ahora: noche })).toMatchObject({ avisos: 0, fueraDeVentana: 1 });
    expect(enviados).toHaveLength(0);
  });

  it('si no se supo si el viaje trae sitio, no avisa (un «sin sitio» falso es peor que un aviso tardío)', async () => {
    const { puertos, enviados } = armar({ hitos: hitos('v1', hace(30)) });
    puertos.sitiosDe = async () => new Map();
    expect((await correrAlertasLlegadaSinConfirmar(puertos, { ahora: AHORA })).avisos).toBe(0);
    expect(enviados).toHaveLength(0);
  });

  it('sin a quién avisar: cierra el claim con el motivo y lo reporta, sin reintentar cada pasada', async () => {
    const { puertos, enviados } = armar({ hitos: hitos('v1', hace(30)), destinatarios: () => [] });
    const r = await correrAlertasLlegadaSinConfirmar(puertos, { ahora: AHORA });
    expect(r).toMatchObject({ avisos: 0, sinDestinatario: 1 });
    expect(r.fallos[0]).toMatch(/no hay a quién avisar/);
    expect(await correrAlertasLlegadaSinConfirmar(puertos, { ahora: AHORA })).toMatchObject({ yaReclamados: 1, sinDestinatario: 0 });
    expect(enviados).toHaveLength(0);
  });

  it('un rechazo reintentable libera el claim y la corrida siguiente lo manda; uno definitivo lo cierra con el motivo', async () => {
    let falla = true;
    const { puertos, enviados } = armar({ hitos: hitos('v1', hace(30)), envio: () => (falla ? { ok: false, reintentable: true, mensaje: 'límite de tasa' } : { ok: true, via: 'texto' }) });
    expect(await correrAlertasLlegadaSinConfirmar(puertos, { ahora: AHORA })).toMatchObject({ avisos: 0, rechazosReintentables: 1 });
    falla = false;
    expect(await correrAlertasLlegadaSinConfirmar(puertos, { ahora: AHORA })).toMatchObject({ avisos: 1 });
    expect(enviados).toHaveLength(1);

    const def = armar({ hitos: hitos('v1', hace(30)), envio: () => ({ ok: false, reintentable: false, mensaje: 'plantilla sin aprobar' }) });
    const r = await correrAlertasLlegadaSinConfirmar(def.puertos, { ahora: AHORA });
    expect(r.avisos).toBe(0);
    expect(r.fallos[0]).toMatch(/plantilla sin aprobar/);
    expect(await correrAlertasLlegadaSinConfirmar(def.puertos, { ahora: AHORA })).toMatchObject({ yaReclamados: 1 });
  });

  it('otra flota con la perilla apagada no recibe nada aunque la de al lado sí', async () => {
    const viajes = [viajeBase({ id: 'v1', tenantId: 't1' }), viajeBase({ id: 'v2', tenantId: 't2', operadorId: 'o2' })];
    const base = crearPuertos({ viajes, hitos: [...hitos('v1', hace(30)), ...hitos('v2', hace(30), {}, 't2')], configs: { t1: cfg(), t2: cfg({ avisarLlegadaSinConfirmar: false }) } });
    const puertos: PuertosAlertaLlegada = { ...base.puertos, veredictosDe: async () => [], sitiosDe: async (ids) => new Map(ids.map((id) => [id, { origen: true, destino: true }])) };
    const r = await correrAlertasLlegadaSinConfirmar(puertos, { ahora: AHORA });
    expect(r.avisos).toBe(1);
    expect(base.enviados.map((e) => e.tenantId)).toEqual(['t1']);
  });
});

describe('la plantilla de la llegada sin confirmar', () => {
  it('está en el catálogo, pasa la validación de Meta y se arma con sus cuatro variables', () => {
    expect(plantillaDeCatalogo('conductor_llegada_sin_confirmar_v1')).toMatchObject({ categoria: 'UTILITY', agente: 'agente5_conductor', estado: 'nueva_para_aprobacion' });
    expect(validarCatalogo()).toEqual([]);
    const m = armarAvisoLlegadaSinConfirmar(viajeBase({ id: 'v1', origen: 'Planta Zapopan' }), hitos('v1', hace(30))[0], 'sin_ubicacion', AHORA);
    expect(m.plantilla.nombre).toBe('conductor_llegada_sin_confirmar_v1');
    const parametros = m.plantilla.parametros ?? [];
    expect(parametros).toHaveLength(4);
    expect(parametros.every((x) => !/\n/.test(x))).toBe(true);
  });
});
