/* eslint-disable security/detect-non-literal-fs-filename -- fixtures propias bajo mkdtemp */
import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// H7 — aplicar-ui-v2.sh debe comprobar que `tenant_ui` exista ANTES de respaldar o cambiar nada. Corre el script REAL con
// un `psql` falso (nunca toca una base): `tabla` decide qué contesta a `to_regclass`.

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const U = '11111111-1111-4111-8111-111111111111';
const LOCAL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function fixture(tabla: 't' | 'f') {
  const dir = mkdtempSync(join(tmpdir(), 'guardias-ui-')); dirs.push(dir);
  for (const sub of ['scripts/perfil', 'scripts/ui', 'bin', 'home']) mkdirSync(join(dir, sub), { recursive: true });
  for (const f of ['scripts/perfil/_comun-cinco-agentes.sh', 'scripts/ui/aplicar-ui-v2.sh']) {
    writeFileSync(join(dir, f), readFileSync(f)); chmodSync(join(dir, f), 0o755);
  }
  // psql falso: registra argumentos y stdin; a la consulta de existencia responde `tabla`, al resto `1`.
  writeFileSync(join(dir, 'bin/psql'), `#!/bin/bash
echo "$@" >> "${dir}/psql_llamado"
if [[ "$*" == *to_regclass* ]]; then echo ${tabla}; else echo 1; fi
`);
  chmodSync(join(dir, 'bin/psql'), 0o755);
  return dir;
}
const correr = (dir: string, args: string[]) =>
  spawnSync('bash', [join(dir, 'scripts/ui/aplicar-ui-v2.sh'), ...args], {
    cwd: dir, encoding: 'utf8', timeout: 15_000, input: '',
    env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, HOME: join(dir, 'home'), DATABASE_URL: LOCAL, SUPABASE_DB_URL: '' },
  });

describe('H7: aplicar-ui-v2.sh falla con un mensaje claro si la tabla tenant_ui no existe', () => {
  it.each([[['--verificar']], [[]], [['--revertir']]])('modo %j: exit 6, nombra la migración 0939 y no respalda ni cambia nada', (modo) => {
    const dir = fixture('f');
    const r = correr(dir, [...modo, U]);
    expect(r.status).toBe(6);
    expect(r.stderr).toContain('public.tenant_ui');
    expect(r.stderr).toContain('0939');
    expect(existsSync(join(dir, 'home/likida-respaldos'))).toBe(false);
    const llamadas = readFileSync(join(dir, 'psql_llamado'), 'utf8');
    expect(llamadas).not.toMatch(/insert into|delete from/i);
    expect(llamadas.trim().split('\n')).toHaveLength(1); // solo la comprobación de existencia
  });

  it('con la tabla presente la comprobación pasa y el script sigue (aquí hasta «la flota no existe»)', () => {
    const dir = fixture('t');
    const r = correr(dir, [U]);
    expect(r.stderr).not.toContain('public.tenant_ui');
    expect(r.status).not.toBe(6);
  });
});
