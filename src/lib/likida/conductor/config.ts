import { TZ_MX, diaEnZona } from '@/lib/formato';
import { zonaValida } from '../conectores/tabla_propia/tiempo';

// ═══════════════════════════════════════════════════════════════════════════
// LA CONFIGURACIÓN POR FLOTA DEL AGENTE 5 (agente_conductor_config, 0380).
// Puro: la lectura de la fila vive en repo.ts (`leerConfigConductor`).
//
// Sin fila = DEFAULTS de abajo: el agente nace encendido con la escalera
// 0/+15/+30/+45 min, escalación a los +90 y ventana 06:00–22:00 todos los días.
// Los plazos «sin cita» son SUPUESTOS (no mediciones): la flota los ajusta.
// ═══════════════════════════════════════════════════════════════════════════

export interface ConfigConductor {
  activo: boolean;
  /** Minutos desde que toca el hito: 0 = solicitud, los demás = recordatorios 1..n. */
  solicitudesMin: number[];
  escalarTrasMin: number;
  segundoNivelMin: number;
  horaInicio: number;
  horaFin: number;
  /** ISO: 1 = lunes … 7 = domingo. */
  diasSemana: number[];
  topeDiarioChofer: number;
  anticipoCitaMin: number;
  esperaSinCitaMin: number;
  esperaCargaMin: number;
  trayectoSinEtaMin: number;
  esperaDescargaMin: number;
  regresoMin: number;
  posponerMin: number;
  ventanaCorreccionMin: number;
  usarLlm: boolean;
  avisarOficinaLlegada: boolean;
  avisarOficinaSalida: boolean;
  confirmarAlChofer: boolean;
  /** 0385: comparar cada llegada contra el sitio del viaje (pin de WhatsApp / GPS). */
  validarUbicacion: boolean;
  /** Metros que se SUMAN al radio del sitio antes de decir «no coincide» (supuesto, no medición). */
  toleranciaUbicacionM: number;
  /** Máxima diferencia (min) entre la hora del mensaje y la de la posición comparada. */
  ventanaUbicacionMin: number;
  /** Pedir el pin al chofer cuando falta (solo si el viaje tiene sitio asignado). */
  pedirUbicacion: boolean;
  /** Minutos en andén tras la llegada a carga/descarga que disparan la alerta de estadía. null = sin alerta. */
  estadiaAlertaCargaMin: number | null;
  estadiaAlertaDescargaMin: number | null;
  /** Invitar al chofer a mandar la foto del sello / andén / recibido tras la salida. */
  pedirFotoEvidencia: boolean;
  /** 0483: una foto con pie «sello»/«andén»/«recibido» sin hito al que colgarla REGISTRA el hito (con la foto como evidencia). */
  fotoRegistraHito: boolean;
  /** 0604: avisar al jefe de tráfico, una vez, de un «ya llegué» que sigue sin confirmarse con ubicación (o sin sitio para comparar). */
  avisarLlegadaSinConfirmar: boolean;
  /** 0604: metros ANTES del borde de la geocerca en que se manda la calle de instrucciones de la planta (convenios). */
  margenAcercamientoM: number;
  /** 0635: dar por hecho el hito cuando el GPS entra o sale del sitio del viaje, sin esperar al chofer (hito con fuente `sistema`, validado por GPS). Solo actúa con sitio asignado y GPS de la unidad. */
  detectarHitosGps: boolean;
  /** 0635: si el GPS de un tractor en tránsito queda obsoleto o detenido, preguntarle al chofer «¿sigues bien?» (2 avisos) y luego al jefe de tráfico. Apagado: manda mensajes a personas. */
  avisarSenalVida: boolean;
  /**
   * Zona IANA de la flota (`tenant.zona_horaria`, NO una columna de `agente_conductor_config`): la ventana
   * de insistencia, el día del tope diario y la hora que se le lee al chofer son de SU zona, no del servidor.
   * Sin zona o con una inválida = la de México (`TZ_MX`): el comportamiento de siempre.
   */
  zonaHoraria: string;
  /**
   * 0801: 'completo' = los 5 hitos del ciclo (defecto, el comportamiento de siempre); 'esenciales' = solo lo básico
   * (salida de carga, «dónde está» y señal de vida): un SUBCONJUNTO del ciclo, no otro alcance.
   */
  perfilSeguimiento: PerfilSeguimiento;
  /** 0801: umbrales de «sin señal de vida», en minutos. Los valores de partida son SUPUESTOS, no mediciones. */
  gpsObsoletoMin: number;
  detenidoMin: number;
  segundoAvisoMin: number;
  escalarSenalMin: number;
  silencioRespuestaMin: number;
  /** 0801: mostrar los estados de frontera como hito OPCIONAL visible (no escala). */
  mostrarEstadosFrontera: boolean;
  /**
   * T-A5-21: horas en `pendiente_cruce` a partir de las cuales el tablero marca una excepción de LECTURA (no avisa a nadie).
   * Ausente o null = desactivado (por omisión). Aún sin columna propia: se fija al armar la configuración hasta que exista.
   */
  umbralPendienteCruceH?: number | null;
  /**
   * T-A5-36: compuerta «unidad detenida». Encendida, NINGÚN mensaje proactivo al chofer sale si el GPS no confirma la unidad detenida
   * (o dentro de un sitio del viaje). Apagada (por omisión, hasta la fase 2) = el comportamiento de siempre. Aún sin columna propia:
   * se fija al armar la configuración hasta que exista; ausente = el valor de partida.
   */
  compuertaMovimientoActiva?: boolean;
  /** T-A5-36: metros de desplazamiento dentro de `detenidaVentanaMin` a partir de los cuales la unidad «va en marcha» (SUPUESTO del cliente; D-6). */
  detenidaMetros?: number;
  /** T-A5-36: ventana (min) en que se mide el desplazamiento y se exigen ≥ 3 muestras para dar la unidad por detenida. */
  detenidaVentanaMin?: number;
  /** T-A5-36: sin GPS reciente, ¿se le puede escribir? Por omisión NO (falla cerrado). */
  sinGpsPermite?: boolean;
  /**
   * T-A5-40: `exigir_sello_inicio`. Encendida, un «ya salí» (inicio de viaje) de un viaje de IMPORTACIÓN sin foto de sello reciente NO
   * se registra: se le pide la foto primero. Apagada (por omisión) = el inicio se registra y solo se le RECOMIENDA la foto. En exportación
   * nunca se exige (el sello previo es de importación). Aún sin columna propia: se fija al armar la configuración; ausente = apagada.
   */
  exigirSelloInicio?: boolean;
  /**
   * T-A5-44: preguntar al chofer en qué patio entrega (botones del catálogo + «otro») y avisar al supervisor si difiere del esperado.
   * Apagado por omisión (hasta la fase 2). Aún sin columna propia: se fija al armar la configuración; ausente = apagado.
   */
  patioEntregaActivo?: boolean;
  /** T-A5-44 (D-5, configuración y no decisión nuestra): qué campo manda como patio esperado. Por omisión «Entregar en». */
  patioQueManda?: 'entregar_en' | 'destino';
  /** 0801: aplicar la salida que reporta el TMS como hito del viaje. */
  aplicarSalidaDelTms: boolean;
  /** 0801: llamadas de seguimiento por viaje medidas antes del agente (null = sin registrar) y la fecha (AAAA-MM-DD) en que se midió. */
  lineaBaseLlamadasPorViaje: number | null;
  lineaBaseRegistradaEn: string | null;
}

export const PERFILES_SEGUIMIENTO = ['esenciales', 'completo'] as const;
export type PerfilSeguimiento = typeof PERFILES_SEGUIMIENTO[number];

export const CONFIG_CONDUCTOR_DEFAULT: Readonly<ConfigConductor> = Object.freeze({
  activo: true,
  solicitudesMin: [0, 15, 30, 45],
  escalarTrasMin: 90,
  segundoNivelMin: 30,
  horaInicio: 6,
  horaFin: 22,
  diasSemana: [1, 2, 3, 4, 5, 6, 7],
  topeDiarioChofer: 12,
  anticipoCitaMin: 30,
  esperaSinCitaMin: 120,
  esperaCargaMin: 120,
  trayectoSinEtaMin: 480,
  esperaDescargaMin: 120,
  regresoMin: 30,
  posponerMin: 30,
  ventanaCorreccionMin: 60,
  usarLlm: true,
  avisarOficinaLlegada: false,
  avisarOficinaSalida: false,
  confirmarAlChofer: true,
  validarUbicacion: true,
  toleranciaUbicacionM: 150,
  ventanaUbicacionMin: 30,
  pedirUbicacion: true,
  estadiaAlertaCargaMin: null,
  estadiaAlertaDescargaMin: null,
  pedirFotoEvidencia: false,
  fotoRegistraHito: true,
  avisarLlegadaSinConfirmar: false,
  margenAcercamientoM: 5000,
  detectarHitosGps: true,
  avisarSenalVida: false,
  zonaHoraria: TZ_MX,
  perfilSeguimiento: 'completo',
  gpsObsoletoMin: 45,
  detenidoMin: 60,
  segundoAvisoMin: 20,
  escalarSenalMin: 20,
  silencioRespuestaMin: 120,
  mostrarEstadosFrontera: false,
  aplicarSalidaDelTms: false,
  compuertaMovimientoActiva: false,
  detenidaMetros: 150,
  detenidaVentanaMin: 5,
  sinGpsPermite: false,
  exigirSelloInicio: false,
  patioEntregaActivo: false,
  patioQueManda: 'entregar_en',
  lineaBaseLlamadasPorViaje: null,
  lineaBaseRegistradaEn: null,
});

/** El tope de aplazamientos por hito: pasado esto «voy con retraso» ya no calla al agente. */
export const MAX_POSPOSICIONES = 2;

function entero(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/**
 * Valida y NORMALIZA una config que viene de un formulario o de la base. Devuelve
 * el error en palabras de pantalla, o la config lista para guardar. Los mismos
 * rangos que los CHECK de la 0380: una config que pasa aquí no rebota en la base.
 */
export function validarConfigConductor(cruda: Partial<ConfigConductor>): { ok: ConfigConductor } | { error: string } {
  const b = { ...CONFIG_CONDUCTOR_DEFAULT, ...cruda };

  const sol = (Array.isArray(b.solicitudesMin) ? b.solicitudesMin : []).map((x) => entero(x, 0, 9999));
  if (sol.length < 1 || sol.length > 6 || sol.some((x) => x === null)) {
    return { error: 'La escalera necesita entre 1 y 6 valores en minutos (0 a 9999).' };
  }
  const solicitudesMin = sol as number[];
  if (solicitudesMin.some((x, i) => i > 0 && x <= solicitudesMin[i - 1])) {
    return { error: 'Los minutos de la escalera tienen que ir en orden ascendente y sin repetirse.' };
  }

  const horaInicio = entero(b.horaInicio, 0, 23);
  const horaFin = entero(b.horaFin, 1, 24);
  if (horaInicio === null) return { error: 'La hora de inicio va de 0 a 23.' };
  if (horaFin === null) return { error: 'La hora de fin va de 1 a 24.' };
  if (horaFin <= horaInicio) return { error: 'La ventana necesita terminar después de empezar.' };

  const dias = (Array.isArray(b.diasSemana) ? b.diasSemana : []).map((x) => entero(x, 1, 7));
  if (dias.length === 0 || dias.length > 7 || dias.some((x) => x === null)) {
    return { error: 'El agente necesita al menos un día permitido (1 = lunes … 7 = domingo).' };
  }
  const diasSemana = [...new Set(dias as number[])].sort((a, c) => a - c);

  const escalarTrasMin = entero(b.escalarTrasMin, 10, 1440);
  const segundoNivelMin = entero(b.segundoNivelMin, 5, 1440);
  if (escalarTrasMin === null) return { error: 'La escalación al patio va de 10 a 1,440 minutos.' };
  if (segundoNivelMin === null) return { error: 'El segundo nivel va de 5 a 1,440 minutos.' };
  // Escalar ANTES de agotar la escalera dejaría a la escalera sin sentido.
  if (escalarTrasMin <= solicitudesMin[solicitudesMin.length - 1]) {
    return { error: 'La escalación al jefe tiene que ser DESPUÉS del último recordatorio al chofer.' };
  }

  const topeDiarioChofer = entero(b.topeDiarioChofer, 1, 60);
  if (topeDiarioChofer === null) return { error: 'El tope diario por chofer va de 1 a 60 mensajes.' };

  const campos: Array<[keyof ConfigConductor, number, number, string]> = [
    ['anticipoCitaMin', 0, 600, 'El anticipo sobre la cita va de 0 a 600 minutos.'],
    ['esperaSinCitaMin', 0, 2880, 'La espera sin cita va de 0 a 2,880 minutos.'],
    ['esperaCargaMin', 0, 2880, 'La espera de carga va de 0 a 2,880 minutos.'],
    ['trayectoSinEtaMin', 0, 4320, 'El trayecto sin ETA va de 0 a 4,320 minutos.'],
    ['esperaDescargaMin', 0, 2880, 'La espera de descarga va de 0 a 2,880 minutos.'],
    ['regresoMin', 0, 2880, 'La espera del regreso va de 0 a 2,880 minutos.'],
    ['posponerMin', 5, 240, 'El aplazamiento va de 5 a 240 minutos.'],
    ['ventanaCorreccionMin', 5, 720, 'La ventana de corrección va de 5 a 720 minutos.'],
  ];
  const num: Record<string, number> = {};
  for (const [campo, min, max, msg] of campos) {
    const v = entero(b[campo], min, max);
    if (v === null) return { error: msg };
    num[campo] = v;
  }

  const toleranciaUbicacionM = entero(b.toleranciaUbicacionM, 0, 5000);
  if (toleranciaUbicacionM === null) return { error: 'La tolerancia de ubicación va de 0 a 5,000 metros.' };
  const margenAcercamientoM = entero(b.margenAcercamientoM, 0, 50_000);
  if (margenAcercamientoM === null) return { error: 'El margen de acercamiento a la planta va de 0 a 50,000 metros.' };
  const ventanaUbicacionMin = entero(b.ventanaUbicacionMin, 5, 180);
  if (ventanaUbicacionMin === null) return { error: 'La ventana para comparar la ubicación va de 5 a 180 minutos.' };
  // null = alerta apagada; un número fuera de rango NO se toma por «apagada».
  const alerta = (v: unknown, nombre: string): { ok: number | null } | { error: string } => {
    if (v === null || v === undefined || v === '') return { ok: null };
    const n = entero(v, 15, 4320);
    return n === null ? { error: `La alerta de estadía de ${nombre} va de 15 a 4,320 minutos (o vacía para apagarla).` } : { ok: n };
  };
  const alertaCarga = alerta(b.estadiaAlertaCargaMin, 'carga');
  if ('error' in alertaCarga) return { error: alertaCarga.error };
  const alertaDescarga = alerta(b.estadiaAlertaDescargaMin, 'descarga');
  if ('error' in alertaDescarga) return { error: alertaDescarga.error };

  if (!(PERFILES_SEGUIMIENTO as readonly unknown[]).includes(b.perfilSeguimiento)) {
    return { error: 'El perfil de seguimiento es «esenciales» (solo lo básico) o «completo» (el ciclo completo).' };
  }
  const umbrales: Array<[keyof ConfigConductor, string]> = [
    ['gpsObsoletoMin', 'Los minutos para dar el GPS por obsoleto van de 5 a 720.'],
    ['detenidoMin', 'Los minutos para dar la unidad por detenida van de 5 a 720.'],
    ['segundoAvisoMin', 'Los minutos hasta el segundo aviso al chofer van de 5 a 720.'],
    ['escalarSenalMin', 'Los minutos hasta avisar al jefe por falta de señal van de 5 a 720.'],
    ['silencioRespuestaMin', 'Los minutos de silencio del chofer van de 5 a 720.'],
  ];
  const umbral: Record<string, number> = {};
  for (const [campo, msg] of umbrales) {
    const v = entero(b[campo], 5, 720);
    if (v === null) return { error: msg };
    umbral[campo] = v;
  }
  // T-A5-36: la compuerta de movimiento. Un valor fuera de rango se RECHAZA (no se corrige en silencio: es lo que decide si se le escribe a un chofer en marcha).
  const detenidaMetros = entero(b.detenidaMetros ?? CONFIG_CONDUCTOR_DEFAULT.detenidaMetros, 10, 5000);
  if (detenidaMetros === null) return { error: 'Los metros para dar la unidad por en marcha van de 10 a 5,000.' };
  const detenidaVentanaMin = entero(b.detenidaVentanaMin ?? CONFIG_CONDUCTOR_DEFAULT.detenidaVentanaMin, 1, 60);
  if (detenidaVentanaMin === null) return { error: 'La ventana para dar la unidad por detenida va de 1 a 60 minutos.' };
  let lineaBaseLlamadasPorViaje: number | null = null;
  if (b.lineaBaseLlamadasPorViaje !== null && b.lineaBaseLlamadasPorViaje !== undefined) {
    const n = typeof b.lineaBaseLlamadasPorViaje === 'string' && (b.lineaBaseLlamadasPorViaje as string).trim() !== '' ? Number(b.lineaBaseLlamadasPorViaje) : b.lineaBaseLlamadasPorViaje;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1000) return { error: 'La línea base de llamadas por viaje va de 0 a 1,000 (o vacía si aún no se mide).' };
    lineaBaseLlamadasPorViaje = n;
  }
  let lineaBaseRegistradaEn: string | null = null;
  if (b.lineaBaseRegistradaEn !== null && b.lineaBaseRegistradaEn !== undefined) {
    const f = b.lineaBaseRegistradaEn;
    if (typeof f !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(f) || new Date(`${f}T00:00:00Z`).toISOString().slice(0, 10) !== f) {
      return { error: 'La fecha de la línea base va como AAAA-MM-DD (o vacía).' };
    }
    lineaBaseRegistradaEn = f;
  }

  return {
    ok: {
      activo: Boolean(b.activo),
      solicitudesMin,
      escalarTrasMin,
      segundoNivelMin,
      horaInicio,
      horaFin,
      diasSemana,
      topeDiarioChofer,
      anticipoCitaMin: num.anticipoCitaMin,
      esperaSinCitaMin: num.esperaSinCitaMin,
      esperaCargaMin: num.esperaCargaMin,
      trayectoSinEtaMin: num.trayectoSinEtaMin,
      esperaDescargaMin: num.esperaDescargaMin,
      regresoMin: num.regresoMin,
      posponerMin: num.posponerMin,
      ventanaCorreccionMin: num.ventanaCorreccionMin,
      usarLlm: Boolean(b.usarLlm),
      avisarOficinaLlegada: Boolean(b.avisarOficinaLlegada),
      avisarOficinaSalida: Boolean(b.avisarOficinaSalida),
      confirmarAlChofer: Boolean(b.confirmarAlChofer),
      validarUbicacion: Boolean(b.validarUbicacion),
      toleranciaUbicacionM,
      ventanaUbicacionMin,
      pedirUbicacion: Boolean(b.pedirUbicacion),
      estadiaAlertaCargaMin: alertaCarga.ok,
      estadiaAlertaDescargaMin: alertaDescarga.ok,
      pedirFotoEvidencia: Boolean(b.pedirFotoEvidencia),
      fotoRegistraHito: Boolean(b.fotoRegistraHito),
      avisarLlegadaSinConfirmar: Boolean(b.avisarLlegadaSinConfirmar),
      margenAcercamientoM,
      detectarHitosGps: Boolean(b.detectarHitosGps),
      avisarSenalVida: Boolean(b.avisarSenalVida),
      zonaHoraria: zonaOCdmx(b.zonaHoraria),
      perfilSeguimiento: b.perfilSeguimiento,
      gpsObsoletoMin: umbral.gpsObsoletoMin,
      detenidoMin: umbral.detenidoMin,
      segundoAvisoMin: umbral.segundoAvisoMin,
      escalarSenalMin: umbral.escalarSenalMin,
      silencioRespuestaMin: umbral.silencioRespuestaMin,
      mostrarEstadosFrontera: Boolean(b.mostrarEstadosFrontera),
      aplicarSalidaDelTms: Boolean(b.aplicarSalidaDelTms),
      compuertaMovimientoActiva: b.compuertaMovimientoActiva === true,
      detenidaMetros,
      detenidaVentanaMin,
      sinGpsPermite: b.sinGpsPermite === true,
      exigirSelloInicio: b.exigirSelloInicio === true,
      patioEntregaActivo: b.patioEntregaActivo === true,
      patioQueManda: b.patioQueManda === 'destino' ? 'destino' : 'entregar_en',
      lineaBaseLlamadasPorViaje,
      lineaBaseRegistradaEn,
    },
  };
}

/** La zona si es un nombre IANA que el runtime conoce; si no, la de México (nunca truena). */
export function zonaOCdmx(zona: unknown): string {
  return typeof zona === 'string' && zonaValida(zona) ? zona : TZ_MX;
}

const DIA_ISO: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Hora (0–23) y día ISO en la zona de la flota (por omisión México): la ventana es del chofer, no del servidor. */
export function horaYDiaMx(ahora: Date, zona: string = TZ_MX): { hora: number; dia: number } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zonaOCdmx(zona), hour12: false, hour: 'numeric', weekday: 'short',
  }).formatToParts(ahora);
  const hora = Number(partes.find((p) => p.type === 'hour')?.value ?? '-1') % 24;
  const dia = DIA_ISO[partes.find((p) => p.type === 'weekday')?.value ?? ''] ?? 0;
  return { hora, dia };
}

/** ¿AHORA MISMO se puede insistirle al chofer? Fuera de la ventana: nunca. La hora se lee en `config.zonaHoraria`. */
export function dentroDeVentana(
  config: Pick<ConfigConductor, 'horaInicio' | 'horaFin' | 'diasSemana'> & { zonaHoraria?: string },
  ahora: Date,
): boolean {
  const { hora, dia } = horaYDiaMx(ahora, config.zonaHoraria);
  if (hora < 0 || dia === 0) return false;
  return config.diasSemana.includes(dia) && hora >= config.horaInicio && hora < config.horaFin;
}

/** El instante (UTC) en que empieza el día calendario de la zona de la flota (por omisión México) de `ahora`. */
export function inicioDiaMx(ahora: Date, zona: string = TZ_MX): Date {
  const z = zonaOCdmx(zona);
  const fecha = diaEnZona(ahora, z);
  // Se calcula con la diferencia REAL del instante (la zona puede tener horario de verano).
  const mediaNoche = new Date(`${fecha}T00:00:00Z`);
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: z, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(mediaNoche);
  const g = (t: string) => Number(partes.find((p) => p.type === t)?.value ?? '0');
  const comoLocal = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
  const desfase = comoLocal - mediaNoche.getTime(); // negativo al oeste de UTC
  return new Date(mediaNoche.getTime() - desfase);
}
