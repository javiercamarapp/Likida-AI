import fs from 'fs';
import path from 'path';
import { saveCompanyResult } from './canacar_runner.mjs';

const parts = [
  'batch3_part1.json',
  'batch3_part2.json',
  'batch3_part3.json',
  'batch3_part4.json',
  'batch3_part5.json'
];

async function run() {
  const baseDir = '/Users/javiercamaraportepetit/likida/staging_canacar';
  let allCompanies = [];

  for (const part of parts) {
    const filePath = path.join(baseDir, part);
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      allCompanies.push(...data);
    } else {
      console.warn(`File not found: ${filePath}`);
    }
  }

  console.log(`Total companies to ingest from Lote 3: ${allCompanies.length}`);

  let successCount = 0;
  for (let i = 0; i < allCompanies.length; i++) {
    const item = allCompanies[i];
    console.log(`[${i + 1}/${allCompanies.length}] Ingesting ${item.empresa}...`);
    try {
      await saveCompanyResult(item);
      successCount++;
    } catch (err) {
      console.error(`Error saving ${item.empresa}:`, err.message);
    }
  }

  console.log(`\n=== INGESTIÓN COMPLETADA ===`);
  console.log(`Procesadas exitosamente: ${successCount} de ${allCompanies.length}`);
}

run();
