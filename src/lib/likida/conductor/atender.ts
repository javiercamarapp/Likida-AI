import { logger } from '@/lib/logger';
import { moduloEnStandBy } from '@/lib/auth/perfil_tenant';
import { enviarSolicitudUbicacion } from '@/lib/meta/client';
import type { ConfigConductor } from './config';
import { interpretarBoton, interpretarBotonParada, interpretarParadaTexto, interpretarTexto, leerBotonRampa, leerTextoResultadoDescarga, pareceHablarDeHito, type BotonRampa, type InterpretacionParada, type Intencion, type Interpretacion } from './interprete';
import { interpretarConLlm } from './llm';
import { guardiaDatosSeguridad } from './guardia_seguridad';
import { decidir, hitoActivo, type Decision } from './maquina';
import { mensajeParaChofer, type ContextoMensaje, type Salida } from './mensajes';
import {
  abrirParada, adjuntarUbicacion, asegurarHitos, cargarHitos, cerrarParada, leerParadaAbierta, cerrarEpisodioPorJefe, guardarContacto, leerConfigConductor, marcarEscalacionAtendida, marcarSinContacto,
  posponerHito, registrarEvento, registrarHito, responderEpisodioSenalVida, retirarHitos, sincronizarLegado, viajeDelOperador,
  leerCicloServicio, leerEvidenciasSelloViaje,
  type ResultadoEscritura, type ViajeContexto,
} from './repo';
import { cicloDelServicio, hitoEnCiclo, type CicloEfectivo, type CicloServicioFila } from './ciclo_servicio';
import { tenantDelViaje } from './trabajo';
import { puertosGastosReales, responderGastos, type PuertosGastos, type RespuestaGastos } from './gastos_etc';
import { estaResuelto, leerBotonConductor, PREFIJO_BOTON, type BotonLeido, type HitoFila, type FuenteHito, type RespuestaSenalVida, type TipoEvidencia, type TipoHito } from './tipos';
import { silencioDeRespuesta } from './senal_vida';
import { escalarPorProblema, puertosReales } from './ejecutor';
import { avisarOficinaDeHito } from './avisos_oficina';
import { puedeAcusar } from './escalamiento';
import { debeSellarTrasValidar, depsValidacionReales, validarHitoContraSitio, type EntradaValidarHito, type SalidaValidar } from './validar_hito';
import {
  documentoCierreDeLaFoto, guardarEvidencia, hitoLlegadaReciente, puertosDocumentosCierreReales,
  registrarFotoDocumentoCierre as registrarFotoDocumentoCierreRepo, registrarRespuestaChoferDocumentosCierre,
} from './repo_validacion';
import { MENSAJE_SIN_CATEGORIA_DOCUMENTO, type DocumentoCierreFila, type DocumentoCierrePrevio, type MetadatosFoto } from './documentos_cierre';
import { decidirSelloInicio, ETIQUETA_EVIDENCIA, hitoParaEvidencia, mensajeEvidencia, mensajeSelloInicio, tipoEvidenciaDeCaption, type EvidenciaSelloFila } from './evidencia';
import { textoVeredicto, veredictoSellaLlegada } from './validacion';
import { puertosEstadiaReales, responderEstadiaDescarga, type PuertosEstadia } from './alertas_estadia';
import type { OpcionResultadoDescarga, RespuestaEstadia } from './mensajes';
import { preguntarResultado, puertosResultadoReales, responderResultadoDescarga, type PuertosResultado } from './resultado_descarga';
import { preguntarDocumentosCierre, type PuertosDocumentosCierre } from './documentos_cierre';
import {
  puertosReporteAtenderReales, responderReporteBoton, responderReporteTexto, type PuertosReporteAtender,
} from './reporte_llegada';
import { puertosAsignacionReales, responderAsignacion, type OpcionAsignacion, type PuertosAsignacion } from './asignacion';
import {
  leerBotonDetencion, puertosDetencionAtenderReales, responderDetencion, responderPaginaMotivos, responderParada,
  TEXTO_DETENCION_NO_VIGENTE, type BotonDetencion, type PuertosDetencionAtender,
} from './deteccion_parada';
import type { DepsParada } from './paradas';
import { leerTextoPatio, marcarPatioAtendido, preguntarPatio, puertosPatioReales, responderPatio, type PuertosPatio } from './patio_entrega';

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
  /** T-A5-53/54: clasificar y registrar la foto de un documento de cierre, y la respuesta del chofer a N11. */
  documentoCierreDeLaFoto: typeof documentoCierreDeLaFoto;
  registrarFotoDocumentoCierre: typeof registrarFotoDocumentoCierreRepo;
  registrarRespuestaDocumentosCierre: typeof registrarRespuestaChoferDocumentosCierre;
  /** P2 (0636): el chofer contestó un botón del «¿sigues bien?». Opcional: las pruebas que no lo ejercen no lo declaran. */
  responderSenalVida?(tenantId: string, viajeId: string, respuesta: RespuestaSenalVida, ahora: Date, config?: ConfigConductor): Promise<'cerrado' | 'sin_episodio' | 'fallo'>;
  /** T-A5-44: los puertos del patio de entrega (catálogo, bitácora, aviso al supervisor). Opcional: sin él se usan los reales, y solo si la flota lo encendió. */
  patio?: PuertosPatio;
  /** T-A5-45: los puertos del aviso al supervisor por la estadía de descarga. Opcional: sin él, los reales. */
  estadia?: PuertosEstadia;
  /** T-A5-43: la bitácora del «con quién te reportaste» y la rampa (leer lo preguntado, guardar lo respondido). Opcional: sin él, la real. */
  reporte?: PuertosReporteAtender;
  /** T-A5-46: los puertos del resultado de la descarga y la caja cargada (bitácora, claim, aviso al supervisor). Opcional: sin él, los reales. */
  resultado?: PuertosResultado;
  /** T-A5-53: los puertos de la solicitud de documentos de cierre (leer/crear el snapshot del catálogo). Opcional: sin él, los reales. */
  documentosCierre?: PuertosDocumentosCierre;
  /** T-A5-47: los puertos de la asignación con botones (aceptar, instrucciones, aviso del rechazo). Opcional: sin él, los reales. */
  asignacion?: PuertosAsignacion;
  /** T-A5-51: la pregunta de gastos/ETC. Opcional: las pruebas que no la ejercen no lo declaran. */
  gastos?: PuertosGastos;
  /** T-A5-39: la bitácora de la detención sin aviso y el aviso al supervisor por «Necesito apoyo». Opcional: sin él, los reales. */
  detencion?: PuertosDetencionAtender;
  /** T-A5-38/39: la parada que inicia el chofer (leer, abrir, cerrar). Opcional: sin él, la real. */
  parada?: DepsParada;
  /** T-A5-68: los ciclos por servicio de la flota (0807), para que «ya llegué»/«ya salí» sigan el ciclo impo/expo/nacional. Opcional: sin él, el ciclo actual. */
  ciclosDe?(tenantId: string): Promise<CicloServicioFila[]>;
  /** T-A5-68: las fotos de sello recientes del viaje (T-A5-40), para el paso previo del «inicio de viaje». Opcional: sin él, las reales. */
  evidenciasSello?(tenantId: string, viajeId: string, ahora: Date): Promise<EvidenciaSelloFila[]>;
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
  documentoCierreDeLaFoto,
  registrarFotoDocumentoCierre: registrarFotoDocumentoCierreRepo,
  registrarRespuestaDocumentosCierre: registrarRespuestaChoferDocumentosCierre,
  responderSenalVida: (tenantId, viajeId, respuesta, ahora, config) => responderEpisodioSenalVida(tenantId, viajeId, respuesta, silencioDeRespuesta(respuesta, config), ahora),
  ciclosDe: leerCicloServicio,
  evidenciasSello: leerEvidenciasSelloViaje,
};

/**
 * T-A5-68 (T-A5-42 cableado): el ciclo del servicio del viaje. Sin puerto, sin servicio conocido o sin filas = el ciclo actual (cero
 * regresión). Si la lectura falla, el viaje sigue el ciclo actual y se dice en el log: el chofer nunca se queda sin registrar por esto.
 */
async function cicloDelViaje(deps: DepsAtender, viaje: Pick<ViajeContexto, 'tenantId' | 'servicio'>): Promise<CicloEfectivo | undefined> {
  const leer = deps.ciclosDe ?? depsReales.ciclosDe;
  if (!leer) return undefined;
  try {
    return cicloDelServicio(await leer(viaje.tenantId), viaje.servicio ?? null);
  } catch (err) {
    logger.warn('conductor.ciclo_servicio_fallo', { tenant: viaje.tenantId, err: err instanceof Error ? err.message : String(err) });
    return undefined;
  }
}

/**
 * Ruling (T-A5-68): el «inicio de viaje» cuelga de `salida_carga` (T-A5-40: es el ancla de «en tránsito» y de la detención sin aviso, y el
 * hito del sello). Un servicio cuyo ciclo no tiene carga (importación) no tiene ese hito, y un «ya salí» a secas antes de llegar al
 * cliente se leería como la salida de la DESCARGA y cerraría el viaje al arrancar. Mientras no haya llegado ni salido de descargar, ese
 * aviso se decide con el ciclo de siempre (inicio de viaje = salida_carga); todo lo demás sigue el ciclo del servicio. Costo si me equivoco:
 * en importación el hito de inicio se llama `salida_carga`; se corrige al decidir un hito propio para el inicio de viaje (reversible).
 */
function cicloParaDecidir(ciclo: CicloEfectivo | undefined, intencion: Intencion, hitos: readonly HitoFila[]): CicloEfectivo | undefined {
  if (!ciclo || ciclo.origen === 'actual') return ciclo;
  if (intencion.clase !== 'salida' || intencion.lugar === 'descarga' || hitoEnCiclo(ciclo, 'salida_carga')) return ciclo;
  const llegoOSalio = hitos.some((h) => (h.tipo === 'llegada_descarga' || h.tipo === 'salida_descarga') && estaResuelto(h));
  return llegoOSalio ? ciclo : undefined;
}

/** T-A5-68: las fotos de sello recientes del viaje. `exigir` = la opción está encendida: una base caída NO equivale a «no hay foto» (lanza). */
async function leerSelloDelViaje(deps: DepsAtender, tenantId: string, viajeId: string, ahora: Date, exigir: boolean): Promise<EvidenciaSelloFila[]> {
  const leer = deps.evidenciasSello ?? depsReales.evidenciasSello!;
  try {
    return await leer(tenantId, viajeId, ahora);
  } catch (err) {
    if (exigir) throw err;
    logger.warn('conductor.sello_lectura_fallo', { viaje: viajeId, err: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

/** Lo que se le contesta al chofer tras tocar un botón de la señal de vida. */
export function textoRespuestaSenalVida(respuesta: RespuestaSenalVida, resultado: 'cerrado' | 'sin_episodio' | 'fallo', folio: string | null): string {
  if (resultado === 'fallo') return 'No pude anotarlo ahorita. Intenta de nuevo en un momento. 🙏';
  if (resultado === 'sin_episodio') return 'Ese aviso ya no está vigente. 👍';
  const viaje = folio ? ` del viaje ${folio}` : '';
  if (respuesta === 'voy_a_cargar') return `Anotado ✅ Gracias por avisar. Si el GPS sigue sin reportar, te vuelvo a preguntar en una hora${viaje}.`;
  if (respuesta === 'estoy_bien') return 'Me da gusto. Anotado ✅ Si tienes algún problema, avísale directo a tu jefe de tráfico.';
  return `Gracias, anotado ✅ Seguimos al pendiente${viaje}.`;
}

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

/** Lo que ve el chofer tras «Tengo un problema», según cómo terminó el aviso al jefe de tráfico. */
export function textoAvisoDeProblema(r: 'ok' | 'reintentable' | 'sin_envio' | 'ya_avisado'): string {
  if (r === 'ok') return 'Gracias por avisar. Ya le avisé a tu jefe de tráfico para que te contacte. 🙏';
  if (r === 'ya_avisado') return 'Ya le había avisado a tu jefe de tráfico hace un momento. Si es urgente, márcale directo. 🙏';
  if (r === 'reintentable') return 'Tu aviso quedó en cola y todavía NO llega a tu jefe de tráfico. Si es urgente, márcale directo ahorita. 🙏';
  return 'NO pude avisarle a tu jefe de tráfico. Márcale directo ahorita o llama a monitoreo. 🙏';
}

export async function atenderConductor(e: EntradaAtender, deps: DepsAtender = depsReales): Promise<SalidaAtender | null> {
  // T-A5-58: la clave de amago y el botón de pánico no se guardan ni se interpretan: antes de cualquier regla, modelo, base o log.
  const sensible = guardiaDatosSeguridad(e.texto);
  if (sensible) return { mensajes: [sensible] };
  const ahora = e.ahora ?? new Date();
  const boton = interpretarBoton(e.texto);
  let interp: Interpretacion | null = boton;
  if (!interp) interp = interpretarTexto(e.texto);

  // ¿Es de este módulo? Los botones siempre; el texto, solo si las reglas lo entienden
  // o PARECE hablar de un hito (y entonces decide el respaldo con modelo).
  // Los payloads de OTROS botones nuestros (el «Ya lo atiendo» del jefe) no son de este módulo
  // aunque parezcan hablar de un hito: ni se interpretan ni pagan una llamada al modelo.
  // T-A5-44: la respuesta del patio de entrega (botón `hito_patio` o «patio <nombre>» tras «Otro») es de este módulo, pero no es un hito.
  const botonPatio = leerBotonConductor(e.texto);
  // T-A5-47: los botones de la asignación (`viaje_acepto`, `viaje_rechazo`, `instr_ok`) son de este módulo y no registran un hito.
  const opcionAsignacion = botonPatio ? OPCION_ASIGNACION[botonPatio.prefijo] : undefined;
  if (botonPatio && opcionAsignacion) return atenderAsignacion(e, botonPatio, opcionAsignacion, ahora, deps);
  // T-A5-51: la respuesta a «¿requieres gastos de viaje o ETC?» (`gastos_si` / `gastos_no`) tampoco registra un hito.
  if (botonPatio && (botonPatio.prefijo === PREFIJO_BOTON.gastosSi || botonPatio.prefijo === PREFIJO_BOTON.gastosNo)) return atenderGastos(e, botonPatio, ahora, deps);
  const esBotonPatio = botonPatio?.prefijo === PREFIJO_BOTON.patioEntrega;
  const nombrePatio = esBotonPatio ? null : leerTextoPatio(e.texto);
  if (esBotonPatio || nombrePatio) {
    const r = await atenderPatio(e, botonPatio, nombrePatio, ahora, deps);
    if (r) return r;
    if (esBotonPatio) return null;
  }
  // T-A5-45: «¿ya inició la descarga?» — el botón `estadia_descarga:<viaje>:si|no` es de este módulo pero tampoco registra un hito.
  if (botonPatio?.prefijo === PREFIJO_BOTON.estadiaDescarga) return atenderEstadia(e, botonPatio, ahora, deps);
  // T-A5-53: la respuesta a la plantilla N11 («Ya los envié» / «Me falta uno») tampoco registra un hito: solo se anota en la solicitud.
  if (botonPatio?.prefijo === PREFIJO_BOTON.documentosCierreListo || botonPatio?.prefijo === PREFIJO_BOTON.documentosCierreFalta) {
    return atenderRespuestaDocumentosCierre(e, botonPatio, ahora, deps);
  }
  // T-A5-46: «¿cómo terminó la descarga?» — el botón `resultado_descarga:<viaje>:<opción>` o, con la pregunta abierta, su texto equivalente.
  if (botonPatio?.prefijo === PREFIJO_BOTON.resultadoDescarga) return atenderResultado(e, botonPatio, null, ahora, deps);
  const opcionTexto = botonPatio || !e.viajeAbiertoId ? null : leerTextoResultadoDescarga(e.texto);
  if (opcionTexto) {
    const r = await atenderResultado(e, null, opcionTexto, ahora, deps);
    if (r) return r;
  }
  // T-A5-43: los botones de la rampa (`rampa_estado_*`, `rampa_mas`, `rampa_como_omitir`) son de este módulo y tampoco registran un hito.
  const botonRampa = leerBotonRampa(e.texto);
  if (botonRampa) return atenderReporteBoton(e, botonRampa, deps);
  if (!boton && leerBotonConductor(e.texto)) return null;
  // T-A5-43: un texto que ninguna regla de hitos entiende puede ser la respuesta a «¿cómo descargas?» o el número de rampa.
  if (!interp && e.viajeAbiertoId) {
    const r = await atenderReporteTexto(e, ahora, deps);
    if (r) return r;
  }
  // T-A5-39: los botones de la pregunta de detención (N05: `parada_ok`, `parada_motivo`, `parada_apoyo`) y la página de motivos son de este
  // módulo y no registran un hito. La parada del chofer (T-A5-38: «parada», un motivo, «ya continúo») va ANTES que el hito: «parada por tráfico»
  // contiene «tráfico», que para las reglas de hitos es un retraso.
  const botonDetencion = leerBotonDetencion(e.texto);
  if (botonDetencion) return atenderDetencionBoton(e, botonDetencion, ahora, deps);
  const iParada = interpretarBotonParada(e.texto) ?? (e.viajeAbiertoId ? interpretarParadaTexto(e.texto) : null);
  if (iParada) {
    const r = await atenderParada(e, iParada, ahora, deps);
    if (r) return r;
    if (iParada.via === 'boton') return null;
  }
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
    if (interp.intencion.clase === 'senal_vida') {
      const respuesta = interp.intencion.respuesta;
      const resultado = await (deps.responderSenalVida ?? depsReales.responderSenalVida!)(e.tenantId, viaje.id, respuesta, ahora, config);
      return { mensajes: [{ texto: textoRespuestaSenalVida(respuesta, resultado, viaje.folio) }] };
    }
    if (interp.intencion.clase === 'pedir_ubicacion') {
      const ok = await deps.solicitarUbicacion(e.telefono, '📍 Toca el botón para compartir tu ubicación y la anoto en tu viaje.');
      return { mensajes: ok ? [] : [{ texto: 'No pude abrir la ubicación. Mándame tu pin desde el clip 📎 → Ubicación. 🙏' }] };
    }
    if (interp.intencion.clase === 'problema') {
      const activo = hitoActivo(hitos);
      if (!activo) return { mensajes: [{ texto: 'Ya tengo todos los avisos de este viaje. Si tienes un problema, avísale directo a tu jefe de tráfico. 🙏' }] };
      const r = await deps.escalarPorProblema(viaje, activo, hitos, ahora);
      // A35-A5-02: solo se promete «ya le avisé» cuando el aviso SALIÓ. Es texto de seguridad: nunca prometer lo que no pasó.
      return { mensajes: [{ texto: textoAvisoDeProblema(r) }] };
    }

    // T-A5-68: «ya llegué a descargar» y «ya salí» siguen el ciclo del servicio del viaje (impo/expo/nacional).
    const ciclo = cicloParaDecidir(await cicloDelViaje(deps, viaje), interp.intencion, hitos);
    const decision = decidir({
      hitos, intencion: interp.intencion, contacto: interp.contacto, ahora, mensajeEn,
      ventanaCorreccionMin: config.ventanaCorreccionMin, posponerMin: config.posponerMin, ciclo,
    });

    // T-A5-68: el inicio de viaje (`salida_carga`) pasa por el paso previo del sello (T-A5-40) ANTES de registrarse.
    let recomendarSello = false;
    if (decision.accion === 'registrar' && decision.objetivo === 'salida_carga') {
      // Con la opción apagada una lectura fallida no estorba (se recomienda de más); encendida, falla cerrado: el catch pide reintentar.
      const evidencias = await leerSelloDelViaje(deps, e.tenantId, viaje.id, ahora, config.exigirSelloInicio === true);
      const paso = decidirSelloInicio({ objetivo: decision.objetivo, servicio: viaje.servicio ?? null, exigir: config.exigirSelloInicio, evidencias, ahora });
      if (paso.accion === 'pedir_foto') {
        logger.info('hito.conductor', { viaje: viaje.id, accion: 'pedir_sello', via: interp.via, objetivo: decision.objetivo });
        return { mensajes: [{ texto: mensajeSelloInicio('pedir') }] };
      }
      // Sin servicio conocido no se insiste (el sello previo es de importación; «apagada por defecto: el acuse no la menciona»).
      recomendarSello = paso.recomendar && viaje.servicio === 'importacion';
    }

    const fuente: FuenteHito = boton ? 'boton' : 'texto';
    const efectos: ContextoAplicar['efectos'] = { pedirUbicacion: false };
    const aplicado = await aplicar(decision, { deps, e, viaje, hitos, interp, fuente, ahora, mensajeEn, config, efectos });
    logger.info('hito.conductor', {
      viaje: viaje.id, accion: decision.accion, via: interp.via, aplicado,
      objetivo: 'objetivo' in decision ? decision.objetivo : null,
    });

    const salida = mensajeParaChofer(decision, ctx, ahora, aplicado);
    const pedir = efectos.pedirUbicacion ? { solicitarUbicacion: TEXTO_PEDIR_UBICACION } : {};
    // Con la confirmación apagada, el hito registrado queda en silencio (todo lo demás sí se contesta).
    const pregunta = [efectos.preguntaPatio, efectos.preguntaResultado, efectos.preguntaDocumentos].filter((x): x is Salida => Boolean(x));
    if (!config.confirmarAlChofer && decision.accion === 'registrar' && aplicado === 'ok') return { mensajes: [...pregunta], ...pedir };
    if (config.pedirFotoEvidencia && decision.accion === 'registrar' && aplicado === 'ok') {
      const invitacion = invitacionFoto(decision.objetivo);
      if (invitacion) salida.texto = `${salida.texto}\n${invitacion}`;
    } else if (recomendarSello && aplicado === 'ok') {
      salida.texto = `${salida.texto}\n${mensajeSelloInicio('recomendar')}`;
    }
    return { mensajes: [salida, ...pregunta], ...pedir };
  } catch (err) {
    // Fail-closed: no se finge una anotación. Pero tampoco se rompe el turno entero.
    logger.error('hito.conductor_fallo', { viaje: llevaViaje, err: err instanceof Error ? err.message : String(err) });
    return { mensajes: [FALLO] };
  }
}

const OPCION_ASIGNACION: Readonly<Record<string, OpcionAsignacion | undefined>> = {
  [PREFIJO_BOTON.viajeAcepto]: 'acepto',
  [PREFIJO_BOTON.viajeRechazo]: 'rechazo',
  [PREFIJO_BOTON.instruccionesOk]: 'entendido',
};

/** T-A5-47: atiende un botón de la asignación. Los botones siempre contestan algo (o, si las instrucciones ya salieron solas, nada). */
async function atenderAsignacion(
  e: EntradaAtender, boton: NonNullable<ReturnType<typeof leerBotonConductor>>, opcion: OpcionAsignacion, ahora: Date, deps: DepsAtender,
): Promise<SalidaAtender | null> {
  try {
    const viaje = await deps.viajeDelOperador(e.tenantId, e.operadorId, boton.viajeId);
    if (!viaje) return { mensajes: [{ texto: 'Ese botón es de otro viaje o ya no está vigente. 🙏' }] };
    if (viaje.estatus === 'liquidado') return { mensajes: [{ texto: 'Ese viaje ya está cerrado. 👍' }] };
    const config = await deps.config(e.tenantId);
    const hitos = opcion === 'rechazo' ? await deps.asegurarHitos(e.tenantId, viaje.id) : undefined;
    const mensajes = await responderAsignacion(deps.asignacion ?? puertosAsignacionReales(), { viaje, telefono: e.telefono, opcion, config, hitos, ahora });
    return { mensajes };
  } catch (err) {
    logger.error('conductor.asignacion_atender_fallo', { viaje: boton.viajeId, err: err instanceof Error ? err.message : String(err) });
    return { mensajes: [FALLO] };
  }
}

/** T-A5-51: atiende la respuesta del chofer a la pregunta de gastos/ETC. El botón se atiende aunque la perilla se apague después. */
async function atenderGastos(
  e: EntradaAtender, boton: NonNullable<ReturnType<typeof leerBotonConductor>>, ahora: Date, deps: DepsAtender,
): Promise<SalidaAtender | null> {
  try {
    const viaje = await deps.viajeDelOperador(e.tenantId, e.operadorId, boton.viajeId);
    if (!viaje) return { mensajes: [{ texto: 'Ese botón es de otro viaje o ya no está vigente. 🙏' }] };
    if (viaje.estatus === 'liquidado') return { mensajes: [{ texto: 'Ese viaje ya está cerrado. 👍' }] };
    const respuesta: RespuestaGastos = boton.prefijo === PREFIJO_BOTON.gastosSi ? 'si' : 'no';
    return { mensajes: await responderGastos(deps.gastos ?? puertosGastosReales(), { viaje, respuesta, ahora }) };
  } catch (err) {
    logger.error('conductor.gastos_atender_fallo', { viaje: boton.viajeId, err: err instanceof Error ? err.message : String(err) });
    return { mensajes: [FALLO] };
  }
}

/** T-A5-44: atiende la respuesta del chofer al patio de entrega. `null` = no es de este módulo (texto sin pregunta abierta, o nada que decir). */
async function atenderPatio(
  e: EntradaAtender, boton: ReturnType<typeof leerBotonConductor>, nombre: string | null, ahora: Date, deps: DepsAtender,
): Promise<SalidaAtender | null> {
  const llevaViaje = boton?.viajeId ?? e.viajeAbiertoId;
  if (!llevaViaje) return null;
  try {
    const viaje = await deps.viajeDelOperador(e.tenantId, e.operadorId, llevaViaje);
    if (!viaje) return boton ? { mensajes: [{ texto: 'Ese botón es de otro viaje o ya no está vigente. 🙏' }] } : null;
    if (viaje.estatus === 'liquidado') return boton ? { mensajes: [{ texto: 'Ese viaje ya está cerrado. 👍' }] } : null;
    const config = await deps.config(e.tenantId);
    if (config.patioEntregaActivo !== true) return boton ? { mensajes: [{ texto: 'Ese aviso ya no está vigente. 👍' }] } : null;
    const hito = (await deps.cargarHitos(e.tenantId, viaje.id)).find((h) => h.tipo === 'llegada_descarga' && (h.estado === 'recibido' || h.estado === 'validado'));
    if (!hito) return boton ? { mensajes: [{ texto: 'Todavía no tengo tu llegada a descargar anotada. Avísame cuando llegues. 📍' }] } : null;
    const respuesta = boton ? { tipo: 'boton' as const, opcion: boton.opcion ?? '' } : { tipo: 'texto' as const, nombre: nombre ?? '' };
    const mensajes = await responderPatio(deps.patio ?? puertosPatioReales(), { viaje, hito, config, respuesta, ahora });
    return mensajes.length > 0 ? { mensajes } : null;
  } catch (err) {
    logger.error('conductor.patio_fallo', { viaje: llevaViaje, err: err instanceof Error ? err.message : String(err) });
    return boton ? { mensajes: [FALLO] } : null;
  }
}

/** T-A5-45: atiende la respuesta del chofer al «¿ya inició la descarga?». Los botones siempre contestan algo. */
async function atenderEstadia(
  e: EntradaAtender, boton: NonNullable<ReturnType<typeof leerBotonConductor>>, ahora: Date, deps: DepsAtender,
): Promise<SalidaAtender | null> {
  try {
    const viaje = await deps.viajeDelOperador(e.tenantId, e.operadorId, boton.viajeId);
    if (!viaje) return { mensajes: [{ texto: 'Ese botón es de otro viaje o ya no está vigente. 🙏' }] };
    if (viaje.estatus === 'liquidado') return { mensajes: [{ texto: 'Ese viaje ya está cerrado. 👍' }] };
    const config = await deps.config(e.tenantId);
    const hitos = await deps.cargarHitos(e.tenantId, viaje.id);
    const respuesta = (boton.opcion === 'no' ? 'no' : 'si') as RespuestaEstadia;
    const mensajes = await responderEstadiaDescarga(deps.estadia ?? puertosEstadiaReales(), { viaje, hitos, config, respuesta, ahora });
    return { mensajes };
  } catch (err) {
    logger.error('conductor.estadia_atender_fallo', { viaje: boton.viajeId, err: err instanceof Error ? err.message : String(err) });
    return { mensajes: [FALLO] };
  }
}

/** T-A5-53: la respuesta a la plantilla N11 («Ya los envié» / «Me falta uno»). No registra ningún hito: solo se anota en la solicitud viva. */
async function atenderRespuestaDocumentosCierre(e: EntradaAtender, boton: BotonLeido, ahora: Date, deps: DepsAtender): Promise<SalidaAtender | null> {
  try {
    const viaje = await deps.viajeDelOperador(e.tenantId, e.operadorId, boton.viajeId);
    if (!viaje) return { mensajes: [{ texto: 'Ese botón es de otro viaje o ya no está vigente. 🙏' }] };
    const respuesta = boton.prefijo === PREFIJO_BOTON.documentosCierreListo ? 'evid_listo' : 'evid_falta';
    const tocadas = await deps.registrarRespuestaDocumentosCierre(e.tenantId, viaje.id, respuesta, ahora);
    if (tocadas === 0) return { mensajes: [{ texto: 'Ese aviso ya no está vigente. 👍' }] };
    return { mensajes: [{ texto: respuesta === 'evid_listo' ? 'Gracias, lo reviso. Si falta algo te aviso. 🙏' : 'Va, mándamela cuando puedas. 🙏' }] };
  } catch (err) {
    logger.error('conductor.documentos_cierre_respuesta_fallo', { viaje: boton.viajeId, err: err instanceof Error ? err.message : String(err) });
    return { mensajes: [FALLO] };
  }
}

/**
 * T-A5-46: atiende la respuesta al «¿cómo terminó la descarga?». `null` = no es de este módulo (texto sin pregunta abierta, flota sin la
 * perilla, o la base no contestó): sigue su camino. Con las opciones de caja cargada fija además el hito `regreso` con la máquina de hitos.
 */
async function atenderResultado(
  e: EntradaAtender, boton: ReturnType<typeof leerBotonConductor>, opcionTexto: OpcionResultadoDescarga | null, ahora: Date, deps: DepsAtender,
): Promise<SalidaAtender | null> {
  const llevaViaje = boton?.viajeId ?? e.viajeAbiertoId;
  if (!llevaViaje) return null;
  const via = boton ? 'boton' as const : 'texto' as const;
  try {
    const viaje = await deps.viajeDelOperador(e.tenantId, e.operadorId, llevaViaje);
    if (!viaje) return boton ? { mensajes: [{ texto: 'Ese botón es de otro viaje o ya no está vigente. 🙏' }] } : null;
    if (viaje.estatus === 'liquidado') return boton ? { mensajes: [{ texto: 'Ese viaje ya está cerrado. 👍' }] } : null;
    const config = await deps.config(e.tenantId);
    if (config.resultadoDescargaActivo !== true) return boton ? { mensajes: [{ texto: 'Ese aviso ya no está vigente. 👍' }] } : null;
    const hitos = await deps.cargarHitos(e.tenantId, viaje.id);
    const opcion = (boton ? boton.opcion : opcionTexto) as OpcionResultadoDescarga;
    const r = await responderResultadoDescarga(deps.resultado ?? puertosResultadoReales(), { viaje, hitos, config, opcion, via, ahora });
    if (!r) return null;
    if (r.fijarRegreso) {
      // El regreso queda registrado como cualquier «voy de regreso»: la misma máquina omite lo pendiente y sella lo de la 0090.
      const frescos = await deps.asegurarHitos(viaje.tenantId, viaje.id);
      const decision = decidir({
        hitos: frescos, intencion: { clase: 'regreso' }, contacto: null, ahora, mensajeEn: ahora,
        ventanaCorreccionMin: config.ventanaCorreccionMin, posponerMin: config.posponerMin,
      });
      if (decision.accion === 'registrar') {
        const interp: Interpretacion = { intencion: { clase: 'regreso' }, contacto: null, via: via === 'boton' ? 'boton' : 'regla', confianza: 1, viajeId: viaje.id };
        await aplicar(decision, { deps, e, viaje, hitos: frescos, interp, fuente: via === 'boton' ? 'boton' : 'texto', ahora, mensajeEn: ahora, config, efectos: { pedirUbicacion: false } });
      }
    }
    return { mensajes: r.mensajes };
  } catch (err) {
    logger.error('conductor.resultado_descarga_atender_fallo', { viaje: llevaViaje, err: err instanceof Error ? err.message : String(err) });
    return boton ? { mensajes: [FALLO] } : null;
  }
}

/** T-A5-39: el viaje del chofer (no liquidado) y su config, o el motivo por el que no hay: ajeno o cerrado. */
async function viajeVigenteDelBoton(e: EntradaAtender, viajeId: string, deps: DepsAtender) {
  const viaje = await deps.viajeDelOperador(e.tenantId, e.operadorId, viajeId);
  if (!viaje) return { viaje: null, motivo: 'ajeno' as const };
  if (viaje.estatus === 'liquidado') return { viaje: null, motivo: 'cerrado' as const };
  return { viaje, config: await deps.config(e.tenantId) };
}

/** T-A5-39: un botón de la pregunta de detención o de la página de motivos. Los botones siempre contestan algo. */
async function atenderDetencionBoton(e: EntradaAtender, boton: BotonDetencion, ahora: Date, deps: DepsAtender): Promise<SalidaAtender> {
  try {
    const r = await viajeVigenteDelBoton(e, boton.viajeId, deps);
    if (!r.viaje) return { mensajes: [{ texto: r.motivo === 'cerrado' ? 'Ese viaje ya está cerrado. 👍' : 'Ese botón es de otro viaje o ya no está vigente. 🙏' }] };
    if (boton.accion === 'pagina') return { mensajes: responderPaginaMotivos(r.config!, r.viaje.id, boton.pagina) };
    const hitos = await deps.cargarHitos(e.tenantId, r.viaje.id);
    const mensajes = await responderDetencion(deps.detencion ?? puertosDetencionAtenderReales(), { viaje: r.viaje, hitos, config: r.config!, ahora, opcion: boton.opcion });
    return { mensajes };
  } catch (err) {
    logger.error('conductor.detencion_atender_fallo', { viaje: boton.viajeId, err: err instanceof Error ? err.message : String(err) });
    return { mensajes: [FALLO] };
  }
}

/**
 * T-A5-38/39: la parada que inicia el chofer. `null` = no es de este módulo (flota con la perilla apagada, o un texto sin viaje): sigue su
 * camino. Un BOTÓN siempre contesta algo (uno viejo, de otro viaje o con la perilla apagada, dice «ya no está vigente»).
 */
async function atenderParada(e: EntradaAtender, i: InterpretacionParada, ahora: Date, deps: DepsAtender): Promise<SalidaAtender | null> {
  const viajeId = i.viajeId ?? e.viajeAbiertoId;
  if (!viajeId) return null;
  const esBoton = i.via === 'boton';
  try {
    const r = await viajeVigenteDelBoton(e, viajeId, deps);
    if (!r.viaje) return esBoton ? { mensajes: [{ texto: r.motivo === 'cerrado' ? 'Ese viaje ya está cerrado. 👍' : 'Ese botón es de otro viaje o ya no está vigente. 🙏' }] } : null;
    const orden = i.intencion.clase === 'continuo' ? { tipo: 'continuo' as const } : { tipo: 'abrir' as const, motivo: i.intencion.motivo };
    const parada = deps.parada ?? { leerAbierta: leerParadaAbierta, abrir: abrirParada, cerrar: cerrarParada };
    const mensajes = await responderParada(parada, { viaje: r.viaje, config: r.config!, ahora, orden });
    if (!mensajes) return esBoton ? { mensajes: [{ texto: TEXTO_DETENCION_NO_VIGENTE }] } : null;
    return { mensajes };
  } catch (err) {
    logger.error('conductor.parada_atender_fallo', { viaje: viajeId, err: err instanceof Error ? err.message : String(err) });
    return esBoton ? { mensajes: [FALLO] } : null;
  }
}

/** T-A5-43: el viaje del chofer y su config, o `null` si el viaje no es suyo / está cerrado (el llamador decide qué contestar). */
async function viajeYConfigDelReporte(e: EntradaAtender, viajeId: string, deps: DepsAtender) {
  const viaje = await deps.viajeDelOperador(e.tenantId, e.operadorId, viajeId);
  if (!viaje) return { viaje: null, motivo: 'ajeno' as const };
  if (viaje.estatus === 'liquidado') return { viaje: null, motivo: 'cerrado' as const };
  return { viaje, config: await deps.config(e.tenantId) };
}

/** T-A5-43: un botón de la rampa. Los botones siempre contestan algo. */
async function atenderReporteBoton(e: EntradaAtender, boton: BotonRampa, deps: DepsAtender): Promise<SalidaAtender | null> {
  try {
    const r = await viajeYConfigDelReporte(e, boton.viajeId, deps);
    if (!r.viaje) return { mensajes: [{ texto: r.motivo === 'cerrado' ? 'Ese viaje ya está cerrado. 👍' : 'Ese botón es de otro viaje o ya no está vigente. 🙏' }] };
    const hitos = await deps.cargarHitos(e.tenantId, r.viaje.id);
    const mensajes = await responderReporteBoton(deps.reporte ?? puertosReporteAtenderReales(), { viaje: r.viaje, hitos, config: r.config!, ahora: e.ahora ?? new Date() }, boton);
    return { mensajes };
  } catch (err) {
    logger.error('conductor.reporte_atender_fallo', { viaje: boton.viajeId, err: err instanceof Error ? err.message : String(err) });
    return { mensajes: [FALLO] };
  }
}

/** T-A5-43: un texto suelto. `null` = no es de este módulo (flota sin la perilla, sin pregunta abierta, o la base no contestó): sigue al agente. */
async function atenderReporteTexto(e: EntradaAtender, ahora: Date, deps: DepsAtender): Promise<SalidaAtender | null> {
  try {
    const config = await deps.config(e.tenantId);
    if (config.reporteLlegadaActivo !== true) return null;
    const viaje = await deps.viajeDelOperador(e.tenantId, e.operadorId, e.viajeAbiertoId!);
    if (!viaje || viaje.estatus === 'liquidado') return null;
    const hitos = await deps.cargarHitos(e.tenantId, viaje.id);
    const mensajes = await responderReporteTexto(deps.reporte ?? puertosReporteAtenderReales(), { viaje, hitos, config, ahora }, e.texto);
    return mensajes && mensajes.length > 0 ? { mensajes } : null;
  } catch (err) {
    logger.warn('conductor.reporte_texto_atender_fallo', { viaje: e.viajeAbiertoId, err: err instanceof Error ? err.message : String(err) });
    return null;
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
  efectos: { pedirUbicacion: boolean; preguntaPatio?: Salida | null; preguntaResultado?: Salida | null; preguntaDocumentos?: Salida | null };
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
  // A37-S34-10: tras `registrarHito` el hito YA está consumado. Los efectos que siguen son best-effort: un fallo aquí se registra y
  // NO convierte el acuse en «No pude anotarlo» (el chofer reenviaría, entraría por «duplicado» y la oficina nunca sería avisada).
  const mejor = async <T,>(efecto: string, f: () => Promise<T>): Promise<T | undefined> => {
    try { return await f(); } catch (err) {
      logger.error('hito.conductor_efecto_fallo', { viaje: viaje.id, efecto, err: err instanceof Error ? err.message : String(err) });
      return undefined;
    }
  };

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
      await mejor('legado', () => deps.sincronizarLegado(viaje.tenantId, viaje.id, difiereLlegada ? d.legado.filter((l) => l !== 'llegada') : d.legado, d.mensajeEn));
      await mejor('evento', () => deps.evento(objetivo, 'recibido', { fuente: c.fuente, via: c.interp.via, ambigua: d.ambigua, tarde: d.reabre, hora_ajustada: d.ajustadaPorFuturo }));
      for (const t of d.omitir) await mejor('evento', () => deps.evento(hitoDe(hitos, t), 'omitido', { por: d.objetivo }));
      if (d.contacto) await mejor('evento', () => deps.evento(objetivo, 'contacto', {}));
      // 0385: la llegada se compara contra el sitio del viaje (GPS cercano a la hora del mensaje). Best-effort:
      // `validarHito` nunca lanza y el acuse no espera más de lo que cuestan dos consultas.
      const registrado: HitoFila = { ...objetivo, estado: 'recibido', mensajeEn: d.mensajeEn.toISOString(), recibidoEn: ahora.toISOString() };
      const v = await mejor('validar', () => deps.validarHito({ viaje, hito: registrado, config: c.config, mensajeEn: d.mensajeEn, ahora }));
      if (v?.pedirUbicacion) c.efectos.pedirUbicacion = true;
      if (difiereLlegada && veredictoSellaLlegada(v?.veredicto ?? null, true)) await mejor('legado', () => deps.sincronizarLegado(viaje.tenantId, viaje.id, ['llegada'], d.mensajeEn));
      // T-A5-44: la llegada a descargar abre la pregunta «¿en qué patio entregas?» (solo si la flota lo encendió; best-effort).
      if (d.objetivo === 'llegada_descarga' && c.config.patioEntregaActivo === true) {
        c.efectos.preguntaPatio = await mejor('patio', () => preguntarPatio(deps.patio ?? puertosPatioReales(), c.config, viaje, registrado));
      }
      // T-A5-46: la salida de la descarga abre «¿cómo terminó?» (solo si la flota lo encendió; best-effort; sin respuesta no bloquea el cierre).
      if (d.objetivo === 'salida_descarga' && c.config.resultadoDescargaActivo === true) {
        c.efectos.preguntaResultado = await mejor('resultado', () => preguntarResultado(deps.resultado ?? puertosResultadoReales(), c.config, viaje, registrado));
      }
      // T-A5-53: la salida de la descarga abre la solicitud de documentos de cierre (N11; solo si la flota lo encendió y el cliente
      // tiene catálogo; best-effort; sin respuesta no bloquea el cierre ni el regreso).
      if (d.objetivo === 'salida_descarga' && c.config.pedirDocumentosCierreActivo === true) {
        c.efectos.preguntaDocumentos = await mejor('documentos', () => preguntarDocumentosCierre(deps.documentosCierre ?? puertosDocumentosCierreReales(), c.config, viaje, registrado));
      }
      // El aviso a la oficina es best-effort y no retrasa el acuse más de lo que cuesta un envío.
      const esLlegada = d.objetivo === 'llegada_carga' || d.objetivo === 'llegada_descarga';
      if (esLlegada ? c.config.avisarOficinaLlegada : c.config.avisarOficinaSalida) {
        await mejor('aviso_oficina', () => deps.avisarOficina({ viaje, hito: { ...objetivo, estado: 'recibido' }, mensajeEn: d.mensajeEn, contacto: d.contacto, ahora }));
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
  /** P2 (0636): el «Ya lo atiendo» también cierra el episodio de «sin señal de vida» del viaje. Opcional. */
  cerrarSenalVida?(tenantId: string, viajeId: string, ahora: Date): Promise<number>;
  /** Perfil de la flota (fase 1): el Conductor está en «Próximamente» → el acuse no escribe ni contesta. Opcional. */
  enStandBy?(tenantId: string): Promise<boolean>;
  /** T-A5-44: el «Ya lo atiendo» también cierra la excepción de patio de entrega distinto. Opcional (sin él, solo las escalaciones). */
  cerrarPatio?(tenantId: string, hitos: readonly HitoFila[]): Promise<number>;
  /** Los hitos del viaje (para `cerrarPatio`); por omisión la base. */
  hitosDe?(tenantId: string, viajeId: string): Promise<HitoFila[]>;
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
  cerrarSenalVida: cerrarEpisodioPorJefe,
  enStandBy: (tenantId) => moduloEnStandBy(tenantId, 'conductor'),
  cerrarPatio: (tenantId, hitos) => marcarPatioAtendido(puertosPatioReales(), tenantId, hitos),
};

/**
 * `null` = el texto no es un acuse de escalación. Un número ajeno NO puede acusar viajes de otra flota.
 * `''` = es un acuse pero la flota tiene el Conductor en «Próximamente» (perfil): se consume en silencio, sin escribir.
 */
export async function atenderAcuseJefe(
  telefono: string, texto: string, ahora: Date = new Date(), deps: DepsAcuse = depsAcuseReales,
): Promise<string | null> {
  const b = leerBotonConductor(texto);
  if (!b || b.prefijo !== PREFIJO_BOTON.jefeAtiendo) return null;
  try {
    const v = await deps.viajePorId(b.viajeId);
    // Misma respuesta para «no existe» y «no es tuyo»: no se confirma qué viajes hay.
    if (v && deps.enStandBy && (await deps.enStandBy(v.tenantId))) {
      logger.info('conductor.acuse_stand_by', { tenantId: v.tenantId });
      return '';
    }
    if (!v || !(await deps.puedeAcusar(v.tenantId, telefono))) return 'No tengo ese aviso asignado a este número.';
    const marcados = await deps.marcar(v.tenantId, b.viajeId, ahora);
    for (const h of marcados) await deps.evento(h, 'atendido', {});
    const episodios = deps.cerrarSenalVida ? await deps.cerrarSenalVida(v.tenantId, b.viajeId, ahora).catch(() => 0) : 0;
    // T-A5-44: la excepción de patio no depende de que algún hito esté `escalado`: se busca en la bitácora del viaje (best-effort).
    const patios = deps.cerrarPatio ? await deps.cerrarPatio(v.tenantId, await (deps.hitosDe ?? cargarHitos)(v.tenantId, b.viajeId)).catch(() => 0) : 0;
    return marcados.length > 0 || episodios > 0 || patios > 0
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
        ciclo: cicloParaDecidir(await cicloDelViaje(deps, viaje), intencion, hitos), // T-A5-68: el «andén» sin lugar sigue el ciclo del servicio
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
      ciclo: cicloParaDecidir(await cicloDelViaje(deps, viaje), intencion, hitos), // T-A5-68: la misma regla que el texto del chofer
    });
    // Un duplicado (el aviso ya estaba: el chofer lo dijo mientras la foto subía), una aclaración o un rechazo NO son avisos
    // nuevos: si hay un hito al cual colgarla es evidencia; si no, se le dice. La foto no inventa ninguno.
    if (decision.accion !== 'registrar') {
      const destino = hitoParaEvidencia(e.tipo, hitos, ahora);
      return { mensajes: [{ texto: destino
        ? await registrarEvidenciaDelChofer({ tenantId: e.tenantId, hito: destino, tipo: e.tipo, ruta: e.ruta, sha256: e.sha256, waMessageId: e.waMessageId, ahora }, deps)
        : mensajeEvidencia('sin_hito', e.tipo) }] };
    }

    const efectos: { pedirUbicacion: boolean; preguntaPatio?: Salida | null } = { pedirUbicacion: false };
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
    const pregunta = efectos.preguntaPatio ? [efectos.preguntaPatio] : [];
    if (!config.confirmarAlChofer) return { mensajes: [...aviso, ...pregunta], ...pedir };
    return { mensajes: [{ ...acuse, texto: conFoto }, ...aviso, ...pregunta], ...pedir };
  } catch (err) {
    logger.error('conductor.foto_como_hito_fallo', { viaje: e.viajeId, err: err instanceof Error ? err.message : String(err) });
    return { mensajes: [{ texto: mensajeEvidencia('fallo', e.tipo) }] };
  }
}

export { textoVeredicto };

// ═══════════════════════════════════════════════════════════════════════════
// LOS DOCUMENTOS DE CIERRE (T-A5-53/54, 0823) — la foto se clasifica contra
// los documentos aún pendientes del catálogo del cliente de ESE viaje (la
// solicitud ya se armó al terminar la descarga) y avanza esa fila. Sin
// categoría clara, se guarda igual: nunca se adivina ni se pierde. Mismo
// bucket y mismo pipeline de subida que el POD/evidencia.
// ═══════════════════════════════════════════════════════════════════════════

export interface EntradaDocumentoCierrePrevio { tenantId: string; operadorId: string; viajeId: string; caption: string | undefined }

/** `null` = sin solicitud viva de este viaje (sin catálogo del cliente, o ya está completa): la foto sigue su camino normal de comprobante. */
export async function documentoCierreDeLaFotoDelChofer(e: EntradaDocumentoCierrePrevio, deps: DepsAtender = depsReales): Promise<DocumentoCierrePrevio | null> {
  try {
    const viaje = await deps.viajeDelOperador(e.tenantId, e.operadorId, e.viajeId);
    if (!viaje) return null;
    return await deps.documentoCierreDeLaFoto(e.tenantId, e.viajeId, e.caption);
  } catch (err) {
    logger.warn('conductor.documento_cierre_previo_fallo', { viaje: e.viajeId, err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export interface EntradaFotoDocumentoCierreChofer {
  tenantId: string;
  viajeId: string;
  documentoId: string | null;
  pendientes: readonly DocumentoCierreFila[];
  ruta: string;
  sha256: string;
  waMessageId?: string | null;
  /** `processor.ts` la manda con ancho/luminancia reales (`intake/calidad_foto.ts`, vía `sharp`); ausente/`null` (p. ej. imagen ilegible para `sharp`) = siempre legible, nunca bloquea. */
  metadatos?: MetadatosFoto | null;
  ahora?: Date;
}

/** Registra la foto ya subida (hito `salida_descarga`, ya resuelto). Devuelve el acuse al chofer; nunca lanza. */
export async function registrarFotoDocumentoCierreDelChofer(e: EntradaFotoDocumentoCierreChofer, deps: DepsAtender = depsReales): Promise<string> {
  try {
    const hitos = await deps.cargarHitos(e.tenantId, e.viajeId);
    const hito = hitos.find((h) => h.tipo === 'salida_descarga' && estaResuelto(h));
    if (!hito) return MENSAJE_SIN_CATEGORIA_DOCUMENTO; // no debería pasar (ya había pendientes), pero no se inventa un hito al cual colgarla
    return await deps.registrarFotoDocumentoCierre({
      tenantId: e.tenantId, hito, documentoId: e.documentoId, pendientes: e.pendientes, ruta: e.ruta, sha256: e.sha256,
      waMessageId: e.waMessageId ?? null, metadatos: e.metadatos, ahora: e.ahora,
    });
  } catch (err) {
    logger.error('conductor.foto_documento_cierre_del_chofer_fallo', { viaje: e.viajeId, err: err instanceof Error ? err.message : String(err) });
    return MENSAJE_SIN_CATEGORIA_DOCUMENTO;
  }
}
