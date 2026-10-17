import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));

const { puedeEscribirAlChofer, MIN_MUESTRAS_DETENIDA, VELOCIDAD_MARCHA_KMH } = await import('./compuerta_movimiento');
const { haversineM } = await import('./geo');
const { CONFIG_CONDUCTOR_DEFAULT, validarConfigConductor } = await import('./config');
const { correrConductor } = await import('./ejecutor');
const { correrAlertasEstadia } = await import('./alertas_estadia');
const { barridoSenalVida } = await import('./senal_vida');
const { crearPuertos, hitoVacio, viajeBase } = await import('./memoria.fixture');
const { TIPOS_HITO } = await import('./tipos');
type Muestra = import('./ciclo_gps').MuestraGps;
type Sitios = import('./ciclo_gps').SitiosViaje;
type Config = import('./config').ConfigConductor;
type Hito = import('./tipos').HitoFila;
type Ejec = import('./ejecutor').PuertosConductor;
type PuertosSV = import('./senal_vida').PuertosSenalVida;

// Todo es sintético: coordenadas inventadas, ningún dato real.
const LAT = 20.7;
const LNG = -103.4;
/** ≈ 111 m por milésima de grado de latitud. */
const grados = (metros: number): number => metros / 111_195;
const AHORA = new Date('2026-10-02T14:30:00.000Z'); // 08:30 en México, viernes, dentro de la ventana 06–22
const hace = (seg: number, ahora = AHORA): Date => new Date(ahora.getTime() - seg * 1000);
const M = (seg: number, desplazaM = 0, extra: Partial<Muestra> = {}): Muestra => ({ lat: LAT + grados(desplazaM), lng: LNG, medidaEn: hace(seg), ...extra });
const ENCENDIDA = { compuertaMovimientoActiva: true } as const;
/** Tres muestras quietas en los últimos 5 min (cadencia de 2 min). */
const QUIETA = [M(240), M(120), M(5)];
const SIN_SITIOS: Sitios = { origen: null, destino: null };
const sitio = (id: string, radioM = 500) => ({ id, nombre: id, lat: LAT, lng: LNG, radioM });

describe('puedeEscribirAlChofer — la función pura', () => {
  it('apagada (por omisión) todo pasa igual que siempre, aunque la unidad vaya rodando', () => {
    const rodando = [M(240, 0), M(120, 300), M(5, 900)];
    expect(puedeEscribirAlChofer({ posiciones: rodando, sitioDelViaje: null, config: {}, ahora: AHORA })).toEqual({ permitido: true, razon: 'compuerta_apagada' });
    expect(puedeEscribirAlChofer({ posiciones: [], sitioDelViaje: null, config: { compuertaMovimientoActiva: false }, ahora: AHORA }).permitido).toBe(true);
    expect(CONFIG_CONDUCTOR_DEFAULT.compuertaMovimientoActiva).toBe(false);
    expect(CONFIG_CONDUCTOR_DEFAULT.detenidaMetros).toBe(150);
    expect(CONFIG_CONDUCTOR_DEFAULT.detenidaVentanaMin).toBe(5);
    expect(CONFIG_CONDUCTOR_DEFAULT.sinGpsPermite).toBe(false);
  });

  it('desplazamiento > 150 m en 5 min: NO escribe', () => {
    const r = puedeEscribirAlChofer({ posiciones: [M(240, 0), M(120, 100), M(5, 180)], sitioDelViaje: null, config: ENCENDIDA, ahora: AHORA });
    expect(r).toEqual({ permitido: false, razon: 'en_movimiento' });
  });

  it('exactamente en el límite todavía es «detenida»; un centímetro más, en marcha', () => {
    const muestras = [M(240, 0), M(120, 0), M(5, 150)];
    const d = haversineM(muestras[0], muestras[2]);
    const justo = puedeEscribirAlChofer({ posiciones: muestras, sitioDelViaje: null, config: { ...ENCENDIDA, detenidaMetros: d }, ahora: AHORA });
    expect(justo).toEqual({ permitido: true, razon: 'detenida' });
    const pasado = puedeEscribirAlChofer({ posiciones: muestras, sitioDelViaje: null, config: { ...ENCENDIDA, detenidaMetros: d - 0.01 }, ahora: AHORA });
    expect(pasado).toEqual({ permitido: false, razon: 'en_movimiento' });
  });

  it('≥ 3 muestras consecutivas quietas: escribe; solo 2: no', () => {
    expect(MIN_MUESTRAS_DETENIDA).toBe(3);
    expect(puedeEscribirAlChofer({ posiciones: QUIETA, sitioDelViaje: null, config: ENCENDIDA, ahora: AHORA })).toEqual({ permitido: true, razon: 'detenida' });
    expect(puedeEscribirAlChofer({ posiciones: [M(120), M(5)], sitioDelViaje: null, config: ENCENDIDA, ahora: AHORA })).toEqual({ permitido: false, razon: 'pocas_muestras' });
  });

  it('una muestra fuera de la ventana de 5 min no cuenta como muestra quieta', () => {
    const r = puedeEscribirAlChofer({ posiciones: [M(900), M(600), M(120), M(5)], sitioDelViaje: null, config: ENCENDIDA, ahora: AHORA });
    expect(r).toEqual({ permitido: false, razon: 'pocas_muestras' });
  });

  it('sin GPS reciente: NO escribe; con `sinGpsPermite` sí', () => {
    expect(puedeEscribirAlChofer({ posiciones: [], sitioDelViaje: null, config: ENCENDIDA, ahora: AHORA })).toEqual({ permitido: false, razon: 'sin_gps' });
    // la última muestra es de hace 20 min: no es «reciente»
    expect(puedeEscribirAlChofer({ posiciones: [M(1200)], sitioDelViaje: null, config: ENCENDIDA, ahora: AHORA }).razon).toBe('sin_gps');
    expect(puedeEscribirAlChofer({ posiciones: [], sitioDelViaje: null, config: { ...ENCENDIDA, sinGpsPermite: true }, ahora: AHORA })).toEqual({ permitido: true, razon: 'sin_gps_permitido' });
  });

  it('dentro del sitio del viaje queda exenta aunque el GPS impreciso «baile» más de 150 m', () => {
    const baile = [M(240, 0), M(120, 220), M(5, 60)];
    expect(puedeEscribirAlChofer({ posiciones: baile, sitioDelViaje: SIN_SITIOS, config: ENCENDIDA, ahora: AHORA }).razon).toBe('en_movimiento');
    const r = puedeEscribirAlChofer({ posiciones: baile, sitioDelViaje: { origen: sitio('patio'), destino: null }, config: ENCENDIDA, ahora: AHORA });
    expect(r).toEqual({ permitido: true, razon: 'dentro_del_sitio' });
    // también con el destino, y con el sitio lejos de la unidad no hay exención
    expect(puedeEscribirAlChofer({ posiciones: baile, sitioDelViaje: { origen: null, destino: sitio('anden') }, config: ENCENDIDA, ahora: AHORA }).razon).toBe('dentro_del_sitio');
    const lejos = { ...sitio('otro', 100), lat: LAT + 1 };
    expect(puedeEscribirAlChofer({ posiciones: baile, sitioDelViaje: { origen: lejos, destino: null }, config: ENCENDIDA, ahora: AHORA }).razon).toBe('en_movimiento');
  });

  it('dentro del sitio pero SIN GPS reciente no hay exención (no se sabe dónde está)', () => {
    const r = puedeEscribirAlChofer({ posiciones: [M(3600)], sitioDelViaje: { origen: sitio('patio'), destino: null }, config: ENCENDIDA, ahora: AHORA });
    expect(r.razon).toBe('sin_gps');
  });

  describe('«atasco» y velocidad (T-A5-65 es opcional)', () => {
    it('3 muestras quietas pero ignición encendida fuera de un sitio: NO escribe (tráfico o semáforo no es estacionado)', () => {
      const r = puedeEscribirAlChofer({ posiciones: QUIETA, sitioDelViaje: null, config: ENCENDIDA, ahora: AHORA, senalExtra: { ignicion: true } });
      expect(r).toEqual({ permitido: false, razon: 'ignicion_encendida' });
    });
    it('ignición apagada o sin señal del proveedor: rige solo-GPS (escribe)', () => {
      expect(puedeEscribirAlChofer({ posiciones: QUIETA, sitioDelViaje: null, config: ENCENDIDA, ahora: AHORA, senalExtra: { ignicion: false } }).permitido).toBe(true);
      expect(puedeEscribirAlChofer({ posiciones: QUIETA, sitioDelViaje: null, config: ENCENDIDA, ahora: AHORA, senalExtra: { ignicion: null, velocidadKmh: null } }).permitido).toBe(true);
      expect(puedeEscribirAlChofer({ posiciones: QUIETA, sitioDelViaje: null, config: ENCENDIDA, ahora: AHORA, senalExtra: null }).permitido).toBe(true);
    });
    it('velocidad sostenida de marcha: NO escribe, incluso con el GPS quieto y aun dentro de un sitio', () => {
      const andando = { velocidadKmh: VELOCIDAD_MARCHA_KMH + 1 };
      expect(puedeEscribirAlChofer({ posiciones: QUIETA, sitioDelViaje: null, config: ENCENDIDA, ahora: AHORA, senalExtra: andando })).toEqual({ permitido: false, razon: 'conduciendo' });
      expect(puedeEscribirAlChofer({ posiciones: QUIETA, sitioDelViaje: { origen: sitio('patio'), destino: null }, config: ENCENDIDA, ahora: AHORA, senalExtra: andando }).razon).toBe('conduciendo');
      expect(puedeEscribirAlChofer({ posiciones: QUIETA, sitioDelViaje: null, config: ENCENDIDA, ahora: AHORA, senalExtra: { velocidadKmh: 0 } }).permitido).toBe(true);
    });
    it('ignición encendida DENTRO del sitio (espera en el andén con el motor prendido) sí queda exenta', () => {
      const r = puedeEscribirAlChofer({ posiciones: QUIETA, sitioDelViaje: { origen: sitio('patio'), destino: null }, config: ENCENDIDA, ahora: AHORA, senalExtra: { ignicion: true } });
      expect(r.razon).toBe('dentro_del_sitio');
    });
  });

  it('falla cerrada ante entradas basura: coordenadas inválidas, fechas inválidas, muestras del futuro', () => {
    const basura: Muestra[] = [{ lat: Number.NaN, lng: LNG, medidaEn: hace(10) }, { lat: 120, lng: LNG, medidaEn: hace(10) }, { lat: LAT, lng: LNG, medidaEn: new Date('x') }];
    expect(puedeEscribirAlChofer({ posiciones: basura, sitioDelViaje: null, config: ENCENDIDA, ahora: AHORA }).razon).toBe('sin_gps');
    const futuro = [M(-3600), M(-3500), M(-3400)]; // reloj del proveedor adelantado una hora
    expect(puedeEscribirAlChofer({ posiciones: futuro, sitioDelViaje: null, config: ENCENDIDA, ahora: AHORA }).razon).toBe('sin_gps');
    expect(puedeEscribirAlChofer({ posiciones: QUIETA, sitioDelViaje: null, config: ENCENDIDA, ahora: new Date('x') }).permitido).toBe(false);
  });

  it('umbrales basura de la configuración caen a los de partida (150 m / 5 min), no a «todo pasa»', () => {
    const rodando = [M(240, 0), M(120, 100), M(5, 300)];
    expect(puedeEscribirAlChofer({ posiciones: rodando, sitioDelViaje: null, config: { ...ENCENDIDA, detenidaMetros: Number.NaN, detenidaVentanaMin: -1 }, ahora: AHORA }).razon).toBe('en_movimiento');
  });

  it.each([
    ['America/Mexico_City', '-06:00'],
    ['America/Monterrey', '-06:00'],
    ['America/Tijuana', '-07:00'],
  ])('reloj simulado en %s: el mismo instante da el mismo veredicto', (_zona, desfase) => {
    // 08:30 hora local de cada zona, expresado como el instante absoluto que es.
    const ahora = new Date(`2026-10-02T08:30:00${desfase}`);
    const muestras = [M(240, 0, { medidaEn: hace(240, ahora) }), M(120, 0, { medidaEn: hace(120, ahora) }), M(5, 0, { medidaEn: hace(5, ahora) })];
    expect(puedeEscribirAlChofer({ posiciones: muestras, sitioDelViaje: null, config: ENCENDIDA, ahora }).permitido).toBe(true);
    const rodando = [M(240, 0, { medidaEn: hace(240, ahora) }), M(5, 400, { medidaEn: hace(5, ahora) }), M(120, 200, { medidaEn: hace(120, ahora) })];
    expect(puedeEscribirAlChofer({ posiciones: rodando, sitioDelViaje: null, config: ENCENDIDA, ahora }).razon).toBe('en_movimiento');
  });

  it('la configuración valida los tres campos nuevos: fuera de rango se rechaza', () => {
    expect(validarConfigConductor({ detenidaMetros: 5 })).toMatchObject({ error: expect.stringMatching(/metros/) });
    expect(validarConfigConductor({ detenidaMetros: 5001 })).toHaveProperty('error');
    expect(validarConfigConductor({ detenidaVentanaMin: 0 })).toMatchObject({ error: expect.stringMatching(/ventana/) });
    expect(validarConfigConductor({ detenidaVentanaMin: 61 })).toHaveProperty('error');
    const ok = validarConfigConductor({ compuertaMovimientoActiva: true, detenidaMetros: 200, detenidaVentanaMin: 10, sinGpsPermite: true });
    expect('ok' in ok && ok.ok).toMatchObject({ compuertaMovimientoActiva: true, detenidaMetros: 200, detenidaVentanaMin: 10, sinGpsPermite: true });
    const sin = validarConfigConductor({});
    expect('ok' in sin && sin.ok).toMatchObject({ compuertaMovimientoActiva: false, detenidaMetros: 150, detenidaVentanaMin: 5, sinGpsPermite: false });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// El cableado: la compuerta pasa por TODOS los caminos que le escriben al chofer o dependen de «dónde está la unidad».
// Si alguno la salta, estas pruebas fallan.
// ═══════════════════════════════════════════════════════════════════════════

const mx = (hhmm: string, dia = '2026-10-02') => new Date(`${dia}T${hhmm}:00-06:00`);
const cfg = (p: Partial<Config> = {}): Config => ({ ...CONFIG_CONDUCTOR_DEFAULT, solicitudesMin: [...CONFIG_CONDUCTOR_DEFAULT.solicitudesMin], diasSemana: [...CONFIG_CONDUCTOR_DEFAULT.diasSemana], ...p });
const hitosDe = (v: string, over: Record<number, Partial<Hito>> = {}): Hito[] =>
  TIPOS_HITO.map((tipo, i) => hitoVacio({ id: `${v}-${i}`, tipo, viajeId: v, ...(over[i] ?? {}) }));

/** Muestras relativas a un reloj mutable: la unidad «rodando» (cada muestra más lejos) o «quieta». */
function gps(modo: { actual: 'quieta' | 'rodando' | 'sin' }, relojRef: { ahora: Date }) {
  return async (unidades: Array<{ tenantId: string; unidadId: string }>): Promise<Map<string, Muestra[]>> => {
    const out = new Map<string, Muestra[]>();
    for (const u of unidades) {
      const a = relojRef.ahora;
      out.set(`${u.tenantId}|${u.unidadId}`, modo.actual === 'sin' ? [] : modo.actual === 'quieta'
        ? [M(240, 0, { medidaEn: hace(240, a) }), M(120, 0, { medidaEn: hace(120, a) }), M(5, 0, { medidaEn: hace(5, a) })]
        : [M(240, 0, { medidaEn: hace(240, a) }), M(120, 250, { medidaEn: hace(120, a) }), M(5, 600, { medidaEn: hace(5, a) })]);
    }
    return out;
  };
}

describe('el motor (solicitud y recordatorios 1–3) pasa por la compuerta', () => {
  const viaje = (extra = {}) => viajeBase({ id: 'v1', unidadId: 'u1', citaOrigenEn: mx('08:00').toISOString(), aceptadoEn: mx('12:00', '2026-10-01').toISOString(), ...extra });

  function armar(config: Partial<Config>, modo: 'quieta' | 'rodando' | 'sin', extra: Partial<Ejec> = {}) {
    const m = crearPuertos({ viajes: [viaje()], hitos: hitosDe('v1'), configs: { t1: cfg(config) } });
    const reloj = { ahora: mx('07:30') };
    const estado = { actual: modo };
    const llamadas = { muestras: 0, sitios: 0 };
    const puertos: Ejec = {
      ...m.puertos,
      muestrasUnidad: async (us) => { llamadas.muestras++; return gps(estado, reloj)(us); },
      sitiosDe: async (vs) => { llamadas.sitios++; return new Map(vs.map((v) => [v.id, SIN_SITIOS])); },
      ...extra,
    };
    return { m, reloj, estado, llamadas, puertos };
  }

  it('encendida y con la unidad rodando: ni la solicitud ni los recordatorios 1–3 salen, y NO se reclama nada', async () => {
    const w = armar(ENCENDIDA, 'rodando');
    for (const h of ['07:30', '07:45', '08:00', '08:15', '08:30']) {
      w.reloj.ahora = mx(h);
      const r = await correrConductor(w.puertos, { ahora: mx(h) });
      expect(r.solicitudes + r.recordatorios).toBe(0);
      expect(r.saltados.compuerta_movimiento).toBe(1);
    }
    expect(w.m.enviados).toHaveLength(0);
    expect(w.m.reclamos.size).toBe(0); // no es un intento: nada reclamado, ningún nivel gastado
    expect(w.m.hitos.get('v1-0')).toMatchObject({ recordatoriosEnviados: 0, solicitadoEn: null });
  });

  it('un «no» no consume la escalera: cuando se detiene, sale el nivel que tocaba, uno por vez y en orden', async () => {
    const w = armar(ENCENDIDA, 'quieta');
    w.reloj.ahora = mx('07:30');
    await correrConductor(w.puertos, { ahora: mx('07:30') });
    expect(w.m.enviados.map((e) => e.plantilla)).toEqual(['conductor_solicitud_llegada_carga_v1']);
    w.estado.actual = 'rodando'; // a +15 va manejando
    w.reloj.ahora = mx('07:45');
    await correrConductor(w.puertos, { ahora: mx('07:45') });
    expect(w.m.enviados).toHaveLength(1);
    w.estado.actual = 'quieta'; // se detiene: el recordatorio 1 sale (no se perdió ni se adelantó)
    w.reloj.ahora = mx('07:50');
    await correrConductor(w.puertos, { ahora: mx('07:50') });
    expect(w.m.enviados.map((e) => e.plantilla)).toEqual(['conductor_solicitud_llegada_carga_v1', 'conductor_recordatorio_1_v1']);
  });

  it('apagada (por omisión): no consulta el GPS y el comportamiento es idéntico al de antes (no regresión)', async () => {
    const w = armar({}, 'rodando');
    const r = await correrConductor(w.puertos, { ahora: mx('07:30') });
    expect(r.solicitudes).toBe(1);
    expect(w.m.enviados).toHaveLength(1);
    expect(w.llamadas).toEqual({ muestras: 0, sitios: 0 });
    // y el mismo resultado que un puerto SIN las lecturas nuevas
    const viejo = crearPuertos({ viajes: [viaje()], hitos: hitosDe('v1'), configs: { t1: cfg() } });
    const rv = await correrConductor(viejo.puertos, { ahora: mx('07:30') });
    expect(rv).toEqual(r);
  });

  it('falla cerrado: encendida y sin puerto de GPS, sin unidad o con la lectura rota, NO manda', async () => {
    const sinPuerto = armar(ENCENDIDA, 'quieta', { muestrasUnidad: undefined });
    await correrConductor(sinPuerto.puertos, { ahora: mx('07:30') });
    expect(sinPuerto.m.enviados).toHaveLength(0);

    const sinUnidad = crearPuertos({ viajes: [viaje({ unidadId: null })], hitos: hitosDe('v1'), configs: { t1: cfg(ENCENDIDA) } });
    const s2 = await correrConductor({ ...sinUnidad.puertos, muestrasUnidad: gps({ actual: 'quieta' }, { ahora: mx('07:30') }) }, { ahora: mx('07:30') });
    expect(sinUnidad.enviados).toHaveLength(0);
    expect(s2.saltados.compuerta_movimiento).toBe(1);

    const rota = armar(ENCENDIDA, 'quieta', { muestrasUnidad: async () => { throw new Error('base caída'); } });
    const r3 = await correrConductor(rota.puertos, { ahora: mx('07:30') });
    expect(rota.m.enviados).toHaveLength(0);
    expect(r3.saltados.compuerta_movimiento).toBe(1);
  });

  it('sin GPS: no manda; con `sinGpsPermite` sí', async () => {
    const a = armar(ENCENDIDA, 'sin');
    await correrConductor(a.puertos, { ahora: mx('07:30') });
    expect(a.m.enviados).toHaveLength(0);
    const b = armar({ ...ENCENDIDA, sinGpsPermite: true }, 'sin');
    await correrConductor(b.puertos, { ahora: mx('07:30') });
    expect(b.m.enviados).toHaveLength(1);
  });

  it('dentro del sitio del viaje la solicitud sale aunque el GPS vaya «bailando»', async () => {
    const w = armar(ENCENDIDA, 'rodando', { sitiosDe: async (vs) => new Map(vs.map((v) => [v.id, { origen: sitio('patio', 2000), destino: null }])) });
    await correrConductor(w.puertos, { ahora: mx('07:30') });
    expect(w.m.enviados).toHaveLength(1);
  });

  it('la escalación al jefe de tráfico NO pasa por la compuerta (no le escribe al chofer)', async () => {
    const hitos = hitosDe('v1');
    const m = crearPuertos({
      viajes: [viaje()], hitos, configs: { t1: cfg(ENCENDIDA) },
      avisos: [{ hitoId: 'v1-0', ciclo: 1, clase: 'solicitud', nivel: 0 }],
    });
    const reloj = { ahora: mx('09:05') };
    const r = await correrConductor({ ...m.puertos, muestrasUnidad: gps({ actual: 'rodando' }, reloj) }, { ahora: mx('09:05') });
    expect(r.escalaciones).toBe(1);
    expect(m.enviados.map((e) => e.contexto)).toEqual(['conductor.escalacion_n1']);
  });
});

describe('la señal de vida pasa por la compuerta (avisos 1 y 2 al chofer)', () => {
  const hecho = (min: number): Partial<Hito> => ({ estado: 'recibido', fuente: 'texto', mensajeEn: hace(min * 60).toISOString(), recibidoEn: hace(min * 60).toISOString() });
  const TRANSITO = TIPOS_HITO.map((t) => hitoVacio({ id: `v1-${t}`, viajeId: 'v1', tipo: t, ...(t === 'llegada_carga' ? hecho(300) : t === 'salida_carga' ? hecho(240) : {}) }));

  function mundo(o: { config?: Partial<Config>; muestras?: Muestra[]; episodio?: import('./senal_vida').EpisodioFila | null } = {}) {
    const llamadas = { abrir: 0, niveles: [] as number[] };
    const enviados: Array<{ contexto: string; telefono: string }> = [];
    let episodio = o.episodio ?? null;
    const puertos: PuertosSV = {
      viajes: async () => [viajeBase({ id: 'v1', unidadId: 'u1' })],
      hitosDe: async (ids) => TRANSITO.filter((h) => ids.includes(h.viajeId)),
      configDe: async () => cfg({ avisarSenalVida: true, ...(o.config ?? {}) }),
      sitiosDe: async (vs) => new Map(vs.map((v) => [v.id, SIN_SITIOS])),
      muestras: async (us) => new Map(us.map((u) => [`${u.tenantId}|${u.unidadId}`, o.muestras ?? []])),
      ultimaMuestra: async () => new Map(),
      episodios: async (ids) => new Map(ids.map((id) => [id, { abierto: episodio, silenciadoHasta: null }])),
      abrir: async (t, v, motivo, ahora) => {
        llamadas.abrir++;
        episodio = { id: 'e1', tenantId: t, viajeId: v, motivo, abiertoEn: ahora.toISOString(), nivelEnviado: 0, aviso1En: null, aviso2En: null, escaladoEn: null };
        return episodio;
      },
      reclamarNivel: async (_e, nivel) => { llamadas.niveles.push(nivel); return 'ganado'; },
      cerrar: async () => {},
      anotarFallo: async () => {},
      enviar: async (telefono, _m, contexto) => { enviados.push({ contexto, telefono }); return { ok: true, via: 'botones', id: 'w', motivo: 'ventana_abierta', ventana: 'abierta' }; },
      destinatarios: async () => [{ nombre: 'Patio', telefono: '5219990000099' }],
      ubicacion: async () => 'sin ubicación reciente',
    };
    return { puertos, llamadas, enviados };
  }
  const OBSOLETA = [M(6000), M(5900), M(5800)]; // última muestra hace ≈ 97 min: «gps_obsoleto»
  /** Una unidad quieta con una muestra cada 2 min durante la hora: «gps_detenido». */
  const DETENIDA = Array.from({ length: 31 }, (_, i) => M(60 * 60 - i * 120 + 5));

  it('encendida y el GPS callado: el aviso 1 NO sale, no se abre el episodio y no se gasta un nivel', async () => {
    const w = mundo({ config: ENCENDIDA, muestras: OBSOLETA });
    const r = await barridoSenalVida(w.puertos, AHORA);
    expect(r.saltados.compuerta_movimiento).toBe(1);
    expect(r.avisosChofer).toBe(0);
    expect(w.enviados).toHaveLength(0);
    expect(w.llamadas).toEqual({ abrir: 0, niveles: [] });
  });

  it('encendida: el aviso 2 tampoco sale con el GPS callado', async () => {
    const ep = { id: 'e1', tenantId: 't1', viajeId: 'v1', motivo: 'gps_obsoleto' as const, abiertoEn: hace(3000).toISOString(), nivelEnviado: 1 as const, aviso1En: hace(1500).toISOString(), aviso2En: null, escaladoEn: null };
    const w = mundo({ config: ENCENDIDA, muestras: OBSOLETA, episodio: ep });
    await barridoSenalVida(w.puertos, AHORA);
    expect(w.enviados).toHaveLength(0);
    expect(w.llamadas.niveles).toEqual([]);
  });

  it('con `sinGpsPermite` el aviso sale (el dueño de la flota decidió que un GPS callado no impide preguntar)', async () => {
    const w = mundo({ config: { ...ENCENDIDA, sinGpsPermite: true }, muestras: OBSOLETA });
    const r = await barridoSenalVida(w.puertos, AHORA);
    expect(r.avisosChofer).toBe(1);
    expect(w.enviados[0].contexto).toBe('conductor.senal_vida_n1');
  });

  it('encendida y detenida de verdad (≥ 3 muestras quietas recientes): el aviso sale', async () => {
    const w = mundo({ config: ENCENDIDA, muestras: DETENIDA });
    const r = await barridoSenalVida(w.puertos, AHORA);
    expect(r.abiertos).toBe(1);
    expect(w.enviados.map((e) => e.contexto)).toEqual(['conductor.senal_vida_n1']);
  });

  it('apagada (por omisión): el comportamiento de siempre, con el GPS callado el aviso sale', async () => {
    const w = mundo({ muestras: OBSOLETA });
    const r = await barridoSenalVida(w.puertos, AHORA);
    expect(r.avisosChofer).toBe(1);
  });

  it('la escalación al jefe NO pasa por la compuerta (no le escribe al chofer)', async () => {
    const ep = { id: 'e1', tenantId: 't1', viajeId: 'v1', motivo: 'gps_obsoleto' as const, abiertoEn: hace(3000).toISOString(), nivelEnviado: 2 as const, aviso1En: hace(2400).toISOString(), aviso2En: hace(1500).toISOString(), escaladoEn: null };
    const w = mundo({ config: ENCENDIDA, muestras: OBSOLETA, episodio: ep });
    const r = await barridoSenalVida(w.puertos, AHORA);
    expect(r.escalaciones).toBe(1);
    expect(w.enviados.map((e) => e.contexto)).toEqual(['conductor.senal_vida_jefe']);
  });
});

describe('las alertas de estadía pasan por la compuerta', () => {
  const llegada = new Date(AHORA.getTime() - 150 * 60_000).toISOString();
  const hitos = (): Hito[] => TIPOS_HITO.map((t) => hitoVacio({
    id: `v1-${t}`, tipo: t, viajeId: 'v1',
    ...(t === 'llegada_carga' ? { estado: 'recibido', fuente: 'texto', mensajeEn: llegada, recibidoEn: llegada } : {}),
  }));
  function armar(config: Partial<Config>, modo: 'quieta' | 'rodando' | 'sin', sitios: Sitios = SIN_SITIOS) {
    const m = crearPuertos({ viajes: [viajeBase({ id: 'v1', unidadId: 'u1' })], hitos: hitos(), configs: { t1: cfg({ estadiaAlertaCargaMin: 120, ...config }) } });
    const puertos: Ejec = {
      ...m.puertos,
      muestrasUnidad: gps({ actual: modo }, { ahora: AHORA }),
      sitiosDe: async (vs) => new Map(vs.map((v) => [v.id, sitios])),
    };
    return { m, puertos };
  }

  it('encendida y la unidad rodando: la alerta espera, sin reclamar nada', async () => {
    const w = armar(ENCENDIDA, 'rodando');
    const r = await correrAlertasEstadia(w.puertos, { ahora: AHORA });
    expect(r.alertas).toBe(0);
    expect(r.compuertaMovimiento).toBe(1);
    expect(w.m.enviados).toHaveLength(0);
    expect(w.m.reclamos.size).toBe(0);
  });

  it('cuando la unidad se detiene la alerta sale, una sola vez', async () => {
    const w = armar(ENCENDIDA, 'quieta');
    const r = await correrAlertasEstadia(w.puertos, { ahora: AHORA });
    expect(r.alertas).toBe(1);
    expect(r.compuertaMovimiento).toBeUndefined();
    expect(w.m.enviados).toHaveLength(1);
  });

  it('en el andén (dentro del sitio) la alerta sale aunque el GPS baile', async () => {
    const w = armar(ENCENDIDA, 'rodando', { origen: sitio('patio', 2000), destino: null });
    const r = await correrAlertasEstadia(w.puertos, { ahora: AHORA });
    expect(r.alertas).toBe(1);
  });

  it('falla cerrado: sin el puerto de GPS no sale; apagada, todo igual que antes', async () => {
    const m = crearPuertos({ viajes: [viajeBase({ id: 'v1', unidadId: 'u1' })], hitos: hitos(), configs: { t1: cfg({ estadiaAlertaCargaMin: 120, ...ENCENDIDA }) } });
    const r = await correrAlertasEstadia(m.puertos, { ahora: AHORA });
    expect(r.alertas).toBe(0);
    expect(r.compuertaMovimiento).toBe(1);
    const apagada = armar({}, 'rodando');
    const r2 = await correrAlertasEstadia(apagada.puertos, { ahora: AHORA });
    expect(r2.alertas).toBe(1);
    expect(r2.compuertaMovimiento).toBeUndefined();
  });
});
