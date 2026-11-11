// F22 — Versiones mínimas de dependencias sensibles y engines/node, verificadas contra el lock y los workflows reales,
// más pruebas de sanidad con lockfiles sintéticos que traen una versión vulnerable.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MINIMOS, violacionesDeLock, violacionesDePackage, violacionesDeWorkflows } from './dependencias-minimas.mjs';

const RAIZ = join(__dirname, '..', '..');
const leer = (...p: string[]) => readFileSync(join(RAIZ, ...p), 'utf8');

describe('versiones mínimas de dependencias', () => {
  it('sanidad: un lock con sharp 0.34.x (CVE de libvips) anidado en next se marca', () => {
    const lock = { packages: { 'node_modules/sharp': { version: '0.35.5' }, 'node_modules/next/node_modules/sharp': { version: '0.34.3' } } };
    expect(violacionesDeLock(lock)).toEqual(['node_modules/next/node_modules/sharp 0.34.3 < 0.35.0']);
  });
  it('sanidad: next 16.3.8 y supabase-js viejo se marcan; versiones iguales o mayores no', () => {
    expect(violacionesDeLock({ packages: { 'node_modules/next': { version: '16.3.8' }, 'node_modules/@supabase/supabase-js': { version: '2.99.0' } } })).toHaveLength(2);
    expect(violacionesDeLock({ packages: { 'node_modules/next': { version: '16.4.5' }, 'node_modules/@supabase/ssr': { version: '0.13.0' } } })).toEqual([]);
    expect(violacionesDeLock({ packages: { 'node_modules/next': { version: '16.10.0' } } })).toEqual([]); // 10 > 4, no comparación de texto
  });
  it('sanidad: package.json sin engines.node o con piso bajo se marca', () => {
    const base = { dependencies: { next: '^16.4.5', sharp: '^0.35.3', '@supabase/supabase-js': '^2.117.1', '@supabase/ssr': '^0.12.7', 'pdf-parse': '^2.4.5' } };
    expect(violacionesDePackage(base)).toEqual(['engines.node no está declarado']);
    expect(violacionesDePackage({ ...base, engines: { node: '>=18' } })).toHaveLength(1);
    expect(violacionesDePackage({ ...base, dependencies: { ...base.dependencies, next: '^16.0.0' }, engines: { node: '>=22' } })).toEqual(['next declara ^16.0.0, piso 16.4.5']);
  });
  it('sanidad: un workflow con node-version 18 se marca', () => {
    expect(violacionesDeWorkflows({ 'x.yml': 'node-version: 18' })).toHaveLength(1);
    expect(violacionesDeWorkflows({ 'x.yml': "node-version: '24'" })).toEqual([]);
  });

  it('el lock real cumple los mínimos (todas las copias, también las anidadas)', () => {
    expect(violacionesDeLock(JSON.parse(leer('package-lock.json')))).toEqual([]);
  });
  it('package.json declara pisos al menos iguales a los mínimos y engines.node >= 22', () => {
    expect(violacionesDePackage(JSON.parse(leer('package.json')))).toEqual([]);
  });
  it('los workflows usan un Node que cumple engines.node', () => {
    const dir = join(RAIZ, '.github', 'workflows');
    const textos = Object.fromEntries(readdirSync(dir).filter((n) => n.endsWith('.yml')).map((n) => [n, readFileSync(join(dir, n), 'utf8')]));
    expect(violacionesDeWorkflows(textos)).toEqual([]);
  });
  it('los mínimos cubren next, sharp, @supabase/* y pdf-parse', () => {
    expect(Object.keys(MINIMOS).sort()).toEqual(['@supabase/ssr', '@supabase/supabase-js', 'next', 'pdf-parse', 'sharp']);
  });
});
