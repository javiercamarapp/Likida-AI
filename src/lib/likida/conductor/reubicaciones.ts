import { celdaCsv, horaExactaMx } from './estadias_anden';
import type { Reubicacion } from './maquina';
import type { EventoReporteFila } from './repo';
import type { ViajeTablero } from './repo_validacion';
import { estadoReporteDeEventos } from './reporte_llegada';
import type { HitoFila } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-63 — REGISTRO DE REUBICACIONES DEL CLIENTE Y REPORTE POR CLIENTE. Solo LECTURA y CÁLCULO (no escribe, no envía nada).
//
// Requisito del cliente (audio de la reunión del 15-oct, ~66:15 «ese es el oro»): cuando el cliente final reubica al chofer varias
// veces (otra rampa, otro edificio: «te mandan al 2, te mandan al 24 y era en el 1») y luego cancela por «no se presentó», la flota
// necesita EVIDENCIA de quién causó la demora. La materia prima es la lista de reubicaciones que T-A5-43 ya guarda en la bitácora
// (`reporte_llegada.ts`); aquí solo se cuenta y se agrupa.
//
// Rulings (reversibles):
//  · «Reubicaciones» = cambios DESPUÉS del primer registro de la llegada (el primero es dónde lo mandaron, no un cambio). Un repetido igual
//    no cuenta (ya lo filtra `agregarReubicacion`).
//  · «Minutos» = del primer al último registro de cada llegada: cota INFERIOR defendible (lo que se puede probar con horas registradas);
//    no se inventa el tiempo hasta que el chofer descargó. Se suman las llegadas del viaje; no se mezclan entre llegadas.
//  · «Sin dato» ≠ cero: una llegada sin ninguna respuesta del chofer no es «cero reubicaciones»; es que no se sabe.
//  · El export NO lleva nombre de chofer ni de contacto (la bitácora tampoco los guarda); sí folio, cliente, horas del Centro de México
//    (America/Mexico_City), rampa y el texto libre «¿cómo descargas?» con las fórmulas de hoja de cálculo neutralizadas.
//  · Alcance de tenant: solo cuentan los hitos de la flota pedida; un viaje sin ninguna llegada de esa flota no produce fila.
// ═══════════════════════════════════════════════════════════════════════════

export type EstadoReubicacionViaje = 'sin_dato' | 'sin_reubicacion' | 'reubicado';

export interface RegistroReubicacionVista {
  tipoHito: HitoFila['tipo'];
  /** ISO. */
  en: string;
  rampaEstado: Reubicacion['rampaEstado'];
  rampa: string | null;
  comoDescarga: string | null;
}

export interface ReubicacionesViaje {
  viajeId: string;
  folio: string | null;
  clienteId: string | null;
  clienteNombre: string | null;
  estado: EstadoReubicacionViaje;
  /** Cambios después del primer registro, sumados entre llegadas. `null` = sin dato. */
  reubicaciones: number | null;
  /** Minutos del primer al último registro de cada llegada, sumados. `null` = sin dato. */
  minutos: number | null;
  registros: RegistroReubicacionVista[];
}

const MS_MIN = 60_000;
const esLlegada = (h: HitoFila): boolean => h.tipo === 'llegada_carga' || h.tipo === 'llegada_descarga';

/** La lista de reubicaciones, los cambios y los minutos de CADA viaje que tiene alguna llegada de esa flota. Pura. */
export function reubicacionesPorViaje(
  tenantId: string, viajes: readonly ViajeTablero[], hitos: readonly HitoFila[], eventos: readonly EventoReporteFila[],
): ReubicacionesViaje[] {
  const hitosPorViaje = new Map<string, HitoFila[]>();
  for (const h of hitos) {
    if (h.tenantId !== tenantId || !esLlegada(h)) continue;
    hitosPorViaje.set(h.viajeId, [...(hitosPorViaje.get(h.viajeId) ?? []), h]);
  }
  const filas: ReubicacionesViaje[] = [];
  for (const v of viajes) {
    const propios = hitosPorViaje.get(v.id);
    if (!propios || propios.length === 0) continue;
    let conDato = false;
    let cambios = 0;
    let minutos = 0;
    const registros: RegistroReubicacionVista[] = [];
    for (const h of propios) {
      const lista = estadoReporteDeEventos(eventos, h.id, h.ciclo).reubicaciones;
      if (lista.length === 0) continue;
      conDato = true;
      cambios += Math.max(0, lista.length - 1);
      const t = lista.map((r) => Date.parse(r.en)).filter((x) => Number.isFinite(x));
      if (t.length > 1) minutos += Math.round((Math.max(...t) - Math.min(...t)) / MS_MIN);
      for (const r of lista) registros.push({ tipoHito: h.tipo, en: r.en, rampaEstado: r.rampaEstado, rampa: r.rampa, comoDescarga: r.comoDescarga });
    }
    filas.push({
      viajeId: v.id, folio: v.folio, clienteId: v.clienteId, clienteNombre: v.clienteNombre,
      estado: !conDato ? 'sin_dato' : cambios > 0 ? 'reubicado' : 'sin_reubicacion',
      reubicaciones: conDato ? cambios : null, minutos: conDato ? minutos : null, registros,
    });
  }
  return filas;
}

export interface ReubicacionesCliente {
  clienteId: string | null;
  clienteNombre: string;
  viajes: number;
  viajesConDato: number;
  /** Viajes con al menos una reubicación. `null` = ningún viaje del cliente tiene dato. */
  viajesReubicados: number | null;
  reubicaciones: number | null;
  minutos: number | null;
}

/** Agrupa por cliente. Orden: más minutos primero, luego más reubicaciones, luego nombre; los «sin dato» al final. Es lo que lee el KPI «reubicaciones por cliente» (T-A5-61). Pura. */
export function reubicacionesPorCliente(
  tenantId: string, viajes: readonly ViajeTablero[], hitos: readonly HitoFila[], eventos: readonly EventoReporteFila[],
  nombresCliente: ReadonlyMap<string, string>,
): ReubicacionesCliente[] {
  const grupos = new Map<string, ReubicacionesCliente>();
  for (const f of reubicacionesPorViaje(tenantId, viajes, hitos, eventos)) {
    const llave = f.clienteId ?? '';
    const g = grupos.get(llave) ?? {
      clienteId: f.clienteId,
      clienteNombre: f.clienteId === null ? 'Sin cliente' : nombresCliente.get(f.clienteId) ?? f.clienteNombre ?? 'Cliente sin nombre',
      viajes: 0, viajesConDato: 0, viajesReubicados: null, reubicaciones: null, minutos: null,
    };
    g.viajes += 1;
    if (f.estado !== 'sin_dato') {
      g.viajesConDato += 1;
      g.viajesReubicados = (g.viajesReubicados ?? 0) + (f.estado === 'reubicado' ? 1 : 0);
      g.reubicaciones = (g.reubicaciones ?? 0) + (f.reubicaciones ?? 0);
      g.minutos = (g.minutos ?? 0) + (f.minutos ?? 0);
    }
    grupos.set(llave, g);
  }
  return [...grupos.values()].sort((a, b) =>
    (b.minutos ?? -1) - (a.minutos ?? -1) || (b.reubicaciones ?? -1) - (a.reubicaciones ?? -1) || a.clienteNombre.localeCompare(b.clienteNombre, 'es-MX'));
}

// ── El CSV para disputar «no se presentó» ────────────────────────────────────

export const COLUMNAS_CSV_REUBICACIONES = [
  'folio', 'cliente', 'llegada', 'registro', 'fecha_hora_mx', 'rampa_estado', 'rampa', 'como_descarga', 'reubicaciones_viaje', 'minutos_viaje',
] as const;

const TEXTO_LLEGADA: Record<string, string> = { llegada_carga: 'carga', llegada_descarga: 'descarga' };
const TEXTO_RAMPA: Record<string, string> = { si: 'sí', no: 'no', no_aplica: 'no aplica', en_espera: 'en espera' };

/** Una fila por registro de los viajes con dato; UTF-8 con BOM para que Excel lea los acentos. Sin nombres de personas. */
export function csvReubicaciones(viajes: readonly ReubicacionesViaje[]): string {
  const lineas: string[] = [COLUMNAS_CSV_REUBICACIONES.join(',')];
  for (const v of viajes) {
    if (v.estado === 'sin_dato') continue;
    v.registros.forEach((r, i) => {
      const valores: Array<string | number | null> = [
        v.folio, v.clienteNombre ?? (v.clienteId === null ? 'Sin cliente' : null), TEXTO_LLEGADA[r.tipoHito] ?? r.tipoHito, i + 1, horaExactaMx(r.en),
        r.rampaEstado ? TEXTO_RAMPA[r.rampaEstado] ?? r.rampaEstado : null, r.rampa, r.comoDescarga, v.reubicaciones, v.minutos,
      ];
      lineas.push(valores.map(celdaCsv).join(','));
    });
  }
  return `﻿${lineas.join('\n')}\n`;
}
