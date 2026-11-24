// ═══════════════════════════════════════════════════════════════════════════
// DECIDIR LA ACCIÓN — dado un mensaje del cliente y lo que el sistema SÍ tiene confirmado, ¿qué hace el agente?
//
// `decidirAccion(entrada)` combina la matriz (matriz_accion.ts) con el contexto del hilo y devuelve UNA decisión:
//   responder_con_datos · pedir_dato_a_persona · avisar_encargado · escalar_gerente · solo_registrar · prohibido
// más el motivo, el nivel de aviso interno (N1-N3), los campos que faltan, la plantilla y lo que NUNCA debe decirse.
//
// Garantías:
//   · Nunca es menos conservadora que la política actual: ninguna decisión autoenvía (toda respuesta con datos espera aprobación
//     salvo que la flota autorice expresamente un tipo de la lista corta `AUTOENVIABLES_MAXIMO`), y ante cualquier duda va a una persona.
//   · Si falta un dato, devuelve `pedir_dato_a_persona` con los campos faltantes; jamás lo inventa.
//   · Cada señal adicional (repregunta, urgencia, ráfaga, escalamiento, discrepancia, solicitante no verificado, borrador con una
//     frase prohibida) solo puede ENDURECER la decisión, nunca aflojarla.
//   · PROHIBIDOS: prometer ETA, autorizar la salida, cotizar o negar falsos y demoras, tocar CCP/POD/DODA/sellos, dar datos del
//     operador a quien no está verificado, inventar datos.
// PURO: sin base, sin red, sin modelo.
// ═══════════════════════════════════════════════════════════════════════════
import { normalizar } from '../entrada';
import { detectarSolicitudes, tiposDePeticion, detectarUrgencia, type TipoSolicitud } from './taxonomia';
import { AUTOENVIABLES_MAXIMO, CONSERVADURIA, MATRIZ, NUNCA_DECIR_GENERAL, RANGO_NIVEL, type Accion, type NivelAviso } from './matriz_accion';
import { NUNCA_DECIR_ETA, type EvaluacionEta } from './politica_eta';
import { revisarAcuse, type IdPlantilla } from './plantillas';
import { REGLAS_POR_OMISION, type ReglasPorCliente } from './reglas_cliente';
import { evaluarEscalamiento, mensajesSinAtender, type ConfigEscalamiento, type Hilo, type ResultadoEscalamiento } from './escalamiento';

export type { Accion, NivelAviso } from './matriz_accion';

export interface ContextoDecision {
  /** Hora local en minutos desde medianoche. */
  horaLocalMin?: number | null;
  minutosEsperando?: number;
  /** Veces que el cliente ya preguntó lo mismo sin recibir dato. */
  repreguntas?: number;
  /** Tres o más mensajes del cliente en 30 min. */
  rafaga?: boolean;
  urgente?: boolean;
  canal?: 'whatsapp' | 'correo';
  emisor?: 'cliente' | 'equipo' | 'operador' | 'desconocido';
  /** El solicitante es un contacto autorizado del cliente. Ausente = no declarado; `false` = número desconocido. */
  solicitanteVerificado?: boolean;
  eta?: EvaluacionEta;
  escalamiento?: ResultadoEscalamiento;
  /** Códigos de discrepancia ya detectados por las validaciones (V1-V21): caja distinta, sello distinto, fecha incoherente… */
  discrepancias?: readonly string[];
  minutosParaCita?: number | null;
  operadorEsperandoMin?: number | null;
  unidadDetenidaMin?: number | null;
  paradaNoAutorizada?: boolean;
  desvioDeRuta?: boolean;
  salidaSinAutorizacion?: boolean;
  cambiosDeUnidadEn60Min?: number;
  zonaDeRiesgoOHazmat?: boolean;
  ccpMinSinTimbrar?: number | null;
  programaRecibido?: boolean;
  programaCambio?: boolean;
  soloHayCartaPorteSellada?: boolean;
  /** Borrador propuesto (por una persona o un modelo) que se quiere revisar contra los prohibidos. */
  borrador?: string;
}

export interface ConfigDecision {
  reglas?: ReglasPorCliente;
  /** Los datos sensibles del operador se muestran en las fichas (por omisión no). */
  mostrarDatosOperador?: boolean;
  repreguntaEsperaMin?: number;
  ccpSinTimbrarMin?: number;
  esperaPlantaN2Min?: number;
  esperaPlantaN3Min?: number;
  /** Tipos que la flota autoriza a autoenviarse. Solo cuentan los de `AUTOENVIABLES_MAXIMO`. Por omisión ninguno. */
  autoenvioPermitido?: readonly TipoSolicitud[];
}

export interface EntradaDecision {
  texto: string;
  /** Si se omite se deducen del texto. */
  tipos?: readonly TipoSolicitud[];
  /** Claves de datos CONFIRMADOS que el sistema tiene (campos de ficha, `sello`, `cuentaEspejo`, `hitoCruce`…). */
  datosDisponibles: readonly string[];
  contexto?: ContextoDecision;
  config?: ConfigDecision;
}

export interface Decision {
  accion: Accion;
  motivo: string;
  /** Aviso interno: a quién y con qué gravedad hay que enterar (independiente de la acción hacia el cliente). */
  nivelAviso: NivelAviso | null;
  camposFaltantes: string[];
  plantillaId?: IdPlantilla;
  nuncaDecir: string[];
  /** Cualquier respuesta al cliente espera aprobación humana. */
  requiereAprobacion: boolean;
  /** Se puede mandar una ficha con lo confirmado y «pendiente de confirmar» en lo demás (mientras se pide el resto). */
  envioParcial: boolean;
  tipos: TipoSolicitud[];
  desglose: Array<{ tipo: TipoSolicitud; accion: Accion; motivo: string }>;
}

interface Parcial { accion: Accion; motivo: string; nivel: NivelAviso | null; faltantes: string[]; plantilla?: IdPlantilla; parcial?: boolean }

const maxNivel = (a: NivelAviso | null, b: NivelAviso | null): NivelAviso | null => (a === null ? b : b === null ? a : RANGO_NIVEL[a] >= RANGO_NIVEL[b] ? a : b);
const masConservadora = (a: Accion, b: Accion): Accion => (CONSERVADURIA[a] >= CONSERVADURIA[b] ? a : b);

const PIDE_COBRO = /\b(cargo|cargos|cuanto|costo|cobr\w{0,4}|falso|falsos|demora|demoras|estadia|estadias|tarifa|monto|cotiz\w{0,5})\b/;
const CORRECCION_DOC = /\b(mal|corregir|correccion|corrijan|error|equivocad\w{0,3}|debe ser|viene un|falta el|peso|origen|rfc|edificio)\b/;
const AUTORIZA_CLIENTE = /\badelante con el viaje\b|\bluz verde\b|\bautorizad[oa] (la )?salida\b|\bpueden salir\b/;

// Frases que un borrador nunca debe contener (sobre texto normalizado).
const VIOLACIONES: ReadonlyArray<readonly [string, RegExp]> = [
  ['promesa_de_eta', /\b(llego|llega|llegamos|llegara|llegaran|estara|estaran) (a las|en \d+|en una hora|en unas horas|hoy a)\b|\bte aseguro\b|\bgarantiz\w{0,4}\b|\bsin falta\b/],
  ['autoriza_salida', /\b(adelante con el viaje|ya (puedes|puede|pueden) salir|esta autorizad[oa]|ya tienes luz verde|ya tiene luz verde)\b/],
  ['cotiza_o_niega_cobro', /\b(no habra cargo|sin cargo|el falso es|se cobra|cuesta|nos cuesta)\b|\$\s?\d|\b\d+\s?(usd|mxn|dolares|pesos)\b/],
  ['culpa_a_terceros', /\bes culpa de\b|\bculpa de la planta\b|\bculpa del cliente\b/],
  ['disponibilidad_por_decision_propia', /\b(no hay unidad|no tenemos (unidades|disponibilidad)|mañana la colocamos|manana la colocamos)\b/],
];

/** Violaciones de forma/fondo en un borrador de respuesta al cliente. Puro; no juzga el estilo, solo lo prohibido. */
export function violacionesDeBorrador(borrador: string, datosDisponibles: readonly string[] = []): string[] {
  const n = normalizar(borrador ?? '');
  const datos = new Set(datosDisponibles);
  const out: string[] = [];
  for (const [codigo, r] of VIOLACIONES) if (r.test(n)) out.push(codigo);
  if (/\bya cruzo\b|\bya esta en patio\b/.test(n) && !datos.has('hitoCruce')) out.push('cruce_sin_registro');
  if (/\bya (esta|quedo|fue) (timbrad|sellad)\w*/.test(n) && !datos.has('estadoCcp')) out.push('documento_sin_registro');
  if (/\bsello\b[^.]{0,20}\b\d{4,}\b/.test(n) && !datos.has('sello')) out.push('sello_sin_registro');
  const ac = revisarAcuse(borrador ?? '');
  if (ac.motivos.includes('frase_vacia')) out.push('acuse_vacio');
  return [...new Set(out)];
}

function decidirTipo(tipo: TipoSolicitud, e: EntradaDecision, texto: string): Parcial {
  const ctx = e.contexto ?? {};
  const cfg = e.config ?? {};
  const reglas = cfg.reglas ?? REGLAS_POR_OMISION;
  const datos = new Set(e.datosDisponibles ?? []);
  const m = MATRIZ[tipo];
  const n = normalizar(texto);
  const faltan = (claves: readonly string[]): string[] => claves.filter((c) => !datos.has(c));
  const base = (accion: Accion, motivo: string, extra: Partial<Parcial> = {}): Parcial => ({
    accion, motivo, nivel: m.avisoBase, faltantes: [], plantilla: m.plantilla ?? undefined, ...extra,
  });
  const pedir = (f: string[], motivo: string, plantilla: IdPlantilla | undefined = m.plantilla ?? 'falta_dato'): Parcial => ({ accion: 'pedir_dato_a_persona', motivo, nivel: maxNivel('N1', m.avisoBase), faltantes: f, plantilla });

  switch (tipo) {
    case 'autorizacion_salida': {
      if (ctx.salidaSinAutorizacion) return { accion: 'escalar_gerente', motivo: 'salida_sin_autorizacion', nivel: 'N2', faltantes: [] };
      if (ctx.emisor !== 'equipo' && ctx.emisor !== 'operador' && AUTORIZA_CLIENTE.test(n)) {
        return { accion: 'solo_registrar', motivo: 'autorizacion_del_cliente_se_registra_y_se_avisa', nivel: 'N1', faltantes: [] };
      }
      return { accion: 'prohibido', motivo: 'el_agente_no_autoriza_ni_sugiere_salidas', nivel: 'N1', faltantes: datos.has('fotosCompletas') ? [] : ['fotosCompletas'] };
    }
    case 'ficha_unidad': {
      const oblig = reglas.camposFichaObligatorios;
      const falta = faltan(oblig);
      if (cfg.mostrarDatosOperador === true && ctx.solicitanteVerificado !== true) return { accion: 'avisar_encargado', motivo: 'datos_sensibles_sin_solicitante_verificado', nivel: 'N1', faltantes: [] };
      if (falta.length === 0) return base('responder_con_datos', 'ficha_con_todo_lo_obligatorio_confirmado', { nivel: null });
      const algunDato = falta.length < oblig.length;
      return { accion: 'pedir_dato_a_persona', motivo: algunDato ? 'ficha_con_campos_pendientes' : 'sin_asignacion_confirmada', nivel: 'N1', faltantes: falta, plantilla: algunDato ? 'ficha_unidad' : 'falta_dato', parcial: algunDato };
    }
    case 'eta': {
      const ev = ctx.eta;
      if (!ev) return pedir(['eta_vigente'], 'sin_eta_vigente', 'falta_dato');
      if (ev.retenerEnvio) return { accion: ev.nivel === 'N2' ? 'escalar_gerente' : 'avisar_encargado', motivo: 'eta_se_retiene_hasta_confirmar_con_persona', nivel: ev.nivel === 'ninguno' ? 'N1' : ev.nivel, faltantes: ev.faltan, plantilla: 'falta_dato' };
      if (!ev.puedeDecir) return { accion: 'pedir_dato_a_persona', motivo: 'eta_no_vigente', nivel: ev.nivel === 'N2' ? 'N2' : 'N1', faltantes: ev.faltan.length ? ev.faltan : ['eta_vigente'], plantilla: 'falta_dato' };
      const nivel: NivelAviso | null = ev.nivel === 'ninguno' ? (ev.avisarRetraso ? 'N1' : null) : ev.nivel;
      return { accion: nivel === 'N2' ? 'escalar_gerente' : 'responder_con_datos', motivo: ev.avisarRetraso ? 'eta_vigente_con_retraso_previsto' : 'eta_vigente', nivel, faltantes: [], plantilla: 'eta_vigente' };
    }
    case 'ccp': {
      const lim = cfg.ccpSinTimbrarMin ?? 60;
      if ((ctx.ccpMinSinTimbrar ?? 0) >= lim) return { accion: 'escalar_gerente', motivo: 'ccp_sin_timbrar_mas_de_una_hora', nivel: 'N2', faltantes: [], plantilla: 'falta_dato' };
      if (CORRECCION_DOC.test(n)) return { accion: 'solo_registrar', motivo: 'correccion_documental_se_registra_y_pasa_a_importacion', nivel: 'N1', faltantes: [], plantilla: 'falta_dato' };
      return base('avisar_encargado', 'carta_porte_la_atiende_una_persona', { plantilla: 'falta_dato' });
    }
    case 'pod_doda': {
      if (ctx.soloHayCartaPorteSellada) return pedir(['documentoPod'], 'la_carta_porte_sellada_no_es_pod', 'falta_dato');
      const f = faltan(['documentoPod']);
      return f.length ? pedir(['documentoPod'], 'pod_sin_registrar', 'falta_dato') : base('responder_con_datos', 'pod_registrado', { nivel: null, plantilla: undefined });
    }
    case 'estatus_planta_ingreso': {
      const esp = ctx.operadorEsperandoMin ?? 0;
      const n3 = cfg.esperaPlantaN3Min ?? 600;
      const n2 = cfg.esperaPlantaN2Min ?? 300;
      const plant: IdPlantilla = datos.has('estatusPlanta') ? 'estatus_planta' : 'falta_dato';
      if (esp >= n3) return { accion: 'escalar_gerente', motivo: 'operador_espera_extrema_en_planta', nivel: 'N3', faltantes: faltan(['estatusPlanta']), plantilla: plant };
      if (esp >= n2) return { accion: 'escalar_gerente', motivo: 'operador_espera_larga_en_planta', nivel: 'N2', faltantes: faltan(['estatusPlanta']), plantilla: plant };
      const f = faltan(['estatusPlanta']);
      return f.length ? pedir(['estatusPlanta'], 'estado_de_planta_sin_registrar', 'falta_dato') : base('responder_con_datos', 'estado_de_planta_registrado', { nivel: null });
    }
    case 'estatus_cruce': {
      const f = faltan(['hitoCruce']);
      return f.length ? { accion: 'pedir_dato_a_persona', motivo: 'sin_confirmacion_de_cruce', nivel: 'N1', faltantes: ['hitoCruce'], plantilla: 'estatus_cruce' } : base('responder_con_datos', 'hito_de_cruce_registrado', { nivel: null });
    }
    case 'estatus_ruta_detencion': {
      if (ctx.desvioDeRuta) return { accion: 'escalar_gerente', motivo: 'desvio_de_ruta', nivel: 'N2', faltantes: [], plantilla: datos.has('posicionGps') ? 'detencion' : 'falta_dato' };
      if (ctx.paradaNoAutorizada) return { accion: 'avisar_encargado', motivo: 'parada_no_autorizada', nivel: 'N1', faltantes: faltan(['posicionGps']), plantilla: datos.has('posicionGps') ? 'detencion' : 'falta_dato' };
      const f = faltan(['posicionGps']);
      return f.length ? pedir(['posicionGps'], 'sin_posicion_gps_vigente', 'falta_dato') : base('responder_con_datos', 'posicion_gps_registrada', { nivel: null });
    }
    case 'cancelacion_falso': {
      if (PIDE_COBRO.test(n)) return { accion: 'escalar_gerente', motivo: 'el_agente_no_cotiza_ni_niega_cobros', nivel: 'N2', faltantes: [] };
      return { accion: 'solo_registrar', motivo: 'cancelacion_se_registra_y_se_avisa_riesgo_de_falso', nivel: 'N2', faltantes: [] };
    }
    case 'datos_operador': {
      if (ctx.solicitanteVerificado === true) return { accion: 'avisar_encargado', motivo: 'datos_del_operador_los_decide_una_persona', nivel: 'N1', faltantes: [] };
      return { accion: 'solo_registrar', motivo: 'solicitante_no_verificado_pide_datos_del_operador', nivel: 'N2', faltantes: [] };
    }
    case 'cambio_unidad_operador': {
      if ((ctx.cambiosDeUnidadEn60Min ?? 0) >= 2) return { accion: 'escalar_gerente', motivo: 'cambios_repetidos_de_unidad', nivel: 'N2', faltantes: [], plantilla: 'ficha_unidad' };
      return base('avisar_encargado', 'cambio_de_unidad_se_confirma_con_persona');
    }
    case 'prealerta_acceso':
      return base('avisar_encargado', 'prealerta_se_avisa_al_encargado');
    case 'incidencia':
      return { accion: 'escalar_gerente', motivo: 'incidencia_se_escala_de_inmediato', nivel: ctx.zonaDeRiesgoOHazmat ? 'N3' : 'N2', faltantes: [] };
    case 'cambio_instruccion':
      return { accion: 'escalar_gerente', motivo: 'cambio_de_instruccion_lo_confirma_una_persona', nivel: 'N2', faltantes: [] };
    case 'pool_programa': {
      if (ctx.programaRecibido) return { accion: ctx.programaCambio ? 'avisar_encargado' : 'solo_registrar', motivo: ctx.programaCambio ? 'programa_con_cambios' : 'programa_recibido_sin_confirmar_capacidad', nivel: ctx.programaCambio ? 'N1' : null, faltantes: [], plantilla: 'confirmacion_programa' };
      const f = faltan(['inventarioConfirmado']);
      return f.length ? pedir(['inventarioConfirmado'], 'inventario_sin_confirmar', 'falta_dato') : base('responder_con_datos', 'inventario_confirmado', { nivel: null, plantilla: undefined });
    }
    case 'qr_acceso': {
      const falta = faltan(reglas.camposQr);
      return falta.length ? { accion: 'pedir_dato_a_persona', motivo: 'qr_con_datos_incompletos', nivel: 'N1', faltantes: falta, plantilla: 'qr_acceso' } : base('responder_con_datos', 'qr_con_datos_completos', { nivel: null });
    }
    case 'cuenta_espejo': case 'sello_foto': case 'caja_vacia_colocacion': case 'candado_gps_stock': case 'facturacion_documentos': {
      const f = faltan(m.requiere);
      if (f.length === 0) return base(m.conDatos, 'dato_confirmado', { nivel: m.avisoBase });
      return m.sinDatos === 'pedir_dato_a_persona' ? pedir(f, 'dato_sin_registrar', tipo === 'cuenta_espejo' ? 'falta_dato' : (m.plantilla === 'colocacion_remolque' ? 'falta_dato' : m.plantilla ?? 'falta_dato')) : base(m.sinDatos, 'dato_sin_registrar', { faltantes: f, plantilla: 'falta_dato' });
    }
    default:
      return base(m.sinDatos, 'solicitud_no_reconocida_va_a_una_persona', { plantilla: undefined });
  }
}

/** Decide qué hace el agente. Puro y determinista; ante la duda, una persona. */
export function decidirAccion(entrada: EntradaDecision): Decision {
  const ctx = entrada.contexto ?? {};
  const cfg = entrada.config ?? {};
  const texto = entrada.texto ?? '';
  const detectados = entrada.tipos && entrada.tipos.length > 0 ? [...entrada.tipos] : detectarSolicitudes(texto);
  const peticiones = tiposDePeticion(detectados);
  // Un programa publicado por el cliente no es una petición: se registra (y no se mezcla con «drop» ni «vivo» del listado).
  const tiposResueltos: TipoSolicitud[] = ctx.programaRecibido ? ['pool_programa'] : peticiones.length > 0 ? peticiones : [detectados.includes('urgencia') ? 'urgencia' : 'otro'];

  const desglose: Decision['desglose'] = [];
  let accion: Accion = 'responder_con_datos';
  let nivel: NivelAviso | null = null;
  let motivo = '';
  let plantilla: IdPlantilla | undefined;
  let parcial = false;
  const faltantes: string[] = [];
  const nunca = new Set<string>(NUNCA_DECIR_GENERAL);
  let primero = true;
  for (const t of tiposResueltos) {
    const p = decidirTipo(t, entrada, texto);
    desglose.push({ tipo: t, accion: p.accion, motivo: p.motivo });
    for (const x of p.faltantes) if (!faltantes.includes(x)) faltantes.push(x);
    for (const x of MATRIZ[t].nunca) nunca.add(x);
    const gana = primero || CONSERVADURIA[p.accion] > CONSERVADURIA[accion];
    if (gana) { motivo = p.motivo; plantilla = p.plantilla; parcial = p.parcial === true; }
    accion = primero ? p.accion : masConservadora(accion, p.accion);
    nivel = maxNivel(nivel, p.nivel);
    primero = false;
  }
  if (tiposResueltos.includes('eta')) for (const x of NUNCA_DECIR_ETA) nunca.add(x);
  const motivos = new Set<string>([motivo]);
  const endurecer = (a: Accion, n: NivelAviso | null, m: string): void => {
    const antes = accion;
    accion = masConservadora(accion, a);
    nivel = maxNivel(nivel, n);
    if (accion !== antes || n !== null) motivos.add(m);
  };

  // Señales que solo endurecen.
  if (ctx.solicitanteVerificado === false) endurecer('solo_registrar', tiposResueltos.includes('datos_operador') ? 'N2' : 'N1', 'solicitante_no_autorizado');
  const disc = ctx.discrepancias ?? [];
  if (disc.length > 0) { endurecer('avisar_encargado', 'N1', `discrepancia_detectada:${disc.join(',')}`); }
  const esperaRepregunta = cfg.repreguntaEsperaMin ?? 10;
  if ((ctx.repreguntas ?? 0) >= 1 && (ctx.minutosEsperando ?? 0) >= esperaRepregunta) endurecer(accion === 'responder_con_datos' ? 'responder_con_datos' : accion, 'N1', 'repregunta_sin_dato');
  if (ctx.rafaga) endurecer('escalar_gerente', 'N2', 'rafaga_de_mensajes_sin_respuesta');
  const urgenteDetectado = ctx.urgente === true || detectados.includes('urgencia') || detectarUrgencia(texto);
  if (urgenteDetectado) endurecer(accion, 'N1', 'urgencia_declarada');
  const esc = ctx.escalamiento;
  if (esc && esc.nivel !== 'ninguno') {
    const n = esc.nivel as NivelAviso;
    const sube = accion !== 'prohibido' && accion !== 'escalar_gerente' && (RANGO_NIVEL[n] >= 3 || (RANGO_NIVEL[n] >= 2 && (accion === 'responder_con_datos' || accion === 'pedir_dato_a_persona' || accion === 'avisar_encargado')));
    endurecer(sube ? 'escalar_gerente' : accion, n, `escalamiento_${esc.nivel}`);
  }
  if (ctx.borrador !== undefined) {
    const v = violacionesDeBorrador(ctx.borrador, entrada.datosDisponibles);
    if (v.length > 0) { accion = 'prohibido'; nivel = maxNivel(nivel, 'N1'); motivos.add(`borrador_con_frase_prohibida:${v.join(',')}`); }
  }

  const permitidos = new Set((cfg.autoenvioPermitido ?? []).filter((x) => AUTOENVIABLES_MAXIMO.includes(x)));
  const podriaAuto = accion === 'responder_con_datos' && nivel === null && tiposResueltos.every((t) => permitidos.has(t) && !MATRIZ[t].aprobacionSiempre);
  return {
    accion,
    motivo: [...motivos].filter(Boolean).join(' | '),
    nivelAviso: nivel,
    camposFaltantes: faltantes,
    plantillaId: plantilla,
    nuncaDecir: [...nunca],
    requiereAprobacion: !podriaAuto,
    envioParcial: parcial && accion === 'pedir_dato_a_persona',
    tipos: urgenteDetectado && !tiposResueltos.includes('urgencia') ? [...tiposResueltos, 'urgencia'] : tiposResueltos,
    desglose,
  };
}

/**
 * Arma la entrada de `decidirAccion` desde un hilo: texto y tipos de lo que el cliente tiene SIN atender, minutos de espera, repreguntas,
 * ráfaga y el resultado de `evaluarEscalamiento`. Es el único punto donde se juntan los dos evaluadores; no lee nada de la base.
 */
export function entradaDesdeHilo(
  hilo: Hilo,
  datosDisponibles: readonly string[],
  opciones: { contexto?: ContextoDecision; config?: ConfigDecision; escalamiento?: Partial<ConfigEscalamiento>; texto?: string; tipos?: readonly TipoSolicitud[] } = {},
): EntradaDecision {
  const cfgEsc = opciones.escalamiento;
  const rafagaMin = cfgEsc?.rafagaUnMensajeMin ?? 2;
  const pend = mensajesSinAtender(hilo.mensajes ?? [], rafagaMin);
  const desde = pend.length > 0 ? pend[0].tsMs : Infinity;
  const textoPend = (hilo.mensajes ?? []).filter((m) => m.de === 'cliente' && m.tsMs >= desde).map((m) => m.texto).join('\n');
  const esc = evaluarEscalamiento(hilo, cfgEsc);
  const ventana = (cfgEsc?.repreguntaVentanaMin ?? 30) * 60_000;
  const nRafaga = pend.filter((m) => hilo.ahoraMs - m.tsMs <= ventana + 60_000).length;
  const ctx: ContextoDecision = {
    minutosEsperando: esc.esperaMin,
    repreguntas: Math.max(0, pend.length - 1),
    rafaga: nRafaga >= (cfgEsc?.repreguntaMensajes ?? 3),
    escalamiento: esc,
    ...opciones.contexto,
  };
  return { texto: opciones.texto ?? textoPend, tipos: opciones.tipos, datosDisponibles, contexto: ctx, config: opciones.config };
}
