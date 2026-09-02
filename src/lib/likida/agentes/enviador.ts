// ═══════════════════════════════════════════════════════════════════════════
// EL ENVIADOR DE CAMPAÑA — la puerta de salida AUTOMÁTICA (0217).
//
// La orden del 27-ago-2026, literal: "agentes de venta expertos que envían
// correos automáticamente todos los días a la base de datos... y después
// procede a mandar correo a todos los correos que consigue de esa empresa".
// Este módulo es esa orden con los candados puestos:
//
//   · SOLO piezas de campaña (`correo_frio` / `correo_seguimiento`) — nada
//     más se auto-resuelve; el resto de la cola sigue siendo humano.
//   · VENTANA DE REVISIÓN (LIKIDA_ENVIADOR_VENTANA_MIN): las piezas esperan N
//     minutos en la bandeja antes de auto-aprobarse, para que un humano pueda
//     vetar. Desde AGB-1 (auditoría 24, 1-sep-2026): default 24 h y piso
//     duro de 1 h — NUNCA 0 ("inmediato" fue justo lo que dejó salir, en 47 ms
//     de aprobado-a-enviado, el correo del 28-ago a una constructora ajena al
//     giro). Ver `ventanaRevisionMin()`.
//   · AUTO-APROBACIÓN (LIKIDA_ENVIADOR_AUTOAPROBAR, AGB-1): segundo candado,
//     independiente de la ventana. Por default ('no') el enviador NUNCA
//     aprueba solo — solo manda lo que un humano ya aprobó a mano en
//     /admin/aprobaciones. Encenderla ('si') es la decisión explícita de que
//     la máquina puede aprobar sola; ver `autoaprobarActivo()`.
//   · La resolución automática (cuando SÍ está activa) es LEGAL en el
//     esquema: el CHECK 0120 exige `resuelto_por_email`, no el uuid — queda
//     'enviador@automatico', visible en la bandeja como cualquier resolución.
//   · El ENVÍO no estrena puerta: pasa por `enviarPiezaPorCorreo` con su
//     claim anclado, su CHECK enviar-solo-aprobado, el tope diario de frío y
//     la cadencia atómica 48h (0124). Las copias son los correos hallados por
//     el investigador MENOS los suprimidos — y la lista de bajas se lee
//     FAIL-CLOSED: si no se puede leer, no sale nada.
//   · Kill switch propio (`agente:enviador`) y techo de gasto en el runner.
//   · APAGADO POR DEFAULT (envío autónomo acotado, 29-ago-2026): ver
//     `enviadorEncendido()` abajo — el "sin fila = encendido" del kill switch
//     de `agente:enviador` sigue intacto (es el candado de INCIDENTE, y
//     sembrarle una fila desde una migración le rompería el supuesto de
//     tabla vacía a media docena de bloques de verificaciones.sql que ya
//     prueban ese CHECK), pero el envío AUTÓNOMO real de correo — sin
//     aprobación humana por mensaje — es un cambio de comportamiento que no
//     puede empezar solo porque una migración se aplicó y RESEND_API_KEY ya
//     estaba puesta por otra razón. `LIKIDA_ENVIADOR_ENCENDIDO` es el
//     interruptor MAESTRO, en código, sin tabla que sembrar: por default
//     (ausente o cualquier valor que no sea 'true') el enviador NO manda
//     nada, y lo dice. Javier lo prende a propósito en Vercel cuando decida
//     que el envío autónomo puede empezar; el kill switch de incidente sigue
//     funcionando exactamente igual encima de esto. Cada cambio de estado de
//     este interruptor de env queda anotado en `bitacora_auditoria`
//     (`anotarSiCambioElMaestro`, AGB-1): el env no tiene bitácora propia,
//     pero el enviador la escribe al arrancar, comparando contra el último
//     registro — así "se prendió el 28-ago" deja de ser un hecho sin rastro.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { DatoInvalido } from '../errores';
import { estaApagado } from '../interruptores';
import { correoConfigurado } from '@/lib/correo/enviar';
import { enviarPiezaPorCorreo, topeCorreoFrioDia, filtrarSuprimidos, TIPOS_CAMPANA } from './cola';
import { registrarCorrida, type DisparoCorrida } from './corridas';
import { anotarBitacora } from '../bitacora_escritura';
import { logger } from '@/lib/logger';

// La lista de bajas vive ahora en la PUERTA (cola.ts, c5-1) para que el
// camino humano también la consulte; se re-exporta para los llamadores y
// pruebas existentes.
export { filtrarSuprimidos };

/** El email con el que el enviador firma sus resoluciones automáticas — la
 *  bandeja lo enseña tal cual, para que nadie confunda un tap humano con la
 *  máquina. */
export const RESOLUTOR_AUTOMATICO = 'enviador@automatico';

/** AGB-1 (auditoría 24): la ventana "0 = inmediato" del comentario de arriba
 *  fue justo lo que dejó salir, en 47 ms de aprobado-a-enviado, el correo del
 *  28-ago-2026 a una constructora ajena al giro. Un humano no alcanza a vetar
 *  nada en 0 minutos. El default ahora es 24 h (tiempo real de veto), y el
 *  piso — incluso con `LIKIDA_ENVIADOR_VENTANA_MIN` puesto a mano en 0 o en
 *  negativo — es 1 h: la ventana de veto NUNCA es 0 en producción. */
const VENTANA_REVISION_DEFAULT_MIN = 24 * 60;
const VENTANA_REVISION_PISO_MIN = 60;

/** Minutos que una pieza espera en la bandeja antes de auto-aprobarse — la
 *  ventana en la que un humano puede editarla o rechazarla. Nunca 0: ver
 *  AGB-1 arriba. */
export function ventanaRevisionMin(): number {
  const raw = process.env.LIKIDA_ENVIADOR_VENTANA_MIN;
  if (raw === undefined || raw.trim() === '') return VENTANA_REVISION_DEFAULT_MIN;
  const v = Number(raw);
  if (!Number.isFinite(v)) return VENTANA_REVISION_DEFAULT_MIN;
  return Math.max(VENTANA_REVISION_PISO_MIN, Math.floor(v));
}

/**
 * AGB-1: el segundo candado, además de la ventana. Con esta palanca en su
 * default ('no' — ausente, vacía o cualquier valor que no sea 'si'), el
 * enviador JAMÁS auto-aprueba una pieza: solo envía las que un HUMANO ya
 * aprobó a mano en `/admin/aprobaciones` (`resuelto_por` con un actor real,
 * nunca null — la auto-aprobación de esta misma máquina deja `resuelto_por:
 * null` a propósito, ver más abajo). Encenderla es la decisión explícita de
 * que la máquina puede aprobar sola, no un efecto secundario de prender
 * `LIKIDA_ENVIADOR_ENCENDIDO`.
 */
export function autoaprobarActivo(): boolean {
  return process.env.LIKIDA_ENVIADOR_AUTOAPROBAR === 'si';
}

/** El nombre bajo el que este candado deja huella en `bitacora_auditoria`
 *  (entidad `'runner'`, ya declarada — no hace falta ampliar el catálogo de
 *  `bitacora_escritura.ts` para un interruptor que vive en env). */
const BITACORA_ENTIDAD_ID_MAESTRO = 'enviador_encendido';

/**
 * AGB-1: `LIKIDA_ENVIADOR_ENCENDIDO` vive en una variable de entorno de
 * Vercel — nadie audita cuándo cambió ni quién lo cambió. Esta función lee el
 * ÚLTIMO estado que quedó anotado y, si el estado ACTUAL es distinto, deja
 * una fila nueva. Se corre al arrancar cada corrida (encendida o apagada) para
 * que apagar el maestro también quede escrito, no solo encenderlo. Best-effort
 * y silencioso: un fallo aquí no debe impedir ni el envío ni el rechazo.
 */
async function anotarSiCambioElMaestro(encendidoAhora: boolean): Promise<void> {
  try {
    const { data, error } = await acotada(supabaseAdmin()
      .from('bitacora_auditoria')
      .select('detalle')
      .eq('entidad', 'runner')
      .eq('entidad_id', BITACORA_ENTIDAD_ID_MAESTRO)
      .order('ocurrio_en', { ascending: false })
      .order('id', { ascending: false })
      .limit(1), 'enviador.bitacora_ultimo_estado');
    if (error) {
      logger.warn('enviador.bitacora_ilegible', { err: error.message });
      return;
    }
    const fila = (data?.[0] ?? null) as { detalle?: { encendido?: boolean } } | null;
    const ultimo = fila?.detalle?.encendido;
    // Sin registro previo, el estado apagado (el default seguro) no es un
    // acto que valga la pena anotar — solo la primera vez que alguien lo
    // enciende, o cualquier cambio posterior en cualquier dirección.
    if (ultimo === undefined && !encendidoAhora) return;
    if (ultimo === encendidoAhora) return;
    await anotarBitacora({
      tenantId: null,
      actor: 'sistema',
      accion: encendidoAhora ? 'enviador.maestro_encendido' : 'enviador.maestro_apagado',
      entidad: 'runner',
      entidadId: BITACORA_ENTIDAD_ID_MAESTRO,
      detalle: { encendido: encendidoAhora },
    }, { evento: 'enviador.bitacora_no_escrita' });
  } catch (e) {
    logger.warn('enviador.bitacora_ilegible', { err: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * El interruptor MAESTRO del envío autónomo (envío autónomo acotado,
 * 29-ago-2026) — DEFAULT APAGADO. Ausente, vacío o cualquier valor que no
 * sea exactamente `'true'` cuenta como apagado: un `LIKIDA_ENVIADOR_ENCENDIDO=si`
 * mal tecleado no debe encender nada por accidente.
 *
 * Distinto del kill switch `agente:enviador` (interruptores.ts): aquél es la
 * palanca de INCIDENTE ("algo salió mal, apágalo YA"), con su propio default
 * seguro (sin fila = encendido) porque así deben arrancar los agentes que
 * solo dejan piezas en una bandeja. Este es el interruptor de LANZAMIENTO:
 * el envío de correo sin aprobación humana por mensaje es un cambio de
 * comportamiento real, y no puede empezar como efecto secundario de aplicar
 * una migración o de que RESEND_API_KEY ya estuviera puesta.
 */
export function enviadorEncendido(): boolean {
  return process.env.LIKIDA_ENVIADOR_ENCENDIDO === 'true';
}

export interface ResultadoEnviador {
  piezasEnviadas: number;
  destinatarios: number;
  saltadas: number;
  motivos: string[];
  /** Las candidatas que el RELOJ de la vuelta dejó sin turno (c7-1). 0 cuando
   *  el lote cupo entero o cuando el llamador no impuso reloj. */
  sinTurno: number;
}

interface PiezaCandidata {
  id: string;
  tipo: string;
  estado: 'pendiente' | 'aprobado';
  prospecto_id: string | null;
  prospecto: { empresa?: string; correo?: string } | null;
}

/**
 * UNA corrida del enviador (la llama el runner): auto-aprueba y envía hasta
 * `limite` piezas de campaña maduras. Cada pieza falla POR SU LADO — un
 * prospecto sin correo no detiene el lote, y el motivo queda dicho.
 */
export async function correrEnviador(
  disparo: DisparoCorrida = 'cron',
  limite = 10,
  /** EL RELOJ DE LA VUELTA (epoch ms), cuando el llamador impone uno. Ver la
   *  nota del `for`. Sin él el lote corre completo, como siempre. */
  venceEn?: number,
): Promise<ResultadoEnviador> {
  const inicio = new Date();
  const encendidoAhora = enviadorEncendido();
  // AGB-1: deja huella del interruptor de env ANTES del throw de abajo, para
  // que apagarlo también quede anotado (no solo encenderlo). Nunca bloquea.
  await anotarSiCambioElMaestro(encendidoAhora);
  // EL INTERRUPTOR MAESTRO, primero y sin más I/O que la anotación de arriba
  // (fail-fast barato): el envío autónomo arranca apagado hasta que alguien
  // lo prenda a propósito en Vercel — nunca por default de un deploy o de
  // una migración.
  if (!encendidoAhora) {
    throw new DatoInvalido('El envío autónomo de campaña arranca APAGADO por decisión explícita — enciéndelo con LIKIDA_ENVIADOR_ENCENDIDO=true cuando decidas que puede empezar.');
  }
  if (await estaApagado('agente:enviador')) {
    throw new DatoInvalido('El enviador está apagado — se enciende desde /admin/observabilidad o ⌘K.');
  }
  // Sin canal no hay envío, y la corrida LO DICE en vez de reportar 0/0 verde.
  if (!correoConfigurado()) {
    await registrarCorrida(null, 'enviador', {
      inicio, fin: new Date(), estado: 'fallo', disparo,
      error: 'El canal de correo no está configurado (RESEND_API_KEY/RESEND_EMAIL_DOMAIN).',
    });
    return { piezasEnviadas: 0, destinatarios: 0, saltadas: 0, motivos: ['canal sin configurar'], sinTurno: 0 };
  }

  // Las candidatas son DOS clases (c5-6): las pendientes maduras (la ventana
  // de revisión ya pasó) y las que ESTA máquina ya aprobó pero cuyo envío
  // rebotó en un candado (tope diario, cadencia, fallo definitivo de Resend)
  // — sin retomarlas, "la pieza sigue aprobada; sale mañana" era mentira en
  // el camino automático: ninguna corrida futura las volvía a mirar. Solo se
  // retoman las del propio enviador (resuelto_por_email) — una aprobada por
  // HUMANO sin enviar es suya y vive en el panel. Las ambiguas (c5-3) traen
  // enviado_en puesto, así que no entran aquí: jamás reenvío automático.
  // AGB-1, segundo candado: sin `LIKIDA_ENVIADOR_AUTOAPROBAR=si`, NINGÚN
  // `pendiente` entra a la consulta — el enviador solo retoma piezas que un
  // humano ya aprobó a mano (`resuelto_por` con un actor real). La máquina
  // puede seguir MANDANDO lo aprobado por un humano; lo que no puede es
  // aprobar sola sin que alguien lo haya prendido a propósito.
  const autoaprobar = autoaprobarActivo();
  const corte = new Date(Date.now() - ventanaRevisionMin() * 60_000).toISOString();
  const filtroCandidatas = autoaprobar
    ? `and(estado.eq.pendiente,creado_en.lte.${corte}),and(estado.eq.aprobado,enviado_en.is.null,resuelto_por_email.eq.${RESOLUTOR_AUTOMATICO})`
    : `and(estado.eq.aprobado,enviado_en.is.null,resuelto_por.not.is.null)`;
  // AGB-3 (auditoría 24): antes esta consulta traía las N más viejas SIN
  // filtrar por correo — medido en producción, las 10 más viejas eran
  // sistemáticamente piezas de prospectos SIN correo capturado (Nadro, Pepsi,
  // ManpowerGroup...), así que las piezas CON correo (que sí se pueden
  // enviar) nunca alcanzaban turno tras el `limit`. `!inner` + `.not(...)`
  // excluye esas piezas en la CONSULTA, no en el bucle: con ellas fuera, la
  // ventana avanza sola hacia las que sí son enviables.
  const { data, error } = await acotada(supabaseAdmin()
    .from('cola_aprobacion')
    .select('id, tipo, estado, prospecto_id, prospecto:prospecto_id!inner(empresa, correo)')
    .or(filtroCandidatas)
    .in('tipo', [...TIPOS_CAMPANA])
    .not('prospecto.correo', 'is', null)
    .order('creado_en', { ascending: true })
    .limit(Math.min(limite, topeCorreoFrioDia())), 'enviador.candidatas');
  if (error) throw new Error(`correrEnviador: ${error.message}`);
  const candidatas = (data ?? []) as unknown as PiezaCandidata[];

  let piezasEnviadas = 0, destinatarios = 0, saltadas = 0, sinTurno = 0;
  const motivos: string[] = [];
  for (let i = 0; i < candidatas.length; i++) {
    // ── EL RELOJ, ADENTRO DEL MOTOR (auditoría ciclo 7, c7-1) ───────────────
    // El enviador no gasta modelo, pero cada candidata son varios viajes de
    // red EN SERIE (los correos de la empresa, la lista de bajas, la
    // auto-aprobación y el envío por Resend) y el `for` iteraba hasta el final
    // sin mirar el reloj de la vuelta: el mismo modo de falla que mató al
    // runner el 25-ago-2026 y el 28-ago-2026 dentro del lote del Redactor.
    // Cortar aquí es especialmente barato: lo que no se envió sigue en la cola,
    // aprobado, y la propia corrida lo retoma en la pasada siguiente (c5-6).
    if (venceEn !== undefined && Date.now() >= venceEn) {
      sinTurno = candidatas.length - i;
      logger.warn('enviador.corte_por_reloj', { sinTurno, piezasEnviadas, saltadas });
      break;
    }
    const pieza = candidatas[i];
    try {
      const principal = pieza.prospecto?.correo?.trim().toLowerCase() ?? '';
      if (!principal) throw new DatoInvalido('el prospecto no tiene correo principal capturado');

      // Las copias: TODOS los correos hallados de la empresa (0217), menos
      // el principal — y todo el conjunto pasa por la lista de bajas.
      let copias: string[] = [];
      if (pieza.prospecto_id) {
        const { data: extra, error: errExtra } = await supabaseAdmin()
          .from('prospecto_correo')
          .select('correo')
          .eq('prospecto_id', pieza.prospecto_id)
          .limit(50);
        if (errExtra) throw new Error(`correos de la empresa ilegibles: ${errExtra.message}`);
        copias = ((extra ?? []) as Array<{ correo: string }>).map((f) => f.correo);
      }
      const vivos = await filtrarSuprimidos([principal, ...copias]);
      if (!vivos.includes(principal)) {
        throw new DatoInvalido('el correo principal está en la lista de bajas — no se le escribe');
      }

      // Auto-APROBAR, anclado a pendiente (si un humano la resolvió en la
      // ventana, cero filas y la pieza es suya, no nuestra). Las retomadas
      // (c5-6) ya vienen aprobadas por esta máquina: se saltan este paso y
      // van directo a la puerta de envío, que re-aplica tope/cadencia/bajas.
      // AGB-1: candado de PROFUNDIDAD además del filtro de la consulta — si
      // por lo que sea una `pendiente` llegara hasta aquí con la palanca en
      // su default ('no'), se rechaza en vez de aprobarla sola.
      if (pieza.estado === 'pendiente' && !autoaprobar) {
        throw new DatoInvalido('autoaprobación desactivada (LIKIDA_ENVIADOR_AUTOAPROBAR≠si) — la pieza pendiente no se aprueba sola');
      }
      if (pieza.estado === 'pendiente') {
        const { data: ap, error: errAp } = await supabaseAdmin()
          .from('cola_aprobacion')
          .update({
            estado: 'aprobado',
            resuelto_por: null,
            resuelto_por_email: RESOLUTOR_AUTOMATICO,
            resuelto_en: new Date().toISOString(),
          })
          .eq('id', pieza.id).eq('estado', 'pendiente')
          .select('id');
        if (errAp) throw new Error(`auto-aprobación fallida: ${errAp.message}`);
        if (!Array.isArray(ap) || ap.length === 0) throw new DatoInvalido('un humano la resolvió durante la ventana');
      }

      // ENVIAR por la puerta de siempre (claim + tope + cadencia + CHECK).
      const r = await enviarPiezaPorCorreo(pieza.id, null, vivos.filter((c) => c !== principal));
      piezasEnviadas += 1;
      destinatarios += vivos.length;
      logger.info('enviador.pieza_enviada', { pieza: pieza.id, tipo: pieza.tipo, destinatarios: vivos.length, providerId: r.providerId });

      // El prospecto pasa a 'contactado' (anclado a 'nuevo': los demás
      // estados los mueve el vendedor, no la máquina).
      if (pieza.prospecto_id) {
        const { error: errEstado } = await supabaseAdmin()
          .from('prospecto')
          .update({ estado: 'contactado', updated_at: new Date().toISOString() })
          .eq('id', pieza.prospecto_id).eq('estado', 'nuevo');
        if (errEstado) logger.warn('enviador.estado_no_movido', { prospecto: pieza.prospecto_id, err: errEstado.message });
      }
    } catch (e) {
      saltadas += 1;
      const motivo = e instanceof Error ? e.message.slice(0, 160) : String(e);
      motivos.push(`${pieza.id.slice(0, 8)}: ${motivo}`);
      logger.info('enviador.pieza_saltada', { pieza: pieza.id, motivo });
    }
  }

  await registrarCorrida(null, 'enviador', {
    inicio, fin: new Date(), estado: saltadas > 0 && piezasEnviadas === 0 && candidatas.length > 0 ? 'parcial' : 'ok',
    disparo,
    tareasHechas: piezasEnviadas, tareasTotal: candidatas.length,
    resumen: { piezas: piezasEnviadas, destinatarios, saltadas, sinTurno, autoaprobar, motivos: motivos.slice(0, 10) },
  });
  return { piezasEnviadas, destinatarios, saltadas, motivos, sinTurno };
}

/** El registro de una BAJA o un rebote: suprime la dirección para siempre.
 *  Idempotente por PK — suprimir dos veces es una vez. Jamás lanza hacia el
 *  webhook que la llama: perder un evento de entrega por no poder anotar la
 *  baja sería peor; se grita en el log. */
export async function suprimirCorreo(correo: string, motivo: string): Promise<void> {
  const c = correo.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c)) return;
  try {
    const { error } = await supabaseAdmin().from('correo_suprimido')
      .insert({ correo: c, motivo: motivo.trim() || 'sin motivo declarado' });
    if (error && error.code !== '23505') {
      logger.error('enviador.baja_no_registrada', { motivo, err: error.message });
    }
  } catch (e) {
    logger.error('enviador.baja_no_registrada', { motivo, err: e instanceof Error ? e.message : String(e) });
  }
}
