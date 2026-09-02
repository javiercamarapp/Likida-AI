import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendText } from '@/lib/meta/client';
import { logger } from '@/lib/logger';
import { hoyMx } from '@/lib/formato';
import { acotada } from './presupuesto';
import { clasificarVigencia, PAPELES_UNIDAD } from './vigencias';
import { diasEntreIso } from './relojes_legales';
import { politicasDetencion } from './estadias/lector';
import { polizaVigenteDe, listarProveedoresEmergencia, type TipoProveedor } from './emergencias';

// ═══════════════════════════════════════════════════════════════════════════
// EL BRIEFING DE INICIO DE VIAJE (ficha §7.1 del plan maestro).
//
// El aviso de asignación (notificar.ts) le dice al chofer QUÉ viaje le tocó
// —folio, ruta, salida, anticipo— porque eso es lo que cabe en una plantilla
// aprobada de Meta. Este briefing le dice lo que necesita SABER para hacerlo:
// con qué cliente va y a qué sitio, qué papeles de su unidad (o su licencia)
// están vencidos o por vencer —eso es lo que un inspector le va a pedir en el
// retén—, cuántas horas libres de descarga pactó el cliente, y a qué teléfonos
// VERIFICADOS marcar si algo pasa en la carretera.
//
// ── POR QUÉ DOS MOMENTOS DE ENVÍO ─────────────────────────────────────────
//
// El briefing es texto libre multilínea: no cabe en los parámetros de una
// plantilla (Meta los rechaza con saltos de línea — ver notificar.ts) y crear
// una plantilla nueva es un trámite que solo Javier destraba. Texto libre solo
// entra dentro de la ventana de 24 h que ABRE UN MENSAJE DEL CHOFER — al
// despachar, esa ventana suele estar cerrada. Por eso:
//   1. Al despachar se INTENTA (si el chofer escribió hace poco, llega ya);
//   2. cuando el chofer CONFIRMA el viaje —su mensaje acaba de abrir la
//      ventana—, se reintenta. El sello `briefing_enviado_en` (0208)
//      garantiza que llegue una sola vez, salga por el camino que salga.
//
// ── LO QUE NO SE INVENTA ──────────────────────────────────────────────────
//
// Cada sección existe solo si su dato existe. Sin sitio del cliente, no hay
// línea de sitio; sin pacto de detención, no se afirma ninguna hora; sin
// directorio de emergencia VERIFICADO, esa sección no sale — un teléfono no
// verificado a las 3 a.m. es peor que ninguno, y los teléfonos solo salen del
// directorio (0198), jamás del modelo ni de un default. Los papeles vigentes
// no se listan («todo en regla» diría más de lo que los datos dicen): solo
// los hechos que piden acción — vencido, por vencer, o sin capturar.
// ═══════════════════════════════════════════════════════════════════════════

/** Qué pasó con el intento. `fallo` NO sella: se reintenta al confirmar. */
export type ResultadoBriefing = 'enviado' | 'ya_enviado' | 'omitido' | 'fallo';

const ROTULO_PROVEEDOR: Record<TipoProveedor, string> = {
  grua: 'Grúa',
  llantera: 'Llantera',
  mecanico: 'Mecánico',
  medico: 'Médico',
  otro: 'Apoyo',
};

export interface DatosBriefing {
  folio: string | null;
  origen: string | null;
  destino: string | null;
  /** Número económico legible, NO el uuid. */
  unidad: string | null;
  cliente: string | null;
  /** Nombre de la geocerca del cliente (0207), si la flota la dibujó. */
  sitio: string | null;
  /** Rótulos ya conjugados de papeles vencidos/por vencer (unidad y licencia). */
  papelesQuePiden: string[];
  /** true = la unidad va sin NINGÚN papel capturado — se dice, no se pinta verde. */
  unidadSinPapeles: boolean;
  /** Horas libres de descarga pactadas (cliente gana sobre flota). NULL = no pactadas. */
  horasLibres: number | null;
  /** El 800 de siniestros de la póliza vigente. */
  poliza: { aseguradora: string; telefono: string } | null;
  /** Solo proveedores del directorio con verificación confirmada. */
  proveedores: Array<{ tipo: TipoProveedor; nombre: string; telefono: string }>;
}

/**
 * El texto completo del briefing, o `null` si el viaje no es identificable.
 *
 * PURO: sin base, sin WhatsApp, sin reloj — las 30 pruebas viven sobre esta
 * función. Mismo criterio que `identificable` en notificar.ts: un briefing
 * de un viaje sin folio ni ruta no le dice al chofer de qué viaje se trata.
 */
export function armarBriefing(d: DatosBriefing): string | null {
  const folio = (d.folio ?? '').trim();
  const origen = (d.origen ?? '').trim();
  const destino = (d.destino ?? '').trim();
  if (!folio && !origen && !destino) return null;

  const lineas: string[] = [];

  const titulo = folio ? `🧭 Briefing del viaje ${folio}` : '🧭 Briefing de tu viaje';
  const ruta = origen && destino ? `${origen} → ${destino}` : origen || destino;
  lineas.push(ruta ? `${titulo} · ${ruta}` : titulo);

  if (d.unidad) lineas.push(`Unidad ${d.unidad}`);

  if (d.cliente) {
    lineas.push(d.sitio
      ? `Cliente: ${d.cliente} — entregas en «${d.sitio}»`
      : `Cliente: ${d.cliente}`);
  }

  // Los papeles: SOLO hechos que piden acción. El chofer parado en un retén
  // necesita saber qué papel le van a rebotar — no una palmada de "todo bien".
  if (d.unidadSinPapeles && d.unidad) {
    lineas.push(`⚠️ La unidad ${d.unidad} no tiene papeles capturados en el sistema. Coméntalo con tu jefe antes de salir.`);
  }
  for (const rotulo of d.papelesQuePiden) {
    lineas.push(`⚠️ ${rotulo}`);
  }

  if (d.horasLibres !== null) {
    const h = d.horasLibres === 1 ? '1 hora libre' : `${d.horasLibres} horas libres`;
    lineas.push(`⏱️ El cliente tiene ${h} de descarga pactadas. Si te detienen más, tus hitos por aquí son la evidencia — no dejes de mandarlos.`);
  }

  // Emergencia: teléfonos del directorio verificado, y nada más. El orden es
  // el del uso real: primero el 800 de la aseguradora (siniestro), luego los
  // proveedores. Likida no marca por ti — estos números son para TU mano.
  const emergencia: string[] = [];
  if (d.poliza) emergencia.push(`Siniestros ${d.poliza.aseguradora}: ${d.poliza.telefono}`);
  for (const p of d.proveedores) {
    emergencia.push(`${ROTULO_PROVEEDOR[p.tipo]} ${p.nombre}: ${p.telefono}`);
  }
  if (emergencia.length > 0) {
    lineas.push(`🚨 Si algo pasa en el camino:\n${emergencia.map((e) => `· ${e}`).join('\n')}`);
  }

  lineas.push('Cualquier cosa del viaje, mándala por aquí.');
  return lineas.join('\n\n');
}

interface ViajeParaBriefing {
  folio: string | null;
  origen: string | null;
  destino: string | null;
  operador_id: string | null;
  unidad_id: string | null;
  cliente_id: string | null;
  briefing_enviado_en: string | null;
}

/**
 * Junta los datos reales y manda el briefing UNA vez por viaje.
 *
 * FALLA CERRADO EN LA LECTURA: si cualquier pieza no se pudo leer, no se manda
 * un briefing a medias — una sección omitida por ERROR se leería igual que una
 * omitida por ausencia («no hay directorio»), y esa mentira por omisión es la
 * que la casa no se permite. El que llama ya trata el `throw` como
 * mejor-esfuerzo; el sello queda en NULL y el reintento llega al confirmar.
 */
export async function enviarBriefingInicio(tenantId: string, viajeId: string): Promise<ResultadoBriefing> {
  const admin = supabaseAdmin();

  const { data: v, error: errViaje } = await acotada(admin.from('viaje')
    .select('folio, origen, destino, operador_id, unidad_id, cliente_id, briefing_enviado_en')
    .eq('tenant_id', tenantId).eq('id', viajeId).maybeSingle(), 'briefing.viaje');
  if (errViaje) throw new Error(`briefing.viaje: ${errViaje.message}`);
  const viaje = v as ViajeParaBriefing | null;
  if (!viaje) return 'omitido';
  if (viaje.briefing_enviado_en) return 'ya_enviado';
  if (!viaje.operador_id) return 'omitido'; // sin chofer no hay a quién brifear

  const { data: op, error: errOp } = await acotada(admin.from('operador')
    .select('telefono, licencia_vence')
    .eq('tenant_id', tenantId).eq('id', viaje.operador_id).maybeSingle(), 'briefing.operador');
  if (errOp) throw new Error(`briefing.operador: ${errOp.message}`);
  const telefono = (op?.telefono as string | null) ?? null;
  if (!telefono || telefono.replace(/\D/g, '').length < 10) return 'omitido';

  const hoy = hoyMx();
  const papelesQuePiden: string[] = [];
  let unidadNombre: string | null = null;
  let unidadSinPapeles = false;

  if (viaje.unidad_id) {
    const { data: u, error: errU } = await acotada(admin.from('unidad')
      .select('numero_economico, poliza_vence, permiso_sict_vence, verificacion_vence')
      .eq('tenant_id', tenantId).eq('id', viaje.unidad_id).maybeSingle(), 'briefing.unidad');
    if (errU) throw new Error(`briefing.unidad: ${errU.message}`);
    if (u) {
      unidadNombre = (u.numero_economico as string | null) ?? null;
      const papeles: Array<[string, string | null]> = [
        [PAPELES_UNIDAD[0], (u.poliza_vence as string | null) ?? null],
        [PAPELES_UNIDAD[1], (u.permiso_sict_vence as string | null) ?? null],
        [PAPELES_UNIDAD[2], (u.verificacion_vence as string | null) ?? null],
      ];
      unidadSinPapeles = papeles.every(([, vence]) => !vence);
      for (const [nombre, vence] of papeles) {
        if (!vence) continue;
        const clasificada = clasificarVigencia(diasEntreIso(hoy, vence.slice(0, 10)), nombre);
        if (clasificada.pide) papelesQuePiden.push(clasificada.rotulo);
      }
    }
  }

  const licenciaVence = (op?.licencia_vence as string | null) ?? null;
  if (licenciaVence) {
    const lic = clasificarVigencia(diasEntreIso(hoy, licenciaVence.slice(0, 10)), 'Tu licencia');
    if (lic.pide) papelesQuePiden.push(lic.rotulo);
  }

  let clienteNombre: string | null = null;
  let sitio: string | null = null;
  let horasLibres: number | null = null;
  if (viaje.cliente_id) {
    const [{ data: c, error: errC }, pactos] = await Promise.all([
      acotada(admin.from('cliente').select('nombre, geocerca_id')
        .eq('tenant_id', tenantId).eq('id', viaje.cliente_id).maybeSingle(), 'briefing.cliente'),
      politicasDetencion(tenantId),
    ]);
    if (errC) throw new Error(`briefing.cliente: ${errC.message}`);
    clienteNombre = (c?.nombre as string | null) ?? null;
    const geocercaId = (c?.geocerca_id as string | null) ?? null;
    if (geocercaId) {
      const { data: g, error: errG } = await acotada(admin.from('geocerca').select('nombre')
        .eq('tenant_id', tenantId).eq('id', geocercaId).maybeSingle(), 'briefing.sitio');
      if (errG) throw new Error(`briefing.sitio: ${errG.message}`);
      sitio = (g?.nombre as string | null) ?? null;
    }
    // El pacto del cliente GANA sobre el de flota (criterio 0207). Solo las
    // horas: la tarifa es asunto del contralor, no carga del chofer.
    const pacto = pactos.porCliente.get(viaje.cliente_id) ?? pactos.flota;
    horasLibres = pacto?.horasLibres ?? null;
  }

  const [poliza, proveedores] = await Promise.all([
    polizaVigenteDe(tenantId),
    listarProveedoresEmergencia(tenantId),
  ]);

  const texto = armarBriefing({
    folio: viaje.folio,
    origen: viaje.origen,
    destino: viaje.destino,
    unidad: unidadNombre,
    cliente: clienteNombre,
    sitio,
    papelesQuePiden,
    unidadSinPapeles,
    horasLibres,
    poliza: poliza ? { aseguradora: poliza.aseguradora, telefono: poliza.telefonoSiniestros } : null,
    proveedores: proveedores
      .filter((p) => p.verificadoEn !== null)
      .map((p) => ({ tipo: p.tipo, nombre: p.nombre, telefono: p.telefono })),
  });
  if (!texto) return 'omitido';

  const wamid = await sendText(telefono, texto);
  if (!wamid) {
    // La causa típica: ventana de 24 h cerrada (el chofer no ha escrito). No
    // se sella — el reintento correcto llega cuando el chofer confirme.
    logger.info('briefing.no_entro', { tenantId, viajeId });
    return 'fallo';
  }

  // El sello, DESPUÉS del envío aceptado (lección c2-1: sellar antes convierte
  // un fallo en silencio permanente). El `is(null)` hace atómica la carrera de
  // los dos disparos: si otro camino selló entre nuestra lectura y aquí, se
  // anota — el chofer recibió dos briefings, que es ruido, no mentira.
  const { data: sellado, error: errSello } = await acotada(admin.from('viaje')
    .update({ briefing_enviado_en: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('id', viajeId)
    .is('briefing_enviado_en', null).select('id'), 'briefing.sello');
  if (errSello) {
    logger.warn('briefing.sello_no_escrito', { tenantId, viajeId, err: errSello.message });
  } else if (!Array.isArray(sellado) || sellado.length === 0) {
    logger.warn('briefing.doble_envio', { tenantId, viajeId });
  }
  logger.info('briefing.enviado', { tenantId, viajeId, wamid });
  return 'enviado';
}
