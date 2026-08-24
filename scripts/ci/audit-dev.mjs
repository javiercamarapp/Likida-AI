#!/usr/bin/env node
/** Resume npm audit de devDependencies sin ocultarlo en CI. */
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('Uso: node scripts/ci/audit-dev.mjs <npm-audit.json>');
  process.exit(2);
}

let report;
try {
  report = JSON.parse(readFileSync(file, 'utf8'));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`### Auditoría de dependencias de desarrollo\n\nNo se pudo leer el reporte: ${message}`);
  process.exit(0);
}

const counts = report.metadata?.vulnerabilities ?? {};
const total = Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0);
const packages = Object.entries(report.vulnerabilities ?? {})
  .slice(0, 20)
  .map(([name, item]) => `${name} (${item.severity ?? 'unknown'})`);

console.log('### Auditoría de dependencias de desarrollo');
console.log('');
console.log(`Vulnerabilidades reportadas: **${total}** (low ${counts.low ?? 0}, moderate ${counts.moderate ?? 0}, high ${counts.high ?? 0}, critical ${counts.critical ?? 0}).`);
console.log('');
console.log('Esta auditoría es visible y genera artefacto; el bloqueo de runtime permanece separado.');
if (packages.length) {
  console.log('');
  console.log(`Paquetes: ${packages.join(', ')}`);
}
if (total > 0) console.log(`::warning::npm audit encontró ${total} vulnerabilidades en dependencias de desarrollo; revisar el artefacto npm-audit-dev.`);
