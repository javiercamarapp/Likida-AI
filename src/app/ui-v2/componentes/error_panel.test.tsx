/* eslint-disable security/detect-non-literal-fs-filename -- lee fuentes del propio repo; ninguna ruta viene de entrada de usuario. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ErrorPanel } from './error-panel';
import { esErrorDeChunk, recargarSiChunk } from './recuperar-chunk';
import { errores as es } from '@/lib/i18n/es/errores';
import { MENSAJE_FLOTA_CAMBIO, DIGEST_FLOTA_CAMBIO } from '@/lib/auth/flota_cambio';

const pintar = (error: Error & { digest?: string }, variante: 'panel' | 'admin' | 'agente' = 'panel') =>
  renderToStaticMarkup(<ErrorPanel error={error} reset={() => undefined} variante={variante} evento="x.boundary" />);

describe('ErrorPanel: la pantalla de error única (paquete N)', () => {
  it('un solo h1, role=alert, el título de su variante, Reintentar, la salida y el código del incidente', () => {
    const h = pintar(Object.assign(new Error('boom'), { digest: '4471093821' }));
    expect(h.match(/<h1/g)).toHaveLength(1);
    expect(h).toContain('role="alert"');
    expect(h).toContain(es['panel.titulo']);
    expect(h).toContain('Reintentar');
    expect(h).toContain('href="/"');
    expect(h).toContain('Código del incidente');
    expect(h).toContain('4471093821');
  });
  it('cada variante dice lo suyo y la consola sale a /admin', () => {
    expect(pintar(new Error('x'), 'agente')).toContain(es['agente.titulo']);
    const a = pintar(new Error('x'), 'admin');
    expect(a).toContain(es['admin.titulo']);
    expect(a).toContain('href="/admin"');
    expect(a).toContain(es['accion.resumen']);
  });
  it('NUNCA filtra el mensaje interno ni la pila del error', () => {
    const e = Object.assign(new Error('relation "viaje" does not exist; SELECT * FROM tenant WHERE id=42'), { digest: '99' });
    const h = pintar(e);
    expect(h).not.toContain('relation');
    expect(h).not.toContain('SELECT');
    expect(h).not.toContain('tenant WHERE');
    expect(h).not.toContain('at ');
  });
  it('sin digest no pinta la línea del código', () => {
    expect(pintar(new Error('x'))).not.toContain('Código del incidente');
  });
  it('flota cambiada: dice «recarga» (no Reintentar) y el texto es el de MENSAJE_FLOTA_CAMBIO', () => {
    const h = pintar(Object.assign(new Error('An error occurred'), { digest: DIGEST_FLOTA_CAMBIO }));
    expect(h).toContain('Cambiaste de flota');
    expect(h).toContain('Recargar');
    expect(h).not.toContain('Reintentar');
    expect(h).toContain(MENSAJE_FLOTA_CAMBIO.replace(/'/g, '&#x27;'));
    expect(es['flota.cuerpo']).toBe(MENSAJE_FLOTA_CAMBIO);
  });
  it('un fallo de carga de código se presenta como actualización y ofrece Recargar', () => {
    const e = Object.assign(new Error('Loading chunk 123 failed.'), { name: 'ChunkLoadError' });
    const h = pintar(e);
    expect(h).toContain(es['chunk.titulo']);
    expect(h).toContain('Recargar');
    expect(h).not.toContain('Loading chunk');
  });
  it('los tres boundaries y los re-exports usan este componente y ninguno trae estilo propio', () => {
    const raiz = join(__dirname, '../..');
    for (const rel of ['dashboard/error.tsx', 'admin/error.tsx', 'dashboard/agentes/error.tsx']) {
      const f = readFileSync(join(raiz, rel), 'utf8');
      expect(f, rel).toContain('ErrorPanel');
      expect(f, rel).not.toMatch(/style=\{\{|className="card/);
    }
    for (const d of ['flotas', 'mapa-prospectos', 'observabilidad', 'qa']) {
      expect(readFileSync(join(raiz, `admin/${d}/error.tsx`), 'utf8'), d).toContain("from '../error'");
    }
  });
});

describe('recuperación de ChunkLoadError', () => {
  it('reconoce los mensajes de carga de código y no confunde un fallo de datos', () => {
    expect(esErrorDeChunk({ name: 'ChunkLoadError', message: '' })).toBe(true);
    expect(esErrorDeChunk(new Error('Failed to fetch dynamically imported module: /x.js'))).toBe(true);
    expect(esErrorDeChunk(new Error('Loading chunk app/page failed'))).toBe(true);
    expect(esErrorDeChunk(new Error('timeout leyendo viajes'))).toBe(false);
    expect(esErrorDeChunk(null)).toBe(false);
  });
  it('recarga UNA sola vez por pestaña', () => {
    const memoria = new Map<string, string>();
    const storage = { getItem: (k: string) => memoria.get(k) ?? null, setItem: (k: string, v: string) => void memoria.set(k, v) };
    const recargar = vi.fn();
    const e = new Error('Loading chunk 9 failed');
    expect(recargarSiChunk(e, { storage, recargar })).toBe(true);
    expect(recargarSiChunk(e, { storage, recargar })).toBe(false);
    expect(recargar).toHaveBeenCalledTimes(1);
  });
  it('sin almacenamiento o con un error de datos no recarga sola', () => {
    const recargar = vi.fn();
    expect(recargarSiChunk(new Error('Loading chunk 9 failed'), { storage: null, recargar })).toBe(false);
    expect(recargarSiChunk(new Error('x'), { storage: { getItem: () => null, setItem: () => undefined }, recargar })).toBe(false);
    expect(recargar).not.toHaveBeenCalled();
  });
});
