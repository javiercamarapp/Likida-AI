import { CRONS, TOLERANCIA_LATIDO_MS, esHuecoDeConfiguracion, type CronId, type LatidoDetallado } from '@/lib/admin/salud';
import { etiquetaContadorVigia } from '../observabilidad/etiquetas';

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE DICE /admin/crons Y LA PORTADA DE SALUD, SIN REACT: nombres en palabras, el oficio de cada reloj, el resumen de cuántos laten,
// el «por qué no corrió» y la guía de arreglo cuando falta configuración. Todo puro para poder probarlo.
//
// Cuántos son NO se escribe aquí: sale de `CRONS`, la constante que `salud.test.ts` cruza contra vercel.json y contra el CHECK de la
// base. `Record<CronId, …>` hace que un reloj nuevo sin nombre NO compile.
// ═══════════════════════════════════════════════════════════════════════════

/** Cómo se llama cada reloj en la oficina (el id es del sistema y no se pinta). */
export const NOMBRE_RELOJ: Record<CronId, string> = {
  'wa-pendientes': 'WhatsApp entrante',
  'wa-outbox': 'WhatsApp saliente',
  escalar: 'Escalamientos y citas',
  facturar: 'Facturas de portales',
  purgar: 'Purga por retención',
  runner: 'Corrida de agentes',
  gps: 'Posiciones GPS',
  asistencia: 'Asistencia en emergencias',
  'descarga-sat': 'Descarga del SAT',
  jornada: 'Registro de jornada',
  'portales-vivos': 'Portales de facturación',
  'liquidaciones-externas': 'Liquidaciones externas',
  peajes: 'Desgloses de peaje',
  'conductor-hitos': 'Hitos del viaje',
  vigia: 'Vigía de SLA',
  'jornada-alertas': 'Alertas de jornada',
  'buzon-entrega': 'Buzón del contador',
  'carta-porte-docs': 'Documentos de Carta Porte',
  guardia: 'Guardia de producción',
  tms: 'Sistema de transporte del cliente',
};

/** Qué hace cada reloj, en una línea, para que el rojo se pueda priorizar. */
export const OFICIO_RELOJ: Record<CronId, string> = {
  'wa-pendientes': 'Recoge los mensajes de WhatsApp que llegaron.',
  'wa-outbox': 'Manda los mensajes de WhatsApp encolados.',
  escalar: 'Escala lo que lleva demasiado tiempo sin atender y mantiene las citas.',
  facturar: 'Pide las facturas de los tickets a los portales.',
  purgar: 'Borra lo que ya cumplió su retención.',
  runner: 'Despacha a la compañía de agentes.',
  gps: 'Baja las posiciones de las unidades.',
  asistencia: 'Vigila las emergencias sin reconocer.',
  'descarga-sat': 'Recoge del SAT las facturas que el comercio ya timbró.',
  jornada: 'Asienta el registro de jornada del día.',
  'portales-vivos': 'Comprueba que los portales de facturación sigan en pie.',
  'liquidaciones-externas': 'Entrega y concilia las liquidaciones que calcula el sistema del cliente.',
  peajes: 'Importa y concilia los desgloses de peaje que el proveedor mandó por el buzón firmado.',
  'conductor-hitos': 'Pide, persigue y escala los hitos del viaje (llegada, salida, regreso) a los choferes.',
  vigia: 'Vigila el plazo de los clientes finales, escala por niveles y purga lo que ya cumplió su retención.',
  'jornada-alertas': 'Avisa al encargado y al operador cuando la jornada en curso se acerca al tope legal (80 %, 95 % y exceso).',
  'buzon-entrega': 'Arma y manda al contador el lote de facturas aprobadas, reintenta con espera y marca lo que el correo no confirma.',
  'carta-porte-docs': 'Extrae los documentos de Carta Porte que quedaron en la bandeja, reintenta con espera y avisa a la oficina de los que traen dudas o no se pudieron leer.',
  guardia: 'La guardia de producción: clasifica lo pendiente, mide los componentes de la página de estado, avisa al operador de lo nuevo y purga la retención de latencias.',
  tms: 'Lee, solo lectura, los viajes, liquidaciones, peajes y posiciones de las flotas que conectaron su sistema de transporte, y los entrega a cada agente.',
};

/** "cada 5 min" / "cada 4 h" / "una vez al día". */
export function cadaCuanto(ms: number): string {
  if (ms < 3_600_000) return `cada ${Math.round(ms / 60_000)} min`;
  if (ms < 86_400_000) return `cada ${Math.round(ms / 3_600_000)} h`;
  return 'una vez al día';
}

/** "hace 3 min" / "hace 2.5 h" / "hace 4 d". `null` = nunca latió. */
export function desdeHace(min: number | null): string {
  if (min === null) return 'nunca';
  if (min < 60) return `hace ${min} min`;
  if (min < 1440) return `hace ${Math.round(min / 6) / 10} h`;
  return `hace ${Math.round(min / 144) / 10} d`;
}

/**
 * Lo que el propio cron dejó dicho de su última pasada, tal cual, sin `codigo` (que ya tiene su propio renglón) ni claves vacías. No
 * inventa una interpretación: una corrida `parcial` promete «el detalle está abajo» y aquí es lo que se enseña.
 */
export function resumenDetalle(detalle: Record<string, unknown>): string | null {
  const partes = Object.entries(detalle)
    .filter(([clave, valor]) => clave !== 'codigo' && valor !== undefined && valor !== null)
    .map(([clave, valor]): string | null => {
      const nombre = etiquetaContadorVigia(clave);
      if (Array.isArray(valor)) return valor.length > 0 ? `${nombre}: ${valor.length}` : null;
      if (typeof valor === 'number') return valor > 0 ? `${nombre}: ${valor}` : null;
      if (typeof valor === 'string') return valor.trim() !== '' ? `${nombre}: ${valor}` : null;
      if (typeof valor === 'boolean') return valor ? nombre : null;
      return null;
    })
    .filter((x): x is string => x !== null);
  return partes.length > 0 ? partes.join(' · ') : null;
}

/**
 * El resumen de arriba, dos ejes —los MISMOS que /api/health—: antes solo miraba la cadencia y un reloj que latía puntual reportando
 * `fallo` cada minuto salía en «todos latieron». El panel del operador no puede ser más laxo que el endpoint público.
 */
export function resumenRelojes(lista: Array<{ cron: CronId; l: LatidoDetallado }>): {
  sinLatir: CronId[]; conFallo: CronId[]; parciales: CronId[];
} {
  return {
    sinLatir: lista.filter((x) => x.l.estado !== 'ok').map((x) => x.cron),
    conFallo: lista.filter((x) => x.l.estado === 'ok' && x.l.ultimoEstado === 'fallo').map((x) => x.cron),
    parciales: lista.filter((x) => x.l.estado === 'ok' && x.l.ultimoEstado === 'parcial').map((x) => x.cron),
  };
}

export interface PorQueNoCorrio {
  texto: string;
  /** `config` = falta configuración (tiene guía de arreglo); `apagado` = alguien lo apagó a propósito; `averia` = algo se rompió. */
  causa: 'config' | 'apagado' | 'averia' | 'espera' | 'sin_dato' | 'ninguna';
}

/**
 * «Por qué no corrió»: para cada reloj, la causa con las palabras que el cron dejó, en este orden: apagado a propósito (palanca), falta de
 * configuración declarada, fallo con código, nunca latió, dejó de latir, o el detalle de una pasada parcial. Un reloj sano devuelve
 * `ninguna` y la tabla pinta un guion: NO se inventa un motivo.
 */
export function porQueNoCorrio(l: LatidoDetallado): PorQueNoCorrio {
  if (l.motivoSalto !== null) return { texto: l.motivoSalto, causa: /palanca/i.test(l.motivoSalto) ? 'apagado' : esHuecoDeConfiguracion(l.motivoSalto) ? 'config' : 'espera' };
  if (l.ultimoEstado === 'parcial' && esHuecoDeConfiguracion(l.detalle)) return { texto: 'Falta configuración: no se puede hacer su trabajo hasta que alguien la ponga.', causa: 'config' };
  if (l.ultimoEstado === 'fallo' && typeof l.detalle.codigo === 'string') return { texto: `Falló con código ${l.detalle.codigo}`, causa: 'averia' };
  if (l.estado === 'sin_latido') return { texto: 'No ha escrito su pulso ni una vez.', causa: 'sin_dato' };
  if (l.estado === 'vencido') return { texto: `Debería haber latido ${cadaCuanto(l.cadenciaMs)} (más ${Math.round(TOLERANCIA_LATIDO_MS / 60_000)} min de tolerancia).`, causa: 'averia' };
  if (l.ultimoEstado === 'parcial' || l.ultimoEstado === 'fallo') {
    const r = resumenDetalle(l.detalle);
    if (r !== null) return { texto: r, causa: l.ultimoEstado === 'fallo' ? 'averia' : 'espera' };
  }
  return { texto: '', causa: 'ninguna' };
}

export interface GuiaArreglo {
  cron: CronId;
  /** Qué no funciona, en palabras de la oficina. */
  queFalta: string;
  /** Quién lo destraba. */
  quien: string;
  /** Pasos concretos; aquí sí pueden ir los nombres que usa quien configura. */
  pasos: string[];
  /** Lo que el propio reloj dejó dicho (puede traer nombres de variables). */
  dicho: string | null;
}

const GUIAS: Partial<Record<CronId, Omit<GuiaArreglo, 'cron' | 'dicho'>>> = {
  'descarga-sat': {
    queFalta: 'La descarga masiva de facturas del SAT no corre: falta el proveedor que la hace.',
    quien: 'Lo destraba Javier: depende de un contrato con el proveedor de timbrado.',
    pasos: [
      'Cerrar el contrato con el proveedor de timbrado que ofrece la descarga masiva.',
      'Poner en el servidor LIKIDA_SAT_PROVEEDOR con el nombre del proveedor; si no hereda las credenciales del timbrado, también LIKIDA_SAT_URL, LIKIDA_SAT_USUARIO y LIKIDA_SAT_PASSWORD.',
      'Esperar la siguiente pasada del reloj: debe pasar a «OK». Hasta entonces las facturas del SAT no entran y el gasto queda sin su comprobante.',
    ],
  },
  escalar: {
    queFalta: 'El barrido de citas no corre: falta conectar Cal.com. El resto de los escalamientos sí corre.',
    quien: 'Lo destraba Javier: necesita una cuenta de Cal.com.',
    pasos: [
      'Crear la llave de API y el secreto del webhook en Cal.com.',
      'Ponerlos en el servidor: CALCOM_API_KEY y CALCOM_WEBHOOK_SECRET (y CALCOM_EVENT_TYPE_ID del tipo de evento). La dirección pública debe ser HTTPS.',
      'Esperar la siguiente pasada del reloj: debe pasar a «OK».',
    ],
  },
};

/**
 * La guía de arreglo de un reloj con corrida PARCIAL por falta de configuración. Los dos conocidos (Descarga del SAT y Escalamientos y
 * citas) traen pasos propios; cualquier otro hueco declarado trae lo genérico y lo que el propio reloj dijo. `null` = no hay nada que
 * arreglar (o no es un hueco de configuración: una avería no se disfraza de «falta configurar»).
 */
export function guiaDeArreglo(cron: CronId, l: LatidoDetallado): GuiaArreglo | null {
  if (l.ultimoEstado !== 'parcial' || !esHuecoDeConfiguracion(l.detalle)) return null;
  const dicho = typeof l.detalle.motivo === 'string' && l.detalle.motivo.trim() !== '' ? l.detalle.motivo : null;
  const propia = GUIAS[cron];
  if (propia) return { cron, ...propia, dicho };
  return {
    cron,
    queFalta: `${NOMBRE_RELOJ[cron]} no puede hacer su trabajo: le falta una configuración.`,
    quien: 'Lo destraba quien administra el servidor.',
    pasos: ['Poner la variable o la credencial que el propio reloj nombra abajo, y esperar su siguiente pasada: debe pasar a «OK».'],
    dicho,
  };
}

export { CRONS };
