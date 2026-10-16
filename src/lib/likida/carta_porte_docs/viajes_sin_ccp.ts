// ═══════════════════════════════════════════════════════════════════════════
// VIAJES SALIDOS SIN CARTA PORTE (T-A3-66) — listado por cliente, con antigüedad.
//
// Requisito (d445f2d3 15:18–16:32 y 42:21; 76e49e6f 52:11, 53:54): buena parte de lo que sale
// de la terminal sale sin complemento («somos permisivos, no debemos») y cada fin de semana se
// arma a mano la lista de operadores sin ingreso. Esto la arma sola: viajes con SALIDA registrada
// y sin complemento aprobado ligado, agrupados por cliente, con horas/días desde la salida y un
// color por umbral (multa en riesgo).
//
// SOLO LECTURA y puro: no envía mensajes, no cierra viajes, no toca el TMS. Los viajes locales
// «abiertos» (T-A5-57) se marcan con `localAbierto` para rotularlos, pero cuentan igual: un viaje
// local abierto sin complemento sigue siendo un viaje salido sin complemento.
// Sin datos reales: opera sobre lo que le pasa quien lo invoca.
// ═══════════════════════════════════════════════════════════════════════════

import { celdaCsv } from './exportacion';
import { TZ_MX, fechaHoraEnZona } from '@/lib/formato';

export type ColorAntiguedad = 'verde' | 'ambar' | 'rojo';

export interface ViajeSalido {
  viajeId: string;
  folio: string | null;
  clienteId: string | null;
  clienteNombre: string | null;
  /** Hora de la salida registrada (ISO). Sin ella el viaje no «salió»: no entra al listado. */
  salidaEn: string | null;
  localAbierto?: boolean;
}

export interface UmbralesAntiguedad {
  /** Desde cuántas horas sin complemento el renglón se pinta ámbar. */
  ambarHoras: number;
  /** Desde cuántas horas se pinta rojo. */
  rojoHoras: number;
}

/** Ruling: 24 h ámbar / 72 h rojo por omisión (ajustables por quien invoca; reversible, la ficha pide «configurable»). */
export const UMBRALES_POR_OMISION: UmbralesAntiguedad = { ambarHoras: 24, rojoHoras: 72 };

export interface RenglonSinCcp {
  viajeId: string;
  folio: string | null;
  salidaEn: string;
  horas: number;
  dias: number;
  color: ColorAntiguedad;
  localAbierto: boolean;
}

export interface GrupoCliente {
  clienteId: string | null;
  clienteNombre: string;
  viajes: RenglonSinCcp[];
  masAntiguoHoras: number;
  colorMax: ColorAntiguedad;
}

export interface ListadoSinCcp {
  /** `true` = no hay ningún viaje salido sin complemento (estado vacío honesto). */
  vacio: boolean;
  total: number;
  grupos: GrupoCliente[];
}

const ORDEN_COLOR: Record<ColorAntiguedad, number> = { verde: 0, ambar: 1, rojo: 2 };
export const SIN_CLIENTE = 'Sin cliente asignado';

export function colorPorHoras(horas: number, u: UmbralesAntiguedad = UMBRALES_POR_OMISION): ColorAntiguedad {
  if (horas >= u.rojoHoras) return 'rojo';
  if (horas >= u.ambarHoras) return 'ambar';
  return 'verde';
}

/**
 * Arma el listado. `viajesConCcp` = ids de viajes con complemento aprobado ligado; esos desaparecen.
 * Un viaje sin salida registrada, o con una fecha ilegible o en el futuro, no entra (no se inventa antigüedad).
 */
export function listarViajesSinCcp(
  viajes: readonly ViajeSalido[], viajesConCcp: ReadonlySet<string>, ahora: Date, umbrales: UmbralesAntiguedad = UMBRALES_POR_OMISION,
): ListadoSinCcp {
  const grupos = new Map<string, GrupoCliente>();
  const vistos = new Set<string>();
  let total = 0;
  for (const v of viajes) {
    if (viajesConCcp.has(v.viajeId) || vistos.has(v.viajeId) || !v.salidaEn) continue;
    const t = Date.parse(v.salidaEn);
    if (!Number.isFinite(t) || t > ahora.getTime()) continue;
    vistos.add(v.viajeId);
    const horas = Math.floor((ahora.getTime() - t) / 3_600_000);
    const color = colorPorHoras(horas, umbrales);
    const llave = v.clienteId ?? 'sin_cliente';
    const g = grupos.get(llave) ?? { clienteId: v.clienteId, clienteNombre: (v.clienteNombre ?? '').trim() || SIN_CLIENTE, viajes: [], masAntiguoHoras: 0, colorMax: 'verde' as ColorAntiguedad };
    g.viajes.push({ viajeId: v.viajeId, folio: v.folio, salidaEn: v.salidaEn, horas, dias: Math.floor(horas / 24), color, localAbierto: v.localAbierto === true });
    g.masAntiguoHoras = Math.max(g.masAntiguoHoras, horas);
    if (ORDEN_COLOR[color] > ORDEN_COLOR[g.colorMax]) g.colorMax = color;
    grupos.set(llave, g);
    total += 1;
  }
  const lista = [...grupos.values()];
  for (const g of lista) g.viajes.sort((a, b) => b.horas - a.horas || a.viajeId.localeCompare(b.viajeId));
  // Primero el cliente con el viaje más viejo (mayor riesgo de multa); a igualdad, por nombre.
  lista.sort((a, b) => b.masAntiguoHoras - a.masAntiguoHoras || a.clienteNombre.localeCompare(b.clienteNombre));
  return { vacio: total === 0, total, grupos: lista };
}

export const ENCABEZADOS_CSV_SIN_CCP = ['Cliente', 'Folio', 'Salida', 'Horas sin Carta Porte', 'Días sin Carta Porte', 'Riesgo', 'Viaje local abierto'] as const;
const RIESGO: Record<ColorAntiguedad, string> = { verde: 'Reciente', ambar: 'Atención', rojo: 'Riesgo de multa' };
/** La salida en hora de la flota (TZ_MX), `AAAA-MM-DD HH:mm`. */
export function salidaEnZona(iso: string): string {
  return fechaHoraEnZona(new Date(iso), TZ_MX);
}

/** Reporte semanal exportable: una línea por viaje, con BOM para Excel y celdas sin fórmulas. */
export function aCsvSinCcp(l: ListadoSinCcp): string {
  const d = ',';
  const lineas = [ENCABEZADOS_CSV_SIN_CCP.map((e) => celdaCsv(e, d)).join(d)];
  for (const g of l.grupos) {
    for (const v of g.viajes) {
      lineas.push([g.clienteNombre, v.folio, salidaEnZona(v.salidaEn), v.horas, v.dias, RIESGO[v.color], v.localAbierto ? 'Sí' : 'No'].map((c) => celdaCsv(c, d)).join(d));
    }
  }
  return `﻿${lineas.join('\r\n')}\r\n`;
}
