#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// PRUEBA DEL WEBHOOK DE LIQUIDACIONES con bitácoras SINTÉTICAS (formato muestra-tms).
//
//   node scripts/probar-webhook-liquidaciones.mjs --url https://app.likida.ai --n 70 --dry-run
//   node scripts/probar-webhook-liquidaciones.mjs --url https://app.likida.ai --n 70            (simulación: no escribe nada)
//   node scripts/probar-webhook-liquidaciones.mjs --url … --n 5 --real --confirmo-escritura    (escribe en la flota de la llave)
//
// El token (llave de API del área administración) se pide en un diálogo OCULTO de macOS: nunca por argumento ni por logs.
// La lógica vive en src/lib/likida/liquidacion_externa/prueba_webhook_cli.ts (con pruebas). Como es TypeScript, este archivo se
// relanza solo con `npx tsx`. Guía completa: docs/operacion/prueba-liquidaciones.md
// ════════════════════════════════════════════════════════════════════════════
import { spawnSync, execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

if (process.env.LIKIDA_PRUEBA_BAJO_TSX !== '1') {
  const r = spawnSync('npx', ['--yes', 'tsx', fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit', env: { ...process.env, LIKIDA_PRUEBA_BAJO_TSX: '1' },
  });
  process.exit(r.status ?? 1);
}

const { parsearArgumentos, ejecutarPrueba, USO } = await import('../src/lib/likida/liquidacion_externa/prueba_webhook_cli.ts');

const parsed = parsearArgumentos(process.argv.slice(2));
if (!parsed.ok) {
  console.error(`ERROR: ${parsed.error}\n\n${USO}`);
  process.exit(1);
}

function leerToken() {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e',
      'text returned of (display dialog "Pega la llave de API del área administración (no se muestra ni se guarda)" default answer "" with hidden answer with title "Probar webhook de liquidaciones")',
    ], (err, stdout) => (err ? reject(new Error('cancelado')) : resolve(String(stdout).replace(/\r?\n$/, ''))));
  });
}

const r = await ejecutarPrueba(parsed.args, {
  leerToken, fetch, leerArchivo: (ruta) => readFile(ruta, 'utf8'), escribir: (l) => console.log(l),
});
process.exit(r.codigo);
