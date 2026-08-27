// ═══════════════════════════════════════════════════════════════════════════
// EL POLLER DE EVENTOS DE SEGURIDAD — corre DENTRO del cron de GPS.
//
// No es un cron nuevo a propósito: cada cron fijo cuesta (la tabla de
// COSTO-VERCEL-50K lo mide), y el de GPS ya corre cada 5 minutos e itera
// exactamente las flotas con credencial. Eventos y posiciones comparten
// proveedor, credencial y cadencia — separar el poller duplicaría todo eso
// para ganar nada.
//
// ── LA VENTANA TRASLAPADA ─────────────────────────────────────────────────
// Cada corrida pide los eventos CREADOS en los últimos 30 minutos: seis veces
// la cadencia. La idempotencia por `(tenant_id, proveedor, evento_id_externo)`
// (0203) absorbe las repeticiones; el traslape cubre corridas saltadas
// (deploy, cold start, un 500 del proveedor) sin llevar estado de cursor por
// flota — el estado es el enemigo silencioso de los pollers.
//
// ── QUÉ DISPARA Y QUÉ SOLO SE REGISTRA ────────────────────────────────────
// TODO evento entra a `evento_seguridad_flota` (el futuro agente de coaching
// leerá de ahí — fuera de alcance hoy, documentado en el plan maestro). Solo
// los GRAVES (`esEventoGrave`: crash/impacto/volcadura) disparan el circuito
// de asistencia, y solo los RECIÉN INSERTADOS: un evento que ya estaba en la
// tabla ya disparó (o ya se decidió que no) — reprocesarlo duplicaría el 🚨.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '../presupuesto';
import { descifrar } from './cofre';
import { lectorEventosDe, LECTORES_EVENTOS, esEventoGrave, type EventoSeguridadLeido } from './eventos_seguridad';
import { dispararAsistenciaPorEventoCamara } from '../asistencia_camara';
import type { Http } from './tipos';
import { conPool } from '../lotes';

/** 6× la cadencia del cron: cubre corridas saltadas sin estado por flota. */
const VENTANA_MS = 30 * 60 * 1000;
/** Techo por corrida y flota — un backlog del proveedor no puede volverse
 *  una corrida infinita. Lo recortado entra en la siguiente ventana. */
const TOPE_POR_FLOTA = 200;
const ANCHO_FANOUT_FLOTAS = 4;

export interface ResultadoSyncEventos {
  tenantId: string;
  proveedor: string;
  leidos: number;
  guardados: number;
  /** Eventos cuyo vehículo no lo reclama ninguna unidad. Se reportan. */
  huerfanos: number;
  /** Expedientes de asistencia abiertos o alimentados por esta corrida. */
  disparos: number;
  /** El token sirve pero no trae el scope de eventos: el panel debe decirlo. */
  sinPermiso?: boolean;
  error?: string;
}

/** Segunda barrera (mismo criterio que `posicionValida`): lo que cruza a
 *  Postgres viene de un tercero y se valida aquí aunque el lector ya filtre. */
function eventoValido(e: EventoSeguridadLeido): boolean {
  return e.eventoId.trim().length > 0 && e.eventoId.length <= 200 &&
    Number.isFinite(Date.parse(e.ocurridoEn)) &&
    (e.lat === null || (Number.isFinite(e.lat) && e.lat >= -90 && e.lat <= 90)) &&
    (e.lng === null || (Number.isFinite(e.lng) && e.lng >= -180 && e.lng <= 180)) &&
    e.etiquetas.every((t) => t.length <= 100) && e.etiquetas.length <= 20;
}

/** Sincroniza los eventos de seguridad de UNA flota con UN proveedor. */
export async function sincronizarEventosDeFlota(
  tenantId: string,
  conectorId: string,
  valoresCifrados: string,
  http: Http,
  ahora: Date = new Date(),
): Promise<ResultadoSyncEventos> {
  const base: ResultadoSyncEventos = { tenantId, proveedor: conectorId, leidos: 0, guardados: 0, huerfanos: 0, disparos: 0 };

  const lector = lectorEventosDe(conectorId);
  if (!lector) return { ...base, error: `todavía no hay lector de eventos para ${conectorId}` };

  let valores;
  try {
    valores = descifrar(valoresCifrados);
  } catch (e) {
    return { ...base, error: `no se pudo descifrar la credencial: ${e instanceof Error ? e.message : String(e)}` };
  }

  const desde = new Date(ahora.getTime() - VENTANA_MS).toISOString();
  const r = await lector(valores, http, desde);
  if (!r.ok) {
    if (r.sinPermiso) {
      // No es un fallo de la corrida: es una credencial a la que le falta un
      // scope. Se reporta con nombre para que el panel y el dueño lo vean.
      logger.warn('eventos.sin_permiso', { tenantId, proveedor: conectorId });
      return { ...base, sinPermiso: true, error: r.motivo };
    }
    return { ...base, error: r.motivo };
  }

  const eventos = r.eventos.filter(eventoValido).slice(0, TOPE_POR_FLOTA);
  base.leidos = eventos.length;
  if (eventos.length === 0) return base;

  // ── ASSET → UNIDAD, filtrando por flota (mismo candado que posiciones) ──
  const ids = [...new Set(eventos.map((e) => e.assetId).filter((x): x is string => x !== null))];
  const porDevice = new Map<string, string>();
  if (ids.length > 0) {
    const { data: unidades, error: errU } = await acotada(
      supabaseAdmin().from('unidad')
        .select('id, gps_device_id')
        .eq('tenant_id', tenantId)
        .eq('gps_proveedor', conectorId)
        .in('gps_device_id', ids),
      'eventos.unidades',
    );
    if (errU) return { ...base, error: `no se pudieron leer las unidades: ${errU.message}` };
    for (const u of unidades ?? []) {
      if (u.gps_device_id) porDevice.set(String(u.gps_device_id), String(u.id));
    }
  }

  for (const e of eventos) {
    const unidadId = e.assetId ? porDevice.get(e.assetId) ?? null : null;
    if (!unidadId) base.huerfanos += 1;

    // El INSERT decide si el evento es nuevo: `ignoreDuplicates` con la
    // unicidad de la 0203 hace que la reentrega de la ventana traslapada no
    // cuente ni dispare dos veces. Se inserta UNO POR UNO a propósito: el
    // disparo depende de saber cuál fila es nueva, y un upsert masivo con
    // ignoreDuplicates no devuelve cuáles entraron.
    const { data: fila, error: errIns } = await acotada(
      supabaseAdmin().from('evento_seguridad_flota')
        .upsert({
          tenant_id: tenantId,
          proveedor: conectorId,
          evento_id_externo: e.eventoId,
          unidad_id: unidadId,
          etiquetas: e.etiquetas,
          grave: esEventoGrave(e.etiquetas),
          lat: e.lat,
          lng: e.lng,
          ocurrido_en: e.ocurridoEn,
          url_evento: e.urlEvento,
          max_g: e.maxG,
        }, { onConflict: 'tenant_id,proveedor,evento_id_externo', ignoreDuplicates: true })
        .select('id'),
      'eventos.guardar',
    );
    if (errIns) {
      logger.warn('eventos.no_guardado', { tenantId, evento: e.eventoId, err: errIns.message });
      continue;
    }
    const esNuevo = (fila ?? []).length > 0;
    if (!esNuevo) continue;
    base.guardados += 1;

    // Solo los graves, solo los nuevos, y solo con unidad: sin unidad no se
    // sabe de quién es la emergencia y un 🚨 sin unidad ni chofer no le da al
    // jefe nada que atender (queda el huérfano reportado y la fila guardada).
    if (unidadId && esEventoGrave(e.etiquetas)) {
      const disparo = await dispararAsistenciaPorEventoCamara({
        tenantId,
        unidadId,
        proveedor: conectorId,
        eventoIdExterno: e.eventoId,
        etiquetas: e.etiquetas,
        lat: e.lat,
        lng: e.lng,
        ocurridoEn: e.ocurridoEn,
        urlEvento: e.urlEvento,
        maxG: e.maxG,
      });
      if (disparo.resultado !== 'fallo') base.disparos += 1;
      // Sellar el procesamiento en la fila — la bitácora del expediente ya
      // llevó el detalle; esto deja el rastro en la tabla de eventos.
      await acotada(
        supabaseAdmin().from('evento_seguridad_flota')
          .update({ procesado_en: new Date().toISOString(), incidencia_id: disparo.incidenciaId ?? null })
          .eq('tenant_id', tenantId).eq('proveedor', conectorId).eq('evento_id_externo', e.eventoId),
        'eventos.sellar',
      );
    }
  }

  if (base.huerfanos > 0) {
    logger.warn('eventos.huerfanos', { tenantId, proveedor: conectorId, huerfanos: base.huerfanos });
  }
  return base;
}

/** Sincroniza los eventos de TODAS las flotas con credencial activa. Se llama
 *  desde el cron de GPS, después de las posiciones. */
export async function sincronizarEventosTodas(http: Http): Promise<ResultadoSyncEventos[]> {
  const { data, error } = await acotada(
    supabaseAdmin().from('conector_credencial')
      .select('tenant_id, conector_id, valores_cifrados')
      .eq('activo', true)
      .in('conector_id', Object.keys(LECTORES_EVENTOS)),
    'eventos.credenciales',
  );
  if (error) {
    // Mismo criterio que el poller de posiciones: esta lectura define el
    // universo de la corrida; [] silencioso pintaría verde una base caída.
    throw new Error(`eventos.credenciales: ${error.message}`);
  }

  const credenciales = data ?? [];
  const resultados = await conPool(credenciales, ANCHO_FANOUT_FLOTAS, async (c) =>
    sincronizarEventosDeFlota(String(c.tenant_id), String(c.conector_id), String(c.valores_cifrados), http),
  );
  return resultados.map((r, i) => {
    if ('ok' in r) return r.ok;
    const c = credenciales[i];
    return {
      tenantId: String(c.tenant_id), proveedor: String(c.conector_id),
      leidos: 0, guardados: 0, huerfanos: 0, disparos: 0,
      error: r.error instanceof Error ? r.error.message : String(r.error),
    };
  });
}
