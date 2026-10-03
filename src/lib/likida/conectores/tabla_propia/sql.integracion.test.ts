import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { leerConfigTablaPropia } from './config';
import { ErrorTablaPropia } from './contrato';
import { LectorTablaPropiaSql } from './lector';
import { construirSelect, crearEjecutorPg, type ConexionSql } from './sql';

/* eslint-disable security/detect-non-literal-fs-filename -- solo pruebas: todo vive en un directorio temporal creado aquí. */

// ═══════════════════════════════════════════════════════════════════════════
// INTEGRACIÓN CON UN POSTGRES REAL (efímero, 127.0.0.1, puerto libre, TLS con una CA de prueba generada aquí).
// Nada de red externa ni de credenciales reales. Se crea un usuario de SOLO LECTURA y una vista de posiciones, como
// el bloque SQL de docs/operacion/gps-proveedores.md, y se prueba el ejecutor de verdad: lectura, intento de
// escritura (READ ONLY), statement_timeout, tope de filas y de bytes, contraseña mala, y TLS (CA propia, CA ajena,
// nombre que no cuadra, servidor sin TLS). El cluster se BORRA al terminar. Sin initdb/openssl en el equipo, se omite.
//
// El guardián SSRF se sustituye aquí (`resolverHost`) porque el servidor de prueba vive en loopback; el guardián
// real tiene sus propias pruebas en sql.test.ts.
// ═══════════════════════════════════════════════════════════════════════════

const BIN_CANDIDATOS = ['/opt/homebrew/opt/postgresql@17/bin', '/opt/homebrew/opt/postgresql@16/bin', '/usr/local/opt/postgresql@17/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin'];
const dirBin = (): string | null => {
  const r = spawnSync('which', ['initdb']);
  if (r.status === 0) return String(r.stdout).trim().replace(/\/initdb$/, '');
  return BIN_CANDIDATOS.find((d) => existsSync(join(d, 'initdb'))) ?? null;
};
const BIN = dirBin();
const OPENSSL = spawnSync('which', ['openssl']).status === 0;
const puedeCorrer = BIN !== null && OPENSSL;

const puertoLibre = (): Promise<number> => new Promise((ok, mal) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)); });
  s.on('error', mal);
});

describe.skipIf(!puedeCorrer)('ejecutor pg contra un PostgreSQL real', () => {
  let dir = ''; let puerto = 0; let caPem = ''; let otraCaPem = '';
  let falsoSinTls: net.Server; let puertoSinTls = 0;
  const CLAVE_ADMIN = 'admin-de-prueba'; const CLAVE_LECTURA = 'lectura-de-prueba';
  const aLoopback = async () => '127.0.0.1';
  const conn = (extra: Partial<ConexionSql> = {}): ConexionSql => ({ host: 'localhost', puerto, base: 'flota', usuario: 'likida_lectura', clave: CLAVE_LECTURA, ssl: 'verificar', ...extra });
  const COLS = { unidad: 'eco', lat: 'lat', lon: 'lon', fecha_hora: 'ts', velocidad_kmh: 'vel', ignicion: 'motor' };
  const bin = (n: string) => join(BIN as string, n);
  const sh = (cmd: string, args: string[], opts: { cwd?: string } = {}) => execFileSync(cmd, args, { stdio: 'pipe', ...opts });

  const admin = async (sql: string, base = 'flota') => {
    const c = new pg.Client({ host: '127.0.0.1', port: puerto, user: 'postgres', password: CLAVE_ADMIN, database: base, ssl: { rejectUnauthorized: false } });
    await c.connect();
    try { return await c.query(sql); } finally { await c.end(); }
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'likida-pg-'));
    puerto = await puertoLibre();
    // CA de prueba, otra CA ajena y un certificado de servidor (localhost / 127.0.0.1) firmado por la primera.
    const ssl = join(dir, 'ssl'); mkdirSync(ssl);
    sh('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(ssl, 'ca.key'), '-out', join(ssl, 'ca.crt'), '-subj', '/CN=CA de prueba', '-days', '2']);
    sh('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(ssl, 'otra.key'), '-out', join(ssl, 'otra.crt'), '-subj', '/CN=CA ajena', '-days', '2']);
    sh('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(ssl, 'server.key'), '-out', join(ssl, 'server.csr'), '-subj', '/CN=localhost']);
    writeFileSync(join(ssl, 'ext.cnf'), 'subjectAltName=DNS:localhost,IP:127.0.0.1\n');
    sh('openssl', ['x509', '-req', '-in', join(ssl, 'server.csr'), '-CA', join(ssl, 'ca.crt'), '-CAkey', join(ssl, 'ca.key'), '-CAcreateserial', '-out', join(ssl, 'server.crt'), '-days', '2', '-extfile', join(ssl, 'ext.cnf')]);
    chmodSync(join(ssl, 'server.key'), 0o600);
    caPem = readFileSync(join(ssl, 'ca.crt'), 'utf8'); otraCaPem = readFileSync(join(ssl, 'otra.crt'), 'utf8');

    const datos = join(dir, 'datos');
    writeFileSync(join(dir, 'pw'), CLAVE_ADMIN);
    sh(bin('initdb'), ['-D', datos, '-U', 'postgres', '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', `--pwfile=${join(dir, 'pw')}`, '-E', 'UTF8']);
    writeFileSync(join(datos, 'pg_hba.conf'), 'hostssl all all 127.0.0.1/32 scram-sha-256\n');
    writeFileSync(join(datos, 'postgresql.conf'), [
      `port = ${puerto}`, "listen_addresses = '127.0.0.1'", "unix_socket_directories = ''", 'ssl = on',
      `ssl_cert_file = '${join(ssl, 'server.crt')}'`, `ssl_key_file = '${join(ssl, 'server.key')}'`, 'max_connections = 20', 'fsync = off', '',
    ].join('\n'));
    sh(bin('pg_ctl'), ['-D', datos, '-l', join(dir, 'pg.log'), '-w', '-t', '60', 'start']);

    await admin('create database flota', 'postgres');
    await admin(`
      create table posiciones (id serial primary key, eco text, lat numeric(9,6), lon numeric(9,6), ts timestamp, vel numeric, motor boolean, secreto text);
      insert into posiciones (eco, lat, lon, ts, vel, motor, secreto)
        select 'UN-' || (g % 3 + 1), 25.6 + g / 1000.0, -100.3 - g / 1000.0, now() - (g || ' minutes')::interval, 60 + g, g % 2 = 0, 'no-debe-salir' from generate_series(1, 20) g;
      create table bitacora (n int);
      create view v_posiciones as select eco, lat, lon, ts, vel, motor from posiciones;
      create view v_masiva as select 'UN-' || g as eco, 25.6 as lat, -100.3 as lon, now() as ts, 1 as vel, true as motor, repeat('x', 2000) as relleno from generate_series(1, 5000) g;
      create view v_lenta as select eco, lat, lon, ts, vel, motor, pg_sleep(0.4)::text as lento from posiciones;
      create function escribe() returns int language plpgsql volatile as $$ begin insert into bitacora values (1); return 1; end $$;
      create view v_trampa as select eco, lat, lon, ts, vel, motor, escribe() as x from posiciones;
      -- el bloque SQL de la guía: usuario de solo lectura, sin nada más que las vistas
      create role likida_lectura login password '${CLAVE_LECTURA}' nosuperuser nocreatedb nocreaterole noinherit connection limit 3;
      revoke all on schema public from public; revoke all on all tables in schema public from public;
      grant connect on database flota to likida_lectura; grant usage on schema public to likida_lectura;
      grant select on v_posiciones, v_masiva, v_lenta, v_trampa to likida_lectura;
      grant execute on function escribe() to likida_lectura;
    `);

    // Un «servidor» que contesta N a la petición de TLS: Postgres sin TLS, visto desde el cliente.
    falsoSinTls = net.createServer((s) => { s.once('data', () => { s.end('N'); }); s.on('error', () => undefined); });
    puertoSinTls = await new Promise<number>((ok) => falsoSinTls.listen(0, '127.0.0.1', () => ok((falsoSinTls.address() as net.AddressInfo).port)));
  }, 120_000);

  afterAll(async () => {
    falsoSinTls?.close();
    if (dir) {
      spawnSync(bin('pg_ctl'), ['-D', join(dir, 'datos'), '-m', 'immediate', '-w', 'stop']);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  const ejecutar = (c: ConexionSql, consulta = construirSelect('v_posiciones', COLS, { limite: 100 }), timeoutMs = 10_000, extra: { maxBytes?: number } = {}) =>
    crearEjecutorPg(c, { resolverHost: aLoopback, ...extra }).ejecutar({ ...consulta, timeoutMs, zona: 'America/Mexico_City' });

  it('lee la vista de posiciones por TLS verificado contra la CA del cliente (columnas con tipo, todo como texto)', async () => {
    const filas = await ejecutar(conn({ ca: caPem }));
    expect(filas).toHaveLength(20);
    expect(filas[0]).toMatchObject({ unidad: expect.stringMatching(/^UN-/), lat: expect.stringMatching(/^25\.6/), ignicion: expect.stringMatching(/^(true|false)$/) });
    expect(JSON.stringify(filas)).not.toContain('no-debe-salir'); // solo las columnas configuradas
  });

  it('el LIMIT corta del lado del servidor y el filtro por unidad y por ventana viajan como parámetros', async () => {
    expect(await ejecutar(conn({ ca: caPem }), construirSelect('v_posiciones', COLS, { limite: 3 }))).toHaveLength(3);
    const c = construirSelect('v_posiciones', COLS, { columnaFecha: 'fecha_hora', desdeLocal: '2000-01-01 00:00:00', columnaUnidad: 'unidad', unidades: ['UN-1'], limite: 100 });
    const filas = await ejecutar(conn({ ca: caPem }), c);
    expect(filas.length).toBeGreaterThan(0);
    expect(filas.every((f) => f.unidad === 'UN-1')).toBe(true);
    // un valor «malicioso» como unidad es solo un texto que no coincide: jamás se interpreta como SQL
    expect(await ejecutar(conn({ ca: caPem }), construirSelect('v_posiciones', COLS, { columnaUnidad: 'unidad', unidades: ["x'); drop table posiciones; --"] }))).toHaveLength(0);
    expect((await admin('select count(*)::int as n from posiciones')).rows[0].n).toBe(20);
  });

  it('el lector completo (config → SELECT → ejecutor real → posiciones con tipo) lee la vista de verdad', async () => {
    const cfg = leerConfigTablaPropia({
      modo: 'sql_solo_lectura', sql_host: 'localhost', sql_puerto: String(puerto), sql_base: 'flota', sql_usuario: 'likida_lectura', sql_clave: CLAVE_LECTURA, sql_ca: caPem,
      vista: 'v_posiciones', columnas: JSON.stringify(COLS), zona: 'America/Mexico_City',
    });
    if (!cfg.ok || cfg.config.modo !== 'sql_solo_lectura') throw new Error('config no válida');
    const lector = new LectorTablaPropiaSql(cfg.config, crearEjecutorPg(cfg.config.conexion, { resolverHost: aLoopback }));
    const r = await lector.leerPosiciones({ desdeUtc: new Date(Date.now() - 24 * 3_600_000) });
    expect(r.rechazadas).toEqual([]);
    expect(r.filas).toHaveLength(20);
    expect(r.filas[0]).toMatchObject({ unidad: expect.stringMatching(/^UN-/), lat: expect.any(Number), lon: expect.any(Number), ignicion: expect.any(Boolean) });
  });

  it('un intento de ESCRIBIR falla por READ ONLY aunque el SELECT llame a una función que escribe (y no queda nada escrito)', async () => {
    const e = await ejecutar(conn({ ca: caPem }), construirSelect('v_trampa', { ...COLS }, { limite: 5 })).then(() => null, (x) => x);
    // el SELECT de la vista trampa NO trae la columna x, pero la vista la calcula al leerse: el servidor lo rechaza
    expect(e).toBeInstanceOf(ErrorTablaPropia);
    expect(e.message).toMatch(/solo lectura/);
    expect((await admin('select count(*)::int as n from bitacora')).rows[0].n).toBe(0);
  });

  it('el statement_timeout corta una consulta lenta con clase proveedor y frase propia', async () => {
    const t0 = Date.now();
    const e = await ejecutar(conn({ ca: caPem }), construirSelect('v_lenta', COLS, { limite: 100 }), 1_000).then(() => null, (x) => x);
    expect(e).toMatchObject({ falla: 'proveedor' });
    expect(e.message).toMatch(/tiempo máximo|a tiempo/);
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it('el tope de bytes corta una vista masiva mientras la trae', async () => {
    const e = await ejecutar(conn({ ca: caPem }), construirSelect('v_masiva', { unidad: 'eco', lat: 'lat', lon: 'lon', fecha_hora: 'ts', relleno: 'relleno' } as never, { limite: 5_000 }), 10_000, { maxBytes: 1_000_000 }).then(() => null, (x) => x);
    expect(e).toMatchObject({ falla: 'formato' });
    expect(e.message).toMatch(/tope de/);
  });

  it('el usuario de lectura NO ve la tabla base ni nada fuera de lo concedido (clase credencial)', async () => {
    const e = await ejecutar(conn({ ca: caPem }), construirSelect('posiciones', COLS, { limite: 5 })).then(() => null, (x) => x);
    expect(e).toMatchObject({ falla: 'credencial' });
    expect(e.message).toMatch(/permiso/);
  });

  it('contraseña equivocada: clase credencial, sin el texto del servidor ni la clave', async () => {
    const e = await ejecutar(conn({ ca: caPem, clave: 'clave-mala-777' })).then(() => null, (x) => x);
    expect(e).toMatchObject({ falla: 'credencial' });
    expect(e.message).not.toMatch(/clave-mala-777|likida_lectura|scram|127\.0\.0\.1/);
  });

  it('TLS: sin la CA del cliente el certificado propio NO se acepta; con una CA ajena tampoco; con «sin_verificar» (require) sí cifra y lee', async () => {
    const sinCa = await ejecutar(conn()).then(() => null, (x) => x);
    expect(sinCa).toMatchObject({ falla: 'formato' });
    expect(sinCa.message).toMatch(/sql_ca/);
    expect(sinCa.message).not.toMatch(/self-signed|unable to verify/i);
    const ajena = await ejecutar(conn({ ca: otraCaPem })).then(() => null, (x) => x);
    expect(ajena).toMatchObject({ falla: 'formato' });
    expect(await ejecutar(conn({ ssl: 'sin_verificar' }))).toHaveLength(20);
  });

  it('TLS: un nombre que no cuadra con el certificado se rechaza aunque la CA sea la correcta', async () => {
    const e = await ejecutar(conn({ ca: caPem, host: 'otro.ejemplo.com' })).then(() => null, (x) => x);
    expect(e).toMatchObject({ falla: 'formato' });
    expect(e.message).toMatch(/certificado/);
  });

  it('TLS ausente: un servidor que no ofrece cifrado se rechaza, jamás se conecta en claro', async () => {
    const e = await ejecutar(conn({ puerto: puertoSinTls, ssl: 'sin_verificar' })).then(() => null, (x) => x);
    expect(e).toMatchObject({ falla: 'formato' });
    expect(e.message).toMatch(/cifrada \(TLS\)/);
  });

  it('puerto cerrado: clase de red/proveedor; y tras cada pasada no queda ninguna conexión abierta del lector', async () => {
    const libre = await puertoLibre();
    const e = await ejecutar(conn({ puerto: libre, ca: caPem })).then(() => null, (x) => x);
    expect(e).toMatchObject({ falla: 'proveedor' });
    await ejecutar(conn({ ca: caPem }));
    const abiertas = await admin("select count(*)::int as n from pg_stat_activity where application_name = 'likida_lector_tabla_propia'");
    expect(abiertas.rows[0].n).toBe(0);
  });
});
