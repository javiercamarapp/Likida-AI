import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CT-SEG-16: el respaldo con datos de TODAS las flotas no puede quedar en claro. Sin RESPALDO_AGE_RECIPIENT
// el script se rechaza ANTES de volcar nada. npx y age son falsos para no tocar Supabase.
function correr(env: Record<string, string>, conAge: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'respaldo-'));
  const bin = join(dir, 'bin');
  spawnSync('mkdir', ['-p', bin]);
  // El caso "sin age" necesita un PATH REAL que de verdad no tenga `age`. Antes se
  // pasaba `/usr/bin:/bin` tal cual y solo se omitia el `age` FALSO, asi que en una
  // maquina que SI trae age instalado (este contenedor lo trae en /usr/bin/age) el
  // `command -v age` de respaldo.sh:48 lo encontraba igual, el script pasaba el
  // guardarrail y la prueba fallaba sin que hubiera nada roto en el codigo.
  // Se arma un espejo del sistema SIN `age`: todo lo demas sigue disponible, para que
  // si alguien quita el guardarrail el script SI llegue a npx y la prueba lo cache.
  const sistema = join(dir, 'sistema');
  mkdirSync(sistema, { recursive: true });
  for (const d of ['/usr/bin', '/bin']) {
    let entradas: string[];
    try {
      entradas = readdirSync(d);
    } catch {
      continue;
    }
    for (const f of entradas) {
      if (f === 'age') continue;
      try {
        symlinkSync(join(d, f), join(sistema, f));
      } catch {
        // ya enlazado desde el otro directorio
      }
    }
  }
  const marca = join(dir, 'npx-llamado');
  writeFileSync(join(bin, 'npx'), `#!/bin/sh\ntouch "${marca}"\nhead -c 5000 /dev/zero > "$6"\n`);
  chmodSync(join(bin, 'npx'), 0o755);
  if (conAge) {
    writeFileSync(join(bin, 'age'), '#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done\ntouch "$out"\n');
    chmodSync(join(bin, 'age'), 0o755);
  }
  const r = spawnSync('bash', ['scripts/respaldo.sh', join(dir, 'destino')], {
    env: { PATH: `${bin}:${sistema}`, HOME: dir, ...env } as unknown as NodeJS.ProcessEnv, encoding: 'utf8',
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
