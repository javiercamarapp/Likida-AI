import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
// El módulo real de aplicar importa Supabase y Meta por las cadenas de repo/avisos; aquí solo se ejercen las dependencias inyectadas.
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('no se toca la base en esta prueba'); } }));
vi.mock('./avisos_oficina', () => ({ avisarOficinaDeHito: vi.fn() }));

const { aplicarSalidaTms } = await import('./ciclo_gps_real');
import { barridoCicloGps, type ClaimCruce, type MuestraGps, type PuertosCicloGps, type SitioGps, type SitiosViaje } from './ciclo_gps';
import type { DepsAplicarDeteccion } from './ciclo_gps_real';
import { CONFIG_CONDUCTOR_DEFAULT, type ConfigConductor } from './config';
import { hitoVacio, viajeBase } from './memoria.fixture';
import { evaluarSalidaTms, gpsContradiceSalida, HOLGURA_SALIDA_TMS_MIN, textoSalidaTms } from './salida_tms';
import { TIPOS_HITO, type HitoFila, type TipoHito } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-22 — «Fecha Salida» del TMS como candidato a hito `salida_carga`. Todo sintético.
// Escenario de la foto del cliente, en forma: el TMS sella la salida a las 10:22:07 hora de México (16:22:07 UTC).
// ═══════════════════════════════════════════════════════════════════════════

const TZ = 'America/Mexico_City';
const MARCA = '2026-10-13T16:22:07.000Z'; // 10:22:07 en México
const hora = (hhmm: string): Date => new Date(`2026-10-13T${String(Number(hhmm.slice(0, 2)) + 6).padStart(2, '0')}:${hhmm.slice(3)}:00.000Z`); // hora local (UTC-6) → instante
const AHORA = hora('11:00');
const ORIGEN: SitioGps = { id: 's-origen', nombre: 'Planta Sintetica', lat: 20.5, lng: -103.3, radioM: 300 };
const DESTINO: SitioGps = { id: 's-destino', nombre: 'CEDIS Sintetico', lat: 25.7, lng: -100.3, radioM: 300 };
const DENTRO = (hhmm: string): MuestraGps => ({ lat: ORIGEN.lat + 0.001, lng: ORIGEN.lng, medidaEn: hora(hhmm) });
const FUERA = (hhmm: string): MuestraGps => ({ lat: ORIGEN.lat + 0.03, lng: ORIGEN.lng, medidaEn: hora(hhmm) });
const TOL = 150;

const pendiente = { estado: 'esperado' } as const;

const base = {
  tmsSalidaEn: MARCA, hito: pendiente, aplicar: false, sitioCarga: ORIGEN as SitioGps | null, toleranciaM: TOL, posiciones: [] as MuestraGps[], ahora: AHORA,
};

describe('evaluarSalidaTms — qué se hace con la marca del TMS', () => {
  it('sin marca: nada (y una marca ilegible tampoco cuenta)', () => {
    expect(evaluarSalidaTms({ ...base, tmsSalidaEn: null }).estado).toBe('sin_marca');
    expect(evaluarSalidaTms({ ...base, tmsSalidaEn: undefined }).estado).toBe('sin_marca');
    expect(evaluarSalidaTms({ ...base, tmsSalidaEn: 'no es fecha' }).estado).toBe('sin_marca');
  });

  it('una marca del futuro (reloj roto del TMS) no es creíble: se ignora', () => {
    expect(evaluarSalidaTms({ ...base, tmsSalidaEn: hora('11:30').toISOString() }).estado).toBe('sin_marca');
  });

  it('casilla apagada y sin contradicción: solo CANDIDATO, aunque el GPS la apoye', () => {
    expect(evaluarSalidaTms({ ...base, posiciones: [FUERA('10:20'), FUERA('10:30')] }).estado).toBe('candidato');
  });

  it('casilla encendida y el GPS ya estaba fuera desde 10:20: se APLICA', () => {
    const d = evaluarSalidaTms({ ...base, aplicar: true, posiciones: [FUERA('10:20'), FUERA('10:30')] });
    expect(d.estado).toBe('aplicar');
    expect(d.marca?.toISOString()).toBe(MARCA);
  });

  it('el TMS dice 10:22 pero el GPS sigue DENTRO hasta las 10:40: discrepancia visible y NO se aplica (con o sin casilla)', () => {
    const posiciones = [DENTRO('10:10'), DENTRO('10:30'), DENTRO('10:40')];
    expect(evaluarSalidaTms({ ...base, aplicar: true, posiciones }).estado).toBe('discrepancia');
    expect(evaluarSalidaTms({ ...base, aplicar: false, posiciones }).estado).toBe('discrepancia');
  });

  it('la holgura: una muestra dentro a los 5 min de la marca (retraso del GPS) NO la contradice; a los 6 sí', () => {
    expect(HOLGURA_SALIDA_TMS_MIN).toBe(5);
    const justo = new Date(new Date(MARCA).getTime() + 5 * 60_000);
    const pasado = new Date(new Date(MARCA).getTime() + 6 * 60_000);
    const dentroEn = (t: Date): MuestraGps => ({ lat: ORIGEN.lat + 0.001, lng: ORIGEN.lng, medidaEn: t });
    expect(gpsContradiceSalida(new Date(MARCA), ORIGEN, [dentroEn(justo)], TOL)).toBe(false);
    expect(gpsContradiceSalida(new Date(MARCA), ORIGEN, [dentroEn(pasado)], TOL)).toBe(true);
  });

  it('una muestra dentro ANTES de la marca no contradice (el tractor estaba ahí hasta salir)', () => {
    expect(evaluarSalidaTms({ ...base, aplicar: true, posiciones: [DENTRO('09:30'), DENTRO('10:00'), FUERA('10:30')] }).estado).toBe('aplicar');
  });

  it('un regreso al patio horas después no vuelve discrepante una salida vieja (ventana de 2 h)', () => {
    expect(evaluarSalidaTms({ ...base, ahora: hora('15:00'), aplicar: true, posiciones: [FUERA('10:30'), DENTRO('14:00')] }).estado).toBe('aplicar');
  });

  it('sin sitio de carga o sin muestras no hay con qué contradecir: se acepta la marca', () => {
    expect(evaluarSalidaTms({ ...base, aplicar: true, sitioCarga: null, posiciones: [DENTRO('10:40')] }).estado).toBe('aplicar');
    expect(evaluarSalidaTms({ ...base, aplicar: true, posiciones: [] }).estado).toBe('aplicar');
  });

  it('el hito que el chofer, la oficina o el GPS ya registraron NUNCA se pisa', () => {
    for (const estado of ['recibido', 'validado'] as const) {
      expect(evaluarSalidaTms({ ...base, aplicar: true, hito: { estado } }).estado).toBe('ya_registrada');
    }
  });

  it('sin hito pendiente (no existe o el perfil no lo sigue) no hay a qué proponer', () => {
    expect(evaluarSalidaTms({ ...base, aplicar: true, hito: undefined }).estado).toBe('sin_marca');
    expect(evaluarSalidaTms({ ...base, aplicar: true, hito: { estado: 'omitido' } }).estado).toBe('sin_marca');
  });

  it('un hito escalado (el chofer no contestó) sí admite la marca del TMS', () => {
    expect(evaluarSalidaTms({ ...base, aplicar: true, hito: { estado: 'escalado' } }).estado).toBe('aplicar');
  });
});

describe('textoSalidaTms', () => {
  it('candidato: la hora en la zona de la flota, sin segundos ni coordenadas', () => {
    expect(textoSalidaTms('candidato', new Date(MARCA), TZ, 'Planta Sintetica')).toBe('El TMS marca salida a las 10:22');
  });
  it('discrepancia: dice qué contradice el GPS y que no se registró', () => {
    const t = textoSalidaTms('discrepancia', new Date(MARCA), TZ, 'Planta Sintetica');
    expect(t).toContain('El TMS marca salida a las 10:22');
    expect(t).toContain('el GPS sigue dentro de Planta Sintetica');
    expect(t).toContain('No se registró');
  });
});

// ── El barrido: la casilla, el GPS y la idempotencia ────────────────────────

type Parcial = Partial<Record<TipoHito, Partial<HitoFila>>>;

function mundo(o: {
  config?: Partial<ConfigConductor>;
  marca?: string | null;
  marcasIlegibles?: boolean;
  muestras?: MuestraGps[];
  sitios?: SitiosViaje;
  hitos?: Parcial;
  aplicarSalida?: 'ok' | 'carrera' | 'fallo';
} = {}) {
  const viaje = viajeBase({ id: 'v1', unidadId: 'u1', aceptadoEn: hora('08:00').toISOString() });
  const hs = new Map<string, HitoFila>();
  for (const t of TIPOS_HITO) hs.set(t, hitoVacio({ id: `v1-${t}`, viajeId: 'v1', tipo: t, tenantId: 't1', ...(o.hitos?.[t] ?? {}) }));
  const llamadas = { salidasTms: 0, aplicarSalida: [] as Array<{ hito: string; marca: string }>, aplicarGps: [] as string[], reclamar: [] as ClaimCruce[] };
  const puertos: PuertosCicloGps = {
    viajes: async () => [viaje],
    hitosDe: async () => [...hs.values()].map((h) => ({ ...h })),
    configDe: async () => ({ ...CONFIG_CONDUCTOR_DEFAULT, activo: true, detectarHitosGps: true, ...(o.config ?? {}) }) as ConfigConductor,
    sitiosDe: async (vs) => new Map(vs.map((v) => [v.id, o.sitios ?? { origen: ORIGEN, destino: DESTINO }])),
    muestras: async (unidades) => new Map(unidades.map((u) => [`${u.tenantId}|${u.unidadId}`, o.muestras ?? []])),
    reclamar: async (c) => { llamadas.reclamar.push(c); return 'ganado'; },
    completar: async () => {},
    liberar: async () => {},
    aplicar: async (_v, h, d) => {
      llamadas.aplicarGps.push(d.tipo);
      hs.set(h.tipo, { ...h, estado: 'validado', fuente: 'sistema', validadoPor: 'gps' });
      return 'ok';
    },
    salidasTms: async () => {
      llamadas.salidasTms++;
      if (o.marcasIlegibles) return undefined;
      return o.marca === null ? new Map() : new Map([['v1', o.marca ?? MARCA]]);
    },
    aplicarSalidaTms: async (_v, h, marca) => {
      llamadas.aplicarSalida.push({ hito: h.tipo, marca: marca.toISOString() });
      const r = o.aplicarSalida ?? 'ok';
      if (r === 'ok') hs.set(h.tipo, { ...h, estado: 'validado', fuente: 'sistema', interpretacion: 'sistema', validadoPor: 'sistema', mensajeEn: marca.toISOString() });
      return r;
    },
  };
  return { puertos, llamadas, hs };
}

const casilla = { aplicarSalidaDelTms: true };
const llegadaYa: Parcial = { llegada_carga: { estado: 'recibido', fuente: 'texto', mensajeEn: hora('08:30').toISOString(), recibidoEn: hora('08:30').toISOString() } };

describe('barridoCicloGps — la marca del TMS bajo la casilla aplicarSalidaDelTms', () => {
  it('casilla APAGADA (la de fábrica): ni siquiera se lee la marca; solo la ve el tablero', async () => {
    expect(CONFIG_CONDUCTOR_DEFAULT.aplicarSalidaDelTms).toBe(false);
    const w = mundo({ muestras: [FUERA('10:20'), FUERA('10:30')], hitos: llegadaYa });
    const r = await barridoCicloGps(w.puertos, AHORA);
    expect(w.llamadas.salidasTms).toBe(0);
    expect(w.llamadas.aplicarSalida).toEqual([]);
    expect(r.salidasTmsAplicadas).toBe(0);
  });

  it('GPS fuera desde las 10:20 y casilla encendida: registra salida_carga con la hora del TMS, UNA vez', async () => {
    const w = mundo({ config: casilla, muestras: [FUERA('10:20'), FUERA('10:30')], hitos: llegadaYa });
    const r = await barridoCicloGps(w.puertos, AHORA);
    expect(w.llamadas.aplicarSalida).toEqual([{ hito: 'salida_carga', marca: MARCA }]);
    expect(r).toMatchObject({ salidasTmsAplicadas: 1, salidasTmsDiscrepantes: 0, fallos: [] });
    expect(w.llamadas.aplicarGps).toEqual([]);   // el GPS no tenía cómo probarla: sin muestras dentro no hay salida por geocerca
    expect(w.llamadas.reclamar).toEqual([]);     // no es un cruce de geocerca: no usa el claim
  });

  it('idempotente: una segunda pasada con el hito ya registrado no vuelve a aplicar', async () => {
    const w = mundo({ config: casilla, muestras: [FUERA('10:20'), FUERA('10:30')], hitos: llegadaYa });
    await barridoCicloGps(w.puertos, AHORA);
    const r2 = await barridoCicloGps(w.puertos, AHORA);
    expect(w.llamadas.aplicarSalida).toHaveLength(1);
    expect(r2.salidasTmsAplicadas).toBe(0);
  });

  it('el TMS dice 10:22 y el GPS sigue dentro hasta las 10:40: discrepancia contada y NO se registra nada', async () => {
    const w = mundo({ config: casilla, muestras: [DENTRO('10:10'), DENTRO('10:30'), DENTRO('10:40')], hitos: llegadaYa });
    const r = await barridoCicloGps(w.puertos, AHORA);
    expect(w.llamadas.aplicarSalida).toEqual([]);
    expect(r).toMatchObject({ salidasTmsAplicadas: 0, salidasTmsDiscrepantes: 1 });
  });

  it('el GPS que SÍ prueba la salida gana: el hito queda del GPS y la marca del TMS no lo pisa', async () => {
    const w = mundo({ config: casilla, muestras: [DENTRO('09:00'), DENTRO('09:10'), FUERA('10:20'), FUERA('10:30')], hitos: llegadaYa });
    const r = await barridoCicloGps(w.puertos, AHORA);
    expect(w.llamadas.aplicarGps).toEqual(['salida_carga']);
    expect(w.llamadas.aplicarSalida).toEqual([]);
    expect(r.salidasTmsAplicadas).toBe(0);
    expect(w.hs.get('salida_carga')?.validadoPor).toBe('gps');
  });

  it('lo que el chofer ya reportó nunca se pisa', async () => {
    const w = mundo({
      config: casilla, muestras: [FUERA('10:20'), FUERA('10:30')],
      hitos: { ...llegadaYa, salida_carga: { estado: 'recibido', fuente: 'texto', mensajeEn: hora('10:05').toISOString(), recibidoEn: hora('10:06').toISOString() } },
    });
    const r = await barridoCicloGps(w.puertos, AHORA);
    expect(w.llamadas.aplicarSalida).toEqual([]);
    expect(r.salidasTmsAplicadas).toBe(0);
  });

  it('sin una sola muestra de GPS (flota sin GPS) y sin sitio: la marca se acepta (no hay con qué contradecirla)', async () => {
    const w = mundo({ config: casilla, muestras: [], sitios: { origen: null, destino: null }, hitos: llegadaYa });
    const r = await barridoCicloGps(w.puertos, AHORA);
    expect(w.llamadas.aplicarSalida).toEqual([{ hito: 'salida_carga', marca: MARCA }]);
    expect(r.salidasTmsAplicadas).toBe(1);
  });

  it('la lectura de marcas caída: no se registra nada (no se actúa sobre lo que no se consultó)', async () => {
    const w = mundo({ config: casilla, marcasIlegibles: true, muestras: [FUERA('10:20')], hitos: llegadaYa });
    const r = await barridoCicloGps(w.puertos, AHORA);
    expect(w.llamadas.aplicarSalida).toEqual([]);
    expect(r.salidasTmsAplicadas).toBe(0);
  });

  it('un viaje sin marca del TMS no registra nada', async () => {
    const w = mundo({ config: casilla, marca: null, muestras: [FUERA('10:20')], hitos: llegadaYa });
    await barridoCicloGps(w.puertos, AHORA);
    expect(w.llamadas.aplicarSalida).toEqual([]);
  });

  it('otro llegó primero (carrera): no se cuenta como aplicada; un fallo se reporta', async () => {
    const w1 = mundo({ config: casilla, muestras: [FUERA('10:20')], hitos: llegadaYa, aplicarSalida: 'carrera' });
    const r1 = await barridoCicloGps(w1.puertos, AHORA);
    expect(r1).toMatchObject({ salidasTmsAplicadas: 0, fallos: [] });
    const w2 = mundo({ config: casilla, muestras: [FUERA('10:20')], hitos: llegadaYa, aplicarSalida: 'fallo' });
    const r2 = await barridoCicloGps(w2.puertos, AHORA);
    expect(r2.salidasTmsAplicadas).toBe(0);
    expect(r2.fallos).toHaveLength(1);
  });

  it('con el perfil que no sigue la salida (hito omitido) no hay a qué aplicar', async () => {
    const w = mundo({ config: casilla, muestras: [FUERA('10:20')], hitos: { ...llegadaYa, salida_carga: { estado: 'omitido', omitidoMotivo: 'fuera_de_perfil' } } });
    await barridoCicloGps(w.puertos, AHORA);
    expect(w.llamadas.aplicarSalida).toEqual([]);
  });
});

// ── Cómo se registra ────────────────────────────────────────────────────────

describe('aplicarSalidaTms — fuente, interpretación y validación «sistema», con la hora del TMS', () => {
  const viaje = viajeBase({ id: 'v1', unidadId: 'u1' });
  const hito = hitoVacio({ id: 'h-salida', viajeId: 'v1', tipo: 'salida_carga', tenantId: 't1' });
  const marca = new Date(MARCA);

  function deps(sobre: Partial<DepsAplicarDeteccion> = {}) {
    const llamadas: Record<string, unknown[][]> = { registrar: [], validar: [], evento: [], oficina: [], legado: [], veredicto: [] };
    const d: DepsAplicarDeteccion = {
      registrarHito: async (x) => { llamadas.registrar.push([x]); return 'ok'; },
      aplicarVeredicto: async (...a) => { llamadas.veredicto.push(a); return 'nuevo'; },
      validarHito: async (h, por) => { llamadas.validar.push([h, por]); return 'ok'; },
      sincronizarLegado: async (...a) => { llamadas.legado.push(a); },
      evento: async (h, e, det) => { llamadas.evento.push([h, e, det]); },
      avisarOficina: async (a) => { llamadas.oficina.push([a]); return 'enviado'; },
      ...sobre,
    };
    return { d, llamadas };
  }

  it('registra con fuente e interpretación «sistema», la hora del sello y valida por «sistema» (no por gps)', async () => {
    const { d, llamadas } = deps();
    const r = await aplicarSalidaTms(viaje, hito, marca, CONFIG_CONDUCTOR_DEFAULT, AHORA, d);
    expect(r).toBe('ok');
    expect(llamadas.registrar[0][0]).toMatchObject({ fuente: 'sistema', interpretacion: 'sistema', mensajeEn: marca, ahora: AHORA, waMessageId: null, texto: null, contacto: null, omitir: [] });
    expect(llamadas.validar[0][1]).toBe('sistema');
    expect(llamadas.evento[0][2]).toMatchObject({ fuente: 'sistema', por: 'tms' });
    expect(llamadas.veredicto).toHaveLength(0);
    expect(llamadas.legado).toHaveLength(0);
  });

  it('si el chofer o la oficina llegaron primero (carrera) no valida, no sella y no avisa', async () => {
    const { d, llamadas } = deps({ registrarHito: async () => 'carrera' });
    expect(await aplicarSalidaTms(viaje, hito, marca, CONFIG_CONDUCTOR_DEFAULT, AHORA, d)).toBe('carrera');
    expect(llamadas.validar).toHaveLength(0);
    expect(llamadas.evento).toHaveLength(0);
  });

  it('un fallo al escribir se dice como fallo', async () => {
    const { d } = deps({ registrarHito: async () => 'fallo' });
    expect(await aplicarSalidaTms(viaje, hito, marca, CONFIG_CONDUCTOR_DEFAULT, AHORA, d)).toBe('fallo');
  });

  it('avisa a la oficina solo si la flota pidió el aviso de salida', async () => {
    const a = deps();
    await aplicarSalidaTms(viaje, hito, marca, CONFIG_CONDUCTOR_DEFAULT, AHORA, a.d);
    expect(a.llamadas.oficina).toHaveLength(0);
    const b = deps();
    await aplicarSalidaTms(viaje, hito, marca, { ...CONFIG_CONDUCTOR_DEFAULT, avisarOficinaSalida: true }, AHORA, b.d);
    expect(b.llamadas.oficina).toHaveLength(1);
  });
});
