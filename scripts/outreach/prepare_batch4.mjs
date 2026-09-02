import fs from 'fs';
import path from 'path';
import { fetchUnprocessedCandidates } from './canacar_runner.mjs';

async function prepareBatch4() {
  console.log('Fetching 50 unprocessed candidates for Batch 4...');
  const candidates = await fetchUnprocessedCandidates(50);
  console.log(`Retrieved ${candidates.length} candidates.`);

  const baseDir = '/Users/javiercamaraportepetit/likida/staging_canacar';
  fs.writeFileSync(path.join(baseDir, 'batch4_candidates.json'), JSON.stringify(candidates, null, 2), 'utf8');

  // Chunk into 10 groups of 5
  for (let i = 0; i < 10; i++) {
    const chunk = candidates.slice(i * 5, (i + 1) * 5);
    const chunkFile = path.join(baseDir, `batch4_chunk_${i + 1}.json`);
    fs.writeFileSync(chunkFile, JSON.stringify(chunk, null, 2), 'utf8');
    console.log(`Chunk ${i + 1}: ${chunk.map(c => c.empresa).join(', ')}`);
  }
}

prepareBatch4();
