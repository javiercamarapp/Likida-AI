/* eslint-disable security/detect-non-literal-fs-filename -- lee fuentes del propio repo */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CLAVE_RECARGA_CHUNK, VENTANA_RECARGA_CHUNK_MS, esErrorDeChunk, recargarSiChunkViejo } from './recarga-chunk';

const chunk = Object.assign(new Error('Loading chunk 482 failed.'), { name: 'ChunkLoadError' });
const memoria = () => {
  const d = new Map<string, string>();
  return { getItem: (k: string) => d.get(k) ?? null, setItem: (k: string, v: string) => { d.set(k, v); } };
};

describe('esErrorDeChunk', () => {
  it('reconoce los mensajes de chunk viejo de webpack, turbopack y los navegadores', () => {
    expect(esErrorDeChunk(chunk)).toBe(true);
    expect(esErrorDeChunk(new Error('Loading chunk 9 failed.'))).toBe(true);
    expect(esErrorDeChunk(new TypeError('Failed to fetch dynamically imported module: https://x/_next/static/chunks/a.js'))).toBe(true);
    expect(esErrorDeChunk(new Error('error loading dynamically imported module'))).toBe(true);
  });
  it('no confunde un error cualquiera', () => {
    expect(esErrorDeChunk(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(esErrorDeChunk(null)).toBe(false);
    expect(esErrorDeChunk('ChunkLoadError')).toBe(false);
  });
});

describe('recargarSiChunkViejo', () => {
  it('recarga UNA sola vez por ventana', () => {
    const recargar = vi.fn();
    const almacen = memoria();
    expect(recargarSiChunkViejo(chunk, { almacen, ahoraMs: 1_000_000, recargar })).toBe(true);
    expect(recargarSiChunkViejo(chunk, { almacen, ahoraMs: 1_000_000 + 5_000, recargar })).toBe(false);
    expect(recargar).toHaveBeenCalledTimes(1);
  });
  it('pasada la ventana vuelve a poder recargar (otro despliegue, otra sesión larga)', () => {
    const recargar = vi.fn();
    const almacen = memoria();
    recargarSiChunkViejo(chunk, { almacen, ahoraMs: 1_000_000, recargar });
    expect(recargarSiChunkViejo(chunk, { almacen, ahoraMs: 1_000_000 + VENTANA_RECARGA_CHUNK_MS + 1, recargar })).toBe(true);
    expect(recargar).toHaveBeenCalledTimes(2);
  });
  it('un error que no es de chunk no recarga ni toca el almacén', () => {
    const recargar = vi.fn();
    const almacen = memoria();
    expect(recargarSiChunkViejo(new Error('otro'), { almacen, recargar })).toBe(false);
    expect(almacen.getItem(CLAVE_RECARGA_CHUNK)).toBeNull();
    expect(recargar).not.toHaveBeenCalled();
  });
  it('sin almacenamiento no recarga (no hay cómo evitar el bucle) y no lanza', () => {
    const recargar = vi.fn();
    expect(recargarSiChunkViejo(chunk, { almacen: null, recargar })).toBe(false);
    const roto = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => undefined };
    expect(recargarSiChunkViejo(chunk, { almacen: roto, recargar })).toBe(false);
    expect(recargar).not.toHaveBeenCalled();
  });
});

describe('los tres boundaries lo usan', () => {
  // Los boundaries ya no llaman a la lib directamente: pintan ErrorPanel, que llama a useRecuperacionChunk, que delega aquí
  // (un solo mecanismo). Se prueba la cadena completa, no solo el primer eslabón.
  const leer = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');
  it.each(['app/admin/error.tsx', 'app/dashboard/error.tsx'])('%s pinta ErrorPanel', (f) => {
    expect(leer(f)).toContain("from '../ui-v2/componentes/error-panel'");
  });
  it('global-error reusa la recuperación de chunk', () => {
    expect(leer('app/global-error.tsx')).toContain('useRecuperacionChunk');
  });
  it('ErrorPanel usa la recuperación y esta delega en la lib de F16', () => {
    expect(leer('app/ui-v2/componentes/error-panel.tsx')).toContain('useRecuperacionChunk(error, reset)');
    expect(leer('app/ui-v2/componentes/recuperar-chunk.ts')).toContain("from '@/lib/recarga-chunk'");
    expect(leer('app/ui-v2/componentes/recuperar-chunk.ts')).toContain('recargarSiChunkViejo(');
  });
});
