import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CT-SEG-16: el respaldo con datos de TODAS las flotas no puede quedar en claro. Sin RESPALDO_AGE_RECIPIENT
// el script se rechaza ANTES de volcar nada. npx y age son falsos para no tocar Supabase.
function correr(env: Record<string, string>, conAge: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'respaldo-'));
  const bin = join(dir, 'bin');
  spawnSync('mkdir', ['-p', bin]);
  const marca = join(dir, 'npx-llamado');
  writeFileSync(join(bin, 'npx'), `#!/bin/sh\ntouch "${marca}"\nhead -c 5000 /dev/zero > "$6"\n`);
  chmodSync(join(bin, 'npx'), 0o755);
  if (conAge) {
    writeFileSync(join(bin, 'age'), '#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done\ntouch "$out"\n');
    chmodSync(join(bin, 'age'), 0o755);
  }
  const r = spawnSync('bash', ['scripts/respaldo.sh', join(dir, 'destino')], {
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: dir, ...env }, encoding: 'utf8',
  });
  return { ...r, npxLlamado: existsSync(marca), dir };
}

describe('scripts/respaldo.sh exige cifrado (CT-SEG-16)', () => {
  it('sin RESPALDO_AGE_RECIPIENT se rechaza y NO vuelca la base', () => {
    const r = correr({}, true);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('RESPALDO_AGE_RECIPIENT');
    expect(r.npxLlamado).toBe(false);
  });
  it('con la variable vacia tambien se rechaza', () => {
    const r = correr({ RESPALDO_AGE_RECIPIENT: '' }, true);
    expect(r.status).not.toBe(0);
    expect(r.npxLlamado).toBe(false);
  });
  it('con la variable pero sin age instalado se rechaza ANTES de volcar', () => {
    const r = correr({ RESPALDO_AGE_RECIPIENT: 'age1abc' }, false);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/age/);
    expect(r.npxLlamado).toBe(false);
  });
  it('con variable y age: respalda y deja SOLO el .age, nunca el .sql en claro', () => {
    const r = correr({ RESPALDO_AGE_RECIPIENT: 'age1abc' }, true);
    expect(r.status).toBe(0);
    const ls = spawnSync('ls', [join(r.dir, 'destino')], { encoding: 'utf8' }).stdout;
    expect(ls).toMatch(/\.sql\.age/);
    expect(ls).not.toMatch(/\.sql$/m);
  });
});
