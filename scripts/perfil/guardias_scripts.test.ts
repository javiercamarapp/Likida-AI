/* eslint-disable security/detect-non-literal-fs-filename -- fixtures propias bajo mkdtemp */
import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// A37-S04-04..10 — guardas de los scripts de operación. Corren los scripts REALES con un `psql` falso:
// nunca tocan una base.

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'guardias-')); dirs.push(dir);
  for (const sub of ['scripts/perfil', 'scripts/ci', 'supabase/migrations', 'bin']) mkdirSync(join(dir, sub), { recursive: true });
  for (const f of ['scripts/seed.sh', 'scripts/perfil/_comun-cinco-agentes.sh', 'scripts/perfil/verificar-cinco-agentes.sh']) {
    writeFileSync(join(dir, f), readFileSync(f)); chmodSync(join(dir, f), 0o755);
  }
  // psql falso: registra que lo llamaron y responde lo mínimo.
  writeFileSync(join(dir, 'bin/psql'), `#!/bin/bash\necho "$@" >> "${dir}/psql_llamado"\necho 1\n`);
  chmodSync(join(dir, 'bin/psql'), 0o755);
  return dir;
}
const correr = (dir: string, script: string, args: string[], env: Record<string, string>) =>
  spawnSync('bash', [join(dir, script), ...args], {
    cwd: dir, encoding: 'utf8', timeout: 15_000, input: '',
    env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, SUPABASE_DB_URL: '', DATABASE_URL: '', ...env },
  });

describe('A37-S04-09: seed.sh no imprime la contraseña de la base', () => {
  it('el rechazo de una base gestionada de Supabase NO repite la URL con credenciales', () => {
    const dir = fixture();
    const r = correr(dir, 'scripts/seed.sh', [], { DATABASE_URL: 'postgresql://postgres:SECRETO-XYZ@db.abcd.supabase.co:5432/postgres' });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('REHUSADO');
    expect(r.stdout + r.stderr).not.toContain('SECRETO-XYZ');
  });
});

describe('A37-S04-08: seed.sh rechaza host=/hostaddr=/service= escondido en la query', () => {
  it.each(['?host=db.abcd.supabase.co', '?hostaddr=10.0.0.5', '?service=prod', '?sslmode=require&HOST=db.abcd.supabase.co'])(
    'localhost/db%s se rechaza (exit 4) sin llegar a psql', (query) => {
      const dir = fixture();
      const r = correr(dir, 'scripts/seed.sh', [], { DATABASE_URL: `postgresql://u:SECRETO-XYZ@localhost:5432/db${query}` });
      expect(r.status).toBe(4);
      expect(r.stdout + r.stderr).not.toContain('SECRETO-XYZ');
      expect(() => readFileSync(join(dir, 'psql_llamado'))).toThrow();
    });
});

describe('A37-S04-08: la guardia de «base local» no se fía solo del nombre del host', () => {
  const U = '11111111-1111-4111-8111-111111111111';
  it('verificar: localhost en un puerto que no es el de la pila local (túnel ssh -L) exige --produccion', () => {
    const dir = fixture();
    const r = correr(dir, 'scripts/perfil/verificar-cinco-agentes.sh', [U], { DATABASE_URL: 'postgresql://u:p@localhost:5432/postgres' });
    expect(r.status).toBe(4);
    expect(r.stderr).toMatch(/no es local/);
  });
  it('verificar: la pila local (127.0.0.1:54322) sigue pasando la guardia', () => {
    const dir = fixture();
    const r = correr(dir, 'scripts/perfil/verificar-cinco-agentes.sh', [U], { DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
    expect(r.stderr).not.toMatch(/no es local/);
    expect(r.stdout).toContain('Base: 127.0.0.1');
  });
  it('un puerto adicional se declara a propósito con PERFIL_PUERTOS_LOCALES', () => {
    const dir = fixture();
    const r = correr(dir, 'scripts/perfil/verificar-cinco-agentes.sh', [U], {
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/postgres', PERFIL_PUERTOS_LOCALES: '54322 5433',
    });
    expect(r.stderr).not.toMatch(/no es local/);
  });
});

// A37-S04-05 — «VERIFICACIÓN OK» salía aunque una ruta restringida respondiera 200: el resultado de las rutas
// por curl solo se imprimía, nunca se contaba en FALLAS.
describe('A37-S04-05: verificar-cinco-agentes.sh afirma algo sobre las rutas por curl', () => {
  const U = '11111111-1111-4111-8111-111111111111';
  function conServidor(codigoPorRuta: (ruta: string) => { codigo: number; ubicacion?: string }) {
    const dir = fixture();
    // psql falso con las respuestas que el script lee: existe la flota (1) y hechos «con perfil» (1 2).
    writeFileSync(join(dir, 'bin/psql'), `#!/bin/bash
cat >/dev/null
case "$*" in
  *-F*) echo "1 2" ;;
  *) echo 1 ;;
esac
`);
    // curl falso: el script pide «%{http_code} %{redirect_url}» por ruta.
    writeFileSync(join(dir, 'bin/curl'), `#!/bin/bash
for a in "$@"; do ruta="$a"; done
case "$ruta" in
${['liquidacion', 'peajes', 'carta-porte'].map((r) => `  */dashboard/agentes/${r}) echo "$(cat "${dir}/curl_${r}" )" ;;`).join('\n')}
  */dashboard/reglas) echo "$(cat "${dir}/curl_reglas")" ;;
  */dashboard/rentabilidad) echo "$(cat "${dir}/curl_rentabilidad")" ;;
esac
`);
    chmodSync(join(dir, 'bin/curl'), 0o755);
    for (const r of ['liquidacion', 'peajes', 'carta-porte', 'reglas', 'rentabilidad']) {
      const { codigo, ubicacion } = codigoPorRuta(r);
      writeFileSync(join(dir, `curl_${r}`), `${codigo} ${ubicacion ?? ''}`);
    }
    return dir;
  }
  const env = { DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' };

  it('todas las rutas redirigen a /dashboard (o 403): OK', () => {
    const dir = conServidor((r) => (r === 'reglas' ? { codigo: 403 } : { codigo: 307, ubicacion: 'https://app.example.test/dashboard' }));
    const r = correr(dir, 'scripts/perfil/verificar-cinco-agentes.sh', ['--base-url', 'https://app.example.test', '--cookie', 'sb=1', U], env);
    expect(r.stdout).toContain('VERIFICACIÓN OK');
    expect(r.status).toBe(0);
  });

  it('una ruta restringida que responde 200 a un usuario del perfil FALLA la verificación', () => {
    const dir = conServidor((r) => (r === 'peajes' ? { codigo: 200 } : { codigo: 307, ubicacion: 'https://app.example.test/dashboard' }));
    const r = correr(dir, 'scripts/perfil/verificar-cinco-agentes.sh', ['--base-url', 'https://app.example.test', '--cookie', 'sb=1', U], env);
    expect(r.stdout).toContain('VERIFICACIÓN FALLÓ');
    expect(r.status).toBe(1);
  });

  it('un curl fallido («error») también cuenta como falla, no como silencio', () => {
    const dir = conServidor(() => ({ codigo: 307, ubicacion: 'https://app.example.test/dashboard' }));
    writeFileSync(join(dir, 'curl_reglas'), 'error');
    const r = correr(dir, 'scripts/perfil/verificar-cinco-agentes.sh', ['--base-url', 'https://app.example.test', '--cookie', 'sb=1', U], env);
    expect(r.status).toBe(1);
  });

  it('--base-url sin --cookie sale con 2: no prueba nada y no puede decir OK', () => {
    const dir = conServidor(() => ({ codigo: 307, ubicacion: 'https://x.test/login' }));
    const r = correr(dir, 'scripts/perfil/verificar-cinco-agentes.sh', ['--base-url', 'https://app.example.test', U], env);
    expect(r.status).toBe(2);
    expect(r.stdout).not.toContain('VERIFICACIÓN OK');
  });
});

// A37-S04-10 — una variable de repo RESPALDO_BUCKETS vieja sustituía en silencio la lista única: buzon-facturas y
// cartaporte-docs quedaban fuera del respaldo y ninguna prueba fallaba.
describe('A37-S04-10: respaldo-storage.sh no acepta una lista de buckets que omita alguno de la lista única', () => {
  function respaldo(buckets: string | undefined, extra: Record<string, string> = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'respaldo-')); dirs.push(dir);
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    writeFileSync(join(dir, 'scripts/respaldo-storage.sh'), readFileSync('scripts/respaldo-storage.sh'));
    writeFileSync(join(dir, 'scripts/respaldo-buckets.txt'), 'comprobantes\nliquidaciones\nbuzon-facturas # evidencia\ncartaporte-docs\n');
    const env = {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'k', RESPALDO_BUCKETS: buckets ?? '', ...extra,
    };
    return spawnSync('bash', [join(dir, 'scripts/respaldo-storage.sh'), join(dir, 'salida')], { cwd: dir, encoding: 'utf8', timeout: 15_000, env });
  }
  it('la variable vieja (sin buzon-facturas ni cartaporte-docs) hace FALLAR el respaldo y nombra lo omitido', () => {
    const r = respaldo('comprobantes liquidaciones');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('buzon-facturas');
    expect(r.stderr).toContain('cartaporte-docs');
  });
  it('una lista que incluye todos (en otro orden o con extras) no se rechaza por esto', () => {
    const r = respaldo('cartaporte-docs buzon-facturas liquidaciones comprobantes extra');
    expect(r.stderr).not.toMatch(/omite|RESPALDO_BUCKETS/);
  });
  it('un respaldo parcial a propósito se declara con RESPALDO_PERMITIR_PARCIAL=true', () => {
    const r = respaldo('comprobantes', { RESPALDO_PERMITIR_PARCIAL: 'true' });
    expect(r.stderr).not.toMatch(/omite/);
  });
  it('sin variable usa la lista única completa (camino normal)', () => {
    const r = respaldo(undefined);
    expect(r.stderr).not.toMatch(/omite/);
  });
});
