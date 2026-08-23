import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { borrarStorageMarcado } from '@/lib/likida/storage_borrado';
import { leerInterruptor } from '@/lib/likida/interruptores';
import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { alertarOperador } from '@/lib/observability/alerta';
import { registrarLatido, puertaCron } from '@/lib/admin/salud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Un `delete` acotado por fecha y un `insert … on conflict` de agregados. Los
// dos entran por índice (`idx_wa_msg_created` y `idx_costo_tenant`), así que el
// presupuesto es para el caso raro: la PRIMERA corrida, que barre de golpe todo
// lo que se acumuló desde que existe la tabla.
export const maxDuration = 120;

// ═══════════════════════════════════════════════════════════════════════════
// EL CRON DE MANTENIMIENTO DE DATOS.
//
// Hasta la 0072 no se purgaba NADA. Dos tablas crecen sin techo y ninguna tenía
// una línea que las recortara — y la que revienta primero no es la obvia:
// `llm_costo` guarda una fila por LLAMADA AL MODELO, y un mensaje de WhatsApp
// dispara varias, así que crece más rápido que `wa_mensaje_procesado`, que
// guarda una por mensaje.
//
// ── QUÉ HACE, Y QUÉ NO HACE A PROPÓSITO ──────────────────────────────────
//
// BORRA `wa_mensaje_procesado` de más de 30 días. Es una tabla de idempotencia
// y nada más: no tiene `tenant_id` (CLAUDE.md), no se puede atribuir a una
// flota y no responde ninguna pregunta de negocio. 30 días es más de un orden
// de magnitud por encima de la ventana de reintentos de Meta.
//
// `llm_costo` se CONSOLIDA a mensual (0072) y, desde la 0155 (ESC-10), el
// detalle de más de 13 meses se borra: el mes ya está cerrado en
// `llm_costo_mensual`, que es la granularidad que el panel lee. La respuesta
// lleva `llmCostoPurgado` con la cifra real.
//
// EN TANDAS Y CON REPETICIÓN (0155, ESC-16): cada purga borra de 50k en 50k
// con un vencimiento de 60 s compartido dentro de la RPC, y devuelve
// `parcial: true` si no alcanzó. Este cron repite la llamada mientras sea
// parcial y le queden más de 60 s de reloj; lo que no cupo lo levanta la
// corrida de mañana. Antes era UN delete sin tandas bajo maxDuration=120: la
// primera corrida grande moría a la mitad con el lock puesto.
//
// ── POR QUÉ FALLA CERRADO SIN SECRETO ────────────────────────────────────
//
// Mismo criterio que `escalar` y `facturar`: esta ruta BORRA FILAS. Sin
// `CRON_SECRET` devuelve 500 y no 200, porque un 200 dejaría el cron verde en
// el panel de Vercel para siempre y nadie se enteraría de que la purga lleva
// meses sin correr — que es justo el modo de falla que esta ruta existe para
// cerrar. Y sin el secreto, cualquiera que conociera la URL podría disparar
// borrados a voluntad.
// ═══════════════════════════════════════════════════════════════════════════

/** Días que sobrevive una fila de idempotencia. El piso lo impone la 0072. */
const DIAS_WA = 30;
/** Cada llamada a la RPC se corta sola a los 60 s; solo se repite si queda
 *  margen para otra entera. */
const PLAZO_VUELTA_MS = 60_000;
/** Techo duro de vueltas por corrida, por si `parcial` nunca baja. */
const MAX_VUELTAS = 3;

export async function GET(req: Request) {
  // La puerta (RES-7): sin secreto 500 + alerta; 401 con log y código
  // estable — antes ni el 401 ni el secreto ausente dejaban huella y el cron
  // podía llevar semanas muerto con el panel en verde.
  const puerta = await puertaCron('purgar', req, 'La purga no corre sin él.');
  if (puerta) return puerta;

  // ── EL KILL SWITCH (0110): solo 'global' — la purga no es un agente ──────
  //
  // Esta ruta BORRA FILAS: en un incidente donde Javier apaga todo, lo último
  // que quiere es un cron borrando datos mientras investiga. 200 y no error:
  // apagado a propósito no es fallo, y el `saltado` del cuerpo distingue esta
  // corrida de una sana. Fail-closed: interruptor ilegible = no se borra sin
  // permiso legible. AUDITORÍA 18, ALTO (A17): ilegible NO es "apagado" —
  // es un fallo y contesta 500 con `codigo`, para que el cron no salga verde
  // sobre una base que no se pudo leer (el grito y el correo ya salieron de
  // `leerInterruptor`).
  const global = await leerInterruptor('global');
  if (global === 'ilegible') {
    return NextResponse.json({
      corrio: false,
      error: 'No se pudo leer el interruptor global: no se purga sin saber si está apagado.',
      codigo: 'interruptor_ilegible',
      interruptor: 'global',
    }, { status: 500 });
  }
  if (global === 'apagado') {
    logger.warn('cron.purgar.saltado', { interruptor: 'global' });
    return NextResponse.json({ corrio: false, saltado: 'interruptor global' });
  }

  try {
    const inicio = Date.now();
    let vueltas = 0;
    let data: Record<string, unknown> = {};
    let parcial = false;
    do {
      vueltas++;
      const r = await supabaseAdmin().rpc('mantenimiento_de_datos', {
        p_dias_wa: DIAS_WA,
      });

      // supabase-js reporta POR VALOR: sin comprobar `error` explícitamente, una
      // base caída se leería como una purga que no encontró nada que borrar y la
      // corrida saldría verde. Ver `exigir()` en analytics.ts.
      if (r.error) {
        // El `codigo` discrimina la causa en el fingerprint de Sentry: un error
        // de PostgREST trae `code` ('42P01', 'PGRST202'…) y ese viaja tal cual —
        // una causa nueva es un issue nuevo, o sea una notificación que sí llega.
        // La alerta va directo al operador del sistema: los avisos por tenant no
        // cubren un cron global, y este no tiene tenant que emitir.
        const codigo = codigoDeError(r.error);
        logger.error('cron.purgar.falló', { error: r.error.message, codigo, vuelta: vueltas });
        await alertarOperador('cron.purgar', { error: r.error.message, codigo });
        await registrarLatido('purgar', 'fallo', { codigo, vuelta: vueltas });
        return NextResponse.json({ error: r.error.message, vueltas }, { status: 500 });
      }
      data = (r.data ?? {}) as Record<string, unknown>;
      parcial = data.parcial === true;
      if (parcial) logger.warn('cron.purgar.parcial', { vuelta: vueltas, transcurridoMs: Date.now() - inicio });
    } while (parcial && vueltas < MAX_VUELTAS && Date.now() - inicio + PLAZO_VUELTA_MS < (maxDuration - 5) * 1000);

    // ── EL BORRADO DE STORAGE (23-ago-2026) ────────────────────────────────
    // `mantenimiento_de_datos` MARCA archivos en `storage_huerfano_candidato`
    // porque Supabase prohíbe borrar `storage.objects` desde SQL — pero nadie
    // vaciaba esa cola, así que los archivos quedaban marcados para siempre.
    // Con el ejecutor ARCO (0173) eso deja de ser deuda y pasa a ser un
    // incumplimiento: una cancelación que promete borrar las fotos del titular
    // y las deja en el bucket es una promesa con evidencia escrita de haberse
    // hecho.
    //
    // Va DESPUÉS de la purga y fuera del `do/while`: la purga es la que llena
    // la cola, así que borrar antes sería borrar la cola de ayer. Y su fallo no
    // tumba la corrida —las filas ya se purgaron— pero sí sale en el cuerpo,
    // para que una cola que no baja se vea desde el panel.
    let storage: Awaited<ReturnType<typeof borrarStorageMarcado>> | null = null;
    try {
      storage = await borrarStorageMarcado();
      if (storage.fallidos > 0) {
        logger.warn('cron.purgar.storage_con_fallos', { ...storage });
      }
    } catch (e) {
      logger.error('cron.purgar.storage_excepcion', { err: e instanceof Error ? e.message : String(e) });
    }

    logger.info('cron.purgar.ok', { ...data, vueltas, storage });
    await registrarLatido('purgar', parcial ? 'parcial' : 'ok', { vueltas });
    return NextResponse.json({ corrio: true, ...data, vueltas, storage });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    // Mismo criterio que el `if (error)` de arriba, para el camino que lanza.
    const codigo = codigoDeError(e);
    logger.error('cron.purgar.falló', { error, codigo });
    await alertarOperador('cron.purgar', { error, codigo });
    await registrarLatido('purgar', 'fallo', { codigo });
    return NextResponse.json({ error }, { status: 500 });
  }
}
