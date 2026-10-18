import type { ConfigConductor } from './config';
import { esLocalAbierto, type EstadoTransito } from './estados_transito';
import { calcularEstancias, excedeUmbral, type Estancia } from './estadias_anden';
import { estadoReporte, hitoActivo, reubicacionesDespuesDelPrimero, type Reubicacion } from './maquina';
import { textoRampa } from './mensajes';
import { haversineM } from './geo';
import { hoyDeLaFlota, rutasDelViaje } from './rutas';
import { aplicarPerfil } from './perfil';
import { evaluarSalidaTms, textoSalidaTms } from './salida_tms';
import { anclaDe, textoTiempo } from './planificador';
import type { AccionOficinaFila, DatosTablero, IndicadoresCrudos, ViajeTablero, VeredictoFila } from './repo_validacion';
import type { EpisodioTablero } from './repo';
import { esMarcaAvisoChofer, nivelesFallidosAlChofer } from './senal_vida';
import type { ReubicacionesCliente } from './reubicaciones';
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
  /** T-A5-43: «con quién te reportaste» y rampa vigentes de la llegada, con la lista de reubicaciones. Ausente si nadie la compuso (`conReporteDeLlegada`). */
  reporte?: ReporteLlegadaVista;
}

/** T-A5-43: lo que pinta el tablero de la lista de reubicaciones de una llegada. */
export interface ReporteLlegadaVista {
  contacto: string | null;
  rampa: string | null;
  /** Veces que cambió de rampa o contacto después del primer registro (el «como canica» del cliente). */
  reubicaciones: number;
  /** El historial, del primero al último, para abrirlo como evidencia: «HH:MM · contacto · rampa». */
  historial: Array<{ en: string; contacto: string | null; rampa: string | null }>;
}

export type TipoExcepcion =
  | 'escalado_sin_atender' | 'sin_reporte' | 'atrasado' | 'sin_coincidencia' | 'llegada_sin_confirmar' | 'llegada_sin_sitio' | 'estadia_excedida' | 'horas_incoherentes' | 'sin_a_quien_escalar' | 'pendiente_cruce_largo' | 'salida_tms_discrepante' | 'patio_entrega_distinto' | 'local_abierto_sin_ccp' | 'sin_ruta_autorizada';

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
  /** T-A5-11 «dónde está»: la última posición de la unidad, lista para pintar. Nunca inventa. */
  ubicacion: UbicacionFila;
  /** T-A5-21: estado de tránsito (frontera) informativo. `null` con la casilla apagada o sin dato: la columna no se pinta. */
  transito: TransitoFila | null;
  /** T-A5-22: la «Fecha Salida» del TMS como candidato a `salida_carga` o como discrepancia con el GPS. `null` = sin marca, o el hito ya está registrado. Solo se lee: el tablero no registra nada. */
  salidaTms: SalidaTmsFila | null;
}

/** T-A5-22: lo que pinta la línea «TMS». */
export interface SalidaTmsFila {
  estado: 'candidato' | 'discrepancia';
  texto: string;
  /** La marca del TMS (ISO). */
  marca: string;
}

/** T-A5-21: lo que pinta la columna «Tránsito». Solo se lee: NO genera avisos al chofer ni escalamiento. */
export interface TransitoFila {
  estado: EstadoTransito;
  /** «En patio NLD desde hace 7 h» (o «… (sin fecha de actualización)»). */
  texto: string;
  /** Minutos que lleva en ese estado; `null` si la fuente no dio fecha. */
  minutos: number | null;
}

/** Pasados estos minutos la última posición se marca obsoleta (sigue siendo la última conocida: se marca, no se esconde). */
export const MINUTOS_POSICION_OBSOLETA = 45;

export interface UbicacionFila {
  /** «hace 12 min»; null si no hay posición. */
  hace: string | null;
  /** Nombre del sitio (carga/descarga del viaje) más cercano, o null si no hay sitio con coordenadas. */
  sitioMasCercano: string | null;
  distanciaM: number | null;
  fuente: 'gps' | 'pin' | 'sin_dato';
  obsoleta: boolean;
  /** La frase completa que pinta la pantalla. */
  texto: string;
}

export const TEXTO_SIN_POSICION = 'Sin posición reciente (el GPS de esta unidad no ha reportado)';
export const TEXTO_POSICION_NO_LEIDA = 'No se pudo consultar la posición ahora mismo (no significa que la unidad no tenga GPS)';

function haceTexto(min: number): string {
  if (min < 1) return 'hace menos de 1 min';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m === 0 ? `hace ${h} h` : `hace ${h} h ${m} min`;
}

function distanciaTexto(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

/** Arma «Última posición: hace 12 min · a 3.2 km de <sitio>». Puro; sin coordenadas en el texto (no se loguean ni se pintan). */
export function ubicacionDeFila(viaje: ViajeTablero, datos: DatosTablero, ahora: Date): UbicacionFila {
  const vacia = (texto: string): UbicacionFila => ({ hace: null, sitioMasCercano: null, distanciaM: null, fuente: 'sin_dato', obsoleta: false, texto });
  if (!datos.posiciones) return vacia(TEXTO_POSICION_NO_LEIDA);
  const p = viaje.unidadId ? datos.posiciones.get(viaje.unidadId) : undefined;
  if (!p) return vacia(viaje.unidadId ? TEXTO_SIN_POSICION : 'Sin tractor asignado: no hay posición que mostrar');
  const t = Date.parse(p.medidaEn);
  if (!Number.isFinite(t) || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return vacia(TEXTO_SIN_POSICION);
  const min = Math.max(0, Math.floor((ahora.getTime() - t) / MS_MIN));
  let cercano: { nombre: string; d: number } | null = null;
  for (const id of [viaje.origenSitioId, viaje.destinoSitioId]) {
    const s = id ? datos.sitiosCoords?.get(id) : undefined;
    if (!s) continue;
    const d = haversineM(p, s);
    if (!cercano || d < cercano.d) cercano = { nombre: s.nombre, d };
  }
  const hace = haceTexto(min);
  const obsoleta = min > MINUTOS_POSICION_OBSOLETA;
  const partes = [`Última posición: ${hace}`];
  if (cercano) partes.push(`a ${distanciaTexto(cercano.d)} de ${cercano.nombre}`);
  if (p.fuente === 'pin') partes.push('ubicación enviada por WhatsApp');
  if (obsoleta) partes.push('obsoleta');
  return { hace, sitioMasCercano: cercano?.nombre ?? null, distanciaM: cercano ? Math.round(cercano.d) : null, fuente: p.fuente, obsoleta, texto: partes.join(' · ') };
}

export interface ConteosSemaforo { completo: number; a_tiempo: number; atrasado: number; sin_reporte: number; sin_ancla: number }

export interface Tablero {
  filas: FilaTablero[];
  excepciones: Excepcion[];
  conteos: ConteosSemaforo;
  hayMas: boolean;
  /** T-A5-26: `true` solo si se LEYERON las posiciones y no hay ninguna reciente para los viajes listados. Si no se leyeron, `false` (no se afirma). */
  sinGps: boolean;
  /**
   * T-A5-63: reubicaciones por cliente (cuántas veces y cuántos minutos lo mandaron a otra rampa) y el CSV para disputar «no se presentó».
   * Ausente si la perilla del reporte de llegada está apagada o la bitácora no se pudo leer: no se afirma lo que no se leyó.
   */
  reubicaciones?: { porCliente: ReubicacionesCliente[]; csv: string };
}

const MS_MIN = 60_000;

/** T-A5-26: los datos de demostración del seed llevan folio `DEMO-…` (el prefijo anterior se sigue reconociendo); en pantalla se rotulan «SIMULADO» (nunca pasan por reales). */
export const esFolioSimulado = (folio: string | null | undefined): boolean => typeof folio === 'string' && /^(DEMO|INN)-/i.test(folio);

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


const TOPE_TEXTO_TRANSITO = 40;

/** Arma «En patio NLD desde hace 7 h». Puro. El complemento del patio sale del texto crudo de la fuente; nunca se inventa. */
export function transitoDeFila(
  d: { estado: EstadoTransito; textoOrigen: string | null; actualizadoEn: string | null },
  ahora: Date,
): TransitoFila {
  const crudo = (d.textoOrigen ?? '').replace(/\s+/g, ' ').trim().slice(0, TOPE_TEXTO_TRANSITO);
  let etiqueta: string;
  if (esLocalAbierto(d)) etiqueta = 'Local abierto';
  else if (d.estado === 'en_patio') {
    // eslint-disable-next-line security/detect-unsafe-regex -- patrón anclado de formato fijo, sin cuantificadores anidados ni retroceso exponencial; la entrada es un valor corto de una celda o campo
    const resto = /^(?:en\s+)?patio\s+(.+)$/i.exec(crudo)?.[1];
    etiqueta = resto ? `En patio ${resto}` : 'En patio';
  } else if (d.estado === 'en_ruta') etiqueta = 'En ruta';
  else if (d.estado === 'pendiente_cruce') etiqueta = 'Pendiente de cruce';
  else etiqueta = crudo ? `Tránsito: ${crudo}` : 'Tránsito sin clasificar';
  const t = d.actualizadoEn ? Date.parse(d.actualizadoEn) : NaN;
  if (!Number.isFinite(t)) return { estado: d.estado, texto: `${etiqueta} (sin fecha de actualización)`, minutos: null };
  const minutos = Math.max(0, Math.floor((ahora.getTime() - t) / MS_MIN));
  return { estado: d.estado, texto: `${etiqueta} ${haceTexto(minutos).replace('hace ', 'desde hace ')}`, minutos };
}

/** T-A5-22: la marca de salida del TMS de UNA fila. Contradice solo con la última posición GPS (no con pines de WhatsApp) y un sitio con radio conocido. */
export function salidaTmsDeFila(viaje: ViajeTablero, hs: readonly HitoFila[], datos: DatosTablero, config: ConfigConductor, ahora: Date): SalidaTmsFila | null {
  const iso = datos.salidasTms?.get(viaje.id);
  if (!iso) return null;
  const sitio = viaje.origenSitioId ? datos.sitiosCoords?.get(viaje.origenSitioId) : undefined;
  const p = viaje.unidadId ? datos.posiciones?.get(viaje.unidadId) : undefined;
  const geom = sitio && sitio.radioM ? { lat: sitio.lat, lng: sitio.lng, radioM: sitio.radioM } : null;
  const posiciones = p && p.fuente === 'gps' ? [{ lat: p.lat, lng: p.lng, medidaEn: new Date(p.medidaEn) }] : [];
  const d = evaluarSalidaTms({
    tmsSalidaEn: iso, hito: hs.find((h) => h.tipo === 'salida_carga'), aplicar: config.aplicarSalidaDelTms,
    sitioCarga: geom, toleranciaM: config.toleranciaUbicacionM, posiciones, ahora,
  });
  if (!d.marca || (d.estado !== 'candidato' && d.estado !== 'aplicar' && d.estado !== 'discrepancia')) return null;
  // `aplicar` (casilla encendida) todavía no se registró: mientras tanto se ve como candidato.
  const estado = d.estado === 'discrepancia' ? 'discrepancia' : 'candidato';
  return { estado, texto: textoSalidaTms(estado, d.marca, config.zonaHoraria, sitio?.nombre ?? null), marca: d.marca.toISOString() };
}

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
    // T-A5-08: un hito que el perfil no sigue se lee como omitido: no cuenta como «atrasado» ni «sin reporte».
    const hs = [...aplicarPerfil(hitosPorViaje.get(viaje.id) ?? [], config.perfilSeguimiento)].sort((a, b) => TIPOS_HITO.indexOf(a.tipo) - TIPOS_HITO.indexOf(b.tipo));
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

    // T-A5-21: informativo. Solo con la casilla encendida y con dato; no toca semáforo, hitos ni avisos.
    const dt = config.mostrarEstadosFrontera ? datos.transito?.get(viaje.id) : undefined;
    const transito = dt ? transitoDeFila(dt, ahora) : null;

    // T-A5-22: informativo. La marca del TMS se propone o se señala como discrepancia; registrar el hito es del barrido (con la casilla).
    const salidaTms = salidaTmsDeFila(viaje, hs, datos, config, ahora);

    filas.push({
      viaje, hitos: vistas, semaforo, motivo, hitoActivo: activo?.tipo ?? null, minutosVencido, estancias,
      sitioCarga: viaje.origenSitioId ? datos.sitios.get(viaje.origenSitioId) ?? null : null,
      sitioDescarga: viaje.destinoSitioId ? datos.sitios.get(viaje.destinoSitioId) ?? null : null,
      ubicacion: ubicacionDeFila(viaje, datos, ahora),
      transito,
      salidaTms,
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
    if (salidaTms?.estado === 'discrepancia') {
      excepciones.push({
        ...base, tipo: 'salida_tms_discrepante', hitoId: null, hitoTipo: 'salida_carga', gravedad: 1, desde: salidaTms.marca, texto: salidaTms.texto,
      });
    }
    const umbralH = config.umbralPendienteCruceH ?? null;
    if (transito && transito.estado === 'pendiente_cruce' && umbralH !== null && transito.minutos !== null && transito.minutos >= umbralH * 60) {
      excepciones.push({
        ...base, tipo: 'pendiente_cruce_largo', hitoId: null, hitoTipo: null, gravedad: 1, desde: dt?.actualizadoEn ?? null,
        texto: `${transito.texto} (umbral configurado: ${textoTiempo(umbralH * 60)}). Es solo lectura: el agente no avisa por esto.`,
      });
    }
    // T-A5-57: viaje local abierto sin complemento ligado. Solo se muestra: el agente no lo cierra, no emite la Carta Porte
    // ni avisa a nadie (cerrarlo es decisión de los ejecutivos). Sin lectura de complementos no se afirma «sin Carta Porte».
    if (transito && dt && esLocalAbierto(dt) && datos.ccpLigado && !datos.ccpLigado.has(viaje.id)) {
      excepciones.push({
        ...base, tipo: 'local_abierto_sin_ccp', hitoId: null, hitoTipo: null, gravedad: 1, desde: dt.actualizadoEn ?? null,
        texto: `${transito.texto}: sin Carta Porte (viaje local abierto). Sigue abierto para no perder el GPS; el agente no lo cierra ni emite el complemento.`,
      });
    }
    // T-A5-49 (R04): el chofer ya recibió «consulta con tu supervisor» en vez del link de ruta. Solo se muestra: no inventa ruta ni avisa a nadie.
    // Con la base de rutas vacía (la flota aún no las carga) o sin poder leerla no se afirma nada. Importación y exportación se distinguen
    // cuando `viaje` traiga el servicio; hoy solo el origen se reclama (el destino lo exige solo la exportación).
    if (datos.rutasAutorizadas && datos.rutasAutorizadas.length > 0) {
      const r = rutasDelViaje(datos.rutasAutorizadas, {
        origen: viaje.origen, destino: viaje.destino,
        sitioOrigenCodigo: (viaje.origenSitioId && datos.sitioCodigos?.get(viaje.origenSitioId)) || null,
        sitioDestinoCodigo: (viaje.destinoSitioId && datos.sitioCodigos?.get(viaje.destinoSitioId)) || null,
      }, hoyDeLaFlota(ahora, config.zonaHoraria));
      if (r.faltan.length > 0) {
        excepciones.push({
          ...base, tipo: 'sin_ruta_autorizada', hitoId: null, hitoTipo: null, gravedad: 2, desde: viaje.aceptadoEn,
          texto: 'No hay ruta autorizada vigente para este viaje: el chofer recibió «consulta con tu supervisor» en lugar del link. Cárgala en Configuración, Rutas autorizadas.',
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

  // ── Terminales con un nivel de escalamiento sin a quién avisar: se ve ANTES de que haga falta, no en silencio ──
  for (const f of datos.sinDestino ?? []) {
    const viaje = datos.viajes.find((v) => v.terminalId === f.terminalId);
    if (!viaje) continue;
    excepciones.push({
      viajeId: viaje.id, folio: viaje.folio, chofer: null, hitoId: null, hitoTipo: null,
      tipo: 'sin_a_quien_escalar', gravedad: f.nivel === 1 ? 3 : 2, desde: null, texto: f.texto,
    });
  }

  // ── T-A5-44: el chofer declaró un patio de entrega distinto del esperado y el supervisor aún no lo atiende ──
  for (const f of datos.patiosDistintos ?? []) {
    const viaje = datos.viajes.find((v) => v.id === f.viajeId);
    if (!viaje) continue;
    excepciones.push({
      viajeId: viaje.id, folio: viaje.folio, chofer: null, hitoId: f.hitoId, hitoTipo: 'llegada_descarga',
      tipo: 'patio_entrega_distinto', gravedad: 3, desde: f.desde, texto: f.texto,
    });
  }

  excepciones.sort((a, b) => b.gravedad - a.gravedad || (a.desde ?? '').localeCompare(b.desde ?? ''));
  // Primero lo que más urge: sin_reporte, atrasado, a_tiempo, sin ancla, completo.
  const orden: Record<Semaforo, number> = { sin_reporte: 0, atrasado: 1, sin_ancla: 2, a_tiempo: 3, completo: 4 };
  filas.sort((a, b) => orden[a.semaforo] - orden[b.semaforo] || (b.minutosVencido ?? -1e9) - (a.minutosVencido ?? -1e9));
  const sinGps = datos.posiciones !== undefined && datos.posiciones.size === 0 && filas.length > 0;
  return { filas, excepciones, conteos, hayMas: datos.hayMas, sinGps };
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
    // AGE-C19-A1: la marca de tiempo de cada nivel se escribe al RECLAMARLO
    // (`reclamarNivelSenalVida`), antes de mandar nada. Si el envío falla, la
    // marca queda y el motivo cae en `ultimoError`. La escalera es secuencial
    // —cada nivel sólo se reclama desde el anterior—, así que el error es
    // siempre del ÚLTIMO nivel reclamado, que es `nivelEnviado`.
    //
    // El motivo NO se interpola en el texto: es texto libre de hasta 200
    // caracteres que viene de la base y acaba pintado en la pantalla.
    // AGE-C20-A1: lo de arriba es verdad para el error de la ESCALACIÓN, no para el de un aviso al chofer.
    // `marcaAvisoChoferFallido` es ACUMULATIVA (conserva el nivel anterior) y nadie la limpia al reclamar el
    // siguiente nivel, así que atribuirla al último nivel reclamado invierte los dos hechos: con el aviso 1
    // rechazado y el 2 entregado, el tablero daba el 1 por entregado y el 2 por perdido — y como la escalera
    // SIEMPRE termina en el nivel 3, el desenlace normal era «el aviso al jefe de tráfico NO salió» en la cara
    // del jefe que acababa de recibirlo. Los niveles están EN la marca y se leen con el MISMO parser que usa la
    // escalera (`nivelesFallidosAlChofer`), no con una segunda lista. Un error que NO es la marca solo lo
    // escribe la rama de escalación (`senal_vida.ts:399,417`), que reclama el nivel 3 antes de mandar: ése sí
    // es del último nivel reclamado, y así se conserva el anclaje original de AGE-C19-A1.
    const fallidosAlChofer = nivelesFallidosAlChofer(e.ultimoError);
    const errorSinMarca = e.ultimoError !== null && !esMarcaAvisoChofer(e.ultimoError);
    const noSalio = (nivel: 1 | 2 | 3): boolean =>
      (nivel !== 3 && fallidosAlChofer.has(nivel)) || (errorSinMarca && e.nivelEnviado === nivel);
    const pasos: EpisodioVista['pasos'] = [];
    if (e.aviso1En) pasos.push({ texto: noSalio(1) ? 'Primer aviso al chofer: NO salió' : 'Primer aviso al chofer', en: e.aviso1En });
    if (e.aviso2En) pasos.push({ texto: noSalio(2) ? 'Segundo aviso al chofer: NO salió' : 'Segundo aviso al chofer', en: e.aviso2En });
    if (e.escaladoEn) pasos.push({ texto: noSalio(3) ? 'Aviso al jefe de tráfico: NO salió' : 'Aviso al jefe de tráfico', en: e.escaladoEn });
    let estado: string;
    if (abierto) {
      estado = e.nivelEnviado === 3 ? (noSalio(3) ? 'El aviso al jefe de tráfico NO salió: nadie lo recibió' : 'Escalado al jefe de tráfico, sigue sin atenderse')
        : e.nivelEnviado === 2 ? (noSalio(2) ? 'El segundo aviso NO salió: el chofer no lo recibió' : 'Segundo aviso mandado, sin respuesta del chofer')
        : e.nivelEnviado === 1 ? (noSalio(1) ? 'El primer aviso NO salió: el chofer no lo recibió' : 'Primer aviso mandado, sin respuesta del chofer')
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

// ── T-A5-43: contacto y rampa de la llegada en el tablero (lectura pura; no registra nada) ──────────────────────────────

/** Lo vigente del reporte de la llegada. `contactoHito` es el del hito (`contacto_nombre`); la lista, si lo trae, manda. */
export function reporteLlegadaVista(contactoHito: string | null, lista: readonly Reubicacion[]): ReporteLlegadaVista | null {
  const vigente = estadoReporte(lista);
  if (!vigente && !contactoHito) return null;
  return {
    contacto: vigente?.contacto ?? contactoHito,
    rampa: textoRampa(vigente),
    reubicaciones: reubicacionesDespuesDelPrimero(lista),
    historial: lista.map((r) => ({ en: r.en, contacto: r.contacto, rampa: textoRampa(r) })),
  };
}

/**
 * Compone el reporte de llegada sobre las filas ya armadas: `reubicaciones` es hitoId → su lista. Una fila sin lista queda tal cual
 * (no se inventa rampa); solo se toca el hito que tiene lista. Devuelve filas nuevas, no muta las de `armarTablero`.
 */
export function conReporteDeLlegada(filas: readonly FilaTablero[], reubicaciones: ReadonlyMap<string, readonly Reubicacion[]>): FilaTablero[] {
  return filas.map((f) => ({
    ...f,
    hitos: f.hitos.map((h) => {
      const lista = reubicaciones.get(h.id);
      if (!lista || lista.length === 0) return h;
      const reporte = reporteLlegadaVista(h.contacto, lista);
      return reporte ? { ...h, reporte } : h;
    }),
  }));
}
