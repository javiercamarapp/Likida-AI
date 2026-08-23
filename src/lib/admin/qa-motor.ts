// ═══════════════════════════════════════════════════════════════════════════
// PANEL DE QA — el motor del CARRIL RÁPIDO (Fase A). SOLO servidor.
//
// Corre EN PROCESO, dentro de la misma app de Next.js, el mismo camino que el
// agente Operador de la Fase 1 del ejército (scripts/qa-agentes/) ejercita
// bajo vitest: sembrar un tenant ZZZ QA, mandar fotos y textos por
// `processInbound` — LA función de producción, importada tal cual, jamás una
// copia — y dejar que los oráculos (funciones puras) juzguen la base.
//
// La diferencia con el ejército es UNA: aquí no hay vi.mock (no existe en el
// runtime de Next), así que la foto entra por `InboundMessage.mediaDataUrlQA`
// (el gancho aditivo documentado en processor.ts y en 00-PANEL-DE-QA.md §3).
// Los envíos salientes NO se interceptan: van por el cliente Meta real y
// rebotan en la allowed-list del número de PRUEBA (#131030 — el teléfono
// sintético 5215559… es de un rango imposible y no está en la lista), o sea
// que ningún humano recibe nada; la evidencia de qué contestó el sistema se
// lee de `wa_conversacion.estado.turns`, que el pipeline persiste solo.
//
// Guard reutilizado tal cual del ejército: `exigirTenantZZZ` /
// `exigirPrefijoQA` (scripts/qa-agentes/config.qa.ts) ANTES de cualquier
// borrado en lote. La captura de bitácora se reimplementa mínima aquí (no se
// puede importar `capturarBitacora` de agentes/operador.qa.ts: ese módulo
// importa vitest en su primera línea).
// ═══════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { processInbound } from '@/lib/likida/processor';
import { logger } from '@/lib/logger';
import { hoyMx } from '@/lib/formato';
import { ahoraMs } from '@/lib/saludo';
import {
  exigirTenantZZZ, exigirPrefijoQA, PREFIJO_QA, TOPE_CORRIDA_USD,
} from '../../../scripts/qa-agentes/config.qa';
import { correrOraculosFaseA } from './qa-oraculos';
import { dataUrlDeFoto, guardarCorrida, leerManifiesto } from './qa-storage';
import {
  estadoFinalDe,
  type CorridaQA, type EscenarioId, type ParametrosCorrida, type PasoQA, type TurnoConversacion,
} from './qa-tipos';

// El tope DIARIO vive en qa-tipos.ts (client-safe, el botón lo enseña); el
// tope POR corrida se reusa del ejército: TOPE_CORRIDA_USD (config.qa.ts, $2).
export { TOPE_DIA_USD } from './qa-tipos';

/** Techo de TIEMPO del carril rápido: por debajo del maxDuration de la ruta
 *  (120 s — el mismo techo probado del webhook), con margen para que el
 *  aborto se ESCRIBA en vez de que Vercel mate la función a media corrida.
 *  Si el plan de Vercel permite maxDuration mayor, esto sube junto con él. */
export const TECHO_CORRIDA_MS = 110_000;

/** Margen mínimo para arrancar un mensaje más: un processInbound puede tomar
 *  hasta su propio presupuesto (~60 s), así que no se arranca con menos que
 *  esto de sobra. */
const MARGEN_MENSAJE_MS = 20_000;

// ── Identidades sintéticas (puras, con prueba) ──────────────────────────────

/** Nombre del tenant de la corrida: SIEMPRE empieza con 'ZZZ ' — es la llave
 *  del guard del ejército y del criterio de limpieza. UUID nuevo por corrida
 *  (no el fijo de carga-15k.sql) para permitir corridas simultáneas. */
export function nombreTenantQa(corridaId: string): string {
  return `ZZZ QA ${corridaId.slice(0, 8)}`;
}

/** Teléfono del rango imposible 5215559xxxxxx (criterio de carga-15k.sql),
 *  derivado del id de la corrida en el sub-rango 1xxxxx–8xxxxx para no chocar
 *  ni con ZZZ CARGA (000001..000200) ni con el ejército (9xxxxx). Determinista
 *  por corrida; corridas distintas casi nunca chocan y, si chocaran,
 *  `resolveOperador` lo diría (OperadorAmbiguo) en vez de cruzar tenants. */
export function telefonoQa(corridaId: string): string {
  const hex = corridaId.replace(/-/g, '').slice(0, 10);
  const n = 100_000 + (parseInt(hex, 16) % 800_000);
  return `5215559${String(n).padStart(6, '0')}`;
}

/** Prefijo de los waMessageId de UNA corrida — bajo el PREFIJO_QA del
 *  ejército, con el id corto para poder limpiar SOLO los claims propios. */
export function prefijoMensajes(corridaId: string): string {
  return `${PREFIJO_QA}P${corridaId.slice(0, 8)}-`;
}

/** La corrida recién nacida, lista para guardarse antes de ejecutar. */
export function crearCorrida(escenario: EscenarioId, params: ParametrosCorrida): CorridaQA {
  const id = randomUUID();
  const ahora = new Date().toISOString();
  return {
    id, escenario, carril: 'rapido', parametros: params,
    estado: 'pendiente', motivo: null,
    tenantId: null, tenantNombre: nombreTenantQa(id),
    creadaEn: ahora, inicio: null, fin: null, latidoEn: ahora,
    pasos: [], costoUsdTotal: 0, veredicto: null, turnos: [], pdfs: [], limpieza: null,
  };
}

// ── Captura de bitácora (mínima; ver cabecera por qué no se importa) ────────

interface EventoCapturado { nivel: 'info' | 'warn' | 'error'; msg: string; meta?: Record<string, unknown> }

function capturarBitacora(): { eventos: EventoCapturado[]; restaurar: () => void } {
  const eventos: EventoCapturado[] = [];
  const originales = { info: logger.info, warn: logger.warn, error: logger.error };
  (['info', 'warn', 'error'] as const).forEach((nivel) => {
    logger[nivel] = (m: string, meta?: Record<string, unknown>) => {
      eventos.push({ nivel, msg: m, meta });
      return originales[nivel](m, meta);
    };
  });
  return {
    eventos,
    restaurar: () => {
      logger.info = originales.info;
      logger.warn = originales.warn;
      logger.error = originales.error;
    },
  };
}

// ── Siembra (mismo patrón que el orquestador del ejército) ──────────────────

async function sembrarTenant(db: SupabaseClient, corrida: CorridaQA): Promise<{ tenantId: string; operadorId: string; viajeId: string; telefono: string }> {
  const tenantId = randomUUID();
  const p = corrida.parametros;
  const ins = await db.from('tenant').insert({
    id: tenantId,
    nombre: corrida.tenantNombre,
    plan: 'demo',
    // Con RFC real de la corrida la validación de receptor CORRE (con el
    // genérico del SAT, engine.ts la apaga — ver config.ts:204).
    rfc: p.rfcEmpresa,
    // Sin dígitos a propósito: el aviso de privacidad los imprime y el
    // oráculo #5 revisa todo mensaje saliente (criterio del ejército).
    razon_social: 'ZZZ QA SA DE CV',
    domicilio_fiscal: 'Carretera Sintetica QA SN, Monterrey NL',
    config: { politica: p.politica },
  });
  if (ins.error) throw new Error(`no se pudo sembrar el tenant QA: ${ins.error.message}`);

  const telefono = telefonoQa(corrida.id);
  const op = await db.from('operador').insert({
    tenant_id: tenantId, nombre: 'ZZZ QA Chofer 1', telefono, activo: true,
  }).select('id').single();
  if (op.error) throw new Error(`no se pudo sembrar el operador QA: ${op.error.message}`);

  // LA CONSTANCIA DEL AVISO DE PRIVACIDAD, sembrada — el escenario modela un
  // operador YA onboardeado. Hallazgo REAL de la primera corrida del panel
  // (16-ago-2026): sin esto, `ponerAvisoADisposicion` intenta mandar el aviso
  // por el cliente Meta real, el envío rebota en la allowed-list del número de
  // prueba (#131030) y el gate de LFPDPPP 16-II BLOQUEA todo tratamiento —
  // fail-closed correcto de producción, pero deja al carril rápido sin poder
  // ejercitar nada. El ejército no lo ve porque su mock hace "exitoso" el
  // envío. La versión se calcula con las MISMAS funciones de producción
  // (getDatosResponsable → avisoSimplificado → versionAviso), no con una copia.
  const { getDatosResponsable } = await import('@/lib/likida/repo');
  const { avisoSimplificado, versionAviso } = await import('@/lib/likida/privacidad');
  const datos = await getDatosResponsable(tenantId);
  const texto = datos ? avisoSimplificado(datos) : null;
  if (!texto) throw new Error('no se pudo armar el aviso de privacidad del tenant QA (¿razón social/domicilio sembrados?)');
  const constancia = await db.from('operador')
    .update({ aviso_privacidad_en: new Date().toISOString(), aviso_privacidad_version: versionAviso(texto) })
    .eq('id', op.data.id).eq('tenant_id', tenantId);
  if (constancia.error) throw new Error(`no se pudo sembrar la constancia del aviso: ${constancia.error.message}`);

  const uni = await db.from('unidad').insert({
    tenant_id: tenantId, numero_economico: `ZZZ-QA-${corrida.id.slice(0, 8)}`, activo: true,
  });
  if (uni.error) throw new Error(`no se pudo sembrar la unidad QA: ${uni.error.message}`);

  // El AYER de México: `viaje.fecha_inicio` es `date` y la ventana del cuadre
  // (`ventanaDelViaje`) la juzga en días de México. Sembrar el día UTC hacía
  // que, corriendo QA de noche, el viaje sintético naciera fechado HOY.
  const ayer = hoyMx(new Date(ahoraMs() - 24 * 3600 * 1000));
  const viaje = await db.from('viaje').insert({
    tenant_id: tenantId,
    operador_id: op.data.id,
    folio: `ZZZQA-${corrida.id.slice(0, 8)}`,
    origen: p.ruta.origen,
    destino: p.ruta.destino,
    anticipo: p.anticipo,
    fecha_inicio: ayer, // hoy−1: bajo el primer tier de cobranza, y el viaje vive minutos
    estatus: 'abierto',
    // aceptado_en puesto para que el flujo de confirmación no secuestre los
    // mensajes del escenario; el constraint exige avisado_en junto (mismo
    // razonamiento, con su porqué completo, en el orquestador del ejército).
    aceptado_en: new Date().toISOString(),
    avisado_en: new Date().toISOString(),
  }).select('id').single();
  if (viaje.error) throw new Error(`no se pudo sembrar el viaje QA: ${viaje.error.message}`);

  return { tenantId, operadorId: op.data.id as string, viajeId: viaje.data.id as string, telefono };
}

// ── Ledger: el costo REAL, leído de llm_costo (jamás un segundo medidor) ────

async function costoNuevoUsd(db: SupabaseClient, tenantId: string, vistos: Set<string>): Promise<number> {
  const { data, error } = await db.from('llm_costo')
    .select('id, fase, costo_usd').eq('tenant_id', tenantId);
  if (error) throw new Error(`no se pudo leer llm_costo: ${error.message}`);
  let suma = 0;
  for (const fila of data ?? []) {
    const id = String(fila.id);
    if (vistos.has(id)) continue;
    vistos.add(id);
    // 'whatsapp' fuera del ledger: en QA los envíos rebotan en la allowed-list
    // del número de prueba — no son gasto real (mismo criterio que el ejército).
    if (fila.fase === 'whatsapp') continue;
    suma += Number(fila.costo_usd);
  }
  return Math.round(suma * 1_000_000) / 1_000_000;
}

// ── Lecturas de evidencia ───────────────────────────────────────────────────

async function turnosDelTenant(db: SupabaseClient, tenantId: string): Promise<TurnoConversacion[]> {
  const { data, error } = await db.from('wa_conversacion').select('estado').eq('tenant_id', tenantId);
  if (error) return [];
  const turnos: TurnoConversacion[] = [];
  for (const fila of data ?? []) {
    const estado = fila.estado as { turns?: Array<{ role?: string; content?: string }> } | null;
    for (const t of estado?.turns ?? []) {
      if ((t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string') {
        turnos.push({ rol: t.role, texto: t.content });
      }
    }
  }
  return turnos;
}

async function filasDelTenant(db: SupabaseClient, tenantId: string): Promise<Record<string, unknown[]>> {
  const dump: Record<string, unknown[]> = {};
  for (const tabla of ['viaje', 'gasto', 'liquidacion', 'comprobante_huerfano']) {
    const { data, error } = await db.from(tabla).select('*').eq('tenant_id', tenantId);
    dump[tabla] = error ? [{ error: error.message }] : (data ?? []);
  }
  return dump;
}

async function hayLiquidacion(db: SupabaseClient, tenantId: string, viajeId: string): Promise<boolean> {
  const { data } = await db.from('liquidacion').select('id')
    .eq('tenant_id', tenantId).eq('viaje_id', viajeId).maybeSingle();
  return Boolean(data);
}

async function pdfsDelTenant(db: SupabaseClient, tenantId: string): Promise<string[]> {
  try {
    const rutas: string[] = [];
    const raiz = await db.storage.from('liquidaciones').list(tenantId, { limit: 100 });
    for (const entrada of raiz.data ?? []) {
      if (entrada.id) { rutas.push(`${tenantId}/${entrada.name}`); continue; }
      const sub = await db.storage.from('liquidaciones').list(`${tenantId}/${entrada.name}`, { limit: 100 });
      for (const f of sub.data ?? []) rutas.push(`${tenantId}/${entrada.name}/${f.name}`);
    }
    return rutas;
  } catch {
    return [];
  }
}

// ── Limpieza (siempre detrás de los guards del ejército) ────────────────────

async function limpiarTenant(db: SupabaseClient, corrida: CorridaQA): Promise<string> {
  const tenantId = corrida.tenantId;
  if (!tenantId) return 'sin tenant que limpiar (la siembra no llegó a crear uno)';
  try {
    await exigirTenantZZZ(db, tenantId);
    const notas: string[] = [];
    for (const bucket of ['comprobantes', 'liquidaciones']) {
      try {
        const raiz = await db.storage.from(bucket).list(tenantId, { limit: 100 });
        if (raiz.error || !raiz.data?.length) continue;
        const rutas: string[] = [];
        for (const entrada of raiz.data) {
          if (entrada.id) { rutas.push(`${tenantId}/${entrada.name}`); continue; }
          const sub = await db.storage.from(bucket).list(`${tenantId}/${entrada.name}`, { limit: 200 });
          for (const f of sub.data ?? []) rutas.push(`${tenantId}/${entrada.name}/${f.name}`);
        }
        if (rutas.length) {
          const rm = await db.storage.from(bucket).remove(rutas);
          notas.push(rm.error
            ? `storage/${bucket}: no se pudieron borrar ${rutas.length} objetos (${rm.error.message})`
            : `storage/${bucket}: ${rutas.length} objetos borrados`);
        }
      } catch (e) {
        notas.push(`storage/${bucket}: limpieza best-effort falló (${e instanceof Error ? e.message : e})`);
      }
    }
    const del = await db.from('tenant').delete().eq('id', tenantId);
    if (del.error) return `❌ el DELETE del tenant falló: ${del.error.message}`;

    const patron = `${prefijoMensajes(corrida.id)}%`;
    exigirPrefijoQA(patron);
    await db.from('wa_mensaje_procesado').delete().like('wa_message_id', patron);

    const sobras: string[] = [];
    for (const tabla of ['operador', 'unidad', 'viaje', 'gasto', 'liquidacion', 'comprobante_huerfano', 'wa_conversacion', 'llm_costo']) {
      const { count, error } = await db.from(tabla).select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId);
      if (error) sobras.push(`${tabla}: no se pudo contar (${error.message})`);
      else if ((count ?? 0) > 0) sobras.push(`${tabla}: ${count} filas`);
    }
    const detalle = notas.length ? ` (${notas.join('; ')})` : '';
    return sobras.length === 0
      ? `✅ tenant "${corrida.tenantNombre}" borrado (cascada) y verificado en 0 filas${detalle}`
      : `⚠️ el tenant se borró pero quedaron sobras: ${sobras.join('; ')}${detalle}`;
  } catch (e) {
    return `❌ limpieza abortada por el guard o un error: ${e instanceof Error ? e.message : e}`;
  }
}

// ── LA CORRIDA ──────────────────────────────────────────────────────────────

/** Ejecuta el carril rápido de punta a punta, escribiendo cada paso en
 *  corridas/<id>/corrida.json (el ledger en vivo que el panel pollea).
 *  Nunca lanza: todo fallo termina ESCRITO en la corrida. */
export async function ejecutarCorridaRapida(corrida: CorridaQA): Promise<CorridaQA> {
  const db = supabaseAdmin();
  const t0 = Date.now();
  const costosVistos = new Set<string>();
  corrida.estado = 'corriendo';
  corrida.inicio = new Date().toISOString();

  let n = 0;
  const paso = async (nombre: string): Promise<PasoQA> => {
    const p: PasoQA = { n: ++n, nombre, estado: 'corriendo', costoUsd: 0, inicio: new Date().toISOString() };
    corrida.pasos.push(p);
    await guardarCorrida(db, corrida).catch(() => { /* el ledger es best-effort en vivo; el cierre sí exige escribirse */ });
    return p;
  };
  const cerrarPaso = async (p: PasoQA, estado: PasoQA['estado'], detalle?: string) => {
    p.estado = estado;
    p.fin = new Date().toISOString();
    if (detalle) p.detalle = detalle;
    if (corrida.tenantId) {
      try {
        p.costoUsd = await costoNuevoUsd(db, corrida.tenantId, costosVistos);
        corrida.costoUsdTotal = Math.round((corrida.costoUsdTotal + p.costoUsd) * 1_000_000) / 1_000_000;
      } catch (e) {
        p.detalle = `${p.detalle ? `${p.detalle} · ` : ''}costo no leído: ${e instanceof Error ? e.message : e}`;
      }
    }
    await guardarCorrida(db, corrida).catch(() => {});
  };
  const abortar = async (motivo: string) => {
    corrida.estado = 'abortada';
    corrida.motivo = motivo;
    corrida.fin = new Date().toISOString();
    // Un aborto por tope o por tiempo es EVIDENCIA: el tenant se queda para
    // inspección, no se borra (encargo Fase A, regla del tope).
    corrida.limpieza = `tenant "${corrida.tenantNombre}" CONSERVADO para inspección (aborto): límpialo a mano cuando termines de mirar`;
    await guardarCorrida(db, corrida);
  };
  const excedeTope = () => corrida.costoUsdTotal > TOPE_CORRIDA_USD;
  const sinTiempo = () => Date.now() - t0 > TECHO_CORRIDA_MS - MARGEN_MENSAJE_MS;

  const bit = capturarBitacora();
  let viajeId = '';
  let telefono = '';
  try {
    // 1 — siembra
    const p1 = await paso(`sembrar tenant "${corrida.tenantNombre}" (operador, unidad, política, viaje)`);
    try {
      const s = await sembrarTenant(db, corrida);
      corrida.tenantId = s.tenantId;
      viajeId = s.viajeId;
      telefono = s.telefono;
      await cerrarPaso(p1, 'ok');
    } catch (e) {
      await cerrarPaso(p1, 'bad', e instanceof Error ? e.message : String(e));
      corrida.estado = 'fallo';
      corrida.motivo = `la siembra falló: ${e instanceof Error ? e.message : e}`;
      corrida.fin = new Date().toISOString();
      corrida.limpieza = await limpiarTenant(db, corrida);
      await guardarCorrida(db, corrida);
      return corrida;
    }

    // 2..N — las fotos, por el camino REAL (processInbound + mediaDataUrlQA)
    const manifiesto = await leerManifiesto(db);
    if (!manifiesto.ok) {
      await abortar(`no se pudo leer el banco de fotos: ${manifiesto.error}`);
      return corrida;
    }
    const porId = new Map(manifiesto.datos.map((f) => [f.id, f]));
    const prefijo = prefijoMensajes(corrida.id);
    let f = 0;
    for (const fotoId of corrida.parametros.fotoIds) {
      f += 1;
      const foto = porId.get(fotoId);
      const p = await paso(`foto ${f}/${corrida.parametros.fotoIds.length} — ${foto?.etiqueta ?? fotoId} → processInbound`);
      if (!foto) {
        await cerrarPaso(p, 'bad', `la foto ${fotoId} no está en el banco`);
        await abortar(`la foto ${fotoId} no está en el banco — corrida detenida`);
        return corrida;
      }
      if (sinTiempo()) {
        await cerrarPaso(p, 'bad', 'sin tiempo para otro mensaje');
        await abortar(`techo de tiempo del carril rápido (${TECHO_CORRIDA_MS / 1000}s) — corrida con menos fotos, o carril completo (Fase C)`);
        return corrida;
      }
      try {
        const dataUrl = await dataUrlDeFoto(db, foto);
        await processInbound({
          from: telefono,
          type: 'image',
          mediaId: `${prefijo}media-${f}`,   // jamás llega a Meta: mediaDataUrlQA lo sustituye
          mediaDataUrlQA: dataUrl,
          waMessageId: `${prefijo}f${f}`,
        });
        await cerrarPaso(p, 'ok');
      } catch (e) {
        await cerrarPaso(p, 'bad', e instanceof Error ? e.message : String(e));
      }
      if (excedeTope()) {
        await abortar(`TOPE DE CORRIDA excedido: $${corrida.costoUsdTotal.toFixed(4)} > $${TOPE_CORRIDA_USD} (config.qa.ts del ejército)`);
        return corrida;
      }
    }

    // N+1 — el cierre ("listo"), con UNA insistencia si el agente pidió confirmación
    const TEXTO_CIERRE = 'listo, ya subí todo';
    const pC = await paso(`cierre — el chofer escribe «${TEXTO_CIERRE}»`);
    if (sinTiempo()) {
      await cerrarPaso(pC, 'bad', 'sin tiempo para el cierre');
      await abortar(`techo de tiempo del carril rápido (${TECHO_CORRIDA_MS / 1000}s) antes del cierre`);
      return corrida;
    }
    try {
      await processInbound({ from: telefono, type: 'text', text: TEXTO_CIERRE, waMessageId: `${prefijo}t1` });
      if (!(await hayLiquidacion(db, corrida.tenantId!, viajeId)) && !sinTiempo() && !excedeTope()) {
        pC.detalle = 'el primer «listo» no cerró; se insistió una vez (mismo criterio que el ejército)';
        await processInbound({ from: telefono, type: 'text', text: TEXTO_CIERRE, waMessageId: `${prefijo}t2` });
      }
      await cerrarPaso(pC, 'ok', pC.detalle);
    } catch (e) {
      await cerrarPaso(pC, 'bad', e instanceof Error ? e.message : String(e));
    }
    if (excedeTope()) {
      await abortar(`TOPE DE CORRIDA excedido: $${corrida.costoUsdTotal.toFixed(4)} > $${TOPE_CORRIDA_USD}`);
      return corrida;
    }

    // N+2 — evidencia + oráculos (funciones puras del ejército, importadas)
    const pO = await paso('oráculos — #1 cuadre_balancea · #5 cifras_con_fuente · #8 bitacora_registro');
    corrida.turnos = await turnosDelTenant(db, corrida.tenantId!);
    corrida.pdfs = await pdfsDelTenant(db, corrida.tenantId!);
    const filas = await filasDelTenant(db, corrida.tenantId!);
    const textosBot = corrida.turnos.filter((t) => t.rol === 'assistant').map((t) => t.texto);
    try {
      corrida.veredicto = await correrOraculosFaseA({
        tenantId: corrida.tenantId!,
        viajeId,
        textosBot,
        fuentesRespaldo: [filas, corrida.parametros, [TEXTO_CIERRE]],
        eventosBitacora: bit.eventos,
        eventosEsperados: ['agent.run'],
      });
      const final = estadoFinalDe(corrida.veredicto);
      await cerrarPaso(pO, final === 'ok' ? 'ok' : final === 'parcial' ? 'warn' : 'bad');
      corrida.estado = final;
      if (final === 'parcial') corrida.motivo = 'al menos un oráculo quedó NO VERIFICADO — no se afirma que pasó';
      if (final === 'fallo') corrida.motivo = 'al menos un invariante FALLÓ — abre el veredicto';
    } catch (e) {
      await cerrarPaso(pO, 'bad', e instanceof Error ? e.message : String(e));
      corrida.estado = 'fallo';
      corrida.motivo = `los oráculos no pudieron correr: ${e instanceof Error ? e.message : e}`;
    }

    // N+3 — limpieza (salvo retención)
    const pL = await paso('limpieza del tenant sintético');
    if (corrida.parametros.retencion === 'conservar') {
      corrida.limpieza = `tenant "${corrida.tenantNombre}" (${corrida.tenantId}) CONSERVADO a pedido (retencion=conservar)`;
      await cerrarPaso(pL, 'warn', 'conservado a pedido');
    } else {
      corrida.limpieza = await limpiarTenant(db, corrida);
      await cerrarPaso(pL, corrida.limpieza.startsWith('✅') ? 'ok' : 'warn', corrida.limpieza);
    }

    corrida.fin = new Date().toISOString();
    await guardarCorrida(db, corrida);
    return corrida;
  } catch (e) {
    // Red final: nada de este motor debe tumbar la función sin dejar rastro.
    corrida.estado = 'fallo';
    corrida.motivo = `error no anticipado: ${e instanceof Error ? e.message : String(e)}`;
    corrida.fin = new Date().toISOString();
    if (!corrida.limpieza) {
      corrida.limpieza = `tenant "${corrida.tenantNombre}" posiblemente sembrado — revisar y limpiar a mano`;
    }
    await guardarCorrida(db, corrida).catch(() => {});
    return corrida;
  } finally {
    bit.restaurar();
  }
}
