// A37-S02-01: la lista de tablas con acceso directo revocado para anon/authenticated sale de las
// migraciones (`revoke all on [table] public.X`), no de memoria. Una tabla deja de estar restringida si
// una migración POSTERIOR le vuelve a otorgar algo a anon/authenticated. Lo usan la prueba de deriva y,
// al regenerar, la lista de grants-locales.sql:  node scripts/ci/e2e/restringidas-desde-migraciones.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const REVOKE = /revoke\s+all(?:\s+privileges)?\s+on\s+(?:table\s+)?public\.("?)([a-z0-9_]+)\1\s+from\s+[^;]*;/gi;
const GRANT = /grant\s+[^;]*?\s+on\s+(?:table\s+)?public\.("?)([a-z0-9_]+)\1\s+to\s+([^;]*);/gi;

export function restringidasDesdeMigraciones(dir = 'supabase/migrations') {
  const estado = new Map();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    const texto = readFileSync(`${dir}/${f}`, 'utf8').replace(/--[^\n]*/g, '');
    const eventos = [];
    for (const m of texto.matchAll(REVOKE)) eventos.push([m.index, 'revoca', m[2].toLowerCase(), m[0]]);
    for (const m of texto.matchAll(GRANT)) {
      if (/\b(anon|authenticated|public)\b/i.test(m[3])) eventos.push([m.index, 'otorga', m[2].toLowerCase(), m[0]]);
    }
    for (const [, tipo, tabla, frase] of eventos.sort((a, b) => a[0] - b[0])) {
      if (tipo === 'revoca' && /\b(anon|authenticated|public)\b/i.test(frase)) estado.set(tabla, true);
      else if (tipo === 'otorga') estado.set(tabla, false);
    }
  }
  return [...estado].filter(([, r]) => r).map(([t]) => t).sort();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  console.log(restringidasDesdeMigraciones().map((t) => `'${t}'`).join(', '));
}
