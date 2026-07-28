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

export async function verificarMigracionesCriticas(): Promise<void> {
  verificarEntornoCritico();
  try {
    const admin = supabaseAdmin();
    const { error } = await admin.rpc('try_lock_viaje', { p_viaje: ZERO, p_ttl_ms: 1 });
    if (error) {
      logger.error('startup.migraciones', {
        msg: 'FALTA la migración 0005 (try_lock_viaje / unique(viaje_id)): la protección de doble liquidación NO está activa. Corre `supabase db push`.',
        code: error.code,
        err: error.message,
      });
      return;
    }
    await admin.rpc('unlock_viaje', { p_viaje: ZERO }); // liberar el lock de prueba

    // AUDIT_V3 orquestación CRÍTICO: migración 0011 (barrera de intake). Si falta,
    // intakeDelta devuelve 0 en silencio → esperarIntake retorna true de inmediato
    // y el "listo" cuadra sobre gastos PARCIALES (fotos aún en OCR). Probe explícito.
    const { error: e11 } = await admin.rpc('intake_delta', { p_viaje: ZERO, p_delta: 0 });
    if (e11) {
      logger.error('startup.migraciones', {
        msg: 'FALTA la migración 0011 (intake_delta / viaje.intake_pendientes): la barrera de ráfaga NO está activa y un "listo" puede cuadrar sobre gastos parciales. Corre `supabase db push`.',
        code: e11.code,
        err: e11.message,
      });
      return;
    }
    // Migración 0016 (bandeja de códigos pendientes). Si falta, el acercamiento
    // que llega ANTES que su ticket no se puede guardar: el gasto se queda con
    // el folio que leyó la visión —el que baila— y nadie se entera, porque el
    // camino sigue "funcionando". Probe de lectura: no escribe nada.
    const { error: e16 } = await admin.from('codigo_pendiente').select('id').limit(1);
    if (e16) {
      logger.error('startup.migraciones', {
        msg: 'FALTA la migración 0016 (codigo_pendiente): el acercamiento que llegue antes que su ticket pierde el folio exacto y el gasto se queda con el folio del OCR. Corre `supabase db push`.',
        code: e16.code,
        err: e16.message,
      });
      return;
    }
    // Las dos migraciones nuevas del camino del dinero. La 0017 hace el merge de
    // ocr_extra con claim (sin ella se pisan los folios de portal entre fotos de
    // una misma ráfaga); la 0019 impide que el mismo CFDI se liquide dos veces.
    const { error: e17 } = await admin.rpc('enriquecer_gasto_codigo', {
      p_gasto: ZERO, p_tenant: ZERO, p_extra: {}, p_cfdi_uuid: null,
    });
    if (e17) {
      logger.error('startup.migraciones', {
        msg: 'FALTA la migración 0017 (enriquecer_gasto_codigo): el folio del portal que trae un acercamiento no se pega y se pierde. Corre `supabase db push`.',
        code: e17.code, err: e17.message,
      });
      return;
    }
    logger.info('startup.migraciones', { ok: true });
  } catch (e) {
    // Sin env/DB (p. ej. durante el build) → no romper, solo avisar.
    logger.warn('startup.migraciones_skip', { err: e instanceof Error ? e.message : String(e) });
  }
}
