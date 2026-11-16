import { clasificarVigencia, type Vigencia } from '@/lib/likida/vigencias';
import {
  diasEntre, diaDeLaSemana, estaCerrado, estadoObligacion, fechaLimiteNominal, periodosCandidatos, primerDiaDelMes,
  type Candado, type Cumplimiento, type EstadoCatalogo, type EstadoObligacion, type ObligacionFiscal, type Periodicidad,
} from './fiscal';

// Arma las filas del calendario fiscal a partir del catálogo, los cumplimientos y el candado de entidad. PURO.
// Una fila por obligación: el periodo que toca atender (el vencido sin cerrar, o el próximo). Sin entidad (RFC propio) las que
// requieren entidad salen «aún no aplica» y SIN fecha: no se inventa un calendario para una sociedad que no existe.

export interface FilaCalendario {
  clave: string;
  nombre: string;
  periodicidad: Periodicidad;
  estadoCatalogo: EstadoCatalogo;
  estado: EstadoObligacion;
  /** El periodo que cubre la fila (null si no aplica o es de evento). */
  periodo: string | null;
  fechaLimite: string | null;
  sujetaADiaInhabil: boolean;
  /** Días a la fecha límite desde hoy (negativo = vencida). null si no hay fecha. */
  dias: number | null;
  /** Clasificación de vigencia (vencida / por vencer / vigente); null cuando no aplica o ya está presentada. */
  vigencia: Vigencia | null;
  cumplimiento: Cumplimiento | null;
  nota: string | null;
}

export interface EntradaCalendario {
  obligaciones: readonly ObligacionFiscal[];
  cumplimientos: readonly Cumplimiento[];
  candado: Candado;
  /** Fecha de constitución de la sociedad, si ya se capturó: los periodos anteriores no se le exigen. */
  constituidaEl?: string | null;
  /** Hoy en México (aaaa-mm-dd). */
  hoy: string;
}

function indexar(cumplimientos: readonly Cumplimiento[]): Map<string, Cumplimiento> {
  return new Map(cumplimientos.map((c) => [`${c.clave}|${c.periodo}`, c]));
}

export function armarCalendario(e: EntradaCalendario): FilaCalendario[] {
  const porClave = indexar(e.cumplimientos);
  const mesConstitucion = e.constituidaEl ? primerDiaDelMes(e.constituidaEl) : null;
  return e.obligaciones.map((ob): FilaCalendario => {
    const base = { clave: ob.clave, nombre: ob.nombre, periodicidad: ob.periodicidad, estadoCatalogo: ob.estadoCatalogo, nota: ob.nota ?? null };
    const sinFecha = (estado: EstadoObligacion): FilaCalendario => ({
      ...base, estado, periodo: null, fechaLimite: null, sujetaADiaInhabil: false, dias: null, vigencia: null, cumplimiento: null,
    });
    if (estadoObligacion(ob, e.candado, null) === 'aun_no_aplica') return sinFecha('aun_no_aplica');
    if (ob.periodicidad === 'evento') return sinFecha('sin_fecha');

    // El periodo a atender: el primero (del más viejo al más nuevo) que no esté cerrado ni sea anterior a la constitución.
    const exigible = (p: string): boolean => {
      if (mesConstitucion === null) return true;
      return ob.periodicidad === 'anual' ? Number(p.slice(0, 4)) >= Number(mesConstitucion.slice(0, 4)) : p >= mesConstitucion;
    };
    const candidatos = periodosCandidatos(ob, e.hoy).filter(exigible);
    const elegido = candidatos.find((p) => !estaCerrado(porClave.get(`${ob.clave}|${p}`) ?? null));
    if (!elegido) return sinFecha('pendiente');
    const cumplimiento = porClave.get(`${ob.clave}|${elegido}`) ?? null;
    const fecha = fechaLimiteNominal(ob, elegido);
    const estado = estadoObligacion(ob, e.candado, cumplimiento);
    const dias = fecha === null ? null : diasEntre(e.hoy, fecha);
    const dia = fecha === null ? null : diaDeLaSemana(fecha);
    return {
      ...base,
      estado,
      periodo: elegido,
      fechaLimite: fecha,
      sujetaADiaInhabil: dia === 0 || dia === 6,
      dias,
      vigencia: estado === 'presentada' || estado === 'no_aplica' ? null : clasificarVigencia(dias, ob.nombre),
      cumplimiento,
      nota: base.nota,
    };
  });
}

export interface ResumenCalendario {
  total: number;
  aunNoAplica: number;
  pendientes: number;
  paquetesListos: number;
  presentadas: number;
  vencidas: number;
  porVencer: number;
}

export function resumenCalendario(filas: readonly FilaCalendario[]): ResumenCalendario {
  const r: ResumenCalendario = { total: filas.length, aunNoAplica: 0, pendientes: 0, paquetesListos: 0, presentadas: 0, vencidas: 0, porVencer: 0 };
  for (const f of filas) {
    if (f.estado === 'aun_no_aplica') r.aunNoAplica++;
    else if (f.estado === 'pendiente') r.pendientes++;
    else if (f.estado === 'paquete_listo') r.paquetesListos++;
    else if (f.estado === 'presentada') r.presentadas++;
    if (f.vigencia?.estado === 'vencido') r.vencidas++;
    else if (f.vigencia?.estado === 'por_vencer') r.porVencer++;
  }
  return r;
}

/** Orden por urgencia: vencidas primero (más vencida arriba), luego por fecha; sin fecha al final. */
export function ordenarCalendario(filas: readonly FilaCalendario[]): FilaCalendario[] {
  return [...filas].sort((a, b) => {
    if (a.dias === null && b.dias === null) return a.nombre.localeCompare(b.nombre);
    if (a.dias === null) return 1;
    if (b.dias === null) return -1;
    return a.dias - b.dias;
  });
}
