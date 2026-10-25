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
//
// ── POR QUÉ VIVE EN lib/ Y NO JUNTO A LA RUTA (auditoría 19, C2 / C.18) ────
//
// Nació pegado a /api/admin/mapa-prospectos/mensaje, y por eso el SEGUNDO
// camino que manda datos de prospecto a un modelo —el Redactor de correos
// fríos (agentes/redactor.ts)— no lo encontró: cerró el nombre con su propio
// marcador y dejó `prospecto.notas` saliendo crudo hacia OpenRouter durante
// seis pasadas de auditoría. La lección no es "arreglar el redactor": es que
// una protección pegada a UN llamador se queda en ese llamador. Ahora es LA
// PUERTA ÚNICA: todo prompt que se arme con datos de un prospecto pasa las
// notas por `notasSinPersona`, y seudonimo_puerta_unica.test.ts vigila que
// ningún archivo que llame al modelo interpole `notas` sin importar de aquí.
// ═══════════════════════════════════════════════════════════════════════════

export const MARCADOR_DECISOR = '{{DECISOR}}';

/** Títulos que preceden al nombre en el censo y que no son nombre de pila. */
const HONORIFICOS = /^(ing|lic|c\.?p|dr|dra|sr|sra|srta|mtro|mtra|arq|prof|don|doña)\.?$/i;

/** El nombre de pila de un contacto: "Ing. Ramón Treviño" → "Ramón". */
export function nombreDePila(contacto: string): string {
  const partes = contacto.trim().split(/\s+/).filter((p) => !HONORIFICOS.test(p));
  return partes[0] ?? '';
}

// A37-S55-04: la clase era ASCII (\w): «josé.ñandú@correo.mx» no se tachaba completo.
const CORREO = /[\p{L}\p{N}_.+-]+@[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)+/gu;
/** Secuencias de 7+ dígitos con separadores — teléfonos y celulares. */
const TELEFONO = /(?:\+?\d[\d\s().-]{6,}\d)/g;

/** Quita las marcas diacríticas de UN carácter («ñ» → «n», «é» → «e»); lo que no tiene marca queda igual. */
function sinMarcas(ch: string): string {
  return ch.normalize('NFD').replace(/\p{M}/gu, '');
}

/**
 * Sustituye `nombre` por `marcador` en `texto` ignorando mayúsculas Y acentos/ñ («Ramón Treviño»
 * == «ramon trevino»), conservando intactos los caracteres que no coinciden. Se compara sobre una
 * copia plegada con un mapa de posiciones para reescribir el original (A37-S55-04).
 */
function reemplazarSinAcentos(texto: string, nombre: string, marcador: string): string {
  let plegado = '';
  const mapa: number[] = []; // índice del plegado → índice del original
  for (let i = 0; i < texto.length;) {
    const cp = texto.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    for (const f of sinMarcas(ch)) { mapa.push(i); plegado += f; }
    i += ch.length;
  }
  const objetivo = [...nombre].map(sinMarcas).join('');
  if (objetivo.length < 3) return texto;
  const re = new RegExp(`(?<![\\p{L}])${escaparRegex(objetivo)}(?![\\p{L}])`, 'giu');
  const tramos: Array<[number, number]> = [];
  for (const m of plegado.matchAll(re)) {
    const ini = mapa[m.index!];
    const ultimo = mapa[m.index! + m[0].length - 1];
    // El fin incluye las marcas combinantes que siguen al último carácter base.
    let fin = ultimo + 1;
    while (fin < texto.length && /\p{M}/u.test(texto[fin])) fin++;
    tramos.push([ini, fin]);
  }
  let salida = texto;
  for (const [ini, fin] of tramos.reverse()) salida = salida.slice(0, ini) + marcador + salida.slice(fin);
  return salida;
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Las notas sin datos de contacto de personas. Se quitan correos, teléfonos
 * y cualquier aparición del nombre del contacto (completo o cada nombre y
 * apellido suelto de ≥3 letras, palabra entera). No es un anonimizador perfecto —una nota puede
 * nombrar a otra persona que no conocemos— y por eso se DICE en el aviso de
 * prospectos qué sale; esto reduce el dato al mínimo que el redactor necesita.
 *
 * `marcador` es el token con el que ESE prompt nombra al decisor: el Cerebro
 * usa `{{DECISOR}}` y el Redactor de correos `{{NOMBRE}}`. Se parametriza
 * para que la sustitución de vuelta (reponer el nombre tras la completion)
 * encuentre el mismo token que su propio system prompt enseña — un marcador
 * ajeno dentro de las notas confundiría al modelo y sobreviviría a la vuelta.
 */
export function notasSinPersona(
  notas: string | null,
  contactoNombre: string | null,
  marcador: string = MARCADOR_DECISOR,
): string | null {
  if (!notas) return null;
  let t = notas.replace(CORREO, '[correo omitido]').replace(TELEFONO, '[teléfono omitido]');
  if (contactoNombre) {
    const tokens = contactoNombre.trim().split(/\s+/).filter((p) => !HONORIFICOS.test(p));
    // Primero el nombre completo (sin título), luego cada nombre o apellido
    // suelto de 3+ letras: "Treviño" a secas también identifica.
    for (const n of [tokens.join(' '), ...tokens]) {
      if (n.length < 3) continue;
      t = reemplazarSinAcentos(t, n, marcador);
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
