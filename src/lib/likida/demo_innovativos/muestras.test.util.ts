// Ayuda de las pruebas del demo: lee los archivos de muestra exportados por
// scripts/demo/innovativos/exportar-archivos.mjs (única fuente; no se copian).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../../../../scripts/demo/innovativos/archivos-muestra/', import.meta.url));
export const rutaMuestra = (rel: string): string => `${RAIZ}${rel}`;
export const bytesMuestra = (rel: string): Uint8Array => new Uint8Array(readFileSync(rutaMuestra(rel)));
export const textoMuestra = (rel: string): string => readFileSync(rutaMuestra(rel), 'utf8');
