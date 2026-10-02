import { TZ_MX, hoyMx } from '@/lib/formato';

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
}

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
    },
  };
}

const DIA_ISO: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Hora (0–23) y día ISO en México: la ventana es del chofer, no del servidor. */
export function horaYDiaMx(ahora: Date): { hora: number; dia: number } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ_MX, hour12: false, hour: 'numeric', weekday: 'short',
  }).formatToParts(ahora);
  const hora = Number(partes.find((p) => p.type === 'hour')?.value ?? '-1') % 24;
  const dia = DIA_ISO[partes.find((p) => p.type === 'weekday')?.value ?? ''] ?? 0;
  return { hora, dia };
}

/** ¿AHORA MISMO se puede insistirle al chofer? Fuera de la ventana: nunca. */
export function dentroDeVentana(config: Pick<ConfigConductor, 'horaInicio' | 'horaFin' | 'diasSemana'>, ahora: Date): boolean {
  const { hora, dia } = horaYDiaMx(ahora);
  if (hora < 0 || dia === 0) return false;
  return config.diasSemana.includes(dia) && hora >= config.horaInicio && hora < config.horaFin;
}

/** El instante (UTC) en que empieza el día calendario de México de `ahora`. */
export function inicioDiaMx(ahora: Date): Date {
  const fecha = hoyMx(ahora);
  // México no tiene horario de verano desde 2022 (UTC-6 fijo); se calcula con la
  // diferencia real del instante para no depender de ello.
  const mediaNoche = new Date(`${fecha}T00:00:00Z`);
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ_MX, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(mediaNoche);
  const g = (t: string) => Number(partes.find((p) => p.type === t)?.value ?? '0');
  const comoLocal = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
  const desfase = comoLocal - mediaNoche.getTime(); // negativo al oeste de UTC
  return new Date(mediaNoche.getTime() - desfase);
}
