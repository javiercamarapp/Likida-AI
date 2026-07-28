// ═══════════════════════════════════════════════════════════════════════════
// DESCARGOS DE RESPONSABILIDAD.
//
// No son adorno legal. El Anexo 3 de la RMF 2026 (DOF 09-01-2026) publica ~74
// criterios no vinculativos de prácticas fiscales indebidas, y casi todos
// cierran con una fracción que alcanza a "quien asesore, aconseje, PRESTE
// SERVICIOS o participe en la realización o implementación" de la práctica.
//
// Esa última es la posición de Likida, no la del cliente: un motor que calcula
// mal un estímulo no comete un error del contralor, comete una práctica
// indebida propia. Los arts. 89 y 90 del CFF son el marco de esa
// responsabilidad, y decir con claridad qué es esto —y qué no— es la mitigación
// que la propia ley ofrece.
//
// Redacción tomada de docs/conocimiento/21-guardarrailes.md §5.2 y §5.3.
// ═══════════════════════════════════════════════════════════════════════════

/** Para WhatsApp y el dashboard: donde el espacio importa. */
export const LEYENDA_CORTA =
  'Preparado por el motor de reglas de Likida con fundamento citado. No es un dictamen ' +
  'ni la opinión de un contador público, y puede diferir de los criterios que dé a ' +
  'conocer el SAT. Valídalo con tu contador antes de usarlo en una declaración.';

/** Una línea, para pegar junto a un veredicto suelto. */
export const LEYENDA_INLINE =
  'Preparado por el motor de reglas — no sustituye la opinión de tu contador.';

/**
 * Pie del PDF de liquidación, que es el documento que se archiva y el que
 * eventualmente ve un tercero. Aquí la referencia al art. 52 del CFF es
 * deliberada: deja constancia de que esto NO es un dictamen fiscal.
 */
export function leyendaPdf(fechaGeneracion: string, razonSocialCliente?: string): string {
  const responsable = razonSocialCliente?.trim() || 'el contribuyente';
  return (
    `Reporte generado automáticamente a partir de las reglas fiscales vigentes al ${fechaGeneracion}, ` +
    `citadas junto a cada partida. Likida no es contador público registrado ni despacho fiscal, y este ` +
    `documento no constituye un dictamen en términos del artículo 52 del Código Fiscal de la Federación. ` +
    `Los criterios aplicados pueden diferir de los que dé a conocer el SAT. Validar cada partida antes de ` +
    `su uso en la contabilidad o las declaraciones corresponde a ${responsable}.`
  );
}
