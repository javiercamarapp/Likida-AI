// ═══════════════════════════════════════════════════════════════════════════
// CÓMO SE LLAMA Y DE QUÉ COLOR SE PINTA CADA ESTATUS DE LIQUIDACIÓN. UNA VEZ.
//
// Vivía COPIADO en las dos páginas del panel (la lista y el detalle), y
// `etiquetas_sincronizadas.test.ts` existía para vigilar que las dos copias no
// se separaran — el auditor lo había marcado como "latente para el próximo
// estatus nuevo", que es exactamente como se rompió `CONCEPTO` dos veces.
//
// El mapa gemelo de conceptos (motor/PDF/panel) SÍ tiene que seguir vigilado
// por un test: vive en runtimes distintos y no se puede importar de uno a
// otro. Este no: las dos páginas son server components del MISMO panel, así
// que un módulo compartido lo cierra de verdad en vez de avisar cuando ya
// pasó. Lo que queda por probar no es que dos copias coincidan, sino que esta
// única copia cubra todos los valores de `EstatusLiquidacion`.
// ═══════════════════════════════════════════════════════════════════════════

export const ESTATUS: Record<string, { label: string; color: string }> = {
  cuadrada: { label: 'Cuadrada', color: 'var(--color-ok)' },
  con_diferencias: { label: 'Con diferencias', color: 'var(--color-warn)' },
  revisar: { label: 'Por revisar', color: 'var(--color-bad)' },
};

/** Un estatus que el mapa no conoce se pinta con su clave cruda en gris —
 *  nunca `undefined` ni una etiqueta inventada. */
export function etiquetaEstatus(estatus: string): { label: string; color: string } {
  return ESTATUS[estatus] ?? { label: estatus, color: 'var(--muted)' };
}
