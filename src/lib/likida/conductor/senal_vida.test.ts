import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { CONFIG_CONDUCTOR_DEFAULT, type ConfigConductor } from './config';
import type { MuestraGps, SitiosViaje } from './ciclo_gps';
import { hitoVacio, viajeBase } from './memoria.fixture';
import {
  barridoSenalVida, decidirSenalVida, enTransito, evaluarSenal, silencioDeRespuesta, avisosFallidosAlChofer, marcaAvisoChoferFallido,
  MINUTOS_DETENIDO, MINUTOS_ESCALAR, MINUTOS_GPS_OBSOLETO, MINUTOS_SEGUNDO_AVISO, TOPE_RECHAZOS_SEGUIDOS_SENAL,
  type EpisodioFila, type EstadoEpisodios, type EstadoSenal, type PuertosSenalVida,
} from './senal_vida';
import { TIPOS_HITO, type HitoFila, type TipoHito } from './tipos';

// AHORA = 08:30 en México (UTC−6) de un viernes: dentro de la ventana de 06:00 a 22:00.
const AHORA = new Date('2026-10-02T14:30:00.000Z');
const hace = (min: number): Date => new Date(AHORA.getTime() - min * 60_000);
const M = (min: number, lat = 20.7, lng = -103.4): MuestraGps => ({ lat, lng, medidaEn: hace(min) });
const SIN_SITIOS: SitiosViaje = { origen: null, destino: null };

function hitos(estados: Partial<Record<TipoHito, Partial<HitoFila>>>, viajeId = 'v1'): HitoFila[] {
  return TIPOS_HITO.map((t) => hitoVacio({ id: `${viajeId}-${t}`, viajeId, tipo: t, ...(estados[t] ?? {}) }));
}
const hecho = (min: number): Partial<HitoFila> => ({ estado: 'recibido', fuente: 'texto', mensajeEn: hace(min).toISOString(), recibidoEn: hace(min).toISOString() });
const TRANSITO = hitos({ llegada_carga: hecho(300), salida_carga: hecho(240) });

describe('enTransito', () => {
  it('salió de la carga y no ha llegado a la descarga', () => {
    expect(enTransito(TRANSITO)).toBe(true);
  });
  it('antes de salir de la carga, o ya llegado a la descarga, no', () => {
    expect(enTransito(hitos({ llegada_carga: hecho(30) }))).toBe(false);
    expect(enTransito(hitos({ salida_carga: hecho(240), llegada_descarga: hecho(10) }))).toBe(false);
    expect(enTransito(hitos({ salida_carga: { estado: 'omitido', omitidoMotivo: 'x' } }))).toBe(false);
  });
});

describe('evaluarSenal — qué dice el GPS', () => {
  const base = { sitios: SIN_SITIOS, toleranciaM: 150, ahora: AHORA, ultimaMuestraEn: null };

  it('una unidad que se mueve y reporta está OK', () => {
    const muestras = [M(50, 20.60), M(40, 20.62), M(30, 20.64), M(20, 20.66), M(10, 20.68), M(2, 20.70)];
    expect(evaluarSenal({ ...base, muestras })).toEqual({ estado: 'ok' });
  });

  it('la última muestra de hace más de 45 min es «gps_obsoleto», con los minutos reales', () => {
    const r = evaluarSenal({ ...base, muestras: [M(100), M(90), M(MINUTOS_GPS_OBSOLETO + 5)] });
    expect(r).toMatchObject({ estado: 'gps_obsoleto', minutos: MINUTOS_GPS_OBSOLETO + 5 });
  });

  it('justo en el umbral todavía no es obsoleto', () => {
    expect(evaluarSenal({ ...base, muestras: [M(MINUTOS_GPS_OBSOLETO)] }).estado).not.toBe('gps_obsoleto');
  });

  it('sin muestras en la ventana corta pero con una de las últimas 24 h: obsoleto (la señal SE CALLÓ)', () => {
    const r = evaluarSenal({ ...base, muestras: [], ultimaMuestraEn: hace(300) });
    expect(r).toMatchObject({ estado: 'gps_obsoleto', minutos: 300 });
  });

  it('una unidad que NUNCA reportó GPS (flota sin conector) no tiene «señal que se calló»: sin_gps', () => {
    expect(evaluarSenal({ ...base, muestras: [], ultimaMuestraEn: null })).toEqual({ estado: 'sin_gps' });
  });

  it('detenida: 60 min pegada al mismo punto, con cobertura desde el principio de la ventana, ≥ 3 muestras y fuera de un sitio', () => {
    const muestras = [M(MINUTOS_DETENIDO), M(45), M(30), M(15), M(2)];
    expect(evaluarSenal({ ...base, muestras })).toMatchObject({ estado: 'gps_detenido', minutos: MINUTOS_DETENIDO });
  });

  it('un tractor que avanza despacio (más de 150 m en la hora) NO está detenido', () => {
    const muestras = [M(60, 20.7), M(45, 20.7), M(30, 20.7), M(15, 20.7), M(2, 20.7 + 0.0025)]; // ≈ 278 m
    expect(evaluarSenal({ ...base, muestras }).estado).toBe('ok');
  });

  it('sin cobertura de la ventana (el GPS empezó a reportar hace 20 min) no se afirma «detenido»', () => {
    expect(evaluarSenal({ ...base, muestras: [M(20), M(10), M(2)] }).estado).toBe('ok');
  });

  it('con menos de 3 muestras no se afirma «detenido»', () => {
    expect(evaluarSenal({ ...base, muestras: [M(59), M(2)] }).estado).toBe('ok');
  });

  it('detenido DENTRO del sitio del viaje (esperando en la planta o en el andén) es normal: lo cubren la estadía y la alerta de llegada', () => {
    const sitios: SitiosViaje = { origen: null, destino: { id: 's', nombre: 'CEDIS', lat: 20.7, lng: -103.4, radioM: 300 } };
    const muestras = [M(60), M(45), M(30), M(15), M(2)];
    expect(evaluarSenal({ ...base, sitios, muestras }).estado).toBe('ok');
  });
});

// ── la decisión ─────────────────────────────────────────────────────────────

const CFG = { activo: true, avisarSenalVida: true, horaInicio: 6, horaFin: 22, diasSemana: [1, 2, 3, 4, 5, 6, 7] };
const OBS: EstadoSenal = { estado: 'gps_obsoleto', minutos: 70, ultimaMuestraEn: hace(70) };
const sinEpisodios: EstadoEpisodios = { abierto: null, silenciadoHasta: null };
const ep = (p: Partial<EpisodioFila> = {}): EpisodioFila => ({
  id: 'e1', tenantId: 't1', viajeId: 'v1', motivo: 'gps_obsoleto', abiertoEn: hace(60).toISOString(), nivelEnviado: 0, aviso1En: null, aviso2En: null, escaladoEn: null, ...p,
});
const decidir = (p: Partial<Parameters<typeof decidirSenalVida>[0]> = {}) => decidirSenalVida({
  viaje: { operadorTelefono: '5219990000001' }, hitos: TRANSITO, config: CFG, senal: OBS, episodios: sinEpisodios, ahora: AHORA, ...p,
});

describe('decidirSenalVida — la escalera', () => {
  it('apagado por flota (la perilla nace apagada) o con el agente apagado: nada', () => {
    expect(decidir({ config: { ...CFG, avisarSenalVida: false } })).toEqual({ tipo: 'nada', motivo: 'flota_apagada' });
    expect(decidir({ config: { ...CFG, activo: false } })).toEqual({ tipo: 'nada', motivo: 'flota_apagada' });
  });

  it('sin episodio y con el GPS obsoleto en tránsito: abre uno (con el motivo y los minutos)', () => {
    expect(decidir()).toEqual({ tipo: 'abrir', motivo: 'gps_obsoleto', minutos: 70 });
    expect(decidir({ senal: { estado: 'gps_detenido', minutos: 62, ultimaMuestraEn: hace(2) } })).toEqual({ tipo: 'abrir', motivo: 'gps_detenido', minutos: 62 });
  });

  it('nada si no va en tránsito, si el GPS está bien o si la unidad nunca reportó', () => {
    expect(decidir({ hitos: hitos({ llegada_carga: hecho(30) }) })).toEqual({ tipo: 'nada', motivo: 'no_transito' });
    expect(decidir({ senal: { estado: 'ok' } })).toEqual({ tipo: 'nada', motivo: 'ok' });
    expect(decidir({ senal: { estado: 'sin_gps' } })).toEqual({ tipo: 'nada', motivo: 'sin_gps' });
  });

  it('de noche (fuera de la ventana de la flota) no se abre ni se avisa', () => {
    const noche = new Date('2026-10-03T06:30:00.000Z'); // 00:30 en México
    expect(decidir({ ahora: noche })).toEqual({ tipo: 'nada', motivo: 'fuera_de_ventana' });
    expect(decidir({ ahora: noche, episodios: { abierto: ep({ nivelEnviado: 2, aviso2En: hace(120).toISOString() }), silenciadoHasta: null } })).toEqual({ tipo: 'nada', motivo: 'fuera_de_ventana' });
  });

  it('el chofer sin teléfono no recibe aviso (la escalera del hito ya cubre ese caso)', () => {
    expect(decidir({ viaje: { operadorTelefono: null } })).toEqual({ tipo: 'nada', motivo: 'sin_telefono' });
  });

  it('un silencio vigente (el chofer contestó hace poco) NO deja abrir otro episodio con el mismo GPS mudo', () => {
    const silenciado = { abierto: null, silenciadoHasta: new Date(AHORA.getTime() + 30 * 60_000) };
    expect(decidir({ episodios: silenciado })).toEqual({ tipo: 'nada', motivo: 'silenciado' });
    expect(decidir({ episodios: { abierto: null, silenciadoHasta: new Date(AHORA.getTime() - 1) } }).tipo).toBe('abrir');
  });

  it('abierto sin aviso enviado: el aviso 1', () => {
    expect(decidir({ episodios: { abierto: ep({ nivelEnviado: 0 }), silenciadoHasta: null } })).toEqual({ tipo: 'avisar', nivel: 1, minutos: 70 });
  });

  it('aviso 1 enviado: espera 20 min y entonces el aviso 2', () => {
    const e = (min: number) => ({ abierto: ep({ nivelEnviado: 1, aviso1En: hace(min).toISOString() }), silenciadoHasta: null });
    expect(decidir({ episodios: e(MINUTOS_SEGUNDO_AVISO - 1) })).toEqual({ tipo: 'nada', motivo: 'espera' });
    expect(decidir({ episodios: e(MINUTOS_SEGUNDO_AVISO) })).toEqual({ tipo: 'avisar', nivel: 2, minutos: 70 });
  });

  it('aviso 2 enviado: espera 20 min y entonces al jefe de tráfico', () => {
    const e = (min: number) => ({ abierto: ep({ nivelEnviado: 2, aviso1En: hace(min + 30).toISOString(), aviso2En: hace(min).toISOString() }), silenciadoHasta: null });
    expect(decidir({ episodios: e(MINUTOS_ESCALAR - 1) })).toEqual({ tipo: 'nada', motivo: 'espera' });
    expect(decidir({ episodios: e(MINUTOS_ESCALAR) })).toEqual({ tipo: 'escalar', minutos: 70 });
  });

  it('ya escalado: no se insiste', () => {
    expect(decidir({ episodios: { abierto: ep({ nivelEnviado: 3 }), silenciadoHasta: null } })).toEqual({ tipo: 'nada', motivo: 'ya_escalado' });
  });

  it('si el GPS vuelve a reportar el episodio abierto se cierra solo; si el viaje ya no va en tránsito, también', () => {
    const abierto = { abierto: ep({ nivelEnviado: 1, aviso1En: hace(5).toISOString() }), silenciadoHasta: null };
    expect(decidir({ senal: { estado: 'ok' }, episodios: abierto })).toEqual({ tipo: 'cerrar', motivo: 'senal_recuperada' });
    expect(decidir({ hitos: hitos({ salida_carga: hecho(240), llegada_descarga: hecho(10) }), episodios: abierto })).toEqual({ tipo: 'cerrar', motivo: 'viaje_cerrado' });
  });

  it('«Voy a cargar» deja menos silencio (1 h) que «Sí, estoy» y «Estoy bien» (2 h)', () => {
    expect(silencioDeRespuesta('voy_a_cargar')).toBe(60);
    expect(silencioDeRespuesta('estoy')).toBe(120);
    expect(silencioDeRespuesta('estoy_bien')).toBe(120);
  });
});

// ── el barrido ──────────────────────────────────────────────────────────────

interface Env { telefono: string; texto: string; plantilla: string; botones: string[]; contexto: string }

function mundo(o: {
  config?: Partial<ConfigConductor>;
  hitosViaje?: HitoFila[];
  muestras?: MuestraGps[];
  ultima?: Date | null;
  episodio?: EpisodioFila | null;
  silenciadoHasta?: Date | null;
  viajes?: Array<ReturnType<typeof viajeBase>>;
  envio?: (e: Env) => { ok: true } | { ok: false; reintentable: boolean; encolado?: boolean; mensaje: string };
  destinos?: Array<{ nombre: string; telefono: string }>;
  reclamar?: 'ganado' | 'perdido' | 'fallo';
  abrir?: 'abre' | 'otro';
} = {}) {
  const viajes = o.viajes ?? [viajeBase({ id: 'v1', unidadId: 'u1' })];
  let episodio: EpisodioFila | null = o.episodio ?? null;
  const enviados: Env[] = [];
  const llamadas = { abrir: 0, niveles: [] as number[], cerrados: [] as string[], fallos: [] as string[] };
  const puertos: PuertosSenalVida = {
    viajes: async () => viajes,
    hitosDe: async (ids) => (o.hitosViaje ?? TRANSITO).filter((h) => ids.includes(h.viajeId)),
    configDe: async () => ({ ...CONFIG_CONDUCTOR_DEFAULT, avisarSenalVida: true, ...(o.config ?? {}) }),
    sitiosDe: async (vs) => new Map(vs.map((v) => [v.id, SIN_SITIOS])),
    muestras: async (us) => new Map(us.map((u) => [`${u.tenantId}|${u.unidadId}`, o.muestras ?? []])),
    ultimaMuestra: async (us) => new Map(us.flatMap((u) => (o.ultima ? [[`${u.tenantId}|${u.unidadId}`, o.ultima] as const] : []))),
    episodios: async (ids) => new Map(ids.map((id) => [id, { abierto: episodio, silenciadoHasta: o.silenciadoHasta ?? null }])),
    abrir: async (t, v, motivo, ahora) => {
      llamadas.abrir++;
      if (o.abrir === 'otro') return null;
      episodio = { id: 'e-nuevo', tenantId: t, viajeId: v, motivo, abiertoEn: ahora.toISOString(), nivelEnviado: 0, aviso1En: null, aviso2En: null, escaladoEn: null };
      return episodio;
    },
    reclamarNivel: async (_e, nivel) => { llamadas.niveles.push(nivel); return o.reclamar ?? 'ganado'; },
    cerrar: async (_e, motivo) => { llamadas.cerrados.push(motivo); },
    anotarFallo: async (_e, t) => { llamadas.fallos.push(t); },
    enviar: async (telefono, m, contexto) => {
      const e = { telefono, texto: m.texto, plantilla: m.plantilla.nombre, botones: m.botones.map((b) => b.id), contexto };
      const r = o.envio ? o.envio(e) : { ok: true as const };
      if (r.ok) { enviados.push(e); return { ok: true, via: 'botones', id: 'w', motivo: 'ventana_abierta', ventana: 'abierta' }; }
      return { ok: false, motivo: 'rechazo_no_ventana', mensaje: r.mensaje, fueraDeVentana: false, reintentable: r.reintentable, encolado: r.encolado, ventana: 'abierta' };
    },
    destinatarios: async () => o.destinos ?? [{ nombre: 'Patio', telefono: '5219990000099' }],
    ubicacion: async () => 'hace 70 min: https://maps.google.com/?q=20.7,-103.4',
  };
  return { puertos, enviados, llamadas, episodio: () => episodio };
}

describe('barridoSenalVida', () => {
  it('abre el episodio y manda el aviso 1 al chofer con los tres botones del viaje', async () => {
    const w = mundo({ muestras: [M(100), M(90), M(70)] });
    const r = await barridoSenalVida(w.puertos, AHORA);
    expect(r).toMatchObject({ viajes: 1, enTransito: 1, abiertos: 1, avisosChofer: 1, fallos: [] });
    expect(w.llamadas.niveles).toEqual([1]);
    expect(w.enviados).toHaveLength(1);
    expect(w.enviados[0]).toMatchObject({ telefono: '5219990000001', plantilla: 'conductor_senal_vida_v1', contexto: 'conductor.senal_vida_n1' });
    expect(w.enviados[0].botones).toEqual(['senal_vida_estoy:v1', 'senal_vida_cargar:v1', 'senal_vida_bien:v1']);
    expect(w.enviados[0].texto).toContain('no recibimos la señal del GPS');
    expect(w.enviados[0].texto).not.toContain('segundo aviso');
  });

  it('el segundo aviso dice que es el segundo', async () => {
    const w = mundo({ muestras: [M(100)], episodio: ep({ nivelEnviado: 1, aviso1En: hace(25).toISOString() }) });
    await barridoSenalVida(w.puertos, AHORA);
    expect(w.llamadas.niveles).toEqual([2]);
    expect(w.enviados[0].texto).toContain('segundo aviso:');
    expect(w.enviados[0].contexto).toBe('conductor.senal_vida_n2');
  });

  it('el aviso al jefe de tráfico lleva el botón «Ya lo atiendo», la ubicación y NO se le manda al chofer', async () => {
    const w = mundo({ muestras: [M(100)], episodio: ep({ nivelEnviado: 2, aviso1En: hace(50).toISOString(), aviso2En: hace(25).toISOString() }) });
    const r = await barridoSenalVida(w.puertos, AHORA);
    expect(r.escalaciones).toBe(1);
    expect(w.llamadas.niveles).toEqual([3]);
    expect(w.enviados).toHaveLength(1);
    expect(w.enviados[0]).toMatchObject({ telefono: '5219990000099', plantilla: 'aviso_jefe_senal_vida_v1', botones: ['jefe_atiendo:v1'], contexto: 'conductor.senal_vida_jefe' });
    expect(w.enviados[0].texto).toContain('maps.google.com');
    expect(w.enviados[0].texto).toContain('se le avisó dos veces sin respuesta');
  });

  it('aviso 1 rechazado de forma definitiva: se anota la marca y la escalación NO dice «se le avisó dos veces»', async () => {
    const w = mundo({ muestras: [M(100)], envio: (e) => (e.contexto.startsWith('conductor.senal_vida_n') ? { ok: false, reintentable: false, mensaje: '132001 plantilla sin aprobar' } : { ok: true }) });
    await barridoSenalVida(w.puertos, AHORA);
    expect(w.llamadas.fallos[0]).toMatch(/^aviso_chofer_fallido:1\|/);
    // segundo aviso (20 min después) también rechazado; la marca conserva los dos niveles
    const w2 = mundo({
      muestras: [M(100)], episodio: ep({ nivelEnviado: 1, aviso1En: hace(25).toISOString(), ultimoError: w.llamadas.fallos[0] }),
      envio: () => ({ ok: false, reintentable: false, mensaje: '132001 plantilla sin aprobar' }),
    });
    await barridoSenalVida(w2.puertos, AHORA);
    expect(w2.llamadas.fallos[0]).toMatch(/^aviso_chofer_fallido:1,2\|/);
    // escalación con ambos avisos fallidos
    const w3 = mundo({ muestras: [M(100)], episodio: ep({ nivelEnviado: 2, aviso2En: hace(25).toISOString(), ultimoError: w2.llamadas.fallos[0] }) });
    await barridoSenalVida(w3.puertos, AHORA);
    expect(w3.enviados[0].texto).toContain('no se le pudo avisar por WhatsApp');
    expect(w3.enviados[0].texto).not.toContain('se le avisó dos veces');
  });

  it('con un solo aviso fallido la escalación dice la verdad: una vez', async () => {
    const w = mundo({ muestras: [M(100)], episodio: ep({ nivelEnviado: 2, aviso2En: hace(25).toISOString(), ultimoError: 'aviso_chofer_fallido:1|132001' }) });
    await barridoSenalVida(w.puertos, AHORA);
    expect(w.enviados[0].texto).toContain('solo se le pudo avisar una vez, sin respuesta');
  });

  it('un rechazo REINTENTABLE (queda en el outbox) no marca el aviso como fallido', () => {
    expect(avisosFallidosAlChofer(null)).toBe(0);
    expect(avisosFallidosAlChofer('algo distinto')).toBe(0);
    expect(avisosFallidosAlChofer(marcaAvisoChoferFallido(marcaAvisoChoferFallido(null, 1, 'x'), 1, 'y'))).toBe(1);
    expect(avisosFallidosAlChofer(marcaAvisoChoferFallido(marcaAvisoChoferFallido(null, 1, 'x'), 2, 'y'))).toBe(2);
  });

  it('sin a quién escalar se dice y queda anotado en el episodio (no se calla)', async () => {
    const w = mundo({ muestras: [M(100)], episodio: ep({ nivelEnviado: 2, aviso2En: hace(25).toISOString() }), destinos: [] });
    const r = await barridoSenalVida(w.puertos, AHORA);
    expect(r.sinDestinatario).toBe(1);
    expect(r.fallos[0]).toMatch(/a quién escalar/);
    expect(w.llamadas.fallos).toEqual(['sin_destinatario']);
  });

  it('el que pierde el claim del nivel no manda nada (dos corridas solapadas no duplican el aviso)', async () => {
    const w = mundo({ muestras: [M(100)], reclamar: 'perdido' });
    const r = await barridoSenalVida(w.puertos, AHORA);
    expect(r.yaReclamados).toBe(1);
    expect(w.enviados).toHaveLength(0);
  });

  it('si otra corrida abrió el episodio primero, no se manda nada', async () => {
    const w = mundo({ muestras: [M(100)], abrir: 'otro' });
    const r = await barridoSenalVida(w.puertos, AHORA);
    expect(r.yaReclamados).toBe(1);
    expect(w.llamadas.niveles).toHaveLength(0);
  });

  it('un rechazo REINTENTABLE ya está en wa_outbox: el nivel queda reclamado, no se reenvía y se dice', async () => {
    const w = mundo({ muestras: [M(100)], envio: () => ({ ok: false, reintentable: true, mensaje: 'límite de envío' }) });
    const r = await barridoSenalVida(w.puertos, AHORA);
    expect(r.rechazosReintentables).toBe(1);
    expect(r.fallos[0]).toMatch(/no se reenvía/);
    expect(w.llamadas.fallos).toHaveLength(0);
  });

  it('el token vencido (encolado, no reintentable) tampoco se reenvía', async () => {
    const w = mundo({ muestras: [M(100)], envio: () => ({ ok: false, reintentable: false, encolado: true, mensaje: 'token vencido' }) });
    const r = await barridoSenalVida(w.puertos, AHORA);
    expect(r.rechazosReintentables).toBe(1);
    expect(w.llamadas.fallos).toHaveLength(0);
  });

  it('un rechazo definitivo (plantilla sin aprobar) deja el motivo en el episodio y la escalera sigue al siguiente nivel', async () => {
    const w = mundo({ muestras: [M(100)], envio: () => ({ ok: false, reintentable: false, mensaje: 'plantilla no aprobada' }) });
    const r = await barridoSenalVida(w.puertos, AHORA);
    expect(r.avisosChofer).toBe(0);
    expect(w.llamadas.fallos).toEqual(['aviso_chofer_fallido:1|plantilla no aprobada']);
    expect(r.fallos[0]).toMatch(/plantilla no aprobada/);
  });

  it('cinco rechazos reintentables seguidos paran la corrida (Meta diciendo «hoy no»)', async () => {
    const viajes = Array.from({ length: 8 }, (_, i) => viajeBase({ id: `v${i}`, operadorId: `o${i}`, unidadId: `u${i}` }));
    const w = mundo({ viajes, hitosViaje: viajes.flatMap((v) => hitos({ llegada_carga: hecho(300), salida_carga: hecho(240) }, v.id)), muestras: [M(100)], envio: () => ({ ok: false, reintentable: true, mensaje: 'límite' }) });
    const r = await barridoSenalVida(w.puertos, AHORA);
    expect(r.cortadaPorRechazoMasivo).toBe(true);
    expect(r.rechazosReintentables).toBe(TOPE_RECHAZOS_SEGUIDOS_SENAL);
    expect(r.cortadosPorReloj).toBe(3);
  });

  it('con el GPS recuperado cierra el episodio abierto y no manda nada', async () => {
    const w = mundo({ muestras: [M(50, 20.60), M(40, 20.62), M(30, 20.64), M(20, 20.66), M(10, 20.68), M(2, 20.70)], episodio: ep({ nivelEnviado: 1, aviso1En: hace(10).toISOString() }) });
    const r = await barridoSenalVida(w.puertos, AHORA);
    expect(r.cerrados).toBe(1);
    expect(w.llamadas.cerrados).toEqual(['senal_recuperada']);
    expect(w.enviados).toHaveLength(0);
  });

  it('un episodio abierto de un viaje que ya llegó a la descarga se cierra aunque ya no esté en tránsito', async () => {
    const llegado = hitos({ llegada_carga: hecho(300), salida_carga: hecho(240), llegada_descarga: hecho(5) });
    const w = mundo({ hitosViaje: llegado, muestras: [M(100)], episodio: ep({ nivelEnviado: 2 }) });
    await barridoSenalVida(w.puertos, AHORA);
    expect(w.llamadas.cerrados).toEqual(['viaje_cerrado']);
  });

  it('un viaje que no va en tránsito ni tiene episodio no gasta lecturas de GPS', async () => {
    const w = mundo({ hitosViaje: hitos({ llegada_carga: hecho(30) }) });
    const espia = vi.spyOn(w.puertos, 'muestras');
    const r = await barridoSenalVida(w.puertos, AHORA);
    expect(r.enTransito).toBe(0);
    expect(espia).not.toHaveBeenCalled();
  });

  it('la flota con la perilla apagada (el default) no se toca: ni siquiera se leen sus hitos', async () => {
    const w = mundo({ config: { avisarSenalVida: false }, muestras: [M(100)] });
    const espia = vi.spyOn(w.puertos, 'hitosDe');
    const r = await barridoSenalVida(w.puertos, AHORA);
    expect(r.abiertos).toBe(0);
    expect(espia).not.toHaveBeenCalled();
  });

  it('la unidad que no tiene muestras recientes pide su última muestra de 24 h para saber si SE CALLÓ o nunca reportó', async () => {
    const calla = mundo({ muestras: [], ultima: hace(300) });
    expect((await barridoSenalVida(calla.puertos, AHORA)).abiertos).toBe(1);
    const nunca = mundo({ muestras: [], ultima: null });
    const r = await barridoSenalVida(nunca.puertos, AHORA);
    expect(r.abiertos).toBe(0);
    expect(r.saltados.sin_gps).toBe(1);
  });

  it('un viaje que revienta no tumba al resto', async () => {
    const viajes = [viajeBase({ id: 'v1', unidadId: 'u1' }), viajeBase({ id: 'v2', operadorId: 'o2', unidadId: 'u2' })];
    const w = mundo({ viajes, hitosViaje: viajes.flatMap((v) => hitos({ llegada_carga: hecho(300), salida_carga: hecho(240) }, v.id)), muestras: [M(100)] });
    let n = 0;
    const original = w.puertos.abrir;
    w.puertos.abrir = async (...a) => { if (n++ === 0) throw new Error('boom'); return original(...a); };
    const r = await barridoSenalVida(w.puertos, AHORA);
    expect(r.fallos[0]).toMatch(/boom/);
    expect(r.avisosChofer).toBe(1);
  });
});
