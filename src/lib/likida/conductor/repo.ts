import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { getZonaHorariaTenant } from '../repo';
import { acotada } from '../presupuesto';
import { exigir, traerPorIds } from '../pg';
import {
  TIPOS_HITO, MINUTOS_SILENCIO_JEFE, MINUTOS_SILENCIO_RECUPERADA,
  type Contacto, type FuenteHito, type HitoFila, type InterpretacionHito, type TipoHito,
} from './tipos';
import type { LegadoSello } from './maquina';
import { CONFIG_CONDUCTOR_DEFAULT, validarConfigConductor, zonaOCdmx, type ConfigConductor, type PerfilSeguimiento } from './config';
import { MOTIVO_FUERA_DE_PERFIL, hitoEnPerfil } from './perfil';
import { aHitoApi, type EventoApi, type FiltrosHitos, type HitoApi, type CambioCitas } from './lectura';
import type { AvisoReclamado } from './planificador';
import type { ContactoTrafico } from './escalamiento';
import type { EpisodioFila } from './senal_vida';
import type { EstadoTransito } from './estados_transito';
import type { MotivoSenalVida } from './solicitudes';
import type { RespuestaSenalVida } from './tipos';
import type { FiltrosTablero } from './repo_validacion';
import type { CriterioSitio } from './sitio_derivado';
import { HORAS_GPS_RECIENTE, type DatosPreflight } from './preflight_piloto';

// ═══════════════════════════════════════════════════════════════════════════
// EL ACCESO A DATOS DEL AGENTE 5 (viaje_hito y sus bitácoras, 0380).
//
// Todo UPDATE es CONDICIONAL (`... WHERE estado IN (...)` y, donde importa, el
// ciclo): el candado vive en Postgres, no en lo que este proceso leyó hace un
// momento. Cero filas afectadas NO es un error: es que otro mensaje u otra
// corrida ganó, y se reporta como `carrera`.
//
// supabase-js reporta los errores POR VALOR: aquí se comprueban todos. Las
// lecturas LANZAN (una base caída no es «no hay hitos»); las escrituras devuelven
// 'fallo' para que quien responde no finja una anotación que no existió.
// ═══════════════════════════════════════════════════════════════════════════

type Fila = Record<string, unknown>;

export const COLUMNAS_HITO =
  'id, tenant_id, viaje_id, tipo, estado, ciclo, fuente, interpretacion, mensaje_en, recibido_en, contacto_nombre, contacto_area, sin_contacto, ' +
  'lat, lng, evidencia_ruta, validado_en, validado_por, omitido_motivo, pospuesto_hasta, pospuesto_veces, correcciones, solicitado_en, ' +
  'recordatorios_enviados, ultimo_aviso_en, escalado_en, escalacion_nivel, escalacion_atendida_en';

const s = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function filaAHito(f: Fila): HitoFila {
  return {
    id: String(f.id),
    tenantId: String(f.tenant_id),
    viajeId: String(f.viaje_id),
    tipo: f.tipo as TipoHito,
    estado: f.estado as HitoFila['estado'],
    ciclo: Number(f.ciclo ?? 1),
    fuente: s(f.fuente) as FuenteHito | null,
    interpretacion: s(f.interpretacion) as InterpretacionHito | null,
    mensajeEn: s(f.mensaje_en),
    recibidoEn: s(f.recibido_en),
    contactoNombre: s(f.contacto_nombre),
    contactoArea: s(f.contacto_area),
    sinContacto: f.sin_contacto === true,
    lat: n(f.lat),
    lng: n(f.lng),
    evidenciaRuta: s(f.evidencia_ruta),
    validadoEn: s(f.validado_en),
    validadoPor: s(f.validado_por) as HitoFila['validadoPor'],
    omitidoMotivo: s(f.omitido_motivo),
    pospuestoHasta: s(f.pospuesto_hasta),
    pospuestoVeces: Number(f.pospuesto_veces ?? 0),
    correcciones: Number(f.correcciones ?? 0),
    solicitadoEn: s(f.solicitado_en),
    recordatoriosEnviados: Number(f.recordatorios_enviados ?? 0),
    ultimoAvisoEn: s(f.ultimo_aviso_en),
    escaladoEn: s(f.escalado_en),
    escalacionNivel: Number(f.escalacion_nivel ?? 0),
    escalacionAtendidaEn: s(f.escalacion_atendida_en),
  };
}

const ordenar = (hs: HitoFila[]) => [...hs].sort((a, b) => TIPOS_HITO.indexOf(a.tipo) - TIPOS_HITO.indexOf(b.tipo));

export async function cargarHitos(tenantId: string, viajeId: string): Promise<HitoFila[]> {
  const res = await acotada(supabaseAdmin()
    .from('viaje_hito').select(COLUMNAS_HITO)
    .eq('tenant_id', tenantId).eq('viaje_id', viajeId), 'conductor.hitos');
  const filas = (exigir(res as never, 'conductor.hitos') ?? []) as unknown as Fila[];
  return ordenar(filas.map(filaAHito));
}

/** El perfil de la flota. Sin fila, sin la columna (0801 sin aplicar) o con un valor desconocido: `completo`, el comportamiento de siempre. */
async function leerPerfilSeguimiento(tenantId: string): Promise<PerfilSeguimiento> {
  const res = await acotada(supabaseAdmin()
    .from('agente_conductor_config').select('perfil_seguimiento').eq('tenant_id', tenantId).maybeSingle(), 'conductor.perfil');
  if (res.error) return 'completo';
  const v = (res.data as { perfil_seguimiento?: string | null } | null)?.perfil_seguimiento;
  return v === 'esenciales' ? 'esenciales' : 'completo';
}

/** Los cinco hitos del viaje, creándolos si faltan (idempotente: unique (viaje, tipo)). */
export async function asegurarHitos(tenantId: string, viajeId: string): Promise<HitoFila[]> {
  const actuales = await cargarHitos(tenantId, viajeId);
  if (actuales.length >= TIPOS_HITO.length) return actuales;
  const faltan = TIPOS_HITO.filter((t) => !actuales.some((h) => h.tipo === t));
  // T-A5-08: los hitos que el perfil de la flota no sigue nacen omitidos (igual que la siembra de SQL, 0801).
  const perfil = await leerPerfilSeguimiento(tenantId);
  const res = await acotada(supabaseAdmin()
    .from('viaje_hito')
    .upsert(faltan.map((tipo) => (hitoEnPerfil(perfil, tipo)
      ? { tenant_id: tenantId, viaje_id: viajeId, tipo }
      : { tenant_id: tenantId, viaje_id: viajeId, tipo, estado: 'omitido', omitido_motivo: MOTIVO_FUERA_DE_PERFIL })),
    { onConflict: 'viaje_id,tipo', ignoreDuplicates: true }), 'conductor.asegurar');
  if (res.error) throw new Error(`conductor.asegurar: ${res.error.message}`);
  return cargarHitos(tenantId, viajeId);
}

export interface ViajeContexto {
  id: string;
  tenantId: string;
  folio: string | null;
  origen: string | null;
  destino: string | null;
  estatus: string;
  operadorId: string;
  operadorNombre: string | null;
  operadorTelefono: string | null;
  terminalId: string | null;
  unidadId: string | null;
  aceptadoEn: string | null;
  /** 'importacion' = el viaje entró por archivo/TMS y lo acepta el sistema (T-A5-05: el motor no inventa anclas para él). */
  aceptadoOrigen?: string | null;
  citaOrigenEn: string | null;
  citaDestinoEn: string | null;
  etaOrigenEn: string | null;
  etaDestinoEn: string | null;
  /** T-A5-14 (0802): referencia de despacho del TMS, normalizada; con ella el GPS se liga al viaje sin adivinar por unidad + ventana. */
  despachoRef?: string | null;
}

export const COLUMNAS_VIAJE_CTX =
  'id, tenant_id, folio, origen, destino, estatus, operador_id, terminal_id, unidad_id, aceptado_en, aceptado_origen, cita_origen_en, cita_destino_en, eta_origen_en, eta_destino_en, despacho_ref, operador:operador_id(nombre, telefono)';

export function filaAViajeCtx(f: Fila): ViajeContexto {
  const rel = f.operador as { nombre?: string; telefono?: string } | Array<{ nombre?: string; telefono?: string }> | null;
  const op = Array.isArray(rel) ? rel[0] : rel;
  return {
    id: String(f.id),
    tenantId: String(f.tenant_id),
    folio: s(f.folio),
    origen: s(f.origen),
    destino: s(f.destino),
    estatus: String(f.estatus ?? ''),
    operadorId: String(f.operador_id),
    operadorNombre: op?.nombre ?? null,
    operadorTelefono: op?.telefono ?? null,
    terminalId: s(f.terminal_id),
    unidadId: s(f.unidad_id),
    aceptadoEn: s(f.aceptado_en),
    aceptadoOrigen: s(f.aceptado_origen),
    citaOrigenEn: s(f.cita_origen_en),
    citaDestinoEn: s(f.cita_destino_en),
    etaOrigenEn: s(f.eta_origen_en),
    etaDestinoEn: s(f.eta_destino_en),
    despachoRef: s(f.despacho_ref),
  };
}

/** El viaje SOLO si es de esa flota Y de ese chofer (los botones llegan como texto tecleable). */
export async function viajeDelOperador(tenantId: string, operadorId: string, viajeId: string): Promise<ViajeContexto | null> {
  const res = await acotada(supabaseAdmin()
    .from('viaje').select(COLUMNAS_VIAJE_CTX)
    .eq('id', viajeId).eq('tenant_id', tenantId).eq('operador_id', operadorId)
    .maybeSingle(), 'conductor.viaje_operador');
  const f = exigir(res as never, 'conductor.viaje_operador') as Fila | null;
  return f ? filaAViajeCtx(f) : null;
}

export async function cargarViajeContexto(tenantId: string, viajeId: string): Promise<ViajeContexto | null> {
  const res = await acotada(supabaseAdmin()
    .from('viaje').select(COLUMNAS_VIAJE_CTX)
    .eq('id', viajeId).eq('tenant_id', tenantId).maybeSingle(), 'conductor.viaje');
  const f = exigir(res as never, 'conductor.viaje') as Fila | null;
  return f ? filaAViajeCtx(f) : null;
}

// ── Bitácora de eventos (feed de /v1) ───────────────────────────────────────

export type EventoHito =
  | 'solicitado' | 'recibido' | 'validado' | 'omitido' | 'escalado' | 'corregido' | 'pospuesto' | 'atendido' | 'contacto'
  | 'validacion' | 'evidencia' | 'captura_manual' | 'alerta_estadia' | 'alerta_llegada_sin_confirmar';

/** Best-effort: perder un renglón de bitácora no puede romper el registro del hito. SIN datos personales en `detalle`. */
export async function registrarEvento(
  h: Pick<HitoFila, 'id' | 'tenantId' | 'viajeId' | 'tipo'>, evento: EventoHito, detalle: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  try {
    const { error } = await acotada(supabaseAdmin().from('viaje_hito_evento').insert({
      tenant_id: h.tenantId, viaje_id: h.viajeId, viaje_hito_id: h.id, tipo_hito: h.tipo, evento, detalle,
    }), 'conductor.evento');
    if (error) logger.warn('conductor.evento_no_guardado', { evento, hito: h.id, err: error.message });
  } catch (e) {
    logger.warn('conductor.evento_no_guardado', { evento, hito: h.id, err: e instanceof Error ? e.message : String(e) });
  }
}

// ── Escrituras de estado ────────────────────────────────────────────────────

export type ResultadoEscritura = 'ok' | 'carrera' | 'fallo';

export interface DatosRegistro {
  hito: HitoFila;
  fuente: FuenteHito;
  interpretacion: InterpretacionHito;
  confianza: number | null;
  waMessageId: string | null;
  mensajeEn: Date;
  ahora: Date;
  texto: string | null;
  contacto: Contacto | null;
  omitir: HitoFila[];
}

/** Registra el hito (esperado/escalado/omitido → recibido) y marca como omitidos a los anteriores pendientes. */
export async function registrarHito(d: DatosRegistro): Promise<ResultadoEscritura> {
  const admin = supabaseAdmin();
  const { data, error } = await acotada(admin
    .from('viaje_hito')
    .update({
      estado: 'recibido',
      fuente: d.fuente,
      interpretacion: d.interpretacion,
      confianza: d.confianza,
      wa_message_id: d.waMessageId,
      mensaje_en: d.mensajeEn.toISOString(),
      recibido_en: d.ahora.toISOString(),
      texto_chofer: d.texto ? d.texto.slice(0, 240) : null,
      contacto_nombre: d.contacto?.nombre ?? null,
      contacto_area: d.contacto?.area ?? null,
      sin_contacto: false,
      omitido_motivo: null,
      pospuesto_hasta: null,
      updated_at: d.ahora.toISOString(),
    })
    .eq('id', d.hito.id).eq('tenant_id', d.hito.tenantId)
    .in('estado', ['esperado', 'escalado', 'omitido'])
    .select('id'), 'conductor.registrar');
  if (error) {
    // 23505: ese mensaje de WhatsApp ya registró un hito (reentrega del webhook).
    if ((error as { code?: string }).code === '23505') return 'carrera';
    logger.error('conductor.registrar_fallo', { hito: d.hito.id, err: error.message });
    return 'fallo';
  }
  if (!data || data.length === 0) return 'carrera';

  if (d.omitir.length > 0) {
    const { error: e2 } = await acotada(admin
      .from('viaje_hito')
      .update({ estado: 'omitido', omitido_motivo: `inferido_por_${d.hito.tipo}`, updated_at: d.ahora.toISOString() })
      .in('id', d.omitir.map((h) => h.id)).eq('tenant_id', d.hito.tenantId)
      .in('estado', ['esperado', 'escalado'])
      .select('id'), 'conductor.omitir');
    if (e2) logger.error('conductor.omitir_fallo', { hito: d.hito.id, err: e2.message });
  }
  return 'ok';
}

/** Sella los tres campos de la 0090 (el primero gana). Mantiene vivos la espera en patio y el tablero que ya existen. */
export async function sincronizarLegado(tenantId: string, viajeId: string, sellos: LegadoSello[], cuando: Date): Promise<void> {
  const col: Record<LegadoSello, string> = { llegada: 'llegada_en', descarga: 'descarga_en', regreso: 'regreso_en' };
  for (const sello of sellos) {
    try {
      const { error } = await acotada(supabaseAdmin()
        .from('viaje').update({ [col[sello]]: cuando.toISOString() })
        .eq('id', viajeId).eq('tenant_id', tenantId).is(col[sello], null).select('id'), 'conductor.legado');
      if (error) logger.warn('conductor.legado_fallo', { viaje: viajeId, sello, err: error.message });
    } catch (e) {
      logger.warn('conductor.legado_fallo', { viaje: viajeId, sello, err: e instanceof Error ? e.message : String(e) });
    }
  }
}

export async function guardarContacto(h: HitoFila, contacto: Contacto, ahora: Date): Promise<ResultadoEscritura> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('viaje_hito')
    .update({ contacto_nombre: contacto.nombre, contacto_area: contacto.area, sin_contacto: false, updated_at: ahora.toISOString() })
    .eq('id', h.id).eq('tenant_id', h.tenantId).in('estado', ['recibido', 'validado']).select('id'), 'conductor.contacto');
  if (error) { logger.error('conductor.contacto_fallo', { hito: h.id, err: error.message }); return 'fallo'; }
  return data && data.length > 0 ? 'ok' : 'carrera';
}

export async function marcarSinContacto(h: HitoFila, ahora: Date): Promise<ResultadoEscritura> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('viaje_hito')
    .update({ sin_contacto: true, contacto_nombre: null, contacto_area: null, updated_at: ahora.toISOString() })
    .eq('id', h.id).eq('tenant_id', h.tenantId).in('estado', ['recibido', 'validado']).select('id'), 'conductor.sin_contacto');
  if (error) { logger.error('conductor.sin_contacto_fallo', { hito: h.id, err: error.message }); return 'fallo'; }
  return data && data.length > 0 ? 'ok' : 'carrera';
}

/**
 * «Voy con retraso» / «sigo cargando»: aplaza el hito y REINICIA su escalera
 * (ciclo + 1: el claim de avisos es por ciclo). Si estaba escalado, vuelve a
 * `esperado`: el chofer contestó.
 */
export async function posponerHito(h: HitoFila, minutos: number, ahora: Date): Promise<ResultadoEscritura> {
  const hasta = new Date(ahora.getTime() + minutos * 60_000);
  const { data, error } = await acotada(supabaseAdmin()
    .from('viaje_hito')
    .update({
      estado: 'esperado', pospuesto_hasta: hasta.toISOString(), pospuesto_veces: h.pospuestoVeces + 1,
      ciclo: h.ciclo + 1, recordatorios_enviados: 0, ultimo_aviso_en: null,
      escalado_en: null, escalacion_nivel: 0, escalacion_atendida_en: null, updated_at: ahora.toISOString(),
    })
    .eq('id', h.id).eq('tenant_id', h.tenantId).eq('ciclo', h.ciclo)
    .in('estado', ['esperado', 'escalado']).select('id'), 'conductor.posponer');
  if (error) { logger.error('conductor.posponer_fallo', { hito: h.id, err: error.message }); return 'fallo'; }
  return data && data.length > 0 ? 'ok' : 'carrera';
}

/** Retira hitos (recibido u omitido-por-inferencia → esperado). `ciclo + 1`: la escalera empieza de nuevo. */
export async function retirarHitos(hs: HitoFila[], objetivo: TipoHito, ahora: Date, posponerMin: number | null): Promise<ResultadoEscritura> {
  const admin = supabaseAdmin();
  for (const h of hs) {
    const esObjetivo = h.tipo === objetivo;
    const hasta = esObjetivo && posponerMin ? new Date(ahora.getTime() + posponerMin * 60_000).toISOString() : null;
    const { data, error } = await acotada(admin
      .from('viaje_hito')
      .update({
        estado: 'esperado', fuente: null, interpretacion: null, confianza: null, wa_message_id: null, mensaje_en: null,
        recibido_en: null, texto_chofer: null, contacto_nombre: null, contacto_area: null, sin_contacto: false,
        lat: null, lng: null, evidencia_ruta: null, omitido_motivo: null, pospuesto_hasta: hasta,
        solicitado_en: null, recordatorios_enviados: 0, ultimo_aviso_en: null, escalado_en: null, escalacion_nivel: 0,
        escalacion_atendida_en: null, ciclo: h.ciclo + 1, correcciones: esObjetivo ? h.correcciones + 1 : h.correcciones,
        updated_at: ahora.toISOString(),
      })
      .eq('id', h.id).eq('tenant_id', h.tenantId).eq('ciclo', h.ciclo)
      .in('estado', ['recibido', 'omitido']).select('id'), 'conductor.retirar');
    if (error) { logger.error('conductor.retirar_fallo', { hito: h.id, err: error.message }); return 'fallo'; }
    if (!data || data.length === 0) return 'carrera';
  }
  return 'ok';
}

/** Pasa un hito recibido a `validado` (oficina, GPS o sistema). Idempotente: validar lo validado no lo mueve. */
export async function validarHito(h: HitoFila, por: 'oficina' | 'gps' | 'sistema', ahora: Date): Promise<ResultadoEscritura> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('viaje_hito')
    .update({ estado: 'validado', validado_en: ahora.toISOString(), validado_por: por, updated_at: ahora.toISOString() })
    .eq('id', h.id).eq('tenant_id', h.tenantId).eq('estado', 'recibido').select('id'), 'conductor.validar');
  if (error) { logger.error('conductor.validar_fallo', { hito: h.id, err: error.message }); return 'fallo'; }
  return data && data.length > 0 ? 'ok' : 'carrera';
}

/**
 * Un pin de ubicación se ADJUNTA como evidencia al hito que el chofer acaba de
 * registrar (≤ `ventanaMin` min, sin coordenadas). Un pin NO registra ningún
 * hito por sí solo: el chofer comparte su posición cuando pasa algo, no solo al
 * llegar.
 */
export async function adjuntarUbicacion(
  tenantId: string, viajeId: string, lat: number, lng: number, ahora: Date, ventanaMin = 30,
): Promise<HitoFila | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const desde = new Date(ahora.getTime() - ventanaMin * 60_000).toISOString();
  const res = await acotada(supabaseAdmin()
    .from('viaje_hito').select(COLUMNAS_HITO)
    .eq('tenant_id', tenantId).eq('viaje_id', viajeId).eq('estado', 'recibido').is('lat', null)
    .gte('recibido_en', desde).order('recibido_en', { ascending: false }).order('id').limit(1), 'conductor.ubicacion_busca');
  const filas = (exigir(res as never, 'conductor.ubicacion_busca') ?? []) as unknown as Fila[];
  if (filas.length === 0) return null;
  const h = filaAHito(filas[0]);
  const { data, error } = await acotada(supabaseAdmin()
    .from('viaje_hito').update({ lat, lng, updated_at: ahora.toISOString() })
    .eq('id', h.id).eq('tenant_id', tenantId).is('lat', null).select('id'), 'conductor.ubicacion');
  if (error) { logger.warn('conductor.ubicacion_fallo', { hito: h.id, err: error.message }); return null; }
  return data && data.length > 0 ? { ...h, lat, lng } : null;
}

/** Marca que el jefe/patio atendió la escalación de estos hitos (botón «Ya lo atiendo»). */
export async function marcarEscalacionAtendida(tenantId: string, viajeId: string, ahora: Date): Promise<HitoFila[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('viaje_hito')
    .update({ escalacion_atendida_en: ahora.toISOString(), updated_at: ahora.toISOString() })
    .eq('tenant_id', tenantId).eq('viaje_id', viajeId).eq('estado', 'escalado').is('escalacion_atendida_en', null)
    .select(COLUMNAS_HITO), 'conductor.atendida');
  if (error) { logger.error('conductor.atendida_fallo', { viaje: viajeId, err: error.message }); return []; }
  return ((data ?? []) as unknown as Fila[]).map(filaAHito);
}


// ═══════════════════════════════════════════════════════════════════════════
// TODO EL ACCESO A DATOS DEL MÓDULO, EN ESTE ARCHIVO.
//
// Config, contactos de tráfico, la cola de avisos con su claim, la siembra, la
// lectura de /v1 y el mantenimiento de privacidad viven aquí (y no repartidos en
// un archivo por tabla) por la misma razón que `liquidacion_externa/repo.ts`: la
// frontera de datos cuenta ARCHIVOS con `.from(`/`.rpc(` fuera de repo.ts, y un
// módulo no tiene por qué costar siete.
// ═══════════════════════════════════════════════════════════════════════════

const copiaDefaults = (): ConfigConductor => ({
  ...CONFIG_CONDUCTOR_DEFAULT,
  solicitudesMin: [...CONFIG_CONDUCTOR_DEFAULT.solicitudesMin],
  diasSemana: [...CONFIG_CONDUCTOR_DEFAULT.diasSemana],
});

/** 0801: un umbral numérico de la fila, o su valor de partida si la columna no existe (base sin migrar). */
const umbralOPartida = (v: unknown, partida: number): number => (v === undefined || v === null ? partida : Number(v));

/** La config de una flota. Sin fila = defaults. LANZA si la base no contesta: «no pude leer» no es «defaults». */
export async function leerConfigConductor(tenantId: string): Promise<ConfigConductor> {
  const [res, zonaCruda] = await Promise.all([
    acotada(supabaseAdmin()
      .from('agente_conductor_config').select('*').eq('tenant_id', tenantId).maybeSingle(), 'conductor.config'),
    getZonaHorariaTenant(tenantId),
  ]);
  const f = exigir(res as never, 'conductor.config') as Fila | null;
  // La zona es de la flota (tenant.zona_horaria), no de esta tabla. Inválida o ausente → la de México, con aviso (no truena el cron).
  const zonaHoraria = zonaOCdmx(zonaCruda);
  if (zonaCruda !== null && zonaCruda !== zonaHoraria) {
    logger.warn('conductor.zona_invalida', { tenant: tenantId, zona: String(zonaCruda).slice(0, 60) });
  }
  if (!f) return { ...copiaDefaults(), zonaHoraria };
  const v = validarConfigConductor({
    activo: f.activo as boolean,
    solicitudesMin: f.solicitudes_min as number[],
    escalarTrasMin: Number(f.escalar_tras_min),
    segundoNivelMin: Number(f.segundo_nivel_min),
    horaInicio: Number(f.hora_inicio),
    horaFin: Number(f.hora_fin),
    diasSemana: f.dias_semana as number[],
    topeDiarioChofer: Number(f.tope_diario_chofer),
    anticipoCitaMin: Number(f.anticipo_cita_min),
    esperaSinCitaMin: Number(f.espera_sin_cita_min),
    esperaCargaMin: Number(f.espera_carga_min),
    trayectoSinEtaMin: Number(f.trayecto_sin_eta_min),
    esperaDescargaMin: Number(f.espera_descarga_min),
    regresoMin: Number(f.regreso_min),
    posponerMin: Number(f.posponer_min),
    ventanaCorreccionMin: Number(f.ventana_correccion_min),
    usarLlm: f.usar_llm as boolean,
    avisarOficinaLlegada: f.avisar_oficina_llegada as boolean,
    avisarOficinaSalida: f.avisar_oficina_salida as boolean,
    confirmarAlChofer: f.confirmar_al_chofer as boolean,
    validarUbicacion: f.validar_ubicacion as boolean,
    toleranciaUbicacionM: Number(f.tolerancia_ubicacion_m),
    ventanaUbicacionMin: Number(f.ventana_ubicacion_min),
    pedirUbicacion: f.pedir_ubicacion as boolean,
    estadiaAlertaCargaMin: n(f.estadia_alerta_carga_min),
    estadiaAlertaDescargaMin: n(f.estadia_alerta_descarga_min),
    pedirFotoEvidencia: f.pedir_foto_evidencia as boolean,
    fotoRegistraHito: f.foto_registra_hito !== false,
    // 0604: la base sin migrar no trae las columnas; el aviso queda apagado y el margen en su valor de partida.
    avisarLlegadaSinConfirmar: f.avisar_llegada_sin_confirmar === true,
    margenAcercamientoM: f.margen_acercamiento_m === undefined || f.margen_acercamiento_m === null ? CONFIG_CONDUCTOR_DEFAULT.margenAcercamientoM : Number(f.margen_acercamiento_m),
    // 0635: la base sin migrar no trae las columnas; la detección sigue en su valor de partida (encendida) y la señal de vida apagada.
    detectarHitosGps: f.detectar_hitos_gps !== false,
    avisarSenalVida: f.avisar_senal_vida === true,
    // 0801: la base sin migrar no trae las columnas; cada una cae en su valor de partida (el comportamiento de siempre).
    perfilSeguimiento: (f.perfil_seguimiento ?? CONFIG_CONDUCTOR_DEFAULT.perfilSeguimiento) as ConfigConductor['perfilSeguimiento'],
    gpsObsoletoMin: umbralOPartida(f.gps_obsoleto_min, CONFIG_CONDUCTOR_DEFAULT.gpsObsoletoMin),
    detenidoMin: umbralOPartida(f.detenido_min, CONFIG_CONDUCTOR_DEFAULT.detenidoMin),
    segundoAvisoMin: umbralOPartida(f.segundo_aviso_min, CONFIG_CONDUCTOR_DEFAULT.segundoAvisoMin),
    escalarSenalMin: umbralOPartida(f.escalar_senal_min, CONFIG_CONDUCTOR_DEFAULT.escalarSenalMin),
    silencioRespuestaMin: umbralOPartida(f.silencio_respuesta_min, CONFIG_CONDUCTOR_DEFAULT.silencioRespuestaMin),
    mostrarEstadosFrontera: f.mostrar_estados_frontera === true,
    aplicarSalidaDelTms: f.aplicar_salida_del_tms === true,
    lineaBaseLlamadasPorViaje: f.linea_base_llamadas_por_viaje === undefined || f.linea_base_llamadas_por_viaje === null ? null : Number(f.linea_base_llamadas_por_viaje),
    lineaBaseRegistradaEn: typeof f.linea_base_registrada_en === 'string' ? f.linea_base_registrada_en.slice(0, 10) : null,
    zonaHoraria,
  });
  if ('error' in v) {
    // La base tiene CHECKs equivalentes; llegar aquí es una fila corrupta. Se grita y se opera
    // con defaults, pero un `activo = false` explícito se respeta: encender por error un agente
    // que manda WhatsApp es peor que operar con la escalera de siempre.
    logger.error('conductor.config_invalida', { tenant: tenantId, err: v.error });
    return { ...copiaDefaults(), activo: f.activo !== false, zonaHoraria };
  }
  return v.ok;
}

export async function cargarContactosTrafico(tenantId: string): Promise<ContactoTrafico[]> {
  const res = await acotada(supabaseAdmin()
    .from('conductor_contacto_trafico')
    .select('nombre, telefono, nivel, terminal_id')
    .eq('tenant_id', tenantId).eq('activo', true).order('created_at', { ascending: true }).order('id').limit(200), 'conductor.contactos');
  const filas = (exigir(res as never, 'conductor.contactos') ?? []) as unknown as Fila[];
  return filas.map((f) => ({
    nombre: String(f.nombre), telefono: String(f.telefono), nivel: Number(f.nivel) === 2 ? 2 : 1,
    terminalId: typeof f.terminal_id === 'string' ? f.terminal_id : null,
  }));
}

/** La última posición de la unidad en las últimas 12 h, o `null`. */
export async function ultimaPosicionUnidad(
  tenantId: string, unidadId: string, ahora: Date,
): Promise<{ lat: number; lng: number; medidaEn: string } | null> {
  const desde = new Date(ahora.getTime() - 12 * 3_600_000).toISOString();
  const res = await acotada(supabaseAdmin()
    .from('posicion').select('lat, lng, medida_en')
    .eq('tenant_id', tenantId).eq('unidad_id', unidadId).gte('medida_en', desde)
    .order('medida_en', { ascending: false }).order('id').limit(1), 'conductor.ubicacion_unidad');
  const f = ((exigir(res as never, 'conductor.ubicacion_unidad') ?? []) as unknown as Array<{ lat: number; lng: number; medida_en: string }>)[0];
  return f ? { lat: f.lat, lng: f.lng, medidaEn: f.medida_en } : null;
}

// ── La cola del cron ────────────────────────────────────────────────────────

export interface LlaveAviso {
  tenantId: string;
  hitoId: string;
  ciclo: number;
  clase: AvisoReclamado['clase'];
  nivel: number;
}

/** El CLAIM: insertar. `perdido` = otro corredor ya lo reclamó (ON CONFLICT DO NOTHING devuelve 0 filas). */
export async function reclamarAviso(a: LlaveAviso & { viajeId: string; operadorId: string | null }): Promise<'ganado' | 'perdido' | 'fallo'> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('viaje_hito_aviso')
    .upsert({
      tenant_id: a.tenantId, viaje_id: a.viajeId, viaje_hito_id: a.hitoId, operador_id: a.operadorId,
      ciclo: a.ciclo, clase: a.clase, nivel: a.nivel,
    }, { onConflict: 'viaje_hito_id,ciclo,clase,nivel', ignoreDuplicates: true })
    .select('id'), 'conductor.reclamar');
  if (error) { logger.error('conductor.reclamar_fallo', { hito: a.hitoId, err: error.message }); return 'fallo'; }
  return data && data.length > 0 ? 'ganado' : 'perdido';
}

export async function cerrarAvisoReclamado(
  a: LlaveAviso, c: { ok: boolean; canal: 'texto' | 'botones' | 'plantilla' | 'ninguno'; motivo: string | null; ult4: string | null },
): Promise<void> {
  const { error } = await acotada(supabaseAdmin()
    .from('viaje_hito_aviso')
    .update({ ok: c.ok, canal: c.canal, motivo: c.motivo, destinatario_ult4: c.ult4 })
    .eq('viaje_hito_id', a.hitoId).eq('ciclo', a.ciclo).eq('clase', a.clase).eq('nivel', a.nivel).eq('tenant_id', a.tenantId), 'conductor.cerrar_aviso');
  if (error) logger.warn('conductor.cerrar_aviso_fallo', { hito: a.hitoId, err: error.message });
}

/** Suelta un claim que NO llegó a mandarse (solo si sigue sin resultado: `ok IS NULL`). */
export async function liberarAvisoReclamado(a: LlaveAviso): Promise<void> {
  const { error } = await acotada(supabaseAdmin()
    .from('viaje_hito_aviso').delete()
    .eq('viaje_hito_id', a.hitoId).eq('ciclo', a.ciclo).eq('clase', a.clase).eq('nivel', a.nivel).eq('tenant_id', a.tenantId).is('ok', null), 'conductor.liberar_aviso');
  if (error) logger.error('conductor.claim_no_liberado', { hito: a.hitoId, err: error.message });
}

/** Tras mandarle al chofer: sube el contador y fija la hora del primer aviso. */
export async function anotarAvisoAlChofer(h: HitoFila, ahora: Date): Promise<void> {
  const { error } = await acotada(supabaseAdmin()
    .from('viaje_hito')
    .update({
      recordatorios_enviados: Math.min(h.recordatoriosEnviados + 1, 30),
      ultimo_aviso_en: ahora.toISOString(),
      solicitado_en: h.solicitadoEn ?? ahora.toISOString(),
      updated_at: ahora.toISOString(),
    })
    .eq('id', h.id).eq('tenant_id', h.tenantId).eq('ciclo', h.ciclo).in('estado', ['esperado', 'escalado']), 'conductor.anotar_aviso');
  if (error) logger.warn('conductor.anotar_aviso_fallo', { hito: h.id, err: error.message });
}

export async function marcarHitoEscalado(h: HitoFila, nivel: 1 | 2, ahora: Date): Promise<boolean> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('viaje_hito')
    .update({
      estado: 'escalado', escalado_en: h.escaladoEn ?? ahora.toISOString(),
      escalacion_nivel: Math.max(h.escalacionNivel, nivel), updated_at: ahora.toISOString(),
    })
    .eq('id', h.id).eq('tenant_id', h.tenantId).eq('ciclo', h.ciclo).in('estado', ['esperado', 'escalado']).select('id'), 'conductor.marcar_escalado');
  if (error) { logger.error('conductor.marcar_escalado_fallo', { hito: h.id, err: error.message }); return false; }
  return Boolean(data && data.length > 0);
}

/** Retención de privacidad: anonimiza el dato personal viejo, purga la bitácora y desliga/encola la evidencia fotográfica vieja. Devuelve filas por función. */
export async function correrMantenimientoConductor(): Promise<Record<string, number | string>> {
  const salida: Record<string, number | string> = {};
  for (const rpc of ['anonimizar_conductor_hitos', 'purgar_conductor_auditoria', 'purgar_conductor_evidencia'] as const) {
    const { data, error } = await acotada(supabaseAdmin().rpc(rpc), `conductor.${rpc}`);
    if (error) {
      logger.error('conductor.mantenimiento_fallo', { rpc, err: error.message });
      salida[rpc] = `error: ${error.message}`;
    } else {
      salida[rpc] = Number(data ?? 0);
    }
  }
  return salida;
}

// ── La lectura para /v1 y la escritura de citas ─────────────────────────────

export async function leerHitos(
  tenantId: string, f: FiltrosHitos, limite: number, desplazamiento: number,
): Promise<{ filas: HitoApi[]; hayMas: boolean }> {
  let viajeIds: string[] | null = f.viajeId ? [f.viajeId] : null;
  if (f.folio) {
    const r = await acotada(supabaseAdmin().from('viaje').select('id').eq('tenant_id', tenantId).eq('folio', f.folio).order('id').limit(50), 'v1.hitos_folio');
    viajeIds = ((exigir(r as never, 'v1.hitos_folio') ?? []) as unknown as Fila[]).map((x) => String(x.id));
    if (f.viajeId) viajeIds = viajeIds.filter((id) => id === f.viajeId);
    if (viajeIds.length === 0) return { filas: [], hayMas: false };
  }

  // SIEMPRE acotado por tenant: el filtro de viaje es adicional, nunca sustituto.
  let q = supabaseAdmin().from('viaje_hito').select(COLUMNAS_HITO).eq('tenant_id', tenantId);
  if (viajeIds) q = q.in('viaje_id', viajeIds);
  if (f.estado) q = q.eq('estado', f.estado);
  if (f.tipo) q = q.eq('tipo', f.tipo);
  if (f.desde) q = q.gte('updated_at', f.desde);
  // Una fila de más: `hayMas` es un hecho medido. El desempate por id evita saltar/repetir filas.
  q = q.order('updated_at', { ascending: false }).order('id', { ascending: false }).range(desplazamiento, desplazamiento + limite);
  const res = await acotada(q, 'v1.hitos');
  const filas = ((exigir(res as never, 'v1.hitos') ?? []) as unknown as Fila[]).map(filaAHito);
  const hayMas = filas.length > limite;
  const pagina = filas.slice(0, limite);

  const folios = new Map<string, string | null>();
  const ids = [...new Set(pagina.map((h) => h.viajeId))];
  if (ids.length > 0) {
    const rv = await acotada(supabaseAdmin().from('viaje').select('id, folio').eq('tenant_id', tenantId).in('id', ids), 'v1.hitos_folios');
    for (const v of (exigir(rv as never, 'v1.hitos_folios') ?? []) as unknown as Fila[]) {
      folios.set(String(v.id), typeof v.folio === 'string' && v.folio ? v.folio : null);
    }
  }
  return { filas: pagina.map((h) => aHitoApi(h, folios.get(h.viajeId) ?? null)), hayMas };
}

/** El feed incremental: eventos con id > `despuesDeId`, del más viejo al más nuevo. */
export async function leerEventos(tenantId: string, despuesDeId: number, limite: number): Promise<{ filas: EventoApi[]; hayMas: boolean }> {
  const res = await acotada(supabaseAdmin()
    .from('viaje_hito_evento')
    .select('id, viaje_id, viaje_hito_id, tipo_hito, evento, detalle, created_at')
    .eq('tenant_id', tenantId).gt('id', despuesDeId).order('id', { ascending: true }).limit(limite + 1), 'v1.hitos_eventos');
  const filas = ((exigir(res as never, 'v1.hitos_eventos') ?? []) as unknown as Fila[]);
  const hayMas = filas.length > limite;
  return {
    hayMas,
    filas: filas.slice(0, limite).map((f) => ({
      id: Number(f.id), viajeId: String(f.viaje_id), hitoId: String(f.viaje_hito_id), tipoHito: f.tipo_hito as TipoHito,
      evento: String(f.evento), detalle: (f.detalle ?? {}) as Record<string, unknown>, creadoEn: String(f.created_at),
    })),
  };
}

/** Guarda las citas del viaje DE ESA FLOTA. `no_encontrado` = no existe o es de otra flota (misma respuesta). */
export async function guardarCitas(tenantId: string, viajeId: string, cambio: CambioCitas): Promise<'ok' | 'no_encontrado'> {
  const res = await acotada(supabaseAdmin()
    .from('viaje').update(cambio).eq('id', viajeId).eq('tenant_id', tenantId).select('id'), 'v1.citas');
  const filas = exigir(res as never, 'v1.citas') as unknown[] | null;
  return filas && filas.length > 0 ? 'ok' : 'no_encontrado';
}

// ── La config y los contactos: escritura desde PUT /v1/conductor/config ──────

/** Guarda la config COMPLETA de la flota (ya validada) y, si viene, REEMPLAZA sus contactos de escalamiento. */
export async function guardarConfigConductor(
  tenantId: string, c: ConfigConductor, contactos: ContactoTrafico[] | undefined,
): Promise<'ok' | 'terminal_ajena'> {
  const fila = {
    tenant_id: tenantId, activo: c.activo, solicitudes_min: c.solicitudesMin, escalar_tras_min: c.escalarTrasMin,
    segundo_nivel_min: c.segundoNivelMin, hora_inicio: c.horaInicio, hora_fin: c.horaFin, dias_semana: c.diasSemana,
    tope_diario_chofer: c.topeDiarioChofer, anticipo_cita_min: c.anticipoCitaMin, espera_sin_cita_min: c.esperaSinCitaMin,
    espera_carga_min: c.esperaCargaMin, trayecto_sin_eta_min: c.trayectoSinEtaMin, espera_descarga_min: c.esperaDescargaMin,
    regreso_min: c.regresoMin, posponer_min: c.posponerMin, ventana_correccion_min: c.ventanaCorreccionMin, usar_llm: c.usarLlm,
    avisar_oficina_llegada: c.avisarOficinaLlegada, avisar_oficina_salida: c.avisarOficinaSalida,
    confirmar_al_chofer: c.confirmarAlChofer, validar_ubicacion: c.validarUbicacion,
    tolerancia_ubicacion_m: c.toleranciaUbicacionM, ventana_ubicacion_min: c.ventanaUbicacionMin, pedir_ubicacion: c.pedirUbicacion,
    estadia_alerta_carga_min: c.estadiaAlertaCargaMin, estadia_alerta_descarga_min: c.estadiaAlertaDescargaMin,
    pedir_foto_evidencia: c.pedirFotoEvidencia, foto_registra_hito: c.fotoRegistraHito, updated_at: new Date().toISOString(),
  };
  // 0604 y 0635 agregaron columnas. Contra la base SIN migrar se guarda lo demás si esas columnas están en su valor de
  // partida; si el dueño pidió algo distinto (aviso encendido, otro margen, detección apagada) se dice que falta la migración
  // en vez de callarlo. Cada grupo se retira solo cuando el error de la base nombra una de SUS columnas.
  const grupos: Array<{ mig: string; cols: Record<string, unknown>; esDePartida: boolean }> = [
    {
      mig: '0801',
      cols: {
        perfil_seguimiento: c.perfilSeguimiento, gps_obsoleto_min: c.gpsObsoletoMin, detenido_min: c.detenidoMin,
        segundo_aviso_min: c.segundoAvisoMin, escalar_senal_min: c.escalarSenalMin, silencio_respuesta_min: c.silencioRespuestaMin,
        mostrar_estados_frontera: c.mostrarEstadosFrontera, aplicar_salida_del_tms: c.aplicarSalidaDelTms,
        linea_base_llamadas_por_viaje: c.lineaBaseLlamadasPorViaje, linea_base_registrada_en: c.lineaBaseRegistradaEn,
      },
      esDePartida: (['perfilSeguimiento', 'gpsObsoletoMin', 'detenidoMin', 'segundoAvisoMin', 'escalarSenalMin', 'silencioRespuestaMin', 'mostrarEstadosFrontera', 'aplicarSalidaDelTms', 'lineaBaseLlamadasPorViaje', 'lineaBaseRegistradaEn'] as const)
        .every((k) => c[k] === CONFIG_CONDUCTOR_DEFAULT[k]),
    },
    { mig: '0635', cols: { detectar_hitos_gps: c.detectarHitosGps, avisar_senal_vida: c.avisarSenalVida }, esDePartida: c.detectarHitosGps === CONFIG_CONDUCTOR_DEFAULT.detectarHitosGps && c.avisarSenalVida === CONFIG_CONDUCTOR_DEFAULT.avisarSenalVida },
    { mig: '0604', cols: { avisar_llegada_sin_confirmar: c.avisarLlegadaSinConfirmar, margen_acercamiento_m: c.margenAcercamientoM }, esDePartida: !c.avisarLlegadaSinConfirmar && c.margenAcercamientoM === CONFIG_CONDUCTOR_DEFAULT.margenAcercamientoM },
  ];
  let vigentes = grupos.slice();
  let error: { message: string } | null = null;
  for (;;) {
    ({ error } = await acotada(supabaseAdmin().from('agente_conductor_config').upsert({ ...fila, ...Object.assign({}, ...vigentes.map((g) => g.cols)) }, { onConflict: 'tenant_id' }), 'v1.conductor_config'));
    const faltante = error ? vigentes.find((g) => Object.keys(g.cols).some((col) => error!.message.includes(col))) : undefined;
    if (!faltante) break;
    if (!faltante.esDePartida) {
      throw new Error(faltante.mig === '0801'
        ? 'v1.conductor_config: el perfil de seguimiento, los umbrales de señal de vida y las perillas de frontera y TMS necesitan la migración 0801 (aún no aplicada en esta base).'
        : faltante.mig === '0604'
        ? 'v1.conductor_config: el aviso por llegada sin confirmar y el margen de acercamiento necesitan la migración 0604 (aún no aplicada en esta base).'
        : 'v1.conductor_config: la detección de hitos por GPS y el aviso de señal de vida necesitan la migración 0635 (aún no aplicada en esta base).');
    }
    logger.warn(`conductor.config_sin_${faltante.mig}`, { tenant: tenantId });
    vigentes = vigentes.filter((g) => g !== faltante);
  }
  if (error) throw new Error(`v1.conductor_config: ${error.message}`);
  if (contactos === undefined) return 'ok';

  const previos = await acotada(supabaseAdmin().from('conductor_contacto_trafico').select('id, nivel, telefono, terminal_id').eq('tenant_id', tenantId).order('id').limit(500), 'v1.conductor_contactos');
  const filas = (exigir(previos as never, 'v1.conductor_contactos') ?? []) as unknown as Fila[];
  const clave = (nivel: number, telefono: string, terminal: string | null) => `${terminal ?? ''}|${nivel}|${telefono}`;
  const nuevos = new Map(contactos.map((x) => [clave(x.nivel, x.telefono, x.terminalId), x]));
  const existentes = new Map(filas.map((f) => [clave(Number(f.nivel), String(f.telefono), typeof f.terminal_id === 'string' ? f.terminal_id : null), String(f.id)]));

  // Primero se agregan los nuevos (si una terminal es ajena, la FK compuesta lo dice y NO se borra nada),
  // y solo después se retiran los que ya no están.
  const aInsertar = contactos.filter((x) => !existentes.has(clave(x.nivel, x.telefono, x.terminalId)));
  if (aInsertar.length > 0) {
    const { error: e2 } = await acotada(supabaseAdmin().from('conductor_contacto_trafico').insert(
      aInsertar.map((x) => ({ tenant_id: tenantId, terminal_id: x.terminalId, nivel: x.nivel, nombre: x.nombre, telefono: x.telefono, activo: true })),
    ), 'v1.conductor_contactos_alta');
    if (e2) {
      if ((e2 as { code?: string }).code === '23503') return 'terminal_ajena';
      throw new Error(`v1.conductor_contactos_alta: ${e2.message}`);
    }
  }
  const aBorrar = [...existentes.entries()].filter(([k]) => !nuevos.has(k)).map(([, id]) => id);
  if (aBorrar.length > 0) {
    const { error: e3 } = await acotada(supabaseAdmin().from('conductor_contacto_trafico').delete().eq('tenant_id', tenantId).in('id', aBorrar), 'v1.conductor_contactos_baja');
    if (e3) throw new Error(`v1.conductor_contactos_baja: ${e3.message}`);
  }
  // Los que se conservan pueden haber cambiado de nombre.
  for (const [k, x] of nuevos) {
    const id = existentes.get(k);
    if (!id) continue;
    const { error: e4 } = await acotada(supabaseAdmin().from('conductor_contacto_trafico').update({ nombre: x.nombre, activo: true }).eq('tenant_id', tenantId).eq('id', id), 'v1.conductor_contactos_nombre');
    if (e4) throw new Error(`v1.conductor_contactos_nombre: ${e4.message}`);
  }
  return 'ok';
}

// ── 0635: los cruces de geocerca (el claim de «el GPS ya probó este hito») ───

export interface DatosCruce {
  tenantId: string;
  viajeId: string;
  geocercaId: string;
  hitoTipo: string;
  tipo: 'entrada' | 'salida';
  detectadoEn: Date;
  distanciaM: number;
}

export type ResultadoAceptarImportados =
  | { ok: true; aceptados: number }
  | { ok: false; motivo: 'sin_funcion' | 'fallo' };

/**
 * Pasa a «aceptados por importación» los viajes recién importados cuyo operador es voluntario del piloto (0800). Un solo
 * UPDATE en la base: falla cerrado (sin voluntario no escribe nada) y no toca un viaje que el chofer ya aceptó. `sin_funcion`
 * = base sin la 0800 (el import ya ocurrió: solo se queda sin seguimiento); `fallo` = cualquier otro error, también sin
 * seguimiento. Nunca lanza: el importador no debe caerse por el seguimiento.
 */
export async function aceptarViajesImportados(tenantId: string, viajeIds: string[], ahora?: Date): Promise<ResultadoAceptarImportados> {
  if (viajeIds.length === 0) return { ok: true, aceptados: 0 };
  try {
    const { data, error } = await acotada(
      supabaseAdmin().rpc('aceptar_viajes_importados', {
        p_tenant: tenantId, p_viaje_ids: viajeIds, ...(ahora ? { p_ahora: ahora.toISOString() } : {}),
      }),
      'conductor.aceptarViajesImportados',
    );
    if (error) {
      const sinFuncion = error.code === 'PGRST202' || error.code === '42883' || (/aceptar_viajes_importados/.test(error.message ?? '') && /does not exist|schema cache|could not find/i.test(error.message ?? ''));
      logger.warn('conductor.aceptar_importados_error', { tenantId, sinFuncion, err: error.message });
      return { ok: false, motivo: sinFuncion ? 'sin_funcion' : 'fallo' };
    }
    return { ok: true, aceptados: Array.isArray(data) ? data.length : 0 };
  } catch (e) {
    logger.warn('conductor.aceptar_importados_fallo', { tenantId, err: e instanceof Error ? e.message : String(e) });
    return { ok: false, motivo: 'fallo' };
  }
}

/** El error es «esa tabla o columna no existe» (base sin la migración), no otro fallo cualquiera. */
export function faltaEsquema(e: { code?: string | null; message?: string | null } | null | undefined, objeto: RegExp): boolean {
  if (!e) return false;
  const msg = e.message ?? '';
  if (!objeto.test(msg)) return false;
  return e.code === '42P01' || e.code === '42703' || e.code === 'PGRST205' || e.code === 'PGRST204' || /does not exist|schema cache|could not find/i.test(msg);
}

/**
 * Reclama la detección de UN hito de UN viaje: insertar es reclamar (único por (viaje, hito)). `perdido` = otra corrida ya
 * la reclamó y la completó (o la lleva en curso); un claim SIN completar con más de `MINUTOS_CLAIM_VENCIDO` se retoma (la
 * corrida que lo tomó murió a media). `sin_tabla` = base sin la 0635: se sigue sin claim (el candado es el hito mismo).
 */
export async function reclamarCruce(d: DatosCruce, ahora: Date, minutosVencido: number): Promise<'ganado' | 'perdido' | 'sin_tabla' | 'fallo'> {
  const { error } = await acotada(supabaseAdmin().from('viaje_cruce_geocerca').insert({
    tenant_id: d.tenantId, viaje_id: d.viajeId, geocerca_id: d.geocercaId, hito_tipo: d.hitoTipo, tipo: d.tipo,
    detectado_en: d.detectadoEn.toISOString(), distancia_m: d.distanciaM, registrado_en: ahora.toISOString(),
  }), 'conductor.cruce_reclamar');
  if (!error) return 'ganado';
  if (faltaEsquema(error, /viaje_cruce_geocerca/i)) return 'sin_tabla';
  if ((error as { code?: string }).code !== '23505') {
    logger.error('conductor.cruce_reclamar_fallo', { viaje: d.viajeId, err: error.message });
    return 'fallo';
  }
  const vencido = new Date(ahora.getTime() - minutosVencido * 60_000).toISOString();
  const retomado = await acotada(supabaseAdmin().from('viaje_cruce_geocerca')
    .update({ registrado_en: ahora.toISOString(), detectado_en: d.detectadoEn.toISOString(), distancia_m: d.distanciaM })
    .eq('tenant_id', d.tenantId).eq('viaje_id', d.viajeId).eq('hito_tipo', d.hitoTipo).is('completado_en', null).lt('registrado_en', vencido).select('id'), 'conductor.cruce_retomar');
  if (retomado.error) { logger.error('conductor.cruce_retomar_fallo', { viaje: d.viajeId, err: retomado.error.message }); return 'fallo'; }
  return retomado.data && retomado.data.length > 0 ? 'ganado' : 'perdido';
}

/** Marca el cruce como completado (el hito quedó registrado, o ya lo estaba). Best-effort: sin esto el claim se retoma a los minutos y la transición condicional del hito lo frena. */
export async function completarCruce(d: Pick<DatosCruce, 'tenantId' | 'viajeId' | 'hitoTipo'>, ahora: Date): Promise<void> {
  try {
    const { error } = await acotada(supabaseAdmin().from('viaje_cruce_geocerca').update({ completado_en: ahora.toISOString() })
      .eq('tenant_id', d.tenantId).eq('viaje_id', d.viajeId).eq('hito_tipo', d.hitoTipo).is('completado_en', null), 'conductor.cruce_completar');
    if (error && !faltaEsquema(error, /viaje_cruce_geocerca/i)) logger.warn('conductor.cruce_completar_fallo', { viaje: d.viajeId, err: error.message });
  } catch (e) {
    logger.warn('conductor.cruce_completar_fallo', { viaje: d.viajeId, err: e instanceof Error ? e.message : String(e) });
  }
}

/** Suelta el claim cuando el hito NO se pudo registrar (así la siguiente pasada lo reintenta de inmediato en vez de esperar a que venza). */
export async function liberarCruce(d: Pick<DatosCruce, 'tenantId' | 'viajeId' | 'hitoTipo'>): Promise<void> {
  try {
    const { error } = await acotada(supabaseAdmin().from('viaje_cruce_geocerca').delete()
      .eq('tenant_id', d.tenantId).eq('viaje_id', d.viajeId).eq('hito_tipo', d.hitoTipo).is('completado_en', null), 'conductor.cruce_liberar');
    if (error && !faltaEsquema(error, /viaje_cruce_geocerca/i)) logger.warn('conductor.cruce_liberar_fallo', { viaje: d.viajeId, err: error.message });
  } catch (e) {
    logger.warn('conductor.cruce_liberar_fallo', { viaje: d.viajeId, err: e instanceof Error ? e.message : String(e) });
  }
}

// ── 0637: asignar el sitio derivado a un viaje ───────────────────────────────

/**
 * Asigna al viaje el sitio derivado (lado `origen` o `destino`) SOLO si sigue sin él, y deja constancia de qué se derivó y por
 * qué (única por (viaje, lado): derivar es una sola vez). `ya` = otra corrida o la oficina llegaron primero. Contra una base sin
 * la 0637 se asigna igual, sin constancia (el UPDATE condicional «sigue sin sitio» es el candado).
 */
export async function asignarSitioDerivado(
  tenantId: string, viajeId: string, lado: 'origen' | 'destino', sitioId: string, criterio: CriterioSitio, ahora: Date,
): Promise<'ok' | 'ya' | 'fallo'> {
  const claim = await acotada(supabaseAdmin().from('viaje_sitio_derivado').insert({
    tenant_id: tenantId, viaje_id: viajeId, lado, geocerca_id: sitioId, criterio, derivado_en: ahora.toISOString(),
  }), 'conductor.sitio_derivado_reclamar');
  const sinTabla = faltaEsquema(claim.error, /viaje_sitio_derivado/i);
  if (claim.error && !sinTabla) {
    if ((claim.error as { code?: string }).code === '23505') return 'ya';
    logger.error('conductor.sitio_derivado_reclamar_fallo', { viaje: viajeId, err: claim.error.message });
    return 'fallo';
  }
  const columna = lado === 'origen' ? 'origen_geocerca_id' : 'destino_geocerca_id';
  const { data, error } = await acotada(supabaseAdmin().from('viaje').update({ [columna]: sitioId })
    .eq('id', viajeId).eq('tenant_id', tenantId).eq('estatus', 'abierto').is(columna, null).select('id'), 'conductor.sitio_derivado_asignar');
  if (error) {
    // No se asignó por un fallo: la constancia no debe quedar diciendo que sí (y bloquear un reintento legítimo).
    if (!sinTabla) await acotada(supabaseAdmin().from('viaje_sitio_derivado').delete().eq('tenant_id', tenantId).eq('viaje_id', viajeId).eq('lado', lado), 'conductor.sitio_derivado_soltar');
    logger.error('conductor.sitio_derivado_asignar_fallo', { viaje: viajeId, err: error.message });
    return 'fallo';
  }
  // Cero filas: alguien le puso sitio entre la lectura y este UPDATE. La constancia se queda (la derivación ya no aplica).
  if (!data || data.length === 0) return 'ya';
  return 'ok';
}

/**
 * La oficina declaró (equivalencia `sin_sitio`/`ignorar`, 0803) que el texto de ese lado NO es un lugar («VACIO …», «SALIR A RUTA …»).
 * Se deja constancia en la misma tabla de la 0637 con `geocerca_id` nulo y criterio `equivalencia_sin_sitio`: el viaje queda
 * «sin sitio, por decisión» y el barrido no lo vuelve a evaluar. No toca el viaje. Una base sin la 0803 (el CHECK no admite el
 * criterio) devuelve `fallo`: se reintenta cuando exista, sin inventar nada.
 */
export async function marcarSinSitioPorDecision(tenantId: string, viajeId: string, lado: 'origen' | 'destino', ahora: Date): Promise<'ok' | 'ya' | 'fallo'> {
  const { error } = await acotada(supabaseAdmin().from('viaje_sitio_derivado').insert({
    tenant_id: tenantId, viaje_id: viajeId, lado, geocerca_id: null, criterio: 'equivalencia_sin_sitio', derivado_en: ahora.toISOString(),
  }), 'conductor.sitio_sin_sitio_marcar');
  if (!error) return 'ok';
  if ((error as { code?: string }).code === '23505') return 'ya';
  logger.error('conductor.sitio_sin_sitio_marcar_fallo', { viaje: viajeId, err: error.message });
  return 'fallo';
}

// ── 0636: los episodios de «sin señal de vida» ───────────────────────────────

const COLUMNAS_EPISODIO = 'id, tenant_id, viaje_id, motivo, abierto_en, nivel_enviado, aviso_1_en, aviso_2_en, escalado_en, ultimo_error';

export function filaAEpisodio(f: Fila): EpisodioFila {
  return {
    id: String(f.id), tenantId: String(f.tenant_id), viajeId: String(f.viaje_id), motivo: f.motivo === 'gps_detenido' ? 'gps_detenido' : 'gps_obsoleto',
    abiertoEn: String(f.abierto_en), nivelEnviado: ([0, 1, 2, 3].includes(Number(f.nivel_enviado)) ? Number(f.nivel_enviado) : 0) as EpisodioFila['nivelEnviado'],
    aviso1En: s(f.aviso_1_en), aviso2En: s(f.aviso_2_en), escaladoEn: s(f.escalado_en), ultimoError: s(f.ultimo_error),
  };
}

/** Abre el episodio del viaje (único abierto: el índice parcial). `null` = otro lo abrió primero o la base no pudo (se loguea). */
export async function abrirEpisodioSenalVida(tenantId: string, viajeId: string, motivo: MotivoSenalVida, ahora: Date): Promise<EpisodioFila | null> {
  const { data, error } = await acotada(supabaseAdmin().from('viaje_senal_vida')
    .insert({ tenant_id: tenantId, viaje_id: viajeId, motivo, abierto_en: ahora.toISOString() }).select(COLUMNAS_EPISODIO).maybeSingle(), 'conductor.senal_abrir');
  if (error) {
    if ((error as { code?: string }).code !== '23505') logger.error('conductor.senal_abrir_fallo', { viaje: viajeId, err: error.message });
    return null;
  }
  return data ? filaAEpisodio(data as unknown as Fila) : null;
}

/** Reclama el nivel k del episodio: UPDATE condicional `nivel_enviado = k-1` y sin cerrar. Quien pierde no manda nada. */
export async function reclamarNivelSenalVida(ep: Pick<EpisodioFila, 'id' | 'tenantId'>, nivel: 1 | 2 | 3, ahora: Date): Promise<'ganado' | 'perdido' | 'fallo'> {
  const hora = ahora.toISOString();
  const cambio = nivel === 1 ? { nivel_enviado: 1, aviso_1_en: hora } : nivel === 2 ? { nivel_enviado: 2, aviso_2_en: hora } : { nivel_enviado: 3, escalado_en: hora };
  const { data, error } = await acotada(supabaseAdmin().from('viaje_senal_vida').update(cambio)
    .eq('id', ep.id).eq('tenant_id', ep.tenantId).eq('nivel_enviado', nivel - 1).is('cerrado_en', null).select('id'), 'conductor.senal_nivel');
  if (error) { logger.error('conductor.senal_nivel_fallo', { episodio: ep.id, err: error.message }); return 'fallo'; }
  return data && data.length > 0 ? 'ganado' : 'perdido';
}

export async function cerrarEpisodioSenalVida(
  ep: Pick<EpisodioFila, 'id' | 'tenantId'> & Partial<Pick<EpisodioFila, 'nivelEnviado'>>, motivo: 'senal_recuperada' | 'viaje_cerrado', ahora: Date,
): Promise<void> {
  // «Señal recuperada» de un episodio que ya avisó deja silencio: un GPS que reporta cada ~50 min alterna obsoleto/ok y, sin silencio,
  // el chofer recibiría el aviso 1 cada hora sin fin.
  const silencia = motivo === 'senal_recuperada' && (ep.nivelEnviado ?? 0) >= 1;
  const { error } = await acotada(supabaseAdmin().from('viaje_senal_vida').update({
    cerrado_en: ahora.toISOString(), cierre_motivo: motivo,
    ...(silencia ? { silenciado_hasta: new Date(ahora.getTime() + MINUTOS_SILENCIO_RECUPERADA * 60_000).toISOString() } : {}),
  })
    .eq('id', ep.id).eq('tenant_id', ep.tenantId).is('cerrado_en', null), 'conductor.senal_cerrar');
  if (error) logger.warn('conductor.senal_cerrar_fallo', { episodio: ep.id, err: error.message });
}

export async function anotarFalloSenalVida(ep: Pick<EpisodioFila, 'id' | 'tenantId'>, texto: string): Promise<void> {
  const { error } = await acotada(supabaseAdmin().from('viaje_senal_vida').update({ ultimo_error: texto.slice(0, 200) }).eq('id', ep.id).eq('tenant_id', ep.tenantId), 'conductor.senal_error');
  if (error) logger.warn('conductor.senal_error_fallo', { episodio: ep.id, err: error.message });
}

/**
 * El chofer contestó un botón del «¿sigues bien?»: se cierra el episodio abierto del viaje con su respuesta y se SILENCIA para que
 * el mismo GPS mudo no abra otro enseguida. `sin_episodio` = ya estaba cerrado (un botón viejo): no se hace nada.
 */
export async function responderEpisodioSenalVida(
  tenantId: string, viajeId: string, respuesta: RespuestaSenalVida, silencioMin: number, ahora: Date,
): Promise<'cerrado' | 'sin_episodio' | 'fallo'> {
  const { data, error } = await acotada(supabaseAdmin().from('viaje_senal_vida').update({
    respondido_en: ahora.toISOString(), respuesta, cerrado_en: ahora.toISOString(), cierre_motivo: 'respondio',
    silenciado_hasta: new Date(ahora.getTime() + silencioMin * 60_000).toISOString(),
  }).eq('tenant_id', tenantId).eq('viaje_id', viajeId).is('cerrado_en', null).select('id'), 'conductor.senal_responder');
  if (error) {
    if (faltaEsquema(error, /viaje_senal_vida/i)) return 'sin_episodio';
    logger.error('conductor.senal_responder_fallo', { viaje: viajeId, err: error.message });
    return 'fallo';
  }
  return data && data.length > 0 ? 'cerrado' : 'sin_episodio';
}

/**
 * «Ya lo atiendo» del jefe: el episodio abierto del viaje se cierra Y SE SILENCIA (si no, la pasada siguiente abre otro con el mismo GPS
 * mudo, le repite el aviso 1 al chofer y reescala al jefe 45 min después de que dijo que lo atiende). Best-effort (una base sin la 0636
 * no tiene nada que cerrar).
 */
export async function cerrarEpisodioPorJefe(tenantId: string, viajeId: string, ahora: Date): Promise<number> {
  const { data, error } = await acotada(supabaseAdmin().from('viaje_senal_vida').update({
    cerrado_en: ahora.toISOString(), cierre_motivo: 'atendido_por_jefe', silenciado_hasta: new Date(ahora.getTime() + MINUTOS_SILENCIO_JEFE * 60_000).toISOString(),
  })
    .eq('tenant_id', tenantId).eq('viaje_id', viajeId).is('cerrado_en', null).select('id'), 'conductor.senal_jefe');
  if (error) {
    if (!faltaEsquema(error, /viaje_senal_vida/i)) logger.warn('conductor.senal_jefe_fallo', { viaje: viajeId, err: error.message });
    return 0;
  }
  return data?.length ?? 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// LOS EPISODIOS DE «SIN SEÑAL DE VIDA» PARA LA PANTALLA (nota S de la re-auditoría, ronda 18). Viven en `repo.ts` (la frontera de datos),
// no en `repo_validacion.ts`: así no suben el techo de `frontera_datos_guardiana`.
//
// Hasta aquí vivían solo en la base y en los avisos por WhatsApp: el tablero mostraba el estado del GPS y la excepción «sin reporte», no la
// cadena «primer aviso → segundo aviso → jefe de tráfico → cómo terminó». Un jefe de tráfico que llegaba al turno no tenía dónde verlo.
// ═══════════════════════════════════════════════════════════════════════════

export interface EpisodioTablero {
  id: string;
  viajeId: string;
  folio: string | null;
  operador: string | null;
  motivo: 'gps_obsoleto' | 'gps_detenido';
  abiertoEn: string;
  nivelEnviado: 0 | 1 | 2 | 3;
  aviso1En: string | null;
  aviso2En: string | null;
  escaladoEn: string | null;
  cerradoEn: string | null;
  cierreMotivo: 'respondio' | 'senal_recuperada' | 'viaje_cerrado' | 'atendido_por_jefe' | null;
  respuesta: 'estoy' | 'voy_a_cargar' | 'estoy_bien' | null;
}

const TOPE_EPISODIOS_TABLERO = 40;
const UUID_FILTRO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Los episodios abiertos en [`desde`, ahora] de UNA flota, el más reciente primero, con el folio y el chofer de su viaje. Los filtros del
 * tablero (patio, cliente, chofer) se aplican a través del viaje. `null` = la base no tiene la 0636 (sin episodios, no un error);
 * una base caída LANZA (el llamador lo muestra como «no se pudo leer», no como «cero episodios»).
 */
export async function leerEpisodiosParaTablero(
  tenantId: string, desde: Date, f: FiltrosTablero = {}, limite: number = TOPE_EPISODIOS_TABLERO,
): Promise<{ episodios: EpisodioTablero[]; hayMas: boolean } | null> {
  let viajeIds: string[] | null = null;
  if ((f.terminalId && UUID_FILTRO.test(f.terminalId)) || (f.clienteId && UUID_FILTRO.test(f.clienteId)) || (f.operadorId && UUID_FILTRO.test(f.operadorId))) {
    let q = supabaseAdmin().from('viaje').select('id').eq('tenant_id', tenantId);
    if (f.terminalId && UUID_FILTRO.test(f.terminalId)) q = q.eq('terminal_id', f.terminalId);
    if (f.clienteId && UUID_FILTRO.test(f.clienteId)) q = q.eq('cliente_id', f.clienteId);
    if (f.operadorId && UUID_FILTRO.test(f.operadorId)) q = q.eq('operador_id', f.operadorId);
    const rv = await acotada(q.gte('created_at', new Date(desde.getTime() - 45 * 86_400_000).toISOString()).order('id').limit(2000), 'tablero.episodios_viajes');
    viajeIds = ((exigir(rv as never, 'tablero.episodios_viajes') ?? []) as unknown as Fila[]).map((x) => String(x.id));
    if (viajeIds.length === 0) return { episodios: [], hayMas: false };
  }
  let q = supabaseAdmin().from('viaje_senal_vida')
    .select('id, viaje_id, motivo, abierto_en, nivel_enviado, aviso_1_en, aviso_2_en, escalado_en, cerrado_en, cierre_motivo, respuesta')
    .eq('tenant_id', tenantId).gte('abierto_en', desde.toISOString());
  if (viajeIds) q = q.in('viaje_id', viajeIds.slice(0, 1000));
  const r = await acotada(q.order('abierto_en', { ascending: false }).order('id').limit(limite + 1), 'tablero.episodios');
  if (r.error) {
    if (faltaEsquema(r.error, /viaje_senal_vida/i)) return null;
    throw new Error(`tablero.episodios: ${r.error.message}`);
  }
  const filas = ((r.data ?? []) as unknown as Fila[]);
  const hayMas = filas.length > limite;
  const visibles = filas.slice(0, limite);
  if (visibles.length === 0) return { episodios: [], hayMas: false };

  const ids = [...new Set(visibles.map((x) => String(x.viaje_id)))];
  const viajes = await traerPorIds<Fila>(ids, (t) => acotada(supabaseAdmin().from('viaje').select('id, folio, operador_id').eq('tenant_id', tenantId).in('id', t), 'tablero.episodios_folios') as never, 'tablero.episodios_folios');
  const viajePorId = new Map(viajes.map((v) => [String(v.id), v] as const));
  const opIds = [...new Set(viajes.map((v) => v.operador_id).filter((x): x is string => typeof x === 'string'))];
  const ops = opIds.length === 0 ? [] : await traerPorIds<Fila>(opIds, (t) => acotada(supabaseAdmin().from('operador').select('id, nombre').eq('tenant_id', tenantId).in('id', t), 'tablero.episodios_choferes') as never, 'tablero.episodios_choferes');
  const nombrePorOp = new Map(ops.map((o) => [String(o.id), String(o.nombre)] as const));
  const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

  return {
    hayMas,
    episodios: visibles.map((x): EpisodioTablero => {
      const v = viajePorId.get(String(x.viaje_id));
      const nivel = Number(x.nivel_enviado);
      return {
        id: String(x.id), viajeId: String(x.viaje_id), folio: v ? str(v.folio) : null,
        operador: v && typeof v.operador_id === 'string' ? nombrePorOp.get(v.operador_id) ?? null : null,
        motivo: x.motivo === 'gps_detenido' ? 'gps_detenido' : 'gps_obsoleto',
        abiertoEn: String(x.abierto_en), nivelEnviado: (nivel === 1 || nivel === 2 || nivel === 3 ? nivel : 0),
        aviso1En: str(x.aviso_1_en), aviso2En: str(x.aviso_2_en), escaladoEn: str(x.escalado_en), cerradoEn: str(x.cerrado_en),
        cierreMotivo: (['respondio', 'senal_recuperada', 'viaje_cerrado', 'atendido_por_jefe'] as const).find((c) => c === x.cierre_motivo) ?? null,
        respuesta: (['estoy', 'voy_a_cargar', 'estoy_bien'] as const).find((c) => c === x.respuesta) ?? null,
      };
    }),
  };
}

// ── 0800: los operadores voluntarios del piloto ──────────────────────────────
// Todo acotado por tenant. El tope y la marca viven en la base (0800); la REGLA (tope, teléfono, permiso) vive en
// `acciones_voluntarios.ts`, que usa estas primitivas. Sin la 0800 aplicada las lecturas lanzan un error en palabras.

export interface OperadorPiloto {
  id: string;
  nombre: string;
  /** Tal como está guardado en `operador.telefono`. */
  telefono: string;
  activo: boolean;
  voluntario: boolean;
  voluntarioDesde: string | null;
}

const COLUMNAS_PILOTO = 'id, nombre, telefono, activo, agente_voluntario, agente_voluntario_desde';
const SIN_0800 = 'El alta de voluntarios necesita la migración 0800 (aún no aplicada en esta base).';

function filaAOperadorPiloto(f: Fila): OperadorPiloto {
  return {
    id: String(f.id), nombre: String(f.nombre ?? ''), telefono: String(f.telefono ?? ''),
    activo: f.activo !== false, voluntario: f.agente_voluntario === true, voluntarioDesde: s(f.agente_voluntario_desde),
  };
}

function exigirPiloto(res: { error: { code?: string | null; message?: string | null } | null }, contexto: string): void {
  if (!res.error) return;
  if (faltaEsquema(res.error, /agente_voluntario|piloto_max_voluntarios|retirar_voluntario/) || res.error.code === 'PGRST202') throw new Error(SIN_0800);
  throw new Error(`${contexto}: ${res.error.message ?? 'error'}`);
}

/** Un operador DE ESTA flota (otra flota = `null`, como si no existiera). */
export async function leerOperadorPiloto(tenantId: string, operadorId: string): Promise<OperadorPiloto | null> {
  const res = await acotada(supabaseAdmin().from('operador').select(COLUMNAS_PILOTO).eq('tenant_id', tenantId).eq('id', operadorId).maybeSingle(), 'conductor.operadorPiloto');
  exigirPiloto(res as never, 'conductor.operadorPiloto');
  const f = (res as { data: Fila | null }).data;
  return f ? filaAOperadorPiloto(f) : null;
}

export async function listarVoluntarios(tenantId: string): Promise<OperadorPiloto[]> {
  const res = await acotada(supabaseAdmin().from('operador').select(COLUMNAS_PILOTO)
    .eq('tenant_id', tenantId).eq('agente_voluntario', true).order('agente_voluntario_desde', { ascending: true }).limit(200), 'conductor.voluntarios');
  exigirPiloto(res as never, 'conductor.voluntarios');
  return (((res as { data: Fila[] | null }).data) ?? []).map(filaAOperadorPiloto);
}

/** Operadores ACTIVOS que todavía no son voluntarios, por nombre o teléfono (el filtro de teléfono válido lo aplica quien llama). */
export async function buscarCandidatosVoluntarios(tenantId: string, texto: string, limite = 200): Promise<OperadorPiloto[]> {
  const t = texto.replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  let q = supabaseAdmin().from('operador').select(COLUMNAS_PILOTO).eq('tenant_id', tenantId).eq('activo', true).eq('agente_voluntario', false);
  if (t !== '') q = q.or(`nombre.ilike.%${t}%,telefono.ilike.%${t}%`);
  const res = await acotada(q.order('nombre', { ascending: true }).limit(limite), 'conductor.candidatosVoluntarios');
  exigirPiloto(res as never, 'conductor.candidatosVoluntarios');
  return (((res as { data: Fila[] | null }).data) ?? []).map(filaAOperadorPiloto);
}

export async function contarVoluntarios(tenantId: string): Promise<number> {
  const res = await acotada(supabaseAdmin().from('operador').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('agente_voluntario', true), 'conductor.contarVoluntarios');
  exigirPiloto(res as never, 'conductor.contarVoluntarios');
  return (res as { count: number | null }).count ?? 0;
}

/** T-A5-27: voluntarios activos de TODAS las flotas (solo el número, para el latido). Lanza si la base no tiene la 0800. */
export async function contarVoluntariosActivos(): Promise<number> {
  const res = await acotada(supabaseAdmin().from('operador').select('id', { count: 'exact', head: true }).eq('agente_voluntario', true).eq('activo', true), 'conductor.contarVoluntariosActivos');
  exigirPiloto(res as never, 'conductor.contarVoluntariosActivos');
  return (res as { count: number | null }).count ?? 0;
}

/** `piloto_max_voluntarios` de la flota (6 si todavía no tiene fila de configuración). */
export async function leerTopeVoluntarios(tenantId: string): Promise<number> {
  const res = await acotada(supabaseAdmin().from('agente_conductor_config').select('piloto_max_voluntarios').eq('tenant_id', tenantId).maybeSingle(), 'conductor.topeVoluntarios');
  exigirPiloto(res as never, 'conductor.topeVoluntarios');
  const v = ((res as { data: Fila | null }).data)?.piloto_max_voluntarios;
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : 6;
}

/** Enciende la marca SOLO si el operador es de la flota, está activo y aún no era voluntario. `false` = nada cambió. */
export async function marcarVoluntario(tenantId: string, operadorId: string, porUsuarioId: string | null, ahora: Date): Promise<boolean> {
  const res = await acotada(supabaseAdmin().from('operador')
    .update({ agente_voluntario: true, agente_voluntario_desde: ahora.toISOString(), agente_voluntario_por: porUsuarioId })
    .eq('tenant_id', tenantId).eq('id', operadorId).eq('activo', true).eq('agente_voluntario', false).select('id'), 'conductor.marcarVoluntario');
  exigirPiloto(res as never, 'conductor.marcarVoluntario');
  return (((res as { data: unknown[] | null }).data) ?? []).length > 0;
}

/** Apaga la marca y devuelve a «sin aceptar» los viajes abiertos importados de ese operador (función atómica de la 0800). Devuelve cuántos viajes dejaron de seguirse. */
export async function retirarVoluntario(tenantId: string, operadorId: string): Promise<number> {
  const res = await acotada(supabaseAdmin().rpc('retirar_voluntario', { p_tenant: tenantId, p_operador: operadorId }), 'conductor.retirarVoluntario');
  exigirPiloto(res as never, 'conductor.retirarVoluntario');
  const d = (res as { data: unknown }).data;
  return typeof d === 'number' ? d : 0;
}

// ── T-A5-25: los datos del preflight del piloto (solo lectura) ───────────────

/** Lo que el preflight necesita de la base, de UNA flota. Solo LEE: no manda nada ni escribe. Lanza si la base no contesta. */
export async function leerDatosPreflight(tenantId: string, ahora: Date = new Date()): Promise<DatosPreflight> {
  const [config, zonaDeclarada, voluntarios, contactos] = await Promise.all([
    leerConfigConductor(tenantId), getZonaHorariaTenant(tenantId), listarVoluntarios(tenantId), cargarContactosTrafico(tenantId),
  ]);
  const ids = voluntarios.map((o) => o.id);
  let viajes: DatosPreflight['viajes'] = [];
  const posicionesPorUnidad: DatosPreflight['posicionesPorUnidad'] = {};
  if (ids.length > 0) {
    // El piloto solo sigue viajes abiertos y aceptados de sus voluntarios.
    const rv = await acotada(supabaseAdmin().from('viaje').select('terminal_id, unidad_id, origen_geocerca_id, destino_geocerca_id')
      .eq('tenant_id', tenantId).eq('estatus', 'abierto').not('aceptado_en', 'is', null).in('operador_id', ids).order('id').limit(1000), 'conductor.preflight_viajes');
    const filas = (exigir(rv as never, 'conductor.preflight_viajes') ?? []) as unknown as Fila[];
    viajes = filas.map((f) => ({ terminalId: s(f.terminal_id), unidadId: s(f.unidad_id), conSitio: typeof f.origen_geocerca_id === 'string' && typeof f.destino_geocerca_id === 'string' }));
    const unidades = [...new Set(viajes.map((v) => v.unidadId).filter((u): u is string => u !== null))];
    if (unidades.length > 0) {
      const desde = new Date(ahora.getTime() - HORAS_GPS_RECIENTE * 3_600_000);
      const haceUnaHora = ahora.getTime() - 3_600_000;
      const rp = await acotada(supabaseAdmin().from('posicion').select('unidad_id, medida_en')
        .eq('tenant_id', tenantId).in('unidad_id', unidades).neq('proveedor', 'whatsapp').gte('medida_en', desde.toISOString()).order('medida_en', { ascending: false }).limit(5000), 'conductor.preflight_posiciones');
      const ps = (exigir(rp as never, 'conductor.preflight_posiciones') ?? []) as unknown as Fila[];
      const mut = posicionesPorUnidad as Record<string, { ultimas2h: number; ultimaHora: number }>;
      for (const p of ps) {
        const u = String(p.unidad_id);
        const c = mut[u] ?? (mut[u] = { ultimas2h: 0, ultimaHora: 0 });
        c.ultimas2h += 1;
        if (new Date(String(p.medida_en)).getTime() > haceUnaHora) c.ultimaHora += 1;
      }
    }
  }
  return {
    config: { activo: config.activo, perfilSeguimiento: config.perfilSeguimiento, solicitudesMin: config.solicitudesMin },
    zonaDeclarada, voluntarios: voluntarios.map((o) => ({ telefono: o.telefono })), viajes, posicionesPorUnidad, contactos,
  };
}

// ── T-A5-21: estado de tránsito (frontera) del tablero ──────────────────────

export interface TransitoViaje { estado: EstadoTransito; textoOrigen: string | null; actualizadoEn: string | null }

const ESTADOS_TRANSITO: readonly string[] = ['en_patio', 'en_ruta', 'pendiente_cruce', 'otro'];

/**
 * T-A5-21: lee el estado de tránsito de los viajes (columnas de la 0804). Solo se llama con la casilla encendida.
 * Si la lectura falla devuelve `undefined` (nunca inventa «sin estado»): la fila simplemente no pinta la columna.
 */
export async function leerTransitoViajes(tenantId: string, viajeIds: readonly string[]): Promise<Map<string, TransitoViaje> | undefined> {
  try {
    const filas = viajeIds.length === 0 ? [] : await traerPorIds<Fila>([...viajeIds], (t) => acotada(supabaseAdmin()
      .from('viaje').select('id, transito_estado, transito_actualizado_en, transito_texto_origen').eq('tenant_id', tenantId).in('id', t), 'tablero.transito') as never, 'tablero.transito');
    const m = new Map<string, TransitoViaje>();
    for (const f of filas) {
      const e = String(f.transito_estado ?? '');
      if (!ESTADOS_TRANSITO.includes(e)) continue;
      m.set(String(f.id), { estado: e as EstadoTransito, textoOrigen: s(f.transito_texto_origen), actualizadoEn: s(f.transito_actualizado_en) });
    }
    return m;
  } catch (e) {
    logger.warn('conductor.tablero_transito_no_leido', { err: e instanceof Error ? e.message : String(e) });
    return undefined;
  }
}

// ── T-A5-22: «Fecha Salida» sellada por el TMS (candidato a hito) ───────────

/**
 * T-A5-22: la marca de salida que el TMS selló en cada viaje (`viaje.tms_salida_en`, 0804), por id de viaje (ISO).
 * Solo trae los viajes que SÍ tienen marca. Si la lectura falla (p. ej. la 0804 aún no está aplicada) devuelve `undefined`:
 * el llamador no afirma nada y no registra nada.
 */
export async function leerSalidasTms(tenantId: string, viajeIds: readonly string[]): Promise<Map<string, string> | undefined> {
  try {
    const filas = viajeIds.length === 0 ? [] : await traerPorIds<Fila>([...viajeIds], (t) => acotada(supabaseAdmin()
      .from('viaje').select('id, tms_salida_en').eq('tenant_id', tenantId).in('id', t).not('tms_salida_en', 'is', null), 'conductor.salida_tms') as never, 'conductor.salida_tms');
    const m = new Map<string, string>();
    for (const f of filas) {
      const iso = s(f.tms_salida_en);
      if (iso && Number.isFinite(Date.parse(iso))) m.set(String(f.id), iso);
    }
    return m;
  } catch (e) {
    logger.warn('conductor.salida_tms_no_leida', { err: e instanceof Error ? e.message : String(e) });
    return undefined;
  }
}
