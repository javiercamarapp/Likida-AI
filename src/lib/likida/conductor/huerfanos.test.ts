import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { CONFIG_CONDUCTOR_DEFAULT, type ConfigConductor } from './config';
import { barridoCicloGps, type ClaimCruce, type MuestraGps, type PuertosCicloGps, type SitioGps, type SitiosViaje } from './ciclo_gps';
import {
  barridoHuerfanos, detectarCrucesSinViaje, hitosDeCruce, huerfanosDelViaje, VENTANA_RECONCILIACION_H,
  type EventoHuerfano, type EventoNuevo, type PuertosHuerfanos, type UltimoCruce,
} from './huerfanos';
import { sinFlotasEnViajes } from './sin_flotas';
import { hitoVacio, viajeBase } from './memoria.fixture';
import { TIPOS_HITO, type HitoFila } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-66 — eventos de geocerca SIN viaje abierto: guardarlos como huérfanos y reconciliarlos.
// Requisito: d445f2d3 [43:28–46:50] (si lo cierran antes, «el sistema ya no encuentra un viaje abierto») y [43:56] (llegada y salida de
// carga, llegada y salida de destino y entrada al patio de la frontera, sin depender del CCP).
// Datos sintéticos: 0.001° de latitud ≈ 111 m.
// ═══════════════════════════════════════════════════════════════════════════

const T0 = new Date('2026-10-02T14:00:00.000Z');
const en = (min: number): Date => new Date(T0.getTime() + min * 60_000);
const ORIGEN: SitioGps = { id: 's-origen', nombre: 'Planta Demo', lat: 20.5, lng: -103.3, radioM: 300 };
const DESTINO: SitioGps = { id: 's-destino', nombre: 'Cedis Demo', lat: 25.7, lng: -100.3, radioM: 300 };
const PATIO: SitioGps = { id: 's-patio', nombre: 'Patio frontera Demo', lat: 27.5, lng: -99.5, radioM: 400 };
const DENTRO = (min: number, s: SitioGps = ORIGEN, despachoRef?: string): MuestraGps => ({ lat: s.lat + 0.001, lng: s.lng, medidaEn: en(min), despachoRef });
const FUERA = (min: number, s: SitioGps = ORIGEN): MuestraGps => ({ lat: s.lat + 0.03, lng: s.lng, medidaEn: en(min) });
const TOL = 150;
const sinUltimo = new Map<string, UltimoCruce>();

describe('detectarCrucesSinViaje — el cruce de un sitio es un cambio de estado', () => {
  const base = { tenantId: 't1', unidadId: 'u1', sitios: [ORIGEN], toleranciaM: TOL };

  it('una unidad sin viaje que VIENE de fuera y se queda dentro deja una ENTRADA huérfana (hora de la primera muestra, distancia al centro)', () => {
    const r = detectarCrucesSinViaje({ ...base, muestras: [FUERA(0), DENTRO(5), DENTRO(10)], ultimo: sinUltimo });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ tenantId: 't1', unidadId: 'u1', geocercaId: 's-origen', tipo: 'entrada', en: en(5) });
    expect(r[0].distanciaM).toBeGreaterThan(100);
  });

  it('pasar de largo (una sola muestra dentro) no es un cruce', () => {
    expect(detectarCrucesSinViaje({ ...base, muestras: [FUERA(0), DENTRO(5), FUERA(10)], ultimo: sinUltimo })).toEqual([]);
  });

  it('una unidad estacionada dentro desde antes de la ventana no «entra» (no hay cruce que probar)', () => {
    expect(detectarCrucesSinViaje({ ...base, muestras: [DENTRO(0), DENTRO(5), DENTRO(10)], ultimo: sinUltimo })).toEqual([]);
  });

  it('entrada y salida en la misma ventana: las dos, en orden', () => {
    const r = detectarCrucesSinViaje({ ...base, muestras: [FUERA(0), DENTRO(5), DENTRO(10), FUERA(15), FUERA(20)], ultimo: sinUltimo });
    expect(r.map((e) => [e.tipo, e.en])).toEqual([['entrada', en(5)], ['salida', en(15)]]);
  });

  it('IDEMPOTENTE: con la entrada ya guardada, la ventana que se desliza no la repite (aunque su primera muestra cambie)', () => {
    const ultimo = new Map<string, UltimoCruce>([['s-origen', { tipo: 'entrada', en: en(5) }]]);
    expect(detectarCrucesSinViaje({ ...base, muestras: [DENTRO(10), DENTRO(15), DENTRO(20)], ultimo })).toEqual([]);
    // aunque la ventana todavía vea la muestra de fuera de antes y «parezca» una entrada nueva a otra hora, el estado guardado manda
    expect(detectarCrucesSinViaje({ ...base, muestras: [FUERA(0), DENTRO(6), DENTRO(10)], ultimo })).toEqual([]);
  });

  it('con la entrada guardada, la salida llega como salida huérfana (y solo una vez)', () => {
    const ultimo = new Map<string, UltimoCruce>([['s-origen', { tipo: 'entrada', en: en(5) }]]);
    const r = detectarCrucesSinViaje({ ...base, muestras: [DENTRO(10), DENTRO(15), FUERA(20), FUERA(25)], ultimo });
    expect(r.map((e) => [e.tipo, e.en])).toEqual([['salida', en(20)]]);
    const ya = new Map<string, UltimoCruce>([['s-origen', { tipo: 'salida', en: en(20) }]]);
    expect(detectarCrucesSinViaje({ ...base, muestras: [DENTRO(10), DENTRO(15), FUERA(20), FUERA(25)], ultimo: ya })).toEqual([]);
  });

  it('tras una salida guardada, una nueva visita al sitio vuelve a dejar una entrada (después de la salida, nunca antes)', () => {
    const ultimo = new Map<string, UltimoCruce>([['s-origen', { tipo: 'salida', en: en(20) }]]);
    const r = detectarCrucesSinViaje({ ...base, muestras: [DENTRO(0), DENTRO(5), FUERA(20), FUERA(25), DENTRO(40), DENTRO(45)], ultimo });
    expect(r.map((e) => [e.tipo, e.en])).toEqual([['entrada', en(40)]]);
  });

  it('la entrada al PATIO de la frontera es un evento propio (cualquier sitio del catálogo, no solo el origen o el destino de un viaje)', () => {
    const r = detectarCrucesSinViaje({ ...base, sitios: [ORIGEN, PATIO], muestras: [FUERA(0, PATIO), DENTRO(5, PATIO), DENTRO(10, PATIO)], ultimo: sinUltimo });
    expect(r.map((e) => [e.geocercaId, e.tipo])).toEqual([['s-patio', 'entrada']]);
  });

  it('guarda la referencia de despacho de la muestra que prueba el cruce, si el proveedor la etiquetó', () => {
    const r = detectarCrucesSinViaje({ ...base, muestras: [FUERA(0), DENTRO(5, ORIGEN, 'D-77'), DENTRO(10, ORIGEN, 'D-77')], ultimo: sinUltimo });
    expect(r[0].despachoRef).toBe('D-77');
    expect(detectarCrucesSinViaje({ ...base, muestras: [FUERA(0), DENTRO(5), DENTRO(10)], ultimo: sinUltimo })[0].despachoRef).toBeNull();
  });
});

describe('hitosDeCruce y huerfanosDelViaje', () => {
  it('origen y destino distintos: la entrada al origen es la llegada a la carga, la salida del destino es la salida de la descarga', () => {
    const s: SitiosViaje = { origen: ORIGEN, destino: DESTINO };
    expect(hitosDeCruce({ geocercaId: 's-origen', tipo: 'entrada' }, s).map((h) => h.tipo)).toEqual(['llegada_carga']);
    expect(hitosDeCruce({ geocercaId: 's-origen', tipo: 'salida' }, s).map((h) => h.tipo)).toEqual(['salida_carga']);
    expect(hitosDeCruce({ geocercaId: 's-destino', tipo: 'entrada' }, s).map((h) => h.tipo)).toEqual(['llegada_descarga']);
    expect(hitosDeCruce({ geocercaId: 's-destino', tipo: 'salida' }, s).map((h) => h.tipo)).toEqual(['salida_descarga']);
    expect(hitosDeCruce({ geocercaId: 's-patio', tipo: 'entrada' }, s)).toEqual([]);
  });

  it('el mismo sitio de origen y destino: la entrada puede ser cualquiera de las dos llegadas, en el orden del viaje', () => {
    expect(hitosDeCruce({ geocercaId: 's-origen', tipo: 'entrada' }, { origen: ORIGEN, destino: { ...ORIGEN } }).map((h) => h.tipo)).toEqual(['llegada_carga', 'llegada_descarga']);
  });

  const ev = (o: Partial<EventoHuerfano>): EventoHuerfano => ({ id: 'e', tenantId: 't1', unidadId: 'u1', geocercaId: 's-origen', tipo: 'entrada', en: en(0), distanciaM: 10, despachoRef: null, ...o });
  const viaje = { tenantId: 't1', unidadId: 'u1', aceptadoEn: en(600).toISOString(), despachoRef: null as string | null };

  it('sin referencia, cuadra el de la ventana: hasta VENTANA_RECONCILIACION_H horas antes de aceptarse el viaje', () => {
    const dentro = ev({ id: 'a', en: new Date(en(600).getTime() - (VENTANA_RECONCILIACION_H - 1) * 3_600_000) });
    const fuera = ev({ id: 'b', en: new Date(en(600).getTime() - (VENTANA_RECONCILIACION_H + 1) * 3_600_000) });
    expect(huerfanosDelViaje(viaje, [fuera, dentro]).map((e) => e.id)).toEqual(['a']);
  });

  it('con la misma referencia de despacho cuadra aunque sea de hace días; con otra referencia, nunca', () => {
    const viejo = ev({ id: 'a', en: new Date(en(600).getTime() - 72 * 3_600_000), despachoRef: 'D-1' });
    const otro = ev({ id: 'b', en: en(590), despachoRef: 'D-2' });
    expect(huerfanosDelViaje({ ...viaje, despachoRef: 'D-1' }, [viejo, otro]).map((e) => e.id)).toEqual(['a']);
  });

  it('otra unidad u otra flota no cuadran', () => {
    expect(huerfanosDelViaje(viaje, [ev({ unidadId: 'u2', en: en(590) }), ev({ tenantId: 't2', en: en(590) })])).toEqual([]);
  });
});

// ── el barrido, con una «base» en memoria ───────────────────────────────────

const AHORA = en(60);
const aceptadoEn = en(-120);

function mundo(o: {
  flotas?: string[];
  config?: Partial<ConfigConductor>;
  muestras?: MuestraGps[];
  unidadesSinViaje?: Array<{ tenantId: string; unidadId: string }>;
  viajes?: Array<ReturnType<typeof viajeBase>>;
  sitiosViaje?: SitiosViaje;
  hitos?: Record<string, Partial<HitoFila>>;
  eventos?: EventoHuerfano[];
  catalogo?: SitioGps[];
} = {}) {
  const store: EventoHuerfano[] = [...(o.eventos ?? [])];
  let secuencia = 0;
  const viajes = o.viajes ?? [];
  const hs = new Map<string, HitoFila>();
  for (const v of viajes) for (const t of TIPOS_HITO) hs.set(`${v.id}|${t}`, hitoVacio({ id: `${v.id}-${t}`, viajeId: v.id, tipo: t, tenantId: v.tenantId, ...(o.hitos?.[t] ?? {}) }));
  const llamadas = {
    reclamar: [] as ClaimCruce[], completar: [] as ClaimCruce[], liberar: [] as ClaimCruce[],
    aplicar: [] as Array<{ viaje: string; tipo: string; en: Date; config: ConfigConductor }>, marcados: [] as Array<{ ids: string[]; viaje: string }>,
  };
  const reclamados = new Set<string>();
  const p: PuertosCicloGps = {
    viajes: async () => viajes,
    hitosDe: async (ids) => [...hs.values()].filter((h) => ids.includes(h.viajeId)).map((h) => ({ ...h })),
    configDe: async () => ({ ...CONFIG_CONDUCTOR_DEFAULT, ...(o.config ?? {}) } as ConfigConductor),
    sitiosDe: async (vs) => new Map(vs.map((v) => [v.id, o.sitiosViaje ?? { origen: ORIGEN, destino: DESTINO }])),
    muestras: async (unidades) => new Map(unidades.map((u) => [`${u.tenantId}|${u.unidadId}`, o.muestras ?? []])),
    reclamar: async (c) => {
      llamadas.reclamar.push(c);
      const k = `${c.viajeId}|${c.hitoTipo}`;
      if (reclamados.has(k)) return 'perdido';
      reclamados.add(k);
      return 'ganado';
    },
    completar: async (c) => { llamadas.completar.push(c); },
    liberar: async (c) => { llamadas.liberar.push(c); },
    aplicar: async (v, h, d, config) => {
      llamadas.aplicar.push({ viaje: v.id, tipo: d.tipo, en: d.detectadoEn, config });
      hs.set(`${v.id}|${h.tipo}`, { ...h, estado: 'validado', fuente: 'sistema' });
      return 'ok';
    },
    flotasConHuerfanos: async () => o.flotas ?? ['t1'],
  };
  const x: PuertosHuerfanos = {
    unidadesSinViaje: async () => o.unidadesSinViaje ?? [{ tenantId: 't1', unidadId: 'u1' }],
    sitiosDeFlotas: async () => new Map([['t1', o.catalogo ?? [ORIGEN, DESTINO, PATIO]]]),
    ultimosCruces: async () => {
      const m = new Map<string, Map<string, UltimoCruce>>();
      for (const e of [...store].sort((a, b) => a.en.getTime() - b.en.getTime())) {
        const k = `${e.tenantId}|${e.unidadId}`;
        m.set(k, (m.get(k) ?? new Map()).set(e.geocercaId, { tipo: e.tipo, en: e.en }));
      }
      return m;
    },
    guardar: async (nuevos: EventoNuevo[]) => {
      let n = 0;
      for (const e of nuevos) {
        if (store.some((s) => s.tenantId === e.tenantId && s.unidadId === e.unidadId && s.geocercaId === e.geocercaId && s.tipo === e.tipo && s.en.getTime() === e.en.getTime())) continue;
        store.push({ ...e, id: `h${++secuencia}` });
        n++;
      }
      return n;
    },
    pendientes: async () => store.filter((e) => !e.reconciliado),
    marcarReconciliados: async (_t, ids, viaje) => {
      llamadas.marcados.push({ ids, viaje });
      for (const e of store) if (ids.includes(e.id)) e.reconciliado = true;
    },
  };
  return { p, x, store, llamadas, hs };
}

// `reconciliado` solo existe en la «base» de la prueba (la tabla real lo lleva en `reconciliado_en`)
declare module './huerfanos' { interface EventoHuerfano { reconciliado?: boolean } }

describe('barridoHuerfanos — sin viaje abierto: guardar', () => {
  it('guarda el cruce de la unidad sin viaje y NO envía nada a nadie (no llama a aplicar, reclamar ni a la oficina)', async () => {
    const w = mundo({ muestras: [FUERA(0), DENTRO(5), DENTRO(10)] });
    const r = await barridoHuerfanos(w.p, w.x, AHORA);
    expect(r).toMatchObject({ flotas: 1, unidades: 1, guardados: 1, hitosCreados: 0, fallos: [] });
    expect(w.store).toHaveLength(1);
    expect(w.store[0]).toMatchObject({ tipo: 'entrada', geocercaId: 's-origen', unidadId: 'u1', tenantId: 't1', en: en(5) });
    expect(w.llamadas.aplicar).toEqual([]);
    expect(w.llamadas.reclamar).toEqual([]);
  });

  it('el mismo evento visto otra vez es IDEMPOTENTE: la segunda pasada no guarda nada nuevo', async () => {
    const w = mundo({ muestras: [FUERA(0), DENTRO(5), DENTRO(10)] });
    await barridoHuerfanos(w.p, w.x, AHORA);
    const r2 = await barridoHuerfanos(w.p, w.x, AHORA);
    expect(r2.guardados).toBe(0);
    expect(w.store).toHaveLength(1);
  });

  it('flota con la casilla apagada (ninguna flota habilitada): no lee ni guarda nada', async () => {
    const w = mundo({ flotas: [], muestras: [FUERA(0), DENTRO(5), DENTRO(10)] });
    const r = await barridoHuerfanos(w.p, w.x, AHORA);
    expect(r).toMatchObject({ flotas: 0, unidades: 0, guardados: 0 });
    expect(w.store).toEqual([]);
  });

  it('una flota con el Conductor apagado o sin detección por GPS tampoco se toca', async () => {
    for (const config of [{ activo: false }, { detectarHitosGps: false }]) {
      const w = mundo({ config, muestras: [FUERA(0), DENTRO(5), DENTRO(10)] });
      expect((await barridoHuerfanos(w.p, w.x, AHORA)).guardados).toBe(0);
    }
  });

  it('una unidad sin muestras no deja nada; el reloj agotado corta la pasada', async () => {
    const w = mundo({ muestras: [] });
    expect((await barridoHuerfanos(w.p, w.x, AHORA)).guardados).toBe(0);
    const w2 = mundo({ muestras: [FUERA(0), DENTRO(5), DENTRO(10)] });
    const r = await barridoHuerfanos(w2.p, w2.x, AHORA, Date.now() - 1);
    expect(r.guardados).toBe(0);
    expect(r.cortadosPorReloj).toBeGreaterThan(0);
  });

  it('si la base no contesta al guardar, el fallo queda registrado (no se finge que se guardó)', async () => {
    const w = mundo({ muestras: [FUERA(0), DENTRO(5), DENTRO(10)] });
    w.x.guardar = async () => { throw new Error('base caída'); };
    const r = await barridoHuerfanos(w.p, w.x, AHORA);
    expect(r.guardados).toBe(0);
    expect(r.fallos.join(' ')).toContain('base caída');
  });
});

describe('barridoHuerfanos — reconciliar cuando el viaje aparece', () => {
  const viaje = viajeBase({ id: 'v1', unidadId: 'u1', aceptadoEn: aceptadoEn.toISOString() });
  const eventosViejos = (): EventoHuerfano[] => [
    { id: 'e1', tenantId: 't1', unidadId: 'u1', geocercaId: 's-origen', tipo: 'entrada', en: en(-110), distanciaM: 42, despachoRef: null },
    { id: 'e2', tenantId: 't1', unidadId: 'u1', geocercaId: 's-origen', tipo: 'salida', en: en(-90), distanciaM: 900, despachoRef: null },
  ];

  it('un evento sin viaje se guarda y el viaje que aparece 2 h después recibe los hitos (por el camino del barrido en vivo, con reclamo) y los huérfanos quedan reconciliados', async () => {
    const w = mundo({ muestras: [FUERA(-130), DENTRO(-110), DENTRO(-105), FUERA(-90), FUERA(-85)], unidadesSinViaje: [{ tenantId: 't1', unidadId: 'u1' }] });
    // 1. todavía no hay viaje: se guardan entrada y salida
    const sinViaje = { ...w.p, viajes: async () => [] };
    const r1 = await barridoHuerfanos(sinViaje, w.x, en(-80));
    expect(r1.guardados).toBe(2);
    expect(r1.hitosCreados).toBe(0);
    // 2. el viaje aparece (importación del TMS / complemento): se aceptó a las -120 y la pasada corre 2 h después
    const w2 = mundo({ viajes: [viaje], eventos: w.store, unidadesSinViaje: [] });
    const r2 = await barridoHuerfanos(w2.p, w2.x, AHORA);
    expect(r2).toMatchObject({ hitosCreados: 2, reconciliados: 2, fallos: [] });
    expect(w2.llamadas.aplicar.map((a) => [a.viaje, a.tipo, a.en])).toEqual([['v1', 'llegada_carga', en(-110)], ['v1', 'salida_carga', en(-90)]]);
    expect(w2.llamadas.reclamar.map((c) => [c.hitoTipo, c.tipo])).toEqual([['llegada_carga', 'entrada'], ['salida_carga', 'salida']]);
    expect(w2.llamadas.completar).toHaveLength(2);
    expect(w2.llamadas.marcados).toEqual([{ ids: expect.arrayContaining([w.store[0].id, w.store[1].id]), viaje: 'v1' }]);
    expect(w2.store.every((e) => e.reconciliado)).toBe(true);
  });

  it('no duplica: una segunda pasada con los huérfanos ya reconciliados no registra nada más', async () => {
    const w = mundo({ viajes: [viaje], eventos: eventosViejos(), unidadesSinViaje: [] });
    await barridoHuerfanos(w.p, w.x, AHORA);
    const antes = w.llamadas.aplicar.length;
    const r = await barridoHuerfanos(w.p, w.x, AHORA);
    expect(antes).toBe(2);
    expect(w.llamadas.aplicar).toHaveLength(2);
    expect(r).toMatchObject({ hitosCreados: 0, reconciliados: 0, pendientes: 0 });
  });

  it('NO pisa lo que el chofer o la oficina ya dieron: el hito resuelto no se vuelve a registrar y el huérfano queda ligado igual', async () => {
    const w = mundo({ viajes: [viaje], eventos: eventosViejos(), unidadesSinViaje: [], hitos: {} });
    w.hs.set('v1|llegada_carga', hitoVacio({ id: 'v1-llegada_carga', viajeId: 'v1', tipo: 'llegada_carga', estado: 'recibido', fuente: 'boton' }));
    const r = await barridoHuerfanos(w.p, w.x, AHORA);
    expect(w.llamadas.aplicar.map((a) => a.tipo)).toEqual(['salida_carga']);
    expect(r).toMatchObject({ hitosCreados: 1, reconciliados: 2 });
  });

  it('el reclamo perdido (otra corrida ya detectó ese hito) no registra y liga el huérfano sin duplicar', async () => {
    const w = mundo({ viajes: [viaje], eventos: eventosViejos(), unidadesSinViaje: [] });
    w.p.reclamar = async () => 'perdido';
    const r = await barridoHuerfanos(w.p, w.x, AHORA);
    expect(w.llamadas.aplicar).toEqual([]);
    expect(r.reconciliados).toBe(2);
  });

  it('si no se pudo registrar el hito, se libera el reclamo y el huérfano SIGUE pendiente (se reintenta)', async () => {
    const w = mundo({ viajes: [viaje], eventos: eventosViejos(), unidadesSinViaje: [] });
    w.p.aplicar = async () => 'fallo';
    const r = await barridoHuerfanos(w.p, w.x, AHORA);
    expect(r.hitosCreados).toBe(0);
    expect(r.reconciliados).toBe(0);
    expect(w.llamadas.liberar.length).toBeGreaterThan(0);
    expect(w.store.some((e) => e.reconciliado)).toBe(false);
    expect(r.fallos.join(' ')).toContain('no se pudo registrar');
  });

  it('es relleno histórico: la oficina NO recibe aviso de una llegada de hace horas (se pasa la config sin avisos)', async () => {
    const w = mundo({ viajes: [viaje], eventos: eventosViejos(), unidadesSinViaje: [], config: { avisarOficinaLlegada: true, avisarOficinaSalida: true } });
    await barridoHuerfanos(w.p, w.x, AHORA);
    expect(w.llamadas.aplicar.length).toBeGreaterThan(0);
    for (const a of w.llamadas.aplicar) expect(a.config).toMatchObject({ avisarOficinaLlegada: false, avisarOficinaSalida: false });
  });

  it('el huérfano de un sitio que no es ni el origen ni el destino del viaje (el patio de la frontera) NO crea hito y queda como evento propio', async () => {
    const patio: EventoHuerfano = { id: 'p1', tenantId: 't1', unidadId: 'u1', geocercaId: 's-patio', tipo: 'entrada', en: en(-100), distanciaM: 30, despachoRef: null };
    const w = mundo({ viajes: [viaje], eventos: [patio], unidadesSinViaje: [] });
    const r = await barridoHuerfanos(w.p, w.x, AHORA);
    expect(w.llamadas.aplicar).toEqual([]);
    expect(r).toMatchObject({ hitosCreados: 0, reconciliados: 0, pendientes: 1 });
    expect(w.store[0].reconciliado).toBeUndefined();
  });

  it('fuera de la ventana (y sin referencia) un huérfano viejo no se pega al viaje nuevo de la misma unidad', async () => {
    const viejo: EventoHuerfano = { id: 'x1', tenantId: 't1', unidadId: 'u1', geocercaId: 's-origen', tipo: 'entrada', en: new Date(aceptadoEn.getTime() - 20 * 3_600_000), distanciaM: 1, despachoRef: null };
    const w = mundo({ viajes: [viaje], eventos: [viejo], unidadesSinViaje: [] });
    const r = await barridoHuerfanos(w.p, w.x, AHORA);
    expect(w.llamadas.aplicar).toEqual([]);
    expect(r.reconciliados).toBe(0);
  });

  it('un viaje de otra flota, o de una unidad distinta, no recibe huérfanos ajenos', async () => {
    const ajeno = viajeBase({ id: 'v9', tenantId: 't1', unidadId: 'u9', aceptadoEn: aceptadoEn.toISOString() });
    const w = mundo({ viajes: [ajeno], eventos: eventosViejos(), unidadesSinViaje: [] });
    const r = await barridoHuerfanos(w.p, w.x, AHORA);
    expect(w.llamadas.aplicar).toEqual([]);
    expect(r.hitosCreados).toBe(0);
  });

  it('con la flota apagada no se reconcilia nada aunque haya huérfanos pendientes', async () => {
    const w = mundo({ flotas: [], viajes: [viaje], eventos: eventosViejos(), unidadesSinViaje: [] });
    expect((await barridoHuerfanos(w.p, w.x, AHORA)).hitosCreados).toBe(0);
    expect(w.llamadas.aplicar).toEqual([]);
  });
});

describe('barridoCicloGps — la rama «sin viaje» está cableada al ciclo (la invoca el barrido del cron)', () => {
  it('después del barrido de viajes invoca el barrido de huérfanos con los mismos puertos y devuelve su resultado', async () => {
    const w = mundo({ muestras: [FUERA(0), DENTRO(5), DENTRO(10)] });
    const p: PuertosCicloGps = { ...w.p, huerfanos: (pp, ahora, venceEn) => barridoHuerfanos(pp, w.x, ahora, venceEn) };
    const r = await barridoCicloGps(p, AHORA);
    expect(r.huerfanos).toMatchObject({ flotas: 1, guardados: 1 });
    expect(w.store).toHaveLength(1);
  });

  it('sin puerto de huérfanos (o sin flotas) el resultado es el de siempre: sin campo huerfanos', async () => {
    const w = mundo();
    expect((await barridoCicloGps(w.p, AHORA)).huerfanos).toBeUndefined();
    const sinFlotas: PuertosCicloGps = { ...w.p, flotasConHuerfanos: async () => [], huerfanos: (pp, ahora, venceEn) => barridoHuerfanos(pp, w.x, ahora, venceEn) };
    expect((await barridoCicloGps(sinFlotas, AHORA)).huerfanos).toBeUndefined();
  });

  it('un fallo de la rama «sin viaje» NO tumba el barrido de viajes: queda en los fallos', async () => {
    const w = mundo();
    const p: PuertosCicloGps = { ...w.p, huerfanos: async () => { throw new Error('boom'); } };
    const r = await barridoCicloGps(p, AHORA);
    expect(r.fallos.join(' ')).toContain('boom');
  });

  it('las flotas con perfil («Próximamente») se saltan también aquí: sinFlotasEnViajes las quita de las habilitadas', async () => {
    const w = mundo({ flotas: ['t1', 't2'], muestras: [FUERA(0), DENTRO(5), DENTRO(10)] });
    const envuelto = sinFlotasEnViajes(w.p, new Set(['t1']));
    expect(await envuelto.flotasConHuerfanos!()).toEqual(['t2']);
    const sinNada = sinFlotasEnViajes(w.p, new Set(['t1', 't2']));
    const r = await barridoHuerfanos(sinNada, w.x, AHORA);
    expect(r.flotas).toBe(0);
    expect(w.store).toEqual([]);
  });
});
