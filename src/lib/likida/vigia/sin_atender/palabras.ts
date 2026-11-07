// Coincidencia de palabras y frases por tokens sobre texto normalizado (sin acentos, minúsculas, sin signos).
// NUNCA se construye una expresión regular con lo que escribe el usuario.
import { normalizar } from '../entrada';

/** Palabras/frases normalizadas, únicas y no vacías. */
export function compilarPalabras(lista: readonly string[]): string[] {
  const salida = new Set<string>();
  for (const p of lista) {
    const n = normalizar(typeof p === 'string' ? p : '');
    if (n) salida.add(n);
  }
  return [...salida];
}

/** ¿El texto (ya normalizado) contiene alguna palabra o frase completa? «embarque» no coincide con «desembarque». */
export function contienePalabra(textoNormal: string, compiladas: readonly string[]): boolean {
  if (!textoNormal || compiladas.length === 0) return false;
  const pegado = ` ${textoNormal} `;
  return compiladas.some((p) => pegado.includes(` ${p} `));
}

const NEGACIONES = compilarPalabras([
  'no hace falta', 'no es urgente', 'no corre prisa', 'no hay prisa', 'no urge', 'sin prisa', 'sin urgencia', 'no es necesario',
]);

/** El apremio se cancela expresamente: «sin prisa», «no es urgente». */
export function apremioNegado(textoNormal: string): boolean {
  return contienePalabra(textoNormal, NEGACIONES);
}
