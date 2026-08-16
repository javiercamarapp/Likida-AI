import { describe, test, expect } from 'vitest';
import { hashImagen } from '@/lib/likida/intake/hash';
import { hashBytes, duplicadaPorHash, extensionDe, mismoDiaMx, MIMES_PERMITIDOS } from './qa-storage';
import type { FotoBanco } from './qa-tipos';

describe('hashBytes — el MISMO digest que img_hash de producción', () => {
  test('coincide byte a byte con hashImagen(dataUrl)', async () => {
    // Si el banco y la base hablaran de hashes distintos, el dedup del banco
    // y el oráculo #3 compararían peras con manzanas.
    const bytes = Buffer.from('ticket sintetico de prueba \x00\x01\xfe', 'binary');
    const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`;
    expect(hashBytes(bytes)).toBe(await hashImagen(dataUrl));
  });
});

describe('duplicadaPorHash', () => {
  const foto = (id: string, hash: string): FotoBanco =>
    ({ id, hash, path: `banco/${id}.jpg`, mime: 'image/jpeg', etiqueta: id, bytes: 1, subidoEn: '2026-08-16T00:00:00Z', ocrEsperado: null });

  test('encuentra la existente y respeta la ausencia', () => {
    const banco = [foto('a', 'h1'), foto('b', 'h2')];
    expect(duplicadaPorHash(banco, 'h2')?.id).toBe('b');
    expect(duplicadaPorHash(banco, 'h3')).toBeNull();
  });
});

describe('extensionDe — solo los formatos que el flujo real entrega', () => {
  test('JPEG/PNG/WebP pasan; HEIC y demás se rechazan (null, jamás un default)', () => {
    expect(extensionDe('image/jpeg')).toBe('jpg');
    expect(extensionDe('image/png')).toBe('png');
    expect(extensionDe('image/webp')).toBe('webp');
    expect(extensionDe('image/heic')).toBeNull();
    expect(extensionDe('application/pdf')).toBeNull();
    expect(extensionDe('')).toBeNull();
    expect(Object.keys(MIMES_PERMITIDOS)).toHaveLength(3);
  });
});

describe('mismoDiaMx — el tope diario se mide con el día de México', () => {
  test('las 05:00Z y las 23:00Z del mismo día UTC pueden ser días MX distintos', () => {
    // 2026-08-16T05:00Z = 2026-08-15 23:00 en CDMX (UTC-6) → día MX 15.
    // 2026-08-16T23:00Z = 2026-08-16 17:00 en CDMX        → día MX 16.
    expect(mismoDiaMx('2026-08-16T05:00:00Z', '2026-08-16T23:00:00Z')).toBe(false);
    expect(mismoDiaMx('2026-08-16T07:00:00Z', '2026-08-16T23:00:00Z')).toBe(true);
  });
  test('una fecha rota no truena ni cuenta como hoy', () => {
    expect(mismoDiaMx('no-es-fecha', '2026-08-16T23:00:00Z')).toBe(false);
  });
});
