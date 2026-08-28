import { logger } from '@/lib/logger';
import { appUrl } from '@/lib/env';
import { mxn, fechaMx } from '@/lib/formato';
import { enviarCorreo } from '@/lib/correo/enviar';
import type { Correo } from '@/lib/correo/plantilla';
import {
  usuariosAvisables, ROLES_AVISABLES, MAX_DESTINATARIOS,
  type UsuarioAvisable,
} from './agentes/notificaciones';

// ═══════════════════════════════════════════════════════════════════════════
// «TU CLIENTE DICE QUE YA PAGÓ» — EL AVISO AL CONTRALOR.
//
// ── POR QUÉ NO PASA POR `avisar()` DE agentes/notificaciones.ts ───────────
//
// Ése es el canal correcto para lo que fue diseñado y no para esto. Sus tres
// eventos (`corrida_fallida`, `cola_atorada`, `escalado`) describen la SALUD
// DE UN AGENTE, viven en un dominio CHECK en la base (0097) sobre seis agentes
// nombrados, y traen consigo el anti-ruido que ese problema necesita: un piso
// de una hora y marcas de insistencia en 1/5/20, porque un cron que falla cada
// hora no debe mandar 24 correos iguales.
//
// Un cliente que registra un pago es lo contrario en las dos dimensiones: no
// es la salud de nada, y CADA UNO importa por separado. Colapsar tres pagos de
// tres clientes distintos en "1 aviso por hora" es exactamente el mal que aquí
// hay que evitar. Meter un séptimo agente y un cuarto evento en aquella máquina
// para heredar el silenciador que sobra sería tomar el acoplamiento y tirar el
// beneficio.
//
// Lo que SÍ se reusa es lo que de verdad es compartido: `usuariosAvisables` —
// la resolución de a quién de la flota se le escribe— y `ROLES_AVISABLES`. La
// alternativa era una segunda consulta a `app_user` con su propia idea de quién
// cuenta como contralor, que es cómo se divergen dos listas de destinatarios.
//
// ── EL ANTI-RUIDO QUE SÍ APLICA YA ESTÁ PUESTO, Y NO ES ÉSTE ─────────────
//
// El volumen lo acotan dos cosas anteriores a este archivo: el límite de tasa
// de la ruta pública (molde de la calculadora) y el índice único de la 0228,
// que hace que el mismo pago registrado dos veces no llegue ni a insertarse.
// Un correo por propuesta NUEVA es, literalmente, un correo por hecho nuevo.
//
// NUNCA LANZA. El pago del cliente YA quedó registrado cuando esto corre; que
// el correo no salga no puede deshacerlo ni convertirlo en un error en la
// pantalla del cliente, que leería "no se registró" sobre algo que sí está.
// ═══════════════════════════════════════════════════════════════════════════

export interface AvisoPropuesta {
  flota: string;
  cliente: string;
  /** Serie+folio si los hay; si no, el UUID; si no, «sin folio». */
  identificaFactura: string;
  fecha: string;
  monto: number;
  referencia: string;
  metodo: string;
}

export interface ResultadoAvisoPortal {
  enviado: boolean;
  /** Salió o no salió, y POR QUÉ. La pantalla y el log lo repiten tal cual. */
  porque: string;
  destinatarios: number;
}

/** El correo, armado aparte para poder probarlo sin red. */
export function correoDePropuesta(a: AvisoPropuesta): Correo {
  return {
    asunto: `${a.cliente} registró un pago de ${mxn(a.monto)}`,
    avance: `Factura ${a.identificaFactura} · referencia ${a.referencia}. Falta que lo concilies.`,
    titulo: 'Un cliente registró un pago en tu portal',
    parrafos: [
      `${a.cliente} entró al enlace de pago de la factura ${a.identificaFactura} y dejó registrado un depósito.`,
      'Todavía NO está aplicado a la factura: el saldo de tu cartera no se movió. Es lo que tu cliente afirma haber pagado, y queda esperando a que lo cruces contra tu estado de cuenta. Cuando lo concilies, Likida crea el abono real y la factura se actualiza.',
    ],
    datos: [
      ['Cliente', a.cliente],
      ['Factura', a.identificaFactura],
      ['Fecha del pago', fechaMx(a.fecha)],
      ['Monto', mxn(a.monto)],
      ['Forma', a.metodo],
      ['Referencia', a.referencia],
    ],
    boton: { texto: 'Conciliarlo en Likida', href: `${appUrl()}/dashboard/facturacion` },
    tono: 'atencion',
    porQueLoRecibes: `Recibes este correo porque administras la facturación de ${a.flota} en Likida y un cliente registró un pago en su enlace.`,
  };
}

/** Quién recibe: los roles que ya administran dinero en la flota, y solo los
 *  que tienen correo utilizable. */
function destinos(usuarios: UsuarioAvisable[]): string[] {
  return usuarios
    .filter((u) => (ROLES_AVISABLES as readonly string[]).includes(u.rol))
    .map((u) => u.email)
    .filter((e): e is string => typeof e === 'string' && e.trim() !== '')
    .slice(0, MAX_DESTINATARIOS);
}

export async function avisarPropuestaAlContralor(
  tenantId: string,
  a: AvisoPropuesta,
  /** El id de la propuesta. Va como llave de idempotencia de Resend: un
   *  timeout de red es ambiguo, y sin ella un reintento mandaría el mismo
   *  correo dos veces (c5-3). */
  propuestaId: string,
): Promise<ResultadoAvisoPortal> {
  try {
    const usuarios = await usuariosAvisables(tenantId);
    const para = destinos(usuarios);
    if (para.length === 0) {
      // No es un fallo del sistema y no se reporta como tal: es una flota sin
      // correos capturados. Se dice, porque la propuesta sigue esperando a
      // alguien que no se va a enterar por correo — solo al entrar al panel.
      const porque = 'Nadie de la flota tiene correo capturado: el registro quedó guardado y se ve en Facturación, pero no salió aviso.';
      logger.warn('portal_pago.aviso_sin_destinatarios', { tenantId });
      return { enviado: false, porque, destinatarios: 0 };
    }

    const r = await enviarCorreo(para, correoDePropuesta(a), {
      idempotencyKey: `portal-pago-propuesta:${propuestaId}`,
    });

    if (r.ok) {
      return { enviado: true, porque: `Aviso enviado a ${para.length} persona(s) de la flota.`, destinatarios: para.length };
    }
    if (r.motivo === 'sin_configurar') {
      return { enviado: false, porque: 'El canal de correo no está configurado en este entorno.', destinatarios: para.length };
    }
    logger.error('portal_pago.aviso_fallo', { tenantId, motivo: r.motivo, err: r.detalle });
    return { enviado: false, porque: `El correo no salió (${r.motivo}). El registro sí quedó guardado.`, destinatarios: para.length };
  } catch (e) {
    // `usuariosAvisables` falla POR VALOR hacia arriba (lanza): aquí se atrapa
    // porque este canal jamás puede tumbar lo que vino a anunciar.
    logger.error('portal_pago.aviso_fallo', { tenantId, err: e instanceof Error ? e.message : String(e) });
    return { enviado: false, porque: 'No se pudo avisar por correo. El registro sí quedó guardado.', destinatarios: 0 };
  }
}
