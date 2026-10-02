import { TZ_MX, hoyMx } from '@/lib/formato';
import { ETIQUETA, PREFIJO_BOTON, type Contacto, type TipoHito } from './tipos';
import type { Decision, MotivoRechazo } from './maquina';

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

export function horaMx(fecha: Date): string {
  return new Intl.DateTimeFormat('es-MX', { timeZone: TZ_MX, hour: '2-digit', minute: '2-digit', hour12: false }).format(fecha);
}

/** «13:05 del 02/10» cuando el hito no es de hoy; solo la hora cuando sí. */
export function horaYDiaMx(fecha: Date, ahora: Date): string {
  const dia = (d: Date) => hoyMx(d);
  if (dia(fecha) === dia(ahora)) return horaMx(fecha);
  const corto = new Intl.DateTimeFormat('es-MX', { timeZone: TZ_MX, day: '2-digit', month: '2-digit' }).format(fecha);
  return `${horaMx(fecha)} del ${corto}`;
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
