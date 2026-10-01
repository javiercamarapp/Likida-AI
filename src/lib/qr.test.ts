import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { readBarcodes, prepareZXingModule } from 'zxing-wasm/reader';
import { qrModulos, qrSvg, capacidadEnBytes } from './qr';

// ═══════════════════════════════════════════════════════════════════════════
// El QR se verifica de VERDAD: se dibuja la matriz como imagen y el lector
// (`zxing-wasm/reader`, el mismo del webhook de comprobantes) la decodifica. Un
// generador que "se ve como un QR" y no se lee es el peor resultado posible: el
// chofer escanea el cartel y no pasa nada.
// ═══════════════════════════════════════════════════════════════════════════

beforeAll(async () => {
  const wasm = await readFile(createRequire(import.meta.url).resolve(['zxing-wasm', 'reader', 'zxing_reader.wasm'].join('/')));
  await prepareZXingModule({
    overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer },
    fireImmediately: true,
  });
});

/** La matriz como RGBA con zona de silencio de 4 módulos y escala `k`. */
function imagen(m: boolean[][], k = 6): { data: Uint8ClampedArray; width: number; height: number } {
  const lado = (m.length + 8) * k;
  const data = new Uint8ClampedArray(lado * lado * 4).fill(255);
  for (let y = 0; y < m.length; y++) {
    for (let x = 0; x < m.length; x++) {
      if (!m[y][x]) continue;
      for (let dy = 0; dy < k; dy++) {
        for (let dx = 0; dx < k; dx++) {
          const i = (((y + 4) * k + dy) * lado + (x + 4) * k + dx) * 4;
          data[i] = 0; data[i + 1] = 0; data[i + 2] = 0;
        }
      }
    }
  }
  return { data, width: lado, height: lado };
}

async function leer(texto: string): Promise<string | undefined> {
  const r = await readBarcodes(imagen(qrModulos(texto)) as unknown as ImageData, { formats: ['QRCode'], tryHarder: true });
  return r[0]?.text;
}

describe('qrModulos — lo que genera se LEE', () => {
  const casos: Array<[string, string]> = [
    ['una letra (versión 1)', 'A'],
    ['un enlace corto', 'https://wa.me/525512345678'],
    ['el enlace de arranque con texto prellenado', 'https://wa.me/525512345678?text=Hola%2C%20soy%20Juan%20de%20Transportes%20del%20Norte'],
    ['acentos y eñes (UTF-8)', 'Hola, soy José Núñez de Cañada y Peña — ¿ya me registraron?'],
    ['emoji (4 bytes por carácter)', 'Hola 👋 camión 🚛'],
    ['cerca del tope de la versión 6', 'x'.repeat(100)],
    ['versión 7+ (con información de versión)', 'https://wa.me/525512345678?text=' + 'a'.repeat(90)],
    ['versión 10 (contador de 16 bits)', 'https://app.likida.ai/' + 'b'.repeat(190)],
  ];
  it.each(casos)('%s', async (_n, texto) => {
    expect(await leer(texto)).toBe(texto);
  });

  it('todas las versiones 1..10 se leen (un texto del tamaño exacto de cada capacidad)', async () => {
    for (let ver = 1; ver <= 10; ver++) {
      const texto = 'z'.repeat(capacidadEnBytes(ver));
      expect(await leer(texto), `versión ${ver}`).toBe(texto);
    }
  });

  it('el tamaño de la matriz sigue 4·versión+17', () => {
    expect(qrModulos('A')).toHaveLength(21);
    expect(qrModulos('z'.repeat(capacidadEnBytes(10)))).toHaveLength(57);
  });

  it('es DETERMINISTA: el mismo texto da la misma matriz', () => {
    expect(qrModulos('https://wa.me/525512345678')).toEqual(qrModulos('https://wa.me/525512345678'));
  });

  it('un texto que no cabe LANZA, no se corta en silencio', () => {
    expect(() => qrModulos('x'.repeat(capacidadEnBytes(10) + 1))).toThrow(/admite/);
  });

  it('el texto vacío es un QR válido de la versión 1', () => {
    expect(qrModulos('')).toHaveLength(21);
  });
});

describe('qrSvg', () => {
  it('es negro sobre blanco con zona de silencio (también en tema oscuro), con etiqueta accesible y SIN scripts', () => {
    const svg = qrSvg('https://wa.me/525512345678', { etiqueta: 'QR para escribirle a Likida' });
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="QR para escribirle a Likida"');
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('fill="#000000"');
    expect(svg).not.toMatch(/<script|onload|javascript:/i);
    expect(svg).toContain('viewBox="0 0 33 33"'); // 21 + 2·4
  });

  it('una etiqueta con caracteres de marcado no rompe el atributo', () => {
    const svg = qrSvg('x', { etiqueta: 'a"><script>alert(1)</script>' });
    expect(svg).not.toContain('<script');
    expect(svg.match(/aria-label="[^"]*"/)).toBeTruthy();
  });
});
