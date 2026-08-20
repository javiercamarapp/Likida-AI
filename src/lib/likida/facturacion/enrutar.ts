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
  | 'bloqueado'
  /**
   * El portal se reconoce y no pide cuenta, pero NADIE SABE OPERARLO todavía:
   * no hay adaptador escrito para él. Es distinto de `bloqueado` —aquello es
   * "lo intenté y no pude"— y distinto de `requiere_cuenta` —aquello es "la
   * sesión es tuya"—. Aquí el hueco es nuestro, y mientras exista, quien puede
   * facturar es la persona.
   */
  | 'sin_robot';

export type Ruta =
  /** Sin cuenta y con todos los datos: lo hace la máquina. */
  | { via: 'automatico'; portal: string; campos: CampoListo[] }
  /** Lo tiene que hacer una persona. Va con el encargado, con todo listo. */
  | { via: 'mensaje'; portal: string; motivo: MotivoDeMensaje; campos: CampoListo[]; detalle?: string }
  /** No se puede facturar con lo que hay. Se dice qué falta. */
  | { via: 'incompleto'; falta: string[] };

/**
 * @param sabeOperarlo  ¿Hay un adaptador ESCRITO para el portal de este ticket?
 *
 * OBLIGATORIO, y por eso rompe la compilación de quien no lo pase.
 *
 * Sin este dato, esta función mandaba al robot todo lo que no pidiera cuenta
 * —«sin cuenta (26 de 37) → lo hace la máquina», dice el encabezado— cuando
 * adaptadores hay UNO. Los otros 25 comercios quedaban enrutados a un robot
 * inexistente: `facturarAlVuelo` los rechazaba con `sin_adaptador`, y el aviso
 * de WhatsApp NO los llevaba, porque `avisar.ts` solo manda lo que `enrutar`
 * marcó para una persona. Ni se facturaban ni nadie se enteraba.
 *
 * Medido el 20-ago-2026 con un ticket de G500 Sureste: portal reconocido, WebID
 * leído, plazo vigente, sin cuenta que pedir — y el operador nunca supo que
 * tenía que entrar a facturarlo. El silencio es el modo de falla que este repo
 * persigue en todos lados menos aquí.
 *
 * @param cuentaCompartida  ¿La flota compartió en el cofre su cuenta de ESTE
 * portal? (`facturacion/cuentas.ts`). Cambia la premisa de `requiere_cuenta`:
 * «la sesión la tiene la persona» deja de ser cierto cuando la persona la
 * entregó, y entonces el ticket sigue el mismo camino que los sin cuenta —
 * robot si hay quien opere el portal, persona si no, y CAPTCHA siempre con la
 * persona. El default `false` es el estado del mundo antes del cofre, y es el
 * lado seguro: sin cuenta confirmada, con el encargado.
 */
export function enrutar(t: TicketPorFacturar, sabeOperarlo: boolean, cuentaCompartida = false): Ruta {
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

  // CON LA CUENTA COMPARTIDA, `requiere_cuenta` deja de ser destino: la razón
  // de mandarlo a la persona era que solo ella tenía la sesión, y ya no. El
  // ticket sigue por los mismos filtros que los sin cuenta — bloqueo, robot
  // escrito o no. Sin cuenta compartida, todo queda exactamente como antes.
  if (t.comercio.requiereCuenta && !cuentaCompartida) {
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

  // NO HAY QUIÉN LO OPERE → va con la persona, no a un robot que no existe.
  //
  // Va al final a propósito: `requiere_cuenta` y `bloqueado` cuentan historias
  // más específicas, y de las tres ésta es la única cuyo arreglo es NUESTRO
  // (escribir el adaptador). Mientras no esté escrito, el ticket igual se puede
  // facturar —el portal está ahí y los datos ya se leyeron—, solo que lo hace
  // una persona con la liga en el teléfono.
  if (!sabeOperarlo) {
    return { via: 'mensaje', portal: t.comercio.portal, motivo: 'sin_robot', campos: t.campos };
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
      : ruta.motivo === 'sin_robot'
        // SE DICE QUE EL HUECO ES NUESTRO. «No se pudo» a secas manda al
        // encargado a buscar qué hizo mal, y no hizo nada mal.
        ? 'Ese portal todavía no lo sé llenar solo. Con la liga y los datos de arriba se hace en un minuto.'
        : `Se intentó solo y no se pudo: ${ruta.detalle ?? 'el portal lo bloqueó'}. Reintentarlo daría lo mismo, por eso te llega a ti.`,
  );
  return lineas.join('\n');
}

/**
 * El reparto de una lista: cuántos van por cada camino.
 *
 * `sabeOperarlo` se pregunta POR COMERCIO —no es un booleano suelto— porque una
 * misma lista trae tickets de portales distintos, y el que tiene adaptador y el
 * que no van por caminos distintos.
 */
export function repartir(
  tickets: TicketPorFacturar[],
  sabeOperarlo: (clave: string) => boolean,
  cuentaCompartida: (clave: string) => boolean = () => false,
) {
  const rutas = tickets.map((t) => ({
    t,
    r: enrutar(
      t,
      t.comercio ? sabeOperarlo(t.comercio.clave) : false,
      t.comercio ? cuentaCompartida(t.comercio.clave) : false,
    ),
  }));
  return {
    automaticos: rutas.filter((x) => x.r.via === 'automatico'),
    mensajes: rutas.filter((x) => x.r.via === 'mensaje'),
    incompletos: rutas.filter((x) => x.r.via === 'incompleto'),
  };
}
