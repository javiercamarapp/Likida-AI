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
// indebida propia.
//
// EL MARCO ES CFF 89 Y 90, Y AHORA TIENE FICHA: `normas/cff-89-90.yaml`,
// `verificado_fuente_primaria`, transcrita del PDF de la Cámara de Diputados
// (texto vigente, última reforma DOF 09-04-2026). Estaba citado aquí sin ficha,
// que es la deuda que `docs/fase1/inventario-normas.md` declaraba.
//
// Y lo que la ficha aporta es más que trazabilidad: la mitigación es LITERAL, y
// está en el último párrafo del propio art. 89 —"No se incurrirá en la
// infracción a que se refiere la fracción primera... cuando se manifieste...
// POR ESCRITO al contribuyente que su asesoría puede ser contraria a la
// interpretación de las autoridades fiscales"—. Por eso las dos leyendas de
// abajo dicen "puede diferir de los criterios que dé a conocer el SAT", y por
// eso tiene que ir ESCRITO en el papel que se archiva y no solo dicho en la
// conversación: la conducta que exime es la manifestación por escrito.
//
// El agravante del art. 90, 2º párrafo, apunta al mismo lugar: la multa sube de
// 10% a 20% de la contribución omitida cuando el criterio es DIVERSO al del
// SAT. Quitar esa frase de estas dos constantes no ahorra una línea: quita la
// eximente.
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
