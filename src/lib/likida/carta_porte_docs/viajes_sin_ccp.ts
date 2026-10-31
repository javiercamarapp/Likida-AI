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
  /** A37-S32-06: la lectura llegó a su tope y faltan salidas (las más viejas): la lista NO está completa. */
  truncado?: boolean;
  /**
   * A3-01 (cierre100): la lectura de viajes del TMS no permite decir «cero pendientes». `sin_viajes` = no hay ningún viaje importado
   * en la ventana (no se puede decir nada); `importacion_vieja` = hay viajes pero la última importación es antigua (la lista puede
   * estar atrasada). Ausente = hay datos recientes (o la flota no usa el TMS).
   */
  sinDatosTms?: SinDatosTms;
  /** A3-02 (cierre100): cuántos de los viajes leídos se ligaron a un documento/carga por folio (solo flotas con viajes del TMS). */
  ligadosPorFolio?: { ligados: number; total: number };
}

export type MotivoSinDatosTms = 'sin_viajes' | 'importacion_vieja';
export interface SinDatosTms {
  motivo: MotivoSinDatosTms;
  /** ISO del último viaje importado, o `null` si nunca se importó uno. */
  ultimoImportadoEn: string | null;
  /** Horas desde esa importación; `null` si no hay. */
  horasDesdeImportacion: number | null;
}

/** Más de estas horas sin importar un viaje nuevo del TMS = la lista puede estar atrasada. */
export const HORAS_IMPORTACION_VIEJA = 72;

/**
 * A3-01 (cierre100): decide si hay datos del TMS para afirmar algo. `null` = sí hay. Un `viajesLeidos` de 0 NUNCA se lee como
 * «todo tiene Carta Porte» (null no es 0): es «sin datos del TMS».
 */
export function evaluarDatosTms(
  c: { viajesLeidos: number; ultimoImportadoEn: string | null }, ahora: Date,
): SinDatosTms | null {
  const t = c.ultimoImportadoEn ? Date.parse(c.ultimoImportadoEn) : NaN;
  const horas = Number.isFinite(t) ? Math.max(0, Math.floor((ahora.getTime() - t) / 3_600_000)) : null;
  const ultimo = Number.isFinite(t) ? c.ultimoImportadoEn : null;
  if (c.viajesLeidos <= 0) return { motivo: 'sin_viajes', ultimoImportadoEn: ultimo, horasDesdeImportacion: horas };
  if (horas !== null && horas > HORAS_IMPORTACION_VIEJA) return { motivo: 'importacion_vieja', ultimoImportadoEn: ultimo, horasDesdeImportacion: horas };
  return null;
}

/** El folio tal como se compara entre el viaje y el documento/envío: SIN ningún espacio y sin distinguir mayúsculas («abc 123» = «ABC123»). */
export const folioComparable = (f: string | null | undefined): string => String(f ?? '').replace(/\s+/g, '').toUpperCase();

/** Un folio de documento aprobado o de carga subida al TMS, con el cliente del documento (`null` = el documento no tiene cliente). */
export interface FolioVisto { clienteId: string | null; folio: string | null }

/**
 * OLA1-A3 + A3-02 (cierre100) · Viajes cuyo folio coincide con el de un complemento ya aprobado o con la referencia de una carga ya
 * subida al TMS. Es el vínculo de las flotas bajo el perfil `cinco_agentes`: ahí el documento nunca crea ni liga un viaje
 * (`cp_documento.viaje_id` queda vacío), así que la única llave común es el folio.
 *
 * La llave es (cliente, folio): el folio del cliente A («1234») no liga el viaje del cliente B. Un documento SIN cliente no liga el
 * viaje de ningún cliente (no se completa el de otro); un viaje sin cliente liga solo si el folio es de un único cliente (si dos
 * clientes lo usan, es ambiguo). Un folio vacío no liga nada.
 */
export function viajesLigadosPorFolio(
  viajes: ReadonlyArray<Pick<ViajeSalido, 'viajeId' | 'folio' | 'clienteId'>>, vistos: ReadonlyArray<FolioVisto>,
): Set<string> {
  const porClienteFolio = new Set<string>();
  const clientesPorFolio = new Map<string, Set<string>>();
  for (const x of vistos) {
    const f = folioComparable(x.folio);
    if (f === '') continue;
    const c = x.clienteId ?? '';
    porClienteFolio.add(`${c}|${f}`);
    const set = clientesPorFolio.get(f) ?? new Set<string>();
    set.add(c);
    clientesPorFolio.set(f, set);
  }
  const ligados = new Set<string>();
  for (const v of viajes) {
    const f = folioComparable(v.folio);
    if (f === '') continue;
    if (v.clienteId) {
      if (porClienteFolio.has(`${v.clienteId}|${f}`)) ligados.add(v.viajeId);
    } else {
      const clientes = clientesPorFolio.get(f);
      if (clientes && clientes.size === 1) ligados.add(v.viajeId);
    }
  }
  return ligados;
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
  extra: { sinDatosTms?: SinDatosTms | null; ligadosPorFolio?: { ligados: number; total: number } } = {},
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
  return {
    vacio: total === 0, total, grupos: lista,
    ...(extra.sinDatosTms ? { sinDatosTms: extra.sinDatosTms } : {}),
    ...(extra.ligadosPorFolio ? { ligadosPorFolio: extra.ligadosPorFolio } : {}),
  };
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
  // A3-01: sin viajes del TMS el reporte NO es una lista vacía (se leería como «cero pendientes»): lo dice.
  if (l.sinDatosTms?.motivo === 'sin_viajes') {
    lineas.push(celdaCsv('Sin datos del TMS: no se puede decir si hay viajes sin Carta Porte', d));
    return `\ufeff${lineas.join('\r\n')}\r\n`;
  }
  for (const g of l.grupos) {
    for (const v of g.viajes) {
      lineas.push([g.clienteNombre, v.folio, salidaEnZona(v.salidaEn), v.horas, v.dias, RIESGO[v.color], v.localAbierto ? 'Sí' : 'No'].map((c) => celdaCsv(c, d)).join(d));
    }
  }
  return `﻿${lineas.join('\r\n')}\r\n`;
}
