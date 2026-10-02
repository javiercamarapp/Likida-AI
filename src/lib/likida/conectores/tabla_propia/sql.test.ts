import { describe, expect, it } from 'vitest';
import { ErrorTablaPropia } from './contrato';
import { afirmarSelectSeguro, construirSelect, crearEjecutorPg, resolverHostPublico, vistaValida } from './sql';

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
  const conn = { host: 'bd.ejemplo.com', puerto: 5432, base: 'flota', usuario: 'lectura', clave: 'secreta-123', ssl: 'verificar' as const };
  const resolver = (async () => [{ address: '8.8.8.8', family: 4 }]) as never;
  const consulta = construirSelect('v', COLS, { limite: 5 });
  function pgFalso(cuerpo: (q: string) => unknown) {
    const llamadas: Array<{ q: string; v?: unknown[] }> = []; const cfg: Record<string, unknown>[] = []; let cerrado = false;
    class Client {
      constructor(c: Record<string, unknown>) { cfg.push(c); }
      on() { /* */ }
      async connect() { /* */ }
      async query(q: string, v?: unknown[]) { llamadas.push({ q, v }); return { rows: (cuerpo(q) as never) ?? [] }; }
      async end() { cerrado = true; }
    }
    return { llamadas, cfg, cargarPg: async () => ({ Client }), cerrado: () => cerrado };
  }
  it('abre contra la IP validada con SNI del host, en transacción READ ONLY con statement_timeout y zona, y cierra', async () => {
    const pg = pgFalso((q) => (q.startsWith('select "eco"') ? [{ unidad: 'UN-1' }] : []));
    const filas = await crearEjecutorPg(conn, { cargarPg: pg.cargarPg, resolver }).ejecutar({ ...consulta, timeoutMs: 5_000, zona: 'America/Monterrey' });
    expect(filas).toEqual([{ unidad: 'UN-1' }]);
    expect(pg.cfg[0]).toMatchObject({ host: '8.8.8.8', ssl: { servername: 'bd.ejemplo.com', rejectUnauthorized: true }, statement_timeout: 5_000 });
    expect(String(pg.cfg[0].options)).toContain('default_transaction_read_only=on');
    expect(pg.llamadas.map((l) => l.q)).toEqual(['begin read only', 'select set_config($1, $2, true), set_config($3, $4, true)', consulta.text, 'rollback']);
    expect(pg.llamadas[1].v).toEqual(['statement_timeout', '5000', 'TimeZone', 'America/Monterrey']);
    expect(pg.cerrado()).toBe(true);
  });
  it('rechaza una sentencia que no sea SELECT ANTES de conectar', async () => {
    const pg = pgFalso(() => []);
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
    const Client = class { on() { /* */ } async connect() { throw Object.assign(new Error(veneno), { code }); } async query() { return { rows: [] }; } async end() { /* */ } };
    const e = await crearEjecutorPg(conn, { cargarPg: async () => ({ Client }), resolver }).ejecutar({ ...consulta, timeoutMs: 1, zona: 'UTC' }).catch((x) => x);
    expect(e).toMatchObject({ falla });
    expect(e.message).toMatch(frase);
    expect(e.message).not.toMatch(/secreta|8\.8\.8\.8|"lectura"/);
  });
  it('el host privado se rechaza antes de abrir socket', async () => {
    const pg = pgFalso(() => []);
    await expect(crearEjecutorPg({ ...conn, host: '10.0.0.9' }, { cargarPg: pg.cargarPg, resolver }).ejecutar({ ...consulta, timeoutMs: 1, zona: 'UTC' })).rejects.toThrow(/pública/);
    expect(pg.cfg).toHaveLength(0);
  });
});
