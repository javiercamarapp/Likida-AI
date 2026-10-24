import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A37-S04-01: el respaldo de Storage jamás debe escribir dentro del repo
// público (CFDI y comprobantes de todas las flotas). Sin red: el rechazo ocurre
// antes de cualquier llamada.
const RAIZ = process.cwd();
const correr = (destino: string) => spawnSync('bash', ['scripts/respaldo-storage.sh', destino], {
  cwd: RAIZ, encoding: 'utf8',
  env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'x' } as unknown as NodeJS.ProcessEnv,
});

describe('A37-S04-01 · respaldo-storage.sh no escribe dentro del repo', () => {
  it('un destino dentro del repo (absoluto, relativo o con ..) sale con 2 y no crea nada', () => {
    for (const d of [join(RAIZ, '.backups-prueba/a'), '.backups-prueba/b', 'scripts/../.backups-prueba/c']) {
      const r = correr(d);
      expect(r.status, d).toBe(2);
      expect(r.stderr).toContain('dentro del repo');
    }
    expect(existsSync(join(RAIZ, '.backups-prueba'))).toBe(false);
  });

  it('el destino por omisión ya no es ./.backups y .backups/ está en .gitignore', () => {
    expect(readFileSync(join(RAIZ, 'scripts/respaldo-storage.sh'), 'utf8')).not.toMatch(/:-\.\/\.backups/);
    expect(readFileSync(join(RAIZ, '.gitignore'), 'utf8')).toMatch(/^\.backups\/$/m);
  });

  it('un destino fuera del repo NO se rechaza por esta guarda (falla después, por la red)', () => {
    const fuera = mkdtempSync(join(tmpdir(), 'resp-ok-'));
    const r = correr(fuera);
    expect(r.stderr).not.toContain('dentro del repo');
  });
});

describe('A37-S04-02 · respaldo.sh no deja el dump en carpetas de iCloud ni con permisos abiertos', () => {
  const sh = readFileSync(join(RAIZ, 'scripts/respaldo.sh'), 'utf8');
  it('destino por omisión fuera de Desktop, umask 077, chmod 700 y CLI fijado', () => {
    expect(sh).not.toMatch(/DESTINO="\$\{1:-\$HOME\/Desktop/);
    expect(sh).toContain('umask 077');
    expect(sh).toContain('chmod 700 "$DESTINO"');
    expect(sh).toMatch(/supabase@\$\{SUPABASE_CLI_VERSION\}/);
  });
  it('rechaza (exit 2) un destino en el Escritorio sin ejecutar el CLI', () => {
    const r = spawnSync('bash', ['scripts/respaldo.sh', join(process.env.HOME ?? '/x', 'Desktop/likida-prueba')], { cwd: RAIZ, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } as unknown as NodeJS.ProcessEnv });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('iCloud');
  });
});
