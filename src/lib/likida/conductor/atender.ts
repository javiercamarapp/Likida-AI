import { logger } from '@/lib/logger';
import { enviarSolicitudUbicacion } from '@/lib/meta/client';
import type { ConfigConductor } from './config';
import { interpretarBoton, interpretarTexto, pareceHablarDeHito, type Intencion, type Interpretacion } from './interprete';
import { interpretarConLlm } from './llm';
import { decidir, hitoActivo, type Decision } from './maquina';
import { mensajeParaChofer, type ContextoMensaje, type Salida } from './mensajes';
import {
  adjuntarUbicacion, asegurarHitos, cargarHitos, guardarContacto, leerConfigConductor, marcarEscalacionAtendida, marcarSinContacto,
  posponerHito, registrarEvento, registrarHito, retirarHitos, sincronizarLegado, viajeDelOperador,
  type ResultadoEscritura, type ViajeContexto,
} from './repo';
import { tenantDelViaje } from './trabajo';
import { leerBotonConductor, PREFIJO_BOTON, type HitoFila, type FuenteHito, type TipoEvidencia, type TipoHito } from './tipos';
import { escalarPorProblema, puertosReales } from './ejecutor';
import { avisarOficinaDeHito } from './avisos_oficina';
import { puedeAcusar } from './escalamiento';
import { debeSellarTrasValidar, depsValidacionReales, validarHitoContraSitio, type EntradaValidarHito, type SalidaValidar } from './validar_hito';
import { guardarEvidencia, hitoLlegadaReciente } from './repo_validacion';
import { ETIQUETA_EVIDENCIA, hitoParaEvidencia, mensajeEvidencia, tipoEvidenciaDeCaption } from './evidencia';
import { textoVeredicto, veredictoSellaLlegada } from './validacion';

// ═══════════════════════════════════════════════════════════════════════════
// LA ENTRADA DEL CONDUCTOR EN EL PROCESSOR — del mensaje al hito registrado.
//
//   texto o botón del chofer → intención (reglas; LLM solo de respaldo) →
//   máquina de estados (decide) → UPDATEs condicionales (aplica) → acuse.
//
// Devuelve `null` si el mensaje NO es de este módulo (sigue su camino al agente de
// siempre); `{ mensajes: [] }` si lo atendió sin nada que decir.
//
// ── EL REGISTRO REACTIVO NO DEPENDE DE QUE EL AGENTE ESTÉ ACTIVO ────────────
// Un «ya llegué» se registra siempre (es lo que el producto hacía desde la 0090);
// `agente_conductor_config.activo = false` apaga lo PROACTIVO (el cron que pide,
// persigue y escala), no el oído.
//
// Las dependencias entran por `DepsAtender`: las pruebas las sustituyen por una
// base en memoria y el processor usa las reales.
// ═══════════════════════════════════════════════════════════════════════════

export interface DepsAtender {
  viajeDelOperador(tenantId: string, operadorId: string, viajeId: string): Promise<ViajeContexto | null>;
  config(tenantId: string): Promise<ConfigConductor>;
  asegurarHitos(tenantId: string, viajeId: string): Promise<HitoFila[]>;
  registrarHito: typeof registrarHito;
  sincronizarLegado: typeof sincronizarLegado;
  guardarContacto: typeof guardarContacto;
  marcarSinContacto: typeof marcarSinContacto;
  posponerHito: typeof posponerHito;
  retirarHitos: typeof retirarHitos;
  evento: typeof registrarEvento;
  llm: typeof interpretarConLlm;
  avisarOficina: typeof avisarOficinaDeHito;
  escalarPorProblema(v: ViajeContexto, h: HitoFila, hs: HitoFila[], ahora: Date): ReturnType<typeof escalarPorProblema>;
  solicitarUbicacion(telefono: string, cuerpo: string): Promise<boolean>;
  /** 0385: compara una llegada contra el sitio del viaje (pin o GPS). Nunca lanza. */
  validarHito(e: EntradaValidarHito): Promise<SalidaValidar | null>;
  hitoLlegadaReciente: typeof hitoLlegadaReciente;
  adjuntarUbicacion: typeof adjuntarUbicacion;
  cargarHitos(tenantId: string, viajeId: string): Promise<HitoFila[]>;
  guardarEvidencia: typeof guardarEvidencia;
}

export const depsReales: DepsAtender = {
  viajeDelOperador,
  config: leerConfigConductor,
  asegurarHitos,
  registrarHito,
  sincronizarLegado,
  guardarContacto,
  marcarSinContacto,
  posponerHito,
  retirarHitos,
  evento: registrarEvento,
  llm: interpretarConLlm,
  avisarOficina: avisarOficinaDeHito,
  escalarPorProblema: (v, h, hs, ahora) => escalarPorProblema(puertosReales(), v, h, hs, ahora),
  solicitarUbicacion: async (telefono, cuerpo) => (await enviarSolicitudUbicacion(telefono, cuerpo)).ok,
  validarHito: (e) => validarHitoContraSitio(depsValidacionReales, e),
  hitoLlegadaReciente,
  adjuntarUbicacion,
  cargarHitos,
  guardarEvidencia,
};

export interface EntradaAtender {
  tenantId: string;
  operadorId: string;
  telefono: string;
  /** El viaje abierto del chofer (el de «ya llegué» a secas). */
  viajeAbiertoId: string | null;
  texto: string;
  /** La hora del MENSAJE según Meta; sin ella se usa el reloj local. */
  mensajeEn?: Date | null;
  ahora?: Date;
  waMessageId?: string | null;
  senal?: AbortSignal;
}

export interface SalidaAtender {
  mensajes: Salida[];
  /**
   * 0385: el texto de la solicitud de ubicación que el processor manda DESPUÉS del acuse (si se manda antes,
   * le llega al chofer primero la pregunta y luego la confirmación). Solo viene cuando la llegada quedó
   * «sin ubicación» y el viaje tiene un sitio con qué compararla.
   */
  solicitarUbicacion?: string;
}

export const TEXTO_PEDIR_UBICACION =
  '📍 Para dejar tu llegada confirmada, toca el botón y comparte tu ubicación. Solo se usa para comprobar que estás en el sitio del viaje.';

const FALLO: Salida = { texto: 'No pude anotarlo ahorita — mándamelo de nuevo en un momento. 🙏' };

export async function atenderConductor(e: EntradaAtender, deps: DepsAtender = depsReales): Promise<SalidaAtender | null> {
  const ahora = e.ahora ?? new Date();
  const boton = interpretarBoton(e.texto);
  let interp: Interpretacion | null = boton;
  if (!interp) interp = interpretarTexto(e.texto);

  // ¿Es de este módulo? Los botones siempre; el texto, solo si las reglas lo entienden
  // o PARECE hablar de un hito (y entonces decide el respaldo con modelo).
  // Los payloads de OTROS botones nuestros (el «Ya lo atiendo» del jefe) no son de este módulo
  // aunque parezcan hablar de un hito: ni se interpretan ni pagan una llamada al modelo.
  if (!boton && leerBotonConductor(e.texto)) return null;
  const llevaViaje = boton?.viajeId ?? e.viajeAbiertoId;
  if (!llevaViaje) return null;
  if (!interp && !pareceHablarDeHito(e.texto)) return null;

  try {
    const viaje = await deps.viajeDelOperador(e.tenantId, e.operadorId, llevaViaje);
    if (!viaje) {
      // Un payload de otro viaje (o inventado a mano): nunca toca datos ajenos.
      if (boton) return { mensajes: [{ texto: 'Ese botón es de otro viaje o ya no está vigente. 🙏' }] };
      return null;
    }
    if (viaje.estatus === 'liquidado') {
      if (boton) return { mensajes: [{ texto: 'Ese viaje ya está cerrado. 👍' }] };
      return null;
    }

    const config = await deps.config(e.tenantId);
    const hitos = await deps.asegurarHitos(e.tenantId, viaje.id);

    if (!interp) {
      if (!config.usarLlm) return null;
      interp = await deps.llm({ tenantId: e.tenantId, texto: e.texto, hitos, senal: e.senal });
      if (!interp) return null; // el modelo tampoco lo entendió: sigue al agente
    }

    const ctx: ContextoMensaje = { viajeId: viaje.id, folio: viaje.folio, origen: viaje.origen, destino: viaje.destino };
    const mensajeEn = e.mensajeEn && !Number.isNaN(e.mensajeEn.getTime()) ? e.mensajeEn : ahora;

    // ── Lo que NO cambia hitos ─────────────────────────────────────────────
    if (interp.intencion.clase === 'pedir_ubicacion') {
      const ok = await deps.solicitarUbicacion(e.telefono, '📍 Toca el botón para compartir tu ubicación y la anoto en tu viaje.');
      return { mensajes: ok ? [] : [{ texto: 'No pude abrir la ubicación. Mándame tu pin desde el clip 📎 → Ubicación. 🙏' }] };
    }
    if (interp.intencion.clase === 'problema') {
      const activo = hitoActivo(hitos);
      if (!activo) return { mensajes: [{ texto: 'Ya tengo todos los avisos de este viaje. Si tienes un problema, avísale directo a tu jefe de tráfico. 🙏' }] };
      const r = await deps.escalarPorProblema(viaje, activo, hitos, ahora);
      return {
        mensajes: [{
          texto: r === 'ok' || r === 'perdido'
            ? 'Gracias por avisar. Ya le avisé a tu jefe de tráfico para que te contacte. 🙏'
            : 'No pude avisarle a tu jefe por WhatsApp ahorita. Si es urgente, márcale directo. 🙏',
        }],
      };
    }

    const decision = decidir({
      hitos, intencion: interp.intencion, contacto: interp.contacto, ahora, mensajeEn,
      ventanaCorreccionMin: config.ventanaCorreccionMin, posponerMin: config.posponerMin,
    });

    const fuente: FuenteHito = boton ? 'boton' : 'texto';
    const efectos = { pedirUbicacion: false };
    const aplicado = await aplicar(decision, { deps, e, viaje, hitos, interp, fuente, ahora, mensajeEn, config, efectos });
    logger.info('hito.conductor', {
      viaje: viaje.id, accion: decision.accion, via: interp.via, aplicado,
      objetivo: 'objetivo' in decision ? decision.objetivo : null,
    });

    const salida = mensajeParaChofer(decision, ctx, ahora, aplicado);
    const pedir = efectos.pedirUbicacion ? { solicitarUbicacion: TEXTO_PEDIR_UBICACION } : {};
    // Con la confirmación apagada, el hito registrado queda en silencio (todo lo demás sí se contesta).
    if (!config.confirmarAlChofer && decision.accion === 'registrar' && aplicado === 'ok') return { mensajes: [], ...pedir };
    if (config.pedirFotoEvidencia && decision.accion === 'registrar' && aplicado === 'ok') {
      const invitacion = invitacionFoto(decision.objetivo);
      if (invitacion) salida.texto = `${salida.texto}\n${invitacion}`;
    }
    return { mensajes: [salida], ...pedir };
  } catch (err) {
    // Fail-closed: no se finge una anotación. Pero tampoco se rompe el turno entero.
    logger.error('hito.conductor_fallo', { viaje: llevaViaje, err: err instanceof Error ? err.message : String(err) });
    return { mensajes: [FALLO] };
  }
}

interface ContextoAplicar {
  deps: DepsAtender;
  e: EntradaAtender;
  viaje: ViajeContexto;
  hitos: HitoFila[];
  interp: Interpretacion;
  fuente: FuenteHito;
  ahora: Date;
  mensajeEn: Date;
  config: ConfigConductor;
  /** Lo que `aplicar` descubre y el llamador necesita después del acuse. */
  efectos: { pedirUbicacion: boolean };
}

/** La invitación (opcional, por flota) a mandar la foto de evidencia del hito recién registrado. */
function invitacionFoto(tipo: HitoFila['tipo']): string | null {
  switch (tipo) {
    case 'salida_carga': return '📷 Si puedes, manda la foto del sello y escribe «sello» en el pie de la foto.';
    case 'llegada_carga':
    case 'llegada_descarga': return '📷 Si puedes, manda una foto del andén y escribe «andén» en el pie de la foto.';
    case 'salida_descarga': return '📷 Si puedes, manda la foto del sello de recibido y escribe «recibido» en el pie de la foto.';
    default: return null;
  }
}

const hitoDe = (hs: readonly HitoFila[], tipo: HitoFila['tipo']): HitoFila => {
  const h = hs.find((x) => x.tipo === tipo);
  if (!h) throw new Error(`falta el hito ${tipo}`);
  return h;
};

/** Aplica la decisión con escrituras condicionales. Devuelve cómo salió. */
async function aplicar(d: Decision, c: ContextoAplicar): Promise<'ok' | 'carrera' | 'fallo'> {
  const { deps, viaje, hitos, ahora } = c;
  const resultado = (r: ResultadoEscritura) => r;

  switch (d.accion) {
    case 'registrar': {
      const objetivo = hitoDe(hitos, d.objetivo);
      const r = resultado(await deps.registrarHito({
        hito: objetivo, fuente: c.fuente, interpretacion: c.interp.via, confianza: c.interp.confianza,
        waMessageId: c.e.waMessageId ?? null, mensajeEn: d.mensajeEn, ahora,
        texto: c.fuente === 'boton' || c.fuente === 'foto' ? null : c.e.texto, contacto: d.contacto,
        omitir: d.omitir.map((t) => hitoDe(hitos, t)),
      }));
      if (r !== 'ok') return r;
      // `viaje.llegada_en` (la llegada al DESTINO) no se sella con un «ya llegué» a secas: espera a que la ubicación lo respalde
      // (más abajo, tras validar) o lo difiere al barrido y al pin. Los otros sellos de la 0090 no dependen de la ubicación.
      const difiereLlegada = d.legado.includes('llegada') && c.config.validarUbicacion;
      await deps.sincronizarLegado(viaje.tenantId, viaje.id, difiereLlegada ? d.legado.filter((l) => l !== 'llegada') : d.legado, d.mensajeEn);
      await deps.evento(objetivo, 'recibido', { fuente: c.fuente, via: c.interp.via, ambigua: d.ambigua, tarde: d.reabre, hora_ajustada: d.ajustadaPorFuturo });
      for (const t of d.omitir) await deps.evento(hitoDe(hitos, t), 'omitido', { por: d.objetivo });
      if (d.contacto) await deps.evento(objetivo, 'contacto', {});
      // 0385: la llegada se compara contra el sitio del viaje (GPS cercano a la hora del mensaje). Best-effort:
      // `validarHito` nunca lanza y el acuse no espera más de lo que cuestan dos consultas.
      const registrado: HitoFila = { ...objetivo, estado: 'recibido', mensajeEn: d.mensajeEn.toISOString(), recibidoEn: ahora.toISOString() };
      const v = await deps.validarHito({ viaje, hito: registrado, config: c.config, mensajeEn: d.mensajeEn, ahora });
      if (v?.pedirUbicacion) c.efectos.pedirUbicacion = true;
      if (difiereLlegada && veredictoSellaLlegada(v?.veredicto ?? null, true)) await deps.sincronizarLegado(viaje.tenantId, viaje.id, ['llegada'], d.mensajeEn);
      // El aviso a la oficina es best-effort y no retrasa el acuse más de lo que cuesta un envío.
      const esLlegada = d.objetivo === 'llegada_carga' || d.objetivo === 'llegada_descarga';
      if (esLlegada ? c.config.avisarOficinaLlegada : c.config.avisarOficinaSalida) {
        await deps.avisarOficina({ viaje, hito: { ...objetivo, estado: 'recibido' }, mensajeEn: d.mensajeEn, contacto: d.contacto, ahora });
      }
      return 'ok';
    }
    case 'duplicado': {
      // Repetir un hito no mueve su hora; sí puede completar el contacto o el sello de la 0090.
      await deps.sincronizarLegado(viaje.tenantId, viaje.id, d.legado, c.mensajeEn);
      const h = hitoDe(hitos, d.objetivo);
      if (d.contacto && (h.estado === 'recibido' || h.estado === 'validado')) {
        const r = await deps.guardarContacto(h, d.contacto, ahora);
        if (r === 'ok') await deps.evento(h, 'contacto', {});
      }
      return 'ok';
    }
    case 'contacto': {
      const h = hitoDe(hitos, d.objetivo);
      const r = await deps.guardarContacto(h, d.contacto, ahora);
      if (r === 'ok') await deps.evento(h, 'contacto', {});
      return r;
    }
    case 'sin_contacto':
      return deps.marcarSinContacto(hitoDe(hitos, d.objetivo), ahora);
    case 'posponer': {
      await deps.sincronizarLegado(viaje.tenantId, viaje.id, d.legado, c.mensajeEn);
      if (!d.aplicado) return 'ok';
      const h = hitoDe(hitos, d.objetivo);
      const r = await deps.posponerHito(h, d.minutos, ahora);
      if (r === 'ok') await deps.evento(h, 'pospuesto', { minutos: d.minutos });
      return r;
    }
    case 'corregir': {
      const objetivo = hitoDe(hitos, d.objetivo);
      const r = await deps.retirarHitos(d.revertir.map((t) => hitoDe(hitos, t)), d.objetivo, ahora, d.despues ? null : c.config.posponerMin);
      if (r !== 'ok') return r;
      await deps.evento(objetivo, 'corregido', { revertidos: d.revertir.length });
      if (d.despues) {
        // Tras retirar, el mundo cambió: se recarga y se vuelve a decidir lo pedido («Es en descarga»).
        const frescos = await deps.asegurarHitos(viaje.tenantId, viaje.id);
        const otra = d.despues.accion === 'registrar'
          ? decidir({
            hitos: frescos, intencion: { clase: 'llegada', lugar: lugarDeObjetivo(d.despues.objetivo) }, contacto: null, ahora, mensajeEn: c.mensajeEn,
            ventanaCorreccionMin: c.config.ventanaCorreccionMin, posponerMin: c.config.posponerMin,
          })
          : d.despues;
        return aplicar(otra, { ...c, hitos: frescos });
      }
      return 'ok';
    }
    case 'aclarar':
    case 'rechazar':
      return 'ok';
  }
}

function lugarDeObjetivo(t: HitoFila['tipo']): 'carga' | 'descarga' | null {
  if (t === 'llegada_carga') return 'carga';
  if (t === 'llegada_descarga') return 'descarga';
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// «YA LO ATIENDO» — el acuse del jefe o del patio a una escalación.
// ═══════════════════════════════════════════════════════════════════════════

export interface DepsAcuse {
  viajePorId(viajeId: string): Promise<{ tenantId: string } | null>;
  puedeAcusar(tenantId: string, telefono: string): Promise<boolean>;
  marcar(tenantId: string, viajeId: string, ahora: Date): Promise<HitoFila[]>;
  evento: typeof registrarEvento;
}

const depsAcuseReales: DepsAcuse = {
  // El tenant sale del VIAJE del payload; después `puedeAcusar` exige que el teléfono sea de ESA
  // flota (contacto de tráfico o cuenta de oficina).
  viajePorId: async (id) => {
    const tenantId = await tenantDelViaje(id);
    return tenantId ? { tenantId } : null;
  },
  puedeAcusar,
  marcar: marcarEscalacionAtendida,
  evento: registrarEvento,
};

/** `null` = el texto no es un acuse de escalación. Un número ajeno NO puede acusar viajes de otra flota. */
export async function atenderAcuseJefe(
  telefono: string, texto: string, ahora: Date = new Date(), deps: DepsAcuse = depsAcuseReales,
): Promise<string | null> {
  const b = leerBotonConductor(texto);
  if (!b || b.prefijo !== PREFIJO_BOTON.jefeAtiendo) return null;
  try {
    const v = await deps.viajePorId(b.viajeId);
    // Misma respuesta para «no existe» y «no es tuyo»: no se confirma qué viajes hay.
    if (!v || !(await deps.puedeAcusar(v.tenantId, telefono))) return 'No tengo ese aviso asignado a este número.';
    const marcados = await deps.marcar(v.tenantId, b.viajeId, ahora);
    for (const h of marcados) await deps.evento(h, 'atendido', {});
    return marcados.length > 0
      ? 'Anotado ✅ lo marqué como atendido; ya no insisto por este viaje.'
      : 'Ya estaba atendido o el chofer ya respondió. 👍';
  } catch (err) {
    logger.error('conductor.acuse_fallo', { err: err instanceof Error ? err.message : String(err) });
    return 'No pude anotarlo ahorita. Intenta de nuevo en un momento. 🙏';
  }
}

/**
 * El pin del chofer se adjunta como evidencia al hito que acaba de registrar
 * (≤ 30 min). Best-effort y mudo: la respuesta del pin sigue siendo la de siempre.
 */
export async function adjuntarUbicacionAHito(
  tenantId: string, viajeId: string, lat: number, lng: number, ahora: Date = new Date(),
): Promise<boolean> {
  try {
    return (await adjuntarUbicacion(tenantId, viajeId, lat, lng, ahora)) !== null;
  } catch (err) {
    logger.warn('conductor.ubicacion_no_adjunta', { viaje: viajeId, err: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EL PIN DEL CHOFER — la evidencia más directa de que llegó (0385).
//
// El processor ya registra el pin como posición (`posicion`, proveedor `whatsapp`) y se lo
// avisa al jefe. Aquí, además: se adjunta a la llegada que el chofer acaba de reportar
// (≤ la ventana de la flota) y se compara contra el sitio del viaje. Devuelve la línea que
// se le AGREGA a la respuesta del pin, o `null` si no hay nada que decir.
//
// «Sin coincidencia» se le dice al chofer sin acusarlo: su aviso YA quedó anotado, la
// comparación solo ayuda a su jefe a ver si el sitio está bien capturado.
// ═══════════════════════════════════════════════════════════════════════════

export interface EntradaPin {
  tenantId: string;
  operadorId: string;
  viajeId: string;
  lat: number;
  lng: number;
  /** La hora del pin según Meta; sin ella, el reloj local. */
  enviadoEn?: Date | null;
  ahora?: Date;
}

export async function atenderPinConductor(e: EntradaPin, deps: DepsAtender = depsReales): Promise<string | null> {
  const ahora = e.ahora ?? new Date();
  try {
    const config = await deps.config(e.tenantId);
    if (!config.validarUbicacion) return null;
    const viaje = await deps.viajeDelOperador(e.tenantId, e.operadorId, e.viajeId);
    if (!viaje || viaje.estatus === 'liquidado') return null;
    const hito = await deps.hitoLlegadaReciente(e.tenantId, e.viajeId, ahora, Math.max(config.ventanaUbicacionMin, 30));
    if (!hito) return null;
    // Las coordenadas del pin quedan como evidencia del hito (lo hacía el processor; aquí SÍ se alcanza).
    await deps.adjuntarUbicacion(e.tenantId, e.viajeId, e.lat, e.lng, ahora);
    const medidaEn = e.enviadoEn && !Number.isNaN(e.enviadoEn.getTime()) ? e.enviadoEn : ahora;
    const mensajeEn = new Date(hito.mensajeEn ?? hito.recibidoEn ?? ahora);
    const v = await deps.validarHito({ viaje, hito, config, mensajeEn, pin: { lat: e.lat, lng: e.lng, medidaEn }, ahora });
    if (!v || v.aplicado === 'fallo' || v.aplicado === 'hito_cambio') return null;
    // El pin puede ser lo que por fin confirma la llegada a descargar que se difirió al registrarla.
    if (debeSellarTrasValidar(hito.tipo, v)) await deps.sincronizarLegado(e.tenantId, e.viajeId, ['llegada'], mensajeEn);
    const donde = v.sitioNombre ? `«${v.sitioNombre}»` : 'el sitio del viaje';
    const que = hito.tipo === 'llegada_carga' ? 'a cargar' : 'a descargar';
    switch (v.veredicto.resultado) {
      case 'validado': return `✅ Con tu ubicación quedó confirmada tu llegada ${que} en ${donde}.`;
      case 'sin_coincidencia':
        return `Tu aviso de llegada ${que} ya quedó anotado. Tu ubicación no cae en el punto registrado de ${donde} (a ${v.veredicto.distanciaM} m): si estás en otra entrada, no pasa nada, tu jefe de tráfico lo revisa.`;
      default: return null;
    }
  } catch (err) {
    logger.warn('conductor.pin_fallo', { viaje: e.viajeId, err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LA FOTO DE EVIDENCIA — sello, andén, sello de recibido (0385).
//
// El processor decide por el CAPTION qué papel es (`tipoEvidenciaDeCaption`) y, en dos pasos,
// pregunta a quién colgarla (`hitoParaEvidenciaDelChofer`) ANTES de descargar y subir el archivo
// —sin hito no hay a dónde colgarla y no se paga la descarga— y registra la ruta ya subida
// (`registrarEvidenciaDelChofer`). Mismo bucket y misma subida que el POD.
// ═══════════════════════════════════════════════════════════════════════════

export { tipoEvidenciaDeCaption };

export interface EntradaEvidenciaPrevia {
  tenantId: string;
  operadorId: string;
  viajeId: string;
  caption: string | undefined;
  ahora?: Date;
}

/**
 * Qué aviso es cada foto cuando no hay hito al cual colgarla (0483). El papel decide: el «andén» es estar en una parada
 * (la llegada; a cargar o a descargar lo dice lo que el viaje ya lleva, igual que un «ya llegué» a secas), el «sello» es
 * la carga terminada y sellada (la salida de la carga) y el «recibido» es la descarga recibida (la salida de la descarga).
 * `otra` nunca es un aviso.
 */
export function intencionDeFoto(tipo: TipoEvidencia): Intencion | null {
  switch (tipo) {
    case 'anden': return { clase: 'llegada', lugar: null };
    case 'sello': return { clase: 'salida', lugar: 'carga' };
    case 'recibido': return { clase: 'salida', lugar: 'descarga' };
    default: return null;
  }
}

export interface EvidenciaPrevia {
  tipo: TipoEvidencia;
  /** El hito al que se cuelga la foto (ya registrado). `null` = no hay. */
  hito: HitoFila | null;
  /**
   * 0483: no hay hito al cual colgarla, pero la foto PUEDE ser el aviso: este es el hito que registraría. El processor
   * descarga y sube la foto y llama a `registrarHitoDesdeFoto`; sin esto (flota que lo apagó, o aviso ambiguo) la foto
   * se queda en «primero dime ya llegué» como siempre.
   */
  comoHito?: TipoHito;
}

/** `null` = el caption no es de evidencia de hito. Si lo es: el hito destino (o `sin_hito`) y el tipo. */
export async function hitoParaEvidenciaDelChofer(
  e: EntradaEvidenciaPrevia, deps: DepsAtender = depsReales,
): Promise<EvidenciaPrevia | null> {
  const tipo = tipoEvidenciaDeCaption(e.caption);
  if (!tipo) return null;
  const ahora = e.ahora ?? new Date();
  try {
    // El viaje tiene que ser DE ESE chofer y de esa flota: la foto nunca se cuelga de un hito ajeno.
    const viaje = await deps.viajeDelOperador(e.tenantId, e.operadorId, e.viajeId);
    if (!viaje || viaje.estatus === 'liquidado') return { tipo, hito: null };
    const hitos = await deps.cargarHitos(e.tenantId, e.viajeId);
    // 0483: ¿la foto es el AVISO? Primero se mira esto (si la flota lo permite): un «sello» cuya salida de carga aún no está
    // registrada ES la salida, aunque la llegada sí lo esté; un «andén» solo cuando la máquina lo resuelve sin preguntar (con la
    // llegada a carga ya registrada y nada más es ambiguo y la foto se cuelga de esa parada, como siempre).
    const intencion = intencionDeFoto(tipo);
    const config = intencion ? await deps.config(e.tenantId) : null;
    if (intencion && config?.fotoRegistraHito) {
      const d = decidir({
        hitos, intencion, contacto: null, ahora, mensajeEn: ahora, ventanaCorreccionMin: config.ventanaCorreccionMin, posponerMin: config.posponerMin,
      });
      if (d.accion === 'registrar') return { tipo, hito: null, comoHito: d.objetivo };
    }
    return { tipo, hito: hitoParaEvidencia(tipo, hitos, ahora) };
  } catch (err) {
    logger.warn('conductor.evidencia_previa_fallo', { viaje: e.viajeId, err: err instanceof Error ? err.message : String(err) });
    return { tipo, hito: null };
  }
}

export interface EntradaEvidencia {
  tenantId: string;
  hito: HitoFila;
  tipo: TipoEvidencia;
  ruta: string;
  sha256: string;
  waMessageId?: string | null;
  ahora?: Date;
}

/** Registra la evidencia ya subida y devuelve el acuse para el chofer. */
export async function registrarEvidenciaDelChofer(e: EntradaEvidencia, deps: DepsAtender = depsReales): Promise<string> {
  const ahora = e.ahora ?? new Date();
  try {
    const r = await deps.guardarEvidencia({
      tenantId: e.tenantId, hito: e.hito, tipo: e.tipo, ruta: e.ruta, sha256: e.sha256, waMessageId: e.waMessageId ?? null, ahora,
    });
    if (r === 'ok') await deps.evento(e.hito, 'evidencia', { tipo: e.tipo });
    return mensajeEvidencia(r === 'hito_cambio' ? 'sin_hito' : r, e.tipo);
  } catch (err) {
    logger.error('conductor.evidencia_fallo', { hito: e.hito.id, err: err instanceof Error ? err.message : String(err) });
    return mensajeEvidencia('fallo', e.tipo);
  }
}

export interface EntradaFotoComoHito {
  tenantId: string;
  operadorId: string;
  telefono: string;
  viajeId: string;
  tipo: TipoEvidencia;
  ruta: string;
  sha256: string;
  waMessageId?: string | null;
  /** La hora del MENSAJE de la foto según Meta; sin ella, el reloj local. */
  mensajeEn?: Date | null;
  ahora?: Date;
}

/**
 * 0483 — LA FOTO ES EL AVISO. Se llama con la foto YA subida, cuando `hitoParaEvidenciaDelChofer` dijo `comoHito`.
 * Se vuelve a decidir con los hitos de AHORA (la foto tardó en subir y el mundo pudo cambiar: si el chofer escribió «ya
 * llegué» mientras tanto, la foto se cuelga de ese hito y no se registra otro), se registra con fuente `foto` y la hora
 * del mensaje, se corre la validación contra el sitio como en cualquier llegada y la foto queda de evidencia.
 * Nunca lanza: devuelve lo que se le dice al chofer.
 */
export async function registrarHitoDesdeFoto(e: EntradaFotoComoHito, deps: DepsAtender = depsReales): Promise<SalidaAtender> {
  const ahora = e.ahora ?? new Date();
  try {
    const viaje = await deps.viajeDelOperador(e.tenantId, e.operadorId, e.viajeId);
    if (!viaje || viaje.estatus === 'liquidado') return { mensajes: [{ texto: mensajeEvidencia('sin_hito', e.tipo) }] };
    const intencion = intencionDeFoto(e.tipo);
    const config = await deps.config(e.tenantId);
    const hitos = await deps.asegurarHitos(e.tenantId, viaje.id);
    if (!intencion || !config.fotoRegistraHito) return { mensajes: [{ texto: mensajeEvidencia('sin_hito', e.tipo) }] };

    const mensajeEn = e.mensajeEn && !Number.isNaN(e.mensajeEn.getTime()) ? e.mensajeEn : ahora;
    const decision = decidir({
      hitos, intencion, contacto: null, ahora, mensajeEn, ventanaCorreccionMin: config.ventanaCorreccionMin, posponerMin: config.posponerMin,
    });
    // Un duplicado (el aviso ya estaba: el chofer lo dijo mientras la foto subía), una aclaración o un rechazo NO son avisos
    // nuevos: si hay un hito al cual colgarla es evidencia; si no, se le dice. La foto no inventa ninguno.
    if (decision.accion !== 'registrar') {
      const destino = hitoParaEvidencia(e.tipo, hitos, ahora);
      return { mensajes: [{ texto: destino
        ? await registrarEvidenciaDelChofer({ tenantId: e.tenantId, hito: destino, tipo: e.tipo, ruta: e.ruta, sha256: e.sha256, waMessageId: e.waMessageId, ahora }, deps)
        : mensajeEvidencia('sin_hito', e.tipo) }] };
    }

    const efectos = { pedirUbicacion: false };
    const interp: Interpretacion = { intencion, contacto: null, via: 'foto', confianza: 1 };
    const aplicado = await aplicar(decision, {
      deps, e: { tenantId: e.tenantId, operadorId: e.operadorId, telefono: e.telefono, viajeAbiertoId: viaje.id, texto: '', waMessageId: e.waMessageId ?? null }, viaje, hitos,
      interp, fuente: 'foto', ahora, mensajeEn, config, efectos,
    });
    logger.info('hito.conductor', { viaje: viaje.id, accion: 'registrar', via: 'foto', aplicado, objetivo: decision.objetivo });
    if (aplicado !== 'ok') {
      // Carrera (otro mensaje registró el hito primero) o fallo: la foto no se pierde si hay un hito resuelto al cual colgarla.
      const frescos = await deps.cargarHitos(e.tenantId, viaje.id);
      const destino = hitoParaEvidencia(e.tipo, frescos, ahora);
      if (destino) return { mensajes: [{ texto: await registrarEvidenciaDelChofer({ tenantId: e.tenantId, hito: destino, tipo: e.tipo, ruta: e.ruta, sha256: e.sha256, waMessageId: e.waMessageId, ahora }, deps) }] };
      return { mensajes: [{ texto: mensajeEvidencia('fallo', e.tipo) }] };
    }

    // El hito quedó registrado: la foto es su evidencia.
    const registrado = (await deps.cargarHitos(e.tenantId, viaje.id)).find((h) => h.tipo === decision.objetivo);
    const evidencia = registrado
      ? await registrarEvidenciaDelChofer({ tenantId: e.tenantId, hito: registrado, tipo: e.tipo, ruta: e.ruta, sha256: e.sha256, waMessageId: e.waMessageId, ahora }, deps)
      : null;
    const ctx: ContextoMensaje = { viajeId: viaje.id, folio: viaje.folio, origen: viaje.origen, destino: viaje.destino };
    const acuse = mensajeParaChofer(decision, ctx, ahora, aplicado);
    const conFoto = `${acuse.texto}\n📷 Lo anoté con tu foto de ${ETIQUETA_EVIDENCIA[e.tipo]}.`;
    const pedir = efectos.pedirUbicacion ? { solicitarUbicacion: TEXTO_PEDIR_UBICACION } : {};
    // Si la foto no se pudo colgar (raro: el hito acaba de registrarse), el chofer lo sabe; el hito sí quedó.
    const aviso = evidencia && !/Recibí la foto/.test(evidencia) ? [{ texto: evidencia }] : [];
    // Con la confirmación apagada el hito queda en silencio, pero lo que falló de la foto sí se dice.
    if (!config.confirmarAlChofer) return { mensajes: aviso, ...pedir };
    return { mensajes: [{ ...acuse, texto: conFoto }, ...aviso], ...pedir };
  } catch (err) {
    logger.error('conductor.foto_como_hito_fallo', { viaje: e.viajeId, err: err instanceof Error ? err.message : String(err) });
    return { mensajes: [{ texto: mensajeEvidencia('fallo', e.tipo) }] };
  }
}

export { textoVeredicto };
