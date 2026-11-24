// ═══════════════════════════════════════════════════════════════════════════
// VALIDACIONES DE ERRORES HUMANOS (V01-V21) — tipos compartidos.
//
// Todo en este directorio es PURO: sin base, sin red, sin reloj (la fecha de referencia entra por `contexto.ahora`). Nunca
// lanzan: una entrada incompleta produce un hallazgo explícito de «dato ausente», nunca un supuesto. Ninguna validación corrige
// el dato por la persona: retiene, avisa y sugiere.
//
// Los mensajes son genéricos: pueden nombrar números de caja o referencias (no son datos personales), pero NUNCA repiten
// placas, licencias, celulares ni nombres.
// ═══════════════════════════════════════════════════════════════════════════

export type Severidad = 'info' | 'aviso' | 'bloqueo';

export const IDS_VALIDACION = [
  'V01', 'V02', 'V03', 'V04', 'V05', 'V06', 'V07', 'V08', 'V09', 'V10', 'V11',
  'V12', 'V13', 'V14', 'V15', 'V16', 'V17', 'V18', 'V19', 'V20', 'V21',
] as const;
export type IdValidacion = (typeof IDS_VALIDACION)[number];
/** `P01` no es de la lista V01-V21: es la regla de privacidad (datos del operador a solicitante no verificado). */
export type IdHallazgo = IdValidacion | 'P01';

export type FamiliaValidacion =
  | 'placas_cajas'
  | 'personas_licencias'
  | 'fechas_horarios'
  | 'documentos_sellos'
  | 'cambios_prealerta'
  | 'privacidad_identidad';

export interface Hallazgo {
  id: IdHallazgo;
  severidad: Severidad;
  mensaje: string;
  /** Rutas de campo (p. ej. `caja.placas`) que originan el hallazgo. */
  camposInvolucrados: string[];
  sugerencia: string;
  /** true cuando el hallazgo es «falta el dato X», no una discrepancia. */
  datoAusente?: boolean;
}

// ── Entradas ────────────────────────────────────────────────────────────────

export interface FechaCapturada {
  /** Nombre del campo de origen (p. ej. `cita`, `ccp`). */
  campo: string;
  /** Texto TAL COMO se capturó: `2026-11-23`, `23/11/2026`, `23-11-26`, `23/11`. */
  texto: string;
  /** Día de la semana que dijo quien escribió («lunes»), si lo dijo. */
  diaSemana?: string;
  /** true para fechas que legítimamente son pasadas (entregas ya hechas). */
  permitePasado?: boolean;
}

export interface EtaFicha {
  /** ISO `AAAA-MM-DDTHH:MM`. */
  valor?: string;
  punto?: 'planta' | 'patio';
  /** Etiqueta de zona (Centro, Laredo…). */
  zona?: string;
  actualizadoEn?: string;
  /** Causa registrada del cambio respecto de `anterior`. */
  causaCambio?: string;
  anterior?: string;
}

export interface FichaValidable {
  ref?: string;
  /** Referencias citadas en el mensaje o la CI que se está validando. */
  refsCitadas?: string[];
  /** Caja citada en el mensaje/CI (puede no ser la asignada). */
  cajaCitada?: string;
  /** ISO de la cita. */
  cita?: string;
  caja?: { linea?: string; numero?: string; placas?: string; estado?: string; tipo?: string };
  unidad?: { eco?: string; placa?: string; tag?: string };
  operador?: {
    nombre?: string;
    licencia?: string;
    /** ISO de fecha. */
    vigenciaLicencia?: string;
    celular?: string;
    estado?: 'disponible' | 'descanso' | 'no_disponible';
    descansoHasta?: string;
    horasDisponibles?: number;
    gafete?: string;
  };
  team?: { nombre?: string };
  blindado?: boolean;
  tipoTracto?: string;
  dropQuitapon?: boolean;
  qp?: string;
  sello?: string;
  /** Sello leído de la foto o del mensaje (no el declarado). */
  selloFoto?: string;
  ce?: { url?: string; venceEn?: string };
  cajaDeTerceros?: boolean;
  eta?: EtaFicha;
  fechas?: FechaCapturada[];
  /** ISO de la fecha impresa en el documento (CCP/CI) a comparar con la cita. */
  fechaDocumento?: string;
  movimiento?: { tipo: 'colocacion' | 'cruce' | 'recoleccion'; fechaHora?: string };
  /** ISO de fecha/hora de salida y duración estimada del viaje (horas). */
  salida?: string;
  horasViaje?: number;
  planta?: string;
  origenCcp?: string;
  accesorios?: { gatas?: number; straps?: number };
  placasEnDocumentos?: Array<{ origen: string; placaCaja?: string; placaTracto?: string }>;
  avc?: { operador?: string; gafete?: string; tag?: string };
  /** QR de acceso: campo → valor. */
  qr?: Record<string, string | undefined>;
  modoQr?: boolean;
}

export interface CajaInventario {
  numero: string;
  linea?: string;
  placas?: string;
  estado?: string;
  ubicacion?: string;
}

export interface DocumentoMeta {
  tipo: string;
  ref?: string;
  caja?: string;
  placasCaja?: string;
  sello?: string;
  /** ISO de fecha de emisión. */
  fecha?: string;
}

export interface VigenciaDocumento {
  tipo: string;
  /** ISO de fecha hasta la que es válido; ausente = vigencia desconocida. */
  hasta?: string;
}

export interface ContextoValidacion {
  /** ISO `AAAA-MM-DDTHH:MM`: la fecha/hora de referencia (inyectada; el módulo no lee reloj). */
  ahora: string;
  catalogoCajas?: CajaInventario[];
  catalogoUnidades?: Array<{ eco: string; placa?: string; tag?: string }>;
  /** Caja asignada al servicio. */
  cajaAsignada?: string;
  ubicacionEsperada?: string;
  /** Tabla ref→caja PROVISTA por la flota. Nunca se infiere. */
  equivalencias?: Array<{ ref: string; caja: string }>;
  /** Lo que dice la instrucción del cliente (CI) / el programa. */
  ci?: { tipoCaja?: string; tipoTracto?: string; planta?: string; origenCcp?: string; gatas?: number };
  prealerta?: { enviadaEn?: string; huella?: string; sello?: string };
  /** ISO de los cambios ya registrados para este servicio. */
  cambiosRecientes?: string[];
  documentos?: DocumentoMeta[];
  vigencias?: VigenciaDocumento[];
  inspeccionRojo?: boolean;
  /** Sello registrado por caja (para detectar el mismo sello en dos cajas). */
  selloPorCaja?: Array<{ caja: string; sello: string }>;
  pod?: { clasificacion?: string; fecha?: string; legible?: boolean; recibidos?: string[] };
  entrega?: { horaEntrega?: string };
  evidenciaSalida?: { fotos: Array<{ tipo: string; legible?: boolean }> };
  correo?: { de?: string; para?: string[]; cc?: string[] };
  historialEta?: Array<{ valor: string; registradoEn: string }>;
  otrasEtas?: Array<{ caja: string; valor: string }>;
  /** A quién se va a enviar la ficha. */
  destinatario?: { id: string; verificado: boolean };
  /** Solicitantes autorizados por la flota a recibir datos del operador. */
  listaBlancaDatosOperador?: string[];
}

export interface ConfigValidaciones {
  /** Regex (fuente) genérica de placa; por defecto la misma forma que el CHECK de `vigia_caja`. */
  formatoPlacaGenerico: string;
  /** Regex (fuente) por estado/país (clave en mayúsculas); los chats no dan formatos: viene de la flota. */
  formatoPlacaPorEstado: Record<string, string>;
  exigirEstadoCaja: boolean;
  /** Prefijos de línea que se quitan al comparar números de caja. */
  prefijosCaja: string[];
  diasAvisoVigencia: number;
  /** Rutas de campo obligatorias de la ficha (por cliente). */
  camposObligatorios: string[];
  /** Si true, licencia, vigencia y celular también son obligatorios (política de privacidad de la flota). */
  exigirSensibles: boolean;
  digitosCelular: number;
  minPalabrasNombre: number;
  exigirZonaHoraria: boolean;
  /** Ventanas HH:MM por tipo de movimiento. Vacío = no configurado (se reporta, no se asume). */
  ventanasPorMovimiento: Partial<Record<'colocacion' | 'cruce' | 'recoleccion', { desde: string; hasta: string }>>;
  /** Fechas ISO festivas/extraordinarias. */
  fechasExtraordinarias: string[];
  domingoExtraordinario: boolean;
  ventanaInestableMin: number;
  maxAntiguedadEtaMin: number;
  toleranciaEtaContiguaMin: number;
  retrasoEscalaMin: number;
  minutosSelloPendiente: number;
  exigirSuspensionAire: boolean;
  checklistSalida: string[];
  /** Documentos que componen el POD para este cliente. Vacío = no configurado. */
  requisitosPod: string[];
  /** Buzón compartido de cruces/SAC que debe ir en copia. null = no configurado. */
  buzonCompartido: string | null;
  /** `ficha`: solo lo esencial de la ficha reporta ausentes; `todo`: cada validación no evaluable lo dice. */
  reportarAusentes: 'ficha' | 'todo';
}

export interface FilaPool {
  caja: string;
  ubicacion?: string;
  linea?: string;
  tipo?: string;
  suspensionAire?: boolean;
  /** ISO de fecha del reporte/servicio. */
  dia?: string;
  /** Servicio al que está asignada, si lo está. */
  servicio?: string;
  estado?: string;
}

export interface ContextoPool {
  ahora: string;
  lineaEsperada?: string;
  catalogoCajas?: CajaInventario[];
}

export interface ServicioPrograma {
  hora: string;
  planta?: string;
  modalidad?: string;
  tipoCaja?: string;
  cancelado?: boolean;
}

export interface Regla {
  id: IdValidacion;
  nombre: string;
  familia: FamiliaValidacion;
  /** Qué datos necesita (documentación y mensaje de «no evaluada»). */
  entradas: string[];
  /** true = siempre se evalúa y reporta sus propios ausentes. */
  nucleo: boolean;
  aplica: (f: FichaValidable, c: ContextoValidacion) => boolean;
  evaluar: (f: FichaValidable, c: ContextoValidacion, cfg: ConfigValidaciones) => Hallazgo[];
}
