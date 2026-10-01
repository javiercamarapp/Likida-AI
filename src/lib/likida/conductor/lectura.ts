import { normalizarTelefonoWa } from '../wa_ventana';
import { validarConfigConductor, type ConfigConductor } from './config';
import type { ContactoTrafico } from './escalamiento';
import { ESTADOS_HITO, TIPOS_HITO, type EstadoHito, type HitoFila, type TipoHito } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// LA FORMA PÚBLICA DE LOS HITOS PARA EL SISTEMA DEL CLIENTE (/v1/hitos,
// /v1/hitos/eventos) y la validación de las citas (/v1/viajes/{id}/citas).
// Puro: las consultas viven en repo.ts (leerHitos, leerEventos, guardarCitas).
//
// Las llaves del JSON van en español (como el resto de /v1). Aquí NO salen
// dinero ni el texto crudo que escribió el chofer: sí el contacto en andén y las
// coordenadas, que son justo el dato que el cliente pidió.
// ═══════════════════════════════════════════════════════════════════════════

export interface HitoApi {
  id: string;
  viajeId: string;
  folio: string | null;
  tipo: TipoHito;
  estado: EstadoHito;
  fuente: string | null;
  interpretacion: string | null;
  /** La hora del MENSAJE del chofer (la que él vivió). No es telemetría del evento físico. */
  horaMensaje: string | null;
  /** Cuándo la recibió Likida. */
  recibidoEn: string | null;
  validadoEn: string | null;
  validadoPor: string | null;
  contacto: { nombre: string; area: string | null } | null;
  sinContacto: boolean;
  coordenadas: { lat: number; lng: number } | null;
  omitidoMotivo: string | null;
  recordatoriosEnviados: number;
  escaladoEn: string | null;
  escalacionNivel: number;
  atendidaEn: string | null;
  correcciones: number;
  ciclo: number;
}

export function aHitoApi(h: HitoFila, folio: string | null): HitoApi {
  return {
    id: h.id, viajeId: h.viajeId, folio, tipo: h.tipo, estado: h.estado,
    fuente: h.fuente, interpretacion: h.interpretacion, horaMensaje: h.mensajeEn, recibidoEn: h.recibidoEn,
    validadoEn: h.validadoEn, validadoPor: h.validadoPor,
    contacto: h.contactoNombre ? { nombre: h.contactoNombre, area: h.contactoArea } : null,
    sinContacto: h.sinContacto,
    coordenadas: h.lat !== null && h.lng !== null ? { lat: h.lat, lng: h.lng } : null,
    omitidoMotivo: h.omitidoMotivo, recordatoriosEnviados: h.recordatoriosEnviados,
    escaladoEn: h.escaladoEn, escalacionNivel: h.escalacionNivel, atendidaEn: h.escalacionAtendidaEn,
    correcciones: h.correcciones, ciclo: h.ciclo,
  };
}

export interface FiltrosHitos {
  viajeId?: string;
  folio?: string;
  estado?: EstadoHito;
  tipo?: TipoHito;
  /** Solo lo actualizado desde este instante (sincronización incremental). */
  desde?: string;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valida los filtros de la query; devuelve el error en palabras o los filtros limpios. */
export function leerFiltrosHitos(url: string): { ok: FiltrosHitos } | { error: string } {
  const q = new URL(url).searchParams;
  const f: FiltrosHitos = {};
  const viajeId = q.get('viajeId');
  if (viajeId !== null) {
    if (!UUID.test(viajeId)) return { error: '`viajeId` tiene que ser un uuid.' };
    f.viajeId = viajeId.toLowerCase();
  }
  const folio = q.get('folio');
  if (folio !== null) {
    if (folio.trim() === '' || folio.length > 64) return { error: '`folio` tiene que tener entre 1 y 64 caracteres.' };
    f.folio = folio.trim();
  }
  const estado = q.get('estado');
  if (estado !== null) {
    if (!(ESTADOS_HITO as readonly string[]).includes(estado)) return { error: `\`estado\` tiene que ser uno de: ${ESTADOS_HITO.join(', ')}.` };
    f.estado = estado as EstadoHito;
  }
  const tipo = q.get('tipo');
  if (tipo !== null) {
    if (!(TIPOS_HITO as readonly string[]).includes(tipo)) return { error: `\`tipo\` tiene que ser uno de: ${TIPOS_HITO.join(', ')}.` };
    f.tipo = tipo as TipoHito;
  }
  const desde = q.get('desde');
  if (desde !== null) {
    if (Number.isNaN(Date.parse(desde)) || !/^\d{4}-\d{2}-\d{2}T/.test(desde)) return { error: '`desde` tiene que ser una fecha-hora ISO (2026-10-02T08:00:00-06:00).' };
    f.desde = new Date(desde).toISOString();
  }
  return { ok: f };
}

export interface EventoApi {
  id: number;
  viajeId: string;
  hitoId: string;
  tipoHito: TipoHito;
  evento: string;
  detalle: Record<string, unknown>;
  creadoEn: string;
}

// ── Citas y ETA ─────────────────────────────────────────────────────────────

export interface CambioCitas {
  cita_origen_en?: string | null;
  cita_destino_en?: string | null;
  eta_origen_en?: string | null;
  eta_destino_en?: string | null;
}

const CAMPOS_CITA: Record<string, keyof CambioCitas> = {
  citaOrigen: 'cita_origen_en', citaDestino: 'cita_destino_en', etaOrigen: 'eta_origen_en', etaDestino: 'eta_destino_en',
};

/**
 * Valida el cuerpo de `PUT /v1/viajes/{id}/citas`. Solo las cuatro llaves conocidas;
 * `null` borra el valor; una fecha-hora con zona horaria explícita (sin ella,
 * «las 8:00» sería de un huso que nadie declaró) y dentro de un rango sensato.
 */
export function validarCitas(cuerpo: unknown, ahora: Date = new Date()): { ok: CambioCitas } | { error: string } {
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) return { error: 'El cuerpo tiene que ser un objeto JSON.' };
  const o = cuerpo as Record<string, unknown>;
  const cambio: CambioCitas = {};
  for (const [llave, columna] of Object.entries(CAMPOS_CITA)) {
    if (!(llave in o)) continue;
    const v = o[llave];
    if (v === null) { cambio[columna] = null; continue; }
    if (typeof v !== 'string' || v.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}[0-9:.]{0,10}(?:Z|[+-]\d{2}:\d{2})$/.test(v)) {
      return { error: `\`${llave}\` tiene que ser una fecha-hora ISO con zona horaria (2026-10-02T08:00:00-06:00) o null.` };
    }
    const t = Date.parse(v);
    if (Number.isNaN(t)) return { error: `\`${llave}\` no es una fecha válida.` };
    if (t < ahora.getTime() - 30 * 86_400_000 || t > ahora.getTime() + 400 * 86_400_000) {
      return { error: `\`${llave}\` queda fuera de un rango razonable (de hace 30 días a 400 días adelante).` };
    }
    cambio[columna] = new Date(t).toISOString();
  }
  if (Object.keys(cambio).length === 0) {
    return { error: 'Manda al menos una de: citaOrigen, citaDestino, etaOrigen, etaDestino.' };
  }
  return { ok: cambio };
}

// ── La config por flota y los contactos de escalamiento (PUT /v1/conductor/config) ──

/** Las llaves de config que acepta el PUT (camelCase, las mismas de `ConfigConductor`). */
const LLAVES_CONFIG: readonly (keyof ConfigConductor)[] = [
  'activo', 'solicitudesMin', 'escalarTrasMin', 'segundoNivelMin', 'horaInicio', 'horaFin', 'diasSemana', 'topeDiarioChofer',
  'anticipoCitaMin', 'esperaSinCitaMin', 'esperaCargaMin', 'trayectoSinEtaMin', 'esperaDescargaMin', 'regresoMin', 'posponerMin',
  'ventanaCorreccionMin', 'usarLlm', 'avisarOficinaLlegada', 'avisarOficinaSalida', 'confirmarAlChofer',
];

export const MAX_CONTACTOS_TRAFICO = 20;

export interface CambioConfig {
  /** La config COMPLETA ya validada (la actual + lo que mandó el integrador). */
  config: ConfigConductor;
  /** `undefined` = no tocar los contactos; una lista = REEMPLAZA todos los de la flota. */
  contactos?: ContactoTrafico[];
}

/**
 * Valida el cuerpo de `PUT /v1/conductor/config` contra la config ACTUAL: se manda solo lo que cambia.
 * Una llave desconocida es 400 (un typo no puede dejar a la flota corriendo con la escalera que creía
 * haber cambiado, el mismo criterio de `config_tenant_valida`).
 */
export function validarCambioConfig(cuerpo: unknown, actual: ConfigConductor): { ok: CambioConfig } | { error: string } {
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) return { error: 'El cuerpo tiene que ser un objeto JSON.' };
  const o = cuerpo as Record<string, unknown>;
  const desconocidas = Object.keys(o).filter((k) => k !== 'contactos' && !(LLAVES_CONFIG as readonly string[]).includes(k));
  if (desconocidas.length > 0) {
    return { error: `Llaves desconocidas: ${desconocidas.slice(0, 5).join(', ')}. Las válidas son: ${[...LLAVES_CONFIG, 'contactos'].join(', ')}.` };
  }
  if (Object.keys(o).length === 0) return { error: 'Manda al menos una llave de configuración o `contactos`.' };

  const fusion: Partial<ConfigConductor> = { ...actual };
  for (const k of LLAVES_CONFIG) {
    if (k in o) (fusion as Record<string, unknown>)[k] = o[k];
  }
  const v = validarConfigConductor(fusion);
  if ('error' in v) return { error: v.error };

  let contactos: ContactoTrafico[] | undefined;
  if ('contactos' in o) {
    if (!Array.isArray(o.contactos)) return { error: '`contactos` tiene que ser una lista.' };
    if (o.contactos.length > MAX_CONTACTOS_TRAFICO) return { error: `\`contactos\` admite hasta ${MAX_CONTACTOS_TRAFICO}.` };
    contactos = [];
    const vistos = new Set<string>();
    for (const [i, c] of o.contactos.entries()) {
      if (!c || typeof c !== 'object' || Array.isArray(c)) return { error: `contactos[${i}] tiene que ser un objeto.` };
      const x = c as Record<string, unknown>;
      const nivel = x.nivel;
      if (nivel !== 1 && nivel !== 2) return { error: `contactos[${i}].nivel tiene que ser 1 (patio responsable) o 2 (jefe general).` };
      const nombre = typeof x.nombre === 'string' ? x.nombre.replace(/\s+/g, ' ').trim() : '';
      if (nombre.length < 1 || nombre.length > 80) return { error: `contactos[${i}].nombre tiene que tener entre 1 y 80 caracteres.` };
      const tel = typeof x.telefono === 'string' || typeof x.telefono === 'number' ? normalizarTelefonoWa(String(x.telefono)) : '';
      // Diez dígitos mexicanos se completan con la lada 52; el resto debe traer ya la forma 52 + 10.
      const telefono = /^\d{10}$/.test(tel) ? `52${tel}` : tel;
      if (!/^52\d{10}$/.test(telefono)) return { error: `contactos[${i}].telefono tiene que ser un número mexicano de 10 dígitos (o 52 + 10).` };
      let terminalId: string | null = null;
      if (x.terminalId !== undefined && x.terminalId !== null) {
        if (typeof x.terminalId !== 'string' || !UUID.test(x.terminalId)) return { error: `contactos[${i}].terminalId tiene que ser un uuid o null.` };
        terminalId = x.terminalId.toLowerCase();
      }
      const clave = `${terminalId ?? ''}|${nivel}|${telefono}`;
      if (vistos.has(clave)) return { error: `contactos[${i}] repite el mismo teléfono, nivel y terminal.` };
      vistos.add(clave);
      contactos.push({ nivel, nombre, telefono, terminalId });
    }
  }
  return { ok: { config: v.ok, contactos } };
}
