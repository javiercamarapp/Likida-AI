// Utilidades de escaneo de fuentes para las pruebas de arquitectura de F8 (calidad). Solo lectura, sin dependencias.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const RAIZ = join(__dirname, '..', '..', '..');

/** Archivos de producción (.ts/.tsx, sin pruebas) bajo `src/`. */
export function* archivosFuente(dir = join(RAIZ, 'src'), ext = /\.tsx?$/): Generator<string> {
  for (const nombre of readdirSync(dir)) {
    const p = join(dir, nombre);
    if (statSync(p).isDirectory()) yield* archivosFuente(p, ext);
    else if (ext.test(p) && !/\.(test|prueba)\./.test(p)) yield p;
  }
}

export const rel = (p: string) => relative(RAIZ, p).split('\\').join('/');
export const leer = (p: string) => readFileSync(p, 'utf8');
