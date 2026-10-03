import type { ConfigConductor } from './config';
import { calcularEstancias, excedeUmbral, type Estancia } from './estadias_anden';
import { hitoActivo } from './maquina';
import { anclaDe, textoTiempo } from './planificador';
import type { AccionOficinaFila, DatosTablero, EpisodioTablero, IndicadoresCrudos, ViajeTablero, VeredictoFila } from './repo_validacion';
import { ETIQUETA, estaResuelto, TIPOS_HITO, type HitoFila, type TipoHito } from './tipos';
import { llegadaPorConfirmar, llegadaSinSitio, textoVeredicto, type ResultadoValidacion, type Veredicto } from './validacion';

// ═══════════════════════════════════════════════════════════════════════════
// EL TABLERO DE HITOS — el modelo de vista del jefe de tráfico. Puro, sin I/O.
//
// De los datos ya leídos (viajes activos, hitos, veredictos, evidencias, acciones
// de oficina) arma: la línea de tiempo de cada viaje con sus 5 hitos, el SEMÁFORO,
// la COLA DE EXCEPCIONES y los conteos. Ni un peso: es la pantalla del jefe de
// tráfico (área `operacion`).
//
// ── EL SEMÁFORO (usa la MISMA escalera que el agente, de la config de la flota) ──
//   completo     los 5 hitos resueltos u omitidos.
//   a_tiempo     el hito que toca todavía no vence, o ya se pidió y no ha pasado el primer
//                recordatorio (un chofer manejando no contesta en el minuto uno).
//   atrasado     ya pasó el primer recordatorio de la escalera y el chofer no ha contestado.
//   sin_reporte  el hito está ESCALADO, o ya pasó el umbral de escalación aunque el cron
//                todavía no lo haya escalado (la pantalla no espera al cron para decir la verdad).
// Sin ancla (nada de qué colgarse) un viaje NO se pinta verde por defecto: se dice «sin ancla».
// ═══════════════════════════════════════════════════════════════════════════

export type Semaforo = 'completo' | 'a_tiempo' | 'atrasado' | 'sin_reporte' | 'sin_ancla';

export interface HitoVista {
  id: string;
  tipo: TipoHito;
  etiqueta: string;
  estado: HitoFila['estado'];
  ciclo: number;
  /** La hora del MENSAJE del chofer (o la declarada por la oficina). */
  horaMensaje: string | null;
  recibidoEn: string | null;
  fuente: HitoFila['fuente'];
  /** Quién lo recibió en el andén, si el chofer lo dijo. */
  contacto: string | null;
  sinContacto: boolean;
  validacion: { resultado: ResultadoValidacion; texto: string; distanciaM: number | null } | null;
  validadoPor: HitoFila['validadoPor'];
  evidencias: number;
  /** Cada foto viva del ciclo vigente (para abrirla con GET /v1/evidencias/{id}). */
  fotos: Array<{ id: string; tipo: 'sello' | 'anden' | 'recibido' | 'otra' }>;
  /** Por qué quedó `omitido` (`inferido_por_<tipo>`: avisó uno posterior · `viaje_abierto_vencido`: lo cerró el barrido de viajes viejos · …). */
  omitidoMotivo: string | null;
  escaladoEn: string | null;
  escalacionNivel: number;
  atendidaEn: string | null;
  /** Desde cuándo «toca» (la ancla), solo para el hito activo. */
  tocaDesde: string | null;
  /** Se capturó/validó/atendió desde la oficina: el motivo y quién. */
  accionesOficina: Array<{ accion: AccionOficinaFila['accion']; email: string; motivo: string; cuando: string }>;
}

export type TipoExcepcion =
  | 'escalado_sin_atender' | 'sin_reporte' | 'atrasado' | 'sin_coincidencia' | 'llegada_sin_confirmar' | 'llegada_sin_sitio' | 'estadia_excedida' | 'horas_incoherentes';

export interface Excepcion {
  tipo: TipoExcepcion;
  viajeId: string;
  folio: string | null;
  chofer: string | null;
  hitoId: string | null;
  hitoTipo: TipoHito | null;
  /** 3 = urgente, 2 = revisar, 1 = vigilar. */
  gravedad: 1 | 2 | 3;
  desde: string | null;
  texto: string;
}

export interface FilaTablero {
  viaje: ViajeTablero;
  hitos: HitoVista[];
  semaforo: Semaforo;
  motivo: string;
  hitoActivo: TipoHito | null;
  minutosVencido: number | null;
  estancias: Estancia[];
  /** Sitios (nombres) contra los que se valida la carga y la descarga. */
  sitioCarga: string | null;
  sitioDescarga: string | null;
}

export interface ConteosSemaforo { completo: number; a_tiempo: number; atrasado: number; sin_reporte: number; sin_ancla: number }

export interface Tablero {
  filas: FilaTablero[];
  excepciones: Excepcion[];
  conteos: ConteosSemaforo;
  hayMas: boolean;
}

const MS_MIN = 60_000;

/** Cuánto se espera antes de mostrar una llegada sin respaldo como excepción: el GPS reporta con minutos de retraso. */
export const MINUTOS_GRACIA_LLEGADA_SIN_CONFIRMAR = 10;

function veredictoVigente(h: HitoFila, veredictos: ReadonlyMap<string, VeredictoFila>): VeredictoFila | undefined {
  const v = veredictos.get(h.id);
  return v && v.ciclo === h.ciclo ? v : undefined;
}

function aVeredicto(v: VeredictoFila): Veredicto {
  return {
    resultado: v.resultado, motivo: v.motivo, fuente: v.fuente, distanciaM: v.distanciaM, toleranciaM: v.toleranciaM, radioM: v.radioM,
    sitioId: v.sitioId, medidaEn: v.medidaEn ? new Date(v.medidaEn) : null,
  };
}

const nombreChofer = (v: ViajeTablero): string => (v.operadorNombre ?? 'El chofer').replace(/\s+/g, ' ').trim() || 'El chofer';

export function armarTablero(datos: DatosTablero, config: ConfigConductor, ahora: Date): Tablero {
  const hitosPorViaje = new Map<string, HitoFila[]>();
  for (const h of datos.hitos) hitosPorViaje.set(h.viajeId, [...(hitosPorViaje.get(h.viajeId) ?? []), h]);
  const veredictos = new Map<string, VeredictoFila>();
  for (const v of datos.veredictos) {
    const previo = veredictos.get(v.hitoId);
    if (!previo || v.ciclo >= previo.ciclo) veredictos.set(v.hitoId, v);
  }
  const conteos: ConteosSemaforo = { completo: 0, a_tiempo: 0, atrasado: 0, sin_reporte: 0, sin_ancla: 0 };
  const filas: FilaTablero[] = [];
  const excepciones: Excepcion[] = [];

  for (const viaje of datos.viajes) {
    const hs = [...(hitosPorViaje.get(viaje.id) ?? [])].sort((a, b) => TIPOS_HITO.indexOf(a.tipo) - TIPOS_HITO.indexOf(b.tipo));
    // Las evidencias cuentan solo las del CICLO vigente del hito (una corrección retira el hito, no las fotos viejas del historial).
    const evidenciasVigentes = new Map<string, number>();
    const fotosVigentes = new Map<string, Array<{ id: string; tipo: 'sello' | 'anden' | 'recibido' | 'otra' }>>();
    for (const e of datos.evidencias) {
      const h = hs.find((x) => x.id === e.hitoId);
      if (h && e.ciclo === h.ciclo && e.ruta !== null) {
        evidenciasVigentes.set(h.id, (evidenciasVigentes.get(h.id) ?? 0) + 1);
        fotosVigentes.set(h.id, [...(fotosVigentes.get(h.id) ?? []), { id: e.id, tipo: e.tipo }]);
      }
    }
    const validaciones = new Map<string, ResultadoValidacion>();
    for (const h of hs) { const v = veredictoVigente(h, veredictos); if (v) validaciones.set(h.id, v.resultado); }
    const estancias = calcularEstancias(viaje, hs, ahora, { validaciones, evidencias: evidenciasVigentes });

    const activo = hitoActivo(hs);
    let semaforo: Semaforo;
    let motivo: string;
    let minutosVencido: number | null = null;
    let tocaDesde: Date | null = null;
    if (hs.length === 0) {
      semaforo = 'sin_ancla'; motivo = 'Todavía no se crean los hitos de este viaje (el agente los siembra en su siguiente pasada).';
    } else if (!activo) {
      semaforo = 'completo'; motivo = 'Los cinco hitos ya están resueltos.';
    } else {
      tocaDesde = anclaDe(activo, viaje, hs, config);
      const etiqueta = ETIQUETA[activo.tipo].corta;
      if (activo.estado === 'escalado') {
        semaforo = 'sin_reporte';
        motivo = `${etiqueta}: escalado${activo.escalacionAtendidaEn ? ' y atendido por la oficina' : ' sin atender'}.`;
        if (tocaDesde) minutosVencido = Math.floor((ahora.getTime() - tocaDesde.getTime()) / MS_MIN);
      } else if (!tocaDesde) {
        semaforo = 'sin_ancla'; motivo = `${etiqueta}: sin cita, ETA ni aceptación de qué colgarlo.`;
      } else {
        minutosVencido = Math.floor((ahora.getTime() - tocaDesde.getTime()) / MS_MIN);
        const primerRecordatorio = config.solicitudesMin[1] ?? config.solicitudesMin[0] + 15;
        if (minutosVencido >= config.escalarTrasMin) {
          semaforo = 'sin_reporte'; motivo = `${etiqueta}: lleva ${textoTiempo(minutosVencido)} sin reporte (la escalación es a los ${textoTiempo(config.escalarTrasMin)}).`;
        } else if (minutosVencido >= primerRecordatorio) {
          semaforo = 'atrasado'; motivo = `${etiqueta}: se pidió hace ${textoTiempo(minutosVencido)} y el chofer no ha contestado.`;
        } else if (minutosVencido >= 0) {
          semaforo = 'a_tiempo'; motivo = `${etiqueta}: toca ahora; el chofer aún está a tiempo de avisar.`;
        } else {
          semaforo = 'a_tiempo'; motivo = `${etiqueta}: toca en ${textoTiempo(-minutosVencido)}.`;
        }
      }
    }
    conteos[semaforo]++;

    const accionesDe = (hitoId: string) => datos.acciones.filter((a) => a.hitoId === hitoId)
      .map((a) => ({ accion: a.accion, email: a.usuarioEmail, motivo: a.motivo, cuando: a.creadaEn }));

    const vistas: HitoVista[] = hs.map((h) => {
      const v = veredictoVigente(h, veredictos);
      const sitioNombre = v?.sitioId ? datos.sitios.get(v.sitioId) ?? null : null;
      return {
        id: h.id, tipo: h.tipo, etiqueta: ETIQUETA[h.tipo].corta, estado: h.estado, ciclo: h.ciclo,
        horaMensaje: estaResuelto(h) ? h.mensajeEn ?? h.recibidoEn : null, recibidoEn: h.recibidoEn, fuente: h.fuente,
        contacto: h.contactoNombre ? (h.contactoArea ? `${h.contactoNombre} (${h.contactoArea})` : h.contactoNombre) : null,
        sinContacto: h.sinContacto,
        validacion: v ? { resultado: v.resultado, texto: textoVeredicto(aVeredicto(v), sitioNombre), distanciaM: v.distanciaM } : null,
        validadoPor: h.validadoPor, evidencias: evidenciasVigentes.get(h.id) ?? 0, fotos: fotosVigentes.get(h.id) ?? [],
        omitidoMotivo: h.omitidoMotivo, escaladoEn: h.escaladoEn, escalacionNivel: h.escalacionNivel, atendidaEn: h.escalacionAtendidaEn,
        tocaDesde: activo && activo.id === h.id && tocaDesde ? tocaDesde.toISOString() : null,
        accionesOficina: accionesDe(h.id),
      };
    });

    filas.push({
      viaje, hitos: vistas, semaforo, motivo, hitoActivo: activo?.tipo ?? null, minutosVencido, estancias,
      sitioCarga: viaje.origenSitioId ? datos.sitios.get(viaje.origenSitioId) ?? null : null,
      sitioDescarga: viaje.destinoSitioId ? datos.sitios.get(viaje.destinoSitioId) ?? null : null,
    });

    // ── La cola de excepciones ───────────────────────────────────────────
    const base = { viajeId: viaje.id, folio: viaje.folio, chofer: viaje.operadorNombre };
    for (const h of hs) {
      if (h.estado === 'escalado' && !h.escalacionAtendidaEn) {
        excepciones.push({
          ...base, tipo: 'escalado_sin_atender', hitoId: h.id, hitoTipo: h.tipo, gravedad: 3, desde: h.escaladoEn,
          texto: `${nombreChofer(viaje)} no ha registrado «${ETIQUETA[h.tipo].corta}» (escalado al nivel ${h.escalacionNivel}) y nadie lo ha atendido.`,
        });
      }
      const v = veredictoVigente(h, veredictos);
      if (v?.resultado === 'sin_coincidencia' && h.estado === 'recibido') {
        excepciones.push({
          ...base, tipo: 'sin_coincidencia', hitoId: h.id, hitoTipo: h.tipo, gravedad: 2, desde: h.recibidoEn,
          texto: `${ETIQUETA[h.tipo].corta}: ${textoVeredicto(aVeredicto(v), v.sitioId ? datos.sitios.get(v.sitioId) ?? null : null)}`,
        });
      } else if (
        v?.resultado !== 'sin_coincidencia'
        && llegadaSinSitio(h, v, config.validarUbicacion, (h.tipo === 'llegada_carga' ? viaje.origenSitioId : viaje.destinoSitioId) !== null)
        && h.recibidoEn && ahora.getTime() - new Date(h.recibidoEn).getTime() >= MINUTOS_GRACIA_LLEGADA_SIN_CONFIRMAR * MS_MIN
      ) {
        // El viaje no tiene sitio contra el cual comparar: la llegada se selló con el puro «ya llegué» del chofer.
        excepciones.push({
          ...base, tipo: 'llegada_sin_sitio', hitoId: h.id, hitoTipo: h.tipo, gravedad: 1, desde: h.recibidoEn,
          texto: `${ETIQUETA[h.tipo].corta}: ${nombreChofer(viaje)} avisó que llegó, pero el viaje no tiene sitio de ${h.tipo === 'llegada_carga' ? 'carga' : 'descarga'} asignado y no hay con qué compararlo contra el GPS. Asigna el sitio para poder conciliarlo.`,
        });
      } else if (
        v?.resultado !== 'sin_coincidencia'
        && llegadaPorConfirmar(h, v, config.validarUbicacion, (h.tipo === 'llegada_carga' ? viaje.origenSitioId : viaje.destinoSitioId) !== null)
        && h.recibidoEn && ahora.getTime() - new Date(h.recibidoEn).getTime() >= MINUTOS_GRACIA_LLEGADA_SIN_CONFIRMAR * MS_MIN
      ) {
        // El «ya llegué» del chofer quedó anotado, pero ninguna posición lo respalda: se ve, sin acusar a nadie.
        excepciones.push({
          ...base, tipo: 'llegada_sin_confirmar', hitoId: h.id, hitoTipo: h.tipo, gravedad: 1, desde: h.recibidoEn,
          texto: `${ETIQUETA[h.tipo].corta}: ${nombreChofer(viaje)} avisó que llegó y sigue sin confirmar con ubicación. ${v ? textoVeredicto(aVeredicto(v), null) : 'Todavía no se pudo comparar contra el sitio.'}`,
        });
      }
    }
    if (activo && activo.estado !== 'escalado') {
      if (semaforo === 'sin_reporte') {
        excepciones.push({
          ...base, tipo: 'sin_reporte', hitoId: activo.id, hitoTipo: activo.tipo, gravedad: 2, desde: tocaDesde?.toISOString() ?? null,
          texto: `${nombreChofer(viaje)} lleva ${textoTiempo(minutosVencido ?? 0)} sin reportar «${ETIQUETA[activo.tipo].corta}» y el agente aún no escala.`,
        });
      } else if (semaforo === 'atrasado') {
        excepciones.push({
          ...base, tipo: 'atrasado', hitoId: activo.id, hitoTipo: activo.tipo, gravedad: 1, desde: tocaDesde?.toISOString() ?? null,
          texto: `${nombreChofer(viaje)} no ha contestado por «${ETIQUETA[activo.tipo].corta}» (${textoTiempo(minutosVencido ?? 0)}).`,
        });
      }
    }
    for (const e of estancias) {
      if (excedeUmbral(e, config)) {
        excepciones.push({
          ...base, tipo: 'estadia_excedida', hitoId: e.llegada?.hitoId ?? null, hitoTipo: e.lugar === 'carga' ? 'llegada_carga' : 'llegada_descarga',
          gravedad: 2, desde: e.llegada?.en ?? null,
          texto: `${nombreChofer(viaje)} lleva ${textoTiempo(e.minutos ?? 0)} en la ${e.lugar} (alerta configurada: ${textoTiempo((e.lugar === 'carga' ? config.estadiaAlertaCargaMin : config.estadiaAlertaDescargaMin) ?? 0)}).`,
        });
      }
      if (e.fase === 'incoherente') {
        excepciones.push({
          ...base, tipo: 'horas_incoherentes', hitoId: e.salida?.hitoId ?? null, hitoTipo: e.lugar === 'carga' ? 'salida_carga' : 'salida_descarga',
          gravedad: 1, desde: e.salida?.en ?? null,
          texto: `En la ${e.lugar}, la salida está registrada ANTES que la llegada: corrige una de las dos horas.`,
        });
      }
    }
  }

  excepciones.sort((a, b) => b.gravedad - a.gravedad || (a.desde ?? '').localeCompare(b.desde ?? ''));
  // Primero lo que más urge: sin_reporte, atrasado, a_tiempo, sin ancla, completo.
  const orden: Record<Semaforo, number> = { sin_reporte: 0, atrasado: 1, sin_ancla: 2, a_tiempo: 3, completo: 4 };
  filas.sort((a, b) => orden[a.semaforo] - orden[b.semaforo] || (b.minutosVencido ?? -1e9) - (a.minutosVencido ?? -1e9));
  return { filas, excepciones, conteos, hayMas: datos.hayMas };
}

// ── Los indicadores ─────────────────────────────────────────────────────────

export interface IndicadoresVista {
  recibidos: number;
  /** 0–1, o null si no hubo hitos recibidos (un cero real no es lo mismo que «sin datos»). */
  tasaSinInsistencia: number | null;
  /** Minutos promedio entre que el agente pidió el hito y el chofer contestó. null = ninguno medible. */
  minutosRespuestaPromedio: number | null;
  conRespuestaMedida: number;
  escalados: number;
  omitidos: number;
  validadosUbicacion: number;
  sinCoincidencia: number;
  capturadosOficina: number;
}

export function indicadoresVista(c: IndicadoresCrudos): IndicadoresVista {
  return {
    recibidos: c.recibidos,
    tasaSinInsistencia: c.recibidos > 0 ? Math.round((c.sinInsistencia / c.recibidos) * 1000) / 1000 : null,
    minutosRespuestaPromedio: c.conRespuestaMedida > 0 ? c.minutosRespuestaPromedio : null,
    conRespuestaMedida: c.conRespuestaMedida, escalados: c.escalados, omitidos: c.omitidos,
    validadosUbicacion: c.validadosUbicacion, sinCoincidencia: c.sinCoincidencia, capturadosOficina: c.capturadosOficina,
  };
}

/** Filtra las filas por semáforo (el filtro de pantalla mueve TODO lo que hay debajo: también la cola). */
export function filtrarPorSemaforo(t: Tablero, semaforo: Semaforo | null): Tablero {
  if (!semaforo) return t;
  const filas = t.filas.filter((f) => f.semaforo === semaforo);
  const ids = new Set(filas.map((f) => f.viaje.id));
  return { ...t, filas, excepciones: t.excepciones.filter((e) => ids.has(e.viajeId)) };
}


// ── «Sin señal de vida»: la cadena de cada episodio, lista para pintar ────────────────────────────────────────────────────────────

export interface EpisodioVista {
  id: string;
  viajeId: string;
  folio: string;
  chofer: string;
  /** «GPS sin reportar» / «Detenido fuera de un sitio». */
  motivo: string;
  abiertoEn: string;
  abierto: boolean;
  /** Dónde va (abierto) o cómo terminó (cerrado), en una línea. */
  estado: string;
  /** Cada paso que sí ocurrió, con su hora: «Primer aviso al chofer», «Segundo aviso», «Escalado al jefe de tráfico». */
  pasos: Array<{ texto: string; en: string }>;
  /** Un episodio escalado al jefe y todavía abierto es lo que más urge. */
  urgente: boolean;
}

const MOTIVO_EPISODIO: Record<EpisodioTablero['motivo'], string> = { gps_obsoleto: 'GPS sin reportar', gps_detenido: 'Detenido fuera de un sitio' };
const RESPUESTA_EPISODIO: Record<NonNullable<EpisodioTablero['respuesta']>, string> = { estoy: 'Sí, estoy', voy_a_cargar: 'Voy a cargar', estoy_bien: 'Estoy bien' };

/** Los episodios de la pantalla, en el orden que llegan (más reciente primero). Puro: no lee nada. */
export function episodiosVista(eps: readonly EpisodioTablero[]): EpisodioVista[] {
  return eps.map((e): EpisodioVista => {
    const abierto = e.cerradoEn === null;
    const pasos: EpisodioVista['pasos'] = [];
    if (e.aviso1En) pasos.push({ texto: 'Primer aviso al chofer', en: e.aviso1En });
    if (e.aviso2En) pasos.push({ texto: 'Segundo aviso al chofer', en: e.aviso2En });
    if (e.escaladoEn) pasos.push({ texto: 'Aviso al jefe de tráfico', en: e.escaladoEn });
    let estado: string;
    if (abierto) {
      estado = e.nivelEnviado === 3 ? 'Escalado al jefe de tráfico, sigue sin atenderse'
        : e.nivelEnviado === 2 ? 'Segundo aviso mandado, sin respuesta del chofer'
        : e.nivelEnviado === 1 ? 'Primer aviso mandado, sin respuesta del chofer'
        : 'Detectado, falta mandar el primer aviso (o la flota lo tiene apagado)';
    } else {
      estado = e.cierreMotivo === 'respondio' ? `El chofer respondió${e.respuesta ? `: «${RESPUESTA_EPISODIO[e.respuesta]}»` : ''}`
        : e.cierreMotivo === 'senal_recuperada' ? 'El GPS volvió a reportar'
        : e.cierreMotivo === 'atendido_por_jefe' ? 'Lo atendió el jefe de tráfico'
        : e.cierreMotivo === 'viaje_cerrado' ? 'El viaje se cerró' : 'Cerrado';
    }
    return {
      id: e.id, viajeId: e.viajeId, folio: e.folio ?? 'sin folio', chofer: e.operador ?? 'sin chofer', motivo: MOTIVO_EPISODIO[e.motivo],
      abiertoEn: e.abiertoEn, abierto, estado, pasos, urgente: abierto && e.nivelEnviado === 3,
    };
  });
}
