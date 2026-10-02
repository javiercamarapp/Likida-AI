import type { ConfigConductor } from '../conductor/config';
import type { DatosTablero } from '../conductor/repo_validacion';
import { armarTablero, type Excepcion, type FilaTablero, type Semaforo } from '../conductor/tablero';
import { ETIQUETA, type EstadoHito, type TipoHito } from '../conductor/tipos';
import { nivelDePosicionPorDefecto, type ClasificadorFrescura, type NivelFrescura } from './enganche_gps';

// ═══════════════════════════════════════════════════════════════════════════
// EL TABLERO DE VIAJES EN VIVO — modelo de vista puro (sin I/O).
//
// Todos los viajes en curso de la flota con: su ÚLTIMO HITO del Conductor, la
// ÚLTIMA POSICIÓN conocida del tractor con la ANTIGÜEDAD de esa posición, y las
// EXCEPCIONES que piden a una persona (llegada sin confirmar, sin señal de
// vida, escalado al jefe de tráfico, estadía excedida, GPS obsoleto…).
//
// No re-inventa nada del Conductor: el semáforo y la cola de excepciones salen
// de `armarTablero` (la misma escalera de la config de la flota). Lo que este
// módulo agrega es lo que el Conductor no cruza: la posición del tractor y su
// frescura. Una posición vieja SIGUE SIENDO la última conocida: se marca, no se
// esconde ni se presenta como actual; y «sin posición» no es «sin problema».
// ═══════════════════════════════════════════════════════════════════════════

export interface PosicionUnidad { lat: number; lng: number; medidaEn: string }

export type TipoExcepcionViaje =
  | Excepcion['tipo']
  | 'sin_senal_de_vida' | 'gps_obsoleto' | 'sin_posicion' | 'sin_unidad';

export interface ExcepcionViaje {
  tipo: TipoExcepcionViaje;
  /** 3 = urgente, 2 = revisar, 1 = vigilar. */
  gravedad: 1 | 2 | 3;
  desde: string | null;
  texto: string;
}

export type SenalDeVida = 'viva' | 'dudosa' | 'sin_senal';

export interface FilaViaje {
  viajeId: string;
  folio: string | null;
  origen: string | null;
  destino: string | null;
  chofer: string | null;
  terminalId: string | null;
  terminal: string | null;
  clienteId: string | null;
  cliente: string | null;
  semaforo: Semaforo;
  motivo: string;
  /** El último hito YA registrado (el más avanzado del viaje), o null si ninguno. */
  ultimoHito: { tipo: TipoHito; etiqueta: string; estado: EstadoHito; cuando: string | null } | null;
  /** El hito que toca ahora (el que se está esperando), o null si el viaje ya completó los cinco. */
  hitoActivo: TipoHito | null;
  /** Posición conocida del tractor; null si no hay unidad o nunca reportó. */
  posicion: (PosicionUnidad & { antiguedadMin: number; frescura: NivelFrescura }) | null;
  senalDeVida: SenalDeVida;
  /** Escalado al jefe de tráfico: nivel y si alguien ya lo atendió. null = no escalado. */
  escalado: { nivel: number; desde: string | null; atendido: boolean } | null;
  excepciones: ExcepcionViaje[];
  /** Mayor gravedad de sus excepciones (0 = ninguna). */
  gravedad: 0 | 1 | 2 | 3;
}

export interface FiltrosViajes {
  terminalId?: string | null;
  clienteId?: string | null;
  /** Solo los que tienen al menos una excepción. */
  soloExcepciones?: boolean;
}

export interface TableroViajes {
  generadoEn: string;
  filas: FilaViaje[];
  /** Cuántos pasaron los filtros antes de recortar. */
  total: number;
  /** El Conductor recortó los viajes activos (hay más de los listados). */
  hayMas: boolean;
  conteos: {
    viajes: number; conExcepcion: number; sinSenal: number; gpsObsoleto: number; sinPosicion: number;
    llegadaSinConfirmar: number; escaladosATrafico: number;
  };
}

export interface EntradaTableroViajes {
  datos: DatosTablero;
  config: ConfigConductor;
  /** Última posición por `unidad_id`. */
  posiciones: ReadonlyMap<string, PosicionUnidad>;
  ahora: Date;
  filtros?: FiltrosViajes;
  /** El enganche con el semáforo de obsolescencia del GPS (ver `enganche_gps.ts`). */
  clasificar?: ClasificadorFrescura;
}

const MS_MIN = 60_000;

function ultimoHitoDe(f: FilaTablero): FilaViaje['ultimoHito'] {
  // El «último» es el más avanzado en la secuencia que ya trae un dato del chofer o de la oficina.
  for (let i = f.hitos.length - 1; i >= 0; i--) {
    const h = f.hitos[i];
    if (h.estado === 'recibido' || h.estado === 'validado') {
      return { tipo: h.tipo, etiqueta: ETIQUETA[h.tipo].corta, estado: h.estado, cuando: h.horaMensaje ?? h.recibidoEn };
    }
  }
  return null;
}

function escaladoDe(f: FilaTablero): FilaViaje['escalado'] {
  let mejor: FilaViaje['escalado'] = null;
  for (const h of f.hitos) {
    if (h.estado !== 'escalado' && !(h.escaladoEn && h.estado === 'esperado')) continue;
    if (h.escalacionNivel < 1) continue;
    if (!mejor || h.escalacionNivel > mejor.nivel) mejor = { nivel: h.escalacionNivel, desde: h.escaladoEn, atendido: h.atendidaEn !== null };
  }
  return mejor;
}

const etiquetaFrescura: Record<NivelFrescura, string> = { en_vivo: 'en vivo', atrasada: 'atrasada', obsoleta: 'obsoleta' };

export function textoAntiguedad(min: number): string {
  if (min < 1) return 'hace menos de un minuto';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `hace ${h} h` : `hace ${h} h ${m} min`;
}

export function armarTableroViajes(e: EntradaTableroViajes): TableroViajes {
  const clasificar = e.clasificar ?? nivelDePosicionPorDefecto;
  const base = armarTablero(e.datos, e.config, e.ahora);
  const excepcionesPorViaje = new Map<string, Excepcion[]>();
  for (const x of base.excepciones) excepcionesPorViaje.set(x.viajeId, [...(excepcionesPorViaje.get(x.viajeId) ?? []), x]);
  const f = e.filtros ?? {};

  const filas: FilaViaje[] = [];
  for (const fila of base.filas) {
    const v = fila.viaje;
    if (f.terminalId && v.terminalId !== f.terminalId) continue;
    if (f.clienteId && v.clienteId !== f.clienteId) continue;

    const pos = v.unidadId ? e.posiciones.get(v.unidadId) ?? null : null;
    let posicion: FilaViaje['posicion'] = null;
    if (pos) {
      const t = Date.parse(pos.medidaEn);
      // Una fecha ilegible o futura no se maquilla de «en vivo»: cae a obsoleta (el clasificador lo hace con NaN/negativos).
      const antiguedadMin = Number.isFinite(t) ? Math.round((e.ahora.getTime() - t) / MS_MIN) : Number.NaN;
      posicion = { ...pos, antiguedadMin: Number.isFinite(antiguedadMin) ? Math.max(0, antiguedadMin) : -1, frescura: clasificar(antiguedadMin) };
    }

    const excepciones: ExcepcionViaje[] = (excepcionesPorViaje.get(v.id) ?? []).map((x) => ({
      tipo: x.tipo, gravedad: x.gravedad, desde: x.desde, texto: x.texto,
    }));
    const quien = (v.operadorNombre ?? 'El chofer').replace(/\s+/g, ' ').trim() || 'El chofer';

    const gpsMal = !v.unidadId ? 'sin_unidad' : !posicion ? 'sin_posicion' : posicion.frescura === 'obsoleta' ? 'obsoleta' : null;
    if (gpsMal === 'sin_unidad') {
      excepciones.push({ tipo: 'sin_unidad', gravedad: 1, desde: v.aceptadoEn, texto: `${quien} tiene el viaje en curso pero no tiene tractor asignado: no hay posición que conciliar.` });
    } else if (gpsMal === 'sin_posicion') {
      excepciones.push({ tipo: 'sin_posicion', gravedad: 2, desde: v.aceptadoEn, texto: `El tractor de ${quien} no ha reportado ninguna posición.` });
    } else if (gpsMal === 'obsoleta' && posicion) {
      excepciones.push({
        tipo: 'gps_obsoleto', gravedad: 2, desde: posicion.medidaEn,
        texto: `La última posición del tractor de ${quien} es ${etiquetaFrescura[posicion.frescura]} (${textoAntiguedad(Math.max(0, posicion.antiguedadMin))}). Un camión parado puede reportar poco, pero conviene confirmarlo.`,
      });
    }

    // Sin señal de vida = el chofer no contesta Y el tractor tampoco da señal fresca.
    const choferCallado = fila.semaforo === 'sin_reporte';
    const gpsCallado = gpsMal !== null && gpsMal !== 'sin_unidad';
    const senalDeVida: SenalDeVida = choferCallado && gpsCallado ? 'sin_senal' : choferCallado || gpsCallado ? 'dudosa' : 'viva';
    if (senalDeVida === 'sin_senal') {
      excepciones.push({
        tipo: 'sin_senal_de_vida', gravedad: 3, desde: fila.hitos.find((h) => h.tocaDesde)?.tocaDesde ?? null,
        texto: `${quien} no contesta y el tractor no da señal fresca: ninguna de las dos fuentes confirma que esté bien. Requiere una persona.`,
      });
    }

    excepciones.sort((a, b) => b.gravedad - a.gravedad || (a.desde ?? '').localeCompare(b.desde ?? ''));
    const gravedad = (excepciones[0]?.gravedad ?? 0) as FilaViaje['gravedad'];
    if (f.soloExcepciones && excepciones.length === 0) continue;

    filas.push({
      viajeId: v.id, folio: v.folio, origen: v.origen, destino: v.destino, chofer: v.operadorNombre,
      terminalId: v.terminalId, terminal: v.terminalNombre, clienteId: v.clienteId, cliente: v.clienteNombre,
      semaforo: fila.semaforo, motivo: fila.motivo, ultimoHito: ultimoHitoDe(fila), hitoActivo: fila.hitoActivo,
      posicion, senalDeVida, escalado: escaladoDe(fila), excepciones, gravedad,
    });
  }

  // Lo que más urge primero; a igual gravedad, el que lleva más tiempo con el problema.
  filas.sort((a, b) => b.gravedad - a.gravedad
    || (a.excepciones[0]?.desde ?? '9999').localeCompare(b.excepciones[0]?.desde ?? '9999')
    || (a.folio ?? a.viajeId).localeCompare(b.folio ?? b.viajeId));

  const cuenta = (t: TipoExcepcionViaje) => filas.filter((x) => x.excepciones.some((y) => y.tipo === t)).length;
  return {
    generadoEn: e.ahora.toISOString(),
    filas, total: filas.length, hayMas: base.hayMas,
    conteos: {
      viajes: filas.length,
      conExcepcion: filas.filter((x) => x.excepciones.length > 0).length,
      sinSenal: filas.filter((x) => x.senalDeVida === 'sin_senal').length,
      gpsObsoleto: cuenta('gps_obsoleto'),
      sinPosicion: cuenta('sin_posicion'),
      llegadaSinConfirmar: cuenta('llegada_sin_confirmar'),
      escaladosATrafico: filas.filter((x) => x.escalado !== null).length,
    },
  };
}
