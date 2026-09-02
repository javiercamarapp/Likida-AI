import fs from 'fs';
import path from 'path';
import { fetchUnprocessedCandidates } from './canacar_runner.mjs';

async function prepareBatch16() {
  console.log('Fetching 100 unprocessed candidates for Batch 16...');
  const candidates = await fetchUnprocessedCandidates(100);
  console.log(`Retrieved ${candidates.length} candidates.`);

  const baseDir = '/Users/javiercamaraportepetit/likida/staging_canacar';
  fs.writeFileSync(path.join(baseDir, 'batch16_candidates.json'), JSON.stringify(candidates, null, 2), 'utf8');

  // Chunk into 20 groups of 5
  for (let i = 0; i < 20; i++) {
    const chunk = candidates.slice(i * 5, (i + 1) * 5);
    const chunkFile = path.join(baseDir, `batch16_chunk_${i + 1}.json`);
    fs.writeFileSync(chunkFile, JSON.stringify(chunk, null, 2), 'utf8');
    console.log(`Batch 16 Chunk ${i + 1}: ${chunk.map(c => c.empresa).join(', ')}`);
  }
}

prepareBatch16().catch(console.error);
