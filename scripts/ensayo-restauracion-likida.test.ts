/* eslint-disable security/detect-non-literal-fs-filename -- fixtures propias bajo mkdtemp; nunca toca una base real */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = 'scripts/ensayo-restauracion-likida.sh';
const DOC = 'docs/operacion/ensayo-restauracion.md';
const PROD = 'gngoqsvrxdguxvsizpbw';
const texto = readFileSync(SCRIPT, 'utf8');
const doc = readFileSync(DOC, 'utf8');
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'ensayo-rest-')); dirs.push(d); return d; };
// Entorno sin PATH de supabase/age: si algo llegara a la red fallaría por comando inexistente.
const correr = (env: Record<string, string>) =>
  spawnSync('bash', [SCRIPT], { encoding: 'utf8', timeout: 15_000, env: { PATH: '/usr/bin:/bin', HOME: tmp(), ...env } as unknown as NodeJS.ProcessEnv });
const REF_OK = 'abcdefghij0123456789';

describe('salvaguardas', () => {
  it('sintaxis valida (bash -n)', () => {
    const r = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
  });
  it('aborta sin REF_DESECHABLE', () => {
    const r = correr({});
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/REF_DESECHABLE/);
  });
  it('aborta si el REF es produccion, aun con confirmacion', () => {
    const r = correr({ REF_DESECHABLE: PROD, CONFIRMO_DESECHABLE: 'SI' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/PRODUCCION/);
  });
  it('aborta sin la confirmacion explicita', () => {
    for (const v of [{} as Record<string, string>, { CONFIRMO_DESECHABLE: 'si' }, { CONFIRMO_DESECHABLE: 'YES' }]) {
      const r = correr({ REF_DESECHABLE: REF_OK, ...v });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/CONFIRMO_DESECHABLE=SI/);
    }
  });
  it('aborta si el ref no tiene forma de ref', () => {
    const r = correr({ REF_DESECHABLE: 'corto', CONFIRMO_DESECHABLE: 'SI' });
    expect(r.status).toBe(1);
  });
  it('aborta sin identidad de age', () => {
    const r = correr({ REF_DESECHABLE: REF_OK, CONFIRMO_DESECHABLE: 'SI' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/RESPALDO_AGE_IDENTITY/);
  });
  it('las salvaguardas corren antes de cualquier llamada al CLI', () => {
    const iguardas = texto.indexOf('CONFIRMO_DESECHABLE:-}" = "SI"');
    expect(iguardas).toBeGreaterThan(0);
    expect(texto.indexOf('supabase link --project-ref')).toBeGreaterThan(iguardas);
    expect(texto.indexOf('supabase db query --linked --workdir')).toBeGreaterThan(iguardas);
  });
});

describe('higiene', () => {
  it('sin set -x, sin secretos y sin imprimir claves', () => {
    expect(texto).not.toMatch(/^\s*set\s+-[a-z]*x/m);
    expect(texto).not.toMatch(/xtrace/);
    expect(texto).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}|sbp_[a-z0-9]{10,}|AGE-SECRET-KEY|service_role_key|postgres(ql)?:\/\/[^\s'"]*:[^\s'"@]+@/i);
    expect(texto).not.toMatch(/--db-password|PGPASSWORD|SUPABASE_DB_PASSWORD/);
    expect(texto).toMatch(/^set -u$/m);
  });
  it('produccion solo se lee con SELECT/WITH', () => {
    expect(texto).toMatch(/sql_prod\(\)/);
    expect(texto).toMatch(/SQL de produccion no empieza con SELECT/);
    expect(texto).not.toMatch(/cli_sql "\$DIR_PROD"[^\n]*-f "\$W\/(mig|vaciar|revocar)/);
  });
});

describe('ayudante embebido', () => {
  const py = spawnSync('python3', ['--version']).status === 0;
  const preparar = () => {
    const d = tmp();
    const r = spawnSync('bash', [SCRIPT, '--solo-ayudante', join(d, 'ay.py')], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(d, 'ay.py'))).toBe(true);
    return d;
  };
  it.skipIf(!py)('trocea respetando comillas, ; y parentesis, cuenta filas e inyecta OVERRIDING', () => {
    const d = preparar();
    writeFileSync(join(d, 'v.sql'), [
      'SET statement_timeout = 0;',
      '-- Data for Name: a',
      `INSERT INTO "public"."a" ("id", "t") VALUES (1, 'x;y'), (2, 'it''s (a)\nINSERT INTO "public"."z" VALUES (9);'), (3, E'b\\\\'';(');`,
      'INSERT INTO "public"."b" ("id") OVERRIDING SYSTEM VALUE VALUES (1);',
      `SELECT pg_catalog.setval('"public"."a_id_seq"', 3, true);`, '',
    ].join('\n'));
    const r = spawnSync('python3', ['-I', join(d, 'ay.py'), 'split', join(d, 'v.sql'), join(d, 'out'), '900000'], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(d, 'out/huellas.json'), 'utf8'))).toEqual({ 'public.a': 3, 'public.b': 1 });
    const trozo = readFileSync(join(d, 'out/trozo-00001.sql'), 'utf8');
    expect(trozo.startsWith('set session_replication_role = replica;')).toBe(true);
    expect(trozo).toContain('("id", "t") OVERRIDING SYSTEM VALUE VALUES (1');
    expect(trozo.match(/OVERRIDING SYSTEM VALUE/g)).toHaveLength(2);
    expect(trozo).not.toContain('statement_timeout');
    expect(JSON.parse(readFileSync(join(d, 'out/info.json'), 'utf8')).sin_cerrar).toBe(false);
  });
  it.skipIf(!py)('cmp-mig: destino = repo y contenido en prod; falla si sobra una', () => {
    const d = preparar();
    spawnSync('mkdir', ['-p', join(d, 'm')]);
    for (const f of ['0001_a.sql', '0002_b.sql', 'NUMERACION-SALTADA.md']) writeFileSync(join(d, 'm', f), '--');
    writeFileSync(join(d, 'dest.tsv'), '0001\n0002\n');
    writeFileSync(join(d, 'prod.tsv'), '0001\ta\n20260907040758\t0002_b\n0351b\t0351b_x\n');
    const ok = spawnSync('python3', ['-I', join(d, 'ay.py'), 'cmp-mig', join(d, 'm'), join(d, 'dest.tsv'), join(d, 'prod.tsv')], { encoding: 'utf8' });
    expect(ok.status, ok.stdout).toBe(0);
    expect(ok.stdout).toMatch(/en prod sin archivo en repo: 0351b/);
    writeFileSync(join(d, 'prod.tsv'), '0001\ta\n');
    const mal = spawnSync('python3', ['-I', join(d, 'ay.py'), 'cmp-mig', join(d, 'm'), join(d, 'dest.tsv'), join(d, 'prod.tsv')], { encoding: 'utf8' });
    expect(mal.status).toBe(1);
  });
});

describe('documento', () => {
  it('referencia scripts y archivos que existen', () => {
    for (const ruta of ['scripts/ensayo-restauracion-likida.sh', 'scripts/respaldo.sh', 'scripts/respaldo-storage.sh', 'scripts/restore-storage-drill.sh', 'docs/operacion/restauracion-guion-y-acta.md', 'docs/operacion/RESILIENCIA-DEPLOY.md', 'docs/conocimiento/DEPLOY.md', 'supabase/APLICAR-EN-PRODUCCION.md']) {
      expect(doc, ruta).toContain(ruta.replace(/^docs\/operacion\//, ''));
      expect(existsSync(ruta), ruta).toBe(true);
    }
  });
  it('las variables que el doc manda definir las lee el script', () => {
    for (const v of ['REF_DESECHABLE', 'CONFIRMO_DESECHABLE', 'RESPALDO_AGE_IDENTITY', 'STORAGE_BACKUP']) {
      expect(doc).toContain(v);
      expect(texto).toContain(v);
    }
    expect(doc).toContain('supabase projects delete <REF> --yes');
    expect(doc).toContain('--region us-east-2');
    expect(doc).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
  it('las banderas de supabase projects create existen (si el CLI esta instalado)', () => {
    const r = spawnSync('supabase', ['projects', 'create', '--help'], { encoding: 'utf8' });
    if (r.status !== 0) return;
    for (const f of ['--org-id', '--region', '--size', '--db-password']) expect(r.stdout + r.stderr).toContain(f);
  });
  it('el runbook enterprise apunta al procedimiento sin afirmar que se hizo', () => {
    const rb = readFileSync('docs/operacion/runbook-enterprise.md', 'utf8');
    expect(rb).toContain('ensayo-restauracion.md');
    expect(rb).toMatch(/preparado,\s+pendiente de correr por el dueño/);
  });
});
