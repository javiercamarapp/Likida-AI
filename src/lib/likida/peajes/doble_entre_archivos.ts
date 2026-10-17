import { mxn } from '@/lib/formato';
import { normalizarNombre, normalizarTag } from './formatos';
import { sumarMeses } from './periodo';
import type { LineaCobro } from './reglas_cobro';

// ═══════════════════════════════════════════════════════════════════════════
// POSIBLE DOBLE COBRO ENTRE ARCHIVOS (T-A2-38) — «¿este cobro tardío ya me lo cobraron?»
//
// El proveedor cobra tarde (agosto cobrado en octubre) y a veces ya lo había cobrado en el
// archivo de su mes. Dentro de un archivo eso lo cubre `duplicado_exacto`; aquí se busca la
// MISMA clave (TAG, fecha-hora al segundo, caseta, importe) en los archivos PREVIOS de la flota
// dentro de una ventana (default 3 meses = plazo de reclamo):
//   · está en un archivo previo   → candidato `posible_doble_entre_archivos` (con archivo y fila previa);
//   · no está                     → «cobro tardío legítimo» (INFORMATIVO, no candidato).
//
// Doctrina: es un CANDIDATO para validar con el proveedor, nunca un «cobro indebido». Solo se
// comparan las líneas de la hoja principal (la hoja repetida de utilitarios nunca se guarda).
// Una línea sin TAG o sin hora no se puede afirmar igual a otra: va a `noComparables`, no se calla.
//
// PURO: sin base, sin red. El I/O vive en `datos.ts` (`lineasPreviasDeFlota`) y se integra en
// `revision_cobros.ts`.
// ═══════════════════════════════════════════════════════════════════════════

export const CATEGORIA_DOBLE_ENTRE_ARCHIVOS = 'posible_doble_entre_archivos' as const;
export const ETIQUETA_DOBLE_ENTRE_ARCHIVOS = 'Posible doble cobro entre archivos';

/** Ventana por defecto: el plazo de reclamo (3 meses). Configurable por llamada. */
export const VENTANA_MESES_DEFAULT = 3;

export interface LineaPrevia {
  fecha: string | null;
  hora?: string | null;
  caseta: string | null;
  tag: string | null;
  monto: number;
  /** Renglón (0-based) dentro de su archivo. */
  indice: number;
}

export interface ArchivoPrevio {
  id: string;
  /** Nombre legible del archivo (para decir «en el archivo X»). */
  etiqueta: string;
  /** Periodo OFICIAL del archivo. `null` = no se sabe: no se puede ubicar en la ventana. */
  periodoDesde: string | null;
  periodoHasta: string | null;
  lineas: readonly LineaPrevia[];
}

export interface CandidatoDoble {
  indice: number;
  categoria: typeof CATEGORIA_DOBLE_ENTRE_ARCHIVOS;
  fecha: string | null;
  hora: string | null;
  caseta: string | null;
  tag: string | null;
  unidad: string | null;
  monto: number;
  archivoPrevioId: string;
  archivoPrevio: string;
  /** Renglón del archivo previo, base 1 (como lo ve quien abre el Excel). */
  filaPrevia: number;
  quePaso: string;
  queSignifica: string;
  queHacer: string;
  referencia: string;
}

export interface TardioLegitimo {
  indice: number;
  fecha: string | null;
  caseta: string | null;
  tag: string | null;
  monto: number;
  /** Informativo: el cobro llegó tarde y NO está en los archivos consultados. */
  nota: string;
}

export interface ResultadoDobleEntreArchivos {
  candidatos: CandidatoDoble[];
  tardiosLegitimos: TardioLegitimo[];
  /** Extemporáneos sin TAG o sin hora: no se puede comparar contra otro archivo. */
  noComparables: number;
  /** Archivos previos efectivamente consultados. */
  archivosConsultados: string[];
  /** Previos que NO se consultaron y por qué (fuera de ventana, sin periodo, no son anteriores). */
  archivosNoConsultados: Array<{ id: string; etiqueta: string; motivo: string }>;
  /** Por qué la regla no corrió (sin periodo, sin extemporáneos que revisar no es motivo). */
  reglaNoAplicada: string | null;
  ventanaMeses: number;
  montoCandidatos: number;
}

export interface OpcionesDoble {
  /** Inicio del periodo del archivo en revisión (ISO). `null` = no se aplica. */
  periodoDesde: string | null;
  /** Id del archivo en revisión: nunca se compara contra sí mismo. */
  archivoActualId?: string | null;
  ventanaMeses?: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** La clave de «mismo cobro»: TAG, fecha-hora al segundo, caseta, importe. `null` si falta TAG, fecha u hora. */
export function claveCobro(l: { tag: string | null; fecha: string | null; hora?: string | null; caseta: string | null; monto: number }): string | null {
  const tag = normalizarTag(l.tag);
  if (!tag || !l.fecha || !l.hora) return null;
  return `${tag}|${l.fecha}|${String(l.hora).slice(0, 8)}|${normalizarNombre(l.caseta ?? '')}|${l.monto.toFixed(2)}`;
}

/**
 * Busca, para cada línea extemporánea (`fecha < periodoDesde`), el mismo cobro en los archivos
 * previos de la ventana. El índice vive en memoria (un Map por clave): 60 000 + 60 000 líneas
 * se resuelven en O(n).
 */
export function revisarDobleEntreArchivos(
  lineas: readonly LineaCobro[], previos: readonly ArchivoPrevio[], op: OpcionesDoble,
): ResultadoDobleEntreArchivos {
  const ventanaMeses = op.ventanaMeses ?? VENTANA_MESES_DEFAULT;
  const vacio = (motivo: string | null): ResultadoDobleEntreArchivos => ({
    candidatos: [], tardiosLegitimos: [], noComparables: 0, archivosConsultados: [], archivosNoConsultados: [],
    reglaNoAplicada: motivo, ventanaMeses, montoCandidatos: 0,
  });
  if (op.periodoDesde === null) {
    return vacio('Sin periodo del archivo no se sabe qué cobro llegó tarde, así que no se busca el mismo cobro en archivos anteriores. Declara el periodo al subir el archivo.');
  }
  const periodoDesde = op.periodoDesde;
  const limite = sumarMeses(periodoDesde, -ventanaMeses);

  const consultados: ArchivoPrevio[] = [];
  const noConsultados: ResultadoDobleEntreArchivos['archivosNoConsultados'] = [];
  for (const a of previos) {
    if (op.archivoActualId && a.id === op.archivoActualId) continue;
    const fin = a.periodoHasta ?? a.periodoDesde;
    if (a.periodoDesde === null || fin === null) {
      noConsultados.push({ id: a.id, etiqueta: a.etiqueta, motivo: 'No se conoce su periodo: no se puede saber si está dentro de la ventana.' });
    } else if (a.periodoDesde >= periodoDesde) {
      noConsultados.push({ id: a.id, etiqueta: a.etiqueta, motivo: 'No es anterior al archivo en revisión.' });
    } else if (fin < limite) {
      noConsultados.push({ id: a.id, etiqueta: a.etiqueta, motivo: `Su periodo termina antes de ${limite}: fuera de la ventana de ${ventanaMeses} meses.` });
    } else {
      consultados.push(a);
    }
  }

  // Índice: clave → primer archivo/fila donde apareció (el más reciente primero, no importa cuál: se cita uno).
  const indice = new Map<string, { archivo: ArchivoPrevio; fila: number }>();
  for (const a of consultados) {
    for (const p of a.lineas) {
      const k = claveCobro(p);
      if (k && !indice.has(k)) indice.set(k, { archivo: a, fila: p.indice + 1 });
    }
  }

  const candidatos: CandidatoDoble[] = [];
  const tardios: TardioLegitimo[] = [];
  let noComparables = 0;
  const yaVistas = new Set<string>();
  for (const l of lineas) {
    if (l.fecha === null || l.fecha >= periodoDesde) continue; // no es extemporáneo
    const k = claveCobro(l);
    if (k === null) { noComparables++; continue; }
    // La misma clave repetida DENTRO de este archivo ya la marca `duplicado_exacto`: aquí solo la primera.
    if (yaVistas.has(k)) continue;
    yaVistas.add(k);
    const previa = indice.get(k);
    const caseta = l.caseta ?? 'una caseta sin nombre';
    const quien = l.unidad ? `La unidad ${l.unidad}` : l.tag ? `El TAG ${l.tag}` : 'Un vehículo';
    const cuando = `el ${l.fecha}${l.hora ? ` a las ${String(l.hora).slice(0, 8)}` : ''}`;
    if (previa) {
      candidatos.push({
        indice: l.indice, categoria: CATEGORIA_DOBLE_ENTRE_ARCHIVOS, fecha: l.fecha, hora: l.hora ? String(l.hora).slice(0, 8) : null,
        caseta: l.caseta, tag: l.tag, unidad: l.unidad, monto: l.monto,
        archivoPrevioId: previa.archivo.id, archivoPrevio: previa.archivo.etiqueta, filaPrevia: previa.fila,
        quePaso: `${quien} cruzó ${caseta} ${cuando} y el cobro (${mxn(l.monto)}) llegó tarde en este archivo, pero el mismo cobro (mismo TAG, mismo segundo, misma caseta y mismo importe) ya aparece en «${previa.archivo.etiqueta}», fila ${previa.fila}.`,
        queSignifica: 'Es una señal fuerte de cobro repetido: el proveedor pudo cobrar dos veces el mismo cruce, una en su periodo y otra ahora. No es un cobro indebido confirmado: puede ser un renglón repetido en los archivos del proveedor.',
        queHacer: `Confirma con el proveedor si fueron dos cruces. Si no, reclama el segundo cobro por el portal (el plazo es de ${ventanaMeses} meses desde el cobro).`,
        referencia: `archivo previo «${previa.archivo.etiqueta}», fila ${previa.fila}`,
      });
    } else {
      tardios.push({
        indice: l.indice, fecha: l.fecha, caseta: l.caseta, tag: l.tag, monto: l.monto,
        nota: `Cobro tardío legítimo: ${cuando} en ${caseta} (${mxn(l.monto)}) no aparece en ${consultados.length === 0 ? 'ningún archivo anterior (no hay archivos previos en la ventana)' : `los ${consultados.length} archivo(s) anteriores de la ventana`}. Es informativo, no un candidato.`,
      });
    }
  }

  return {
    candidatos, tardiosLegitimos: tardios, noComparables,
    archivosConsultados: consultados.map((a) => a.id), archivosNoConsultados: noConsultados,
    reglaNoAplicada: null, ventanaMeses,
    montoCandidatos: r2(candidatos.reduce((s, c) => s + c.monto, 0)),
  };
}
