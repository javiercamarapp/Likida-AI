// ═══════════════════════════════════════════════════════════════════════════
// EL REDACTOR DE RESPUESTAS AL CLIENTE — con datos reales o con la verdad: «lo consulto».
//
// Regla que define al producto (CLAUDE.md: «Nunca inventar una cifra»), aplicada
// a un mensaje que sale hacia un cliente de la flota:
//
//   1. El BORRADOR se arma DETERMINISTAMENTE con lo que `ServicioEstatusViaje`
//      devolvió. Cada hora, cada folio y cada coordenada del texto sale de un
//      dato; ninguna frase promete algo que el dato no dice.
//   2. Lo que NO hay (ETA, GPS, documentos sin poder leer) no se rellena: el
//      texto dice «lo consulto con tu ejecutivo» y el borrador sale con
//      `faltantes`, que obliga a ESCALAR al gerente y a pedir aprobación.
//   3. Pulir con un modelo es OPCIONAL (`pulirBorrador`) y está guardado: el texto
//      pulido se acepta solo si (a) no trae NINGUNA cifra que el borrador y el
//      mensaje del cliente no tengan, (b) no trae ligas, correos ni teléfonos
//      nuevos, (c) conserva el folio y (d) no es más largo que el tope. Si falla
//      cualquiera, se manda el determinista. Nunca se manda «media respuesta».
//
// El riesgo (`bajo`/`medio`/`alto`) lo fija este archivo —no el modelo— y es lo
// que la política de envío (politica.ts) usa para decidir si algo puede salir sin
// aprobación humana.
// ═══════════════════════════════════════════════════════════════════════════
import { fechaHoraMx } from '@/lib/formato';
import { cifrasRespaldadas, extraerNumeros } from '@/lib/agents/analista';
import type { AdjuntoRef, Clasificacion, Intencion, Riesgo } from './tipos';
import type { EstatusViaje, ResumenViaje, TipoHitoViaje } from './estatus_viaje';

export type ViajeParaRedactar =
  | { tipo: 'uno'; estatus: EstatusViaje }
  | { tipo: 'ambiguo'; viajes: ResumenViaje[] }
  | { tipo: 'ninguno' }
  | { tipo: 'folio_no_encontrado' };

export interface EntradaRedaccion {
  clasificacion: Pick<Clasificacion, 'intencion' | 'secundarias' | 'senales'>;
  nombreContacto: string | null;
  nombreFlota: string;
  viaje: ViajeParaRedactar;
  ahora: Date;
  /** Primer mensaje que se le manda a este contacto: lleva el aviso de privacidad y cómo darse de baja. */
  primerContacto: boolean;
  avisoPrivacidadUrl: string | null;
}

export interface Borrador {
  texto: string;
  /** Datos que el cliente pidió y NO existen. No vacío = hay que escalar. */
  faltantes: string[];
  /** Cosas que una PERSONA tiene que hacer aunque el texto sea correcto (p. ej. mandar el archivo de la factura). */
  tareas: string[];
  riesgo: Riesgo;
  /** Archivos que saldrán junto con el texto (si la ventana de 24 h lo permite). Por eso el borrador es de riesgo medio: lo aprueba una persona. */
  adjuntos: Array<AdjuntoRef['clave']>;
  /** Aunque el texto salga bien, este caso lo tiene que ver una persona. */
  requiereHumano: boolean;
  /** Los datos exactos con los que se escribió (para la bitácora y la auditoría). */
  respaldo: Record<string, unknown>;
  origen: 'plantilla' | 'modelo';
}

export const MAX_RESPUESTA = 700;

const ETAPAS: Record<EstatusViaje['etapa'], string> = {
  en_curso: 'está en curso; el operador todavía no reporta su llegada a destino',
  en_origen: 'el operador reportó que llegó a cargar',
  en_ruta: 'la unidad salió de la carga y va en camino al destino',
  en_destino: 'el operador reportó que llegó a destino',
  descargando: 'el operador reportó que está descargando',
  entregado: 'el operador reportó que terminó de descargar',
  regresando: 'ya se entregó y la unidad va de regreso',
  cerrado: 'el viaje ya está cerrado',
};

const HITOS: Record<TipoHitoViaje, string> = {
  llegada: 'llegada a destino', descarga: 'inicio de descarga', regreso: 'salida de regreso',
  llegada_carga: 'llegada a cargar', salida_carga: 'salida de la carga',
  llegada_descarga: 'llegada a destino', salida_descarga: 'fin de la descarga',
};

/** Texto de WhatsApp que viaja en una plantilla: sin saltos, sin tabuladores, sin 4 espacios seguidos. */
export function aLineaPlantilla(texto: string, tope = 300): string {
  const t = texto.replace(/[\r\n\t]+/g, ' | ').replace(/ {2,}/g, ' ').replace(/ \| (\| )+/g, ' | ').trim();
  return t.length > tope ? `${t.slice(0, tope - 1)}…` : t;
}

function etiquetaViaje(e: Pick<EstatusViaje, 'folio' | 'origen' | 'destino'>): string {
  const ruta = e.origen && e.destino ? ` (${e.origen} → ${e.destino})` : '';
  return e.folio ? `Tu viaje ${e.folio}${ruta}` : `Tu viaje${ruta}`;
}

function minutosDesde(iso: string, ahora: Date): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((ahora.getTime() - t) / 60_000));
}

/** «hace 12 min» / «hace 3 h» — ambos números salen de la medición del GPS. */
function haceCuanto(min: number): string {
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
}

function seccionUbicacion(e: EstatusViaje, ahora: Date, faltantes: string[], respaldo: Record<string, unknown>): string {
  const partes: string[] = [`${etiquetaViaje(e)}: ${ETAPAS[e.etapa]}.`];
  if (e.ultimoHito) {
    // La hora es la del reporte del operador (o de la oficina), no una medición del GPS: se dice así.
    partes.push(`Último registro del operador: ${HITOS[e.ultimoHito.tipo]} el ${fechaHoraMx(e.ultimoHito.en)}.`);
    respaldo.ultimoHito = e.ultimoHito;
  }
  if (e.enAnden) {
    const donde = e.enAnden.lugar === 'carga' ? 'la carga' : 'la descarga';
    partes.push(e.enAnden.desde ? `Sigue en ${donde} desde las ${fechaHoraMx(e.enAnden.desde)}.` : `Sigue en ${donde}.`);
    respaldo.enAnden = e.enAnden;
  }
  if (e.posicion) {
    const min = minutosDesde(e.posicion.medidaEn, ahora);
    const liga = `https://maps.google.com/?q=${e.posicion.lat.toFixed(5)},${e.posicion.lng.toFixed(5)}`;
    respaldo.posicion = e.posicion;
    if (min === null) {
      faltantes.push('posicion_sin_hora');
      partes.push('Tengo una posición de la unidad pero no su hora de medición, así que no la comparto.');
    } else if (min > 120) {
      partes.push(`La última posición del GPS es ${haceCuanto(min)}, no es actual: ${liga}`);
    } else {
      partes.push(`Última posición del GPS (${haceCuanto(min)}): ${liga}`);
    }
  } else {
    faltantes.push('posicion');
    partes.push('Todavía no tengo posición GPS de la unidad.');
  }
  return partes.join(' ');
}

function seccionEta(e: EstatusViaje, faltantes: string[], respaldo: Record<string, unknown>): string {
  if (e.etaIso) {
    respaldo.eta = e.etaIso;
    respaldo.etaFuente = e.etaFuente;
    // La fuente se dice: una cita es lo pactado; una ETA es lo que tu ejecutivo capturó. Ninguna es telemetría de la unidad.
    const cuando = fechaHoraMx(e.etaIso);
    const cabeza = e.etaFuente === 'cita'
      ? `La cita de llegada a destino de ${e.folio ?? 'tu viaje'} es el ${cuando}.`
      : `Hora estimada de llegada de ${e.folio ?? 'tu viaje'}: ${cuando}.`;
    const carga = e.citaCarga && e.etapa === 'en_curso' ? ` La cita de carga es el ${fechaHoraMx(e.citaCarga.en)}.` : '';
    if (carga) respaldo.citaCarga = e.citaCarga;
    return `${cabeza}${carga} Es la que tiene registrada tu ejecutivo, no una medición del GPS.`;
  }
  // Ya llegó a destino: no hay «hora estimada» por decir, y no falta ningún dato.
  if (e.etapa === 'en_destino' || e.etapa === 'descargando' || e.etapa === 'entregado' || e.etapa === 'regresando' || e.etapa === 'cerrado') {
    return `${etiquetaViaje(e)}: ${ETAPAS[e.etapa]}, así que ya no hay hora estimada de llegada por decir.`;
  }
  faltantes.push('eta');
  return `Todavía no tengo registrada una hora estimada de llegada${e.folio ? ` para ${e.folio}` : ''}. La consulto con tu ejecutivo y te confirmo.`;
}

function seccionDocumentos(e: EstatusViaje, faltantes: string[], respaldo: Record<string, unknown>): string {
  if (e.documentos === null) {
    faltantes.push('documentos');
    return 'No pude verificar ahora qué documentos tiene pendientes tu viaje. Lo consulto con tu ejecutivo y te confirmo.';
  }
  respaldo.documentos = e.documentos;
  const pendientes = e.documentos.filter((d) => d.estado === 'pendiente').map((d) => d.nombre);
  if (e.documentos.length === 0) {
    faltantes.push('documentos');
    return 'No tengo documentos registrados para este viaje todavía. Lo consulto con tu ejecutivo.';
  }
  if (pendientes.length === 0) return 'Con lo que tengo registrado, no hay documentos pendientes en este viaje.';
  return `Documentos pendientes del viaje: ${pendientes.join(', ')}.`;
}

function seccionFacturaPod(
  e: EstatusViaje, faltantes: string[], tareas: string[], respaldo: Record<string, unknown>, adjuntos: Array<AdjuntoRef['clave']>,
): string {
  const partes: string[] = [];
  if (e.podRecibido === null) {
    faltantes.push('pod');
    partes.push('No pude verificar ahora el comprobante de entrega.');
  } else {
    respaldo.podRecibido = e.podRecibido;
    partes.push(e.podRecibido ? 'El comprobante de entrega (POD) ya está recibido.' : 'El comprobante de entrega (POD) todavía no está recibido.');
  }
  if (e.facturaEmitida === null) {
    faltantes.push('factura');
    partes.push('No pude verificar ahora el estado de la factura.');
  } else {
    respaldo.facturaEmitida = e.facturaEmitida;
    partes.push(e.facturaEmitida ? 'La factura de este viaje ya está emitida.' : 'La factura de este viaje todavía no está emitida.');
  }
  const hayPod = e.adjuntos.some((a) => a.clave === 'pod');
  if (hayPod) {
    // El archivo sale como adjunto SI la ventana de 24 h lo permite; el texto es verdad en los dos casos.
    adjuntos.push('pod');
    partes.push('Si necesitas el archivo y no te llega por aquí, tu ejecutivo te lo hace llegar.');
  } else {
    partes.push('Si necesitas el archivo, tu ejecutivo te lo hace llegar.');
    // Sin archivo que adjuntar, lo entrega una persona: queda una tarea para el gerente.
    tareas.push('entrega_de_archivo');
  }
  return partes.join(' ');
}

const SALUDA = (nombre: string | null) => (nombre ? `Hola ${nombre.split(/\s+/)[0]}` : 'Hola');

function pieDePrimerContacto(nombreFlota: string, url: string | null): string {
  return `\n\nTus mensajes se atienden con apoyo de un asistente automatizado de ${nombreFlota}.${url ? ` Aviso de privacidad: ${url}.` : ''} Para dejar de recibir mensajes escribe BAJA.`;
}

const DATO: readonly Intencion[] = ['ubicacion', 'eta', 'documentos', 'factura_pod'];

/**
 * Arma el borrador determinista. PURA: mismos datos, mismo texto.
 */
export function redactarBorrador(e: EntradaRedaccion): Borrador {
  const { intencion } = e.clasificacion;
  const faltantes: string[] = [];
  const tareas: string[] = [];
  const adjuntos: Array<AdjuntoRef['clave']> = [];
  const respaldo: Record<string, unknown> = { intencion };
  const saludo = SALUDA(e.nombreContacto);
  let cuerpo: string;
  let riesgo: Riesgo = 'bajo';
  let requiereHumano = false;

  const pie = e.primerContacto ? pieDePrimerContacto(e.nombreFlota, e.avisoPrivacidadUrl) : '';

  if (intencion === 'queja' || intencion === 'pide_humano') {
    cuerpo = intencion === 'queja'
      ? `${saludo}, lamento la molestia. Ya avisé a tu ejecutivo en ${e.nombreFlota} para que te atienda personalmente.`
      : `${saludo}, claro. Ya avisé a tu ejecutivo en ${e.nombreFlota} para que se comunique contigo.`;
    riesgo = 'alto'; requiereHumano = true;
  } else if (intencion === 'saludo') {
    cuerpo = `${saludo}, soy el asistente de ${e.nombreFlota}. Puedo decirte dónde va tu viaje, qué documentos tiene pendientes o el estado de tu factura. ¿Qué necesitas?`;
  } else if (!DATO.includes(intencion)) {
    // «otro»: no se entendió. Nada que consultar; una persona decide.
    cuerpo = `${saludo}, gracias por escribir. No logré entender tu mensaje con certeza, así que lo paso a tu ejecutivo en ${e.nombreFlota} para que te responda.`;
    riesgo = 'medio'; requiereHumano = true; faltantes.push('intencion');
  } else if (e.viaje.tipo === 'ambiguo') {
    const lista = e.viaje.viajes.map((v) => v.folio ?? 'sin folio').join(', ');
    respaldo.viajes = e.viaje.viajes.map((v) => v.folio);
    cuerpo = `${saludo}, tienes varios viajes en curso con nosotros: ${lista}. ¿De cuál quieres saber?`;
    riesgo = 'medio';
  } else if (e.viaje.tipo === 'ninguno') {
    cuerpo = `${saludo}, no encuentro un viaje en curso a tu nombre. Le pido a tu ejecutivo en ${e.nombreFlota} que lo revise y te confirme.`;
    riesgo = 'medio'; requiereHumano = true; faltantes.push('viaje');
  } else if (e.viaje.tipo === 'folio_no_encontrado') {
    // NO se dice si el folio existe en otro lado: ni confirmar ni negar lo ajeno.
    cuerpo = `${saludo}, no encuentro ese folio entre tus viajes en curso. Si me confirmas el folio o la ruta, lo reviso; también aviso a tu ejecutivo.`;
    riesgo = 'medio'; requiereHumano = true; faltantes.push('folio');
  } else {
    const estatus = e.viaje.estatus;
    respaldo.viajeId = estatus.viajeId;
    respaldo.folio = estatus.folio;
    const secciones: string[] = [];
    for (const i of [intencion, ...e.clasificacion.secundarias]) {
      if (i === 'ubicacion') secciones.push(seccionUbicacion(estatus, e.ahora, faltantes, respaldo));
      else if (i === 'eta') secciones.push(seccionEta(estatus, faltantes, respaldo));
      else if (i === 'documentos') secciones.push(seccionDocumentos(estatus, faltantes, respaldo));
      else if (i === 'factura_pod') secciones.push(seccionFacturaPod(estatus, faltantes, tareas, respaldo, adjuntos));
    }
    // El ETA usa la etapa como contexto cuando no hay sección de ubicación.
    if (!secciones.some((s) => s.startsWith(etiquetaViaje(estatus))) && intencion === 'eta') {
      secciones.unshift(`${etiquetaViaje(estatus)}: ${ETAPAS[estatus.etapa]}.`);
    }
    cuerpo = `${saludo}. ${secciones.join('\n\n')}`;
    // Lo que falta, o lo que una persona debe entregar, baja de «bajo»: no sale sin aprobación.
    if (faltantes.length > 0 || tareas.length > 0 || adjuntos.length > 0) riesgo = 'medio';
    // Lo que se guarda para el envío: el archivo se busca por (flota, cliente, viaje), nunca por una ruta del respaldo.
    if (adjuntos.length > 0) respaldo.adjuntos = adjuntos;
  }

  // El riesgo también sube por lo que el cliente intentó (la política lo repite: defensa en capas).
  if (e.clasificacion.senales.includes('inyeccion')) riesgo = 'alto';

  let texto = `${cuerpo}${pie}`;
  if (texto.length > MAX_RESPUESTA + pie.length) texto = `${texto.slice(0, MAX_RESPUESTA + pie.length - 1)}…`;
  return { texto, faltantes, tareas, riesgo, adjuntos, requiereHumano, respaldo, origen: 'plantilla' };
}

// ── PULIR CON MODELO: opcional, y guardado ───────────────────────────────────

export interface PuertoPulir {
  /** Devuelve el texto reescrito o `null`. Puede lanzar. */
  pulir(borrador: string, ctx: { tenantId: string }): Promise<string | null>;
}

const LIGA = /https?:\/\/[^\s)]+/g;

export interface ResultadoGuardia { ok: boolean; motivo: string | null }

/**
 * La guardia anti-invención del texto pulido. PURA.
 *   · cifras: todas las del texto salen del borrador o del mensaje del cliente;
 *   · ligas/correos: ninguna que el borrador no traiga;
 *   · folio conservado; · largo acotado; · no vacío.
 */
export function guardiaDePulido(pulido: string, borrador: Borrador, mensajeCliente: string, folio: string | null): ResultadoGuardia {
  const t = pulido.trim();
  if (!t) return { ok: false, motivo: 'vacio' };
  if (t.length > MAX_RESPUESTA * 1.3) return { ok: false, motivo: 'muy_largo' };

  const respaldo = new Set<number>();
  extraerNumeros(borrador.texto, respaldo);
  extraerNumeros(mensajeCliente, respaldo);
  extraerNumeros(borrador.respaldo, respaldo);
  if (!cifrasRespaldadas([{ tipo: 'texto', texto: t }], respaldo)) return { ok: false, motivo: 'cifra_sin_respaldo' };

  const ligasBorrador = new Set(borrador.texto.match(LIGA) ?? []);
  for (const l of t.match(LIGA) ?? []) {
    if (!ligasBorrador.has(l.replace(/[.,;]+$/, '')) && !ligasBorrador.has(l)) return { ok: false, motivo: 'liga_nueva' };
  }
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(t) && !/[\w.+-]+@[\w-]+\.[\w.-]+/.test(borrador.texto)) return { ok: false, motivo: 'correo_nuevo' };
  if (folio && !t.toUpperCase().includes(folio.toUpperCase()) && borrador.texto.toUpperCase().includes(folio.toUpperCase())) {
    return { ok: false, motivo: 'folio_perdido' };
  }
  return { ok: true, motivo: null };
}

/** Pule el borrador con el modelo SI pasa la guardia; si no, devuelve el original. Nunca lanza. */
export async function pulirBorrador(
  borrador: Borrador, mensajeCliente: string, folio: string | null, modelo: PuertoPulir | null | undefined, tenantId: string = '',
): Promise<{ borrador: Borrador; motivoDescartado: string | null }> {
  // Un borrador que pide humano, trae faltantes o responde una queja no se «embellece»: se manda como está.
  if (!modelo || !tenantId || borrador.requiereHumano || borrador.riesgo === 'alto') return { borrador, motivoDescartado: null };
  let pulido: string | null;
  try {
    pulido = await modelo.pulir(borrador.texto, { tenantId });
  } catch {
    return { borrador, motivoDescartado: 'modelo_caido' };
  }
  if (pulido === null) return { borrador, motivoDescartado: 'modelo_sin_respuesta' };
  const g = guardiaDePulido(pulido, borrador, mensajeCliente, folio);
  if (!g.ok) return { borrador, motivoDescartado: g.motivo };
  return { borrador: { ...borrador, texto: pulido.trim(), origen: 'modelo' }, motivoDescartado: null };
}
