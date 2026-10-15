// Leyenda de colores del programa de despacho (T-A4-08).
//
// El cliente colorea celdas del Excel con significados que cambian por terminal, por
// tipo de sección (exportación vs importación) y hasta por coordinador, y que su propia
// explicación contradice (ver requisitos). Por eso AQUÍ NO HAY NINGUNA LEYENDA CABLEADA:
// el mapa color -> significado es configuración de la flota. Sin mapa, la regla por
// color no decide nada y el aviso por color queda «no disponible».
//
// Módulo puro: sin red, sin base, sin dependencias.

import type { TipoSeccionPrograma } from './lector';

/** Único significado con valor propio sin configurar: lo que no está en el mapa. */
export const SIN_SIGNIFICADO = 'sin_significado' as const;

export const SIGNIFICADOS_COLOR = [
  'patio',
  'no_patio',
  'despachando',
  'documentos_listos',
  'solicitud',
  'carga_en_patio',
  SIN_SIGNIFICADO,
] as const;
export type SignificadoColor = (typeof SIGNIFICADOS_COLOR)[number];

/** `#RRGGBB` en mayúsculas. */
export type ColorHex = string;
export type MapaColores = Record<ColorHex, SignificadoColor>;

/**
 * Un mapa aplica a un contexto si cada campo que declara (distinto de null/undefined)
 * coincide. Un campo ausente significa «cualquiera».
 */
export interface MapaColoresConfigurado {
  flota?: string | null;
  terminal?: string | null;
  seccion?: TipoSeccionPrograma | null;
  colores: MapaColores;
}

export interface ConfigLeyendaColores {
  /** Distancia RGB máxima (0 = color exacto; máx. teórico 441.67) para considerar «el mismo color». */
  tolerancia: number;
  mapas: MapaColoresConfigurado[];
}

export interface ContextoLeyenda {
  flota: string;
  terminal: string;
  seccion: TipoSeccionPrograma;
}

export type ResultadoLeyenda =
  | { estado: 'sin_leyenda'; significado: null; mensaje: string }
  | { estado: 'sin_color'; significado: null; mensaje: string }
  | { estado: 'sin_coincidencia'; significado: typeof SIN_SIGNIFICADO; mensaje: string }
  | { estado: 'resuelto'; significado: SignificadoColor; colorMapa: ColorHex; distancia: number; mensaje: string };

export class ErrorLeyendaColores extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorLeyendaColores';
  }
}

/** Configuración vacía: la regla por color no decide. */
export const LEYENDA_VACIA: ConfigLeyendaColores = { tolerancia: 0, mapas: [] };

const RE_HEX = /^#?([0-9a-fA-F]{6})$/;

export function normalizarHex(valor: string): ColorHex | null {
  const m = RE_HEX.exec(valor.trim());
  return m ? `#${m[1].toUpperCase()}` : null;
}

function rgb(hex: ColorHex): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** Distancia euclidiana en RGB entre dos colores `#RRGGBB`. */
export function distanciaColor(a: ColorHex, b: ColorHex): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

/**
 * Valida y normaliza una configuración (p. ej. la que guarda la pantalla de T-A4-23).
 * Lanza ErrorLeyendaColores con un mensaje llano si algo no es válido.
 */
export function validarConfigLeyenda(entrada: ConfigLeyendaColores): ConfigLeyendaColores {
  if (!Number.isFinite(entrada.tolerancia) || entrada.tolerancia < 0 || entrada.tolerancia > 442) {
    throw new ErrorLeyendaColores('La tolerancia de color debe ser un número entre 0 y 442.');
  }
  const mapas: MapaColoresConfigurado[] = entrada.mapas.map((mapa, i) => {
    const colores: MapaColores = {};
    for (const [crudo, significado] of Object.entries(mapa.colores)) {
      const hex = normalizarHex(crudo);
      if (!hex) {
        throw new ErrorLeyendaColores(`El color «${crudo}» del mapa ${i + 1} no es un #RRGGBB válido.`);
      }
      if (!(SIGNIFICADOS_COLOR as readonly string[]).includes(significado)) {
        throw new ErrorLeyendaColores(`El significado «${String(significado)}» del color ${hex} no existe.`);
      }
      if (colores[hex] !== undefined && colores[hex] !== significado) {
        throw new ErrorLeyendaColores(`El color ${hex} aparece dos veces en el mapa ${i + 1} con significados distintos.`);
      }
      colores[hex] = significado;
    }
    return {
      flota: mapa.flota ?? null,
      terminal: mapa.terminal ?? null,
      seccion: mapa.seccion ?? null,
      colores,
    };
  });
  return { tolerancia: entrada.tolerancia, mapas };
}

function aplica(mapa: MapaColoresConfigurado, ctx: ContextoLeyenda): boolean {
  if (mapa.flota != null && mapa.flota !== ctx.flota) return false;
  if (mapa.terminal != null && mapa.terminal !== ctx.terminal) return false;
  if (mapa.seccion != null && mapa.seccion !== ctx.seccion) return false;
  return true;
}

/** Más campos declarados = más específico. Orden de desempate: flota, terminal, sección. */
function especificidad(m: MapaColoresConfigurado): number {
  return (m.flota != null ? 4 : 0) + (m.terminal != null ? 2 : 0) + (m.seccion != null ? 1 : 0);
}

/** Mapas que aplican al contexto, del más específico al más general. */
export function mapasAplicables(config: ConfigLeyendaColores, ctx: ContextoLeyenda): MapaColoresConfigurado[] {
  return config.mapas
    .filter((m) => Object.keys(m.colores).length > 0 && aplica(m, ctx))
    .sort((a, b) => especificidad(b) - especificidad(a));
}

/**
 * ¿Puede la regla por color decidir en este contexto? Si no hay ningún mapa con colores
 * que aplique, queda `no_disponible` (visible en la configuración del aviso).
 */
export function estadoReglaColor(config: ConfigLeyendaColores, ctx: ContextoLeyenda): 'disponible' | 'no_disponible' {
  return mapasAplicables(config, ctx).length > 0 ? 'disponible' : 'no_disponible';
}

/**
 * Traduce el color de una celda a su significado según la configuración de la flota.
 * Recorre los mapas del más específico al más general; en cada uno elige el color
 * configurado más cercano dentro de la tolerancia. Nunca inventa una leyenda.
 */
export function resolverColor(
  config: ConfigLeyendaColores,
  ctx: ContextoLeyenda,
  color: ColorHex | null,
): ResultadoLeyenda {
  const mapas = mapasAplicables(config, ctx);
  if (mapas.length === 0) {
    return {
      estado: 'sin_leyenda',
      significado: null,
      mensaje: 'No hay leyenda de colores configurada para esta flota, terminal y sección: el color no decide nada.',
    };
  }
  if (color === null) {
    return { estado: 'sin_color', significado: null, mensaje: 'La celda no tiene color de relleno.' };
  }
  const hex = normalizarHex(color);
  if (hex === null) {
    return { estado: 'sin_color', significado: null, mensaje: `El color «${color}» no es un #RRGGBB válido.` };
  }
  for (const mapa of mapas) {
    let mejor: { hex: ColorHex; d: number } | null = null;
    for (const candidato of Object.keys(mapa.colores).sort()) {
      const d = distanciaColor(hex, candidato);
      if (d <= config.tolerancia && (mejor === null || d < mejor.d)) mejor = { hex: candidato, d };
    }
    if (mejor) {
      return {
        estado: 'resuelto',
        significado: mapa.colores[mejor.hex],
        colorMapa: mejor.hex,
        distancia: mejor.d,
        mensaje: `El color ${hex} significa «${mapa.colores[mejor.hex]}» según la leyenda configurada.`,
      };
    }
  }
  return {
    estado: 'sin_coincidencia',
    significado: SIN_SIGNIFICADO,
    mensaje: `El color ${hex} no está en la leyenda configurada.`,
  };
}
