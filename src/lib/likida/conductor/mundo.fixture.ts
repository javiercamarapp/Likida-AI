import type { ConfigConductor } from './config';
import { CONFIG_CONDUCTOR_DEFAULT } from './config';
import { escalarPorProblema, type PuertosConductor, type NuevoAviso } from './ejecutor';
import { crearMemoria } from './memoria.fixture';
import type { ViajeContexto } from './repo';
import type { DatosTablero, EvidenciaFila, VeredictoFila, ViajeTablero } from './repo_validacion';
import type { DepsAcuse } from './atender';
import type { AvisoReclamado } from './planificador';
import { validarHitoContraSitio } from './validar_hito';
import type { PuertosCicloGps, SitiosViaje } from './ciclo_gps';
import { aplicarDeteccion } from './ciclo_gps_real';
import type { EpisodioFila, EstadoEpisodios, PuertosSenalVida } from './senal_vida';
import { silencioDeRespuesta } from './senal_vida';
import type { DepsValidacion, CandidatoValidacion } from './validar_hito';
import { debeReintentarseValidacion, type PosicionComparada, type SitioValidable, type Veredicto } from './validacion';
import type { HitoFila } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// UN «MUNDO» EN MEMORIA PARA LAS PRUEBAS DE PUNTA A PUNTA.
//
// El entrante (`atenderConductor`), el cron (`correrConductor`, las alertas y el barrido de validación) y el
// tablero comparten UNA sola base de hitos, avisos, veredictos y evidencias, que obedece las mismas reglas que
// el SQL (la 0380/0385 las prueban contra Postgres de verdad). El único doble de proveedor es WhatsApp: el
// SELECTOR REAL (`enviarConFallback`) corre completo, y lo que se simula es Meta (la ventana de 24 h, las
// plantillas aprobadas, los rechazos).
// ═══════════════════════════════════════════════════════════════════════════

export interface OpcionesMundo {
  viajes: ViajeContexto[];
  /** Config por flota; sin entrada = defaults. */
  configs?: Record<string, Partial<ConfigConductor>>;
  /** Patio responsable (1) y jefe general (2) por flota. */
  destinatarios?: Record<string, { 1?: string[]; 2?: string[] }>;
  /** Sitio esperado por (viaje, lado). */
  sitios?: Record<string, { carga?: SitioValidable & { tenantId: string }; descarga?: SitioValidable & { tenantId: string } }>;
  /** Posiciones de GPS por unidad. */
  gps?: Array<PosicionComparada & { tenantId: string; unidadId: string }>;
  enviar: PuertosConductor['enviar'];
}

export function crearMundo(o: OpcionesMundo) {
  const m = crearMemoria({ viajes: o.viajes });
  const configDe = (t: string): ConfigConductor => ({
    ...CONFIG_CONDUCTOR_DEFAULT, solicitudesMin: [...CONFIG_CONDUCTOR_DEFAULT.solicitudesMin], diasSemana: [...CONFIG_CONDUCTOR_DEFAULT.diasSemana], ...(o.configs?.[t] ?? {}),
  });
  m.deps.config = async (t) => configDe(t);

  // ── los avisos (claim) ───────────────────────────────────────────────────
  const claves = (a: Pick<NuevoAviso, 'hitoId' | 'ciclo' | 'clase' | 'nivel'>) => `${a.hitoId}|${a.ciclo}|${a.clase}|${a.nivel}`;
  const reclamos = new Map<string, { ok: boolean | null; canal: string | null; motivo: string | null; operadorId: string | null; creado: Date; tenantId: string; viajeId: string }>();
  const hacer = (id: string, cambios: Partial<HitoFila>) => m.hitos.set(id, { ...m.hitos.get(id)!, ...cambios });

  const puertos: PuertosConductor = {
    sembrar: async () => { for (const v of m.viajes.keys()) m.sembrar(v); return 0; },
    viajesActivos: async (l) => [...m.viajes.values()].filter((v) => v.estatus === 'abierto' && v.aceptadoEn).slice(0, l),
    hitosDe: async (ids) => [...m.hitos.values()].filter((h) => ids.includes(h.viajeId)).map((h) => ({ ...h })),
    avisosDe: async (ids) => [...reclamos.entries()].map(([k]) => k.split('|')).filter(([hitoId]) => ids.includes(hitoId))
      .map(([hitoId, ciclo, clase, nivel]) => ({ hitoId, ciclo: Number(ciclo), clase: clase as AvisoReclamado['clase'], nivel: Number(nivel) })),
    enviadosHoyPorChofer: async (ops, desde) => {
      const c: Record<string, number> = {};
      for (const [k, v] of reclamos) {
        const clase = k.split('|')[2];
        if (v.operadorId && ops.includes(v.operadorId) && v.creado >= desde && (clase === 'solicitud' || clase === 'recordatorio')) c[v.operadorId] = (c[v.operadorId] ?? 0) + 1;
      }
      return c;
    },
    configDe: async (t) => configDe(t),
    reclamar: async (a) => {
      if (reclamos.has(claves(a))) return 'perdido';
      reclamos.set(claves(a), { ok: null, canal: null, motivo: null, operadorId: a.operadorId, creado: new Date(), tenantId: a.tenantId, viajeId: a.viajeId });
      return 'ganado';
    },
    cerrarAviso: async (a, c) => { const r = reclamos.get(claves(a)); if (r) { r.ok = c.ok; r.canal = c.canal; r.motivo = c.motivo; } },
    liberarAviso: async (a) => { if (reclamos.get(claves(a))?.ok === null) reclamos.delete(claves(a)); },
    anotarAvisoChofer: async (h, ahora) => {
      const x = m.hitos.get(h.id);
      if (x && ['esperado', 'escalado'].includes(x.estado) && x.ciclo === h.ciclo) {
        hacer(h.id, { recordatoriosEnviados: x.recordatoriosEnviados + 1, ultimoAvisoEn: ahora.toISOString(), solicitadoEn: x.solicitadoEn ?? ahora.toISOString() });
      }
    },
    marcarEscalado: async (h, nivel, ahora) => {
      const x = m.hitos.get(h.id);
      if (!x || !['esperado', 'escalado'].includes(x.estado) || x.ciclo !== h.ciclo) return false;
      hacer(h.id, { estado: 'escalado', escaladoEn: x.escaladoEn ?? ahora.toISOString(), escalacionNivel: Math.max(x.escalacionNivel, nivel) });
      return true;
    },
    enviar: o.enviar,
    destinatarios: async (t, _term, nivel) => (o.destinatarios?.[t]?.[nivel] ?? []).map((telefono, i) => ({ nombre: `Contacto ${nivel}.${i + 1}`, telefono })),
    ubicacion: async () => 'sin ubicación reciente',
    evento: async (h, evento, detalle) => { m.eventos.push({ hito: h.id, evento, detalle }); },
  };

  // ── la validación contra el sitio (mismas reglas que aplicar_validacion_hito, 0385) ──
  const veredictos = new Map<string, { ciclo: number; v: Veredicto }>();
  const rango = (r: string) => (r === 'validado' ? 3 : r === 'sin_coincidencia' ? 2 : 1);
  const depsValidacion: DepsValidacion = {
    sitio: async (tenantId, viajeId, tipo) => {
      const s = o.sitios?.[viajeId]?.[tipo.endsWith('carga') && !tipo.endsWith('descarga') ? 'carga' : 'descarga'];
      // El sitio SOLO se resuelve dentro de la flota del viaje: un sitio de otra flota es «no existe».
      return s && s.tenantId === tenantId ? { id: s.id, nombre: s.nombre, lat: s.lat, lng: s.lng, radioM: s.radioM } : null;
    },
    posiciones: async (tenantId, unidadId, desde, hasta) =>
      (o.gps ?? []).filter((p) => p.tenantId === tenantId && p.unidadId === unidadId && p.medidaEn >= desde && p.medidaEn <= hasta)
        .map(({ lat, lng, medidaEn, fuente }) => ({ lat, lng, medidaEn, fuente })),
    sellarLlegada: async (_tenantId, viajeId) => { m.legado.push({ viajeId, sellos: ['llegada'] }); },
    aplicar: async (tenantId, hito, v, ahora) => {
      const h = m.hitos.get(hito.id);
      if (!h || h.tenantId !== tenantId || h.ciclo !== hito.ciclo || !['recibido', 'validado'].includes(h.estado)) return 'hito_cambio';
      const previo = veredictos.get(hito.id);
      if (previo && previo.ciclo === hito.ciclo && rango(v.resultado) <= rango(previo.v.resultado)) return 'igual';
      veredictos.set(hito.id, { ciclo: hito.ciclo, v });
      if (v.resultado === 'validado' && h.estado === 'recibido') hacer(hito.id, { estado: 'validado', validadoEn: ahora.toISOString(), validadoPor: 'gps' });
      return previo && previo.ciclo === hito.ciclo ? 'mejorado' : 'nuevo';
    },
  };
  m.deps.validarHito = (e) => validarHitoContraSitio(depsValidacion, e);
  m.deps.escalarPorProblema = (v, h, hs, ahora) => escalarPorProblema(puertos, v, h, hs, ahora);

  // ── P2: los episodios de «sin señal de vida» (la 0636, en memoria) y los cruces de geocerca (la 0635) ──
  type EpisodioMem = EpisodioFila & { cerradoEn: string | null; cierre: string | null; respuesta: string | null; silenciadoHasta: string | null };
  const episodios = new Map<string, EpisodioMem>();
  let nEpisodio = 0;
  m.deps.responderSenalVida = async (tenantId, viajeId, respuesta, ahora) => {
    const e = [...episodios.values()].find((x) => x.tenantId === tenantId && x.viajeId === viajeId && !x.cerradoEn);
    if (!e) return 'sin_episodio';
    Object.assign(e, { cerradoEn: ahora.toISOString(), cierre: 'respondio', respuesta, silenciadoHasta: new Date(ahora.getTime() + silencioDeRespuesta(respuesta) * 60_000).toISOString() });
    return 'cerrado';
  };
  const cruces = new Set<string>();
  const muestrasDe = (tenantId: string, unidadId: string) => (o.gps ?? []).filter((p) => p.tenantId === tenantId && p.unidadId === unidadId && p.fuente === 'gps');
  const sitiosGeom = async (vs: ViajeContexto[]): Promise<Map<string, SitiosViaje>> => new Map(vs.map((v) => {
    const s = o.sitios?.[v.id];
    const g = (x?: SitioValidable & { tenantId: string }) => (x && x.tenantId === v.tenantId ? { id: x.id, nombre: x.nombre, lat: x.lat, lng: x.lng, radioM: x.radioM, poligono: x.poligono ?? null } : null);
    return [v.id, { origen: g(s?.carga), destino: g(s?.descarga) }];
  }));
  const puertosCiclo: PuertosCicloGps = {
    viajes: puertos.viajesActivos, hitosDe: puertos.hitosDe, configDe: puertos.configDe, sitiosDe: sitiosGeom,
    muestras: async (us, desde) => new Map(us.map((u) => [`${u.tenantId}|${u.unidadId}`, muestrasDe(u.tenantId, u.unidadId).filter((p) => p.medidaEn >= desde).map(({ lat, lng, medidaEn }) => ({ lat, lng, medidaEn }))])),
    reclamar: async (c) => { const k = `${c.viajeId}|${c.hitoTipo}`; if (cruces.has(k)) return 'perdido'; cruces.add(k); return 'ganado'; },
    completar: async () => {},
    liberar: async (c) => { cruces.delete(`${c.viajeId}|${c.hitoTipo}`); },
    aplicar: (v, h, d, config, ahora) => aplicarDeteccion(v, h, d, config, ahora, {
      registrarHito: m.deps.registrarHito, aplicarVeredicto: depsValidacion.aplicar,
      validarHito: async (x, _por, ahoraV) => { const y = m.hitos.get(x.id); if (!y || y.estado !== 'recibido') return 'carrera'; hacer(x.id, { estado: 'validado', validadoEn: ahoraV.toISOString(), validadoPor: 'gps' }); return 'ok'; },
      sincronizarLegado: m.deps.sincronizarLegado, evento: m.deps.evento, avisarOficina: m.deps.avisarOficina,
    }),
  };
  const puertosSenal: PuertosSenalVida = {
    viajes: puertos.viajesActivos, hitosDe: puertos.hitosDe, configDe: puertos.configDe, sitiosDe: sitiosGeom,
    muestras: async (us, desde) => new Map(us.map((u) => [`${u.tenantId}|${u.unidadId}`, muestrasDe(u.tenantId, u.unidadId).filter((p) => p.medidaEn >= desde).map(({ lat, lng, medidaEn }) => ({ lat, lng, medidaEn }))])),
    ultimaMuestra: async (us, desde) => new Map(us.flatMap((u) => {
      const ult = muestrasDe(u.tenantId, u.unidadId).filter((p) => p.medidaEn >= desde).sort((a, b) => b.medidaEn.getTime() - a.medidaEn.getTime())[0];
      return ult ? [[`${u.tenantId}|${u.unidadId}`, ult.medidaEn] as const] : [];
    })),
    episodios: async (ids, ahora) => {
      const r = new Map<string, EstadoEpisodios>();
      for (const e of episodios.values()) {
        if (!ids.includes(e.viajeId)) continue;
        const x = r.get(e.viajeId) ?? { abierto: null, silenciadoHasta: null };
        if (!e.cerradoEn) x.abierto = { ...e };
        else if (e.silenciadoHasta && new Date(e.silenciadoHasta) > ahora) x.silenciadoHasta = new Date(e.silenciadoHasta);
        r.set(e.viajeId, x);
      }
      return r;
    },
    abrir: async (tenantId, viajeId, motivo, ahora) => {
      if ([...episodios.values()].some((e) => e.viajeId === viajeId && !e.cerradoEn)) return null;
      const e: EpisodioMem = { id: `ep${++nEpisodio}`, tenantId, viajeId, motivo, abiertoEn: ahora.toISOString(), nivelEnviado: 0, aviso1En: null, aviso2En: null, escaladoEn: null, cerradoEn: null, cierre: null, respuesta: null, silenciadoHasta: null };
      episodios.set(e.id, e);
      return { ...e };
    },
    reclamarNivel: async (ep, nivel, ahora) => {
      const e = episodios.get(ep.id);
      if (!e || e.cerradoEn || e.nivelEnviado !== nivel - 1) return 'perdido';
      e.nivelEnviado = nivel as EpisodioFila['nivelEnviado'];
      if (nivel === 1) e.aviso1En = ahora.toISOString(); else if (nivel === 2) e.aviso2En = ahora.toISOString(); else e.escaladoEn = ahora.toISOString();
      return 'ganado';
    },
    cerrar: async (ep, motivo, ahora) => { const e = episodios.get(ep.id); if (e && !e.cerradoEn) Object.assign(e, { cerradoEn: ahora.toISOString(), cierre: motivo }); },
    anotarFallo: async () => {},
    enviar: o.enviar, destinatarios: puertos.destinatarios, ubicacion: puertos.ubicacion,
  };

  // ── el «Ya lo atiendo» del patio ─────────────────────────────────────────
  const depsAcuse: DepsAcuse = {
    viajePorId: async (id) => { const v = m.viajes.get(id); return v ? { tenantId: v.tenantId } : null; },
    puedeAcusar: async (tenantId, telefono) => {
      const t = telefono.replace(/\D/g, '');
      return [...(o.destinatarios?.[tenantId]?.[1] ?? []), ...(o.destinatarios?.[tenantId]?.[2] ?? [])].some((x) => x.replace(/\D/g, '') === t);
    },
    cerrarSenalVida: async (_t, viajeId, ahora) => {
      let n = 0;
      for (const e of episodios.values()) if (e.viajeId === viajeId && !e.cerradoEn) { e.cerradoEn = ahora.toISOString(); e.cierre = 'atendido_por_jefe'; n++; }
      return n;
    },
    marcar: async (tenantId, viajeId, ahora) => {
      const marcados: HitoFila[] = [];
      for (const h of m.de(viajeId)) {
        if (h.tenantId === tenantId && h.estado === 'escalado' && h.escalacionAtendidaEn === null) {
          hacer(h.id, { escalacionAtendidaEn: ahora.toISOString() });
          marcados.push({ ...m.hitos.get(h.id)! });
        }
      }
      return marcados;
    },
    evento: async (h, evento, detalle) => { m.eventos.push({ hito: h.id, evento, detalle: detalle ?? {} }); },
  };

  const candidatosValidacion = async (desde: Date): Promise<CandidatoValidacion[]> => [...m.hitos.values()]
    .filter((h) => ['llegada_carga', 'llegada_descarga'].includes(h.tipo) && h.estado === 'recibido' && h.recibidoEn && new Date(h.recibidoEn) >= desde)
    .filter((h) => { const v = veredictos.get(h.id); return !v || v.ciclo !== h.ciclo || debeReintentarseValidacion(v.v); })
    .map((h) => { const v = veredictos.get(h.id); return { hito: { ...h }, viaje: m.viajes.get(h.viajeId)!, resultadoPrevio: v && v.ciclo === h.ciclo && v.v.resultado === 'sin_coincidencia' ? 'sin_coincidencia' as const : null }; })
    .filter((c) => c.viaje && c.viaje.estatus === 'abierto' && c.viaje.tenantId === c.hito.tenantId);

  /** La base entera como la lee el tablero (los viajes ABIERTOS de UNA flota). */
  const datosTablero = (tenantId: string, ahoraIso?: string): DatosTablero => {
    void ahoraIso;
    const viajes: ViajeTablero[] = [...m.viajes.values()].filter((v) => v.tenantId === tenantId && v.estatus === 'abierto' && v.aceptadoEn).map((v) => ({
      id: v.id, folio: v.folio, origen: v.origen, destino: v.destino, estatus: v.estatus, operadorId: v.operadorId, operadorNombre: v.operadorNombre,
      terminalId: v.terminalId, terminalNombre: null, clienteId: null, clienteNombre: null, unidadId: v.unidadId, aceptadoEn: v.aceptadoEn,
      citaOrigenEn: v.citaOrigenEn, citaDestinoEn: v.citaDestinoEn, etaOrigenEn: v.etaOrigenEn, etaDestinoEn: v.etaDestinoEn,
      origenSitioId: o.sitios?.[v.id]?.carga?.id ?? null, destinoSitioId: o.sitios?.[v.id]?.descarga?.id ?? null,
    }));
    const ids = new Set(viajes.map((v) => v.id));
    const hitos = [...m.hitos.values()].filter((h) => ids.has(h.viajeId) && h.tenantId === tenantId).map((h) => ({ ...h }));
    const ver: VeredictoFila[] = [...veredictos.entries()].filter(([hid]) => hitos.some((h) => h.id === hid)).map(([hitoId, { ciclo, v }]) => ({
      hitoId, ciclo, resultado: v.resultado, motivo: v.motivo, fuente: v.fuente, distanciaM: v.distanciaM, radioM: v.radioM, toleranciaM: v.toleranciaM, sitioId: v.sitioId,
      medidaEn: v.medidaEn ? v.medidaEn.toISOString() : null,
    }));
    const sitios = new Map<string, string>();
    for (const v of viajes) { const s = o.sitios?.[v.id]; if (s?.carga) sitios.set(s.carga.id, s.carga.nombre); if (s?.descarga) sitios.set(s.descarga.id, s.descarga.nombre); }
    const evidencias: EvidenciaFila[] = m.evidencias.filter((e) => hitos.some((h) => h.id === e.hitoId)).map((e, i) => ({ id: `e${i}`, hitoId: e.hitoId, ciclo: e.ciclo, tipo: e.tipo as EvidenciaFila['tipo'], ruta: e.ruta, creadaEn: '' }));
    return { viajes, hayMas: false, hitos, veredictos: ver, evidencias, acciones: [], sitios };
  };

  return { m, puertos, puertosCiclo, puertosSenal, episodios, cruces, reclamos, veredictos, depsValidacion, depsAcuse, candidatosValidacion, datosTablero, configDe };
}
export type Mundo = ReturnType<typeof crearMundo>;
