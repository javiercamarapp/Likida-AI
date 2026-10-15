// Evaluador «listo para avisar» (T-A4-13).
//
// Función pura: decide si una fila del programa de despacho ya está lista para
// avisar al cliente los datos del viaje. No lee base ni red.
//
// Regla PROVISIONAL (proxy) hasta tener el archivo con colores: la columna
// «validado» no existe en el CSV, así que se usa CAJA + UNIDAD + CCP en un
// conjunto configurable (por defecto LISTO / DESPACHADO).
//  - Falla cerrado: ante duda (sección no elegible, dato faltante, conflicto
//    entre color y proxy) NO se avisa.
//  - Sin leyenda (o color sin mapear) nunca se decide por color.
//  - Si el color contradice al proxy se devuelve `conflicto` y no se avisa.
//  - Una fila de CANCELACIONES nunca es «lista», aunque la flota la habilite.

import type { Ccp, FilaPrograma, Transito } from '../programa/normalizar';

export type TipoSeccionAviso = FilaPrograma['tipo'];
export type FaltanteListo = 'caja' | 'unidad' | 'ccp';

/** Rótulo obligatorio de la regla provisional (UI y aviso interno). */
export const ROTULO_PROXY = 'proxy: regla provisional hasta tener el archivo con colores';

export interface ConfigListo {
  /** CCP que cuentan como «listo». Editable por flota. */
  ccpListos: Ccp[];
  /** Si es true, un TRANSITO bloqueante (p. ej. pend_cruce) impide el aviso. */
  exigirTransito: boolean;
  /** Valores de TRANSITO que bloquean cuando `exigirTransito` es true. */
  transitosBloqueantes: Transito[];
  /** Secciones elegibles. CANCELACIONES se ignora aunque se incluya. */
  secciones: TipoSeccionAviso[];
}

export const CONFIG_LISTO_POR_DEFECTO: Readonly<ConfigListo> = Object.freeze({
  ccpListos: ['listo', 'despachado'] as Ccp[],
  exigirTransito: false,
  transitosBloqueantes: ['pend_cruce'] as Transito[],
  secciones: ['IMPORTACION', 'EXPORTACION'] as TipoSeccionAviso[],
});

/** Significado que la flota da a un color. «ignorar» = el color no decide nada. */
export type SignificadoColor = 'patio' | 'confirmable' | 'pendiente' | 'ignorar';

/** Mapa color→significado configurable por flota (nunca se codifica en el código). */
export type LeyendaColores = Readonly<Record<string, SignificadoColor>>;

export type FilaParaListo =
  Pick<FilaPrograma, 'tipo' | 'caja' | 'unidad' | 'ccp' | 'transito'> & {
    /** Color de la celda (clave de la leyenda), si el archivo lo trajo. */
    color?: string | null;
  };

export interface ResultadoListo {
  listo: boolean;
  motivo: string;
  faltantes: FaltanteListo[];
  via: 'proxy' | 'color';
  /** true si el color contradice al proxy; en ese caso `listo` es false. */
  conflicto?: boolean;
}

function llena(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim() !== '';
}

function unir(config?: Partial<ConfigListo>): ConfigListo {
  return {
    ccpListos: config?.ccpListos ?? [...CONFIG_LISTO_POR_DEFECTO.ccpListos],
    exigirTransito: config?.exigirTransito ?? CONFIG_LISTO_POR_DEFECTO.exigirTransito,
    transitosBloqueantes: config?.transitosBloqueantes ?? [...CONFIG_LISTO_POR_DEFECTO.transitosBloqueantes],
    secciones: config?.secciones ?? [...CONFIG_LISTO_POR_DEFECTO.secciones],
  };
}

function significadoDeColor(fila: FilaParaListo, leyenda?: LeyendaColores): SignificadoColor | null {
  if (!leyenda || !llena(fila.color)) return null;
  const clave = (fila.color as string).trim();
  if (!Object.prototype.hasOwnProperty.call(leyenda, clave)) return null;
  const s = leyenda[clave];
  return s === 'ignorar' ? null : s;
}

export function evaluarListo(
  fila: FilaParaListo,
  config?: Partial<ConfigListo>,
  leyenda?: LeyendaColores,
): ResultadoListo {
  const cfg = unir(config);

  if (fila.tipo === 'CANCELACIONES') {
    return { listo: false, motivo: 'fila de CANCELACIONES: nunca se avisa', faltantes: [], via: 'proxy' };
  }
  if (!cfg.secciones.includes(fila.tipo)) {
    return { listo: false, motivo: `sección ${fila.tipo} no habilitada para avisos`, faltantes: [], via: 'proxy' };
  }

  const faltantes: FaltanteListo[] = [];
  if (!llena(fila.caja)) faltantes.push('caja');
  if (!llena(fila.unidad)) faltantes.push('unidad');
  if (!cfg.ccpListos.includes(fila.ccp)) faltantes.push('ccp');

  let bloqueoTransito = false;
  if (cfg.exigirTransito && cfg.transitosBloqueantes.includes(fila.transito)) bloqueoTransito = true;

  const proxyListo = faltantes.length === 0 && !bloqueoTransito;
  const motivoProxy = proxyListo
    ? `listo (${ROTULO_PROXY})`
    : faltantes.length > 0
      ? `faltan: ${faltantes.join(', ')} (${ROTULO_PROXY})`
      : `tránsito ${fila.transito} bloquea el aviso (${ROTULO_PROXY})`;

  const significado = significadoDeColor(fila, leyenda);
  if (significado === null) {
    return { listo: proxyListo, motivo: motivoProxy, faltantes, via: 'proxy' };
  }

  const colorListo = significado === 'patio' || significado === 'confirmable';
  if (colorListo !== proxyListo) {
    return {
      listo: false,
      motivo: `conflicto: el color (${significado}) contradice la regla proxy; no se avisa`,
      faltantes,
      via: 'color',
      conflicto: true,
    };
  }
  return {
    listo: colorListo,
    motivo: colorListo ? `listo por color (${significado}), de acuerdo con el proxy` : motivoProxy,
    faltantes,
    via: 'color',
  };
}
