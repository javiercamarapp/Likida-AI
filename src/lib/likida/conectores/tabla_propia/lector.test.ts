/* eslint-disable security/detect-non-literal-fs-filename -- solo pruebas: leen fixtures del propio directorio por URL relativa a este archivo, nunca por entrada de usuario. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Http, PeticionHttp } from '../tipos';
import { ErrorTablaPropia, type LectorTablaPropia } from './contrato';
import { crearLectorTablaPropia, leerPosicionesTablaPropia } from './lector';
import { probarTablaPropia, TABLA_PROPIA } from './conector';
import type { EjecutorSql } from './sql';

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
// 2026-10-20 07:30 hora de CDMX = 13:30Z
const AHORA = Date.parse('2026-10-20T13:30:00.000Z');
const ok = (cuerpo: string, estado = 200) => ({ estado, cuerpo, encabezados: {} });

function httpDe(respuestas: Array<{ estado: number; cuerpo: string; encabezados?: Record<string, string> }>) {
  const llamadas: PeticionHttp[] = []; let i = 0;
  const http: Http = async (p) => { llamadas.push(p); return respuestas[Math.min(i++, respuestas.length - 1)]; };
  return { http, llamadas };
}
const reloj = { ahora: () => AHORA, dormir: async () => undefined };

const MAPEO = JSON.stringify({ lista: 'data.items', campos: { unidad: 'eco', lat: 'pos.y', lon: 'pos.x', fecha_hora: 'ts', velocidad_kmh: 'vel', ignicion: 'motor' } });
const EP = { modo: 'endpoint', base_url: 'https://api.ejemplo.com/posiciones', mapeo_posiciones: MAPEO, patron: 'bearer', token: 'tok-secreto-1' };

describe('endpoint JSON (fixture de contrato)', () => {
  it('lee con el mapeo declarado, manda la credencial SOLO por la cabecera y entiende la hora local', async () => {
    const { http, llamadas } = httpDe([ok(fx('endpoint_posiciones.json'))]);
    const r = await leerPosicionesTablaPropia(EP, http, reloj);
    expect(r).toMatchObject({ ok: true, completo: true, invalidas: 1 }); // (0,0) se rechaza
    if (!r.ok) throw new Error();
    expect(r.posiciones).toHaveLength(2);
    expect(r.posiciones[0]).toMatchObject({ deviceId: 'UN-001', lat: 25.56, lng: -100.94, medidaEn: '2026-10-20T13:00:00.000Z', velocidad: 30, ignicion: true, rumbo: null });
    expect(r.posiciones[1]).toMatchObject({ deviceId: 'un 002', velocidad: null, ignicion: false });
    expect(llamadas[0].metodo).toBe('GET');
    expect(llamadas[0].encabezados?.Authorization).toBe('Bearer tok-secreto-1');
    expect(llamadas[0].url).not.toContain('tok-secreto-1');
  });
  it('la ventana descarta lo viejo (no cuenta como inválido)', async () => {
    const viejo = JSON.stringify({ data: { items: [{ eco: 'UN-1', pos: { y: 25.5, x: -100.5 }, ts: '2026-10-19 07:00:00' }] } });
    const r = await leerPosicionesTablaPropia(EP, httpDe([ok(viejo)]).http, reloj);
    expect(r).toMatchObject({ ok: true, posiciones: [], invalidas: 0 });
  });
  it('zona configurada distinta: la hora local se interpreta en ESA zona', async () => {
    const cuerpo = JSON.stringify({ data: { items: [{ eco: 'UN-1', pos: { y: 32.5, x: -117.0 }, ts: '2026-10-20 06:30:00' }] } });
    const r = await leerPosicionesTablaPropia({ ...EP, zona: 'America/Tijuana' }, httpDe([ok(cuerpo)]).http, reloj);
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.posiciones[0].medidaEn).toBe('2026-10-20T13:30:00.000Z'); // 06:30 en Tijuana (UTC-7 en octubre)
  });
  it('paginación por cursor; un cursor repetido es lectura incompleta (backlog), no «todo bien»', async () => {
    const m = JSON.stringify({ lista: 'items', campos: { unidad: 'e', lat: 'a', lon: 'o', fecha_hora: 't' }, paginacion: { tipo: 'cursor', param: 'c', ruta_siguiente: 'next' } });
    const pag = (n: string, next: string | null) => ok(JSON.stringify({ items: [{ e: n, a: 25.5, o: -100.5, t: '2026-10-20 07:20:00' }], next }));
    const { http, llamadas } = httpDe([pag('A', 'p2'), pag('B', null)]);
    const r = await leerPosicionesTablaPropia({ ...EP, mapeo_posiciones: m }, http, reloj);
    if (!r.ok) throw new Error();
    expect(r.posiciones.map((p) => p.deviceId)).toEqual(['A', 'B']);
    expect(llamadas[1].url).toContain('c=p2');
    const ciclo = await leerPosicionesTablaPropia({ ...EP, mapeo_posiciones: m }, httpDe([pag('A', 'p2'), pag('B', 'p2')]).http, reloj);
    expect(ciclo).toMatchObject({ ok: false, backlog: true, falla: 'formato' });
  });
  it('401 → credencial; 404 → formato; 500 persistente → proveedor con backlog; JSON roto y lista ausente → formato', async () => {
    expect(await leerPosicionesTablaPropia(EP, httpDe([ok('', 401)]).http, reloj)).toMatchObject({ ok: false, falla: 'credencial' });
    expect(await leerPosicionesTablaPropia(EP, httpDe([ok('', 404)]).http, reloj)).toMatchObject({ ok: false, falla: 'formato' });
    expect(await leerPosicionesTablaPropia(EP, httpDe([ok('x', 500)]).http, reloj)).toMatchObject({ ok: false, falla: 'proveedor', backlog: true });
    expect(await leerPosicionesTablaPropia(EP, httpDe([ok('<html>')]).http, reloj)).toMatchObject({ ok: false, falla: 'formato' });
    expect(await leerPosicionesTablaPropia(EP, httpDe([ok('{"otra":1}')]).http, reloj)).toMatchObject({ ok: false, falla: 'formato' });
  });
  it('error de red → proveedor', async () => {
    const http: Http = async () => { throw new Error('ECONNRESET'); };
    expect(await leerPosicionesTablaPropia(EP, http, reloj)).toMatchObject({ ok: false, falla: 'proveedor' });
  });
  it('cabecera propia, query y basic; el token en query no se filtra a verificadoContra', async () => {
    const q = httpDe([ok(fx('endpoint_posiciones.json'))]);
    await leerPosicionesTablaPropia({ ...EP, patron: 'query', nombre_campo: 'k' }, q.http, reloj);
    expect(new URL(q.llamadas[0].url).searchParams.get('k')).toBe('tok-secreto-1');
    const b = httpDe([ok(fx('endpoint_posiciones.json'))]);
    await leerPosicionesTablaPropia({ ...EP, patron: 'basic', nombre_campo: 'usr' }, b.http, reloj);
    expect(b.llamadas[0].encabezados?.Authorization).toBe(`Basic ${Buffer.from('usr:tok-secreto-1').toString('base64')}`);
    const p = await probarTablaPropia({ ...EP, patron: 'query', nombre_campo: 'k' }, httpDe([ok(fx('endpoint_posiciones.json'))]).http);
    expect(JSON.stringify(p)).not.toContain('tok-secreto-1');
  });
  it('velocidad en mph se convierte a km/h', async () => {
    const m = JSON.stringify({ lista: 'items', unidad_velocidad: 'mph', campos: { unidad: 'e', lat: 'a', lon: 'o', fecha_hora: 't', velocidad_kmh: 'v' } });
    const c = JSON.stringify({ items: [{ e: 'A', a: 25.5, o: -100.5, t: '2026-10-20 07:20:00', v: 50 }] });
    const r = await leerPosicionesTablaPropia({ ...EP, mapeo_posiciones: m }, httpDe([ok(c)]).http, reloj);
    if (!r.ok) throw new Error();
    expect(r.posiciones[0].velocidad).toBe(80.5);
  });
});

describe('CSV por https (modo csv_sftp)', () => {
  const CSV = { modo: 'csv_sftp', base_url: 'https://datos.ejemplo.com/posiciones.csv' };
  const hoy = 'id_unidad,latitud,longitud,fecha_hora\nUN-1,25.5,-100.5,2026-10-20 07:20:00\nUN-2,25.6,-100.6,2026-10-20 07:25:00\nUN-3,25.6,-100.6,2026-10-19 01:00:00\n';
  it('lee, aplica la ventana y asienta la unidad por su económico', async () => {
    const r = await leerPosicionesTablaPropia(CSV, httpDe([ok(hoy)]).http, reloj);
    if (!r.ok) throw new Error();
    expect(r.posiciones.map((p) => p.deviceId)).toEqual(['UN-1', 'UN-2']);
    expect(r.posiciones[0].medidaEn).toBe('2026-10-20T13:20:00.000Z');
  });
  it('un archivo con otro encabezado es falla de formato con los encabezados leídos', async () => {
    const r = await leerPosicionesTablaPropia(CSV, httpDe([ok('a,b,c\n1,2,3\n')]).http, reloj);
    expect(r).toMatchObject({ ok: false, falla: 'formato' });
    expect(r.ok ? '' : r.motivo).toContain('Encabezados leídos');
  });
  it('SFTP: BLOQUEO dicho (sin cliente SFTP en este despliegue), jamás simulado', async () => {
    const r = await leerPosicionesTablaPropia({ modo: 'csv_sftp', base_url: 'sftp://s.ejemplo.com/p.csv' }, httpDe([ok('')]).http, reloj);
    expect(r).toMatchObject({ ok: false, falla: 'formato' });
    expect(r.ok ? '' : r.motivo).toContain('SFTP');
  });
});

describe('SQL de solo lectura (ejecutor de contrato)', () => {
  const SQL = { modo: 'sql_solo_lectura', sql_host: 'replica.ejemplo.com', sql_base: 'flota', sql_usuario: 'lectura', sql_clave: 'x', vista: 'esquema.posiciones', columnas: '{"unidad":"eco","lat":"lat","lon":"lon","fecha_hora":"ts","ignicion":"motor"}' };
  function ejecutorDe(filas: Array<Record<string, unknown>>) {
    const llamadas: Array<Parameters<EjecutorSql['ejecutar']>[0]> = [];
    return { llamadas, ejecutor: { ejecutar: async (c) => { llamadas.push(c); return filas; } } as EjecutorSql };
  }
  it('lee la ventana en la zona de la flota con parámetros, y entrega UTC', async () => {
    const e = ejecutorDe([
      { unidad: 'UN-1', lat: '25.5', lon: '-100.5', fecha_hora: '2026-10-20 07:20:00', ignicion: 't' },
      { unidad: 'UN-2', lat: '25.6', lon: '-100.6', fecha_hora: '2026-10-20 13:25:00+00', ignicion: null },
      { unidad: 'UN-3', lat: 'x', lon: '-100.6', fecha_hora: '2026-10-20 07:25:00' },
    ]);
    const r = await leerPosicionesTablaPropia(SQL, httpDe([]).http, { ...reloj, ejecutor: e.ejecutor });
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.posiciones.map((p) => [p.deviceId, p.medidaEn, p.ignicion])).toEqual([
      ['UN-1', '2026-10-20T13:20:00.000Z', true], ['UN-2', '2026-10-20T13:25:00.000Z', null],
    ]);
    expect(r.invalidas).toBe(1);
    expect(e.llamadas[0].values).toEqual(['2026-10-20 07:00:00']); // 13:30Z − 30 min, en hora de CDMX
    expect(e.llamadas[0].zona).toBe('America/Mexico_City');
    expect(e.llamadas[0].text).toMatch(/^select /);
  });
  it('las fallas del ejecutor conservan su clase para el backoff', async () => {
    for (const falla of ['credencial', 'proveedor', 'formato'] as const) {
      const ejecutor: EjecutorSql = { ejecutar: async () => { throw new ErrorTablaPropia('x', falla); } };
      expect(await leerPosicionesTablaPropia(SQL, httpDe([]).http, { ...reloj, ejecutor })).toMatchObject({ ok: false, falla });
    }
  });
  it('una excepción inesperada no filtra su texto', async () => {
    const ejecutor: EjecutorSql = { ejecutar: async () => { throw new Error('connection to 10.1.1.1 password=abc'); } };
    const r = await leerPosicionesTablaPropia(SQL, httpDe([]).http, { ...reloj, ejecutor });
    expect(JSON.stringify(r)).not.toMatch(/10\.1\.1\.1|abc/);
  });
  it('configuración inválida → falla de formato con el motivo, sin leer', async () => {
    const e = ejecutorDe([]);
    const r = await leerPosicionesTablaPropia({ ...SQL, vista: 'x; drop table y' }, httpDe([]).http, { ...reloj, ejecutor: e.ejecutor });
    expect(r).toMatchObject({ ok: false, falla: 'formato' });
    expect(e.llamadas).toHaveLength(0);
  });
});

describe('el contrato del demo se cumple (alineación estructural con demo_<cliente>/contratos.ts)', () => {
  it('los tres lectores son un LectorTablaPropia: modo + leerPosiciones + leerGeocercas', async () => {
    const h = httpDe([ok('')]).http;
    const lectores: LectorTablaPropia[] = [
      crearLectorTablaPropia({ modo: 'csv_sftp', base_url: 'https://d.ejemplo.com/p.csv' }, { http: h }),
      crearLectorTablaPropia(EP, { http: h }),
      crearLectorTablaPropia({ modo: 'sql_solo_lectura', sql_host: 'r.ejemplo.com', sql_base: 'b', sql_usuario: 'u', sql_clave: 'c', vista: 'v', columnas: '{"unidad":"a","lat":"b","lon":"c","fecha_hora":"d"}' }, { http: h, ejecutor: { ejecutar: async () => [] } }),
    ].map((c) => { if (!c.ok) throw new Error(c.motivo); return c.lector; });
    expect(lectores.map((l) => l.modo)).toEqual(['csv_sftp', 'endpoint', 'sql_solo_lectura']);
    for (const l of lectores) { expect(typeof l.leerPosiciones).toBe('function'); expect(typeof l.leerGeocercas).toBe('function'); }
  });
  it('la fila que entrega usa los nombres del contrato (unidad, lat, lon, fechaHoraLocal, velocidadKmh, ignicion)', async () => {
    const c = crearLectorTablaPropia({ modo: 'csv_sftp', base_url: 'https://d.ejemplo.com/p.csv' }, { http: httpDe([ok('id_unidad,latitud,longitud,fecha_hora,velocidad_kmh,ignicion\nIN-001,25.56,-100.94,2026-10-20 07:00:00,0.0,1\n')]).http });
    if (!c.ok) throw new Error();
    const r = await c.lector.leerPosiciones();
    expect(r.filas[0]).toEqual({ unidad: 'IN-001', lat: 25.56, lon: -100.94, fechaHoraLocal: '2026-10-20 07:00:00', velocidadKmh: 0, ignicion: true });
  });
});

describe('el conector del catálogo', () => {
  it('es honesto: requiere piloto, sin fuente, solo lee posiciones, secretos marcados', () => {
    expect(TABLA_PROPIA).toMatchObject({ id: 'tabla_propia', formaDeConectar: 'requiere_piloto', fuente: null });
    expect(TABLA_PROPIA.capacidades).toEqual(['leer_posiciones']);
    expect(TABLA_PROPIA.credenciales.filter((c) => c.forma === 'secreto').map((c) => c.clave).sort()).toEqual(['sql_clave', 'token']);
  });
  it('probar: sin «modo» no intenta; con mapeo roto dice cuál; con lectura buena cuenta filas', async () => {
    expect(await TABLA_PROPIA.probar({}, httpDe([]).http)).toMatchObject({ ok: false, verificadoContra: null });
    expect(await probarTablaPropia({ ...EP, mapeo_posiciones: '{}' }, httpDe([]).http)).toMatchObject({ ok: false, sobreLaCredencial: 'no_se_sabe' });
    const buena = await probarTablaPropia(EP, httpDe([ok(fx('endpoint_posiciones.json').replace(/2026-10-20/g, new Date().toISOString().slice(0, 10)))]).http);
    expect(buena.ok).toBe(true);
    expect(buena.verificadoContra).toBe('https://api.ejemplo.com/posiciones');
    expect(await probarTablaPropia(EP, httpDe([ok('', 401)]).http)).toMatchObject({ ok: false, sobreLaCredencial: 'no_sirve' });
  });
});
