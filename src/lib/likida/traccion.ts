// ═══════════════════════════════════════════════════════════════════════════
// TRACCIÓN: QUÉ NOMBRES DE TERCEROS SE PUEDEN DECIR, EN UN SOLO LUGAR.
//
// A37-S26-06 (variante de A36-R11-02): la puerta de salida del correo (`cola.ts`)
// vetaba el nombre del prospecto del piloto, pero el prompt del redactor, el
// parte de alianzas y los artículos del blog lo instruían a decir. Un humano lo
// repetía a un tercero sin consentimiento. Ahora hay UNA lista y todos la leen.
//
// Poblar `TRACCION_PUBLICABLE` es una decisión explícita de Javier (acuerdo de
// referencia real), nunca un efecto secundario de que alguien "decida mencionar
// tracción".
// ═══════════════════════════════════════════════════════════════════════════

/** AGB-2 (auditoría 24, 1-sep-2026): nombres de prospectos/clientes que SÍ se
 *  autorizó nombrar como tracción — VACÍA por default. Sin una entrada aquí, a
 *  propósito, ningún nombre de tercero sale en un correo, un artículo ni un
 *  parte que mande a repetirlo. */
export const TRACCION_PUBLICABLE: readonly string[] = [];

/** Los nombres que YA se cazaron saliendo sin autorización (AGB-2) — se bloquean
 *  SIEMPRE salvo que aparezcan, a propósito, en `TRACCION_PUBLICABLE`. */
export const NOMBRES_TRACCION_CAZADOS = ['Grupo GAL', 'Transportes ' + 'Innova' + 'tivos', 'Innova' + 'tivos'] as const;

/** La frase de la casa sobre tracción. Honesta (NINGUNA empresa ha firmado) y
 *  sin nombres salvo los autorizados en `TRACCION_PUBLICABLE`. */
export const FRASE_TRACCION: string = TRACCION_PUBLICABLE.length > 0
  ? `en pláticas con transportistas como ${TRACCION_PUBLICABLE.join(', ')}`
  : 'en pláticas con transportistas';

/** El primer nombre cazado que aparece en `texto` sin estar autorizado; null si
 *  no hay ninguno. */
export function nombreTraccionNoAutorizado(texto: string): string | null {
  for (const nombre of NOMBRES_TRACCION_CAZADOS) {
    if (texto.includes(nombre) && !TRACCION_PUBLICABLE.includes(nombre)) return nombre;
  }
  return null;
}
