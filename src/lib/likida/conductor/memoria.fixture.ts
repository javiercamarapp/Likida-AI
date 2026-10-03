import { CONFIG_CONDUCTOR_DEFAULT, type ConfigConductor } from './config';
import type { DepsAtender } from './atender';
import type { NuevoAviso, CierreAviso, PuertosConductor } from './ejecutor';
import type { AvisoReclamado } from './planificador';
import type { ViajeContexto } from './repo';
import { TIPOS_HITO, type HitoFila, type TipoHito } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// UNA BASE EN MEMORIA que obedece las MISMAS reglas que el SQL de la 0380:
// updates condicionales por estado y ciclo, unique (viaje, tipo), unique
// (tenant, wa_message_id), unique del claim de avisos. Sirve para probar el motor
// y la entrada del processor sin Postgres; las reglas que SOLO la base puede
// demostrar (CHECKs, RLS, ARCO, concurrencia real) las prueba
// supabase/tests/0380_conductor_hitos.sql contra un Postgres de verdad.
// ═══════════════════════════════════════════════════════════════════════════

export function hitoVacio(p: Partial<HitoFila> & Pick<HitoFila, 'id' | 'tipo' | 'viajeId'>): HitoFila {
  return {
    tenantId: 't1', estado: 'esperado', ciclo: 1, fuente: null, interpretacion: null, mensajeEn: null, recibidoEn: null,
    contactoNombre: null, contactoArea: null, sinContacto: false, lat: null, lng: null, evidenciaRuta: null,
    validadoEn: null, validadoPor: null, omitidoMotivo: null, pospuestoHasta: null, pospuestoVeces: 0, correcciones: 0,
    solicitadoEn: null, recordatoriosEnviados: 0, ultimoAvisoEn: null, escaladoEn: null, escalacionNivel: 0,
    escalacionAtendidaEn: null, ...p,
  };
}

export function viajeBase(p: Partial<ViajeContexto> = {}): ViajeContexto {
  return {
    id: 'v1', tenantId: 't1', folio: 'F-1042', origen: 'Planta Zapopan', destino: 'CEDIS Monterrey', estatus: 'abierto',
    operadorId: 'o1', operadorNombre: 'Juan Pérez', operadorTelefono: '5219990000001', terminalId: null, unidadId: null,
    aceptadoEn: '2026-10-02T12:00:00.000Z', citaOrigenEn: null, citaDestinoEn: null, etaOrigenEn: null, etaDestinoEn: null, ...p,
  };
}

export interface EventoMemoria { hito: string; evento: string; detalle: Record<string, unknown> }

export function crearMemoria(opts: { viajes?: ViajeContexto[]; config?: Partial<ConfigConductor> } = {}) {
  const viajes = new Map<string, ViajeContexto>((opts.viajes ?? [viajeBase()]).map((v) => [v.id, v]));
  const hitos = new Map<string, HitoFila>();
  const mensajesVistos = new Set<string>();
  const eventos: EventoMemoria[] = [];
  const legado: Array<{ viajeId: string; sellos: string[] }> = [];
  const oficina: Array<{ hito: string; contacto: unknown }> = [];
  const config: ConfigConductor = { ...CONFIG_CONDUCTOR_DEFAULT, solicitudesMin: [...CONFIG_CONDUCTOR_DEFAULT.solicitudesMin], diasSemana: [...CONFIG_CONDUCTOR_DEFAULT.diasSemana], ...opts.config };
  const fallos = { registrar: false, config: false };
  const validaciones: Array<{ hito: string; tipo: string; pin: boolean }> = [];
  const validarResultado: { valor: Awaited<ReturnType<DepsAtender['validarHito']>> } = { valor: null };
  const evidencias: Array<{ hitoId: string; ciclo: number; tipo: string; ruta: string; sha256: string; waMessageId: string | null }> = [];
  let n = 0;

  const sembrar = (viajeId: string) => {
    for (const tipo of TIPOS_HITO) {
      if (![...hitos.values()].some((h) => h.viajeId === viajeId && h.tipo === tipo)) {
        const id = `h${++n}`;
        hitos.set(id, hitoVacio({ id, viajeId, tipo, tenantId: viajes.get(viajeId)?.tenantId ?? 't1' }));
      }
    }
  };
  const de = (viajeId: string) => TIPOS_HITO
    .map((t) => [...hitos.values()].find((h) => h.viajeId === viajeId && h.tipo === t))
    .filter(Boolean) as HitoFila[];
  const poId = (id: string) => hitos.get(id)!;
  const set = (id: string, cambios: Partial<HitoFila>) => hitos.set(id, { ...hitos.get(id)!, ...cambios });

  const deps: DepsAtender = {
    viajeDelOperador: async (tenantId, operadorId, viajeId) => {
      const v = viajes.get(viajeId);
      return v && v.tenantId === tenantId && v.operadorId === operadorId ? v : null;
    },
    config: async () => {
      if (fallos.config) throw new Error('base caída');
      return config;
    },
    asegurarHitos: async (_t, viajeId) => { sembrar(viajeId); return de(viajeId).map((h) => ({ ...h })); },
    registrarHito: async (d) => {
      if (fallos.registrar) return 'fallo';
      const h = poId(d.hito.id);
      if (!['esperado', 'escalado', 'omitido'].includes(h.estado)) return 'carrera';
      if (d.waMessageId && [...hitos.values()].some((x) => x.tenantId === h.tenantId && x.id !== h.id && (x as HitoFila & { wa?: string }).wa === d.waMessageId)) return 'carrera';
      set(h.id, {
        estado: 'recibido', fuente: d.fuente, interpretacion: d.interpretacion, mensajeEn: d.mensajeEn.toISOString(),
        recibidoEn: d.ahora.toISOString(), contactoNombre: d.contacto?.nombre ?? null, contactoArea: d.contacto?.area ?? null,
        sinContacto: false, omitidoMotivo: null, pospuestoHasta: null,
        ...({ wa: d.waMessageId } as object),
      });
      for (const o of d.omitir) {
        const x = poId(o.id);
        if (['esperado', 'escalado'].includes(x.estado)) set(o.id, { estado: 'omitido', omitidoMotivo: `inferido_por_${h.tipo}` });
      }
      return 'ok';
    },
    sincronizarLegado: async (_t, viajeId, sellos) => { if (sellos.length) legado.push({ viajeId, sellos }); },
    guardarContacto: async (h, c) => {
      const x = poId(h.id);
      if (!['recibido', 'validado'].includes(x.estado)) return 'carrera';
      set(h.id, { contactoNombre: c.nombre, contactoArea: c.area, sinContacto: false });
      return 'ok';
    },
    marcarSinContacto: async (h) => {
      if (!['recibido', 'validado'].includes(poId(h.id).estado)) return 'carrera';
      set(h.id, { sinContacto: true, contactoNombre: null, contactoArea: null });
      return 'ok';
    },
    posponerHito: async (h, minutos, ahora) => {
      const x = poId(h.id);
      if (!['esperado', 'escalado'].includes(x.estado) || x.ciclo !== h.ciclo) return 'carrera';
      set(h.id, {
        estado: 'esperado', pospuestoHasta: new Date(ahora.getTime() + minutos * 60_000).toISOString(),
        pospuestoVeces: x.pospuestoVeces + 1, ciclo: x.ciclo + 1, recordatoriosEnviados: 0, ultimoAvisoEn: null,
        escaladoEn: null, escalacionNivel: 0, escalacionAtendidaEn: null,
      });
      return 'ok';
    },
    retirarHitos: async (hs, objetivo, ahora, posponerMin) => {
      for (const h of hs) {
        const x = poId(h.id);
        if (!['recibido', 'omitido'].includes(x.estado) || x.ciclo !== h.ciclo) return 'carrera';
        set(h.id, {
          estado: 'esperado', fuente: null, interpretacion: null, mensajeEn: null, recibidoEn: null, contactoNombre: null,
          contactoArea: null, sinContacto: false, lat: null, lng: null, omitidoMotivo: null,
          pospuestoHasta: h.tipo === objetivo && posponerMin ? new Date(ahora.getTime() + posponerMin * 60_000).toISOString() : null,
          solicitadoEn: null, recordatoriosEnviados: 0, ultimoAvisoEn: null, escaladoEn: null, escalacionNivel: 0,
          escalacionAtendidaEn: null, ciclo: x.ciclo + 1, correcciones: h.tipo === objetivo ? x.correcciones + 1 : x.correcciones,
          ...({ wa: null } as object),
        });
      }
      return 'ok';
    },
    evento: async (h, evento, detalle = {}) => { eventos.push({ hito: h.id, evento, detalle }); },
    llm: async () => null,
    avisarOficina: async (a) => { oficina.push({ hito: a.hito.id, contacto: a.contacto }); return 'enviado'; },
    escalarPorProblema: async () => 'ok',
    solicitarUbicacion: async () => true,
    validarHito: async (e) => { validaciones.push({ hito: e.hito.id, tipo: e.hito.tipo, pin: Boolean(e.pin) }); return validarResultado.valor; },
    hitoLlegadaReciente: async (t, viajeId) => {
      const h = de(viajeId).filter((x) => x.tenantId === t && ['llegada_carga', 'llegada_descarga'].includes(x.tipo) && x.estado === 'recibido');
      return h.length ? { ...h[h.length - 1] } : null;
    },
    adjuntarUbicacion: async (_t, viajeId, lat, lng) => {
      const h = de(viajeId).filter((x) => x.estado === 'recibido' && x.lat === null).pop();
      if (!h) return null;
      set(h.id, { lat, lng });
      return { ...h, lat, lng };
    },
    cargarHitos: async (_t, viajeId) => de(viajeId).map((h) => ({ ...h })),
    guardarEvidencia: async (a) => {
      if (evidencias.some((x) => x.waMessageId && x.waMessageId === a.waMessageId) || evidencias.some((x) => x.hitoId === a.hito.id && x.ciclo === a.hito.ciclo && x.sha256 === a.sha256)) return 'duplicada';
      if (!['recibido', 'validado'].includes(poId(a.hito.id).estado)) return 'hito_cambio';
      evidencias.push({ hitoId: a.hito.id, ciclo: a.hito.ciclo, tipo: a.tipo, ruta: a.ruta, sha256: a.sha256, waMessageId: a.waMessageId });
      return 'ok';
    },
  };

  /** Atajo: un hito ya registrado a las `hora` (UTC, hoy 2026-10-02). */
  const registrar = (viajeId: string, tipo: TipoHito, iso: string, extra: Partial<HitoFila> = {}) => {
    sembrar(viajeId);
    const h = de(viajeId).find((x) => x.tipo === tipo)!;
    set(h.id, { estado: 'recibido', fuente: 'texto', interpretacion: 'regla', mensajeEn: iso, recibidoEn: iso, ...extra });
  };

  return { deps, hitos, de, viajes, eventos, legado, oficina, config, fallos, sembrar, registrar, mensajesVistos, validaciones, validarResultado, evidencias };
}

// ═══════════════════════════════════════════════════════════════════════════
// PUERTOS EN MEMORIA para el motor del cron.
// ═══════════════════════════════════════════════════════════════════════════

export interface EnvioMemoria { telefono: string; texto: string; plantilla: string; botones: string[]; contexto: string; tenantId: string }

export function crearPuertos(opts: {
  viajes: ViajeContexto[];
  hitos?: HitoFila[];
  configs?: Record<string, ConfigConductor | 'ilegible'>;
  avisos?: Array<AvisoReclamado & { hitoId: string; operadorId?: string | null; creado?: Date }>;
  destinatarios?: (tenantId: string, terminalId: string | null, nivel: 1 | 2) => Array<{ nombre: string; telefono: string }>;
  envio?: (e: EnvioMemoria) => { ok: true; via: 'texto' | 'botones' | 'plantilla' } | { ok: false; reintentable: boolean; mensaje: string };
}) {
  const hitos = new Map<string, HitoFila>((opts.hitos ?? []).map((h) => [h.id, { ...h }]));
  const reclamos = new Map<string, { ok: boolean | null; canal: string | null; motivo: string | null; operadorId: string | null; creado: Date }>();
  const clave = (a: Pick<NuevoAviso, 'hitoId' | 'ciclo' | 'clase' | 'nivel'>) => `${a.hitoId}|${a.ciclo}|${a.clase}|${a.nivel}`;
  for (const a of opts.avisos ?? []) {
    reclamos.set(clave(a), { ok: true, canal: 'texto', motivo: null, operadorId: a.operadorId ?? null, creado: a.creado ?? new Date('2026-10-02T12:00:00Z') });
  }
  const enviados: EnvioMemoria[] = [];
  const eventos: EventoMemoria[] = [];
  const configPorDefecto: ConfigConductor = { ...CONFIG_CONDUCTOR_DEFAULT, solicitudesMin: [...CONFIG_CONDUCTOR_DEFAULT.solicitudesMin], diasSemana: [...CONFIG_CONDUCTOR_DEFAULT.diasSemana] };
  let sembrados = 0;

  const puertos: PuertosConductor = {
    sembrar: async () => sembrados,
    viajesActivos: async (limite) => opts.viajes.filter((v) => v.estatus === 'abierto' && v.aceptadoEn).slice(0, limite),
    hitosDe: async (ids) => [...hitos.values()].filter((h) => ids.includes(h.viajeId)).map((h) => ({ ...h })),
    avisosDe: async (ids) => [...reclamos.entries()]
      .map(([k, v]) => { const [hitoId, ciclo, clase, nivel] = k.split('|'); return { hitoId, ciclo: Number(ciclo), clase: clase as AvisoReclamado['clase'], nivel: Number(nivel), v }; })
      .filter((a) => ids.includes(a.hitoId)).map(({ v: _v, ...a }) => a),
    enviadosHoyPorChofer: async (ops, desde) => {
      const c: Record<string, number> = {};
      for (const [k, v] of reclamos) {
        const clase = k.split('|')[2];
        if (v.operadorId && ops.includes(v.operadorId) && v.creado >= desde && (clase === 'solicitud' || clase === 'recordatorio')) c[v.operadorId] = (c[v.operadorId] ?? 0) + 1;
      }
      return c;
    },
    configDe: async (t) => {
      const c = opts.configs?.[t];
      if (c === 'ilegible') throw new Error('base caída');
      return c ?? configPorDefecto;
    },
    reclamar: async (a) => {
      if (reclamos.has(clave(a))) return 'perdido';
      reclamos.set(clave(a), { ok: null, canal: null, motivo: null, operadorId: a.operadorId, creado: new Date() });
      return 'ganado';
    },
    cerrarAviso: async (a, c: CierreAviso) => {
      const r = reclamos.get(clave(a));
      if (r) { r.ok = c.ok; r.canal = c.canal; r.motivo = c.motivo; }
    },
    liberarAviso: async (a) => { if (reclamos.get(clave(a))?.ok === null) reclamos.delete(clave(a)); },
    anotarAvisoChofer: async (h, ahora) => {
      const x = hitos.get(h.id);
      if (x) { x.recordatoriosEnviados++; x.ultimoAvisoEn = ahora.toISOString(); x.solicitadoEn = x.solicitadoEn ?? ahora.toISOString(); }
    },
    marcarEscalado: async (h, nivel, ahora) => {
      const x = hitos.get(h.id);
      if (!x || !['esperado', 'escalado'].includes(x.estado)) return false;
      x.estado = 'escalado'; x.escaladoEn = x.escaladoEn ?? ahora.toISOString(); x.escalacionNivel = Math.max(x.escalacionNivel, nivel);
      return true;
    },
    enviar: async (telefono, m, contexto, tenantId) => {
      const e: EnvioMemoria = { telefono, texto: m.texto, plantilla: m.plantilla.nombre, botones: m.botones.map((b) => b.id), contexto, tenantId };
      const r = opts.envio ? opts.envio(e) : { ok: true as const, via: 'texto' as const };
      if (r.ok) {
        enviados.push(e);
        return { ok: true, via: r.via, id: 'wamid.X', motivo: 'ventana_abierta', ventana: 'abierta' };
      }
      return { ok: false, motivo: 'rechazo_no_ventana', mensaje: r.mensaje, fueraDeVentana: false, reintentable: r.reintentable, ventana: 'abierta' };
    },
    destinatarios: async (t, term, nivel) => (opts.destinatarios ? opts.destinatarios(t, term, nivel) : [{ nombre: 'Patio', telefono: '5219990000099' }]),
    ubicacion: async () => 'sin ubicación reciente',
    evento: async (h, evento, detalle) => { eventos.push({ hito: h.id, evento, detalle }); },
  };
  return { puertos, hitos, reclamos, enviados, eventos, definirSembrados: (n: number) => { sembrados = n; } };
}
