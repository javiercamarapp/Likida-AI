import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '../presupuesto';
import { exigir } from '../pg';
import {
  TIPOS_HITO, MINUTOS_SILENCIO_JEFE, MINUTOS_SILENCIO_RECUPERADA,
  type Contacto, type FuenteHito, type HitoFila, type InterpretacionHito, type TipoHito,
} from './tipos';
import type { LegadoSello } from './maquina';
import { CONFIG_CONDUCTOR_DEFAULT, validarConfigConductor, type ConfigConductor } from './config';
import { aHitoApi, type EventoApi, type FiltrosHitos, type HitoApi, type CambioCitas } from './lectura';
import type { AvisoReclamado } from './planificador';
import type { ContactoTrafico } from './escalamiento';
import type { EpisodioFila } from './senal_vida';
import type { MotivoSenalVida } from './solicitudes';
import type { RespuestaSenalVida } from './tipos';

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

/** Los cinco hitos del viaje, creándolos si faltan (idempotente: unique (viaje, tipo)). */
export async function asegurarHitos(tenantId: string, viajeId: string): Promise<HitoFila[]> {
  const actuales = await cargarHitos(tenantId, viajeId);
  if (actuales.length >= TIPOS_HITO.length) return actuales;
  const faltan = TIPOS_HITO.filter((t) => !actuales.some((h) => h.tipo === t));
  const res = await acotada(supabaseAdmin()
    .from('viaje_hito')
    .upsert(faltan.map((tipo) => ({ tenant_id: tenantId, viaje_id: viajeId, tipo })), { onConflict: 'viaje_id,tipo', ignoreDuplicates: true }), 'conductor.asegurar');
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
  citaOrigenEn: string | null;
  citaDestinoEn: string | null;
  etaOrigenEn: string | null;
  etaDestinoEn: string | null;
}

export const COLUMNAS_VIAJE_CTX =
  'id, tenant_id, folio, origen, destino, estatus, operador_id, terminal_id, unidad_id, aceptado_en, cita_origen_en, cita_destino_en, eta_origen_en, eta_destino_en, operador:operador_id(nombre, telefono)';

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
    citaOrigenEn: s(f.cita_origen_en),
    citaDestinoEn: s(f.cita_destino_en),
    etaOrigenEn: s(f.eta_origen_en),
    etaDestinoEn: s(f.eta_destino_en),
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

/** La config de una flota. Sin fila = defaults. LANZA si la base no contesta: «no pude leer» no es «defaults». */
export async function leerConfigConductor(tenantId: string): Promise<ConfigConductor> {
  const res = await acotada(supabaseAdmin()
    .from('agente_conductor_config').select('*').eq('tenant_id', tenantId).maybeSingle(), 'conductor.config');
  const f = exigir(res as never, 'conductor.config') as Fila | null;
  if (!f) return copiaDefaults();
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
  });
  if ('error' in v) {
    // La base tiene CHECKs equivalentes; llegar aquí es una fila corrupta. Se grita y se opera
    // con defaults, pero un `activo = false` explícito se respeta: encender por error un agente
    // que manda WhatsApp es peor que operar con la escalera de siempre.
    logger.error('conductor.config_invalida', { tenant: tenantId, err: v.error });
    return { ...copiaDefaults(), activo: f.activo !== false };
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
      throw new Error(faltante.mig === '0604'
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
  tenantId: string, viajeId: string, lado: 'origen' | 'destino', sitioId: string, criterio: 'codigo' | 'nombre_exacto' | 'nombre_contenido', ahora: Date,
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
