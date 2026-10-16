import { TZ_MX, diaEnZona } from '@/lib/formato';
import { zonaOCdmx } from './config';
import { ETIQUETA, PREFIJO_BOTON, type Contacto, type TipoHito } from './tipos';
import { ETIQUETA_RAMPA, PREFIJO_RAMPA, type EstadoRampa } from './interprete';
import type { Decision, MotivoRechazo, Reubicacion } from './maquina';

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE SE LE DICE AL CHOFER Y A LA OFICINA — textos puros.
//
// La HORA es la del MENSAJE (la que el chofer vivió), en hora de México, y el
// acuse la presenta como lo que es: «anotado», no telemetría del evento físico.
// ═══════════════════════════════════════════════════════════════════════════

export interface ContextoMensaje {
  viajeId: string;
  folio: string | null;
  origen: string | null;
  destino: string | null;
}

export interface BotonSalida { id: string; titulo: string }
export interface Salida { texto: string; botones?: BotonSalida[] }

export function horaMx(fecha: Date, zona: string = TZ_MX): string {
  return new Intl.DateTimeFormat('es-MX', { timeZone: zonaOCdmx(zona), hour: '2-digit', minute: '2-digit', hour12: false }).format(fecha);
}

/** «13:05 del 02/10» cuando el hito no es de hoy; solo la hora cuando sí. */
export function horaYDiaMx(fecha: Date, ahora: Date, zona: string = TZ_MX): string {
  const z = zonaOCdmx(zona);
  const dia = (d: Date) => diaEnZona(d, z);
  if (dia(fecha) === dia(ahora)) return horaMx(fecha, z);
  const corto = new Intl.DateTimeFormat('es-MX', { timeZone: z, day: '2-digit', month: '2-digit' }).format(fecha);
  return `${horaMx(fecha, z)} del ${corto}`;
}

function lugarTexto(nombre: string | null): string {
  const n = (nombre ?? '').replace(/\s+/g, ' ').trim();
  return n ? ` (${n.slice(0, 50)})` : '';
}

export function textoContacto(c: Contacto | null): string {
  if (!c) return '';
  return c.area ? `${c.nombre} (${c.area})` : c.nombre;
}

const RECHAZOS: Record<MotivoRechazo, string> = {
  nada_que_corregir: 'No tengo nada reciente que corregir. 👍',
  validado: 'Ese registro ya lo validó tu oficina, así que no lo puedo retirar desde aquí. Si está mal, avísale a tu jefe de tráfico.',
  fuera_de_ventana: 'Ya pasó mucho tiempo para corregirlo desde aquí. Avísale a tu jefe de tráfico para que lo ajuste.',
  sin_llegada: 'Todavía no tengo tu llegada anotada. Avísame cuando llegues. 📍',
  sin_hito_pendiente: 'Ya tengo todos los avisos de este viaje. 👍',
};

/** Lo que sigue después de cada hito (corto, accionable y sin regañar). */
function siguientePaso(tipo: TipoHito, ctx: ContextoMensaje, contactoDado: boolean): string {
  switch (tipo) {
    case 'llegada_carga':
      return contactoDado
        ? 'Avísame cuando termines de cargar.'
        : '¿Quién te atiende en el andén? Dime su nombre y área (o escribe «sin contacto»).';
    case 'salida_carga':
      return `Buen viaje 🚛. Avísame cuando llegues${ctx.destino ? ` a ${ctx.destino.slice(0, 50)}` : ''} y manda por aquí la foto de tu carta porte o remisión.`;
    case 'llegada_descarga':
      return contactoDado
        ? 'Avísame cuando termines de descargar.'
        : '¿Quién te recibe? Dime su nombre y área (o escribe «sin contacto»).';
    case 'salida_descarga':
      return 'Manda por aquí la foto del comprobante de entrega y avísame cuando vayas de regreso. 📦';
    case 'regreso':
      return 'Si traes recibos pendientes, mándalos cuando puedas.';
  }
}

function acuseRegistro(tipo: TipoHito, hora: string, ctx: ContextoMensaje): string {
  switch (tipo) {
    case 'llegada_carga': return `Anotado ✅ llegaste a CARGAR${lugarTexto(ctx.origen)} a las ${hora}. 📍`;
    case 'salida_carga': return `Anotado ✅ saliste de la carga a las ${hora}.`;
    case 'llegada_descarga': return `Anotado ✅ llegaste a DESCARGAR${lugarTexto(ctx.destino)} a las ${hora}. 📍`;
    case 'salida_descarga': return `Anotado ✅ terminaste de descargar a las ${hora}.`;
    case 'regreso': return `Anotado ✅ vas de regreso desde las ${hora}. 🚛`;
  }
}

/**
 * El acuse al chofer para una decisión YA APLICADA. `aplicado` dice cómo salió el
 * UPDATE: `'carrera'` = otro mensaje se adelantó (se trata como duplicado) y
 * `'fallo'` = no se pudo escribir (no se finge la anotación).
 */
export function mensajeParaChofer(
  d: Decision, ctx: ContextoMensaje, ahora: Date, aplicado: 'ok' | 'carrera' | 'fallo' = 'ok',
): Salida {
  if (aplicado === 'fallo') return { texto: 'No pude anotarlo ahorita — mándamelo de nuevo en un momento. 🙏' };
  if (aplicado === 'carrera') return { texto: 'Ya lo tenía anotado. 👍' };

  switch (d.accion) {
    case 'registrar': {
      const partes = [acuseRegistro(d.objetivo, horaMx(d.mensajeEn), ctx)];
      if (d.contacto) partes.push(`Te atiende ${textoContacto(d.contacto)}. 👍`);
      const omitidos = d.omitir.filter((t) => t !== d.objetivo);
      if (omitidos.length > 0) {
        partes.push(`No tenía anotado ${omitidos.map((t) => ETIQUETA[t].chofer).join(' ni ')}; lo dejé sin hora.`);
      }
      partes.push(siguientePaso(d.objetivo, ctx, Boolean(d.contacto)));
      const salida: Salida = { texto: partes.join('\n') };
      if (d.ambigua && d.objetivo === 'llegada_carga') {
        // El «ya llegué» no decía dónde: se resolvió por el estado, y se ofrece la salida.
        salida.texto += '\nSi ya estás en la descarga, toca el botón.';
        salida.botones = [{ id: `${PREFIJO_BOTON.corrigeLlegada}:${ctx.viajeId}`, titulo: 'Es en descarga' }];
      }
      return salida;
    }
    case 'duplicado':
      return {
        texto: d.contacto
          ? `Ya tenía anotado ese aviso. Agregué a ${textoContacto(d.contacto)} como tu contacto. 👍`
          : 'Ya lo tenía anotado. 👍',
      };
    case 'contacto':
      return { texto: `Anotado: te atiende ${textoContacto(d.contacto)}. 👍` };
    case 'sin_contacto':
      return { texto: 'Va, lo dejo sin contacto. 👍' };
    case 'posponer':
      return {
        texto: d.aplicado
          ? `Va, te vuelvo a preguntar en ${d.minutos} min. 🙏`
          : 'Va. Te sigo avisando porque ya van varias veces; si no puedes responder, dile a tu jefe de tráfico. 🙏',
      };
    case 'corregir': {
      const retirado = ETIQUETA[d.objetivo].chofer;
      const base = `Listo, retiré ${retirado}.`;
      if (d.despues) return { texto: `${base}\n${mensajeParaChofer(d.despues, ctx, ahora).texto}`, botones: mensajeParaChofer(d.despues, ctx, ahora).botones };
      return { texto: `${base} Avísame cuando sea. 👍` };
    }
    case 'aclarar':
      return {
        texto: 'Tengo anotada tu llegada a CARGAR y todavía no tu salida. ¿Ya llegaste a DESCARGAR o sigues en la carga?',
        botones: [
          { id: `${PREFIJO_BOTON.llegadaDescarga}:${ctx.viajeId}`, titulo: 'Llegué a descargar' },
          { id: `${PREFIJO_BOTON.sigueCargando}:${ctx.viajeId}`, titulo: 'Sigo en la carga' },
        ],
      };
    case 'rechazar':
      return { texto: RECHAZOS[d.motivo] };
  }
}

// ── Avisos a la oficina ─────────────────────────────────────────────────────

export interface DatosAvisoOficina {
  chofer: string | null;
  folio: string | null;
  tipo: TipoHito;
  /** La hora del MENSAJE del chofer (la exacta). */
  mensajeEn: Date;
  ahora: Date;
  lugar: string | null;
  contacto: Contacto | null;
}

/** El aviso de llegada/salida con la hora exacta. Se manda como texto (y plantilla de respaldo). */
export function textoAvisoOficina(d: DatosAvisoOficina): string {
  const quien = d.chofer?.trim() || 'Un chofer';
  const viaje = d.folio ? ` (viaje ${d.folio})` : '';
  const donde = d.lugar?.trim() ? ` en ${d.lugar.trim().slice(0, 60)}` : '';
  const con = d.contacto ? ` Lo atiende ${textoContacto(d.contacto)}.` : '';
  return `${quien}${viaje} ${ETIQUETA[d.tipo].oficina}${donde} a las ${horaYDiaMx(d.mensajeEn, d.ahora)} (hora de su mensaje).${con}`;
}

/** El resumen que cabe en el parámetro {{2}} de `aviso_operacion_v1` (≤ 60 caracteres, una línea). */
export function resumenParaPlantilla(d: DatosAvisoOficina): string {
  const hora = horaYDiaMx(d.mensajeEn, d.ahora);
  const folio = d.folio ? ` ${d.folio}` : '';
  const completo = `${ETIQUETA[d.tipo].oficina}${folio} a las ${hora}`;
  return completo.length <= 60 ? completo : `${completo.slice(0, 59)}…`;
}

// ── T-A5-45: la estadía de descarga interactiva (R17) ───────────────────────

/** «¿Ya inició la descarga?» con dos botones (Meta admite hasta 3). `duracion` ya viene en texto («2 horas»). */
export function preguntaEstadiaDescarga(viaje: { id: string; folio: string | null }, duracion: string): Salida {
  const folio = viaje.folio ? ` (viaje ${viaje.folio.replace(/\s+/g, ' ').trim().slice(0, 30)})` : '';
  return {
    texto: `Llevas ${duracion} en la descarga${folio}. ¿Ya inició la descarga?`,
    botones: [
      { id: `${PREFIJO_BOTON.estadiaDescarga}:${viaje.id}:si`, titulo: 'Sí, ya empezó' },
      { id: `${PREFIJO_BOTON.estadiaDescarga}:${viaje.id}:no`, titulo: 'No, sigo esperando' },
    ],
  };
}

export type RespuestaEstadia = 'si' | 'no';

/** El acuse al chofer según lo que contestó y lo que pasó al registrarlo. */
export function acuseEstadiaDescarga(r: RespuestaEstadia, avisado: boolean): Salida {
  if (r === 'si') return { texto: 'Anotado ✅ Avísame cuando termines la descarga. 👍' };
  return {
    texto: avisado
      ? 'Anotado ✅ Ya le avisé a tu supervisor para que te apoye con el cliente. 🙏'
      : 'Anotado ✅ Si quieres apoyo, avísale directo a tu supervisor. 🙏',
  };
}

// ── T-A5-43: «con quién te reportaste» y la rampa ──────────────────────────
// UNA pregunta por paso y sin insistir: ningún texto de aquí pide más de un toque ni repite la pregunta. Cortos, sin regañar.

/** Pregunta proactiva del contacto al llegar al cliente. El botón es el de siempre (`hito_sin_contacto_anden`); su título cabe en los 20 caracteres que Meta admite en un botón de sesión. */
export function mensajePreguntaContacto(ctx: ContextoMensaje): Salida {
  return {
    texto: '¿Con quién te reportaste? Dime su nombre y área (o toca «Aún sin contacto»).',
    botones: [{ id: `${PREFIJO_BOTON.sinContactoAnden}:${ctx.viajeId}`, titulo: 'Aún sin contacto' }],
  };
}

/**
 * La pregunta de la rampa en DOS páginas de botones (Meta admite 3 por mensaje y son 4 estados): página 0 = «Sí», «No», «Más»;
 * página 1 = «No aplica», «En espera». El id lleva el viaje, como todos los botones del módulo.
 */
export function preguntaRampa(viajeId: string, pagina: 0 | 1 = 0): Salida {
  const b = (e: EstadoRampa) => ({ id: `${PREFIJO_RAMPA.estado}${e}:${viajeId}`, titulo: ETIQUETA_RAMPA[e] });
  if (pagina === 1) return { texto: 'Va. ¿En cuál caso estás?', botones: [b('no_aplica'), b('en_espera')] };
  return {
    texto: '¿Te asignaron rampa de descarga? Toca una opción.',
    botones: [b('si'), b('no'), { id: `${PREFIJO_RAMPA.mas}:${viajeId}`, titulo: 'Más opciones' }],
  };
}

/** Tras «sí»: el número es opcional (el cliente pidió no pedir tanto detalle). */
export const TEXTO_PEDIR_NUMERO_RAMPA = 'Va. Si quieres, dime el número de rampa; si no, no pasa nada. 👍';

/** Tras «no aplica»: ¿cómo descarga? Opcional, con un botón para saltarla. */
export function mensajePreguntaComoDescarga(ctx: ContextoMensaje): Salida {
  return {
    texto: 'Entendido, sin rampa. Si quieres, cuéntame cómo descargas (a pie de calle, a granel…); es opcional.',
    botones: [{ id: `${PREFIJO_RAMPA.omitirComo}:${ctx.viajeId}`, titulo: 'Omitir' }],
  };
}

/** El acuse a la respuesta de rampa (sin volver a preguntar nada). */
export function acuseRampa(estado: EstadoRampa, numero: string | null): string {
  switch (estado) {
    case 'si': return numero ? `Anotado ✅ rampa ${numero}.` : 'Anotado ✅ ya tienes rampa asignada.';
    case 'no': return 'Anotado ✅ sin rampa asignada.';
    case 'no_aplica': return 'Anotado ✅ la rampa no aplica en esta entrega.';
    case 'en_espera': return 'Anotado ✅ quedas en espera de rampa. Avísame cuando te asignen.';
  }
}

/** La línea de la rampa vigente para la oficina y el tablero. */
export function textoRampa(r: Pick<Reubicacion, 'rampaEstado' | 'rampa' | 'comoDescarga'> | null): string | null {
  if (!r || !r.rampaEstado) return null;
  switch (r.rampaEstado) {
    case 'si': return r.rampa ? `Rampa ${r.rampa}` : 'Con rampa asignada';
    case 'no': return 'Sin rampa asignada';
    case 'no_aplica': return r.comoDescarga ? `Rampa no aplica · descarga: ${r.comoDescarga}` : 'Rampa no aplica';
    case 'en_espera': return 'En espera de rampa';
  }
}

// ── T-A5-46: el resultado de la descarga y la caja cargada (R19) ────────────

export type OpcionResultadoDescarga = 'completa' | 'no_recibida' | 'caja_cargada';

/** «¿Cómo terminó la descarga?» con tres botones (el máximo de Meta; títulos de ≤ 20 caracteres). */
export function preguntaResultadoDescarga(viaje: { id: string; folio: string | null }): Salida {
  const folio = viaje.folio ? ` (viaje ${viaje.folio.replace(/\s+/g, ' ').trim().slice(0, 30)})` : '';
  return {
    texto: `¿Cómo terminó la descarga${folio}? Toca una opción.`,
    botones: [
      { id: `${PREFIJO_BOTON.resultadoDescarga}:${viaje.id}:completa`, titulo: 'Descarga completa' },
      { id: `${PREFIJO_BOTON.resultadoDescarga}:${viaje.id}:no_recibida`, titulo: 'No me recibieron' },
      { id: `${PREFIJO_BOTON.resultadoDescarga}:${viaje.id}:caja_cargada`, titulo: 'Caja cargada' },
    ],
  };
}

/** El acuse al chofer según lo que contestó y si el supervisor recibió el aviso. */
export function acuseResultadoDescarga(o: OpcionResultadoDescarga, avisado: boolean): Salida {
  if (o === 'completa') return { texto: 'Anotado ✅ descarga completa. Avísame cuando vayas de regreso. 🚛' };
  const que = o === 'no_recibida' ? 'no te recibieron la mercancía y regresas con la caja cargada' : 'regresas a patio con la caja cargada';
  return {
    texto: avisado
      ? `Anotado ✅ ${que}. Ya le avisé a tu supervisor. 🙏`
      : `Anotado ✅ ${que}. Si quieres apoyo, avísale directo a tu supervisor. 🙏`,
  };
}
