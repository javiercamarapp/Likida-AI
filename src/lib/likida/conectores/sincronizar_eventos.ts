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
// de asistencia — y el disparo es un BARRIDO idempotente sobre las filas
// `grave` con unidad y `procesado_en` NULL, no un efecto del INSERT.
//
// AUDITORÍA FABLE CICLO 2 (c2-1): antes se disparaba solo la fila recién
// insertada y se sellaba `procesado_en` INCONDICIONALMENTE — un disparo que
// fallaba (timeout de Supabase, kill de Vercel a mitad del loop: el cron trae
// maxDuration=300 y las posiciones solas ya toman ~180 s) dejaba el evento
// sellado-o-huérfano para siempre: el 🚨 de una colisión real jamás salía y
// nada lo rebarrería. Ahora el sello dice la verdad (solo tras un disparo que
// NO falló) y la siguiente corrida rebarre lo pendiente. La dedupe del 🚨 no
// vive aquí: vive en los índices 0201/0206 y en `expedienteAbierto`.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '../presupuesto';
import { descifrar } from './cofre';
import { lectorEventosDe, LECTORES_EVENTOS, esEventoGrave, type EventoSeguridadLeido } from './eventos_seguridad';
import { dispararAsistenciaPorEventoCamara } from '../asistencia_camara';
import type { Http } from './tipos';
import { conPool } from '../lotes';
import { unidadesSinAvisoPrevio } from '../privacidad';

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
  /**
   * AUDITORÍA 24, LEG-1 (CRÍTICO). Unidades cuyo operador ACTUAL (viaje vivo)
   * no ha recibido el aviso de privacidad: sus eventos de cámara —conducta al
   * volante, con lat/lng y video— NO se guardan. Mismo criterio y misma
   * compuerta que el poller de posiciones (`privacidad.ts`).
   */
  sinAvisoPrevio?: number;
  /** La corrida se quedó sin presupuesto de tiempo ANTES de tocar esta flota.
   *  Sus eventos —incluido el barrido de graves pendientes— quedan para la
   *  corrida siguiente: la ventana traslapada de 30 min y el rebarrido por
   *  `procesado_en` NULL están diseñados exactamente para absorber esto. */
  sinTurno?: boolean;
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
  // OJO: una ventana vacía NO regresa temprano — el barrido de graves
  // pendientes (abajo) tiene que correr aunque hoy no haya eventos nuevos:
  // ahí es donde se reintenta el disparo que falló hace dos corridas.

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

  // ── LEG-1: NO SE TRATA ANTES DE AVISAR ──────────────────────────────────
  // Se resuelve UNA vez por corrida para las unidades con evento; si la base
  // no contesta, no se guarda ningún evento de esta flota (fallar cerrado).
  // Los huérfanos (sin unidad) no están ligados a una persona y siguen igual.
  const conUnidad = [...new Set(eventos.map((e) => (e.assetId ? porDevice.get(e.assetId) : undefined)).filter((u): u is string => !!u))];
  let sinAviso = new Set<string>();
  if (conUnidad.length > 0) {
    const compuerta = await unidadesSinAvisoPrevio(tenantId, conUnidad);
    if (compuerta.error) return { ...base, error: `no se guardó ningún evento: ${compuerta.error}` };
    sinAviso = compuerta.sinAviso;
    if (sinAviso.size > 0) {
      base.sinAvisoPrevio = sinAviso.size;
      logger.warn('eventos.sin_aviso_previo', { tenantId, proveedor: conectorId, unidades: sinAviso.size });
    }
  }

  for (const e of eventos) {
    const unidadId = e.assetId ? porDevice.get(e.assetId) ?? null : null;
    if (!unidadId) base.huerfanos += 1;
    if (unidadId && sinAviso.has(unidadId)) continue;

    // El INSERT decide si el evento es nuevo: `ignoreDuplicates` con la
    // unicidad de la 0203 hace que la reentrega de la ventana traslapada no
    // cuente dos veces. Se inserta UNO POR UNO a propósito: `guardados` mide
    // filas que de verdad entraron, y un upsert masivo con ignoreDuplicates
    // no devuelve cuáles.
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
    if ((fila ?? []).length > 0) base.guardados += 1;
  }

  // ── EL BARRIDO DE GRAVES PENDIENTES (c2-1) ────────────────────────────────
  // Se dispara sobre lo que la TABLA dice que falta (`grave`, con unidad, sin
  // sellar), no sobre lo recién insertado: así el evento cuyo disparo falló
  // —o cuya corrida murió a mitad— se reintenta solo, en la siguiente pasada.
  // El sello se escribe ÚNICAMENTE tras un disparo que no falló; la dedupe
  // del 🚨 la garantizan los índices 0201/0206, no este cursor.
  const { data: pendientes, error: errPend } = await acotada(
    supabaseAdmin().from('evento_seguridad_flota')
      .select('evento_id_externo, unidad_id, etiquetas, lat, lng, ocurrido_en, url_evento, max_g')
      .eq('tenant_id', tenantId)
      .eq('proveedor', conectorId)
      .eq('grave', true)
      .not('unidad_id', 'is', null)
      .is('procesado_en', null)
      .order('ocurrido_en', { ascending: true })
      .limit(TOPE_POR_FLOTA),
    'eventos.pendientes',
  );
  if (errPend) {
    logger.error('eventos.pendientes_ilegibles', { tenantId, proveedor: conectorId, err: errPend.message });
    return { ...base, error: `no se pudieron leer los graves pendientes: ${errPend.message}` };
  }
  for (const p of pendientes ?? []) {
    const disparo = await dispararAsistenciaPorEventoCamara({
      tenantId,
      unidadId: String(p.unidad_id),
      proveedor: conectorId,
      eventoIdExterno: String(p.evento_id_externo),
      etiquetas: (p.etiquetas as string[]) ?? [],
      lat: p.lat === null ? null : Number(p.lat),
      lng: p.lng === null ? null : Number(p.lng),
      ocurridoEn: String(p.ocurrido_en),
      urlEvento: (p.url_evento as string | null) ?? null,
      maxG: p.max_g === null ? null : Number(p.max_g),
    });
    if (disparo.resultado === 'fallo') {
      // SIN sello: la fila queda pendiente y la siguiente corrida la rebarre.
      logger.warn('eventos.disparo_fallido', { tenantId, evento: p.evento_id_externo });
      continue;
    }
    base.disparos += 1;
    const { error: errSello } = await acotada(
      supabaseAdmin().from('evento_seguridad_flota')
        .update({ procesado_en: new Date().toISOString(), incidencia_id: disparo.incidenciaId ?? null })
        .eq('tenant_id', tenantId).eq('proveedor', conectorId).eq('evento_id_externo', String(p.evento_id_externo)),
      'eventos.sellar',
    );
    if (errSello) {
      // El disparo YA salió; sin sello la siguiente corrida lo reintentará y
      // los índices 0201/0206 lo convertirán en anotación, no en segundo 🚨.
      logger.warn('eventos.sello_fallo', { tenantId, evento: p.evento_id_externo, err: errSello.message });
    }
  }

  if (base.huerfanos > 0) {
    logger.warn('eventos.huerfanos', { tenantId, proveedor: conectorId, huerfanos: base.huerfanos });
  }
  return base;
}

/**
 * Sincroniza los eventos de TODAS las flotas con credencial activa. Se llama
 * desde el cron de GPS, después de las posiciones.
 *
 * ── EL RELOJ (patrón del PR #152 / `vigilarPortales`) ─────────────────────
 * El `venceEn` es EL MISMO que el de las posiciones (molde de `descarga-sat`:
 * un reloj compartido entre las dos fases en serie, para que ninguna se coma
 * a ciegas el presupuesto de la otra). El corte va ANTES de despachar cada
 * flota, nunca a media flota; una flota sin turno sale con `sinTurno: true` y
 * el cron late `parcial`. Es lo que faltaba del arreglo c2-1: la recuperación
 * idempotente ya existía (rebarrido de graves), pero el kill de Vercel a media
 * corrida seguía siendo posible y MUDO — sin latido y sin barrido de graves.
 */
export async function sincronizarEventosTodas(
  http: Http,
  opts: { venceEn?: number; ahora?: () => number } = {},
): Promise<ResultadoSyncEventos[]> {
  const ahora = opts.ahora ?? Date.now;
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
  const resultados = await conPool(credenciales, ANCHO_FANOUT_FLOTAS, async (c) => {
    // El reloj se mira ANTES de despachar cada flota, no una vez al principio:
    // el patrón de `conRelojDuro`/`vigilarPortales`.
    if (opts.venceEn !== undefined && ahora() >= opts.venceEn) {
      return {
        tenantId: String(c.tenant_id), proveedor: String(c.conector_id),
        leidos: 0, guardados: 0, huerfanos: 0, disparos: 0, sinTurno: true,
      } satisfies ResultadoSyncEventos;
    }
    return sincronizarEventosDeFlota(String(c.tenant_id), String(c.conector_id), String(c.valores_cifrados), http);
  });
  const salida = resultados.map((r, i) => {
    if ('ok' in r) return r.ok;
    const c = credenciales[i];
    return {
      tenantId: String(c.tenant_id), proveedor: String(c.conector_id),
      leidos: 0, guardados: 0, huerfanos: 0, disparos: 0,
      error: r.error instanceof Error ? r.error.message : String(r.error),
    };
  });
  const sinTurno = salida.filter((r) => r.sinTurno).length;
  if (sinTurno > 0) {
    // WARN con nombre propio: aquí lo que se queda sin correr es el barrido de
    // graves (choque/volcadura). La corrida siguiente lo rebarre — pero se dice.
    logger.warn('eventos.corte_por_reloj', { sinTurno, flotas: salida.length });
  }
  return salida;
}
