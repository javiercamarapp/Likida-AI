import type { ConfigConductor } from './config';
import { CONFIG_CONDUCTOR_DEFAULT } from './config';
import { escalarPorProblema, type PuertosConductor, type NuevoAviso } from './ejecutor';
import { crearMemoria } from './memoria.fixture';
import type { ViajeContexto } from './repo';
import type { DatosTablero, EvidenciaFila, VeredictoFila, ViajeTablero } from './repo_validacion';
import type { DepsAcuse } from './atender';
import type { AvisoReclamado } from './planificador';
import { validarHitoContraSitio } from './validar_hito';
import type { DepsValidacion, CandidatoValidacion } from './validar_hito';
import type { PosicionComparada, SitioValidable, Veredicto } from './validacion';
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

  // ── el «Ya lo atiendo» del patio ─────────────────────────────────────────
  const depsAcuse: DepsAcuse = {
    viajePorId: async (id) => { const v = m.viajes.get(id); return v ? { tenantId: v.tenantId } : null; },
    puedeAcusar: async (tenantId, telefono) => {
      const t = telefono.replace(/\D/g, '');
      return [...(o.destinatarios?.[tenantId]?.[1] ?? []), ...(o.destinatarios?.[tenantId]?.[2] ?? [])].some((x) => x.replace(/\D/g, '') === t);
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
    .filter((h) => { const v = veredictos.get(h.id); return !v || v.ciclo !== h.ciclo || (v.v.resultado === 'sin_dato' && ['sin_ubicacion', 'ubicacion_fuera_de_ventana'].includes(v.v.motivo ?? '')); })
    .map((h) => ({ hito: { ...h }, viaje: m.viajes.get(h.viajeId)! }))
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

  return { m, puertos, reclamos, veredictos, depsValidacion, depsAcuse, candidatosValidacion, datosTablero, configDe };
}
export type Mundo = ReturnType<typeof crearMundo>;
