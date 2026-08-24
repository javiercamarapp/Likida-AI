#!/usr/bin/env node
/**
 * Lint ratchet: conserva los 157 avisos heredados, pero no permite que
 * aumenten por archivo/regla. Los avisos existentes se pueden ir corrigiendo
 * gradualmente; no hay una deuda artificial de arreglarlos todos en un PR.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const baselinePath = resolve(root, 'ci/eslint-warnings-baseline.json');
const eslintBin = resolve(root, 'node_modules/eslint/bin/eslint.js');
const writeBaseline = process.argv.includes('--write');

const result = spawnSync(process.execPath, [eslintBin, 'src', '--format', 'json'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
});

let files;
try {
  files = JSON.parse(result.stdout);
} catch {
  process.stderr.write(result.stderr || result.stdout || 'ESLint no produjo JSON válido.\n');
  process.exit(1);
}

const byFileRule = {};
let warnings = 0;
let errors = 0;
for (const file of files) {
  for (const message of file.messages ?? []) {
    if (message.severity === 2) errors += 1;
    if (message.severity !== 1) continue;
    warnings += 1;
    const fileName = relative(root, file.filePath);
    const rule = message.ruleId ?? 'unknown';
    const key = `${fileName}::${rule}`;
    byFileRule[key] = (byFileRule[key] ?? 0) + 1;
  }
}

const current = { version: 1, totalWarnings: warnings, byFileRule };
if (writeBaseline) {
  writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Baseline ESLint escrito: ${warnings} warnings.`);
  process.exit(errors ? 1 : 0);
}

if (!existsSync(baselinePath)) {
  process.stderr.write(`Falta ${relative(root, baselinePath)}. Ejecuta npm run lint:ratchet -- --write en un cambio intencional.\n`);
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const nuevos = Object.entries(byFileRule)
  .filter(([key, count]) => count > (baseline.byFileRule?.[key] ?? 0))
  .map(([key, count]) => `${key}: ${count} actual vs ${baseline.byFileRule?.[key] ?? 0} baseline`);

if (errors || warnings > (baseline.totalWarnings ?? 0) || nuevos.length) {
  if (errors) console.error(`ESLint encontró ${errors} errores.`);
  if (warnings > (baseline.totalWarnings ?? 0)) {
    console.error(`ESLint aumentó de ${baseline.totalWarnings} a ${warnings} warnings.`);
  }
  for (const aviso of nuevos) console.error(`Nuevo warning: ${aviso}`);
  process.exit(1);
}

console.log(`Lint ratchet OK: ${warnings}/${baseline.totalWarnings} warnings heredados; 0 nuevos; 0 errores.`);
