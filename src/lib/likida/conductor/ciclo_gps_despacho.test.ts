import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { logger } from '@/lib/logger';
import { CONFIG_CONDUCTOR_DEFAULT, type ConfigConductor } from './config';
import { barridoCicloGps, muestrasDeViaje, type ClaimCruce, type MuestraGps, type PuertosCicloGps, type SitioGps, type SitiosViaje } from './ciclo_gps';
import { filaAViajeCtx } from './repo';
import { hitoVacio, viajeBase } from './memoria.fixture';
import { TIPOS_HITO, type HitoFila } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-14 — el vínculo por despacho (`despacho_ref`) manda sobre «unidad + ventana». Todo sintético.
// ═══════════════════════════════════════════════════════════════════════════

const T0 = new Date('2026-10-02T14:00:00.000Z');
const en = (min: number): Date => new Date(T0.getTime() + min * 60_000);
const AHORA = en(30);
const ORIGEN: SitioGps = { id: 's-origen', nombre: 'Planta Demo', lat: 20.5, lng: -103.3, radioM: 300 };
const DESTINO: SitioGps = { id: 's-destino', nombre: 'CEDIS Demo', lat: 25.7, lng: -100.3, radioM: 300 };
const SITIOS: SitiosViaje = { origen: ORIGEN, destino: DESTINO };
const dentro = (min: number, ref?: string | null): MuestraGps => ({ lat: ORIGEN.lat + 0.001, lng: ORIGEN.lng, medidaEn: en(min), ...(ref !== undefined ? { despachoRef: ref } : {}) });
const fuera = (min: number, ref?: string | null): MuestraGps => ({ lat: ORIGEN.lat + 0.03, lng: ORIGEN.lng, medidaEn: en(min), ...(ref !== undefined ? { despachoRef: ref } : {}) });

function mundo(viajes: Array<ReturnType<typeof viajeBase>>, muestras: MuestraGps[]) {
  const hs = new Map<string, HitoFila>();
  for (const v of viajes) for (const t of TIPOS_HITO) hs.set(`${v.id}|${t}`, hitoVacio({ id: `${v.id}-${t}`, viajeId: v.id, tipo: t, tenantId: v.tenantId }));
  const aplicar: string[] = [];
  const reclamar: ClaimCruce[] = [];
  const puertos: PuertosCicloGps = {
    viajes: async () => viajes,
    hitosDe: async (ids) => [...hs.values()].filter((h) => ids.includes(h.viajeId)).map((h) => ({ ...h })),
    configDe: async () => ({ ...CONFIG_CONDUCTOR_DEFAULT } as ConfigConductor),
    sitiosDe: async (vs) => new Map(vs.map((v) => [v.id, SITIOS])),
    muestras: async (us) => new Map(us.map((u) => [`${u.tenantId}|${u.unidadId}`, muestras])),
    reclamar: async (c) => { reclamar.push(c); return 'ganado'; },
    completar: async () => {},
    liberar: async () => {},
    aplicar: async (_v, h) => { aplicar.push(h.id); return 'ok'; },
  };
  return { puertos, aplicar, reclamar };
}

const viajeA = (extra: Partial<ReturnType<typeof viajeBase>> = {}) => viajeBase({ id: 'vA', unidadId: 'u1', aceptadoEn: en(-120).toISOString(), ...extra });
const viajeB = (extra: Partial<ReturnType<typeof viajeBase>> = {}) => viajeBase({ id: 'vB', operadorId: 'o2', unidadId: 'u1', aceptadoEn: en(-60).toISOString(), ...extra });

describe('muestrasDeViaje — la elección pura', () => {
  const ms = [dentro(0, 'D1'), dentro(5, 'D2'), dentro(10, null), dentro(15)];

  it('con referencia y muestras con ella: solo esas, vía despacho', () => {
    const r = muestrasDeViaje('D2', ms);
    expect(r.via).toBe('despacho');
    expect(r.muestras).toEqual([ms[1]]);
  });
  it('con referencia pero sin muestras con ella: todas las de la unidad, vía unidad_ventana', () => {
    const r = muestrasDeViaje('D9', ms);
    expect(r.via).toBe('unidad_ventana');
    expect(r.muestras).toBe(ms);
  });
  it('sin referencia (null/undefined/vacía): idéntico a hoy', () => {
    for (const ref of [null, undefined, '']) expect(muestrasDeViaje(ref, ms)).toEqual({ muestras: ms, via: 'unidad_ventana' });
  });
});

describe('barridoCicloGps — despacho sobre unidad + ventana', () => {
  it('mismo tractor, viaje A (D1) y viaje B (D2) seguidos: las muestras de D2 NO cierran el hito del viaje A', async () => {
    // A vigente (D1) solo tiene muestras fuera; el tractor ya está cargando el viaje B (D2) en la planta.
    const w = mundo([viajeA({ despachoRef: 'D1' }), viajeB({ despachoRef: 'D2' })], [fuera(0, 'D1'), fuera(5, 'D1'), dentro(8, 'D2'), dentro(12, 'D2')]);
    await barridoCicloGps(w.puertos, AHORA);
    expect(w.aplicar).toEqual(['vB-llegada_carga']);
    expect(w.reclamar.map((c) => c.viajeId)).toEqual(['vB']);
  });

  it('el viaje vigente con referencia solo usa las suyas aunque la unidad tenga otras dentro del sitio', async () => {
    const w = mundo([viajeA({ despachoRef: 'D1' })], [fuera(0, 'D1'), fuera(5, 'D1'), dentro(8, 'D2'), dentro(12, 'D2')]);
    const r = await barridoCicloGps(w.puertos, AHORA);
    expect(w.aplicar).toEqual([]);
    expect(r).toMatchObject({ evaluados: 1, detectados: 0 });
  });

  it('viaje sin despachoRef: idéntico a hoy (todas las muestras de la unidad, un solo viaje por unidad)', async () => {
    const w = mundo([viajeA(), viajeB()], [fuera(0, 'D2'), dentro(5, 'D2'), dentro(10, 'D2')]);
    const r = await barridoCicloGps(w.puertos, AHORA);
    expect(w.aplicar).toEqual(['vA-llegada_carga']);
    expect(r).toMatchObject({ detectados: 1, cedidosAOtroViaje: 1 });
    expect(logger.info).toHaveBeenCalledWith('conductor.ciclo_gps_deteccion', { viaje: 'vA', hito: 'llegada_carga', via: 'unidad_ventana' });
  });

  it('viaje con despachoRef y sin muestras con despacho: respaldo a unidad + ventana, y la vía queda en el log', async () => {
    const w = mundo([viajeA({ despachoRef: 'D1' })], [fuera(0), dentro(5), dentro(10)]);
    const r = await barridoCicloGps(w.puertos, AHORA);
    expect(w.aplicar).toEqual(['vA-llegada_carga']);
    expect(r.detectados).toBe(1);
    expect(logger.info).toHaveBeenCalledWith('conductor.ciclo_gps_deteccion', { viaje: 'vA', hito: 'llegada_carga', via: 'unidad_ventana' });
  });

  it('con despacho la vía registrada es despacho', async () => {
    const w = mundo([viajeA({ despachoRef: 'D1' })], [fuera(0, 'D1'), dentro(5, 'D1'), dentro(10, 'D1')]);
    await barridoCicloGps(w.puertos, AHORA);
    expect(w.aplicar).toEqual(['vA-llegada_carga']);
    expect(logger.info).toHaveBeenCalledWith('conductor.ciclo_gps_deteccion', { viaje: 'vA', hito: 'llegada_carga', via: 'despacho' });
  });
});

describe('repo — el viaje trae su despacho_ref', () => {
  it('filaAViajeCtx lo lee; ausente o vacío es null', () => {
    const base = { id: 'v', tenant_id: 't', estatus: 'abierto', operador_id: 'o' };
    expect(filaAViajeCtx({ ...base, despacho_ref: 'D1' }).despachoRef).toBe('D1');
    expect(filaAViajeCtx(base).despachoRef).toBeNull();
  });
});
