// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18 (C2): EL NOMBRE DEL DECISOR NO SALE HACIA EL MODELO.
//
// "Ing. Ramón Treviño, Director de Operaciones" es una persona física que
// nunca contrató nada con Likida y no sabe que existe. Frente a ella Likida
// es RESPONSABLE (LFPDPPP art. 14), no encargada, y mandar su nombre a un
// modelo externo es un tratamiento más —uno que ningún aviso cubría—. La
// ficha que se le entrega al redactor lleva un MARCADOR en vez del nombre; el
// nombre de pila se repone AQUÍ, después, sin salir del proceso. El modelo
// redacta igual de bien: "estimado {{DECISOR}}" se convierte en "estimado
// Ramón" al volver.
//
// Lo mismo para lo que se cuela en `notas`: correos y teléfonos de personas,
// y el propio nombre del contacto si el censo lo repitió ahí.
// ═══════════════════════════════════════════════════════════════════════════

export const MARCADOR_DECISOR = '{{DECISOR}}';

/** Títulos que preceden al nombre en el censo y que no son nombre de pila. */
const HONORIFICOS = /^(ing|lic|c\.?p|dr|dra|sr|sra|srta|mtro|mtra|arq|prof|don|doña)\.?$/i;

/** El nombre de pila de un contacto: "Ing. Ramón Treviño" → "Ramón". */
export function nombreDePila(contacto: string): string {
  const partes = contacto.trim().split(/\s+/).filter((p) => !HONORIFICOS.test(p));
  return partes[0] ?? '';
}

const CORREO = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
/** Secuencias de 7+ dígitos con separadores — teléfonos y celulares. */
const TELEFONO = /(?:\+?\d[\d\s().-]{6,}\d)/g;

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Las notas sin datos de contacto de personas. Se quitan correos, teléfonos
 * y cualquier aparición del nombre del contacto (completo o cada nombre y
 * apellido suelto de ≥3 letras, palabra entera). No es un anonimizador perfecto —una nota puede
 * nombrar a otra persona que no conocemos— y por eso se DICE en el aviso de
 * prospectos qué sale; esto reduce el dato al mínimo que el redactor necesita.
 */
export function notasSinPersona(notas: string | null, contactoNombre: string | null): string | null {
  if (!notas) return null;
  let t = notas.replace(CORREO, '[correo omitido]').replace(TELEFONO, '[teléfono omitido]');
  if (contactoNombre) {
    const tokens = contactoNombre.trim().split(/\s+/).filter((p) => !HONORIFICOS.test(p));
    // Primero el nombre completo (sin título), luego cada nombre o apellido
    // suelto de 3+ letras: "Treviño" a secas también identifica.
    for (const n of [tokens.join(' '), ...tokens]) {
      if (n.length < 3) continue;
      t = t.replace(new RegExp(`(?<![\\p{L}])${escaparRegex(n)}(?![\\p{L}])`, 'giu'), MARCADOR_DECISOR);
    }
  }
  return t;
}

/** La línea de la ficha sobre el decisor, sin el nombre. */
export function lineaDecisor(contactoNombre: string | null): string {
  return contactoNombre?.trim()
    ? `Decisor: identificado. En el mensaje dirígete a él escribiendo literalmente ${MARCADOR_DECISOR} donde iría su nombre de pila (es un marcador que se sustituye después; NO inventes un nombre).`
    : 'Decisor: no identificado aún (no uses ningún nombre de persona).';
}

/** Repone el nombre de pila donde el modelo dejó el marcador. Sin contacto, el
 *  marcador se quita y se limpia el espacio que deja. */
export function reponerDecisor(texto: string, contactoNombre: string | null): string {
  const pila = contactoNombre ? nombreDePila(contactoNombre) : '';
  const marcador = new RegExp(escaparRegex(MARCADOR_DECISOR), 'g');
  if (pila) return texto.replace(marcador, pila);
  return texto
    .replace(new RegExp(`[ ,]*${escaparRegex(MARCADOR_DECISOR)}`, 'g'), '')
    .replace(/ {2,}/g, ' ')
    .replace(/^[,\s]+/, '');
}
