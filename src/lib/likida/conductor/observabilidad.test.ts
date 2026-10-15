import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));

import { logger } from '@/lib/logger';
import { CONFIG_CONDUCTOR_DEFAULT, type ConfigConductor } from './config';
import { barridoCicloGps, type ClaimCruce, type MuestraGps, type PuertosCicloGps, type SitioGps, type SitiosViaje } from './ciclo_gps';
import { correrConductor } from './ejecutor';
import { alarmasConductor, contadoresConductor } from './observabilidad';
import { crearPuertos, hitoVacio, viajeBase } from './memoria.fixture';
import { TIPOS_HITO, type HitoFila } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-27 — observabilidad mínima del Conductor: contadores exactos (mundo en memoria), las dos alarmas y cero PII. Todo sintético.
// ═══════════════════════════════════════════════════════════════════════════

const mx = (hhmm: string, dia = '2026-10-02') => new Date(`${dia}T${hhmm}:00-06:00`);
/** Lo que NO puede aparecer en un log ni en el latido: teléfonos (7+ dígitos seguidos) y coordenadas (decimales largos). */
const PII = /\d{7,}|-?\d{1,3}\.\d{3,}/;

describe('el motor cuenta los viajes en seguimiento por origen', () => {
  it('chofer / importación / otro, con valores exactos', async () => {
    const viajes = [
      viajeBase({ id: 'v1', operadorId: 'o1', aceptadoOrigen: 'chofer', citaOrigenEn: mx('08:00').toISOString() }),
      viajeBase({ id: 'v2', operadorId: 'o2', aceptadoOrigen: 'importacion', citaOrigenEn: mx('08:00').toISOString() }),
      viajeBase({ id: 'v3', operadorId: 'o3', aceptadoOrigen: 'importacion', citaOrigenEn: mx('08:00').toISOString() }),
      viajeBase({ id: 'v4', operadorId: 'o4', aceptadoOrigen: null, citaOrigenEn: mx('08:00').toISOString() }),
    ];
    const hitos = viajes.flatMap((v) => TIPOS_HITO.map((tipo, i) => hitoVacio({ id: `${v.id}-${i}`, tipo, viajeId: v.id, tenantId: 't1' })));
    const m = crearPuertos({ viajes, hitos });
    const r = await correrConductor(m.puertos, { ahora: mx('07:30') });
    expect(r.viajes).toBe(4);
    expect(r.viajesPorOrigen).toEqual({ chofer: 1, importacion: 2, otro: 1 });
    expect(r.solicitudes).toBeGreaterThan(0); // la medida no es nula: el motor sí mandó
    const c = contadoresConductor({ motor: r, voluntariosActivos: 3 });
    expect(c).toMatchObject({ viajesEnSeguimiento: 4, viajesPorOrigen: { chofer: 1, importacion: 2, otro: 1 }, avisosEnviados: r.solicitudes + r.recordatorios + r.escalaciones, voluntariosActivos: 3 });
  });
});

describe('contadoresConductor — la suma exacta', () => {
  it('junta motor, GPS y señal de vida', () => {
    const c = contadoresConductor({
      motor: { viajes: 7, viajesPorOrigen: { chofer: 3, importacion: 4, otro: 0 }, solicitudes: 2, recordatorios: 1, escalaciones: 1, rechazosReintentables: 2 },
      gps: { detectados: 5, sinSitio: 2, sinMuestras: 3, detectadosViaDespacho: 4, detectadosViaUnidadVentana: 1, unidadesConsultadas: 6, unidadesSinPosicion: 2 },
      senalVida: { avisosChofer: 3, escalaciones: 1, rechazosReintentables: 1 },
      voluntariosActivos: 5,
    });
    expect(c).toEqual({
      viajesEnSeguimiento: 7, viajesPorOrigen: { chofer: 3, importacion: 4, otro: 0 }, avisosEnviados: 8, rechazosMeta: 3,
      hitosPorGps: 5, hitosViaDespacho: 4, hitosViaUnidadVentana: 1, viajesSinSitio: 2, viajesSinGps: 3,
      voluntariosActivos: 5, unidadesEnTransito: 6, unidadesSinPosicion: 2,
    });
    expect(JSON.stringify(c)).not.toMatch(PII);
  });
});

describe('las dos alarmas', () => {
  const base = { motor: { viajes: 0, solicitudes: 0, recordatorios: 0, escalaciones: 0, rechazosReintentables: 0 } };
  it('0 viajes en seguimiento teniendo voluntarios → alarma', () => {
    expect(alarmasConductor(contadoresConductor({ ...base, voluntariosActivos: 2 }))).toEqual(['sin_viajes_con_voluntarios']);
  });
  it('sin voluntarios, o sin saber cuántos hay, no alarma', () => {
    expect(alarmasConductor(contadoresConductor({ ...base, voluntariosActivos: 0 }))).toEqual([]);
    expect(alarmasConductor(contadoresConductor({ ...base, voluntariosActivos: null }))).toEqual([]);
  });
  it('con viajes en seguimiento no alarma por esa causa', () => {
    expect(alarmasConductor(contadoresConductor({ motor: { ...base.motor, viajes: 1 }, voluntariosActivos: 2 }))).toEqual([]);
  });
  it('más de la mitad de las unidades sin posición → alarma; justo la mitad no', () => {
    const g = (sin: number) => contadoresConductor({ ...base, voluntariosActivos: 0, gps: { detectados: 0, sinSitio: 0, sinMuestras: 0, unidadesConsultadas: 4, unidadesSinPosicion: sin } });
    expect(alarmasConductor(g(3))).toEqual(['flota_sin_posicion']);
    expect(alarmasConductor(g(2))).toEqual([]);
  });
});

// ── el ciclo por GPS: la vía y las unidades sin posición ──────────────────────────────────────────────
const T0 = new Date('2026-10-02T14:00:00.000Z');
const en = (min: number): Date => new Date(T0.getTime() + min * 60_000);
const AHORA = en(60);
const ORIGEN: SitioGps = { id: 's-origen', nombre: 'Planta Demo', lat: 20.5, lng: -103.3, radioM: 300 };
const DESTINO: SitioGps = { id: 's-destino', nombre: 'CEDIS Demo', lat: 25.7, lng: -100.3, radioM: 300 };
const SITIOS: SitiosViaje = { origen: ORIGEN, destino: DESTINO };
const dentro = (min: number, ref?: string): MuestraGps => ({ lat: ORIGEN.lat + 0.001, lng: ORIGEN.lng, medidaEn: en(min), ...(ref ? { despachoRef: ref } : {}) });
const lejos = (min: number): MuestraGps => ({ lat: ORIGEN.lat + 0.03, lng: ORIGEN.lng, medidaEn: en(min) });

function mundoGps(viajes: Array<ReturnType<typeof viajeBase>>, muestrasPorUnidad: Record<string, MuestraGps[]>, sitios: (id: string) => SitiosViaje | undefined = () => SITIOS) {
  const hs: HitoFila[] = viajes.flatMap((v) => TIPOS_HITO.map((t) => hitoVacio({ id: `${v.id}-${t}`, viajeId: v.id, tipo: t, tenantId: v.tenantId })));
  const puertos: PuertosCicloGps = {
    viajes: async () => viajes,
    hitosDe: async (ids) => hs.filter((h) => ids.includes(h.viajeId)),
    configDe: async () => ({ ...CONFIG_CONDUCTOR_DEFAULT } as ConfigConductor),
    sitiosDe: async (vs) => new Map(vs.flatMap((v) => { const s = sitios(v.id); return s ? [[v.id, s] as const] : []; })),
    muestras: async (us) => new Map(us.map((u) => [`${u.tenantId}|${u.unidadId}`, muestrasPorUnidad[u.unidadId] ?? []])),
    reclamar: async (_c: ClaimCruce) => 'ganado',
    completar: async () => {},
    liberar: async () => {},
    aplicar: async () => 'ok',
  };
  return puertos;
}
const aceptado = en(-120).toISOString();

describe('barridoCicloGps — contadores de observabilidad', () => {
  it('cuenta la vía de cada hito detectado y las unidades sin posición reciente (valores exactos)', async () => {
    const viajes = [
      viajeBase({ id: 'vD', operadorId: 'o1', unidadId: 'uD', despachoRef: 'D1', aceptadoEn: aceptado }),
      viajeBase({ id: 'vU', operadorId: 'o2', unidadId: 'uU', aceptadoEn: aceptado }),
      viajeBase({ id: 'vC', operadorId: 'o3', unidadId: 'uC', aceptadoEn: aceptado }), // GPS viejo (hace 50 min) → sin posición reciente
    ];
    const r = await barridoCicloGps(mundoGps(viajes, {
      uD: [lejos(40), dentro(50, 'D1'), dentro(55, 'D1')],
      uU: [lejos(40), dentro(50), dentro(58)],
      uC: [lejos(0), lejos(10)],
    }), AHORA);
    expect(r.detectados).toBe(2);
    expect(r.detectadosViaDespacho).toBe(1);
    expect(r.detectadosViaUnidadVentana).toBe(1);
    expect(r.unidadesConsultadas).toBe(3);
    expect(r.unidadesSinPosicion).toBe(1);
  });

  it('cuenta los viajes sin sitio y los sin GPS', async () => {
    const viajes = [
      viajeBase({ id: 'vS', operadorId: 'o1', unidadId: 'u1', aceptadoEn: aceptado }),
      viajeBase({ id: 'vG', operadorId: 'o2', unidadId: 'u2', aceptadoEn: aceptado }),
    ];
    const r = await barridoCicloGps(mundoGps(viajes, { u2: [] }, (id) => (id === 'vS' ? undefined : SITIOS)), AHORA);
    expect(r.sinSitio).toBe(1);
    expect(r.sinMuestras).toBe(1);
    expect(r.unidadesConsultadas).toBe(1);
    expect(r.unidadesSinPosicion).toBe(1); // una unidad sin una sola muestra también está sin posición
  });
});

describe('cero PII en el log del barrido', () => {
  it('lo que el ciclo escribe en el log no trae teléfonos ni coordenadas', async () => {
    const viajes = [viajeBase({ id: 'vD', operadorId: 'o1', unidadId: 'uD', despachoRef: 'D1', aceptadoEn: aceptado })];
    await barridoCicloGps(mundoGps(viajes, { uD: [lejos(40), dentro(50, 'D1'), dentro(55, 'D1')] }), AHORA);
    const llamadas = [...vi.mocked(logger.info).mock.calls, ...vi.mocked(logger.warn).mock.calls, ...vi.mocked(logger.error).mock.calls];
    expect(llamadas.length).toBeGreaterThan(0);
    for (const l of llamadas) expect(JSON.stringify(l)).not.toMatch(PII);
  });
});
