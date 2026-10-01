import type { Celda } from './formatos';

// ═══════════════════════════════════════════════════════════════════════════
// LECTOR DE CSV PROPIO — para los archivos de peaje, casetas y TAGs.
//
// Por qué no la librería de hojas: con `;` de separador (el default de Excel en
// español de México cuando el sistema usa coma decimal) la librería convierte
// «189,50» en el número 18950 — la coma se toma como separador de miles — y un
// peaje de $189.50 llegaba como $18,950.00 sin que nada lo avisara. Aquí TODA
// celda se queda como texto y es `montoDeCelda` quien decide (y rechaza lo
// ambiguo). Puro; nunca lanza.
// ═══════════════════════════════════════════════════════════════════════════

/** Decodifica el archivo: UTF-8 (con o sin BOM) y, si no es UTF-8 válido, latin1/Windows-1252. */
export function decodificarTexto(bytes: Uint8Array): string {
  let texto = new TextDecoder('utf-8').decode(bytes);
  if (texto.includes('\uFFFD')) texto = new TextDecoder('windows-1252').decode(bytes);
  return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
}

/**
 * El separador, mirando SOLO el renglón de encabezados (el primero con texto,
 * fuera de comillas). Mirar varias líneas lo engañaba: una columna «alias» con
 * `a|b|c` en cada fila hacía ganar a «|» sobre la coma real del archivo. En
 * empate gana el orden «,» «;» tab «|».
 */
export function detectarSeparador(texto: string): string {
  const candidatos = [',', ';', '\t', '|'];
  const cuenta: Record<string, number> = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  let enComillas = false;
  let visto = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === '"') { enComillas = !enComillas; visto = true; }
    else if (!enComillas && (c === '\n' || c === '\r')) { if (visto) break; }
    else if (!enComillas && c in cuenta) { cuenta[c]++; visto = true; }
    else if (c.trim() !== '') visto = true;
  }
  return candidatos.reduce((mejor, c) => (cuenta[c] > cuenta[mejor] ? c : mejor), ',');
}

/** Texto CSV → matriz de celdas de texto. Comillas dobles escapadas con «""», saltos de línea dentro de comillas. */
export function matrizDeCsvTexto(texto: string): Celda[][] {
  const sep = detectarSeparador(texto);
  const filas: Celda[][] = [];
  let fila: string[] = [];
  let celda = '';
  let enComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { celda += '"'; i++; } else enComillas = false;
      } else celda += c;
      continue;
    }
    if (c === '"' && celda === '') enComillas = true;
    else if (c === sep) { fila.push(celda); celda = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(celda); celda = '';
      filas.push(fila); fila = [];
    } else celda += c;
  }
  if (celda !== '' || fila.length > 0) { fila.push(celda); filas.push(fila); }
  return filas;
}

export function matrizDeCsv(buffer: Uint8Array): Celda[][] {
  return matrizDeCsvTexto(decodificarTexto(buffer));
}
