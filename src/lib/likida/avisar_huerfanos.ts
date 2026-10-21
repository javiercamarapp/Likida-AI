import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { traerTodo, conteo } from './pg';
import { avisar } from './agentes/notificaciones';
import { avisoHuerfanos } from '@/lib/correo/avisos';

// ═══════════════════════════════════════════════════════════════════════════
// EL PRIMER EMISOR DE `avisoHuerfanos` (auditoría del 19-oct-2026).
//
// `avisoHuerfanos` (lib/correo/avisos.ts) se escribió y se probó el 1-ago-2026
// y hasta hoy nadie lo llamaba: `grep -rn "avisoHuerfanos(" src/` solo
// encontraba su definición y su prueba. El dato ya se MIDE —
// `contarHuerfanosPendientes` alimenta el badge de Inicio y la bandeja de
// `/dashboard/huerfanos`— pero el canal de correo nunca se disparaba. Es el
// MISMO bug que `cola_atorada`/`escalado` tuvieron en los otros agentes hasta
// que se les puso un emisor de verdad (ver `CON_EMISOR` en
// `agentes/notificaciones.ts`): el catálogo ya declaraba
// `liquidacion:cola_atorada` sin que nada lo disparara.
//
// POR QUÉ ES `liquidacion:cola_atorada` Y NO UN EVENTO NUEVO: un comprobante
// huérfano es exactamente la semántica de `cola_atorada` —el agente ya hizo su
// parte (el OCR), y lo que queda depende de que una PERSONA lo adjunte o lo
// descarte—, y es la cola de la liquidación (el comprobante espera a una
// liquidación), no la de facturas ni la de conductores.
//
// POR QUÉ SE AVISA POR FLOTA Y NO POR COMPROBANTE: un correo por cada foto que
// llega sin viaje sería el aviso que más rápido enseña a ignorar el canal. El
// anti-ruido (marcas de insistencia, piso de una hora, cierre que re-arma el
// filo) vive entero en `avisar()`; aquí solo se MIDE por flota y se entrega.
//
// POR QUÉ SE RECORRE TODO `comprobante_huerfano` Y NO SOLO LAS FLOTAS CON
// ALGO PENDIENTE: una flota que tenía huérfanos la corrida pasada y hoy ya
// los resolvió TODOS tiene que mandar `hayProblema: false` para cerrar su
// incidente — si no, el filo nunca se re-arma y el día que vuelva a tener un
// huérfano, el correo se compara contra la marca vieja y no sale (el mismo
// bug que AG-A5 corrigió para `cola_atorada`/`escalado`). Por eso el universo
// de flotas a evaluar es la UNIÓN de "tiene pendientes ahora" y "tenía un
// incidente abierto la corrida pasada" — no "todas las flotas que existen",
// que escribiría en la base de flotas que nunca han tenido un huérfano.
// ═══════════════════════════════════════════════════════════════════════════

export interface ResultadoAvisoHuerfanos {
  /** Flotas con al menos un comprobante huérfano pendiente AHORA. */
  conPendientes: number;
  /** A cuántas de verdad les salió el correo (al resto: anti-ruido, config
   *  apagada, sin canal, sin destinatario… — el porqué vive en el log). */
  avisados: number;
  /** Errores al evaluar una flota concreta. Nunca tumba la corrida. */
  fallos: number;
  /** Flotas que NO se evaluaron porque `venceEn` ya había vencido
   *  (AUDITORÍA 28, hallazgos #2/#3 del Orquestador): era el ÚNICO de los
   *  cuatro barridos horarios de `cron/escalar` que no revisaba el reloj
   *  compartido dentro de su propio bucle antes de cada correo — `opts.venceEn`
   *  solo cortaba la LECTURA (`traerTodo`), nunca el envío de abajo. */
  cortadasPorReloj: number;
}

export async function avisarHuerfanosPendientes(
  ahora: Date = new Date(),
  opts: { venceEn?: number } = {},
): Promise<ResultadoAvisoHuerfanos> {
  // 1. Todos los comprobantes huérfanos pendientes, de CUALQUIER flota. El
  // índice parcial de la 0040 (`where resuelto_en is null`) hace esto barato
  // aunque la consulta no filtre por tenant primero.
  const pendientes = await traerTodo<{ tenant_id: string; creado_en: string }>(
    (d, h) => supabaseAdmin()
      .from('comprobante_huerfano')
      .select('tenant_id, creado_en', conteo(d))
      .is('resuelto_en', null)
      .order('id')
      .range(d, h),
    'avisarHuerfanosPendientes.pendientes',
    opts,
  );

  const porFlota = new Map<string, { cuantos: number; masViejoMs: number }>();
  for (const p of pendientes) {
    const creadoMs = Date.parse(p.creado_en);
    const previo = porFlota.get(p.tenant_id);
    if (previo) {
      previo.cuantos += 1;
      if (creadoMs < previo.masViejoMs) previo.masViejoMs = creadoMs;
    } else {
      porFlota.set(p.tenant_id, { cuantos: 1, masViejoMs: creadoMs });
    }
  }

  // 2. Las flotas con un incidente de `cola_atorada` TODAVÍA abierto según la
  // última corrida — por si ÉSTA las dejó en cero (ver el porqué arriba). Un
  // error aquí no puede tumbar el aviso de las flotas que SÍ tienen huérfanos
  // ahora mismo: se grita y se sigue solo con `porFlota`.
  const { data: abiertos, error } = await supabaseAdmin()
    .from('agente_notificacion_estado')
    .select('tenant_id')
    .eq('agente', 'liquidacion').eq('evento', 'cola_atorada')
    .gt('magnitud', 0);
  if (error) {
    logger.error('huerfanos.abiertos_ilegible', { err: error.message });
  }

  const tenants = new Set<string>(porFlota.keys());
  for (const f of abiertos ?? []) tenants.add(f.tenant_id as string);

  let avisados = 0;
  let fallos = 0;
  let cortadasPorReloj = 0;
  const listaTenants = [...tenants];
  for (let i = 0; i < listaTenants.length; i++) {
    // AUDITORÍA 28 (hallazgos #2/#3): el MISMO `venceEn` que ya cortaba la
    // LECTURA de arriba (vía `opts` en `traerTodo`) también tiene que cortar
    // este bucle, que es el que manda correo de verdad — igual que
    // `vigilarReglas` (`reglas/vigilante.ts`): corte limpio ANTES del
    // próximo envío, nunca a medio envío.
    if (opts.venceEn && Date.now() >= opts.venceEn) {
      cortadasPorReloj = listaTenants.length - i;
      logger.warn('huerfanos.corte_por_reloj', { pendientes: cortadasPorReloj });
      break;
    }
    const tenantId = listaTenants[i];
    const c = porFlota.get(tenantId);
    const cuantos = c?.cuantos ?? 0;
    const diasDelMasViejo = c ? Math.max(0, Math.floor((ahora.getTime() - c.masViejoMs) / 86_400_000)) : null;
    try {
      const r = await avisar(
        tenantId, 'liquidacion', 'cola_atorada',
        { hayProblema: cuantos > 0, magnitud: cuantos },
        (d) => avisoHuerfanos({ flota: d.flota, cuantos, diasDelMasViejo }),
        ahora,
      );
      if (r.avisado) avisados += 1;
    } catch (e) {
      fallos += 1;
      logger.error('huerfanos.aviso_roto', { tenantId, err: e instanceof Error ? e.message : String(e) });
    }
  }

  return { conPendientes: porFlota.size, avisados, fallos, cortadasPorReloj };
}
