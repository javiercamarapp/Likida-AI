import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// A37-S03-01/02/03: deploy-vercel.sh con un `vercel` falso que registra las llamadas.
function montar(env: string, opciones: { vivo?: boolean; envPreview?: string; addFallaSegundaVez?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dv-'));
  mkdirSync(join(dir, 'scripts')); mkdirSync(join(dir, 'bin'));
  copyFileSync('scripts/deploy-vercel.sh', join(dir, 'scripts/deploy-vercel.sh'));
  writeFileSync(join(dir, '.env.local'), env);
  if (opciones.envPreview) writeFileSync(join(dir, '.env.preview'), opciones.envPreview);
  const log = join(dir, 'log.txt'); const store = join(dir, 'store.txt');
  writeFileSync(store, '');
  writeFileSync(join(dir, 'bin/vercel'), `#!/bin/bash
echo "$*" >> "${log}"
case "$1" in
  link) exit 0 ;;
  ls) ${opciones.vivo ? 'echo "dpl_1 Ready Production"' : 'true'}; exit 0 ;;
  env)
    case "$2" in
      ls) awk -v e="$3" '$2==e {print $1}' "${store}"; exit 0 ;;
      rm) grep -v "^$3 $4$" "${store}" > "${store}.t" || true; mv "${store}.t" "${store}"; exit 0 ;;
      add) v="$(cat)"; if grep -q "^$3 $4$" "${store}"; then exit 1; fi
           echo "$3 $4" >> "${store}"; echo "VALOR $3 $4 [$v]" >> "${log}"; exit 0 ;;
    esac ;;
esac
if [ "$1" = "--prod" ]; then echo "https://likida-x.vercel.app"; exit 0; fi
`);
  chmodSync(join(dir, 'bin/vercel'), 0o755);
  const r = spawnSync('bash', [join(dir, 'scripts/deploy-vercel.sh')], {
    encoding: 'utf8', env: { PATH: `${join(dir, 'bin')}:${process.env.PATH}`, HOME: dir },
  });
  return { r, log: existsSync(log) ? readFileSync(log, 'utf8') : '' };
}

describe('deploy-vercel.sh', () => {
  it('A37-S03-01: un secreto con # no se trunca; comillas y comentario inline se respetan', () => {
    const { r, log } = montar('SUPABASE_DB_URL=postgres://u:pa#ss@h/db\nA="con # dentro" # comentario\nB=plano # comentario\n');
    expect(r.status).toBe(0);
    expect(log).toContain('VALOR SUPABASE_DB_URL production [postgres://u:pa#ss@h/db]');
    expect(log).toContain('VALOR A production [con # dentro]');
    expect(log).toContain('VALOR B production [plano]');
  });
  it('A37-S03-02: nada de producción va a preview sin .env.preview; con él, solo ese archivo', () => {
    const a = montar('SECRETO=prod\n');
    expect(a.log).not.toMatch(/^VALOR SECRETO preview/m);
    const b = montar('SECRETO=prod\n', { envPreview: 'SECRETO=staging\n' });
    expect(b.log).toContain('VALOR SECRETO preview [staging]');
    expect(b.log).not.toContain('VALOR SECRETO preview [prod]');
  });
  it('A37-S03-02: sobre un proyecto con deployments aborta antes de empujar nada', () => {
    const { r, log } = montar('X=1\n', { vivo: true });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('solo para entornos nuevos');
    expect(log).not.toContain('env add');
    expect(log).not.toContain('--prod');
  });
  it('A37-S03-03: NEXT_PUBLIC_APP_URL se fija ANTES del deploy a producción', () => {
    const { log } = montar('X=1\n');
    const i = log.indexOf('VALOR NEXT_PUBLIC_APP_URL production [https://app.likida.ai]');
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(log.indexOf('--prod'));
  });
});

describe('encender-emision-vercel.sh (A37-S03-04)', () => {
  const correr = (confirmo?: string) => spawnSync('bash', ['scripts/encender-emision-vercel.sh'], {
    encoding: 'utf8', env: { PATH: '/usr/bin:/bin', ...(confirmo ? { CONFIRMO_EMISION_REAL: confirmo } : {}) },
  });
  it('sin confirmación escrita no toca nada (exit 1, ni siquiera llama a vercel)', () => {
    const r = correr();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('TODAS las flotas');
  });
  it('una confirmación distinta tampoco sirve', () => {
    expect(correr('si').status).toBe(1);
  });
  it('agrega antes de borrar', () => {
    const t = readFileSync('scripts/encender-emision-vercel.sh', 'utf8');
    expect(t.indexOf('env add')).toBeLessThan(t.indexOf('env rm'));
  });
});
