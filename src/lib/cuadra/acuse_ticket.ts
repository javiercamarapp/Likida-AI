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

/** Lo que se contesta cuando aprieta "No, corregir". */
export function mensajeCorregir(): string {
  return 'Va, no lo doy por bueno. Escríbeme el total correcto (por ejemplo: 1240.50) o mándame otra foto del ticket. 🙏';
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
