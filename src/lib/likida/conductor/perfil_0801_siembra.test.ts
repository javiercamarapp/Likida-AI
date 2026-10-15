import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { CONFIG_CONDUCTOR_DEFAULT, type ConfigConductor } from './config';
import { barridoCicloGps, type MuestraGps, type PuertosCicloGps, type SitioGps, type SitiosViaje } from './ciclo_gps';
import { hitoActivo } from './maquina';
import { hitoVacio, viajeBase } from './memoria.fixture';
import { aplicarPerfil, HITOS_DEL_PERFIL, hitoEnPerfil, hitosDeSiembra, MOTIVO_FUERA_DE_PERFIL } from './perfil';
import { anclaDe, planificar } from './planificador';
import { armarTablero } from './tablero';
import type { DatosTablero, ViajeTablero } from './repo_validacion';
import { estaPendiente, TIPOS_HITO, type HitoFila, type TipoHito } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-08 — el motor respeta el perfil de seguimiento. Datos 100 % sintéticos.
//   completo    los 5 hitos, exactamente como antes.
//   esenciales  solo salida_carga se persigue, se detecta y se cuenta; los otros cuatro nacen omitido/fuera_de_perfil.
// Hora de México = UTC-6; 2026-10-06 es martes.
// ═══════════════════════════════════════════════════════════════════════════

const mx = (hhmm: string, dia = '2026-10-06') => new Date(`${dia}T${hhmm}:00-06:00`);
const cfg = (c: Partial<ConfigConductor> = {}): ConfigConductor => ({
  ...CONFIG_CONDUCTOR_DEFAULT, solicitudesMin: [0, 15, 30, 45], diasSemana: [1, 2, 3, 4, 5, 6, 7], esperaCargaMin: 120, ...c,
});
const ESENCIALES = { perfilSeguimiento: 'esenciales' as const };

/** Los hitos de un viaje recién sembrado según el perfil (lo que dejan la 0801 y `asegurarHitos`). */
const sembrados = (perfil: 'completo' | 'esenciales', cambios: Partial<Record<TipoHito, Partial<HitoFila>>> = {}): HitoFila[] =>
  hitosDeSiembra(perfil).map((s, i) => hitoVacio({
    id: `h${i}`, tipo: s.tipo, viajeId: 'v1', estado: s.estado, omitidoMotivo: s.omitidoMotivo, ...(cambios[s.tipo] ?? {}),
  }));
/** Un viaje importado de un voluntario del piloto: lo acepta el sistema, trae cita de carga. */
const importado = (extra = {}) => viajeBase({
  aceptadoEn: mx('05:00').toISOString(), aceptadoOrigen: 'importacion', citaOrigenEn: mx('07:00').toISOString(), operadorTelefono: '+520000000000', ...extra,
});
const registrado = (iso: string): Partial<HitoFila> => ({ estado: 'recibido', fuente: 'texto', mensajeEn: iso, recibidoEn: iso });

describe('el vocabulario del perfil', () => {
  it('completo sigue los 5 hitos; esenciales, solo salida_carga', () => {
    expect(HITOS_DEL_PERFIL.completo).toEqual([...TIPOS_HITO]);
    expect(HITOS_DEL_PERFIL.esenciales).toEqual(['salida_carga']);
    expect(hitoEnPerfil('esenciales', 'salida_carga')).toBe(true);
    for (const t of TIPOS_HITO.filter((x) => x !== 'salida_carga')) expect(hitoEnPerfil('esenciales', t)).toBe(false);
  });

  it('la siembra de esenciales: exactamente 1 hito perseguible y 4 omitidos con el motivo exigido por el CHECK de la 0380', () => {
    const s = hitosDeSiembra('esenciales');
    expect(s).toHaveLength(5);
    expect(s.filter((x) => x.estado === 'esperado').map((x) => x.tipo)).toEqual(['salida_carga']);
    const omitidos = s.filter((x) => x.estado === 'omitido');
    expect(omitidos.map((x) => x.tipo)).toEqual(['llegada_carga', 'llegada_descarga', 'salida_descarga', 'regreso']);
    for (const o of omitidos) expect(o.omitidoMotivo).toBe(MOTIVO_FUERA_DE_PERFIL); // omitido <=> motivo no nulo
    for (const e of s.filter((x) => x.estado === 'esperado')) expect(e.omitidoMotivo).toBeNull();
  });

  it('la siembra de completo: 5 esperado sin motivo, como hoy', () => {
    expect(hitosDeSiembra('completo').every((s) => s.estado === 'esperado' && s.omitidoMotivo === null)).toBe(true);
  });

  it('aplicarPerfil(completo) devuelve la MISMA lista (bit a bit el comportamiento de hoy)', () => {
    const hs = sembrados('completo');
    expect(aplicarPerfil(hs, 'completo')).toBe(hs);
  });

  it('aplicarPerfil(esenciales) lee como omitido lo pendiente fuera de perfil y conserva lo ya registrado', () => {
    const hs = sembrados('completo', { llegada_carga: registrado('2026-10-06T14:00:00.000Z'), llegada_descarga: { estado: 'escalado', escaladoEn: '2026-10-06T15:00:00.000Z', escalacionNivel: 1 } });
    const v = aplicarPerfil(hs, 'esenciales');
    expect(v.find((h) => h.tipo === 'llegada_carga')!.estado).toBe('recibido');
    expect(v.find((h) => h.tipo === 'salida_carga')!.estado).toBe('esperado');
    for (const t of ['llegada_descarga', 'salida_descarga', 'regreso'] as const) {
      const h = v.find((x) => x.tipo === t)!;
      expect(h.estado).toBe('omitido');
      expect(h.omitidoMotivo).toBe(MOTIVO_FUERA_DE_PERFIL);
    }
    expect(hs.find((h) => h.tipo === 'regreso')!.estado).toBe('esperado'); // la entrada no se muta
  });
});

describe('planificar — el perfil decide qué se persigue', () => {
  const plan = (hitos: HitoFila[], config: ConfigConductor, ahora: Date, viaje = importado()) =>
    planificar({ viaje, hitos, config, enviadosHoyChofer: 0, avisos: [], ahora });

  it('viaje importado de voluntario con esenciales: exactamente 1 hito perseguible (salida_carga) y 4 omitidos', () => {
    const hs = sembrados('esenciales');
    expect(hs.filter((h) => estaPendiente(h)).map((h) => h.tipo)).toEqual(['salida_carga']);
    expect(hs.filter((h) => h.estado === 'omitido')).toHaveLength(4);
    expect(hitoActivo(hs)?.tipo).toBe('salida_carga');
  });

  it('con esenciales el único mensaje al chofer es por salida_carga: cita 07:00 + espera de carga 120 min = 09:00', () => {
    const hs = sembrados('esenciales');
    const c = cfg(ESENCIALES);
    expect(plan(hs, c, mx('08:59'))).toEqual({ tipo: 'nada', motivo: 'no_toca' });
    const a = plan(hs, c, mx('09:00'));
    expect(a.tipo).toBe('chofer');
    if (a.tipo === 'chofer') expect(a.hito.tipo).toBe('salida_carga');
  });

  it('con esenciales NUNCA se le escribe al chofer por la llegada a carga, aunque la cita ya pasó (con completo sí)', () => {
    // 06:30 = cita 07:00 menos el anticipo de 30 min: con completo toca la llegada a carga; con esenciales todavía no hay nada.
    expect(plan(sembrados('completo'), cfg(), mx('06:30'))).toMatchObject({ tipo: 'chofer', hito: { tipo: 'llegada_carga' } });
    expect(plan(sembrados('esenciales'), cfg(ESENCIALES), mx('06:30'))).toEqual({ tipo: 'nada', motivo: 'no_toca' });
  });

  it('con completo son 5 perseguibles y el hito activo es la llegada a carga, como hoy', () => {
    const hs = sembrados('completo');
    expect(hs.filter((h) => estaPendiente(h))).toHaveLength(5);
    expect(hitoActivo(hs)?.tipo).toBe('llegada_carga');
  });

  it('perfil cambiado y siembra aún sin correr (la base trae los 5 esperado): el planificador ya ignora lo fuera de perfil', () => {
    const viejos = sembrados('completo');
    const c = cfg(ESENCIALES);
    for (const ahora of [mx('06:30'), mx('08:59'), mx('09:00'), mx('11:00')]) {
      expect(plan(viejos, c, ahora)).toEqual(plan(sembrados('esenciales'), c, ahora));
    }
  });

  it('salida registrada con esenciales: el viaje queda completo para el motor (no se persigue descarga ni regreso)', () => {
    const hs = sembrados('esenciales', { salida_carga: registrado(mx('09:10').toISOString()) });
    expect(plan(hs, cfg(ESENCIALES), mx('20:00'))).toEqual({ tipo: 'nada', motivo: 'completo' });
  });

  it('esenciales con la llegada a carga ya registrada por el chofer: manda esa hora, igual que siempre', () => {
    const hs = sembrados('esenciales', { llegada_carga: registrado(mx('08:00').toISOString()) });
    hs.find((h) => h.tipo === 'llegada_carga')!.omitidoMotivo = null;
    expect(anclaDe(hs[1], importado(), hs, cfg(ESENCIALES))?.toISOString()).toBe(mx('10:00').toISOString());
  });

  it('esenciales, viaje del chofer SIN cita: conserva el ancla de siempre (aceptación + trayecto por omisión)', () => {
    const hs = sembrados('esenciales');
    const v = viajeBase({ aceptadoEn: mx('05:00').toISOString(), aceptadoOrigen: 'chofer' });
    expect(anclaDe(hs[1], v, hs, cfg({ ...ESENCIALES, trayectoSinEtaMin: 480 }))?.toISOString()).toBe(mx('13:00').toISOString());
  });

  it('esenciales, viaje importado SIN cita: no hay ancla (el motor no inventa uno)', () => {
    const hs = sembrados('esenciales');
    expect(anclaDe(hs[1], importado({ citaOrigenEn: null }), hs, cfg(ESENCIALES))).toBeNull();
  });
});

// ── el ciclo por geocerca ───────────────────────────────────────────────────

const T0 = new Date('2026-10-02T14:00:00.000Z');
const en = (min: number): Date => new Date(T0.getTime() + min * 60_000);
const ORIGEN: SitioGps = { id: 's-origen', nombre: 'Planta Zapopan', lat: 20.5, lng: -103.3, radioM: 300 };
const DESTINO: SitioGps = { id: 's-destino', nombre: 'CEDIS Monterrey', lat: 25.7, lng: -100.3, radioM: 300 };
const SITIOS: SitiosViaje = { origen: ORIGEN, destino: DESTINO };
const DENTRO = (min: number, s: SitioGps): MuestraGps => ({ lat: s.lat + 0.001, lng: s.lng, medidaEn: en(min) });
const FUERA = (min: number, s: SitioGps): MuestraGps => ({ lat: s.lat + 0.03, lng: s.lng, medidaEn: en(min) });
const AHORA_GPS = en(60);

function mundoGps(perfil: 'completo' | 'esenciales', muestras: MuestraGps[], cambios: Partial<Record<TipoHito, Partial<HitoFila>>> = {}) {
  const v = viajeBase({ id: 'v1', unidadId: 'u1', aceptadoEn: new Date(T0.getTime() - 60 * 60_000).toISOString() });
  const hs = hitosDeSiembra(perfil).map((s) => hitoVacio({
    id: `v1-${s.tipo}`, viajeId: 'v1', tipo: s.tipo, estado: s.estado, omitidoMotivo: s.omitidoMotivo, ...(cambios[s.tipo] ?? {}),
  }));
  const aplicados: Array<{ tipo: string; omitir: string[] }> = [];
  const puertos: PuertosCicloGps = {
    viajes: async () => [v],
    hitosDe: async () => hs.map((h) => ({ ...h })),
    configDe: async () => cfg({ perfilSeguimiento: perfil }),
    sitiosDe: async (vs) => new Map(vs.map((x) => [x.id, SITIOS])),
    muestras: async (us) => new Map(us.map((u) => [`${u.tenantId}|${u.unidadId}`, muestras])),
    reclamar: async () => 'ganado',
    completar: async () => undefined,
    liberar: async () => undefined,
    aplicar: async (_v, _h, d) => { aplicados.push({ tipo: d.tipo, omitir: d.omitir.map((x) => x.tipo) }); return 'ok'; },
  };
  return { puertos, aplicados };
}

describe('ciclo por geocerca — solo detecta lo que el perfil sigue', () => {
  const cruzaLaSalida = [DENTRO(0, ORIGEN), DENTRO(5, ORIGEN), FUERA(10, ORIGEN), FUERA(15, ORIGEN)];

  it('esenciales: el GPS que cruza la salida de la carga SE DETECTA (aunque la llegada a carga esté omitida) y la llegada no', async () => {
    const w = mundoGps('esenciales', cruzaLaSalida);
    const r = await barridoCicloGps(w.puertos, AHORA_GPS);
    expect(w.aplicados.map((a) => a.tipo)).toEqual(['salida_carga']);
    expect(r).toMatchObject({ detectados: 1, llegadas: 0, salidas: 1, fallos: [] });
  });

  it('completo: el mismo recorrido detecta la llegada Y la salida, como hoy', async () => {
    const w = mundoGps('completo', cruzaLaSalida);
    await barridoCicloGps(w.puertos, AHORA_GPS);
    expect(w.aplicados.map((a) => a.tipo)).toEqual(['llegada_carga', 'salida_carga']);
  });

  const salioYEntraAlDestino = [FUERA(0, DESTINO), DENTRO(5, DESTINO), DENTRO(10, DESTINO), DENTRO(15, DESTINO)];

  it('esenciales: el GPS que entra a la descarga NO registra hito (salida_carga ya estaba registrada)', async () => {
    const w = mundoGps('esenciales', salioYEntraAlDestino, { salida_carga: registrado(en(-30).toISOString()) });
    const r = await barridoCicloGps(w.puertos, AHORA_GPS);
    expect(w.aplicados).toEqual([]);
    expect(r.detectados).toBe(0);
  });

  it('completo: el mismo GPS en la descarga SÍ registra la llegada a descarga', async () => {
    const w = mundoGps('completo', salioYEntraAlDestino, { salida_carga: registrado(en(-30).toISOString()) });
    await barridoCicloGps(w.puertos, AHORA_GPS);
    expect(w.aplicados.map((a) => a.tipo)).toEqual(['llegada_descarga']);
  });

  it('esenciales con la base aún sin re-sembrar (5 esperado): tampoco detecta lo fuera de perfil', async () => {
    const w = mundoGps('completo', salioYEntraAlDestino, { salida_carga: registrado(en(-30).toISOString()) });
    const viejoConEsenciales: PuertosCicloGps = { ...w.puertos, configDe: async () => cfg(ESENCIALES) };
    await barridoCicloGps(viejoConEsenciales, AHORA_GPS);
    expect(w.aplicados).toEqual([]);
  });

  it('esenciales, GPS que llega al destino sin haber salido de la carga: no inventa la llegada ni omite nada (fuera de orden queda apagado)', async () => {
    const w = mundoGps('esenciales', [FUERA(0, DESTINO), DENTRO(5, DESTINO), DENTRO(10, DESTINO)]);
    await barridoCicloGps(w.puertos, AHORA_GPS);
    expect(w.aplicados).toEqual([]);
  });
});

// ── el tablero ──────────────────────────────────────────────────────────────

describe('tablero — lo fuera de perfil no cuenta como atrasado ni sin reporte', () => {
  const AHORA = new Date('2026-10-02T18:00:00.000Z');
  const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();
  const viaje = (p: Partial<ViajeTablero> = {}): ViajeTablero => ({
    id: 'v1', folio: 'F-1', origen: 'Zapopan', destino: 'Monterrey', estatus: 'abierto', operadorId: 'o1', operadorNombre: 'Chofer 1',
    terminalId: 'tm1', terminalNombre: 'Tlaquepaque', clienteId: 'c1', clienteNombre: 'Cliente A', unidadId: null,
    aceptadoEn: hace(600), citaOrigenEn: null, citaDestinoEn: null, etaOrigenEn: null, etaDestinoEn: null, origenSitioId: null, destinoSitioId: null, ...p,
  });
  const datos = (hs: HitoFila[]): DatosTablero => ({ viajes: [viaje()], hayMas: false, hitos: hs, veredictos: [], evidencias: [], acciones: [], sitios: new Map() });
  const tablero = (hs: HitoFila[], c: ConfigConductor) => armarTablero(datos(hs), c, AHORA);

  it('esenciales, salida de carga registrada hace horas: el viaje está completo, sin excepciones (la descarga y el regreso omitidos no atrasan)', () => {
    const hs = sembrados('esenciales', { salida_carga: registrado(hace(400)) });
    const t = tablero(hs, cfg(ESENCIALES));
    expect(t.filas[0].semaforo).toBe('completo');
    expect(t.excepciones).toEqual([]);
  });

  it('esenciales con la base aún sin re-sembrar: el mismo viaje tampoco se marca atrasado por los hitos de descarga', () => {
    const hs = sembrados('completo', { salida_carga: registrado(hace(400)) });
    const t = tablero(hs, cfg(ESENCIALES));
    expect(t.filas[0].semaforo).toBe('completo');
    expect(t.excepciones).toEqual([]);
  });

  it('completo, mismo viaje: la llegada a descarga vencida SÍ se marca (no regresión)', () => {
    const hs = sembrados('completo', { salida_carga: registrado(hace(400)) });
    const t = tablero(hs, cfg());
    expect(t.filas[0].semaforo).not.toBe('completo');
    expect(t.excepciones.length).toBeGreaterThan(0);
  });

  it('esenciales, salida de carga vencida sin reporte: SÍ se marca (lo que sí se sigue, se vigila)', () => {
    const hs = sembrados('esenciales');
    const t = tablero(hs, cfg(ESENCIALES));
    expect(['atrasado', 'sin_reporte']).toContain(t.filas[0].semaforo);
    expect(t.excepciones.some((e) => e.hitoTipo === 'salida_carga')).toBe(true);
  });
});
