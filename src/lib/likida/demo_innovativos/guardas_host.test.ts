/* eslint-disable security/detect-non-literal-fs-filename -- solo pruebas: scripts del propio repo por rutas armadas sobre constantes de este archivo. */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LA GUARDA CONTRA PRODUCCIÓN: una prueba por cada forma de saltársela.
// Un host que no es loopback se rechaza ANTES de abrir ninguna conexión; las redes privadas (10/8, 172.16/12,
// 192.168/16) solo con la bandera explícita DEMO_PERMITIR_RED_PRIVADA=1 (una base de producción detrás de una
// VPN o de un pooler suele tener justo esas direcciones).
// ═══════════════════════════════════════════════════════════════════════════

const DIR = fileURLToPath(new URL('../../../../scripts/demo/innovativos/', import.meta.url));
const GUARDA = `${DIR}guarda-host.mjs`;

function guarda(url: string | undefined, env: Record<string, string> = {}) {
  const e: Record<string, string> = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env };
  if (url !== undefined) e.DEMO_DATABASE_URL = url;
  return spawnSync('node', [GUARDA], { env: e as unknown as NodeJS.ProcessEnv, encoding: 'utf8' });
}

describe('guarda-host.mjs: lo local pasa', () => {
  it.each([
    'postgresql:///likida_demo',
    'postgresql://localhost/likida_demo',
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    'postgresql://u:p@127.5.5.5/db',
    'postgresql://u:p@[::1]:5432/db',
    'postgres://LOCALHOST/db',
    'postgresql://%2Fvar%2Frun%2Fpostgresql/db',
    'postgresql://host.docker.internal:5432/db',
    'host=localhost dbname=likida_demo',
    "host='/tmp' dbname=likida_demo",
    'dbname=likida_demo',
  ])('acepta %s', (url) => {
    const r = guarda(url);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });
});

describe('guarda-host.mjs: cada bypass se rechaza (código 3, «RECHAZADO»)', () => {
  const MALAS: Array<[string, string]> = [
    ['?host= sobre una URL sin host', 'postgresql:///db?host=prod.ejemplo.mx'],
    ['?host= aunque el host sea localhost', 'postgresql://localhost/db?host=prod.ejemplo.mx'],
    ['?host= apuntando a una IP', 'postgresql://127.0.0.1/db?host=8.8.8.8'],
    ['?host= aunque parezca local (se rechaza cualquier ?host=)', 'postgresql:///db?host=localhost'],
    ['?hostaddr= (salta el DNS)', 'postgresql://localhost/db?hostaddr=8.8.8.8'],
    ['?service= (el archivo de servicios puede traer otro host)', 'postgresql:///db?service=produccion'],
    ['usuario que parece host: 127.0.0.1@remoto', 'postgresql://127.0.0.1@prod.ejemplo.mx/db'],
    ['usuario:clave que parece local', 'postgresql://localhost:x@prod.ejemplo.mx/db'],
    ['subdominio de localhost', 'postgresql://localhost.evil.com/db'],
    ['127.0.0.1 como subdominio (nip.io)', 'postgresql://127.0.0.1.nip.io/db'],
    ['IP en decimal', 'postgresql://2130706433/db'],
    ['IP en hexadecimal', 'postgresql://0x7f.0.0.1/db'],
    ['IP abreviada', 'postgresql://127.1/db'],
    ['IPv4 con ceros a la izquierda', 'postgresql://010.0.0.1/db'],
    ['IPv6 mapeado a IPv4 público', 'postgresql://[::ffff:8.8.8.8]/db'],
    ['IPv6 mapeado a loopback (no es ::1)', 'postgresql://[::ffff:127.0.0.1]/db'],
    ['varios hosts separados por coma', 'postgresql://localhost,prod.ejemplo.mx/db'],
    ['IP pública', 'postgresql://u:p@8.8.8.8:5432/db'],
    ['172.15.x (NO es red privada)', 'postgresql://u:p@172.15.0.1/db'],
    ['172.32.x (NO es red privada)', 'postgresql://u:p@172.32.0.1/db'],
    ['link-local', 'postgresql://u:p@169.254.169.254/db'],
    ['CGNAT / Tailscale', 'postgresql://u:p@100.64.1.1/db'],
    ['«localhost.» con punto final', 'postgresql://localhost./db'],
    ['conninfo con host remoto', 'host=prod.ejemplo.mx dbname=x'],
    ['conninfo con hostaddr remoto', 'host=localhost hostaddr=8.8.8.8 dbname=x'],
    ['conninfo con service', 'service=produccion'],
    ['conninfo con host entrecomillado remoto', "host='prod.ejemplo.mx' dbname=x"],
    ['Supabase', 'postgresql://postgres:x@db.abcdefgh.supabase.co:5432/postgres'],
    ['pooler de Supabase', 'postgresql://postgres.abcd:x@aws-0-us-east-1.pooler.supabase.com:6543/postgres'],
    ['Neon', 'postgresql://u:p@ep-cool.neon.tech/db'],
    ['nombre de base «produccion» aunque el host sea local (túnel)', 'postgresql://localhost/produccion'],
    ['esquema distinto', 'mysql://localhost/db'],
    ['basura', 'esto no es una url'],
  ];
  it.each(MALAS)('rechaza: %s', (_n, url) => {
    const r = guarda(url);
    expect(r.status, `${url} → ${r.stdout}${r.stderr}`).toBe(3);
    expect(r.stderr).toContain('RECHAZADO');
  });

  it('PGHOST remoto con una URL sin host (libpq lo usaría)', () => {
    const r = guarda('postgresql:///db', { PGHOST: 'prod.ejemplo.mx' });
    expect(r.status).toBe(3);
    expect(r.stderr).toContain('PGHOST');
  });
  it('PGHOSTADDR remoto', () => {
    expect(guarda('postgresql:///db', { PGHOSTADDR: '8.8.8.8' }).status).toBe(3);
  });
  it('PGSERVICE (el archivo de servicios puede traer otro host)', () => {
    expect(guarda('postgresql:///db', { PGSERVICE: 'produccion' }).status).toBe(3);
  });
  it('PGHOST local sí pasa', () => {
    expect(guarda('postgresql:///db', { PGHOST: '/tmp' }).status).toBe(0);
    expect(guarda('postgresql:///db', { PGHOST: 'localhost' }).status).toBe(0);
  });
  it('DEMO_DATABASE_URL vacía: código 2, no adivina', () => {
    expect(guarda('').status).toBe(2);
  });
  it('sin DEMO_DATABASE_URL: código 2, no adivina', () => {
    const r = guarda(undefined);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('DEMO_DATABASE_URL');
  });
});

describe('guarda-host.mjs: las redes privadas solo con DEMO_PERMITIR_RED_PRIVADA=1', () => {
  const PRIVADAS = ['10.0.0.5', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.1.20'];
  it.each(PRIVADAS)('%s se rechaza sin la bandera y el mensaje la nombra', (ip) => {
    const r = guarda(`postgresql://u:p@${ip}:5432/db`);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain('DEMO_PERMITIR_RED_PRIVADA=1');
  });
  it.each(PRIVADAS)('%s pasa con la bandera', (ip) => {
    expect(guarda(`postgresql://u:p@${ip}:5432/db`, { DEMO_PERMITIR_RED_PRIVADA: '1' }).status).toBe(0);
  });
  it.each(['true', 'yes', '0', '', 'si'])('la bandera solo vale con «1» (no «%s»)', (v) => {
    expect(guarda('postgresql://u:p@10.0.0.5/db', { DEMO_PERMITIR_RED_PRIVADA: v }).status).toBe(3);
  });
  it('la bandera NO abre hosts públicos, ?host= ni Supabase', () => {
    const env = { DEMO_PERMITIR_RED_PRIVADA: '1' };
    expect(guarda('postgresql://u:p@8.8.8.8/db', env).status).toBe(3);
    expect(guarda('postgresql://u:p@10.0.0.5/db?host=8.8.8.8', env).status).toBe(3);
    expect(guarda('postgresql://u:p@db.abc.supabase.co/db', env).status).toBe(3);
    expect(guarda('postgresql://u:p@100.64.1.1/db', env).status).toBe(3);
    expect(guarda('postgresql://u:p@169.254.1.1/db', env).status).toBe(3);
  });
});

describe('los scripts invocan la guarda ANTES de abrir una conexión (psql de mentira que lo delata)', () => {
  // psql falso que deja constancia si alguien lo llama. La guarda tiene que cortar antes.
  const bin = mkdtempSync(join(tmpdir(), 'psqlfalso-'));
  const marca = join(bin, 'llamado.txt');
  writeFileSync(join(bin, 'psql'), `#!/bin/sh\necho "$@" >> "${marca}"\nexit 0\n`);
  chmodSync(join(bin, 'psql'), 0o755);
  const correr = (script: string, args: string[], url: string, extra: Record<string, string> = {}) =>
    spawnSync('bash', [`${DIR}${script}`, ...args], { env: { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: process.env.HOME ?? '', DEMO_DATABASE_URL: url, ...extra } as unknown as NodeJS.ProcessEnv, encoding: 'utf8' });
  const llamado = () => { try { return readFileSync(marca, 'utf8'); } catch { return ''; } };

  it.each([
    ['sembrar.sh', []], ['sembrar.sh', ['--reiniciar']], ['sembrar.sh', ['--solo-limpiar']], ['vaciar-sintetico.sh', ['todo']],
  ] as Array<[string, string[]]>)('%s %s: ?host= y red privada se cortan sin tocar psql', (script, args) => {
    for (const url of ['postgresql:///db?host=prod.ejemplo.mx', 'postgresql://u:p@10.0.0.5/db', 'postgresql://u:p@172.16.4.4/db', 'postgresql://u:p@192.168.0.9/db']) {
      const r = correr(script, args, url);
      expect(r.status, `${script} ${url}`).toBe(3);
      expect(r.stderr).toContain('RECHAZADO');
    }
    expect(llamado()).toBe('');
  });
  it('con la bandera, una red privada llega a psql (y el SQL lo vuelve a comprobar con la bandera)', () => {
    const r = correr('vaciar-sintetico.sh', ['todo'], 'postgresql://u:p@10.0.0.5/db', { DEMO_PERMITIR_RED_PRIVADA: '1' });
    expect(r.status).toBe(0);
    expect(llamado()).toContain('red_privada=1');
  });
  it('generar-veredictos.mjs y los demás scripts con base usan la misma guarda', () => {
    for (const f of ['sembrar.sh', 'vaciar-sintetico.sh', 'probar-idempotencia.sh']) {
      expect(readFileSync(`${DIR}${f}`, 'utf8'), f).toContain('guarda-host.mjs');
    }
    for (const f of ['generar-veredictos.mjs', 'verificar-cruces-con-motor.mjs']) {
      expect(readFileSync(`${DIR}${f}`, 'utf8'), f).toContain("from './guarda-host.mjs'");
    }
  });
});

describe('sembrar.sh --ancla', () => {
  const correr = (args: string[]) => spawnSync('bash', [`${DIR}sembrar.sh`, ...args], { env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', DEMO_DATABASE_URL: 'postgresql:///x' } as unknown as NodeJS.ProcessEnv, encoding: 'utf8' });
  it('--ancla sin --reiniciar falla con un mensaje claro (mezclaría dos «ahora»)', () => {
    const r = correr(['--ancla', '2026-10-21 09:00:00-06']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--ancla requiere --reiniciar');
  });
  it('--ancla con --solo-limpiar tampoco tiene sentido', () => {
    expect(correr(['--solo-limpiar', '--ancla', '2026-10-21 09:00:00-06']).status).toBe(2);
  });
  it('la 2.ª línea de defensa: el SQL se niega a sembrar sobre otra ancla', () => {
    const sql = readFileSync(`${DIR}sql/00_guardas_y_ayudas.sql`, 'utf8');
    expect(sql).toContain('innovativos_sim.meta');
    expect(sql).toMatch(/ya está sembrado con otra ancla/);
  });
});

describe('el SQL también exige loopback salvo bandera', () => {
  it.each(['sql/00_guardas_y_ayudas.sql', 'limpiar.sql', 'vaciar.sql'])('%s', (f) => {
    const s = readFileSync(`${DIR}${f}`, 'utf8');
    expect(s).toContain("inn.red_privada");
    expect(s).toMatch(/current_database\(\)\s*~\*\s*'prod/);
  });
});
