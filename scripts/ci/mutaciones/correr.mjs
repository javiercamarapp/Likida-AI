#!/usr/bin/env node
// Sonda de mutaciones del cuadre y la liquidacion (F16). Aplica UN mutante a una COPIA del arbol (nunca al real), corre
// solo sus pruebas y exige que fallen: si pasan, el mutante SOBREVIVIO y falta una prueba.
//
//   node scripts/ci/mutaciones/correr.mjs                 # todos
//   node scripts/ci/mutaciones/correr.mjs signo_de_la_diferencia
//
// Pesado (copia src/ y supabase/ y corre vitest): se corre a mano o en una maquina descargada, no en cada PR.
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { mutantes } = JSON.parse(readFileSync(join(RAIZ, 'scripts/ci/mutaciones/mutantes.json'), 'utf8'));
const pedidos = process.argv.slice(2);
const aCorrer = pedidos.length ? mutantes.filter((m) => pedidos.includes(m.nombre)) : mutantes;
if (pedidos.length && aCorrer.length !== pedidos.length) {
  console.error(`Mutante desconocido. Hay: ${mutantes.map((m) => m.nombre).join(', ')}`);
  process.exit(2);
}

const sandbox = mkdtempSync(join(tmpdir(), 'mutaciones-'));
try {
  for (const d of ['src', 'supabase']) cpSync(join(RAIZ, d), join(sandbox, d), { recursive: true });
  for (const f of ['package.json', 'tsconfig.json', 'vitest.config.ts']) cpSync(join(RAIZ, f), join(sandbox, f));
  symlinkSync(join(RAIZ, 'node_modules'), join(sandbox, 'node_modules'));

  // CONTROL: sin mutar, las pruebas deben pasar en la copia. Si no, un «MUERTO» no probaria nada (la copia no corre).
  const control = spawnSync('npx', ['vitest', 'run', ...new Set(aCorrer.flatMap((m) => m.pruebas)), '--testTimeout=60000', '--reporter=dot'], { cwd: sandbox, encoding: 'utf8' });
  if (control.status !== 0) {
    console.error('CONTROL EN ROJO: las pruebas fallan sin mutar en la copia; no se evalua ningun mutante.\n' + (control.stdout + control.stderr).slice(-1500));
    process.exit(3);
  }

  const resultados = [];
  for (const m of aCorrer) {
    const ruta = join(sandbox, m.archivo);
    const original = readFileSync(ruta, 'utf8');
    const ocurrencias = original.split(m.viejo).length - 1;
    if (ocurrencias !== 1) { resultados.push({ nombre: m.nombre, estado: 'NO_APLICA', detalle: `el fragmento aparece ${ocurrencias} veces` }); continue; }
    writeFileSync(ruta, original.replace(m.viejo, () => m.nuevo));
    const t0 = Date.now();
    const r = spawnSync('npx', ['vitest', 'run', ...m.pruebas, '--testTimeout=60000', '--reporter=dot'], { cwd: sandbox, encoding: 'utf8' });
    writeFileSync(ruta, original); // restaura en la copia para el siguiente mutante
    resultados.push({ nombre: m.nombre, estado: r.status === 0 ? 'SOBREVIVIO' : 'MUERTO', detalle: `${Math.round((Date.now() - t0) / 100) / 10} s, ${/(\d+) failed/.exec(r.stdout + r.stderr)?.[1] ?? '?'} pruebas en rojo` });
  }
  for (const r of resultados) console.log(`${r.estado.padEnd(11)} ${r.nombre}${r.detalle ? ` — ${r.detalle}` : ''}`);
  process.exitCode = resultados.every((r) => r.estado === 'MUERTO') ? 0 : 1;
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
