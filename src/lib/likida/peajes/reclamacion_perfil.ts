import { LEYENDAS_RECLAMACION, type MotivoReclamacion } from './reclamacion';

// ═══════════════════════════════════════════════════════════════════════════
// EL REPORTE DE RECLAMACIÓN BAJO EL PERFIL `cinco_agentes` (T-A2-24). PURO.
//
// `gps_lejos_de_caseta` es la SEGUNDA FASE que la flota pidió para el reporte con el que se pide el descuento al proveedor
// (comparar los cobros contra las posiciones GPS). Bajo el perfil el reporte enseña SOLO ese motivo y el doble cobro
// (que no es GPS); la unidad en una zona no autorizada y el cruce fuera de curso son stand-by: no se arman, no se
// pintan y no se cuentan (se ocultan, el código y la lógica siguen intactos para las flotas sin perfil).
//
// Todo lo que sale de aquí es un CANDIDATO: el GPS lejos de la caseta no prueba que el cobro sea indebido (tag prestado,
// reloj del proveedor desfasado, caseta mal ubicada en el catálogo). La decisión de reclamar es de la flota.
// ═══════════════════════════════════════════════════════════════════════════

/** Lo que el perfil deja ver del reporte con GPS. El resto de los motivos es stand-by. */
export const MOTIVOS_VISIBLES_CINCO_AGENTES: readonly MotivoReclamacion[] = Object.freeze(['gps_lejos_de_caseta', 'doble_cobro'] as const);

/** Estado vacío cuando todavía no hay con qué comparar. */
export const TEXTO_SIN_POSICIONES =
  'Este reporte necesita posiciones y casetas con ubicación: aún no están conectadas, así que no hay nada que comparar. '
  + 'Recuerda: no hay datos no es evidencia en contra de ningún cobro.';

/** La leyenda que rotula el reporte. */
export const TEXTO_CANDIDATO =
  'Todo lo de este reporte es un candidato a revisar, no un cobro indebido confirmado: que la unidad no apareciera cerca de la caseta puede deberse a un TAG prestado, a un reloj desfasado o a una caseta mal ubicada. La decisión de reclamar es de la flota.';

const EN_STAND_BY = [/^Unidad en zona no autorizada/, /^Cruce fuera de curso/, /^Los cursos salen/];

/** Las leyendas del reporte sin las de los motivos en stand-by, más la de «candidato». */
export function leyendasDePerfil(): string[] {
  return [...LEYENDAS_RECLAMACION.filter((l) => !EN_STAND_BY.some((re) => re.test(l))), TEXTO_CANDIDATO];
}
