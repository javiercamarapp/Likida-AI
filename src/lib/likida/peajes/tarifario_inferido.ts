import { normalizarNombre } from './formatos';

// ═══════════════════════════════════════════════════════════════════════════
// TARIFA DE REFERENCIA INFERIDA DESDE LOS ARCHIVOS (T-A2-07).
//
// El cliente no tiene catálogo de casetas con costo: la tarifa se saca de los
// propios desgloses del proveedor. Este módulo es PURO: a partir de las líneas
// de cruce propone, por (caseta física, clase), la tarifa más frecuente (moda).
//
// Reglas de honestidad:
//   · TODA tarifa devuelta es origen='inferida' y confirmada=false. Este módulo
//     nunca decide que una tarifa es la correcta: la confirma una persona.
//   · Con pocos datos (< minCruces) o sin una moda clara NO se inventa tarifa:
//     se reporta «datos insuficientes» / «sin tarifa estable» con mediana y rango.
//   · La clase 1 en una caseta que cobra por pasada no es anomalía: se sugiere
//     `por_pasada` en lugar de marcar nada como atípico.
//   · Determinista: el orden de las líneas de entrada no cambia el resultado.
// ═══════════════════════════════════════════════════════════════════════════

export interface LineaTarifaInferible {
  /** Nombre de la caseta tal como viene en el archivo. */
  caseta: string | null;
  /** Llave de la caseta FÍSICA si la hay (varias plazas/sentidos de una misma caseta). Si no, se usa `caseta`. */
  casetaFisica?: string | null;
  clase?: number | null;
  monto: number;
}

export interface OpcionesInferencia {
  /** Cruces mínimos por (caseta, clase) para proponer tarifa. Default 20. */
  minCruces?: number;
  /** Fracción máxima de cruces fuera de la moda antes de marcar la caseta como de cobro variable. Default 0.1. */
  dispersionMax?: number;
  /** Fracción mínima de cruces que debe tener el importe modal para ser «estable». Default 0.7. */
  modaMinima?: number;
}

export interface TarifaInferida {
  casetaNorm: string;
  clase: number;
  importe: number;
  cruces: number;
  /** Cruces cuyo importe NO es la moda (posibles cobros indebidos o tarifa variable). */
  anomalos: number;
  /** anomalos / cruces. */
  dispersion: number;
  origen: 'inferida';
  confirmada: false;
}

export interface SinTarifaEstable {
  casetaNorm: string;
  clase: number;
  cruces: number;
  mediana: number;
  minimo: number;
  maximo: number;
  /** Fracción de cruces que tiene el importe más frecuente. */
  fraccionModal: number;
}

export interface DatosInsuficientes {
  casetaNorm: string;
  clase: number;
  cruces: number;
}

export interface CasetaInestable {
  casetaNorm: string;
  clase: number;
  cruces: number;
  importeModal: number;
  anomalos: number;
  dispersion: number;
}

export interface SugerenciaPorPasada {
  casetaNorm: string;
  cruces: number;
  motivo: 'una_sola_clase' | 'importes_similares_entre_clases';
  /** Clase dominante (solo en `una_sola_clase`). */
  clase: number | null;
}

export interface ResultadoInferencia {
  tarifas: TarifaInferida[];
  sinTarifaEstable: SinTarifaEstable[];
  datosInsuficientes: DatosInsuficientes[];
  /** Tarifa estable pero con más cruces fuera de la moda que `dispersionMax`: posible cobro variable. */
  casetasInestables: CasetaInestable[];
  porPasada: SugerenciaPorPasada[];
  /** Líneas ignoradas por no tener caseta, clase o un monto positivo. */
  ignoradas: number;
}

const centavos = (n: number): number => Math.round(n * 100) / 100;

function mediana(ordenados: readonly number[]): number {
  const m = ordenados.length >> 1;
  return ordenados.length % 2 ? ordenados[m] : centavos((ordenados[m - 1] + ordenados[m]) / 2);
}

/** Moda de importes a centavos; empate → la que tiene más cruces y, si persiste, el importe menor. */
function moda(importes: readonly number[]): { importe: number; n: number } {
  const cuenta = new Map<number, number>();
  for (const v of importes) cuenta.set(v, (cuenta.get(v) ?? 0) + 1);
  let mejor: { importe: number; n: number } | null = null;
  for (const [importe, n] of cuenta) {
    if (!mejor || n > mejor.n || (n === mejor.n && importe < mejor.importe)) mejor = { importe, n };
  }
  return mejor as { importe: number; n: number };
}

export function inferirTarifas(lineas: readonly LineaTarifaInferible[], opciones: OpcionesInferencia = {}): ResultadoInferencia {
  const minCruces = opciones.minCruces ?? 20;
  const dispersionMax = opciones.dispersionMax ?? 0.1;
  const modaMinima = opciones.modaMinima ?? 0.7;

  // caseta → clase → importes
  const grupos = new Map<string, Map<number, number[]>>();
  let ignoradas = 0;
  for (const l of lineas) {
    const llave = normalizarNombre(l.casetaFisica || l.caseta || '');
    const clase = l.clase;
    if (!llave || clase === undefined || clase === null || !Number.isFinite(clase) || !Number.isFinite(l.monto) || l.monto <= 0) {
      ignoradas++;
      continue;
    }
    const porClase = grupos.get(llave) ?? new Map<number, number[]>();
    const lista = porClase.get(clase) ?? [];
    lista.push(centavos(l.monto));
    porClase.set(clase, lista);
    grupos.set(llave, porClase);
  }

  const res: ResultadoInferencia = { tarifas: [], sinTarifaEstable: [], datosInsuficientes: [], casetasInestables: [], porPasada: [], ignoradas };

  for (const casetaNorm of [...grupos.keys()].sort()) {
    const porClase = grupos.get(casetaNorm)!;
    const clases = [...porClase.keys()].sort((a, b) => a - b);
    const totalCaseta = clases.reduce((s, c) => s + porClase.get(c)!.length, 0);
    const modales: number[] = [];

    for (const clase of clases) {
      const importes = [...porClase.get(clase)!].sort((a, b) => a - b);
      const cruces = importes.length;
      if (cruces < minCruces) {
        res.datosInsuficientes.push({ casetaNorm, clase, cruces });
        continue;
      }
      const m = moda(importes);
      const fraccionModal = m.n / cruces;
      if (fraccionModal < modaMinima) {
        res.sinTarifaEstable.push({
          casetaNorm, clase, cruces, mediana: mediana(importes), minimo: importes[0], maximo: importes[cruces - 1],
          fraccionModal: Math.round(fraccionModal * 1000) / 1000,
        });
        continue;
      }
      const anomalos = cruces - m.n;
      const dispersion = Math.round((anomalos / cruces) * 1000) / 1000;
      res.tarifas.push({ casetaNorm, clase, importe: m.importe, cruces, anomalos, dispersion, origen: 'inferida', confirmada: false });
      modales.push(m.importe);
      if (anomalos / cruces > dispersionMax) {
        res.casetasInestables.push({ casetaNorm, clase, cruces, importeModal: m.importe, anomalos, dispersion });
      }
    }

    // Sugerencia por_pasada: la caseta cobra lo mismo sin importar la clase.
    if (totalCaseta >= minCruces) {
      const dominante = clases.find((c) => porClase.get(c)!.length / totalCaseta >= 0.95);
      if (dominante !== undefined && dominante !== 3 && dominante !== 5) {
        res.porPasada.push({ casetaNorm, cruces: totalCaseta, motivo: 'una_sola_clase', clase: dominante });
      } else if (modales.length >= 2 && Math.max(...modales) / Math.min(...modales) <= 1.05) {
        res.porPasada.push({ casetaNorm, cruces: totalCaseta, motivo: 'importes_similares_entre_clases', clase: null });
      }
    }
  }
  return res;
}
