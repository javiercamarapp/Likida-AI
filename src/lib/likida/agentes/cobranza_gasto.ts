import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '../presupuesto';
import { traerTodo, traerPorIds, conteo } from '../pg';
import { enviarConFallback } from '@/lib/meta/enviar_con_fallback';
import { PLANTILLA } from '@/lib/meta/plantillas_catalogo';
import { alertarOperador } from '@/lib/observability/alerta';
import {
  CONFIG_GASTO_DEFAULT, validarConfigGasto, planearCobroGasto, motivoFaltante, armarMensajeGastos,
  parametrosPlantillaGastos, cupoRestante, inicioDelDiaMx, calcularEfectividad,
  type ConfigGasto, type GastoDeOperador, type ItemCobro, type PlanCobroGasto, type MotivoComprobante,
  type ContactoMedible, type Efectividad, type OperadorCobro,
} from './cobranza_gasto_pura';

// ═══════════════════════════════════════════════════════════════════════════
// LA COBRANZA POR GASTO (0525) — el lado con base de datos.
//
// La cobranza por viaje (cobranza.ts) sigue igual. Cuando la flota enciende
// `por_gasto`, este módulo cobra por GASTO individual:
//
//   · QUÉ comprobante falta de QUÉ gasto (motivoFaltante, puro);
//   · cadencia escalonada POR GASTO (tiers en días desde que se capturó);
//   · FUSIÓN por chofer: todos los gastos pendientes de un chofer salen en UN
//     mensaje, no en uno por gasto (un chofer con 8 gastos recibe 1 WhatsApp);
//   · TOPE DIARIO de mensajes por chofer (lo que no cabe espera a mañana SIN
//     consumir tier) y la ventana horaria de la flota (la aplica el llamador);
//   · CLAIM anti-duplicado: el INSERT de `cobranza_gasto_contacto` con unique
//     (gasto, tier) decide quién manda; el lote entero se reclama en UN insert
//     atómico (todo o nada) ANTES de mandar;
//   · el envío va por `enviarConFallback`: texto con la ventana de 24 h abierta,
//     plantilla `cobranza_gastos_v1` con ella cerrada;
//   · EFECTIVIDAD: un barrido marca como resuelto lo que dejó de faltar, para que
//     el tablero mida qué porcentaje de avisos produjo el comprobante y en
//     cuánto tiempo.
// ═══════════════════════════════════════════════════════════════════════════

export * from './cobranza_gasto_pura';

/** Rechazos reintentables SEGUIDOS que detienen la corrida (mismo criterio RES-1 que la cobranza por viaje). */
export const TOPE_RECHAZOS_META_GASTO = 5;
/** Cuánto atrás mide la efectividad. */
export const DIAS_EFECTIVIDAD = 30;
/** Retención de la bitácora por gasto: igual que `cobranza_contacto` (0332). */
export const DIAS_RETENCION_GASTO = 180;

// ── Config ──────────────────────────────────────────────────────────────────

export async function leerConfigGasto(tenantId: string): Promise<ConfigGasto> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('agente_cobranza_config')
    .select('por_gasto, tiers_gasto, max_mensajes_dia, conceptos_cfdi, umbral_foto')
    .eq('tenant_id', tenantId)
    .maybeSingle(), 'cobranza_gasto.config');
  if (error) {
    // Base SIN migrar (0525): columna o tabla inexistente = la cobranza por gasto no existe todavía. Cae al camino
    // de siempre (por viaje) con la función APAGADA y lo dice en el log; cualquier otro fallo sí lanza.
    if (error.code === '42703' || error.code === '42P01') {
      logger.warn('cobranza_gasto.base_sin_migrar', { tenantId, codigo: error.code });
      return CONFIG_GASTO_DEFAULT;
    }
    throw new Error(`leerConfigGasto: ${error.message}`);
  }
  if (!data) return CONFIG_GASTO_DEFAULT;
  const v = validarConfigGasto({
    porGasto: data.por_gasto as boolean,
    tiersGasto: (data.tiers_gasto as number[]) ?? undefined,
    maxMensajesDia: Number(data.max_mensajes_dia),
    conceptosCfdi: (data.conceptos_cfdi as string[]) ?? undefined,
    umbralFoto: Number(data.umbral_foto),
  });
  if ('error' in v) {
    // Una fila corrupta no tumba al agente: cae a los defaults (APAGADO) y se grita.
    logger.error('cobranza_gasto.config_corrupta', { tenantId, err: v.error });
    return CONFIG_GASTO_DEFAULT;
  }
  return v.ok;
}

export async function guardarConfigGasto(tenantId: string, cruda: Partial<ConfigGasto>): Promise<{ error?: string }> {
  const v = validarConfigGasto(cruda);
  if ('error' in v) return { error: v.error };
  const { error } = await acotada(supabaseAdmin()
    .from('agente_cobranza_config')
    .upsert({
      tenant_id: tenantId,
      por_gasto: v.ok.porGasto,
      tiers_gasto: v.ok.tiersGasto,
      max_mensajes_dia: v.ok.maxMensajesDia,
      conceptos_cfdi: v.ok.conceptosCfdi,
      umbral_foto: v.ok.umbralFoto,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id' }), 'cobranza_gasto.guardar_config');
  if (error) return { error: 'No se pudo guardar la configuración. Inténtalo de nuevo.' };
  return {};
}

// ── La cola ─────────────────────────────────────────────────────────────────

interface FilaGasto {
  id: string; viaje_id: string; concepto: string; monto: number | string; fecha: string | null;
  created_at: string; imagen_url: string | null; cfdi_uuid: string | null;
  ocr_confianza: number | string | null; cfdi_esquema_alterno: boolean | null; estado_sat: string | null;
}

interface FilaViaje {
  id: string; folio: string | null; operador_id: string | null; operador: unknown;
}

/** Los gastos de los viajes VIVOS de la flota que Likida avisó (mismo criterio que la cobranza por viaje:
 *  un viaje histórico importado del TMS, sin aviso, no se cobra por WhatsApp). */
export async function gastosParaCobrar(tenantId: string): Promise<GastoDeOperador[]> {
  const viajes = await traerTodo<FilaViaje>(
    (d, h) => supabaseAdmin()
      .from('viaje')
      .select('id, folio, operador_id, operador:operador_id(id, nombre, telefono)', conteo(d))
      .eq('tenant_id', tenantId)
      .in('estatus', ['abierto', 'en_cuadre'])
      .not('avisado_en', 'is', null)
      .not('operador_id', 'is', null)
      .order('id').range(d, h),
    'cobranza_gasto.viajes',
  );
  if (viajes.length === 0) return [];

  const porViaje = new Map<string, { folio: string | null; operador: OperadorCobro }>();
  type Rel = { id?: string; nombre?: string | null; telefono?: string | null };
  for (const v of viajes) {
    const rel = v.operador as Rel | Rel[] | null;
    const op = Array.isArray(rel) ? rel[0] : rel;
    if (!v.operador_id) continue;
    porViaje.set(v.id, {
      folio: v.folio ?? null,
      operador: { operadorId: v.operador_id, nombre: op?.nombre ?? null, telefono: op?.telefono ?? null },
    });
  }

  // `traerPorIds`: un `.in()` con más de mil viajes vivos se recortaría en silencio (ver pg.ts).
  const filas = await traerPorIds<FilaGasto>(
    [...porViaje.keys()],
    (tanda) => supabaseAdmin()
      .from('gasto')
      .select('id, viaje_id, concepto, monto, fecha, created_at, imagen_url, cfdi_uuid, ocr_confianza, cfdi_esquema_alterno, estado_sat')
      .eq('tenant_id', tenantId)
      .in('viaje_id', tanda)
      .order('id'),
    'cobranza_gasto.gastos',
  );

  const salida: GastoDeOperador[] = [];
  for (const g of filas) {
    const viaje = porViaje.get(g.viaje_id);
    if (!viaje) continue;
    salida.push({
      id: g.id, viajeId: g.viaje_id, folioViaje: viaje.folio, concepto: g.concepto,
      monto: Number(g.monto), fecha: g.fecha ?? null, creadoEn: g.created_at,
      imagenUrl: g.imagen_url ?? null, cfdiUuid: g.cfdi_uuid ?? null,
      ocrConfianza: g.ocr_confianza === null || g.ocr_confianza === undefined ? null : Number(g.ocr_confianza),
      cfdiEsquemaAlterno: g.cfdi_esquema_alterno ?? null, estadoSat: g.estado_sat ?? null,
      operador: viaje.operador,
    });
  }
  return salida;
}

/** Los tiers ya contactados por gasto (para que insistir sea escalar, no repetir). */
async function tiersPrevios(tenantId: string, gastoIds: string[]): Promise<Map<string, number[]>> {
  const mapa = new Map<string, number[]>();
  if (gastoIds.length === 0) return mapa;
  const filas = await traerPorIds<{ gasto_id: string; tier: number }>(
    gastoIds,
    (tanda) => supabaseAdmin()
      .from('cobranza_gasto_contacto')
      .select('gasto_id, tier')
      .eq('tenant_id', tenantId)
      .in('gasto_id', tanda)
      .order('id'),
    'cobranza_gasto.tiers_previos',
  );
  for (const f of filas) {
    const lista = mapa.get(f.gasto_id) ?? [];
    lista.push(Number(f.tier));
    mapa.set(f.gasto_id, lista);
  }
  return mapa;
}

/** La cola honesta por gasto (lo que la página enseña y lo que `ejecutarCobranzaGastos` va a intentar). */
export async function colaPorGasto(tenantId: string, ahora: Date = new Date()): Promise<{ plan: PlanCobroGasto; config: ConfigGasto }> {
  const config = await leerConfigGasto(tenantId);
  const gastos = await gastosParaCobrar(tenantId);
  const candidatos = gastos.filter((g) => motivoFaltante(g, config) !== null).map((g) => g.id);
  const previos = await tiersPrevios(tenantId, candidatos);
  return { plan: planearCobroGasto(gastos, config, previos, ahora), config };
}

// ── La resolución (efectividad) ─────────────────────────────────────────────

/**
 * Marca como resuelto lo que ya no falta. Barre los avisos ENVIADOS y aún abiertos de los últimos
 * `DIAS_EFECTIVIDAD` días: si el gasto ya tiene su comprobante → 'chofer' (el aviso funcionó, o al menos
 * el comprobante llegó); si el viaje ya se liquidó con el comprobante faltando → 'cierre'.
 * Devuelve cuántos marcó. Nunca lanza por un fallo de escritura (la medición no debe tumbar la corrida).
 */
export async function marcarResueltos(tenantId: string, ahora: Date, config: ConfigGasto): Promise<number> {
  const desde = new Date(ahora.getTime() - DIAS_EFECTIVIDAD * 86_400_000).toISOString();
  const { data, error } = await acotada(supabaseAdmin()
    .from('cobranza_gasto_contacto')
    .select('id, gasto_id')
    .eq('tenant_id', tenantId)
    .eq('enviado', true)
    .is('resuelto_en', null)
    .gte('created_at', desde)
    .order('created_at', { ascending: true })
    .order('id')
    .limit(1_000), 'cobranza_gasto.abiertos');
  if (error) {
    logger.warn('cobranza_gasto.abiertos_ilegibles', { tenantId, err: error.message });
    return 0;
  }
  const abiertos = (data ?? []) as Array<{ id: string; gasto_id: string }>;
  if (abiertos.length === 0) return 0;

  let gastos: Array<FilaGasto & { viaje: unknown }>;
  try {
    gastos = await traerPorIds<FilaGasto & { viaje: unknown }>(
      [...new Set(abiertos.map((a) => a.gasto_id))],
      (tanda) => supabaseAdmin()
        .from('gasto')
        .select('id, viaje_id, concepto, monto, fecha, created_at, imagen_url, cfdi_uuid, ocr_confianza, cfdi_esquema_alterno, estado_sat, viaje:viaje_id(estatus)')
        .eq('tenant_id', tenantId)
        .in('id', tanda)
        .order('id'),
      'cobranza_gasto.resolucion',
    );
  } catch (e) {
    logger.warn('cobranza_gasto.resolucion_ilegible', { tenantId, err: e instanceof Error ? e.message : String(e) });
    return 0;
  }
  const porId = new Map(gastos.map((g) => [g.id, g]));
  const aChofer: string[] = [];
  const aCierre: string[] = [];
  for (const a of abiertos) {
    const g = porId.get(a.gasto_id);
    if (!g) continue; // borrado: su fila de cobranza se va con él (cascade)
    const falta = motivoFaltante({
      id: g.id, viajeId: g.viaje_id, folioViaje: null, concepto: g.concepto, monto: Number(g.monto), fecha: g.fecha,
      creadoEn: g.created_at, imagenUrl: g.imagen_url, cfdiUuid: g.cfdi_uuid,
      ocrConfianza: g.ocr_confianza === null || g.ocr_confianza === undefined ? null : Number(g.ocr_confianza),
      cfdiEsquemaAlterno: g.cfdi_esquema_alterno, estadoSat: g.estado_sat,
    }, config);
    if (falta === null) { aChofer.push(a.id); continue; }
    const rel = g.viaje as { estatus?: string } | Array<{ estatus?: string }> | null;
    const estatus = Array.isArray(rel) ? rel[0]?.estatus : rel?.estatus;
    if (estatus === 'liquidado') aCierre.push(a.id);
  }

  let marcados = 0;
  for (const [ids, por] of [[aChofer, 'chofer'], [aCierre, 'cierre']] as const) {
    for (let i = 0; i < ids.length; i += 200) {
      const { data: hechos, error: errMarca } = await acotada(supabaseAdmin()
        .from('cobranza_gasto_contacto')
        .update({ resuelto_en: ahora.toISOString(), resuelto_por: por })
        .eq('tenant_id', tenantId)
        .is('resuelto_en', null)
        .in('id', ids.slice(i, i + 200))
        .select('id'), 'cobranza_gasto.marcar_resueltos');
      if (errMarca) logger.warn('cobranza_gasto.resueltos_sin_marcar', { tenantId, por, err: errMarca.message });
      else marcados += (hechos ?? []).length;
    }
  }
  return marcados;
}

// ── La corrida ──────────────────────────────────────────────────────────────

export interface ResultadoCobranzaGasto {
  /** Gastos con comprobante faltante (en tier o no). */
  pendientes: number;
  /** Mensajes (uno por chofer) que salieron. */
  mensajes: number;
  /** Gastos cubiertos por esos mensajes. */
  gastosAvisados: number;
  /** Gastos en tier cuyo chofer no tiene teléfono. */
  sinTelefono: number;
  /** Choferes cuyo aviso esperó a mañana por el tope diario. */
  pospuestosPorTope: number;
  /** Avisos marcados como resueltos en este barrido. */
  resueltos: number;
  /** Teléfonos a los que ya se les escribió HOY (los usa la cobranza por viaje para no duplicar el día). */
  telefonosHoy: string[];
  /** Viajes con al menos un gasto pendiente: la cobranza por viaje los deja a esta. */
  viajesConGastoPendiente: string[];
  fallos: string[];
  cortadosPorReloj: number;
  rechazosReintentables: number;
  rechazoMasivo?: boolean;
  omitido?: string;
}

export function resultadoGastoVacio(omitido?: string): ResultadoCobranzaGasto {
  return {
    pendientes: 0, mensajes: 0, gastosAvisados: 0, sinTelefono: 0, pospuestosPorTope: 0, resueltos: 0,
    telefonosHoy: [], viajesConGastoPendiente: [], fallos: [], cortadosPorReloj: 0, rechazosReintentables: 0,
    ...(omitido ? { omitido } : {}),
  };
}

/** Cuántos mensajes (lotes) recibió HOY cada chofer, contando solo lo que SALIÓ. */
async function mensajesDeHoy(tenantId: string, operadorIds: string[], ahora: Date): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  if (operadorIds.length === 0) return mapa;
  const filas = await traerPorIds<{ operador_id: string; lote_id: string }>(
    operadorIds,
    (tanda) => supabaseAdmin()
      .from('cobranza_gasto_contacto')
      .select('operador_id, lote_id')
      .eq('tenant_id', tenantId)
      .eq('enviado', true)
      .gte('created_at', inicioDelDiaMx(ahora).toISOString())
      .in('operador_id', tanda)
      .order('id'),
    'cobranza_gasto.mensajes_hoy',
  );
  const lotes = new Map<string, Set<string>>();
  for (const f of filas) {
    const s = lotes.get(f.operador_id) ?? new Set<string>();
    s.add(f.lote_id);
    lotes.set(f.operador_id, s);
  }
  for (const [op, s] of lotes) mapa.set(op, s.size);
  return mapa;
}

export interface OpcionesCobranzaGasto {
  venceEn?: number;
  /** El aviso de texto lleva la firma y las instrucciones de la estrategia por viaje. */
  firma?: string;
  instrucciones?: string;
}

/**
 * Corre la cobranza POR GASTO de UNA flota. La ventana horaria y el agente pausado los decide el llamador
 * (`ejecutarCobranza`), igual que para la cobranza por viaje; aquí se decide si la flota la encendió.
 */
export async function ejecutarCobranzaGastos(
  tenantId: string,
  ahora: Date = new Date(),
  opts: OpcionesCobranzaGasto = {},
): Promise<ResultadoCobranzaGasto> {
  const config = await leerConfigGasto(tenantId);
  if (!config.porGasto) return resultadoGastoVacio('la cobranza por gasto está apagada');

  const admin = supabaseAdmin();
  const r = resultadoGastoVacio();

  // Retención por flota (anclada por tenant): lo de más de 180 días se va. Best-effort.
  await admin.from('cobranza_gasto_contacto')
    .delete()
    .eq('tenant_id', tenantId)
    .lt('created_at', new Date(ahora.getTime() - DIAS_RETENCION_GASTO * 86_400_000).toISOString())
    .then(({ error }) => { if (error) logger.warn('cobranza_gasto.retencion_fallo', { tenantId, err: error.message }); });

  // RESCATE DE CLAIMS HUÉRFANOS: un crash entre el claim y el envío deja filas enviado=false SIN detalle.
  // Una fila así de más de 1 hora es un crash probado: se borra y el tier queda libre.
  await admin.from('cobranza_gasto_contacto')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('enviado', false)
    .is('detalle', null)
    .lt('created_at', new Date(ahora.getTime() - 3_600_000).toISOString())
    .then(({ error }) => { if (error) logger.warn('cobranza_gasto.rescate_claims_fallo', { tenantId, err: error.message }); });

  // Primero la MEDICIÓN: lo que se resolvió desde la corrida anterior.
  r.resueltos = await marcarResueltos(tenantId, ahora, config);

  const gastos = await gastosParaCobrar(tenantId);
  const candidatos = gastos.filter((g) => motivoFaltante(g, config) !== null).map((g) => g.id);
  const previos = await tiersPrevios(tenantId, candidatos);
  const plan = planearCobroGasto(gastos, config, previos, ahora);

  r.pendientes = plan.pendientes.length;
  r.sinTelefono = plan.sinTelefono.reduce((n, g) => n + g.items.length, 0);
  r.viajesConGastoPendiente = [...new Set(plan.pendientes.map((i) => i.viajeId))];

  // Los sin teléfono TAMBIÉN quedan en bitácora (enviado=false, con el motivo): el tablero los enseña y
  // el tier no se reintenta cada hora contra el mismo hueco.
  for (const grupo of plan.sinTelefono) {
    const lote = randomUUID();
    const { error } = await admin.from('cobranza_gasto_contacto').insert(grupo.items.map((i) => ({
      tenant_id: tenantId, gasto_id: i.gastoId, operador_id: grupo.operador.operadorId, tier: i.tier as number,
      motivo: i.motivo, lote_id: lote, enviado: false, detalle: 'el operador no tiene teléfono capturado',
      created_at: ahora.toISOString(),
    })));
    if (error && error.code !== '23505') logger.warn('cobranza_gasto.sin_telefono_sin_anotar', { tenantId, err: error.message });
  }

  const enviadosHoy = await mensajesDeHoy(tenantId, plan.paraContactar.map((g) => g.operador.operadorId), ahora);
  const telefonosHoy = new Set<string>();
  // Quien ya recibió hoy (en una corrida anterior) cuenta para que la cobranza por viaje no le duplique el día.
  for (const g of plan.paraContactar) {
    if ((enviadosHoy.get(g.operador.operadorId) ?? 0) > 0 && g.operador.telefono) telefonosHoy.add(g.operador.telefono);
  }
  let rechazosSeguidos = 0;

  for (const grupo of plan.paraContactar) {
    if (opts.venceEn !== undefined && Date.now() >= opts.venceEn) {
      r.cortadosPorReloj = plan.paraContactar.length - (r.mensajes + r.fallos.length + r.pospuestosPorTope);
      logger.warn('cobranza_gasto.corte_por_reloj', { tenantId, pendientes: r.cortadosPorReloj });
      break;
    }
    // EL TOPE DIARIO: lo que no cabe espera a mañana y NO consume tier (no se reclama nada).
    if (cupoRestante(enviadosHoy.get(grupo.operador.operadorId) ?? 0, config.maxMensajesDia) === 0) {
      r.pospuestosPorTope++;
      continue;
    }

    // RECLAMAR EL LOTE ANTES DE MANDAR: un solo INSERT atómico. Si cualquier (gasto, tier) ya fue
    // reclamado por otra corrida, el lote entero choca con el unique y NO se manda nada (se reintenta
    // a la hora siguiente con la cola ya actualizada): nunca un mensaje duplicado, nunca uno a medias.
    const lote = randomUUID();
    const { error: errClaim } = await admin.from('cobranza_gasto_contacto').insert(
      grupo.items.map((i) => ({
        tenant_id: tenantId, gasto_id: i.gastoId, operador_id: grupo.operador.operadorId, tier: i.tier as number,
        motivo: i.motivo, lote_id: lote, enviado: false,
        // El reloj LÓGICO de la corrida (el mismo `ahora` con el que se decidió el tier y el tope de hoy), no
        // el `now()` de la base: así la corrida es reproducible y los conteos «de hoy» no dependen de la
        // latencia entre la decisión y el insert.
        created_at: ahora.toISOString(),
      })),
    );
    if (errClaim) {
      if (errClaim.code !== '23505') r.fallos.push(`reclamar ${grupo.operador.nombre ?? grupo.operador.operadorId}: ${errClaim.message}`);
      continue;
    }

    let enviado = false;
    let via: 'texto' | 'plantilla' | null = null;
    let detalle: string | null = null;
    let reintentable = false;
    try {
      const envio = await enviarConFallback(grupo.operador.telefono as string, {
        texto: armarMensajeGastos(grupo.items, opts.firma ?? '', opts.instrucciones ?? ''),
        plantilla: { nombre: PLANTILLA.cobranzaGastos, parametros: parametrosPlantillaGastos(grupo.operador.nombre, grupo.items) },
        contexto: 'cobranza.gastos',
        tenantId,
      });
      if (envio.ok) {
        enviado = true;
        via = envio.via === 'plantilla' ? 'plantilla' : 'texto';
        if (via === 'plantilla') detalle = 'plantilla cobranza_gastos_v1 (ventana de 24 h cerrada)';
      } else {
        detalle = envio.fueraDeVentana
          ? `WhatsApp rechazó el texto libre y la plantilla también falló: ${envio.mensaje}`
          : `WhatsApp rechazó el mensaje: ${envio.mensaje}`;
        reintentable = envio.reintentable;
      }
    } catch (e) {
      detalle = e instanceof Error ? e.message : 'error inesperado al enviar';
    }

    if (reintentable) {
      // «Vuelve más tarde» (429, bloqueo): el claim se BORRA y el tier queda libre para la corrida siguiente.
      await admin.from('cobranza_gasto_contacto')
        .delete().eq('tenant_id', tenantId).eq('lote_id', lote)
        .then(({ error }) => { if (error) logger.error('cobranza_gasto.claim_no_liberado', { tenantId, lote, err: error.message }); });
      r.rechazosReintentables++;
      rechazosSeguidos++;
      r.fallos.push(`${grupo.operador.nombre ?? grupo.operador.operadorId}: ${detalle} (se reintenta en la siguiente corrida)`);
      if (rechazosSeguidos >= TOPE_RECHAZOS_META_GASTO) {
        r.rechazoMasivo = true;
        r.cortadosPorReloj = plan.paraContactar.length - (r.mensajes + r.fallos.length + r.pospuestosPorTope);
        logger.error('cobranza_gasto.rechazo_masivo', { tenantId, rechazosSeguidos });
        await alertarOperador('wa.rechazo_masivo', {
          error: `WhatsApp rechazó ${rechazosSeguidos} cobranzas por gasto seguidas por un motivo reintentable (rate limit o bloqueo). La corrida se detuvo; los tiers quedaron sin consumir.`,
          codigo: 'wa_rechazo_masivo',
        });
        break;
      }
      continue;
    }

    rechazosSeguidos = 0;
    if (enviado) {
      r.mensajes++;
      r.gastosAvisados += grupo.items.length;
      if (grupo.operador.telefono) telefonosHoy.add(grupo.operador.telefono);
    } else {
      r.fallos.push(`${grupo.operador.nombre ?? grupo.operador.operadorId}: ${detalle}`);
    }
    // El resultado se anota AUNQUE el envío falle (mismo criterio que la cobranza por viaje: la alternativa
    // es reintentar para siempre el mismo número roto).
    await admin.from('cobranza_gasto_contacto')
      .update({ enviado, via, detalle })
      .eq('tenant_id', tenantId).eq('lote_id', lote)
      .then(({ error }) => { if (error) logger.warn('cobranza_gasto.resultado_sin_anotar', { tenantId, lote, err: error.message }); });
  }

  r.telefonosHoy = [...telefonosHoy];
  logger.info('cobranza_gasto.corrida', { tenantId, ...r, fallos: r.fallos.length, telefonosHoy: r.telefonosHoy.length, viajesConGastoPendiente: r.viajesConGastoPendiente.length });
  return r;
}

// ── El tablero ──────────────────────────────────────────────────────────────

export interface ContactoGastoBitacora {
  gastoId: string;
  folioViaje: string | null;
  operadorNombre: string | null;
  concepto: string | null;
  monto: number | null;
  tier: number;
  motivo: MotivoComprobante;
  enviado: boolean;
  via: 'texto' | 'plantilla' | null;
  detalle: string | null;
  cuando: string;
  resueltoEn: string | null;
  resueltoPor: 'chofer' | 'cierre' | null;
}

export interface TableroGastos {
  efectividad: Efectividad;
  bitacora: ContactoGastoBitacora[];
}

/** Bitácora y efectividad de los últimos `DIAS_EFECTIVIDAD` días. Lanza si no puede leer: un tablero ciego
 *  no se pinta como «sin avisos». */
export async function tableroGastos(tenantId: string, ahora: Date = new Date(), limite = 15): Promise<TableroGastos> {
  const desde = new Date(ahora.getTime() - DIAS_EFECTIVIDAD * 86_400_000).toISOString();
  const filas = await traerTodo<Record<string, unknown>>(
    (d, h) => supabaseAdmin()
      .from('cobranza_gasto_contacto')
      .select('id, gasto_id, tier, motivo, enviado, via, detalle, created_at, resuelto_en, resuelto_por, operador_id', conteo(d))
      .eq('tenant_id', tenantId)
      .gte('created_at', desde)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(d, h),
    'cobranza_gasto.tablero',
  );

  const medibles: ContactoMedible[] = filas.map((f) => ({
    tier: Number(f.tier), motivo: f.motivo as MotivoComprobante, enviado: Boolean(f.enviado),
    creadoEn: f.created_at as string, resueltoEn: (f.resuelto_en as string) ?? null,
    resueltoPor: (f.resuelto_por as 'chofer' | 'cierre') ?? null,
  }));

  const recientes = filas.slice(0, limite);
  const ids = [...new Set(recientes.map((f) => f.gasto_id as string))];
  const detalleGasto = new Map<string, { concepto: string; monto: number; folio: string | null; operador: string | null }>();
  if (ids.length > 0) {
    type Rel = { folio?: string | null; operador?: { nombre?: string | null } | Array<{ nombre?: string | null }> | null };
    const gastos = await traerPorIds<{ id: string; concepto: string; monto: number | string; viaje: unknown }>(
      ids,
      (tanda) => supabaseAdmin()
        .from('gasto')
        .select('id, concepto, monto, viaje:viaje_id(folio, operador:operador_id(nombre))')
        .eq('tenant_id', tenantId)
        .in('id', tanda)
        .order('id'),
      'cobranza_gasto.tablero_detalle',
    );
    for (const g of gastos) {
      const rv = g.viaje as Rel | Rel[] | null;
      const viaje = Array.isArray(rv) ? rv[0] : rv;
      const ro = viaje?.operador;
      const op = Array.isArray(ro) ? ro[0] : ro;
      detalleGasto.set(g.id, { concepto: g.concepto, monto: Number(g.monto), folio: viaje?.folio ?? null, operador: op?.nombre ?? null });
    }
  }

  return {
    efectividad: calcularEfectividad(medibles),
    bitacora: recientes.map((f) => {
      const d = detalleGasto.get(f.gasto_id as string);
      return {
        gastoId: f.gasto_id as string, folioViaje: d?.folio ?? null, operadorNombre: d?.operador ?? null,
        concepto: d?.concepto ?? null, monto: d?.monto ?? null, tier: Number(f.tier), motivo: f.motivo as MotivoComprobante,
        enviado: Boolean(f.enviado), via: (f.via as 'texto' | 'plantilla') ?? null, detalle: (f.detalle as string) ?? null,
        cuando: f.created_at as string, resueltoEn: (f.resuelto_en as string) ?? null,
        resueltoPor: (f.resuelto_por as 'chofer' | 'cierre') ?? null,
      };
    }),
  };
}

export type { ItemCobro };
