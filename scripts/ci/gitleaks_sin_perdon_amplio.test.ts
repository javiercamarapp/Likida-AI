import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// CT-SEG-24 (post-adversarial): la allowlist de gitleaks no puede perdonar una llave privada ni un patron amplio de pruebas;
// una llave real escondida en un `*.test.ts` nuevo debe seguir saltando.
const toml = readFileSync(join(process.cwd(), '.gitleaks.toml'), 'utf8');
const bloques = toml.split('[[allowlists]]').slice(1);

describe('CT-SEG-24 · .gitleaks.toml no perdona de mas', () => {
  it('ningun bloque de allowlist apunta a la regla private-key', () => {
    for (const b of bloques) expect(b).not.toMatch(/targetRules\s*=\s*\[[^\]]*private-key/);
  });
  it('ningun path de allowlist es un comodin sobre todas las pruebas', () => {
    expect(toml).not.toMatch(/\^src\/\.\*\\\.test/);
    expect(toml).not.toMatch(/\^supabase\/tests\/\.\*/);
  });
});
