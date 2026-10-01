import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MANDATO_AUTOFACTURACION, versionVigente, VERSION_TERMINOS, VERSION_AVISO_PRIVACIDAD } from './documentos';

describe('el texto del mandato y su huella', () => {
  it('la huella registrada ES el SHA-256 del texto: editar el texto obliga a subir la versión y la huella', () => {
    const h = createHash('sha256').update(MANDATO_AUTOFACTURACION.texto).digest('hex');
    expect(MANDATO_AUTOFACTURACION.hashSha256, 'cambiaste el texto del mandato: sube la versión (m-AAAA-MM-DD) y actualiza hashSha256').toBe(h);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('es el MISMO párrafo que publica /terminos §2 (no hay dos redacciones de la autorización)', () => {
    const terminos = readFileSync('src/app/terminos/page.tsx', 'utf8').replace(/\*\*/g, '');
    expect(terminos).toContain(MANDATO_AUTOFACTURACION.texto);
  });

  it('la versión del mandato tiene forma estable y cabe en la columna (<= 64)', () => {
    expect(MANDATO_AUTOFACTURACION.version).toMatch(/^m-\d{4}-\d{2}-\d{2}$/);
    expect(versionVigente('mandato_autofacturacion')).toBe(MANDATO_AUTOFACTURACION.version);
    expect(versionVigente('terminos')).toBe(VERSION_TERMINOS);
    expect(versionVigente('aviso_privacidad')).toBe(VERSION_AVISO_PRIVACIDAD);
  });
});
