// ═══════════════════════════════════════════════════════════════════════════
// UN GENERADOR DE QR, SIN DEPENDENCIAS (W2 «producto», 1-oct-2026).
//
// La guía de arranque del chofer imprime un QR hacia `wa.me/<número>?text=…`.
// El repo ya trae `zxing-wasm`, pero su ESCRITOR es WebAssembly y cargarlo en una
// función de Vercel es el modo de fallo caro que `cfdi_imagen.ts` documenta (el
// `.wasm` aparece roto el día del deploy). Un QR de una URL cabe en ~200 líneas de
// TypeScript puro, y se verifica de verdad: la prueba lo decodifica con el LECTOR
// (`zxing-wasm/reader`) y exige que devuelva el mismo texto.
//
// ALCANCE, dicho: modo BYTE (UTF-8), corrección de errores M (≈15 %), versiones 1
// a 10 (hasta 213 bytes) — suficiente para un enlace de WhatsApp con texto
// prellenado. Un texto más largo LANZA; no se corta en silencio. Basado en el
// algoritmo de la especificación ISO/IEC 18004 (mismo orden de pasos que la
// implementación de referencia de Project Nayuki, MIT).
// ═══════════════════════════════════════════════════════════════════════════

const VERSION_MAX = 10;
// ECC M, índice = versión (la 0 no existe).
const ECC_POR_BLOQUE_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOQUES_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const POSICIONES_ALINEACION: number[][] = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];
/** Bits del indicador de nivel de corrección de errores M en la información de formato. */
const FORMATO_ECC_M = 0;

// ── Aritmética de Reed-Solomon sobre GF(256), polinomio 0x11D ──────────────

function multiplicarGf(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function divisorRs(grado: number): number[] {
  const raiz = new Array<number>(grado).fill(0);
  raiz[grado - 1] = 1;
  let r = 1;
  for (let i = 0; i < grado; i++) {
    for (let j = 0; j < raiz.length; j++) {
      raiz[j] = multiplicarGf(raiz[j], r);
      if (j + 1 < raiz.length) raiz[j] ^= raiz[j + 1];
    }
    r = multiplicarGf(r, 0x02);
  }
  return raiz;
}

function restoRs(datos: readonly number[], divisor: readonly number[]): number[] {
  const resultado = divisor.map(() => 0);
  for (const b of datos) {
    const factor = b ^ (resultado.shift() as number);
    resultado.push(0);
    divisor.forEach((coef, i) => { resultado[i] ^= multiplicarGf(coef, factor); });
  }
  return resultado;
}

// ── Capacidad ──────────────────────────────────────────────────────────────

function modulosDeDatosBrutos(ver: number): number {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlin = Math.floor(ver / 7) + 2;
    r -= (25 * numAlin - 10) * numAlin - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}

function codewordsDeDatos(ver: number): number {
  return Math.floor(modulosDeDatosBrutos(ver) / 8) - ECC_POR_BLOQUE_M[ver] * BLOQUES_M[ver];
}

/** Cuántos bytes de texto caben en la versión `ver` (modo byte, ECC M). */
export function capacidadEnBytes(ver: number): number {
  const bitsCabecera = 4 + 8; // indicador de modo + contador de caracteres (versiones 1-9)
  const bits = codewordsDeDatos(ver) * 8 - (ver >= 10 ? 4 + 16 : bitsCabecera);
  return Math.floor(bits / 8);
}

function bitsDe(valor: number, largo: number, destino: number[]): void {
  for (let i = largo - 1; i >= 0; i--) destino.push((valor >>> i) & 1);
}

// ── La matriz ──────────────────────────────────────────────────────────────

class Matriz {
  readonly tam: number;
  readonly mod: boolean[][];
  readonly funcion: boolean[][];
  constructor(readonly ver: number) {
    this.tam = ver * 4 + 17;
    // (Sin el constructor estático de arreglos: el guardia de la frontera de datos
    // cuenta como acceso a Supabase cualquier llamada a un método llamado como la tabla.)
    const vacia = (): boolean[][] => [...new Array<number>(this.tam).keys()].map(() => new Array<boolean>(this.tam).fill(false));
    this.mod = vacia();
    this.funcion = vacia();
  }
  poner(x: number, y: number, oscuro: boolean): void {
    this.mod[y][x] = oscuro;
    this.funcion[y][x] = true;
  }
}

function dibujarPatrones(m: Matriz): void {
  const { tam, ver } = m;
  for (let i = 0; i < tam; i++) { m.poner(6, i, i % 2 === 0); m.poner(i, 6, i % 2 === 0); }
  const buscador = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx; const y = cy + dy;
        if (x >= 0 && x < tam && y >= 0 && y < tam) m.poner(x, y, dist !== 2 && dist !== 4);
      }
    }
  };
  buscador(3, 3); buscador(tam - 4, 3); buscador(3, tam - 4);
  const pos = POSICIONES_ALINEACION[ver];
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) m.poner(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }
  dibujarFormato(m, 0);
  if (ver >= 7) {
    let resto = ver;
    for (let i = 0; i < 12; i++) resto = (resto << 1) ^ ((resto >>> 11) * 0x1f25);
    const bits = (ver << 12) | resto;
    for (let i = 0; i < 18; i++) {
      const b = ((bits >>> i) & 1) !== 0;
      const a = tam - 11 + (i % 3); const c = Math.floor(i / 3);
      m.poner(a, c, b); m.poner(c, a, b);
    }
  }
}

function dibujarFormato(m: Matriz, mascara: number): void {
  const { tam } = m;
  const datos = (FORMATO_ECC_M << 3) | mascara;
  let resto = datos;
  for (let i = 0; i < 10; i++) resto = (resto << 1) ^ ((resto >>> 9) * 0x537);
  const bits = ((datos << 10) | resto) ^ 0x5412;
  const bit = (i: number) => ((bits >>> i) & 1) !== 0;
  for (let i = 0; i <= 5; i++) m.poner(8, i, bit(i));
  m.poner(8, 7, bit(6)); m.poner(8, 8, bit(7)); m.poner(7, 8, bit(8));
  for (let i = 9; i < 15; i++) m.poner(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) m.poner(tam - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) m.poner(8, tam - 15 + i, bit(i));
  m.poner(8, tam - 8, true);
}

function colocarDatos(m: Matriz, codewords: readonly number[]): void {
  const { tam } = m;
  let i = 0;
  for (let derecha = tam - 1; derecha >= 1; derecha -= 2) {
    if (derecha === 6) derecha = 5;
    for (let vert = 0; vert < tam; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = derecha - j;
        const arriba = ((derecha + 1) & 2) === 0;
        const y = arriba ? tam - 1 - vert : vert;
        if (!m.funcion[y][x] && i < codewords.length * 8) {
          m.mod[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
    }
  }
}

function aplicarMascara(m: Matriz, mascara: number): void {
  for (let y = 0; y < m.tam; y++) {
    for (let x = 0; x < m.tam; x++) {
      let invertir: boolean;
      switch (mascara) {
        case 0: invertir = (x + y) % 2 === 0; break;
        case 1: invertir = y % 2 === 0; break;
        case 2: invertir = x % 3 === 0; break;
        case 3: invertir = (x + y) % 3 === 0; break;
        case 4: invertir = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: invertir = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: invertir = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: invertir = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
      }
      if (!m.funcion[y][x] && invertir) m.mod[y][x] = !m.mod[y][x];
    }
  }
}

function penalizacion(m: Matriz): number {
  const { tam, mod } = m;
  let total = 0;
  const corridas = (linea: readonly boolean[]): number => {
    let p = 0; let color = linea[0]; let largo = 1;
    for (let i = 1; i <= linea.length; i++) {
      if (i < linea.length && linea[i] === color) { largo++; continue; }
      if (largo >= 5) p += 3 + (largo - 5);
      if (i < linea.length) { color = linea[i]; largo = 1; }
    }
    return p;
  };
  const patron = (linea: readonly boolean[]): number => {
    const a = [true, false, true, true, true, false, true, false, false, false, false];
    const b = [false, false, false, false, true, false, true, true, true, false, true];
    let p = 0;
    for (let i = 0; i + 11 <= linea.length; i++) {
      if (a.every((v, k) => linea[i + k] === v) || b.every((v, k) => linea[i + k] === v)) p += 40;
    }
    return p;
  };
  for (let y = 0; y < tam; y++) { total += corridas(mod[y]) + patron(mod[y]); }
  for (let x = 0; x < tam; x++) {
    const col = mod.map((f) => f[x]);
    total += corridas(col) + patron(col);
  }
  for (let y = 0; y + 1 < tam; y++) {
    for (let x = 0; x + 1 < tam; x++) {
      const c = mod[y][x];
      if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) total += 3;
    }
  }
  let oscuros = 0;
  for (const f of mod) for (const c of f) if (c) oscuros++;
  const k = Math.ceil(Math.abs(oscuros * 20 - tam * tam * 10) / (tam * tam)) - 1;
  return total + Math.max(0, k) * 10;
}

/** Los codewords finales: datos + corrección, intercalados por bloque. */
function codewordsFinales(datos: readonly number[], ver: number): number[] {
  const nBloques = BLOQUES_M[ver];
  const eccLen = ECC_POR_BLOQUE_M[ver];
  const brutos = Math.floor(modulosDeDatosBrutos(ver) / 8);
  const nCortos = nBloques - (brutos % nBloques);
  const largoCorto = Math.floor(brutos / nBloques);
  const divisor = divisorRs(eccLen);
  const bloques: number[][] = [];
  for (let i = 0, k = 0; i < nBloques; i++) {
    const largoDatos = largoCorto - eccLen + (i < nCortos ? 0 : 1);
    const dat = datos.slice(k, k + largoDatos);
    k += largoDatos;
    const ecc = restoRs(dat, divisor);
    if (i < nCortos) dat.push(0); // marcador de relleno: se salta al intercalar
    bloques.push([...dat, ...ecc]);
  }
  const salida: number[] = [];
  for (let i = 0; i < bloques[0].length; i++) {
    bloques.forEach((b, j) => {
      if (i !== largoCorto - eccLen || j >= nCortos) salida.push(b[i]);
    });
  }
  return salida;
}

/**
 * La matriz de módulos del QR (`true` = oscuro), sin zona de silencio.
 * Lanza si el texto no cabe en la versión 10 con corrección M.
 */
export function qrModulos(texto: string): boolean[][] {
  const bytes = [...new TextEncoder().encode(texto)];
  let ver = 1;
  while (ver <= VERSION_MAX && bytes.length > capacidadEnBytes(ver)) ver++;
  if (ver > VERSION_MAX) {
    throw new RangeError(`El texto mide ${bytes.length} bytes y el QR de esta pantalla admite ${capacidadEnBytes(VERSION_MAX)}.`);
  }

  const bits: number[] = [];
  bitsDe(0b0100, 4, bits);
  bitsDe(bytes.length, ver >= 10 ? 16 : 8, bits);
  for (const b of bytes) bitsDe(b, 8, bits);
  const capacidadBits = codewordsDeDatos(ver) * 8;
  bitsDe(0, Math.min(4, capacidadBits - bits.length), bits);
  while (bits.length % 8 !== 0) bits.push(0);
  const datos: number[] = [];
  for (let i = 0; i < bits.length; i += 8) datos.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let relleno = 0xec; datos.length < codewordsDeDatos(ver); relleno ^= 0xec ^ 0x11) datos.push(relleno);

  const final = codewordsFinales(datos, ver);
  let mejor: Matriz | null = null;
  let mejorPenal = Infinity;
  for (let mascara = 0; mascara < 8; mascara++) {
    const m = new Matriz(ver);
    dibujarPatrones(m);
    colocarDatos(m, final);
    aplicarMascara(m, mascara);
    dibujarFormato(m, mascara);
    const p = penalizacion(m);
    if (p < mejorPenal) { mejorPenal = p; mejor = m; }
  }
  return (mejor as Matriz).mod;
}

/**
 * El QR como SVG en línea: NEGRO sobre BLANCO con zona de silencio de 4 módulos,
 * también en tema oscuro (un lector no escanea un QR invertido). Un solo `<path>`.
 */
export function qrSvg(texto: string, opciones: { etiqueta: string; tamanoPx?: number } = { etiqueta: 'Código QR' }): string {
  const m = qrModulos(texto);
  const margen = 4;
  const lado = m.length + margen * 2;
  let d = '';
  for (let y = 0; y < m.length; y++) {
    for (let x = 0; x < m.length; x++) if (m[y][x]) d += `M${x + margen} ${y + margen}h1v1h-1z`;
  }
  const px = opciones.tamanoPx ?? 192;
  const etiqueta = opciones.etiqueta.replace(/[<>&"]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" width="${px}" height="${px}" role="img" aria-label="${etiqueta}" shape-rendering="crispEdges"><rect width="${lado}" height="${lado}" fill="#ffffff"/><path d="${d}" fill="#000000"/></svg>`;
}
