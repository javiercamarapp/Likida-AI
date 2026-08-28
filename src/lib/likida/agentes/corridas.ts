// ═══════════════════════════════════════════════════════════════════════════
// LA BITÁCORA DE CORRIDAS — el historial que el cliente SÍ ve (B3, aud. 4).
//
// Hasta hoy, el único rastro de que un agente corrió era `logger.info`, que
// vive en Vercel y el cliente no puede abrir. Hace falta una ficha que enseñe
// «Periodo · Estado · Tareas 2/2 · Duración · Fecha» por corrida; esta tabla
// (0102) es esa ficha, una fila por (corrida × flota).
//
// LA REGLA QUE GOBIERNA EL ESCRITOR: registrar JAMÁS lanza. La corrida que
// está anotándose ya hizo su trabajo (escaló viajes, mandó cobranzas); tumbar
// eso porque la bitácora no pudo escribir sería el mismo error que el repo ya
// documentó con los avisos. Se pierde la anotación, se grita en el log.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '../presupuesto';

/** El dominio del CHECK de la 0102 (los seis del catálogo de notificaciones)
 *  más `ventas` (0105): el asignador de prospectos, que corre para LIKIDA y
 *  no para una flota — sus corridas van con `tenant_id` null y solo las ve
 *  el superadmin (la policy `tenant_lee` no alcanza filas sin tenant). */
export type AgenteConCorridas = 'liquidacion' | 'facturas' | 'cobranza' | 'conductores' | 'peajes' | 'proveedores' | 'ventas' | 'redactor' | 'carta_porte'
  // Los 4 financieros del back office (0215) — corren para LIKIDA (tenant
  // null, como `ventas`/`redactor`): sus cifras son del negocio, no de una
  // flota. En base la FK contra agente_definicion (0116) ya los admite.
  | 'analista_metricas' | 'control_costos' | 'tesoreria' | 'cierre_mensual'
  // Dirección (0216): mismo contrato — tenant null; este tipo es el espejo
  // de los que ESCRIBEN corridas.
  | 'kpi_whatsapp' | 'desempeno_startup' | 'orquestador' | 'orquestador_semanal'
  // La máquina de prospección (0217) — también de LIKIDA (tenant null).
  | 'enriquecedor' | 'sdr' | 'enviador'
  // El back office restante (0219): auditan, documentan, vigilan los relojes
  // legales de la EMPRESA y registran talento. Todas sus corridas son de
  // Likida (tenant null), igual que las de los financieros.
  | 'vigilante_calidad' | 'documentacion' | 'legal_compliance' | 'talento'
  // Éxito del cliente (0218). Sus corridas van con `tenant_id` NULL como las
  // de arriba: cada pasada barre TODAS las flotas de una vez (el parte de
  // onboarding lista a las atoradas, el de retención a las que se enfrían),
  // así que la corrida no es de ninguna flota en particular. Las PIEZAS que
  // produce sí llevan tenant cuando son de una flota concreta — esa es la
  // trazabilidad que la bandeja enseña.
  | 'onboarding_cliente' | 'exito_cliente' | 'retencion'
  | 'cobranza_saas' | 'soporte' | 'atencion_faq'
  // Crecimiento (0230): los diez que fabrican material de marca. Mismo
  // contrato de tenant que los de arriba — corren para LIKIDA (tenant NULL):
  // un borrador de artículo, un guion o un encargo de video no son de ninguna
  // flota. La única de las diez que gasta modelo es `contenido_fiscal`; las
  // otras nueve anotan costo 0 MEDIDO, que no es lo mismo que NULL.
  | 'contenido_fiscal' | 'lead_magnet' | 'seo_distribucion'
  | 'guiones' | 'noticias_mercado' | 'promos_diarias'
  | 'visuales' | 'video_demo' | 'video_marketing' | 'alianzas'
  // Ingeniería (0234): los ocho que cuidan la máquina por dentro. Mismo
  // contrato de tenant que los de arriba — corren para LIKIDA (tenant NULL):
  // el estado del esquema, el SHA desplegado y la conducta de las corridas no
  // son de ninguna flota. Los ocho son DETERMINISTAS y no llaman a ningún
  // modelo, así que anotan costo 0 MEDIDO — que no es lo mismo que NULL.
  | 'migraciones' | 'seguridad' | 'rendimiento' | 'pruebas'
  | 'auditor_codigo' | 'releases' | 'producto' | 'datos_instrumentacion';
export type EstadoCorrida = 'ok' | 'parcial' | 'fallo';
/** `correo` (0108): el agente de Proveedores no corre por reloj — corre
 *  cuando llega un correo al buzón. Registrarlo como 'cron' pintaría
 *  «Programado» en la ficha sobre algo que disparó un correo.
 *  `whatsapp` (0115): el cierre de una liquidación lo dispara el OPERADOR
 *  confirmando por chat — ni reloj, ni botón del panel, ni correo. */
export type DisparoCorrida = 'cron' | 'manual' | 'correo' | 'whatsapp';

export interface CorridaNueva {
  inicio: Date;
  fin: Date;
  estado: EstadoCorrida;
  disparo: DisparoCorrida;
  /** El «2/2» de la ficha. Ambos o ninguno: un numerador sin denominador no
   *  dice nada, y la ficha pinta «—» cuando la corrida no se mide en tareas. */
  tareasHechas?: number;
  tareasTotal?: number;
  /** Conteos y folios para desplegar. SIN datos personales, SIN stacks. */
  resumen?: Record<string, unknown>;
  /** El motivo del fallo YA redactado para una persona. */
  error?: string;
  /** Gasto de modelo de ESTA corrida, USD (0123) — la medición que alimenta
   *  el techo diario del runner. Omitido = sin gasto medido (NULL en base). */
  costoUsd?: number | null;
}

export async function registrarCorrida(
  /** `null` SOLO para agentes de negocio (hoy `ventas`): la corrida no es de
   *  ninguna flota. Para los seis agentes de flota sigue siendo obligatorio —
   *  el tipo lo permite, el llamador responde. */
  tenantId: string | null,
  agente: AgenteConCorridas,
  c: CorridaNueva,
): Promise<void> {
  try {
    const { error } = await supabaseAdmin().from('agente_corrida').insert({
      tenant_id: tenantId,
      agente,
      inicio: c.inicio.toISOString(),
      fin: c.fin.toISOString(),
      estado: c.estado,
      disparo: c.disparo,
      tareas_hechas: c.tareasHechas ?? null,
      tareas_total: c.tareasTotal ?? null,
      resumen: c.resumen ?? null,
      error: c.error ?? null,
      costo_usd: c.costoUsd ?? null,
    });
    if (error) logger.error('corridas.no_registrada', { tenant: tenantId, agente, err: error.message });
  } catch (e) {
    logger.error('corridas.no_registrada', { tenant: tenantId, agente, err: e instanceof Error ? e.message : String(e) });
  }
}

export interface CorridaRegistrada {
  id: string;
  inicio: string;
  fin: string | null;
  estado: EstadoCorrida;
  disparo: DisparoCorrida;
  tareasHechas: number | null;
  tareasTotal: number | null;
  resumen: Record<string, unknown> | null;
  error: string | null;
  /** Milisegundos entre inicio y fin. `null` sin fin — corrida sin cerrar. */
  duracionMs: number | null;
}

/**
 * Las últimas corridas de un agente para su ficha. LANZA ante un error de
 * lectura: una ficha que pinta "sin corridas" sobre una base caída afirmaría
 * exactamente lo que este historial existe para desmentir.
 */
export async function ultimasCorridas(
  tenantId: string,
  agente: AgenteConCorridas,
  limite = 8,
): Promise<CorridaRegistrada[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('agente_corrida')
    .select('id, inicio, fin, estado, disparo, tareas_hechas, tareas_total, resumen, error')
    .eq('tenant_id', tenantId)
    .eq('agente', agente)
    .order('inicio', { ascending: false })
    .limit(limite), 'ultimasCorridas');
  if (error) throw new Error(`ultimasCorridas: ${error.message}`);
  return (data ?? []).map(desdeFilaCorrida);
}

function desdeFilaCorrida(f: unknown): CorridaRegistrada {
  const r = f as Record<string, unknown>;
  const inicio = String(r.inicio);
  const fin = r.fin === null || r.fin === undefined ? null : String(r.fin);
  const ms = fin === null ? null : new Date(fin).getTime() - new Date(inicio).getTime();
  return {
    id: String(r.id),
    inicio,
    fin,
    estado: String(r.estado) as EstadoCorrida,
    disparo: String(r.disparo) as DisparoCorrida,
    tareasHechas: r.tareas_hechas === null || r.tareas_hechas === undefined ? null : Number(r.tareas_hechas),
    tareasTotal: r.tareas_total === null || r.tareas_total === undefined ? null : Number(r.tareas_total),
    resumen: (r.resumen as Record<string, unknown> | null) ?? null,
    error: r.error === null || r.error === undefined ? null : String(r.error),
    duracionMs: ms !== null && Number.isFinite(ms) && ms >= 0 ? ms : null,
  };
}

/**
 * Las últimas corridas de un agente de NEGOCIO (tenant null — hoy `ventas`,
 * 0105). Función aparte y no un `tenantId: null` en `ultimasCorridas` porque
 * el filtro cambia de operador (`.is` en vez de `.eq`) y un `.eq('tenant_id',
 * null)` NO matchea filas NULL en Postgres: compilaría y devolvería siempre
 * vacío — el fallo silencioso exacto que este historial existe para evitar.
 * Misma regla que su hermana: un error de lectura LANZA.
 */
export async function ultimasCorridasNegocio(
  agente: AgenteConCorridas,
  limite = 5,
): Promise<CorridaRegistrada[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('agente_corrida')
    .select('id, inicio, fin, estado, disparo, tareas_hechas, tareas_total, resumen, error')
    .is('tenant_id', null)
    .eq('agente', agente)
    .order('inicio', { ascending: false })
    .limit(limite), 'ultimasCorridasNegocio');
  if (error) throw new Error(`ultimasCorridasNegocio: ${error.message}`);
  return (data ?? []).map(desdeFilaCorrida);
}

/** «3 s», «2 min 05 s» — la duración como la lee una persona. */
export function duracionLegible(ms: number | null): string | null {
  if (ms === null) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  const resto = s % 60;
  return `${min} min ${String(resto).padStart(2, '0')} s`;
}
