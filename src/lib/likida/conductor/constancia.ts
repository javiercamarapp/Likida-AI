import { celdaCsv, horaExactaMx } from './estadias_anden';
import type { FuenteHito, HitoFila, TipoHito } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-67 — CONSTANCIA DE REPORTES POR OPERADOR Y PERIODO. Solo LECTURA y CÁLCULO (no escribe, no envía nada, no interpreta).
//
// Requisito del cliente (reunión del 15-oct): cerca de la mitad de los operadores no manda las macros y pierde un incentivo; en una de sus
// plazas ya se levanta incidencia por no mandarlas, y el 7-oct el dueño dijo «en lugar de macro, por WhatsApp». Monitoreo y RH necesitan
// EVIDENCIA de qué hitos reportó cada operador en un periodo (hora, hito, origen botón/GPS) frente a los esperados. Esta pieza
// entrega esa evidencia y NADA más: ni calcula el pago ni decide quién lo pierde; esa regla es de RH.
//
// Rulings (reversibles):
//  · «Esperados» = los hitos del viaje que no están omitidos (los omitidos —fuera de perfil o inferidos por un hito posterior— no se le
//    exigen a nadie; se cuentan aparte). «Reportado» = estado recibido o validado: la bitácora no distingue quién lo registró más allá
//    del origen, y el origen va en cada fila para que RH juzgue (botón, GPS, texto, foto, oficina).
//  · Un hito sin reportar en un viaje que SIGUE ABIERTO es «pendiente», no «faltante»: todavía no es tarde. «Faltante» solo en viajes
//    cerrados. Un operador cuyos viajes no tienen ningún hito esperado queda «sin dato», nunca «completo».
//  · El periodo se toma por la fecha de creación del viaje, [desde, hasta). Los hitos de otra flota no entran.
//  · Horas en America/Mexico_City; el CSV no lleva teléfono ni coordenadas, solo operador, folio, hito, estado, hora y origen.
//  · Nace apagada (`config.constanciaReportesActiva`) hasta la decisión D-2 (macros) y la de RH.
// ═══════════════════════════════════════════════════════════════════════════

export interface ViajeConstancia {
  id: string;
  folio: string | null;
  operadorId: string;
  operadorNombre: string | null;
  estatus: string;
  /** ISO de creación del viaje: define a qué periodo pertenece. */
  creadoEn: string;
}

export interface PeriodoConstancia {
  /** ISO, inclusivo. */
  desde: string;
  /** ISO, exclusivo. */
  hasta: string;
}

export type OrigenReporte = 'botón' | 'GPS' | 'texto' | 'foto' | 'oficina' | 'sistema';
export type EstadoConstanciaOperador = 'completo' | 'con_faltantes' | 'en_curso' | 'sin_dato';

export interface ReporteConstancia {
  viajeId: string;
  folio: string | null;
  tipo: TipoHito;
  /** ISO de la hora del mensaje (o de recepción si no hay). */
  en: string | null;
  origen: OrigenReporte | null;
}

export interface SinReporteConstancia {
  viajeId: string;
  folio: string | null;
  tipo: TipoHito;
}

export interface ConstanciaOperador {
  operadorId: string;
  operadorNombre: string | null;
  viajes: number;
  esperados: number;
  reportados: number;
  /** Sin reportar en viajes ya cerrados. */
  faltantes: number;
  /** Sin reportar en viajes que siguen abiertos. */
  pendientes: number;
  /** Omitidos (fuera de perfil o inferidos): no se esperaban. */
  omitidos: number;
  estado: EstadoConstanciaOperador;
  reportes: ReporteConstancia[];
  faltantesLista: SinReporteConstancia[];
  pendientesLista: SinReporteConstancia[];
}

export interface Constancia {
  periodo: PeriodoConstancia;
  operadores: ConstanciaOperador[];
  /** `true` si no hay ningún viaje con hitos de la flota en el periodo (se dice, no se pinta un 0). */
  vacio: boolean;
}

const VIVO = new Set(['abierto', 'en_cuadre']);
const ORDEN: Record<TipoHito, number> = { llegada_carga: 0, salida_carga: 1, llegada_descarga: 2, salida_descarga: 3, regreso: 4 };

/** El origen que se muestra. La geocerca (fuente `sistema` validada por GPS) y la ubicación compartida son GPS. */
export function origenDeHito(h: Pick<HitoFila, 'fuente' | 'validadoPor'>): OrigenReporte | null {
  const f: FuenteHito | null = h.fuente;
  if (f === 'boton') return 'botón';
  if (f === 'ubicacion') return 'GPS';
  if (f === 'sistema') return h.validadoPor === 'gps' ? 'GPS' : 'sistema';
  if (f === 'texto' || f === 'foto' || f === 'oficina') return f;
  return null;
}

const reportado = (h: Pick<HitoFila, 'estado'>): boolean => h.estado === 'recibido' || h.estado === 'validado';

/** Por operador y periodo: hitos reportados (hora, hito, origen) frente a esperados. Pura. */
export function armarConstancia(x: {
  tenantId: string; periodo: PeriodoConstancia; viajes: readonly ViajeConstancia[]; hitos: readonly HitoFila[];
}): Constancia {
  const desde = Date.parse(x.periodo.desde);
  const hasta = Date.parse(x.periodo.hasta);
  const viajes = new Map<string, ViajeConstancia>();
  for (const v of x.viajes) {
    const t = Date.parse(v.creadoEn);
    if (Number.isFinite(t) && t >= desde && t < hasta) viajes.set(v.id, v);
  }
  const hitosPorViaje = new Map<string, HitoFila[]>();
  for (const h of x.hitos) {
    if (h.tenantId !== x.tenantId || !viajes.has(h.viajeId)) continue;
    hitosPorViaje.set(h.viajeId, [...(hitosPorViaje.get(h.viajeId) ?? []), h]);
  }
  const porOperador = new Map<string, ConstanciaOperador>();
  for (const [viajeId, hs] of hitosPorViaje) {
    const v = viajes.get(viajeId)!;
    const o = porOperador.get(v.operadorId) ?? {
      operadorId: v.operadorId, operadorNombre: v.operadorNombre, viajes: 0, esperados: 0, reportados: 0, faltantes: 0, pendientes: 0,
      omitidos: 0, estado: 'sin_dato' as EstadoConstanciaOperador, reportes: [], faltantesLista: [], pendientesLista: [],
    };
    o.viajes += 1;
    for (const h of [...hs].sort((a, b) => ORDEN[a.tipo] - ORDEN[b.tipo])) {
      if (h.estado === 'omitido') { o.omitidos += 1; continue; }
      o.esperados += 1;
      if (reportado(h)) {
        o.reportados += 1;
        o.reportes.push({ viajeId, folio: v.folio, tipo: h.tipo, en: h.mensajeEn ?? h.recibidoEn, origen: origenDeHito(h) });
      } else if (VIVO.has(v.estatus)) {
        o.pendientes += 1;
        o.pendientesLista.push({ viajeId, folio: v.folio, tipo: h.tipo });
      } else {
        o.faltantes += 1;
        o.faltantesLista.push({ viajeId, folio: v.folio, tipo: h.tipo });
      }
    }
    porOperador.set(v.operadorId, o);
  }
  const operadores = [...porOperador.values()].map((o) => ({
    ...o,
    estado: (o.esperados === 0 ? 'sin_dato' : o.faltantes > 0 ? 'con_faltantes' : o.pendientes > 0 ? 'en_curso' : 'completo') as EstadoConstanciaOperador,
  })).sort((a, b) => (a.operadorNombre ?? '').localeCompare(b.operadorNombre ?? '', 'es-MX') || a.operadorId.localeCompare(b.operadorId));
  return { periodo: x.periodo, operadores, vacio: operadores.length === 0 };
}

// ── El CSV para monitoreo y RH ───────────────────────────────────────────────

export const COLUMNAS_CSV_CONSTANCIA = ['operador', 'folio', 'hito', 'estado', 'fecha_hora_mx', 'origen'] as const;

const TEXTO_HITO: Record<TipoHito, string> = {
  llegada_carga: 'llegada a carga', salida_carga: 'salida de carga', llegada_descarga: 'llegada a descarga', salida_descarga: 'salida de descarga', regreso: 'regreso',
};

/** Una fila por hito esperado (reportado, faltante o pendiente); UTF-8 con BOM para Excel. Sin teléfono ni coordenadas. */
export function csvConstancia(c: Constancia): string {
  const lineas: string[] = [COLUMNAS_CSV_CONSTANCIA.join(',')];
  for (const o of c.operadores) {
    const filas: Array<{ folio: string | null; tipo: TipoHito; estado: string; en: string | null; origen: string | null }> = [
      ...o.reportes.map((r) => ({ folio: r.folio, tipo: r.tipo, estado: 'reportado', en: r.en, origen: r.origen })),
      ...o.faltantesLista.map((f) => ({ folio: f.folio, tipo: f.tipo, estado: 'faltante', en: null, origen: null })),
      ...o.pendientesLista.map((f) => ({ folio: f.folio, tipo: f.tipo, estado: 'pendiente', en: null, origen: null })),
    ].sort((a, b) => (a.folio ?? '').localeCompare(b.folio ?? '', 'es-MX') || ORDEN[a.tipo] - ORDEN[b.tipo]);
    for (const f of filas) {
      const valores: Array<string | number | null> = [o.operadorNombre, f.folio, TEXTO_HITO[f.tipo], f.estado, horaExactaMx(f.en), f.origen];
      lineas.push(valores.map(celdaCsv).join(','));
    }
  }
  return `﻿${lineas.join('\n')}\n`;
}
