import sharp from 'sharp';

// Fotos SINTÉTICAS de un ticket para calibrar y probar la prevalidación (F19). Determinista: el "texto" son rectángulos que
// salen de un generador congruencial fijo, sin fuentes del sistema. Es un ticket dibujado, NO una foto de campo.

function lcg(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 0x3c6ef35f) >>> 0; return s / 0x100000000; };
}

/** SVG del ticket: papel claro y renglones de "letras" negras. `desborde` lleva el texto de borde a borde (ticket recortado). */
function svgTicket(ancho: number, alto: number, desborde: boolean): string {
  const rnd = lcg(20261110);
  const margen = desborde ? 0 : Math.round(ancho * 0.15);
  const rects: string[] = [];
  for (let y = Math.round(alto * 0.06); y < alto * 0.94; y += 34) {
    for (let x = margen; x < ancho - margen - 14; x += 14) {
      if (rnd() < 0.22) continue; // espacio entre palabras
      const h = 14 + Math.floor(rnd() * 8);
      rects.push(`<rect x="${x}" y="${y}" width="${6 + Math.floor(rnd() * 4)}" height="${h}" fill="#101010"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}"><rect width="100%" height="100%" fill="#ececE6"/>${rects.join('')}</svg>`;
}

export type VarianteFoto = 'buena' | 'oscura' | 'quemada' | 'desenfocada' | 'recortada' | 'chica';

/** El `data:` URL (JPEG) de la variante pedida. Siempre 1200×1600, salvo `chica` (500×667). */
export async function fotoSintetica(v: VarianteFoto): Promise<string> {
  const ancho = v === 'chica' ? 500 : 1200;
  const alto = v === 'chica' ? 667 : 1600;
  let img = sharp(new TextEncoder().encode(svgTicket(ancho, alto, v === 'recortada')));
  if (v === 'oscura') img = img.linear(0.18, 0);
  if (v === 'quemada') img = img.linear(1, 175);
  if (v === 'desenfocada') img = img.blur(9);
  const buf = await img.jpeg({ quality: 88 }).toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}
