import type { TipoHito } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// CONVERSACIONES CON OPERADORES — el modelo de vista (puro, sin I/O).
//
// De los viajes vivos y sus hitos arma la LISTA (estado de respuesta, tiempo sin respuesta, urgencia por cita) y, de las
// tablas de la bitácora del agente, el HILO de un viaje. NO existe una tabla con el texto de cada mensaje: el hilo se
// reconstruye de lo que el sistema sí guardó (avisos enviados por clase, hitos con el texto del operador, veredictos
// contra la ubicación, eventos, escalaciones). Lo que no se guardó no se pinta.
// ═══════════════════════════════════════════════════════════════════════════

export type EstadoConv = 'escalado' | 'sin_respuesta' | 'sin_telefono' | 'acepto';
export type Prioridad = 'alta' | 'media' | 'baja' | 'sin_cita';

/** Una cita a menos de esto (o ya vencida) es urgente; a menos de un día, media. */
export const MINUTOS_PRIORIDAD_ALTA = 4 * 60;
export const MINUTOS_PRIORIDAD_MEDIA = 24 * 60;

export interface ViajeConv {
  id: string;
  folio: string | null;
  origen: string | null;
  destino: string | null;
  operadorId: string;
  operadorNombre: string | null;
  terminalId: string | null;
  terminalNombre: string | null;
  avisadoEn: string | null;
  aceptadoEn: string | null;
  aceptadoOrigen: string | null;
  escaladoEn: string | null;
  avisosEnviados: number;
  citaOrigenEn: string | null;
  citaDestinoEn: string | null;
  /** `null` = no se leyó el teléfono: no se afirma «sin teléfono». */
  operadorSinTelefono: boolean | null;
}

export interface HitoEstadoConv { viajeId: string; tipo: TipoHito; estado: string }

export interface FilaConv {
  viaje: ViajeConv;
  estado: EstadoConv;
  /** Minutos desde el aviso sin que el operador aceptara. `null` si no aplica (aceptó, sin teléfono) o no hay fecha de aviso. */
  minutosSinRespuesta: number | null;
  prioridad: Prioridad;
  /** Minutos a la cita pendiente (negativo = ya pasó). `null` = sin cita pendiente. */
  minutosACita: number | null;
  citaTipo: 'carga' | 'descarga' | null;
  /** Hay un hito escalado a tráfico (aunque el operador haya aceptado el viaje). */
  hitoEscalado: boolean;
}

const ms = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

const resuelto = (e: string) => e === 'recibido' || e === 'validado';

/** La cita que todavía importa: la de carga hasta que llega a cargar; después la de descarga. Sin hito leído no se supone nada. */
function citaPendiente(v: ViajeConv, hitos: readonly HitoEstadoConv[]): { en: number; tipo: 'carga' | 'descarga' } | null {
  const est = (t: TipoHito) => hitos.find((h) => h.tipo === t)?.estado;
  const origen = ms(v.citaOrigenEn);
  if (origen !== null && !resuelto(est('llegada_carga') ?? 'esperado')) return { en: origen, tipo: 'carga' };
  const destino = ms(v.citaDestinoEn);
  if (destino !== null && !resuelto(est('llegada_descarga') ?? 'esperado')) return { en: destino, tipo: 'descarga' };
  return null;
}

export function estadoDe(v: ViajeConv, hitos: readonly HitoEstadoConv[]): EstadoConv | null {
  const hitoEscalado = hitos.some((h) => h.estado === 'escalado');
  if (v.escaladoEn && !v.aceptadoEn) return 'escalado';
  if (hitoEscalado) return 'escalado';
  if (v.aceptadoEn) return 'acepto';
  if (v.operadorSinTelefono === true) return 'sin_telefono';
  if (v.avisadoEn) return 'sin_respuesta';
  // Sin aviso y con teléfono: todavía no hay conversación que mostrar.
  return null;
}

export function prioridadDe(minutosACita: number | null): Prioridad {
  if (minutosACita === null) return 'sin_cita';
  if (minutosACita <= MINUTOS_PRIORIDAD_ALTA) return 'alta';
  if (minutosACita <= MINUTOS_PRIORIDAD_MEDIA) return 'media';
  return 'baja';
}

const RANGO_ESTADO: Record<EstadoConv, number> = { escalado: 0, sin_respuesta: 1, sin_telefono: 2, acepto: 3 };
const RANGO_PRIORIDAD: Record<Prioridad, number> = { alta: 0, media: 1, baja: 2, sin_cita: 3 };

/**
 * Arma la lista: primero los que NO responden (escalados, sin respuesta, sin teléfono), por urgencia de cita y luego por
 * tiempo sin respuesta (el más viejo primero); después los que aceptaron, por cita más próxima.
 */
export function armarListaConv(viajes: readonly ViajeConv[], hitos: readonly HitoEstadoConv[], ahora: Date): FilaConv[] {
  const porViaje = new Map<string, HitoEstadoConv[]>();
  for (const h of hitos) porViaje.set(h.viajeId, [...(porViaje.get(h.viajeId) ?? []), h]);
  const filas: FilaConv[] = [];
  for (const v of viajes) {
    const hs = porViaje.get(v.id) ?? [];
    const estado = estadoDe(v, hs);
    if (estado === null) continue;
    const cita = citaPendiente(v, hs);
    const minutosACita = cita ? Math.round((cita.en - ahora.getTime()) / 60_000) : null;
    const aviso = ms(v.avisadoEn);
    const sinResp = !v.aceptadoEn && aviso !== null && estado !== 'sin_telefono' ? Math.max(0, Math.round((ahora.getTime() - aviso) / 60_000)) : null;
    filas.push({
      viaje: v, estado, minutosSinRespuesta: sinResp, prioridad: prioridadDe(minutosACita), minutosACita, citaTipo: cita?.tipo ?? null,
      hitoEscalado: hs.some((h) => h.estado === 'escalado'),
    });
  }
  return filas.sort((a, b) => {
    const noResp = (f: FilaConv) => (f.estado === 'acepto' && !f.hitoEscalado ? 1 : 0);
    if (noResp(a) !== noResp(b)) return noResp(a) - noResp(b);
    if (noResp(a) === 0) {
      if (RANGO_PRIORIDAD[a.prioridad] !== RANGO_PRIORIDAD[b.prioridad]) return RANGO_PRIORIDAD[a.prioridad] - RANGO_PRIORIDAD[b.prioridad];
      const ta = a.minutosSinRespuesta ?? -1, tb = b.minutosSinRespuesta ?? -1;
      if (ta !== tb) return tb - ta;
      if (RANGO_ESTADO[a.estado] !== RANGO_ESTADO[b.estado]) return RANGO_ESTADO[a.estado] - RANGO_ESTADO[b.estado];
    } else {
      const ca = a.minutosACita ?? Number.POSITIVE_INFINITY, cb = b.minutosACita ?? Number.POSITIVE_INFINITY;
      if (ca !== cb) return ca - cb;
    }
    return a.viaje.id < b.viaje.id ? -1 : 1;
  });
}

export function filtrarConv(filas: readonly FilaConv[], estado: EstadoConv | ''): FilaConv[] {
  return estado === '' ? [...filas] : filas.filter((f) => f.estado === estado);
}

export const ESTADOS_CONV: readonly EstadoConv[] = ['escalado', 'sin_respuesta', 'sin_telefono', 'acepto'];

export function conteosConv(filas: readonly FilaConv[]): Record<EstadoConv, number> {
  const c: Record<EstadoConv, number> = { escalado: 0, sin_respuesta: 0, sin_telefono: 0, acepto: 0 };
  for (const f of filas) c[f.estado] += 1;
  return c;
}

// ── El hilo ────────────────────────────────────────────────────────────────

export interface AvisoHilo { id: string; hitoTipo: TipoHito | null; clase: string; nivel: number; ok: boolean | null; canal: string | null; motivo: string | null; ult4: string | null; en: string }
export interface HitoHilo {
  id: string; tipo: TipoHito; estado: string; fuente: string | null; mensajeEn: string | null; recibidoEn: string | null; texto: string | null;
  lat: number | null; lng: number | null; conFoto: boolean; contacto: string | null; sinContacto: boolean; validadoEn: string | null; validadoPor: string | null;
  omitidoMotivo: string | null; escaladoEn: string | null; escalacionNivel: number; atendidaEn: string | null;
}
export interface ValidacionHilo { hitoId: string; resultado: 'validado' | 'sin_coincidencia' | 'sin_dato'; motivo: string | null; fuente: string | null; distanciaM: number | null; toleranciaM: number; radioM: number | null; medidaEn: string | null; en: string }
export interface EventoHilo { id: number; hitoTipo: TipoHito; evento: string; en: string }
export interface EscalacionHilo { id: string; destino: string; motivo: string; estado: 'abierta' | 'atendida'; resumen: string; en: string; atendidaEn: string | null; nota: string | null }
export interface ContactoAtencion { nombre: string; nivel: 1 | 2; alcance: 'terminal' | 'flota'; ult4: string }

export type EntradaHilo =
  | { clave: string; en: string; actor: 'agente'; tipo: 'aviso_viaje'; avisos: number }
  | { clave: string; en: string; actor: 'agente'; tipo: 'aviso'; aviso: AvisoHilo }
  | { clave: string; en: string; actor: 'operador'; tipo: 'acepto'; origen: string | null }
  | { clave: string; en: string; actor: 'operador'; tipo: 'hito'; hito: HitoHilo }
  | { clave: string; en: string; actor: 'sistema'; tipo: 'validacion'; validacion: ValidacionHilo; hitoTipo: TipoHito | null }
  | { clave: string; en: string; actor: 'sistema'; tipo: 'escalado_viaje' }
  | { clave: string; en: string; actor: 'sistema'; tipo: 'escalado_hito'; hito: HitoHilo }
  | { clave: string; en: string; actor: 'sistema'; tipo: 'atendido_hito'; hito: HitoHilo }
  | { clave: string; en: string; actor: 'sistema'; tipo: 'evento'; evento: EventoHilo }
  | { clave: string; en: string; actor: 'trafico'; tipo: 'escalacion'; escalacion: EscalacionHilo }
  | { clave: string; en: string; actor: 'trafico'; tipo: 'escalacion_atendida'; escalacion: EscalacionHilo };

/** Eventos que ya tienen su propia entrada (el hito recibido, validado o escalado se pinta con su dato): no se duplican. */
const EVENTOS_YA_PINTADOS = new Set(['solicitado', 'recibido', 'validado', 'escalado']);

export interface DatosHilo {
  viaje: ViajeConv;
  hitos: HitoHilo[];
  avisos: AvisoHilo[];
  validaciones: ValidacionHilo[];
  eventos: EventoHilo[];
  escalaciones: EscalacionHilo[];
}

/** El hilo en orden cronológico (lo más viejo arriba, como un chat). Entradas sin fecha válida se omiten: no se les inventa una. */
export function armarHilo(d: DatosHilo): EntradaHilo[] {
  const e: EntradaHilo[] = [];
  const v = d.viaje;
  const tipoDe = new Map(d.hitos.map((h) => [h.id, h.tipo] as const));
  if (v.avisadoEn) e.push({ clave: 'aviso-viaje', en: v.avisadoEn, actor: 'agente', tipo: 'aviso_viaje', avisos: v.avisosEnviados });
  for (const a of d.avisos) e.push({ clave: `aviso-${a.id}`, en: a.en, actor: 'agente', tipo: 'aviso', aviso: a });
  if (v.aceptadoEn) e.push({ clave: 'acepto', en: v.aceptadoEn, actor: 'operador', tipo: 'acepto', origen: v.aceptadoOrigen });
  if (v.escaladoEn) e.push({ clave: 'escalado-viaje', en: v.escaladoEn, actor: 'sistema', tipo: 'escalado_viaje' });
  for (const h of d.hitos) {
    const en = h.mensajeEn ?? h.recibidoEn;
    if (en && (h.estado === 'recibido' || h.estado === 'validado')) e.push({ clave: `hito-${h.id}`, en, actor: 'operador', tipo: 'hito', hito: h });
    if (h.escaladoEn) e.push({ clave: `esc-hito-${h.id}`, en: h.escaladoEn, actor: 'sistema', tipo: 'escalado_hito', hito: h });
    if (h.atendidaEn) e.push({ clave: `atn-hito-${h.id}`, en: h.atendidaEn, actor: 'sistema', tipo: 'atendido_hito', hito: h });
  }
  for (const val of d.validaciones) e.push({ clave: `val-${val.hitoId}`, en: val.en, actor: 'sistema', tipo: 'validacion', validacion: val, hitoTipo: tipoDe.get(val.hitoId) ?? null });
  for (const ev of d.eventos) {
    if (EVENTOS_YA_PINTADOS.has(ev.evento)) continue;
    e.push({ clave: `ev-${ev.id}`, en: ev.en, actor: 'sistema', tipo: 'evento', evento: ev });
  }
  for (const es of d.escalaciones) {
    e.push({ clave: `escalacion-${es.id}`, en: es.en, actor: 'trafico', tipo: 'escalacion', escalacion: es });
    if (es.atendidaEn) e.push({ clave: `escalacion-ok-${es.id}`, en: es.atendidaEn, actor: 'trafico', tipo: 'escalacion_atendida', escalacion: es });
  }
  return e.filter((x) => Number.isFinite(Date.parse(x.en))).sort((a, b) => Date.parse(a.en) - Date.parse(b.en) || (a.clave < b.clave ? -1 : 1));
}

/** A quién le toca atender: los contactos de tráfico del patio del viaje (nivel 1) y el jefe general (nivel 2); los de toda la flota respaldan. */
export function contactosDeAtencion(contactos: ReadonlyArray<{ nombre: string; nivel: 1 | 2; terminalId: string | null; ult4: string }>, terminalId: string | null): ContactoAtencion[] {
  return contactos
    .filter((c) => c.terminalId === null || (terminalId !== null && c.terminalId === terminalId))
    .map((c) => ({ nombre: c.nombre, nivel: c.nivel, alcance: c.terminalId === null ? ('flota' as const) : ('terminal' as const), ult4: c.ult4 }))
    .sort((a, b) => a.nivel - b.nivel || (a.alcance === b.alcance ? 0 : a.alcance === 'terminal' ? -1 : 1) || a.nombre.localeCompare(b.nombre));
}
