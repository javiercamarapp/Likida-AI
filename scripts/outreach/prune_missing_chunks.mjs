import fs from 'fs';
import path from 'path';
const missingPath = '/Users/javiercamaraportepetit/likida/staging_canacar/missing_chunks.txt';
const lines = fs.readFileSync(missingPath, 'utf-8').split('\n').filter(Boolean);
const filtered = lines.filter(line => {
  // Convert JSON chunk file path to results file path
  const base = path.basename(line, '.json');
  const resultsFile = `/Users/javiercamaraportepetit/likida/staging_canacar/${base}_results.json`;
  return !fs.existsSync(resultsFile);
});
fs.writeFileSync(missingPath, filtered.join('\n') + (filtered.length ? '\n' : ''), 'utf-8');
console.log('Pruned missing_chunks.txt, remaining:', filtered.length);
