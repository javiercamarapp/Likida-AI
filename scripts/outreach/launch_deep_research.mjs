const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const pendingFile = path.resolve('/Users/javiercamaraportepetit/likida/staging_canacar/deep_pending.txt');
const batchSize = 5;

function readPending() {
  if (!fs.existsSync(pendingFile)) return [];
  const lines = fs.readFileSync(pendingFile, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  return lines;
}

function writePending(ids) {
  fs.writeFileSync(pendingFile, ids.join('\n') + (ids.length ? '\n' : ''), 'utf8');
}

function launchBatch(ids) {
  ids.forEach(id => {
    const prompt = `Investiga a fondo la empresa con ID "${id}" y rellena los campos solicitados (sitioweb, ceo_nombre, ceo_linkedin, correos, historia, empleados_estimado, flota_estimada, estado). Guarda el resultado en /Users/javiercamaraportepetit/likida/staging_canacar/deep_${id}.json`;
    const spec = {
      typeName: 'canacar_researcher_gemini',
      role: `Investigador profundo ${id}`,
      initialPrompt: prompt,
      inherit: true,
      model: 'inherit'
    };
    const invoke = spawn('agy', ['invoke', JSON.stringify(spec)], { cwd: '/Users/javiercamaraportepetit' });
    invoke.stdout.on('data', data => console.log(`Sub‑agent ${id}: ${data}`));
    invoke.stderr.on('data', data => console.error(`Error ${id}: ${data}`));
  });
}

function main() {
  const pending = readPending();
  if (pending.length === 0) {
    console.log('No quedan IDs pendientes.');
    return;
  }
  const batch = pending.slice(0, batchSize);
  const remaining = pending.slice(batchSize);
  writePending(remaining);
  console.log(`Lanzando ${batch.length} sub‑agentes para IDs: ${batch.join(', ')}`);
  launchBatch(batch);
}

main();
