// ═══════════════════════════════════════════════════════════════════════════
// «MIS CASOS» DEL REVISOR — qué documentos le tocan a ESTA persona y cómo va SU revisión. PURO (sin base ni reloj).
//
// Regla de la casa: ninguna cifra inventada.
//   · Un caso es un documento «por revisar» asignado a la persona (los sin asignar le tocan a todos y no son suyos).
//   · El estado por campo sale de lo que la pantalla de revisión ya dice (`revisionDe` + `marcaDeFila`), no de otra regla:
//       ✗ bloqueado, o dato crítico que el documento no trae · ◐ por confirmar, inferido o poco seguro · ✔ todo lo demás con valor.
//     Un campo no crítico que el documento no trae no cuenta (no es un ✗ ni un ✔).
//   · La medición es de LOS DOCUMENTOS QUE LA PERSONA APROBÓ (`aprobado_por`): casos revisados, tiempo medio de revisión
//     (solo con la marca de apertura medida) y correcciones registradas en esos documentos. Cuando no hay base devuelve
//     `null` con la fuente que falta: nunca un 0 que parezca medición.
// ═══════════════════════════════════════════════════════════════════════════

import { etiquetaCampo } from './campos';
import { marcaDeFila } from './revision_formato';
import { revisionDe, type FilaCampo } from './presentacion';
import type { DocumentoFila } from './repo';

export type MarcaCampo = '✔' | '◐' | '✗';

export interface ProblemaCampo {
  /** Rótulo en llano del campo (con su renglón si es de mercancía). */
  rotulo: string;
  marca: '◐' | '✗';
  /** Por qué: el hallazgo de la validación, o «el documento no lo trae». */
  motivo: string;
  /** El campo es una discrepancia entre fuentes (`fuentes_en_conflicto`). */
  conflicto: boolean;
}

export interface CasoRevisor {
  id: string;
  nombreArchivo: string;
  clienteId: string | null;
  createdAt: string;
  /** Horas desde que llegó el documento; `null` si la fecha no es válida (no se inventa). */
  antiguedadHoras: number | null;
  /** `false` = el documento no tiene lectura: no hay campos que contar. */
  conLectura: boolean;
  ok: number;
  porConfirmar: number;
  bloqueados: number;
  /** Primero los ✗, luego los ◐. */
  problemas: ProblemaCampo[];
}

const marcaDe = (f: FilaCampo): { marca: MarcaCampo; motivo: string; conflicto: boolean } | null => {
  const vacio = f.valor.trim() === '';
  const conflicto = f.hallazgos.some((h) => h.codigo === 'fuentes_en_conflicto');
  const peor = f.hallazgos.find((h) => h.severidad === 'bloqueo');
  if (peor) return { marca: '✗', motivo: peor.mensaje, conflicto };
  if (vacio) return f.critico ? { marca: '✗', motivo: 'El documento no lo trae.', conflicto } : null;
  const dudoso = f.hallazgos.find((h) => h.severidad === 'confirmar');
  if (dudoso) return { marca: '◐', motivo: dudoso.mensaje, conflicto };
  const m = marcaDeFila(f);
  if (m.avisos.length > 0) return { marca: '◐', motivo: m.avisos[0], conflicto };
  return { marca: '✔', motivo: '', conflicto };
};

/** Un caso a partir de un documento. `ahora` entra por parámetro: esta función no lee el reloj. */
export function casoDe(d: DocumentoFila, ahora: Date): CasoRevisor {
  const ms = Date.parse(d.createdAt);
  const antiguedadHoras = Number.isFinite(ms) ? Math.max(0, Math.round(((ahora.getTime() - ms) / 3_600_000) * 10) / 10) : null;
  const base = { id: d.id, nombreArchivo: d.nombreArchivo, clienteId: d.clienteId, createdAt: d.createdAt, antiguedadHoras };
  const rev = revisionDe(d);
  if (!rev) return { ...base, conLectura: false, ok: 0, porConfirmar: 0, bloqueados: 0, problemas: [] };
  const filas = [...rev.grupos.flatMap((g) => g.filas), ...rev.mercancias.filter((m) => !m.esNuevo).flatMap((m) => m.filas)];
  let ok = 0; let porConfirmar = 0; let bloqueados = 0;
  const problemas: ProblemaCampo[] = [];
  for (const f of filas) {
    const r = marcaDe(f);
    if (!r) continue;
    if (r.marca === '✔') { ok++; continue; }
    if (r.marca === '✗') bloqueados++; else porConfirmar++;
    problemas.push({ rotulo: etiquetaCampo(f.clave, f.renglon), marca: r.marca, motivo: r.motivo, conflicto: r.conflicto });
  }
  // Los hallazgos del documento o de las mercancías (sin campo) también son algo que ver: bloquean o piden confirmar.
  for (const h of rev.generales) {
    if (h.severidad === 'aviso') continue;
    problemas.push({ rotulo: h.campo === 'mercancias' ? 'Mercancías' : 'Documento', marca: h.severidad === 'bloqueo' ? '✗' : '◐', motivo: h.mensaje, conflicto: h.codigo === 'fuentes_en_conflicto' });
    if (h.severidad === 'bloqueo') bloqueados++; else porConfirmar++;
  }
  problemas.sort((a, b) => (a.marca === b.marca ? 0 : a.marca === '✗' ? -1 : 1));
  return { ...base, conLectura: true, ok, porConfirmar, bloqueados, problemas };
}

/** Los casos de la persona: documentos por revisar asignados a ella, el más antiguo primero. */
export function misCasos(filas: ReadonlyArray<DocumentoFila>, asignados: Readonly<Record<string, string>>, usuarioId: string, ahora: Date): CasoRevisor[] {
  return filas
    .filter((d) => d.estado === 'por_revisar' && asignados[d.id] === usuarioId)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
    .map((d) => casoDe(d, ahora));
}

/** La fuente que falta cuando algo no es medible: dicha en llano, sin cifra. */
export type FuenteFaltante = 'aprobados_de_la_persona' | 'marca_de_apertura' | 'correcciones_del_periodo';

export interface MedicionRevisor {
  /** `null` = no medible. */
  casosRevisados: number | null;
  /** Promedio de minutos de revisión de los aprobados con la marca de apertura; `null` si ninguno la trae. */
  minutosPromedio: number | null;
  /** Con cuántos de los aprobados se midió el tiempo. */
  conTiempoMedido: number;
  /** Correcciones registradas en los documentos que aprobó; `null` si no se leyeron (no se pinta un 0). */
  camposCorregidos: number | null;
  faltaCasos: FuenteFaltante | null;
  faltaTiempo: FuenteFaltante | null;
  faltaCorrecciones: FuenteFaltante | null;
}

const r1 = (x: number): number => Math.round(x * 10) / 10;

/**
 * SU medición. `correcciones` = cuenta por documento (`contarCorreccionesPorDocumento`); `null` = no se pudo leer.
 * Solo cuentan los documentos aprobados por `usuarioId` presentes en `filas` (la ventana que la pantalla leyó).
 */
export function medicionDeRevisor(filas: ReadonlyArray<DocumentoFila>, correcciones: ReadonlyMap<string, number> | null, usuarioId: string): MedicionRevisor {
  const suyos = filas.filter((d) => d.estado === 'aprobado' && d.aprobadoPor === usuarioId);
  if (suyos.length === 0) {
    return { casosRevisados: null, minutosPromedio: null, conTiempoMedido: 0, camposCorregidos: null, faltaCasos: 'aprobados_de_la_persona', faltaTiempo: 'aprobados_de_la_persona', faltaCorrecciones: 'aprobados_de_la_persona' };
  }
  const medidos = suyos.filter((d) => d.tiempoRevisionSeg !== null).map((d) => (d.tiempoRevisionSeg as number) / 60);
  return {
    casosRevisados: suyos.length,
    minutosPromedio: medidos.length === 0 ? null : r1(medidos.reduce((s, m) => s + m, 0) / medidos.length),
    conTiempoMedido: medidos.length,
    camposCorregidos: correcciones === null ? null : suyos.reduce((s, d) => s + (correcciones.get(d.id) ?? 0), 0),
    faltaCasos: null,
    faltaTiempo: medidos.length === 0 ? 'marca_de_apertura' : null,
    faltaCorrecciones: correcciones === null ? 'correcciones_del_periodo' : null,
  };
}
