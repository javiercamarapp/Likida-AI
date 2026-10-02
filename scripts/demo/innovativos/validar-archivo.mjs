#!/usr/bin/env node
// Valida un archivo de Innovativos ANTES de cargarlo (no escribe nada, no toca red).
//   node scripts/demo/innovativos/validar-archivo.mjs <tipo> <ruta>
//   tipos: gps_posiciones | geocercas | pases | liquidaciones | convenios | whatsapp | carta_porte
// Sale 0 si se puede cargar tal cual; 1 si hay problemas; 2 si se usó mal.
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const [tipo, ruta] = process.argv.slice(2);
if (!tipo || !ruta) { console.error('Uso: node scripts/demo/innovativos/validar-archivo.mjs <tipo> <ruta>\n  tipos: gps_posiciones | geocercas | pases | liquidaciones | convenios | whatsapp | carta_porte'); process.exit(2); }

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { createJiti } = createRequire(import.meta.url)('jiti');
// Los módulos del repo usan el alias «@/»; jiti lo resuelve a src/.
const jiti = createJiti(import.meta.url, { alias: { '@': join(raiz, 'src') }, moduleCache: false });
const { validarArchivo } = await jiti.import(join(raiz, 'src/lib/likida/demo_innovativos/archivos.ts'));

const r = validarArchivo(tipo, basename(ruta), new Uint8Array(readFileSync(ruta)));
console.log(`\n${r.ok ? 'OK' : 'CON PROBLEMAS'} — ${r.tipo} — ${basename(ruta)}`);
for (const l of r.resumen) console.log(`  · ${l}`);
for (const l of r.avisos) console.log(`  ! aviso: ${l}`);
for (const l of r.problemas) console.log(`  x ${l}`);
process.exit(r.ok ? 0 : 1);
