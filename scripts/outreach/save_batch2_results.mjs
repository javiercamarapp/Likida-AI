import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { saveCompanyResult, getState } from './canacar_runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resultsDir = path.resolve(__dirname, '../../staging_canacar/batch2_results');

export async function processSavedResults() {
  if (!fs.existsSync(resultsDir)) {
    console.log('Directorio batch2_results no existe');
    return;
  }

  const files = fs.readdirSync(resultsDir).filter(f => f.endsWith('.json'));
  console.log(`Encontrados ${files.length} archivos de resultados en ${resultsDir}`);

  const state = getState();
  const processedSet = new Set(state.processed_ids || []);

  let savedCount = 0;
  for (const file of files) {
    const filePath = path.join(resultsDir, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!data.id) {
        console.warn(`Archivo ${file} no tiene id válido`);
        continue;
      }
      if (processedSet.has(data.id)) {
        console.log(`[SKIP] Ya procesado previamente: ${data.empresa} (${data.id})`);
        continue;
      }

      await saveCompanyResult(data);
      savedCount++;
      processedSet.add(data.id);
    } catch (err) {
      console.error(`Error procesando ${file}:`, err.message);
    }
  }

  console.log(`[FIN] Guardados exitosamente: ${savedCount}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  processSavedResults().catch(console.error);
}
