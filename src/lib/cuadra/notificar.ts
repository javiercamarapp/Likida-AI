import { sendTemplate, motivoDeFalloWhatsApp } from '@/lib/meta/client';
import { mxn, fechaMx } from '@/lib/formato';
import { logger } from '@/lib/logger';

// ═══════════════════════════════════════════════════════════════════════════
// AVISARLE AL CHOFER QUE TIENE VIAJE.
//
// `crearViaje` y `reasignarOperador` escriben el `operador_id` y ahí se acaba
// el camino: la base sabe a quién le toca y el chofer no. Hoy se entera por
// teléfono, por radio, o no se entera y la unidad sale tarde. El resto del
// producto ya vive en WhatsApp —por ahí manda sus tickets y por ahí recibe su
// liquidación—, así que la asignación tiene que salir por el mismo canal.
//
// ── POR QUÉ PLANTILLA Y NO TEXTO LIBRE ────────────────────────────────────
//
// Likida INICIA esta conversación: el chofer no preguntó nada. Fuera de la
// ventana de 24 h desde su último mensaje, WhatsApp solo entrega plantillas
// aprobadas, y `sendText` no falla de forma visible cuando la ventana está
// cerrada —traga el error de Meta con un `logger.error` y devuelve `null`—, así
// que el panel daría por avisado a un chofer que no recibió nada. Va por
// `sendTemplate`, que devuelve el error en vez de tragárselo.
//
// ── POR QUÉ EL TEXTO SE ARMA EN PIEZAS ────────────────────────────────────
//
// Meta rechaza los parámetros de plantilla que llevan saltos de línea,
// tabuladores o cuatro espacios seguidos: un aviso multilínea metido en un solo
// `{{1}}` rebota con el mensaje sin enviar. Por eso los datos van una pieza por
// parámetro y `armarAvisoViaje` las junta para lo que se lee en pantalla. El
// cierre —qué se espera del chofer— no cambia nunca, así que vive en el cuerpo
// aprobado de la plantilla y no gasta un parámetro.
//
// ── LO QUE NO SE INVENTA ──────────────────────────────────────────────────
//
// Si falta la unidad o el anticipo, el aviso DICE que falta. No pone "N/A" ni
// "$0.00": el chofer lee ese mensaje de pie junto a la unidad y decide si sale
// con dinero propio. Un cero que en realidad es un dato sin capturar le cuesta
// su gasolina. `crearViaje` escribe `anticipo ?? 0`, o sea que en la base un 0
// y un "nunca se capturó" son indistinguibles — por eso el 0 no se imprime como
// cifra: "no hay anticipo registrado" es cierto en las dos lecturas.
// ═══════════════════════════════════════════════════════════════════════════

/** Plantilla de Meta para la asignación. Tiene que estar aprobada para salir. */
const PLANTILLA_VIAJE = 'viaje_asignado';

/**
 * Lo que se le pide al chofer. Es estático, así que va en el cuerpo aprobado de
 * la plantilla; aquí se conserva para poder ENSEÑAR en pantalla el mensaje
 * completo, tal como lo va a leer, aunque el envío falle.
 */
const CIERRE = 'Manda por aquí la foto de cada ticket. Al cerrar el viaje te llega tu liquidación.';

/** Cuántos dígitos tiene, como mínimo, un teléfono al que se pueda escribir. */
const DIGITOS_MINIMOS = 10;

export interface ViajeAsignado {
  folio?: string | null;
  origen?: string | null;
  destino?: string | null;
  /** `viaje.fecha_inicio`: puede venir como fecha sola o como timestamp. */
  fechaInicio?: string | null;
  anticipo?: number | null;
  /** Placa o número económico, ya legible. NO el `unidad_id`. */
  unidad?: string | null;
}

export interface ResultadoNotificacion {
  enviado: boolean;
  /** Por qué no salió, en palabras que digan qué arreglar. */
  motivo?: string;
}

/**
 * Normaliza un dato capturado a mano a algo que quepa en un parámetro de Meta.
 *
 * El origen y el destino los teclea un despachador: llegan con saltos de línea
 * pegados de otro sistema y con espacios de sobra. Los tres son justo lo que
 * Meta rechaza en un parámetro, y el rechazo se ve como "el chofer no recibió
 * nada" sin ninguna pista de por qué.
 */
function pieza(v: string | null | undefined): string {
  return (v ?? '').replace(/\s+/g, ' ').trim();
}

/** Un anticipo solo es una cifra si es un número positivo y real (ver cabecera). */
function hayAnticipo(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/**
 * Las cuatro piezas de datos del aviso, en el orden en que se leen.
 *
 * Es la ÚNICA fuente: de aquí salen tanto los parámetros que viajan a Meta como
 * el texto que se enseña en el panel. Si se armaran por separado, el día que
 * cambie el aviso una de las dos versiones se queda vieja y nadie lo nota
 * —el panel diría una cosa y el teléfono del chofer otra.
 */
function piezasDeDatos(v: ViajeAsignado): string[] {
  const folio = pieza(v.folio);
  const origen = pieza(v.origen);
  const destino = pieza(v.destino);
  const unidad = pieza(v.unidad);

  const ruta =
    origen && destino ? `Ruta: ${origen} → ${destino}`
    : origen ? `Ruta: sale de ${origen}, falta capturar el destino`
    : destino ? `Ruta: llega a ${destino}, falta capturar el origen`
    : 'Ruta: falta capturar el origen y el destino';

  // `fechaMx` devuelve '—' ante una fecha ausente o ilegible. Un guion en el
  // teléfono no le dice al chofer si sale hoy o si el dato no está: se dice.
  const impresa = v.fechaInicio ? fechaMx(v.fechaInicio) : '—';
  const cuando = impresa === '—' ? 'Salida: falta capturar la fecha' : `Salida: ${impresa}`;

  const anticipo = hayAnticipo(v.anticipo) ? `anticipo ${mxn(v.anticipo)}` : 'sin anticipo registrado';
  const recursos = unidad
    ? `Unidad ${unidad}, ${anticipo}`
    : `Unidad: falta asignarte una, ${anticipo}`;

  return [folio ? `Viaje ${folio}` : 'Viaje sin folio capturado', ruta, cuando, recursos];
}

/**
 * Un viaje sin folio y sin ruta no identifica nada.
 *
 * Mismo criterio que el aviso de facturación: no se gasta una plantilla —que se
 * cobra— en un mensaje que el chofer no puede accionar. Recibir "Viaje sin folio
 * capturado, falta capturar el origen y el destino" enseña a ignorar el canal
 * por el que después llega lo que sí importa.
 */
function identificable(v: ViajeAsignado): boolean {
  return Boolean(pieza(v.folio) || pieza(v.origen) || pieza(v.destino));
}

/**
 * El aviso completo, tal como lo lee el chofer: los datos y lo que se espera de
 * él. Puro armado, sin I/O — sirve para enseñarlo en pantalla aunque el envío
 * falle, que es el caso en el que hace más falta.
 */
export function armarAvisoViaje(v: ViajeAsignado): string {
  return [...piezasDeDatos(v), CIERRE].join('\n');
}

/**
 * Le avisa al chofer que le tocó un viaje.
 *
 * FALLA CERRADO Y LO DICE. Sin teléfono no se intenta el envío, y cuando Meta
 * rechaza se devuelve el motivo TRADUCIDO en vez de tragárselo: un aviso que
 * falla callado deja al chofer sin saber que tiene viaje, y el despachador
 * creyendo que ya avisó. Los dos motivos que de verdad van a salir son la
 * plantilla en revisión (132001) y el número fuera de la lista de pruebas
 * (131030) — se leen igual de crípticos en crudo y se arreglan distinto.
 */
export async function notificarAsignacion(args: {
  telefono?: string | null;
  viaje: ViajeAsignado;
  tenantId: string;
}): Promise<ResultadoNotificacion> {
  // Se mide sobre los dígitos y no sobre la cadena: en la base hay teléfonos
  // capturados como "(999) 370 0779" y también celdas con "n/a", que tiene
  // largo pero ningún número al que escribirle.
  const digitos = (args.telefono ?? '').replace(/\D/g, '');
  if (digitos.length < DIGITOS_MINIMOS) {
    return { enviado: false, motivo: 'Ese operador no tiene un teléfono al que se le pueda escribir. Captúralo en su ficha y vuelve a asignarlo.' };
  }

  if (!identificable(args.viaje)) {
    return { enviado: false, motivo: 'El viaje no tiene folio ni ruta: el aviso no le diría al chofer de qué viaje se trata.' };
  }

  const r = await sendTemplate(args.telefono as string, PLANTILLA_VIAJE, {
    parametros: piezasDeDatos(args.viaje),
  });

  if (!r.ok) {
    logger.warn('viaje.aviso_no_salio', { tenantId: args.tenantId, codigo: r.codigo });
    return { enviado: false, motivo: motivoDeFalloWhatsApp(r.error, r.codigo) };
  }

  // El éxito también deja rastro: sin esta línea, "se avisó" y "nunca se llamó"
  // se ven igual en los logs —los dos, en blanco— y mañana nadie sabe si el
  // chofer no salió porque no quiso o porque nunca le llegó el aviso.
  logger.info('viaje.aviso_enviado', { tenantId: args.tenantId, wamid: r.id });
  return { enviado: true };
}
