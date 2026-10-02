import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { CONFIG_CONDUCTOR_DEFAULT, type ConfigConductor } from './config';
import {
  barridoCicloGps, buscarEntrada, buscarSalida, proximaDeteccion, MIN_MUESTRAS_DENTRO_APROXIMADO,
  type ClaimCruce, type MuestraGps, type PuertosCicloGps, type SitioGps, type SitiosViaje,
} from './ciclo_gps';
import { hitoVacio, viajeBase } from './memoria.fixture';
import { TIPOS_HITO, type HitoFila, type TipoHito } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// EL CICLO POR GEOCERCA — la decisión pura (entrar, salir, pasar de largo) y el barrido con puertos.
// 1° de latitud ≈ 111,195 m: 0.001° ≈ 111 m.
// ═══════════════════════════════════════════════════════════════════════════

const T0 = new Date('2026-10-02T14:00:00.000Z');
const en = (min: number): Date => new Date(T0.getTime() + min * 60_000);
const ORIGEN: SitioGps = { id: 's-origen', nombre: 'Planta Zapopan', lat: 20.5, lng: -103.3, radioM: 300 };
const DESTINO: SitioGps = { id: 's-destino', nombre: 'CEDIS Monterrey', lat: 25.7, lng: -100.3, radioM: 300 };
const DENTRO = (min: number, sitio: SitioGps = ORIGEN): MuestraGps => ({ lat: sitio.lat + 0.001, lng: sitio.lng, medidaEn: en(min) });
const FUERA = (min: number, sitio: SitioGps = ORIGEN): MuestraGps => ({ lat: sitio.lat + 0.03, lng: sitio.lng, medidaEn: en(min) });
const TOL = 150;

describe('buscarEntrada — una llegada es quedarse, no pasar', () => {
  it('UNA sola muestra dentro no es una llegada (un tractor que pasa por la puerta a 60 km/h deja una)', () => {
    expect(buscarEntrada(ORIGEN, [FUERA(0), DENTRO(5), FUERA(10)], TOL)).toBeNull();
  });

  it('dos muestras seguidas dentro: la hora es la de la PRIMERA y la distancia es al centro', () => {
    const r = buscarEntrada(ORIGEN, [FUERA(0), DENTRO(5), DENTRO(10), DENTRO(15)], TOL);
    expect(r?.detectadoEn).toEqual(en(5));
    expect(r?.distanciaM).toBeGreaterThan(100);
    expect(r?.distanciaM).toBeLessThan(125);
  });

  it('una muestra fuera ENTRE las dos rompe la racha', () => {
    expect(buscarEntrada(ORIGEN, [DENTRO(0), FUERA(5), DENTRO(10)], TOL)).toBeNull();
  });

  it('las muestras llegan en cualquier orden: se ordenan por hora', () => {
    const r = buscarEntrada(ORIGEN, [DENTRO(10), FUERA(0), DENTRO(5)], TOL);
    expect(r?.detectadoEn).toEqual(en(5));
  });

  it('un sitio APROXIMADO (círculo en vez del polígono real) pide una muestra más', () => {
    const aprox: SitioGps = { ...ORIGEN, aproximada: true };
    expect(MIN_MUESTRAS_DENTRO_APROXIMADO).toBe(3);
    expect(buscarEntrada(aprox, [DENTRO(0), DENTRO(5)], TOL)).toBeNull();
    expect(buscarEntrada(aprox, [DENTRO(0), DENTRO(5), DENTRO(10)], TOL)?.detectadoEn).toEqual(en(0));
  });

  it('la tolerancia de la flota se suma: una muestra a 400 m de un sitio de 300 m entra con 150 m de tolerancia y no sin ella', () => {
    const justo = (min: number): MuestraGps => ({ lat: ORIGEN.lat + 0.0036, lng: ORIGEN.lng, medidaEn: en(min) }); // ≈ 400 m
    expect(buscarEntrada(ORIGEN, [justo(0), justo(5)], 0)).toBeNull();
    expect(buscarEntrada(ORIGEN, [justo(0), justo(5)], 150)).not.toBeNull();
  });

  it('con un POLÍGONO (patio alargado junto a la carretera) la carretera, aunque caiga en el círculo, NO es estar dentro (el helper único)', () => {
    // Patio delgado de ~40 m de ancho y ~700 m de largo (este-oeste); la carretera corre paralela, 120 m al norte.
    const patio: SitioGps = {
      ...ORIGEN, radioM: 400,
      poligono: [
        { lat: 20.49982, lng: -103.3035 }, { lat: 20.49982, lng: -103.2965 }, { lat: 20.50018, lng: -103.2965 }, { lat: 20.50018, lng: -103.3035 },
      ],
    };
    const carretera = (min: number): MuestraGps => ({ lat: 20.5011, lng: -103.3, medidaEn: en(min) }); // ≈ 122 m al norte del centro: dentro del círculo de 400
    expect(buscarEntrada({ ...patio, poligono: null }, [carretera(0), carretera(5)], 0)).not.toBeNull(); // con círculo, la carretera «llega»
    expect(buscarEntrada(patio, [carretera(0), carretera(5)], 0)).toBeNull();                              // con el polígono, no
    const adentro = (min: number): MuestraGps => ({ lat: 20.5, lng: -103.2995, medidaEn: en(min) });
    expect(buscarEntrada(patio, [adentro(0), adentro(5)], 0)).not.toBeNull();
  });

  it('exigirVinoDeFuera: un tractor que ya estaba ahí desde el principio no «llega»', () => {
    expect(buscarEntrada(ORIGEN, [DENTRO(0), DENTRO(5), DENTRO(10)], TOL, { exigirVinoDeFuera: true })).toBeNull();
    expect(buscarEntrada(ORIGEN, [FUERA(0), DENTRO(5), DENTRO(10)], TOL, { exigirVinoDeFuera: true })?.detectadoEn).toEqual(en(5));
  });

  it('`desde` descarta las muestras viejas', () => {
    expect(buscarEntrada(ORIGEN, [DENTRO(0), DENTRO(5)], TOL, { desde: en(1) })).toBeNull();
  });
});

describe('buscarSalida — una salida es irse de verdad', () => {
  it('estuvo dentro (2+) y luego 2 muestras fuera: la hora es la de la PRIMERA fuera', () => {
    const r = buscarSalida(ORIGEN, [DENTRO(0), DENTRO(5), FUERA(10), FUERA(15)], TOL, en(-60));
    expect(r?.detectadoEn).toEqual(en(10));
    expect(r!.distanciaM).toBeGreaterThan(3000);
  });

  it('UNA sola muestra fuera no es una salida (puede ser el GPS)', () => {
    expect(buscarSalida(ORIGEN, [DENTRO(0), DENTRO(5), FUERA(10)], TOL, en(-60))).toBeNull();
  });

  it('sin haber estado dentro NO hay salida: las muestras de afuera son la aproximación', () => {
    expect(buscarSalida(ORIGEN, [FUERA(0), FUERA(5), FUERA(10)], TOL, en(-60))).toBeNull();
    expect(buscarSalida(ORIGEN, [DENTRO(0), FUERA(5), FUERA(10)], TOL, en(-60))).toBeNull(); // una sola dentro tampoco basta
  });

  it('el GPS que baila en el borde (dentro de tolerancia + histéresis) no abre y cierra el hito', () => {
    const borde = (min: number): MuestraGps => ({ lat: ORIGEN.lat + 0.0042, lng: ORIGEN.lng, medidaEn: en(min) }); // ≈ 467 m: fuera de 450 (300+150) y dentro de 550 (+100)
    expect(buscarSalida(ORIGEN, [DENTRO(0), DENTRO(5), borde(10), borde(15), borde(20)], TOL, en(-60))).toBeNull();
  });

  it('una muestra dentro entre las de fuera reinicia la cuenta', () => {
    expect(buscarSalida(ORIGEN, [DENTRO(0), DENTRO(5), FUERA(10), DENTRO(15), FUERA(20)], TOL, en(-60))).toBeNull();
    expect(buscarSalida(ORIGEN, [DENTRO(0), DENTRO(5), FUERA(10), DENTRO(15), FUERA(20), FUERA(25)], TOL, en(-60))?.detectadoEn).toEqual(en(20));
  });

  it('`desde` deja fuera lo anterior a la llegada', () => {
    expect(buscarSalida(ORIGEN, [DENTRO(0), DENTRO(5), FUERA(10), FUERA(15)], TOL, en(6))).toBeNull();
  });
});

// ── proximaDeteccion ────────────────────────────────────────────────────────

function hitos(estados: Partial<Record<TipoHito, Partial<HitoFila>>> = {}): Record<'llegada_carga' | 'salida_carga' | 'llegada_descarga' | 'salida_descarga', HitoFila> {
  const r = {} as Record<TipoHito, HitoFila>;
  for (const t of TIPOS_HITO) r[t] = hitoVacio({ id: `h-${t}`, viajeId: 'v1', tipo: t, ...(estados[t] ?? {}) });
  return r;
}
const resuelto = (iso: string): Partial<HitoFila> => ({ estado: 'recibido', fuente: 'texto', mensajeEn: iso, recibidoEn: iso });
const SITIOS: SitiosViaje = { origen: ORIGEN, destino: DESTINO };
const config = { toleranciaUbicacionM: TOL, ventanaUbicacionMin: 30 };
const aceptadoEn = en(-120);

describe('proximaDeteccion — qué hito prueba ya el GPS', () => {
  it('llegada a la carga: el tractor entra al origen', () => {
    const d = proximaDeteccion({ hitos: hitos(), sitios: SITIOS, muestras: [FUERA(0), DENTRO(5), DENTRO(10)], config, aceptadoEn });
    expect(d).toMatchObject({ tipo: 'llegada_carga', entrada: true, detectadoEn: en(5), fueraDeOrden: false, omitir: [] });
    expect(d?.sitio.id).toBe('s-origen');
  });

  it('el tractor que YA estaba en el patio al aceptar el viaje también «llegó»', () => {
    const d = proximaDeteccion({ hitos: hitos(), sitios: SITIOS, muestras: [DENTRO(-100), DENTRO(-95)], config, aceptadoEn });
    expect(d?.tipo).toBe('llegada_carga');
  });

  it('lo que el chofer ya reportó NO se toca: con la llegada registrada por texto, lo siguiente es la salida', () => {
    const h = hitos({ llegada_carga: resuelto(en(2).toISOString()) });
    expect(proximaDeteccion({ hitos: h, sitios: SITIOS, muestras: [DENTRO(0), DENTRO(5), DENTRO(10)], config, aceptadoEn })).toBeNull();
    const d = proximaDeteccion({ hitos: h, sitios: SITIOS, muestras: [DENTRO(0), DENTRO(5), FUERA(10), FUERA(15)], config, aceptadoEn });
    expect(d).toMatchObject({ tipo: 'salida_carga', entrada: false, detectadoEn: en(10) });
  });

  it('SIN la llegada a la carga resuelta no hay salida: la salida de un sitio al que no se llegó no existe', () => {
    const h = hitos({ llegada_carga: { estado: 'omitido', omitidoMotivo: 'inferido_por_llegada_descarga' } });
    expect(proximaDeteccion({ hitos: h, sitios: { origen: ORIGEN, destino: null }, muestras: [DENTRO(0), DENTRO(5), FUERA(10), FUERA(15)], config, aceptadoEn })).toBeNull();
  });

  it('llegada a la descarga: después de la salida de la carga, el tractor entra al destino', () => {
    const h = hitos({ llegada_carga: resuelto(en(0).toISOString()), salida_carga: resuelto(en(10).toISOString()) });
    const muestras = [DENTRO(0), DENTRO(5), FUERA(10), FUERA(15), FUERA(300, DESTINO), DENTRO(400, DESTINO), DENTRO(405, DESTINO)];
    const d = proximaDeteccion({ hitos: h, sitios: SITIOS, muestras, config, aceptadoEn });
    expect(d).toMatchObject({ tipo: 'llegada_descarga', entrada: true, detectadoEn: en(400), fueraDeOrden: false, omitir: [] });
    expect(d?.sitio.id).toBe('s-destino');
  });

  it('salida de la descarga: ya llegó (a mano o por GPS) y el tractor se va', () => {
    const h = hitos({
      llegada_carga: resuelto(en(0).toISOString()), salida_carga: resuelto(en(10).toISOString()), llegada_descarga: resuelto(en(400).toISOString()),
    });
    const muestras = [DENTRO(400, DESTINO), DENTRO(405, DESTINO), FUERA(500, DESTINO), FUERA(505, DESTINO)];
    expect(proximaDeteccion({ hitos: h, sitios: SITIOS, muestras, config, aceptadoEn })).toMatchObject({ tipo: 'salida_descarga', detectadoEn: en(500) });
  });

  it('sin el sitio de un lado no se detecta ese lado (queda la excepción «sin sitio» de la oficina)', () => {
    expect(proximaDeteccion({ hitos: hitos(), sitios: { origen: null, destino: DESTINO }, muestras: [DENTRO(0), DENTRO(5)], config, aceptadoEn })).toBeNull();
  });

  describe('fuera de orden: el tractor llega al DESTINO y la carga nunca se cerró', () => {
    const dest = [FUERA(0, DESTINO), DENTRO(5, DESTINO), DENTRO(10, DESTINO)];

    it('si VINO de fuera y el origen no es el destino, se registra la llegada y los hitos anteriores pendientes pasan a omitidos', () => {
      const d = proximaDeteccion({ hitos: hitos(), sitios: SITIOS, muestras: dest, config, aceptadoEn });
      expect(d).toMatchObject({ tipo: 'llegada_descarga', fueraDeOrden: true });
      expect(d?.omitir.map((h) => h.tipo)).toEqual(['llegada_carga', 'salida_carga']);
    });

    it('lo ya resuelto no se da por omitido', () => {
      const d = proximaDeteccion({ hitos: hitos({ llegada_carga: resuelto(en(-100).toISOString()) }), sitios: SITIOS, muestras: dest, config, aceptadoEn });
      expect(d?.omitir.map((h) => h.tipo)).toEqual(['salida_carga']);
    });

    it('un tractor que ya estaba en el destino al empezar no «llegó»: no hay recorrido que probar', () => {
      expect(proximaDeteccion({ hitos: hitos(), sitios: SITIOS, muestras: [DENTRO(0, DESTINO), DENTRO(5, DESTINO), DENTRO(10, DESTINO)], config, aceptadoEn })).toBeNull();
    });

    it('si el origen y el destino son el MISMO sitio, estar ahí no prueba que la carga ya pasó', () => {
      const mismo: SitiosViaje = { origen: ORIGEN, destino: { ...ORIGEN } };
      expect(proximaDeteccion({ hitos: hitos(), sitios: mismo, muestras: [FUERA(0), DENTRO(5), DENTRO(10)], config, aceptadoEn })?.tipo).toBe('llegada_carga');
    });
  });
});

// ── el barrido ──────────────────────────────────────────────────────────────

const AHORA = en(30);
type ClaimResult = 'ganado' | 'perdido' | 'sin_tabla' | 'fallo';

function mundo(o: {
  viajes?: Array<ReturnType<typeof viajeBase>>;
  hitosPorViaje?: Record<string, Partial<Record<TipoHito, Partial<HitoFila>>>>;
  muestras?: MuestraGps[];
  sitios?: SitiosViaje;
  config?: Partial<ConfigConductor> | 'ilegible';
  reclamo?: ClaimResult;
  aplicar?: (n: number) => 'ok' | 'carrera' | 'fallo';
} = {}) {
  const viajes = o.viajes ?? [viajeBase({ id: 'v1', unidadId: 'u1', aceptadoEn: aceptadoEn.toISOString() })];
  const hs = new Map<string, HitoFila>();
  for (const v of viajes) for (const t of TIPOS_HITO) hs.set(`${v.id}|${t}`, hitoVacio({ id: `${v.id}-${t}`, viajeId: v.id, tipo: t, tenantId: v.tenantId, ...(o.hitosPorViaje?.[v.id]?.[t] ?? {}) }));
  const llamadas = { reclamar: [] as ClaimCruce[], completar: [] as ClaimCruce[], liberar: [] as ClaimCruce[], aplicar: [] as Array<{ tipo: string; hito: string; omitir: string[]; fueraDeOrden: boolean }> };
  let nAplicar = 0;
  const puertos: PuertosCicloGps = {
    viajes: async () => viajes,
    hitosDe: async (ids) => [...hs.values()].filter((h) => ids.includes(h.viajeId)).map((h) => ({ ...h })),
    configDe: async () => {
      if (o.config === 'ilegible') throw new Error('base caída');
      return { ...CONFIG_CONDUCTOR_DEFAULT, ...(o.config ?? {}) } as ConfigConductor;
    },
    sitiosDe: async (vs) => new Map(vs.map((v) => [v.id, o.sitios ?? SITIOS])),
    muestras: async (unidades) => new Map(unidades.map((u) => [`${u.tenantId}|${u.unidadId}`, o.muestras ?? []])),
    reclamar: async (c) => { llamadas.reclamar.push(c); return o.reclamo ?? 'ganado'; },
    completar: async (c) => { llamadas.completar.push(c); },
    liberar: async (c) => { llamadas.liberar.push(c); },
    aplicar: async (_v, h, d) => {
      llamadas.aplicar.push({ tipo: d.tipo, hito: h.id, omitir: d.omitir.map((x) => x.tipo), fueraDeOrden: d.fueraDeOrden });
      return o.aplicar ? o.aplicar(nAplicar++) : 'ok';
    },
  };
  return { puertos, llamadas };
}

describe('barridoCicloGps', () => {
  it('detecta la llegada, reclama ANTES de registrar y completa el claim al terminar', async () => {
    const w = mundo({ muestras: [FUERA(0), DENTRO(5), DENTRO(10)] });
    const r = await barridoCicloGps(w.puertos, AHORA);
    expect(r).toMatchObject({ viajes: 1, evaluados: 1, detectados: 1, llegadas: 1, salidas: 0, fallos: [] });
    expect(w.llamadas.reclamar).toHaveLength(1);
    expect(w.llamadas.reclamar[0]).toMatchObject({ viajeId: 'v1', hitoTipo: 'llegada_carga', tipo: 'entrada', geocercaId: 's-origen', detectadoEn: en(5) });
    expect(w.llamadas.aplicar).toEqual([{ tipo: 'llegada_carga', hito: 'v1-llegada_carga', omitir: [], fueraDeOrden: false }]);
    expect(w.llamadas.completar).toHaveLength(1);
  });

  it('entre dos barridos pudo pasar TODO: llegada y salida de la carga salen en la misma pasada, en orden', async () => {
    const w = mundo({ muestras: [DENTRO(0), DENTRO(5), FUERA(10), FUERA(15)] });
    const r = await barridoCicloGps(w.puertos, AHORA);
    expect(w.llamadas.aplicar.map((a) => a.tipo)).toEqual(['llegada_carga', 'salida_carga']);
    expect(r).toMatchObject({ detectados: 2, llegadas: 1, salidas: 1 });
  });

  it('la llegada que otra corrida ya reclamó (perdido): no registra nada y se cuenta', async () => {
    const w = mundo({ muestras: [DENTRO(0), DENTRO(5)], reclamo: 'perdido' });
    const r = await barridoCicloGps(w.puertos, AHORA);
    expect(r).toMatchObject({ detectados: 0, yaDetectados: 1 });
    expect(w.llamadas.aplicar).toHaveLength(0);
  });

  it('base sin la 0635 (sin_tabla): se registra igual, el candado es la transición condicional del hito', async () => {
    const w = mundo({ muestras: [DENTRO(0), DENTRO(5)], reclamo: 'sin_tabla' });
    const r = await barridoCicloGps(w.puertos, AHORA);
    expect(r.detectados).toBe(1);
  });

  it('si el claim no se pudo escribir, no se registra nada y se dice', async () => {
    const w = mundo({ muestras: [DENTRO(0), DENTRO(5)], reclamo: 'fallo' });
    const r = await barridoCicloGps(w.puertos, AHORA);
    expect(r.detectados).toBe(0);
    expect(r.fallos[0]).toMatch(/reclamo/);
    expect(w.llamadas.aplicar).toHaveLength(0);
  });

  it('si el hito no se pudo registrar (fallo), el claim se SUELTA para que la siguiente pasada lo reintente, y se dice', async () => {
    const w = mundo({ muestras: [DENTRO(0), DENTRO(5)], aplicar: () => 'fallo' });
    const r = await barridoCicloGps(w.puertos, AHORA);
    expect(r.detectados).toBe(0);
    expect(w.llamadas.liberar).toHaveLength(1);
    expect(w.llamadas.completar).toHaveLength(0);
    expect(r.fallos[0]).toMatch(/llegada_carga/);
  });

  it('si el chofer o la oficina llegaron primero (carrera), el claim se completa, NO cuenta como detección y se deja la siguiente pasada', async () => {
    const w = mundo({ muestras: [DENTRO(0), DENTRO(5), FUERA(10), FUERA(15)], aplicar: () => 'carrera' });
    const r = await barridoCicloGps(w.puertos, AHORA);
    expect(r.detectados).toBe(0);
    expect(w.llamadas.completar).toHaveLength(1);
    expect(w.llamadas.aplicar).toHaveLength(1);
  });

  it('la llegada al destino fuera de orden registra y pasa a omitidos los hitos anteriores', async () => {
    const w = mundo({ muestras: [FUERA(0, DESTINO), DENTRO(5, DESTINO), DENTRO(10, DESTINO)] });
    const r = await barridoCicloGps(w.puertos, AHORA);
    expect(w.llamadas.aplicar[0]).toMatchObject({ tipo: 'llegada_descarga', omitir: ['llegada_carga', 'salida_carga'], fueraDeOrden: true });
    expect(r.fueraDeOrden).toBe(1);
  });

  it('la flota que apagó la detección, o el agente apagado, no se toca (ni se leen sus muestras)', async () => {
    for (const cfg of [{ detectarHitosGps: false }, { activo: false }] as Array<Partial<ConfigConductor>>) {
      const w = mundo({ muestras: [DENTRO(0), DENTRO(5)], config: cfg });
      const r = await barridoCicloGps(w.puertos, AHORA);
      expect(r.detectados).toBe(0);
      expect(w.llamadas.reclamar).toHaveLength(0);
    }
  });

  it('una flota cuya config no se pudo leer se salta (no se opera con una estrategia que no se consultó)', async () => {
    const w = mundo({ muestras: [DENTRO(0), DENTRO(5)], config: 'ilegible' });
    const r = await barridoCicloGps(w.puertos, AHORA);
    expect(r.detectados).toBe(0);
    expect(w.llamadas.reclamar).toHaveLength(0);
  });

  it('sin unidad asignada o sin aceptar no hay GPS que comparar', async () => {
    const w = mundo({ viajes: [viajeBase({ id: 'v1', unidadId: null }), viajeBase({ id: 'v2', unidadId: 'u2', aceptadoEn: null })], muestras: [DENTRO(0), DENTRO(5)] });
    const r = await barridoCicloGps(w.puertos, AHORA);
    expect(r.evaluados).toBe(0);
  });

  it('un viaje sin sitio en ningún lado se cuenta como «sin sitio» y no pide muestras', async () => {
    const w = mundo({ muestras: [DENTRO(0), DENTRO(5)], sitios: { origen: null, destino: null } });
    const r = await barridoCicloGps(w.puertos, AHORA);
    expect(r.sinSitio).toBe(1);
    expect(r.detectados).toBe(0);
  });

  it('un viaje con los cuatro hitos ya resueltos no se vuelve a evaluar', async () => {
    const t = en(0).toISOString();
    const w = mundo({
      muestras: [DENTRO(0), DENTRO(5)],
      hitosPorViaje: { v1: { llegada_carga: resuelto(t), salida_carga: resuelto(t), llegada_descarga: resuelto(t), salida_descarga: resuelto(t) } },
    });
    const r = await barridoCicloGps(w.puertos, AHORA);
    expect(r.evaluados).toBe(0);
    expect(w.llamadas.reclamar).toHaveLength(0);
  });

  it('una muestra del FUTURO (reloj del GPS desfasado) no cuenta', async () => {
    const w = mundo({ muestras: [DENTRO(300), DENTRO(305)] });
    const r = await barridoCicloGps(w.puertos, AHORA);
    expect(r.sinMuestras).toBe(1);
    expect(r.detectados).toBe(0);
  });

  it('un viaje que revienta no tumba al resto del lote', async () => {
    const viajes = [viajeBase({ id: 'v1', unidadId: 'u1', aceptadoEn: aceptadoEn.toISOString() }), viajeBase({ id: 'v2', operadorId: 'o2', unidadId: 'u1', aceptadoEn: aceptadoEn.toISOString() })];
    const w = mundo({ viajes, muestras: [DENTRO(0), DENTRO(5)] });
    const original = w.puertos.reclamar;
    let n = 0;
    w.puertos.reclamar = async (c, ahora) => { if (n++ === 0) throw new Error('boom'); return original(c, ahora); };
    const r = await barridoCicloGps(w.puertos, AHORA);
    expect(r.fallos[0]).toMatch(/boom/);
    expect(r.detectados).toBe(1);
  });

  it('el reloj de la corrida corta el lote y lo dice', async () => {
    const w = mundo({ muestras: [DENTRO(0), DENTRO(5)] });
    const r = await barridoCicloGps(w.puertos, AHORA, Date.now() - 1);
    expect(r.cortadosPorReloj).toBe(1);
    expect(r.detectados).toBe(0);
  });
});
