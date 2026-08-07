import { describe, it, expect } from 'vitest';
import { hashImagen } from './hash';

// data URLs mínimos (bytes distintos) para probar invariantes del hash.
const A = 'data:image/jpeg;base64,' + btoa('foto-A-contenido');
const A2 = 'data:image/png;base64,' + btoa('foto-A-contenido'); // MISMO byte-payload, otro mime
const B = 'data:image/jpeg;base64,' + btoa('foto-B-distinta');

describe('hashImagen', () => {
  it('es determinístico: mismo contenido → mismo hash', async () => {
    expect(await hashImagen(A)).toBe(await hashImagen(A));
  });

  it('hashea el CONTENIDO, no el mime: mismo payload en jpeg y png → mismo hash', async () => {
    expect(await hashImagen(A)).toBe(await hashImagen(A2));
  });

  it('contenidos distintos → hashes distintos', async () => {
    expect(await hashImagen(A)).not.toBe(await hashImagen(B));
  });

  it('devuelve 64 hex (SHA-256)', async () => {
    expect(await hashImagen(A)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('tolera un payload crudo sin prefijo data:', async () => {
    const raw = btoa('sin-prefijo');
    expect(await hashImagen(raw)).toMatch(/^[0-9a-f]{64}$/);
  });
});
