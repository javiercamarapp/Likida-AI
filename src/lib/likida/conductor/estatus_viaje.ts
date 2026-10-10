import type { ConfigConductor } from './config';
import { hitoActivo } from './maquina';
import { anclaDe } from './planificador';
import type { ViajeTablero } from './repo_validacion';
import { calcularEstancias, type Estancia } from './estadias_anden';
import { estaResuelto, TIPOS_HITO, type HitoFila, type TipoHito } from './tipos';
import type { Semaforo } from './tablero';
import { llegadaPorConfirmar, type VeredictoMinimo } from './validacion';

// ═══════════════════════════════════════════════════════════════════════════
// `estatusViaje(viajeId)` — el servicio interno que el futuro agente Vigía consulta: ¿en qué va este
// viaje? Último hito, siguiente hito con su ETA/cita, y si el chofer está en un andén. Puro; el I/O está
// en `servicios.ts`.
//
// NO es telemetría: la hora de cada hito es la del MENSAJE del chofer (o la declarada por la oficina), y la
// ETA es la que el despachador o el TMS capturó. El Vigía tiene que decirlo así.
// ═══════════════════════════════════════════════════════════════════════════

export interface PuntoHitoEstatus {
  tipo: TipoHito;
  estado: HitoFila['estado'];
  /** La hora del mensaje (o declarada por oficina). */
  hora: string | null;
  fuente: HitoFila['fuente'];
  validadoPor: HitoFila['validadoPor'];
}

export interface EstatusViaje {
  viajeId: string;
  folio: string | null;
  estatus: string;
  operador: { id: string; nombre: string | null };
  ultimoHito: PuntoHitoEstatus | null;
  /**
   * Un «ya llegué» del chofer que NINGUNA posición respalda (sin GPS, GPS que no coincide, o aún sin medir): NO es el último hito
   * ni abre el andén —el Vigía no puede decirle al cliente «en destino» por eso—, pero tampoco se pierde: aquí queda, con su hora.
   */
  llegadaPorConfirmar: { tipo: TipoHito; hora: string | null } | null;
  siguienteHito: {
    tipo: TipoHito;
    estado: HitoFila['estado'];
    /** Desde cuándo «toca» según la escalera de la flota. */
    tocaDesde: string | null;
    /** La cita (manda) o la ETA del siguiente punto de llegada; null si no hay o si el siguiente hito es una salida. */
    cita: { en: string; fuente: 'cita' | 'eta' } | null;
    escalado: boolean;
    atendido: boolean;
  } | null;
  semaforo: Semaforo;
  /**
   * La cita (manda) o la ETA de LLEGADA a cada punto del viaje, sin importar cuál es el hito activo: el Vigía le
   * contesta a quien espera la carga en el destino aunque el chofer aún no salga de la carga. Una llegada que ya
   * se registró NO se lista (ya no es un dato futuro). `null` = nadie capturó cita ni ETA: no se inventa.
   */
  citas: { carga: { en: string; fuente: 'cita' | 'eta' } | null; descarga: { en: string; fuente: 'cita' | 'eta' } | null };
  /** La parada en la que está AHORA (llegó y no ha salido), con sus minutos. */
  enAnden: Pick<Estancia, 'lugar' | 'minutos'> & { desde: string | null } | null;
  completo: boolean;
  /** Cuándo se calculó. */
  calculadoEn: string;
}

function citaDelHito(tipo: TipoHito, v: ViajeTablero): { en: string; fuente: 'cita' | 'eta' } | null {
  if (tipo === 'llegada_carga') {
    if (v.citaOrigenEn) return { en: v.citaOrigenEn, fuente: 'cita' };
    if (v.etaOrigenEn) return { en: v.etaOrigenEn, fuente: 'eta' };
  }
  if (tipo === 'llegada_descarga') {
    if (v.citaDestinoEn) return { en: v.citaDestinoEn, fuente: 'cita' };
    if (v.etaDestinoEn) return { en: v.etaDestinoEn, fuente: 'eta' };
  }
  return null;
}

export function construirEstatus(
  v: ViajeTablero, hitos: readonly HitoFila[], config: ConfigConductor, ahora: Date,
  /** El veredicto de ubicación vigente por hito (id). `null` = no se pudo leer / no hay: con sitio asignado la llegada queda por confirmar. */
  veredictos: ReadonlyMap<string, VeredictoMinimo> | null = null,
): EstatusViaje {
  const ordenados = [...hitos].sort((a, b) => TIPOS_HITO.indexOf(a.tipo) - TIPOS_HITO.indexOf(b.tipo));
  const porConfirmar = ordenados.filter((h) => llegadaPorConfirmar(
    h, veredictos?.get(h.id), config.validarUbicacion, (h.tipo === 'llegada_carga' ? v.origenSitioId : v.destinoSitioId) !== null,
  ));
  const sinConfirmar = new Set(porConfirmar.map((h) => h.id));
  const resueltos = ordenados.filter((h) => estaResuelto(h) && !sinConfirmar.has(h.id));
  // «Último» = el de mayor hora (un hito corregido o capturado después puede quedar fuera de secuencia).
  const hora = (h: HitoFila) => new Date(h.mensajeEn ?? h.recibidoEn ?? 0).getTime();
  const ultimo = [...resueltos].sort((a, b) => hora(b) - hora(a))[0] ?? null;
  const activo = hitoActivo(ordenados);
  const tocaDesde = activo ? anclaDe(activo, v, ordenados, config) : null;

  let semaforo: Semaforo;
  if (ordenados.length === 0) semaforo = 'sin_ancla';
  else if (!activo) semaforo = 'completo';
  else if (activo.estado === 'escalado') semaforo = 'sin_reporte';
  else if (!tocaDesde) semaforo = 'sin_ancla';
  else {
    const vencido = Math.floor((ahora.getTime() - tocaDesde.getTime()) / 60_000);
    const primerRecordatorio = config.solicitudesMin[1] ?? config.solicitudesMin[0] + 15;
    semaforo = vencido >= config.escalarTrasMin ? 'sin_reporte' : vencido >= primerRecordatorio ? 'atrasado' : 'a_tiempo';
  }

  const llegoA = (t: TipoHito) => ordenados.some((h) => h.tipo === t && estaResuelto(h) && !sinConfirmar.has(h.id));
  const citas = {
    carga: llegoA('llegada_carga') ? null : citaDelHito('llegada_carga', v),
    descarga: llegoA('llegada_descarga') ? null : citaDelHito('llegada_descarga', v),
  };
  const enCurso = calcularEstancias(v, ordenados, ahora, { validaciones: new Map(), evidencias: new Map() }).find((e) => e.fase === 'en_curso') ?? null;
  return {
    viajeId: v.id, folio: v.folio, estatus: v.estatus, operador: { id: v.operadorId, nombre: v.operadorNombre },
    llegadaPorConfirmar: porConfirmar.length > 0 ? (() => {
      const h = [...porConfirmar].sort((a, b) => hora(b) - hora(a))[0];
      return { tipo: h.tipo, hora: h.mensajeEn ?? h.recibidoEn };
    })() : null,
    ultimoHito: ultimo ? { tipo: ultimo.tipo, estado: ultimo.estado, hora: ultimo.mensajeEn ?? ultimo.recibidoEn, fuente: ultimo.fuente, validadoPor: ultimo.validadoPor } : null,
    siguienteHito: activo ? {
      tipo: activo.tipo, estado: activo.estado, tocaDesde: tocaDesde ? tocaDesde.toISOString() : null, cita: citaDelHito(activo.tipo, v),
      escalado: activo.estado === 'escalado', atendido: activo.escalacionAtendidaEn !== null,
    } : null,
    semaforo, citas,
    enAnden: enCurso && !(enCurso.llegada && sinConfirmar.has(enCurso.llegada.hitoId)) ? { lugar: enCurso.lugar, minutos: enCurso.minutos, desde: enCurso.llegada?.en ?? null } : null,
    completo: ordenados.length > 0 && !activo,
    calculadoEn: ahora.toISOString(),
  };
}
