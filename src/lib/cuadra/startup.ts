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
    // NINGÚN `return` temprano entre los sondeos. Los cuatro salían al primer
    // fallo, así que con dos migraciones ausentes solo se veía UNA por ciclo de
    // despliegue: se arreglaba, se volvía a desplegar, y aparecía la siguiente.
    // El arranque tiene que decir de una vez TODO lo que falta.
    let faltan = false;
    const { error } = await admin.rpc('try_lock_viaje', { p_viaje: ZERO, p_ttl_ms: 1 });
    if (error) {
      reportarProbe(error, 'FALTA la migración 0005 (try_lock_viaje / unique(viaje_id)): la protección de doble liquidación NO está activa. Corre `supabase db push`.');
      faltan = true;
    }
    await admin.rpc('unlock_viaje', { p_viaje: ZERO }); // liberar el lock de prueba

    // AUDIT_V3 orquestación CRÍTICO: migración 0011 (barrera de intake). Si falta,
    // intakeDelta devuelve 0 en silencio → esperarIntake retorna true de inmediato
    // y el "listo" cuadra sobre gastos PARCIALES (fotos aún en OCR). Probe explícito.
    const { error: e11 } = await admin.rpc('intake_delta', { p_viaje: ZERO, p_delta: 0 });
    if (e11) {
      reportarProbe(e11, 'FALTA la migración 0011 (intake_delta / viaje.intake_pendientes): la barrera de ráfaga NO está activa y un "listo" puede cuadrar sobre gastos parciales. Corre `supabase db push`.');
      faltan = true;
    }
    // Migración 0031: el TTL del MISMO contador. Se sonda leyendo la columna que
    // la migración agrega, y aquí sí sirve —al revés que el sondeo de la 0019,
    // que leía `cfdi_uuid`, una columna de `0001_init.sql` que responde igual con
    // índice o sin él—: `intake_pendientes_en` NACE en la 0031, así que su
    // ausencia es exactamente la señal. Lo que este sondeo no puede distinguir es
    // una base con la columna y el cuerpo viejo de la función; van en el mismo
    // archivo, que se aplica entero o no se aplica.
    //
    // Sin ella, un proceso que muere entre el `+1` y el `-1` deja el viaje con el
    // contador clavado: cada "listo" posterior espera la barrera completa y le
    // avisa al operador que su liquidación salió corta cuando estaba entera.
    const { error: e31 } = await admin.from('viaje').select('intake_pendientes_en').limit(1);
    if (e31) {
      reportarProbe(e31, 'FALTA la migración 0031 (viaje.intake_pendientes_en): el contador de la barrera no expira. Un OCR que muera sin ejecutar su `finally` deja ese viaje esperando 20s y avisando "liquidación corta" en cada cierre, para siempre. Corre `supabase db push`.');
      faltan = true;
    }
    // Migración 0016 (bandeja de códigos pendientes). Si falta, el acercamiento
    // que llega ANTES que su ticket no se puede guardar: el gasto se queda con
    // el folio que leyó la visión —el que baila— y nadie se entera, porque el
    // camino sigue "funcionando". Probe de lectura: no escribe nada.
    const { error: e16 } = await admin.from('codigo_pendiente').select('id').limit(1);
    if (e16) {
      reportarProbe(e16, 'FALTA la migración 0016 (codigo_pendiente): el acercamiento que llegue antes que su ticket pierde el folio exacto y el gasto se queda con el folio del OCR. Corre `supabase db push`.');
      faltan = true;
    }
    // Las dos migraciones nuevas del camino del dinero. La 0017 hace el merge de
    // ocr_extra con claim (sin ella se pisan los folios de portal entre fotos de
    // una misma ráfaga); la 0019 impide que el mismo CFDI se liquide dos veces.
    const { error: e17 } = await admin.rpc('enriquecer_gasto_codigo', {
      p_gasto: ZERO, p_tenant: ZERO, p_extra: {}, p_cfdi_uuid: null,
    });
    if (e17) {
      reportarProbe(e17, 'FALTA la migración 0017 (enriquecer_gasto_codigo): el folio del portal que trae un acercamiento no se pega y se pierde. Corre `supabase db push`.');
      faltan = true;
    }
    // ── ÍNDICES ÚNICOS. SE MIRA EL CATÁLOGO, QUE ES LO ÚNICO QUE LOS VE ─────
    //
    // AUDITORÍA 6, arquitectura. Aquí había un `select cfdi_uuid from gasto
    // where cfdi_uuid is not null limit 1` con un comentario afirmando que "se
    // sonda leyendo el índice". No lo leía: `cfdi_uuid` es una columna de
    // `0001_init.sql` y esa consulta responde igual de bien en una base donde la
    // 0019 nunca se aplicó. Tercera ronda seguida con el mismo hallazgo
    // —"anuncia que verifica y no verifica"—, y la última lo empeoró poniéndole
    // encima seis líneas que aseguraban lo contrario.
    //
    // Un chequeo que no puede fallar no protege nada. Sin la 0019 el MISMO CFDI
    // de diésel entra dos veces: se cuenta doble en el comprobado, su IVA se
    // acredita doble, y el operador aparece habiendo gastado lo que no gastó. El
    // motor deduplica por UUID en memoria, pero solo dentro de UNA liquidación.
    //
    // `indices_faltantes` (migración 0030) es de solo lectura y sirve para
    // cualquier índice futuro. Si ELLA falta, `reportarProbe` lo dirá como "no
    // se pudo preguntar", que es la verdad — no como "falta la 0019".
    const INDICES = {
      uq_gasto_cfdi_uuid: 'migración 0019: sin ella el mismo CFDI se liquida dos veces, con su IVA acreditado por duplicado',
      uq_operador_telefono_activo: 'migración 0024: sin ella un mismo teléfono puede resolver a dos operadores y el gasto se le carga a quien no fue',
    } as const;
    const { data: faltantes, error: eIdx } = await admin.rpc('indices_faltantes', {
      p_esperados: Object.keys(INDICES),
    });
    if (eIdx) {
      reportarProbe(eIdx, 'No se pudieron verificar los índices únicos (falta la migración 0030, `indices_faltantes`). Corre `supabase db push`.');
      faltan = true;
    } else if (Array.isArray(faltantes) && faltantes.length) {
      for (const idx of faltantes as string[]) {
        logger.error('startup.migraciones', {
          msg: `FALTA el índice \`${idx}\` (${INDICES[idx as keyof typeof INDICES] ?? 'sin descripción'}). Corre \`supabase db push\`.`,
        });
      }
      faltan = true;
    }

    // Migración 0033: la constancia del aviso de privacidad separada de su
    // reserva. Si falta, `liberarEnvioAviso` llama a una función que no existe,
    // el error se registra y no se lanza —es best-effort a propósito— así que la
    // reserva se queda puesta y el operador NUNCA recibe su aviso. Sin ella
    // tampoco se escribe una sola constancia del art. 16: `confirmar` no existe.
    const { error: e33 } = await admin.rpc('confirmar_aviso_privacidad', {
      p_operador: ZERO, p_tenant: ZERO, p_version: 'sonda',
    });
    if (e33) {
      reportarProbe(e33, 'FALTA la migración 0033 (confirmar/liberar_aviso_privacidad): NINGUNA constancia del art. 16 de la LFPDPPP se está escribiendo, y una reserva que no se puede soltar deja al operador sin recibir su aviso. Corre `supabase db push`.');
      faltan = true;
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
      faltan = true;
    }
    if (!faltan) logger.info('startup.migraciones', { ok: true });
  } catch (e) {
    // Sin env/DB (p. ej. durante el build) → no romper, solo avisar.
    logger.warn('startup.migraciones_skip', { err: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * ¿La liga del aviso de privacidad integral EXISTE de verdad?
 *
 * ── EL MECANISMO ESTABA ESCRITO Y NADIE LO LLAMABA (auditoría 6, legal) ─────
 *
 * `revisarAvisoIntegral` es una revisión de FORMA: comprueba que la URL esté
 * bien escrita y sea https. Un dominio perfectamente escrito y sin registrar la
 * pasa. `sondearAvisoIntegral` es lo único que prueba existencia, y su propio
 * comentario dice dónde va: *"en un arranque, en un preflight de despliegue o en
 * un cron, donde un fallo se puede mirar"*. Ese arranque no existía: la función
 * solo la llamaban sus pruebas.
 *
 * Mientras tanto, el tenant real de producción cita
 * `transportesinnovativos.mx`, que responde NXDOMAIN. El aviso simplificado le
 * manda al operador esa liga rota y la respuesta ARCO también — y la rama
 * degradada que se escribió para ese caso ("la empresa aún no lo publica") no se
 * activa nunca, porque la revisión de forma dice `ok`.
 *
 * LFPDPPP art. 16 fr. II: el aviso simplificado debe *"señalar el sitio donde se
 * podrá consultar el aviso de privacidad integral"*. Un sitio que no resuelve no
 * es un sitio. Y como el integral es además el canal ARCO (art. 15 fr. V), la
 * liga rota se lleva por delante el ejercicio de derechos.
 *
 * NO bloquea el arranque ni el envío del aviso: un corte de red transitorio
 * daría un falso negativo, y cambiar un incumplimiento por otro no arregla nada.
 * Deja el diagnóstico donde se puede mirar, que es lo que faltaba.
 */
export async function verificarAvisoDePrivacidad(): Promise<void> {
  const tenantId = process.env.DEMO_TENANT_ID;
  if (!tenantId) return; // `arranque.ts` ya avisa de su ausencia; no se duplica.
  try {
    const { getDatosResponsable } = await import('./repo');
    const { sondearAvisoIntegral } = await import('./privacidad');

    const datos = await getDatosResponsable(tenantId);
    if (!datos) {
      logger.error('startup.aviso_privacidad', {
        msg: 'El tenant no tiene razón social o domicilio fiscal, así que NO se puede armar el aviso de privacidad y el tratamiento de datos se detiene en el primer mensaje. Captura `razon_social` y `domicilio_fiscal` en la tabla `tenant`.',
      });
      return;
    }

    const sondeo = await sondearAvisoIntegral(datos.urlAvisoIntegral);
    if (sondeo.abre) {
      logger.info('startup.aviso_privacidad', { ok: true });
      return;
    }
    logger.error('startup.aviso_privacidad', {
      motivo: sondeo.motivo,
      msg: `La liga del aviso de privacidad integral NO abre (${sondeo.motivo}). El aviso simplificado se la manda igual al operador, y es además el único canal para ejercer derechos ARCO (LFPDPPP art. 15 fr. V y 16 fr. II). Publica el aviso integral en una URL que resuelva y actualiza \`tenant.url_aviso_privacidad\`.`,
    });
  } catch (e) {
    // Igual que los sondeos de migración: sin env/DB durante el build, no rompe.
    logger.warn('startup.aviso_privacidad_skip', { err: e instanceof Error ? e.message : String(e) });
  }
}
