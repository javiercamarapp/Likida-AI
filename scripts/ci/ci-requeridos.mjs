#!/usr/bin/env node
// A36-R07-03 (auditoría 36, MEDIO). La ruta manual de release
// (`deploy-preview-promote.yml`) repite calidad (typecheck, lint, cobertura,
// build) pero NO `Migraciones + aislamiento (Postgres efímero)` (ci-postgres.yml)
// ni `E2E navegador` (e2e-navegador.yml), y aplica migraciones reales a
// producción ANTES de promover. Este paso exige, ANTES de migrar, que esos dos
// checks hayan terminado en `success` para el SHA exacto que se va a publicar.
// Falla cerrado: sin check, en curso agotado, o rojo => no se migra.
// Solo LEE la API de GitHub con el GITHUB_TOKEN del job (checks: read).

/** Nombres EXACTOS de los jobs (campo `name:` en cada workflow). */
export const CHECKS_REQUERIDOS = [
  'Migraciones + aislamiento (Postgres efímero)',
  'Pila local + Playwright contra el producto',
];

/**
 * Veredicto puro. Por cada nombre toma la corrida MÁS RECIENTE (un re-run
 * verde sustituye a uno rojo anterior) y la clasifica.
 *
 * @param {{check_runs?: {name: string, status: string, conclusion: string|null, started_at?: string|null, id?: number}[]}} payload
 * @param {string[]} requeridos
 * @returns {{estado: 'ok'|'pendiente'|'falla', detalle: string[]}}
 */
export function evaluarChecks(payload, requeridos = CHECKS_REQUERIDOS) {
  const corridas = Array.isArray(payload?.check_runs) ? payload.check_runs : [];
  const detalle = [];
  let pendiente = false;
  let falla = false;
  for (const nombre of requeridos) {
    const propias = corridas
      .filter((c) => c?.name === nombre)
      .sort((a, b) => (Date.parse(b.started_at ?? '') || 0) - (Date.parse(a.started_at ?? '') || 0) || (b.id ?? 0) - (a.id ?? 0));
    const ultima = propias[0];
    if (!ultima) { detalle.push(`${nombre}: sin corrida para este SHA`); falla = true; continue; }
    if (ultima.status !== 'completed') { detalle.push(`${nombre}: en curso (${ultima.status})`); pendiente = true; continue; }
    if (ultima.conclusion !== 'success') { detalle.push(`${nombre}: ${ultima.conclusion}`); falla = true; continue; }
    detalle.push(`${nombre}: success`);
  }
  return { estado: falla ? 'falla' : pendiente ? 'pendiente' : 'ok', detalle };
}

/** Consulta hasta que no haya pendientes o se agote el tiempo. */
export async function esperarChecks({ repo, sha, token }, deps = {}) {
  const buscar = deps.fetch ?? fetch;
  const dormir = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const intentos = deps.intentos ?? 30;
  const pausaMs = deps.pausaMs ?? 30_000;
  if (!/^[A-Za-z0-9_-][\w.-]*\/[\w.-]+$/.test(repo ?? '')) throw new Error('GITHUB_REPOSITORY inválido');
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error('SHA inválido');
  let ultimo = { estado: 'pendiente', detalle: [] };
  for (let i = 0; i < intentos; i += 1) {
    const r = await buscar(`https://api.github.com/repos/${repo}/commits/${sha}/check-runs?per_page=100&filter=latest`, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!r.ok) throw new Error(`Consulta de checks rechazada (HTTP ${r.status})`);
    ultimo = evaluarChecks(await r.json());
    if (ultimo.estado !== 'pendiente') break;
    if (i < intentos - 1) await dormir(pausaMs);
  }
  return ultimo;
}

if (process.argv[1] && process.argv[1].endsWith('ci-requeridos.mjs')) {
  const sha = process.argv[2];
  esperarChecks({ repo: process.env.GITHUB_REPOSITORY, sha, token: process.env.GITHUB_TOKEN })
    .then((r) => {
      for (const linea of r.detalle) console.log(`- ${linea}`);
      if (r.estado !== 'ok') {
        console.error(`::error::CI requerido no está verde para ${sha}; no se migra producción (${r.estado}).`);
        process.exit(1);
      }
    })
    .catch((e) => { console.error(`::error::${e.message}`); process.exit(1); });
}
