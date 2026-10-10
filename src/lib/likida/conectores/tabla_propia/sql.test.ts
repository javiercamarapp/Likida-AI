import { describe, expect, it } from 'vitest';
import { ErrorTablaPropia } from './contrato';
import { afirmarSelectSeguro, construirSelect, crearEjecutorPg, type ConexionSql, frasePorCodigo, normalizarCaPem, resolverHostPublico, vistaValida } from './sql';

const COLS = { unidad: 'eco', lat: 'latitud', lon: 'longitud', fecha_hora: 'ts', velocidad_kmh: 'vel', ignicion: 'motor' };

describe('el SQL no es libre: solo un SELECT armado con identificadores validados y parámetros', () => {
  it('arma UN select con alias, ventana y unidades como PARÁMETROS, orden y límite', () => {
    const c = construirSelect('esquema.posiciones', COLS, { columnaFecha: 'fecha_hora', desdeLocal: '2026-10-20 07:00:00', columnaUnidad: 'unidad', unidades: ['UN-1'], limite: 100 });
    expect(c.text).toBe('select "eco"::text as "unidad", "latitud"::text as "lat", "longitud"::text as "lon", "ts"::text as "fecha_hora", "vel"::text as "velocidad_kmh", "motor"::text as "ignicion" from "esquema"."posiciones" where "ts" >= $1::timestamp and "eco"::text = any($2::text[]) order by "ts" desc limit 100');
    expect(c.values).toEqual(['2026-10-20 07:00:00', ['UN-1']]);
    expect(c.text).not.toMatch(/UN-1|2026/); // los valores nunca viajan en el texto
  });
  it('el límite se acota (1 a 200,000)', () => {
    expect(construirSelect('v', COLS, { limite: 10_000_000 }).text).toMatch(/limit 200000$/);
    expect(construirSelect('v', COLS, { limite: -5 }).text).toMatch(/limit 1$/);
  });
  const malos = ['v; drop table x', 'v where 1=1', 'v--', 'v/*', "v'", 'v"', 'a.b.c', 'a b', '1v', '', 'v\nx', 'pg_catalog.pg_user', 'information_schema.tables', 'auth.users', 'pg_shadow'];
  it.each(malos)('la vista %j se rechaza', (v) => {
    expect('error' in vistaValida(v)).toBe(true);
    expect(() => construirSelect(v, COLS)).toThrow(ErrorTablaPropia);
  });
  it.each(['eco"; drop table x; --', 'eco, (select 1)', 'eco)', 'a.b', 'x y', '*', 'eco`'])('la columna %j se rechaza', (c) => {
    expect(() => construirSelect('v', { ...COLS, unidad: c })).toThrow(ErrorTablaPropia);
  });
  it('un alias inventado se rechaza', () => {
    expect(() => construirSelect('v', { 'x" from y --': 'a' })).toThrow(ErrorTablaPropia);
  });
  it('afirmarSelectSeguro rechaza escritura, multi-sentencia, comentarios, literales, into y bloqueos', () => {
    for (const t of [
      'delete from "v"', 'select 1; select 2', 'select 1 -- x', 'select /* x */ 1', "select 'a'", 'select * into x from "v"',
      'select * from "v" for update', 'select pg_sleep(10)', 'select pg_read_file($1)', 'insert into x select 1', 'select 1 from "v"; drop table x',
      'with a as (delete from x returning 1) select * from a',
    ]) expect(() => afirmarSelectSeguro(t), t).toThrow(ErrorTablaPropia);
  });
  it('un nombre legítimo entrecomillado que coincide con una palabra reservada no estorba', () => {
    expect(() => construirSelect('v', { ...COLS, unidad: 'update', lat: 'delete' })).not.toThrow();
  });
});

describe('SSRF: el servidor SQL debe ser público', () => {
  const resolverA = (...dirs: string[]) => (async () => dirs.map((address) => ({ address, family: 4 }))) as never;
  it('IP literal privada, loopback, enlace local y metadatos se rechazan', async () => {
    for (const ip of ['10.0.0.5', '127.0.0.1', '169.254.169.254', '192.168.1.1', '172.16.0.1', '::1', 'fd00::1']) {
      await expect(resolverHostPublico(ip), ip).rejects.toThrow(/dirección pública|interna/);
    }
  });
  it('un nombre que resuelve a una privada, o con UNA privada entre varias, se rechaza (rebinding)', async () => {
    await expect(resolverHostPublico('bd.ejemplo.com', resolverA('10.1.1.1'))).rejects.toThrow(/interna/);
    await expect(resolverHostPublico('bd.ejemplo.com', resolverA('8.8.8.8', '10.1.1.1'))).rejects.toThrow(/interna/);
  });
  it('un nombre público devuelve la IP YA validada (el socket se abre contra ella, sin segunda resolución)', async () => {
    await expect(resolverHostPublico('bd.ejemplo.com', resolverA('8.8.8.8'))).resolves.toBe('8.8.8.8');
  });
  it('DNS caído → falla de proveedor, no de formato', async () => {
    const e = await resolverHostPublico('bd.ejemplo.com', (async () => { throw new Error('ENOTFOUND'); }) as never).catch((x) => x);
    expect(e).toMatchObject({ falla: 'proveedor' });
  });
});

describe('el ejecutor real (pg inyectado): solo lectura, con tiempo y sin filtrar el texto del servidor', () => {
  const conn: ConexionSql = { host: 'bd.ejemplo.com', puerto: 5432, base: 'flota', usuario: 'lectura', clave: 'secreta-123', ssl: 'verificar' };
  const resolver = (async () => [{ address: '8.8.8.8', family: 4 }]) as never;
  const consulta = construirSelect('v', COLS, { limite: 5 });
  /** `fetch` devuelve los lotes de `lotes` en orden y luego vacío. */
  function pgFalso(lotes: unknown[][] = [], falla?: (q: string) => unknown) {
    const llamadas: Array<{ q: string; v?: unknown[] }> = []; const cfg: Record<string, unknown>[] = []; let cerrado = false; let n = 0;
    class Client {
      constructor(c: Record<string, unknown>) { cfg.push(c); }
      on() { /* */ }
      async connect() { if (falla) { const e = falla('connect'); if (e) throw e; } }
      async query(q: string, v?: unknown[]) {
        llamadas.push({ q, v });
        if (falla) { const e = falla(q); if (e) throw e; }
        return { rows: (q.startsWith('fetch') ? (lotes[n++] ?? []) : []) as never };
      }
      async end() { cerrado = true; }
    }
    return { llamadas, cfg, cargarPg: async () => ({ Client }), cerrado: () => cerrado };
  }
  const correr = (pg: ReturnType<typeof pgFalso>, c = conn, extra: Record<string, unknown> = {}) =>
    crearEjecutorPg(c, { cargarPg: pg.cargarPg, resolver, ...extra }).ejecutar({ ...consulta, timeoutMs: 5_000, zona: 'America/Monterrey' });

  it('caso feliz: abre contra la IP validada con SNI del host, TLS verificado, SET TRANSACTION READ ONLY, timeouts y zona; cursor; cierra', async () => {
    const pg = pgFalso([[{ unidad: 'UN-1' }]]);
    const filas = await correr(pg);
    expect(filas).toEqual([{ unidad: 'UN-1' }]);
    expect(pg.cfg[0]).toMatchObject({ host: '8.8.8.8', ssl: { servername: 'bd.ejemplo.com', rejectUnauthorized: true }, statement_timeout: 5_000, idle_in_transaction_session_timeout: 10_000 });
    expect(String(pg.cfg[0].options)).toContain('default_transaction_read_only=on');
    expect(pg.llamadas.map((l) => l.q)).toEqual([
      'begin', 'set transaction read only', 'select set_config($1, $2, true), set_config($3, $4, true), set_config($5, $6, true)',
      `declare likida_lectura no scroll cursor for ${consulta.text}`, 'fetch forward 1000 from likida_lectura', 'close likida_lectura', 'rollback',
    ]);
    expect(pg.llamadas[2].v).toEqual(['statement_timeout', '5000', 'idle_in_transaction_session_timeout', '10000', 'TimeZone', 'America/Monterrey']);
    expect(pg.cerrado()).toBe(true);
  });
  it('TLS: sin «verificar» solo se acepta un certificado propio (require); con CA del cliente se verifica contra ella', async () => {
    const a = pgFalso(); await correr(a, { ...conn, ssl: 'sin_verificar' });
    expect(a.cfg[0]).toMatchObject({ ssl: { rejectUnauthorized: false } });
    const b = pgFalso(); await correr(b, { ...conn, ca: '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n' });
    expect(b.cfg[0]).toMatchObject({ ssl: { rejectUnauthorized: true, ca: expect.stringContaining('BEGIN CERTIFICATE') } });
    expect(a.cfg[0].ssl).toBeTruthy(); // nunca `false`: jamás en claro
  });
  it('TLS ausente en el servidor: falla de formato con frase propia y se cierra el cliente (no hay retroceso a texto claro)', async () => {
    const pg = pgFalso([], (q) => (q === 'connect' ? new Error('The server does not support SSL connections') : null));
    const e = await correr(pg).catch((x) => x);
    expect(e).toMatchObject({ falla: 'formato' });
    expect(e.message).toMatch(/cifrada \(TLS\)/);
    expect(pg.cerrado()).toBe(true);
  });
  it('certificado no verificable: frase propia que manda a sql_ca', async () => {
    const pg = pgFalso([], (q) => (q === 'connect' ? new Error('self-signed certificate in certificate chain') : null));
    const e = await correr(pg).catch((x) => x);
    expect(e).toMatchObject({ falla: 'formato' });
    expect(e.message).toMatch(/sql_ca/);
    expect(e.message).not.toMatch(/self-signed/);
  });
  it('timeout del servidor (57014): clase de red/proveedor con frase propia, y se hace rollback implícito al cerrar', async () => {
    const pg = pgFalso([], (q) => (q.startsWith('fetch') ? Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }) : null));
    const e = await correr(pg).catch((x) => x);
    expect(e).toMatchObject({ falla: 'proveedor' });
    expect(e.message).toMatch(/tiempo máximo/);
    expect(pg.cerrado()).toBe(true);
  });
  it('tope de bytes: se corta MIENTRAS trae (no carga todo) y dice cómo acotar', async () => {
    const grande = 'x'.repeat(1_000);
    const pg = pgFalso([Array.from({ length: 1_000 }, () => ({ unidad: grande })), [{ unidad: 'nunca' }]]);
    const e = await correr(pg, conn, { maxBytes: 500_000 }).catch((x) => x);
    expect(e).toMatchObject({ falla: 'formato' });
    expect(e.message).toMatch(/tope de .* MB/);
    expect(pg.llamadas.filter((l) => l.q.startsWith('fetch'))).toHaveLength(1);
    expect(pg.cerrado()).toBe(true);
  });
  it('tope de filas: más del máximo absoluto se rechaza', async () => {
    const lote = Array.from({ length: 1_000 }, () => ({ u: 'a' }));
    const pg = pgFalso(Array.from({ length: 205 }, () => lote));
    const e = await correr(pg).catch((x) => x);
    expect(e).toMatchObject({ falla: 'formato' });
    expect(e.message).toMatch(/200000 filas/);
  });
  it('varios lotes: junta todos los del cursor hasta el lote corto', async () => {
    const lote = Array.from({ length: 1_000 }, (_, i) => ({ u: String(i) }));
    const pg = pgFalso([lote, [{ u: 'ultima' }]]);
    expect(await correr(pg)).toHaveLength(1_001);
  });
  it('credencial inválida: frase propia, clase credencial, sin el texto del servidor ni la clave', async () => {
    const veneno = 'password authentication failed for user "lectura" at 8.8.8.8 clave=secreta-123';
    const pg = pgFalso([], (q) => (q === 'connect' ? Object.assign(new Error(veneno), { code: '28P01' }) : null));
    const e = await correr(pg).catch((x) => x);
    expect(e).toMatchObject({ falla: 'credencial' });
    expect(e.message).not.toMatch(/secreta|8\.8\.8\.8|"lectura"/);
    expect(pg.cerrado()).toBe(true);
  });
  it('un intento de escritura que llegara al servidor (25006 read-only) se clasifica y no se reintenta', async () => {
    const pg = pgFalso([], (q) => (q.startsWith('declare') ? Object.assign(new Error('cannot execute INSERT in a read-only transaction'), { code: '25006' }) : null));
    await expect(correr(pg)).rejects.toMatchObject({ falla: 'formato' });
  });
  it('rechaza una sentencia que no sea SELECT ANTES de conectar', async () => {
    const pg = pgFalso();
    await expect(crearEjecutorPg(conn, { cargarPg: pg.cargarPg, resolver }).ejecutar({ text: 'delete from x', values: [], timeoutMs: 1, zona: 'UTC' })).rejects.toThrow(/rechazada/);
    expect(pg.cfg).toHaveLength(0);
  });
  it('sin el controlador pg: BLOQUEO dicho con claridad (falla formato → backoff largo), no un «0 posiciones»', async () => {
    const e = await crearEjecutorPg(conn, { cargarPg: async () => { throw new Error('Cannot find module pg'); }, resolver }).ejecutar({ ...consulta, timeoutMs: 1, zona: 'UTC' }).catch((x) => x);
    expect(e).toBeInstanceOf(ErrorTablaPropia);
    expect(e).toMatchObject({ falla: 'formato' });
    expect(e.message).toContain('controlador de PostgreSQL');
  });
  it.each([
    ['28P01', 'credencial', /usuario o la contraseña/], ['42501', 'credencial', /permiso/], ['42P01', 'formato', /vista/], ['42703', 'formato', /columnas/],
    ['57014', 'proveedor', /tiempo máximo/], ['08006', 'proveedor', /no contestó/], ['ECONNREFUSED', 'proveedor', /no contestó/],
  ])('el código %s se traduce a una frase NUESTRA (%s) sin el texto del servidor', async (code, falla, frase) => {
    const veneno = 'password authentication failed for user "lectura" at 8.8.8.8 clave=secreta-123';
    const e = frasePorCodigo(Object.assign(new Error(veneno), { code }));
    expect(e).toMatchObject({ falla });
    expect(e.message).toMatch(frase);
    expect(e.message).not.toMatch(/secreta|8\.8\.8\.8|"lectura"/);
  });
  it('destino privado: el host se rechaza antes de abrir socket (loopback, privada, metadatos, nombre que resuelve a privada)', async () => {
    for (const host of ['10.0.0.9', '127.0.0.1', '169.254.169.254', '192.168.0.4']) {
      const pg = pgFalso();
      await expect(crearEjecutorPg({ ...conn, host }, { cargarPg: pg.cargarPg, resolver }).ejecutar({ ...consulta, timeoutMs: 1, zona: 'UTC' }), host).rejects.toThrow(/pública/);
      expect(pg.cfg).toHaveLength(0);
    }
    const pg = pgFalso();
    await expect(crearEjecutorPg(conn, { cargarPg: pg.cargarPg, resolver: (async () => [{ address: '10.1.1.1', family: 4 }]) as never }).ejecutar({ ...consulta, timeoutMs: 1, zona: 'UTC' })).rejects.toThrow(/interna/);
    expect(pg.cfg).toHaveLength(0);
  });
});

describe('normalizarCaPem', () => {
  const CUERPO = 'QUJD'.repeat(40);
  const PEM = `-----BEGIN CERTIFICATE-----\n${CUERPO}\n-----END CERTIFICATE-----`;
  it('reconstruye el PEM pegado en una línea o con «\\n» literales', () => {
    const esperado = normalizarCaPem(PEM);
    expect(esperado).toHaveProperty('ok');
    expect(normalizarCaPem(PEM.replace(/\n/g, ' '))).toEqual(esperado);
    expect(normalizarCaPem(PEM.replace(/\n/g, '\\n'))).toEqual(esperado);
  });
  it('rechaza una llave privada, un texto cualquiera y un cuerpo roto', () => {
    expect(normalizarCaPem('-----BEGIN ' + 'PRIVATE KEY-----\nAAAA\n-----END ' + 'PRIVATE KEY-----')).toHaveProperty('error');
    expect(normalizarCaPem('hola')).toHaveProperty('error');
    expect(normalizarCaPem('-----BEGIN CERTIFICATE-----\n<<<>>>\n-----END CERTIFICATE-----')).toHaveProperty('error');
  });
});
