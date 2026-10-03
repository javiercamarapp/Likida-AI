// Verifica contra la API PÚBLICA de OpenRouter (sin llave) que cada modelo que Likida usa EXISTE y
// que sus precios y modalidades siguen siendo los de la foto `src/lib/llm/fixtures/openrouter_modelos_*.json`.
//   npx tsx scripts/verificar-modelos-openrouter.ts            # solo reporta
//   npx tsx scripts/verificar-modelos-openrouter.ts --escribir # reescribe la foto con lo de hoy
// No corre en CI (necesita red): úsalo antes de cambiar un modelo y al re-verificar precios (p. ej. el
// 1-ene-2027, cuando gemini-3.8-flash duplica su precio).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'src/lib/llm/fixtures');
const archivo = readdirSync(DIR).filter((f) => /^openrouter_modelos_.*\.json$/.test(f)).sort().at(-1);
if (!archivo) throw new Error('no hay foto en src/lib/llm/fixtures');
const foto = JSON.parse(readFileSync(join(DIR, archivo), 'utf8')) as {
  capturado: string; fuente: string; nota: string;
  modelos: Record<string, { entrada: string[]; precioEntradaUsdM: number; precioSalidaUsdM: number }>;
};

const res = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(30_000) });
if (!res.ok) throw new Error(`OpenRouter contestó HTTP ${res.status}`);
const hoy = new Map((((await res.json()) as { data: Array<{ id: string; architecture?: { input_modalities?: string[] }; pricing: { prompt: string; completion: string } }> }).data)
  .map((m) => [m.id, m]));

let distintos = 0;
for (const [slug, v] of Object.entries(foto.modelos)) {
  const m = hoy.get(slug);
  if (!m) { console.log(`NO EXISTE  ${slug}`); distintos++; continue; }
  const pin = Math.round(Number(m.pricing.prompt) * 1e10) / 1e4;
  const pout = Math.round(Number(m.pricing.completion) * 1e10) / 1e4;
  const ent = [...(m.architecture?.input_modalities ?? [])].sort().join(',');
  const dif: string[] = [];
  if (pin !== v.precioEntradaUsdM) dif.push(`entrada ${v.precioEntradaUsdM} → ${pin}`);
  if (pout !== v.precioSalidaUsdM) dif.push(`salida ${v.precioSalidaUsdM} → ${pout}`);
  if (ent !== v.entrada.join(',')) dif.push(`modalidades ${v.entrada.join(',')} → ${ent}`);
  if (dif.length) { distintos++; console.log(`CAMBIÓ     ${slug}: ${dif.join('; ')}`); } else console.log(`igual      ${slug}`);
  if (process.argv.includes('--escribir')) {
    v.precioEntradaUsdM = pin; v.precioSalidaUsdM = pout; v.entrada = (m.architecture?.input_modalities ?? []).slice().sort();
  }
}
if (process.argv.includes('--escribir')) {
  foto.capturado = new Date().toISOString().slice(0, 10);
  writeFileSync(join(DIR, `openrouter_modelos_${foto.capturado}.json`), `${JSON.stringify(foto, null, 2)}\n`);
  console.log('foto reescrita');
}
console.log(distintos === 0 ? 'Todo igual.' : `${distintos} modelo(s) con diferencias.`);
process.exit(distintos === 0 ? 0 : 1);
