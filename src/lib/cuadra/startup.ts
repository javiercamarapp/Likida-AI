import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

const ZERO = '00000000-0000-0000-0000-000000000000';

/**
 * Verifica que la migración 0005 (mutex try_lock_viaje + unique(viaje_id)) esté
 * aplicada. Si falta, la protección de doble liquidación NO está activa y hoy se
 * caía en SILENCIO — aquí se deja un error ruidoso. Best-effort: no tumba el
 * arranque (demo-safe; sin env/DB en build no rompe). 2.1.
 */
/**
 * Variables de entorno sin las cuales algo falla EN SILENCIO o, peor, parece
 * funcionar sin hacerlo.
 *
 * `DASHBOARD_SECRET` es el caso claro: sin él, el HMAC de la cookie del panel se
 * derivaba del propio passcode y una cookie capturada permitía crackearlo
 * offline. Ahora `passcode.ts` lanza en producción — este check hace que el aviso
 * salga al ARRANCAR y no la primera vez que alguien intente entrar al panel.
 */
export function verificarEntornoCritico(): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (!process.env.DASHBOARD_SECRET) {
    logger.error('startup.entorno', {
      msg: 'FALTA DASHBOARD_SECRET: el panel va a fallar al intentar entrar. Sin él, el HMAC de la cookie se deriva del propio passcode y una cookie capturada permite crackearlo offline. Ponlo en las variables de entorno del despliegue.',
    });
  }
}

/**
 * ¿El error dice "eso no existe", o dice "no pude preguntar"?
 *
 * NO es una distinción cosmética. En producción, el 28-jul-2026, este chequeo
 * gritó «FALTA la migración 0005: la protección de doble liquidación NO está
 * activa» — y las cuatro migraciones estaban aplicadas. El error real era
 * `TypeError: fetch failed`: la base nunca contestó.
 *
 * Un diagnóstico falso cuesta dos veces. Primero manda a alguien a correr
 * `supabase db push` contra un problema que no existe. Y después, cuando el
 * aviso resulta ser mentira una vez, se aprende a ignorarlo — justo el aviso que
 * avisa de que el dinero se puede liquidar dos veces.
 *
 * Cómo se distinguen: PostgREST contesta a una función inexistente con un código
 * ('PGRST202', '42883'). Hubo respuesta, y dice que no está. Un fallo de red no
 * trae código: supabase-js envuelve el `TypeError` del fetch y `code` viene
 * vacío. Sin respuesta no se afirma nada sobre el esquema.
 */
function sinRespuesta(error: { code?: string; message?: string }): boolean {
  if (error.code) return false;
  return /fetch failed|network|timeout|abort|ECONN|EAI_AGAIN|socket/i.test(error.message ?? '');
}

/** Un solo sitio donde se decide qué se dice ante un error de probe. */
function reportarProbe(error: { code?: string; message?: string }, faltaMsg: string): void {
  if (sinRespuesta(error)) {
    logger.warn('startup.migraciones_sin_verificar', {
      msg: 'NO se pudo verificar el esquema: la base no respondió. Esto NO dice que falte ninguna migración — dice que no se pudo preguntar. Revisa conectividad con Supabase.',
      err: error.message,
    });
    return;
  }
  logger.error('startup.migraciones', { msg: faltaMsg, code: error.code, err: error.message });
}

export async function verificarMigracionesCriticas(): Promise<void> {
  verificarEntornoCritico();
  try {
    const admin = supabaseAdmin();
    const { error } = await admin.rpc('try_lock_viaje', { p_viaje: ZERO, p_ttl_ms: 1 });
    if (error) {
      reportarProbe(error, 'FALTA la migración 0005 (try_lock_viaje / unique(viaje_id)): la protección de doble liquidación NO está activa. Corre `supabase db push`.');
      return;
    }
    await admin.rpc('unlock_viaje', { p_viaje: ZERO }); // liberar el lock de prueba

    // AUDIT_V3 orquestación CRÍTICO: migración 0011 (barrera de intake). Si falta,
    // intakeDelta devuelve 0 en silencio → esperarIntake retorna true de inmediato
    // y el "listo" cuadra sobre gastos PARCIALES (fotos aún en OCR). Probe explícito.
    const { error: e11 } = await admin.rpc('intake_delta', { p_viaje: ZERO, p_delta: 0 });
    if (e11) {
      reportarProbe(e11, 'FALTA la migración 0011 (intake_delta / viaje.intake_pendientes): la barrera de ráfaga NO está activa y un "listo" puede cuadrar sobre gastos parciales. Corre `supabase db push`.');
      return;
    }
    // Migración 0016 (bandeja de códigos pendientes). Si falta, el acercamiento
    // que llega ANTES que su ticket no se puede guardar: el gasto se queda con
    // el folio que leyó la visión —el que baila— y nadie se entera, porque el
    // camino sigue "funcionando". Probe de lectura: no escribe nada.
    const { error: e16 } = await admin.from('codigo_pendiente').select('id').limit(1);
    if (e16) {
      reportarProbe(e16, 'FALTA la migración 0016 (codigo_pendiente): el acercamiento que llegue antes que su ticket pierde el folio exacto y el gasto se queda con el folio del OCR. Corre `supabase db push`.');
      return;
    }
    // Las dos migraciones nuevas del camino del dinero. La 0017 hace el merge de
    // ocr_extra con claim (sin ella se pisan los folios de portal entre fotos de
    // una misma ráfaga); la 0019 impide que el mismo CFDI se liquide dos veces.
    const { error: e17 } = await admin.rpc('enriquecer_gasto_codigo', {
      p_gasto: ZERO, p_tenant: ZERO, p_extra: {}, p_cfdi_uuid: null,
    });
    if (e17) {
      reportarProbe(e17, 'FALTA la migración 0017 (enriquecer_gasto_codigo): el folio del portal que trae un acercamiento no se pega y se pierde. Corre `supabase db push`.');
      return;
    }
    // Migración 0022 (sobrecarga ambigua de guardar_liquidacion_tx). Es la única
    // que se detecta por el ERROR de una llamada, no por su ausencia: si 0013 y
    // 0021 conviven, la función existe DOS veces y Postgres responde
    // `is not unique` (SQLSTATE 42725) ante una llamada de 11 argumentos.
    //
    // Va aquí porque este chequeo ya dijo `ok: true` sobre una base que no podía
    // cerrar una sola liquidación: la 0022 se aplicó a mano en producción y
    // nunca entró al repo, así que cualquier proyecto nuevo nace con las dos.
    // Se sonda con argumentos deliberadamente inválidos —un tenant que no
    // existe— porque lo que importa es CUÁL error responde, no que funcione.
    const { error: e22 } = await admin.rpc('guardar_liquidacion_tx', {
      p_tenant: ZERO, p_viaje: ZERO, p_total_comprobado: 0, p_total_anticipo: 0,
      p_diferencia: 0, p_estatus: 'sonda', p_diferencias: [], p_ieps: 0,
      p_iva: 0, p_peaje: 0, p_pdf_url: null,
    });
    if (e22 && (e22.code === '42725' || /is not unique|no es única/i.test(e22.message ?? ''))) {
      logger.error('startup.migraciones', {
        msg: 'FALTA la migración 0022: `guardar_liquidacion_tx` existe con DOS firmas (la de 0013 y la de 0021) y toda llamada de 11 argumentos falla con "is not unique". NINGUNA liquidación puede cerrar. Corre `supabase db push`.',
        code: e22.code, err: e22.message,
      });
      return;
    }
    logger.info('startup.migraciones', { ok: true });
  } catch (e) {
    // Sin env/DB (p. ej. durante el build) → no romper, solo avisar.
    logger.warn('startup.migraciones_skip', { err: e instanceof Error ? e.message : String(e) });
  }
}
