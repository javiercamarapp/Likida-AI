import type { TicketPorFacturar, CampoListo } from './pendientes';

// ═══════════════════════════════════════════════════════════════════════════
// QUIÉN FACTURA CADA TICKET: la máquina o una persona.
//
// La regla, decidida el 4-ago-2026 sobre el dato del registro:
//
//   sin cuenta (26 de 37)  →  lo hace la máquina: se abre el portal, se llenan
//                             los campos que ya se leyeron y se baja el XML.
//   con cuenta (11 de 37)  →  se le manda el mensaje al encargado CON TODO, y
//                             él lo captura con la sesión que solo él tiene.
//
// Los 11 con cuenta son casi todos de PEAJE —IAVE, PASE, TeleVía, PINFRA— y ahí
// además el TAG factura mensual contra la cuenta, no ticket por ticket. O sea
// que entre lo que un chofer FOTOGRAFÍA, la proporción automatizable es todavía
// mayor que ese 70%.
//
// ── POR QUÉ HAY UN TERCER CAMINO ─────────────────────────────────────────
//
// Un ticket puede no tener portal reconocido, o tener campos requeridos que no
// se pudieron leer. Enviarlo a la máquina sería llenar un formulario con huecos
// y quedarse esperando; enviarlo como "listo para capturar" sería mentirle al
// encargado. Ese caso se declara `incompleto` y dice QUÉ falta — es la
// diferencia entre "hazlo tú" y "ni tú ni yo podemos con lo que hay".
// ═══════════════════════════════════════════════════════════════════════════

export type MotivoDeMensaje =
  /** El portal exige sesión y la tiene la persona, no la máquina. */
  | 'requiere_cuenta'
  /**
   * La máquina lo intentó y se topó con algo que no se arregla reintentando:
   * un CAPTCHA, una emisión sin confirmar, un viaje ya liquidado. Ver
   * `TicketPorFacturar.bloqueo`.
   */
  | 'bloqueado';

export type Ruta =
  /** Sin cuenta y con todos los datos: lo hace la máquina. */
  | { via: 'automatico'; portal: string; campos: CampoListo[] }
  /** Lo tiene que hacer una persona. Va con el encargado, con todo listo. */
  | { via: 'mensaje'; portal: string; motivo: MotivoDeMensaje; campos: CampoListo[]; detalle?: string }
  /** No se puede facturar con lo que hay. Se dice qué falta. */
  | { via: 'incompleto'; falta: string[] };

export function enrutar(t: TicketPorFacturar): Ruta {
  const falta: string[] = [];

  if (!t.comercio) {
    falta.push(t.urlTicket ? 'el portal no está en el registro todavía' : 'el ticket no trae liga de facturación');
    return { via: 'incompleto', falta };
  }
  if (t.camposPendientes) {
    falta.push('no se han leído los campos que pide ese portal');
    return { via: 'incompleto', falta };
  }

  // Un campo REQUERIDO vacío no se manda a ningún lado: el portal lo va a
  // rechazar y el reintento cuesta lo mismo que el primer intento.
  const vacios = t.campos.filter((c) => c.requerido && !c.valor);
  if (vacios.length > 0) {
    return { via: 'incompleto', falta: vacios.map((c) => `falta ${c.etiqueta}`) };
  }

  // Vencido: ni la máquina ni la persona pueden ya. Se dice, no se intenta.
  if (t.caducidad.vencido) {
    return { via: 'incompleto', falta: ['el plazo para facturar ya venció'] };
  }

  if (t.comercio.requiereCuenta) {
    return { via: 'mensaje', portal: t.comercio.portal, motivo: 'requiere_cuenta', campos: t.campos };
  }

  // EL BLOQUEO VA DESPUÉS DE `vencido` Y DE LOS CAMPOS QUE FALTAN, y antes de
  // devolverlo al camino automático.
  //
  // Después, porque un ticket vencido no se le manda a nadie —ni la persona
  // puede ya—, y uno al que le falta un dato se dice con lo que falta, que es
  // más accionable que "lo tiene que hacer usted".
  //
  // Antes de `automatico`, porque ESE es el bug que esto cierra: un portal que
  // pidió CAPTCHA seguía enrutado como automático, así que no entraba en el
  // aviso al encargado (`avisar.ts` solo manda lo que una persona puede
  // resolver) y la máquina lo reintentaba cada hora contra el mismo muro.
  if (t.bloqueo) {
    return {
      via: 'mensaje',
      portal: t.comercio.portal,
      motivo: 'bloqueado',
      campos: t.campos,
      detalle: t.bloqueo.motivo,
    };
  }

  return { via: 'automatico', portal: t.comercio.portal, campos: t.campos };
}

/**
 * El mensaje que recibe el encargado para facturar a mano.
 *
 * VA TODO LO QUE NECESITA Y NADA MÁS. La liga primero, los campos después, y el
 * plazo al final para que decida el orden de su rato. Sin adornos: se lee en el
 * teléfono, de pie, junto a una unidad.
 *
 * NO LLEVA LOS DATOS DEL RECEPTOR —RFC, razón social, código postal— aunque el
 * portal los pida: son los mismos de la flota en todos los portales y él ya los
 * tiene guardados. Repetirlos en cada mensaje entierra lo que sí cambia.
 */
export function mensajeParaEncargado(t: TicketPorFacturar, ruta: Extract<Ruta, { via: 'mensaje' }>): string {
  const lineas: string[] = [];
  const c = t.caducidad;

  const urgencia = c.desconocido
    ? 'sin fecha legible'
    : c.urgente
      ? (c.diasRestantes === 0 ? '⚠️ VENCE HOY' : `⚠️ vence en ${c.diasRestantes} día(s)`)
      : `${c.diasRestantes} días para facturar`;

  lineas.push(`Falta la factura de un ${t.concepto} — ${urgencia}`);
  lineas.push('');
  lineas.push(ruta.portal);
  lineas.push('');
  for (const campo of ruta.campos) {
    lineas.push(`${campo.etiqueta}: ${campo.valor ?? '(búscalo en el ticket)'}`);
  }
  lineas.push('');
  // El cierre DICE CUÁL de las dos cosas pasó. Con un solo texto, un ticket que
  // el robot intentó y no pudo se leería como "ese portal pide cuenta" —y el
  // encargado iría a buscar una contraseña que no existe.
  lineas.push(
    ruta.motivo === 'requiere_cuenta'
      ? 'Ese portal pide cuenta, por eso no se pudo hacer solo.'
      : `Se intentó solo y no se pudo: ${ruta.detalle ?? 'el portal lo bloqueó'}. Reintentarlo daría lo mismo, por eso te llega a ti.`,
  );
  return lineas.join('\n');
}

/** El reparto de una lista: cuántos van por cada camino. */
export function repartir(tickets: TicketPorFacturar[]) {
  const rutas = tickets.map((t) => ({ t, r: enrutar(t) }));
  return {
    automaticos: rutas.filter((x) => x.r.via === 'automatico'),
    mensajes: rutas.filter((x) => x.r.via === 'mensaje'),
    incompletos: rutas.filter((x) => x.r.via === 'incompleto'),
  };
}
