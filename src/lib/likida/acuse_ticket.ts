import { mxn, fechaMx } from '@/lib/formato';
import type { EstadoViaje } from './consulta_chofer';

// ═══════════════════════════════════════════════════════════════════════════
// QUÉ SE LE CONTESTA AL CHOFER CUANDO MANDA UNA FOTO.
//
// Antes se le acusaba todo igual. Ahora hay tres peldaños, y cuál toca depende
// de UNA sola pregunta: ¿podemos probar el monto que leímos?
//
//   silencio   → sí. El monto es un hecho (viene del CFDI) o la lectura es
//                sólida. No se le escribe nada: se cuenta y ya.
//   confirmar  → se leyó, pero no se puede probar. Se le enseña monto, tipo y
//                fecha, y un BOTÓN para que lo confirme.
//   refoto     → no se leyó con seguridad. Se le pide otra foto. NO se le pide
//                que confirme.
//
// ── POR QUÉ EL SILENCIO ES EL PELDAÑO BUENO ──────────────────────────────
//
// Un viaje trae ~22 comprobantes. Acusar los 22 son 22 mensajes que el chofer
// deja de leer al quinto — y entonces el que SÍ importaba, el del monto dudoso,
// se pierde entre los que no. Callar en los buenos es lo que hace que el
// mensaje del malo se lea. El silencio no es ahorro, es contraste.
//
// ── POR QUÉ NO SE PIDE CONFIRMAR UN MONTO DUDOSO ─────────────────────────
//
// Es la regla que más cuesta y la que más protege. Si la lectura no es segura y
// aun así se le pregunta "¿son $420?", el chofer va manejando, ve un número
// plausible y aprieta "sí". Ahora un monto equivocado lleva su confirmación
// encima, y eso es PEOR que no haber preguntado: convierte un error de OCR en
// un dato firmado por el operador, y el contralor ya no tiene cómo distinguirlo.
//
// Por eso en `refoto` NO se menciona la cifra que se creyó leer. Enseñarla
// ancla: si se le dice "¿$420?" y el ticket decía $4,200, va a leer 420 en su
// propio papel. Se pide la foto a secas.
//
// ── POR QUÉ UNA REPETICIÓN SIEMPRE LLEVA RESPUESTA ───────────────────────
//
// Si se le pidió otra foto, se le contesta, aunque la segunda se lea perfecta.
// Callar después de "mándame otra" se lee como "volvió a fallar", y el chofer
// manda una tercera, y una cuarta. El silencio solo significa "todo bien"
// cuando nunca se le pidió nada.
// ═══════════════════════════════════════════════════════════════════════════

/** Arriba de esto el monto se da por bueno sin molestar al chofer. */
export const CONFIANZA_PROBADA = 0.9;

/** Debajo de esto no se pide confirmar: se pide otra foto. */
export const CONFIANZA_LEGIBLE = 0.65;

// ═══════════════════════════════════════════════════════════════════════════
// DAT-18 · LA CONFIANZA NO MIRA LA ESCALA, Y ESE ERA EL AGUJERO.
//
// `decidirAcuse` callaba con `confianza >= 0.9`, y un OCR está igual de seguro
// leyendo $850.00 que leyendo $850,000.00: la confianza mide qué tan nítido se
// vio el papel, no si la cifra tiene sentido en un viaje de carga. Un punto
// decimal perdido o un separador de miles mal leído multiplican por 1,000 con
// la misma confianza, y el schema del OCR (`z.number()`, sin tope) los deja
// pasar sin una sola señal.
//
// El daño va en las dos direcciones y ninguna es teórica: el monto entra al
// comprobado, la diferencia contra el anticipo se calcula con él, y la
// liquidación sale «a favor del operador» por una cifra que nadie tecleó.
//
// EL UMBRAL ES RELATIVO AL VIAJE, con un piso absoluto:
//
//   · 3 × anticipo — el anticipo es lo que la flota le entregó para gastar. Un
//     solo comprobante que valga el triple no es un gasto del viaje, es una
//     lectura mala (o algo que una persona tiene que ver). El factor 3 deja
//     pasar holgadamente el caso legítimo del viaje que se pasó del anticipo.
//   · $50,000 de piso — para el viaje con anticipo chico o sin capturar
//     (anticipo 0, que es el default de la tabla), donde «3 × 0» convertiría
//     en sospechoso hasta el primer ticket de casetas.
//
// Se toma el MAYOR de los dos: el piso nunca hace más estricto al umbral del
// viaje grande, y el viaje grande nunca ablanda el piso.
// ═══════════════════════════════════════════════════════════════════════════

/** Piso absoluto del umbral, para viajes sin anticipo capturado. */
export const TOPE_MONTO_PISO_MXN = 50_000;

/** Cuántas veces el anticipo puede valer UN comprobante antes de dudar. */
export const FACTOR_ANTICIPO_IMPLAUSIBLE = 3;

/** El umbral efectivo de este viaje. `anticipo` puede ser 0 o null. */
export function umbralMontoImplausible(anticipo: number | null | undefined): number {
  const a = typeof anticipo === 'number' && Number.isFinite(anticipo) && anticipo > 0 ? anticipo : 0;
  return Math.max(FACTOR_ANTICIPO_IMPLAUSIBLE * a, TOPE_MONTO_PISO_MXN);
}

/**
 * ¿Esta cifra está fuera de escala para este viaje?
 *
 * PURA y exportada porque la usan dos sitios que no se pueden separar: el
 * intake (para marcar el gasto y preguntarle al chofer mientras tiene el
 * ticket en la mano) y el motor (para que el contralor lo vea aunque el chofer
 * no haya contestado). Una segunda definición del umbral en cualquiera de los
 * dos sería exactamente el error que este repo ya pagó tres veces.
 */
export function esMontoImplausible(monto: number | null | undefined, anticipo: number | null | undefined): boolean {
  if (typeof monto !== 'number' || !Number.isFinite(monto)) return false;
  return monto > umbralMontoImplausible(anticipo);
}

/**
 * Tope de confirmaciones por ráfaga.
 *
 * Los botones de WhatsApp no se pueden agrupar: cada confirmación es UN mensaje
 * interactivo. Un chofer que descarga 12 fotos malas de golpe recibiría 12
 * botones, que es justo el ruido que este módulo existe para evitar. Pasado el
 * tope se resume en uno solo de texto y el resto lo revisa la oficina.
 */
export const MAX_CONFIRMACIONES_SEGUIDAS = 4;

export type Peldano = 'silencio' | 'confirmar' | 'refoto';

export interface LecturaTicket {
  montoMxn: number | null;
  concepto: string | null;
  /** ISO. Importa tanto como el monto: de ella depende el plazo para facturar. */
  fecha: string | null;
  /** `null` = no se registró. NO es lo mismo que "alta". */
  confianza: number | null;
  /** Vino de un XML/CFDI: el monto lo dice el documento fiscal, no la vista. */
  deCfdi: boolean;
  /** Ya se le pidió otra foto de este ticket y esta es la repetición. */
  esRepeticion: boolean;
  /** DAT-18: el monto está fuera de escala para este viaje (ver
   *  `esMontoImplausible`). No es un juicio sobre el chofer: es una cifra que
   *  nadie puede dar por buena sin verla. */
  montoImplausible?: boolean;
}

export interface Decision {
  peldano: Peldano;
  /** Para el log y la pantalla: qué disparó este peldaño. */
  porque: string;
}

/**
 * En qué peldaño cae esta foto.
 *
 * PURA a propósito. Es la función que decide si un chofer recibe un mensaje o
 * no, y si se le pide firmar una cifra — se tiene que poder probar entera sin
 * base de datos ni WhatsApp de por medio.
 */
export function decidirAcuse(l: LecturaTicket): Decision {
  // Un CFDI trae el total en el documento. No hay nada que confirmar: pedirle
  // al chofer que valide una cifra que el SAT ya selló sería teatro.
  if (l.deCfdi) return { peldano: 'silencio', porque: 'el monto viene del CFDI' };

  // DAT-18: FUERA DE ESCALA MANDA SOBRE LA CONFIANZA. Va aquí arriba, antes de
  // la escalera de confianza, porque es justo el caso que la escalera dejaba
  // pasar: un $850,000 leído nítido salía por `silencio` con confianza 0.95.
  //
  // Y va DESPUÉS del CFDI a propósito: el total de un comprobante timbrado
  // viene sellado por el SAT, no leído por visión. Un CFDI grande es un CFDI
  // grande, y pedirle al chofer que lo confirme sería el mismo teatro que ya
  // se descartó arriba.
  if (l.montoImplausible) {
    return { peldano: 'confirmar', porque: 'el monto está fuera de escala para este viaje' };
  }

  if (l.montoMxn === null || !Number.isFinite(l.montoMxn) || l.montoMxn <= 0) {
    return { peldano: 'refoto', porque: 'no se leyó el monto' };
  }
  if (!l.fecha) {
    return { peldano: 'refoto', porque: 'no se leyó la fecha' };
  }
  // `null` cae aquí a propósito: un comprobante sin confianza registrada es uno
  // del que no sabemos nada, y tratarlo como bueno es exactamente el error que
  // este umbral existe para impedir.
  if (l.confianza === null || l.confianza < CONFIANZA_LEGIBLE) {
    return { peldano: 'refoto', porque: 'la lectura no da para confirmar' };
  }

  // Se le pidió otra foto: se le contesta, salga como salga la lectura.
  if (l.esRepeticion) {
    return { peldano: 'confirmar', porque: 'es la foto que se le pidió' };
  }

  if (l.confianza >= CONFIANZA_PROBADA && l.concepto) {
    return { peldano: 'silencio', porque: 'lectura sólida' };
  }
  return {
    peldano: 'confirmar',
    porque: l.concepto ? `confianza ${l.confianza.toFixed(2)}` : 'no se leyó el tipo de gasto',
  };
}

/** El renglón de "cómo vas". Vacío cuando no hay anticipo contra qué medirlo. */
export function lineaDeSaldo(e: EstadoViaje | null): string {
  if (!e) return '';
  if (e.anticipo <= 0) {
    // Sin anticipo no hay "cuánto te falta": decirlo sería inventar la meta.
    return `Llevas ${mxn(e.comprobado)} en ${e.comprobantes} comprobante(s).`;
  }
  const falta = e.anticipo - e.comprobado;
  const cola = falta > 0
    ? `, te faltan ${mxn(falta)}`
    : falta < 0
      ? `, ${mxn(-falta)} por encima`
      : ', vas justo';
  return `Llevas ${mxn(e.comprobado)} de ${mxn(e.anticipo)}${cola}.`;
}

export interface MensajeConBotones {
  cuerpo: string;
  botones: Array<{ id: string; titulo: string }>;
}

/**
 * El mensaje de confirmación: qué se leyó y un botón para validarlo.
 *
 * El concepto va SIN adornos y la cifra sale de `formato.ts`, como todas: una
 * cifra fiscal que se lee distinto en dos pantallas se lee como dos cálculos.
 */
export function mensajeConfirmar(
  gastoId: string,
  l: LecturaTicket,
  estado: EstadoViaje | null,
): MensajeConBotones {
  const partes = [
    l.concepto ?? 'Comprobante',
    mxn(l.montoMxn ?? 0),
    l.fecha ? fechaMx(l.fecha) : null,
  ].filter(Boolean);

  const saldo = lineaDeSaldo(estado);
  const cuerpo = [
    partes.join(' · '),
    '¿Está bien?',
    saldo ? `\n${saldo}` : '',
  ].filter(Boolean).join('\n').trim();

  return {
    cuerpo,
    botones: [
      { id: `ok:${gastoId}`, titulo: 'Sí, está bien' },
      { id: `mal:${gastoId}`, titulo: 'No, corregir' },
    ],
  };
}

/**
 * La petición de otra foto.
 *
 * NO LLEVA LA CIFRA que se creyó leer, y no es un descuido: ver un número te
 * hace leerlo en tu propio ticket. Ver la nota del encabezado.
 */
export function mensajeRefoto(porque: string): string {
  const que = porque.includes('fecha')
    ? 'no alcancé a leer la fecha'
    : porque.includes('monto')
      ? 'no alcancé a leer el total'
      : 'esa foto no me dejó leer bien el total';
  return `${que.charAt(0).toUpperCase()}${que.slice(1)} 🔍. ¿Me la reenvías con buena luz, completo y sin doblar? Así no te lo dejo pendiente.`;
}

/**
 * ¿El último mensaje nuestro fue una petición de otra foto?
 *
 * Es lo que hace cumplir la regla de "una repetición siempre lleva respuesta".
 * Se reconoce por la frase propia de `mensajeRefoto` —la lupa más el verbo—, no
 * por un marcador guardado: no hace falta una columna para saber qué acabamos
 * de decir, y un marcador se desincroniza del texto en cuanto alguien lo edita.
 *
 * Si `mensajeRefoto` cambia de redacción, ESTA función tiene que cambiar con
 * ella. La prueba que las ata está para que no se olvide.
 */
export function esPeticionDeFoto(ultimoMensajeNuestro: string): boolean {
  const t = ultimoMensajeNuestro.toLowerCase();
  return t.includes('🔍') && /reenv[íi]as|reenviar|otra foto|mejor luz|buena luz/.test(t);
}

/**
 * Lo que se contesta cuando aprieta "No, corregir".
 *
 * ── EL TEXTO ANTERIOR OFRECÍA DOS SALIDAS Y LAS DOS FALLABAN ─────────────
 *
 * Decía: «Escríbeme el total correcto (por ejemplo: 1240.50) o mándame otra
 * foto del ticket».
 *
 *   · ESCRIBIR EL MONTO no corregía nada. El agente tiene exactamente tres
 *     tools —`consultar_politica`, `cuadrar_viaje`, `guardar_liquidacion`— y
 *     NINGUNA toca un gasto (verificado en `tools.ts`, 4-ago-2026). Peor: un
 *     mensaje con una cifra hace que `guardiaCifras` sustituya la respuesta por
 *     el cuadre real de la base… que sigue trayendo el monto MALO. O sea que la
 *     corrección se leía como aplicada y el número equivocado volvía confirmado.
 *   · MANDAR OTRA FOTO lo cobra DOS VECES. La llave con la que
 *     `copiasDeComprobante` (`cuadre/engine.ts`) deduplica es
 *     `concepto|folio|MONTO`, y el monto es justo lo que cambia cuando la
 *     segunda lectura sale bien: dos llaves distintas, dos gastos, el mismo
 *     consumo sumado dos veces al comprobado del chofer.
 *
 * Así que este mensaje se limita a lo que es verdad hoy: que no se dio por
 * bueno, que desde aquí no se puede cambiar el monto, y —sobre todo— que NO
 * mande otra foto de ese mismo ticket, que es la única de las dos salidas que
 * además cuesta dinero.
 *
 * Cuando exista la corrección de verdad (marcar el gasto para revisión y que el
 * cuadre lo levante, sin inventar el monto) este texto cambia con ella.
 */
export function mensajeCorregir(): string {
  return 'Anotado: ese monto no está bien 👍.\n\n' +
    'Todavía no puedo cambiarlo desde aquí, y *no me mandes otra foto de ese mismo ticket* — ' +
    'entraría como un gasto aparte y se te contaría dos veces.\n\n' +
    'Guarda el papel y enséñaselo a tu oficina para que lo revisen contra tu liquidación. 🙏';
}

/** Lo que se contesta cuando aprieta "Sí, está bien". */
export function mensajeConfirmado(estado: EstadoViaje | null): string {
  const saldo = lineaDeSaldo(estado);
  return saldo ? `Listo ✅. ${saldo}` : 'Listo ✅.';
}

/** Interpreta el id que devuelve un botón. `null` = no era uno de los nuestros. */
export function leerBoton(texto: string): { accion: 'ok' | 'mal'; gastoId: string } | null {
  const m = /^(ok|mal):([0-9a-f-]{36})$/i.exec(texto.trim());
  if (!m) return null;
  return { accion: m[1].toLowerCase() as 'ok' | 'mal', gastoId: m[2] };
}

/**
 * El resumen cuando la ráfaga trae más dudas de las que caben en botones.
 *
 * Dice CUÁNTOS quedaron sin confirmar en vez de callarlos: un tope que no se
 * anuncia se lee como "todo salió bien", que es la peor lectura posible.
 *
 * ARRANCABA CON «Recibí todo, pero…», y eso dejó de ser cierto en cuanto esta
 * frase pasó a viajar dentro del resumen de ráfaga: el párrafo de arriba puede
 * estar diciéndole que tres fotos no se leyeron y dos se trabaron, y entonces
 * «recibí todo» lo contradice en el mismo mensaje. Se escribe de forma que sea
 * verdad sola y acompañada.
 */
export function mensajeDemasiadasDudas(cuantos: number, estado: EstadoViaje | null): string {
  const saldo = lineaDeSaldo(estado);
  return [
    `Y hay ${cuantos} ${cuantos === 1 ? 'comprobante que no pude leer' : 'comprobantes que no pude leer'} con seguridad 🔍.`,
    `Los dejo marcados para que tu oficina los revise; si puedes, ${cuantos === 1 ? 'reenvía esa foto' : 'reenvía esas fotos'} con mejor luz.`,
    saldo,
  ].filter(Boolean).join(' ');
}
