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
//   · VENTANA DE REVISIÓN opcional (LIKIDA_ENVIADOR_VENTANA_MIN): las piezas
//     esperan N minutos en la bandeja antes de auto-aprobarse, para que un
//     humano pueda vetar. 0 = inmediato (el default de la orden).
//   · La resolución automática es LEGAL en el esquema: el CHECK 0120 exige
//     `resuelto_por_email`, no el uuid — queda 'enviador@automatico', visible
//     en la bandeja como cualquier resolución.
//   · El ENVÍO no estrena puerta: pasa por `enviarPiezaPorCorreo` con su
//     claim anclado, su CHECK enviar-solo-aprobado, el tope diario de frío y
//     la cadencia atómica 48h (0124). Las copias son los correos hallados por
//     el investigador MENOS los suprimidos — y la lista de bajas se lee
//     FAIL-CLOSED: si no se puede leer, no sale nada.
//   · Kill switch propio (`agente:enviador`) y techo de gasto en el runner.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { DatoInvalido } from '../errores';
import { estaApagado } from '../interruptores';
import { correoConfigurado } from '@/lib/correo/enviar';
import { enviarPiezaPorCorreo, topeCorreoFrioDia, filtrarSuprimidos, TIPOS_CAMPANA } from './cola';
import { registrarCorrida, type DisparoCorrida } from './corridas';
import { logger } from '@/lib/logger';

// La lista de bajas vive ahora en la PUERTA (cola.ts, c5-1) para que el
// camino humano también la consulte; se re-exporta para los llamadores y
// pruebas existentes.
export { filtrarSuprimidos };

/** El email con el que el enviador firma sus resoluciones automáticas — la
 *  bandeja lo enseña tal cual, para que nadie confunda un tap humano con la
 *  máquina. */
export const RESOLUTOR_AUTOMATICO = 'enviador@automatico';

/** Minutos que una pieza espera en la bandeja antes de auto-aprobarse — la
 *  ventana en la que un humano puede editarla o rechazarla. 0 = inmediato. */
export function ventanaRevisionMin(): number {
  const v = Number(process.env.LIKIDA_ENVIADOR_VENTANA_MIN);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
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
  const corte = new Date(Date.now() - ventanaRevisionMin() * 60_000).toISOString();
  const { data, error } = await acotada(supabaseAdmin()
    .from('cola_aprobacion')
    .select('id, tipo, estado, prospecto_id, prospecto:prospecto_id(empresa, correo)')
    .or(`and(estado.eq.pendiente,creado_en.lte.${corte}),and(estado.eq.aprobado,enviado_en.is.null,resuelto_por_email.eq.${RESOLUTOR_AUTOMATICO})`)
    .in('tipo', [...TIPOS_CAMPANA])
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
    resumen: { piezas: piezasEnviadas, destinatarios, saltadas, sinTurno, motivos: motivos.slice(0, 10) },
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
