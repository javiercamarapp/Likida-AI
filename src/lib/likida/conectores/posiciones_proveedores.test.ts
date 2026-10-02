// ═══════════════════════════════════════════════════════════════════════════
// PRUEBAS DE CONTRATO de los lectores de posiciones (Wialon, Geotab, Navixy y
// genérico). Los fixtures de `fixtures-gps/` reproducen la forma que documenta
// cada fabricante (ver las URLs en `posiciones_proveedores.ts`); NO son
// capturas de una instancia viva — no existe ninguna. Lo que prueban: que el
// lector respeta ESE contrato (campos, unidades, paginación, errores dentro de
// un 200) y que lo que no lo cumple falla con nombre, nunca como «0 lecturas».
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Http, PeticionHttp, RespuestaHttp } from './tipos';
import { lectorDe } from './posiciones';
import {
  leerPosicionesWialon, leerPosicionesGeotab, leerPosicionesNavixy, leerPosicionesGenerico, validarMapeoGenerico,
} from './posiciones_proveedores';

const fx = (n: string) => readFileSync(join(__dirname, 'fixtures-gps', n), 'utf8');
const ok = (cuerpo: string, estado = 200, encabezados?: Record<string, string>): RespuestaHttp => ({ estado, cuerpo, encabezados });
const sinEspera = { dormir: async () => {} };

function enrutado(f: (p: PeticionHttp, n: number) => RespuestaHttp | Promise<RespuestaHttp>) {
  const llamadas: PeticionHttp[] = [];
  const http: Http = async (p) => { llamadas.push(p); return f(p, llamadas.length); };
  return { http, llamadas };
}
const svcDe = (p: PeticionHttp) => new URLSearchParams(p.cuerpo ?? '').get('svc');

describe('Wialon — core/search_items', () => {
  const V = { base_url: 'https://hst-api.wialon.com', token: 'T'.repeat(72) };
  const itemsDe = (desde: number, n: number) => JSON.stringify({
    totalItemsCount: 250, items: Array.from({ length: n }, (_, i) => ({ id: desde + i, nm: `U${desde + i}`, pos: { t: 1790000000, y: 20 + i / 1000, x: -99, s: 10, c: 5 } })),
  });

  it('normaliza: epoch UTC → ISO, y = lat, x = lon, s km/h, c rumbo; la unidad sin `pos` NO es error', async () => {
    const { http, llamadas } = enrutado((p) => {
      const svc = svcDe(p);
      if (svc === 'token/login') return ok(fx('wialon_token_login.json'));
      if (svc === 'core/search_items') return ok(fx('wialon_search_items.json'));
      return ok('{}');
    });
    const r = await leerPosicionesWialon(V, http);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.posiciones).toHaveLength(2);
    expect(r.posiciones[0]).toEqual({ deviceId: '12001', lat: 20.9674, lng: -89.5926, medidaEn: new Date(1790000000_000).toISOString(), velocidad: 72, rumbo: 90, ignicion: null });
    expect(r.sinPosicion).toBe(1);
    expect(r.invalidas).toBe(0);
    // el token viaja en el CUERPO, nunca en la URL; y la sesión se cierra
    expect(llamadas.every((l) => !l.url.includes('TTTT'))).toBe(true);
    expect(llamadas.map(svcDe)).toEqual(['token/login', 'core/search_items', 'core/logout']);
    const busqueda = new URLSearchParams(llamadas[1].cuerpo ?? '');
    expect(busqueda.get('sid')).toBe('0123456789abcdef0123456789abcdef');
    expect(JSON.parse(busqueda.get('params') ?? '{}')).toMatchObject({ flags: 1025, from: 0, to: 199 });
  });

  it('pagina con from/to hasta cubrir totalItemsCount (250 unidades = 2 páginas)', async () => {
    const { http } = enrutado((p) => {
      const svc = svcDe(p);
      if (svc === 'token/login') return ok(fx('wialon_token_login.json'));
      if (svc === 'core/search_items') {
        const from = JSON.parse(new URLSearchParams(p.cuerpo ?? '').get('params') ?? '{}').from as number;
        return ok(itemsDe(from + 1, from === 0 ? 200 : 50));
      }
      return ok('{}');
    });
    const r = await leerPosicionesWialon(V, http);
    expect(r.ok && r.posiciones.length).toBe(250);
    expect(r.ok && r.paginas).toBe(2);
  });

  it('token rechazado = {"error":8} DENTRO de un 200 → falla de credencial, no «sin unidades»', async () => {
    const { http } = enrutado(() => ok('{"error":8}'));
    const r = await leerPosicionesWialon(V, http);
    expect(r).toMatchObject({ ok: false, falla: 'credencial' });
  });

  it('error 9 (servidor de autorización caído) es del proveedor, no de la credencial', async () => {
    const { http } = enrutado(() => ok('{"error":9}'));
    expect(await leerPosicionesWialon(V, http)).toMatchObject({ ok: false, falla: 'proveedor' });
  });

  it('la sesión caduca a media lectura (error 1): renueva UNA vez y sigue', async () => {
    let busquedas = 0;
    const { http, llamadas } = enrutado((p) => {
      const svc = svcDe(p);
      if (svc === 'token/login') return ok(fx('wialon_token_login.json'));
      if (svc === 'core/search_items') { busquedas += 1; return busquedas === 1 ? ok('{"error":1}') : ok(fx('wialon_search_items.json')); }
      return ok('{}');
    });
    const r = await leerPosicionesWialon(V, http);
    expect(r.ok && r.posiciones.length).toBe(2);
    expect(llamadas.filter((l) => svcDe(l) === 'token/login')).toHaveLength(2);
  });

  it('un segundo error 1 NO entra en bucle', async () => {
    const { http } = enrutado((p) => svcDe(p) === 'token/login' ? ok(fx('wialon_token_login.json')) : ok('{"error":1}'));
    const r = await leerPosicionesWialon(V, http);
    expect(r.ok).toBe(false);
  });

  it('respeta Retry-After en 429 y reintenta; agotados los reintentos queda como pendiente', async () => {
    const esperas: number[] = [];
    let n = 0;
    const { http } = enrutado((p) => {
      if (svcDe(p) === 'token/login') return ok(fx('wialon_token_login.json'));
      if (svcDe(p) === 'core/search_items') { n += 1; return n === 1 ? ok('', 429, { 'retry-after': '2' }) : ok(fx('wialon_search_items.json')); }
      return ok('{}');
    });
    const r = await leerPosicionesWialon(V, http, { dormir: async (ms) => { esperas.push(ms); } });
    expect(r.ok).toBe(true);
    expect(esperas).toEqual([2000]);
    const { http: h2 } = enrutado((p) => svcDe(p) === 'token/login' ? ok(fx('wialon_token_login.json')) : ok('', 503));
    expect(await leerPosicionesWialon(V, h2, sinEspera)).toMatchObject({ ok: false, falla: 'proveedor', backlog: true });
  });

  it('coordenadas (0,0), fuera de rango o sin fecha se descartan y se cuentan', async () => {
    const cuerpo = JSON.stringify({ totalItemsCount: 3, items: [
      { id: 1, pos: { t: 1790000000, y: 0, x: 0, s: 1, c: 1 } },
      { id: 2, pos: { t: 1790000000, y: 95, x: -99, s: 1, c: 1 } },
      { id: 3, pos: { y: 20, x: -99, s: 1, c: 1 } },
    ] });
    const { http } = enrutado((p) => svcDe(p) === 'token/login' ? ok(fx('wialon_token_login.json')) : ok(cuerpo));
    const r = await leerPosicionesWialon(V, http);
    expect(r.ok && r.posiciones).toHaveLength(0);
    expect(r.ok && r.invalidas).toBe(3);
  });

  it('un 200 con HTML (portal/proxy) o sin `items` es falla de FORMATO', async () => {
    const { http } = enrutado((p) => svcDe(p) === 'token/login' ? ok(fx('wialon_token_login.json')) : ok('<html>login</html>'));
    expect(await leerPosicionesWialon(V, http)).toMatchObject({ ok: false, falla: 'formato' });
    const { http: h2 } = enrutado((p) => svcDe(p) === 'token/login' ? ok(fx('wialon_token_login.json')) : ok('{"ok":true}'));
    expect(await leerPosicionesWialon(V, h2)).toMatchObject({ ok: false, falla: 'formato' });
  });

  it('sin token no llama a la red', async () => {
    const { http, llamadas } = enrutado(() => ok('{}'));
    expect(await leerPosicionesWialon({ base_url: V.base_url }, http)).toMatchObject({ ok: false, falla: 'credencial' });
    expect(llamadas).toHaveLength(0);
  });
});

describe('Geotab — Authenticate + Get DeviceStatusInfo', () => {
  const V = { database: 'flota_demo', usuario: 'lectura@flota.example', password: 'x' };
  const metodo = (p: PeticionHttp) => JSON.parse(p.cuerpo ?? '{}').method as string;

  it('autentica y lee el estado de cada dispositivo con la sesión devuelta', async () => {
    const { http, llamadas } = enrutado((p) => metodo(p) === 'Authenticate' ? ok(fx('geotab_authenticate.json')) : ok(fx('geotab_device_status_info.json')));
    const r = await leerPosicionesGeotab(V, http);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.posiciones).toEqual([
      { deviceId: 'b1', lat: 25.6866, lng: -100.3161, medidaEn: '2026-10-01T15:30:00.000Z', velocidad: 88, rumbo: 180, ignicion: null },
      { deviceId: 'b2', lat: 20.6597, lng: -103.3496, medidaEn: '2026-10-01T15:29:00.000Z', velocidad: 0, rumbo: 0, ignicion: null },
    ]);
    const get = JSON.parse(llamadas[1].cuerpo ?? '{}');
    expect(get.params).toMatchObject({ typeName: 'DeviceStatusInfo', credentials: { sessionId: 'SESION-GEOTAB-1', database: 'flota_demo' } });
  });

  it('si la base vive en otro servidor (`path`), las consultas de datos van a ESE servidor', async () => {
    const auth = JSON.stringify({ result: { path: 'my3.geotab.com', credentials: { database: 'flota_demo', sessionId: 'S', userName: 'u' } } });
    const { http, llamadas } = enrutado((p) => metodo(p) === 'Authenticate' ? ok(auth) : ok(fx('geotab_device_status_info.json')));
    await leerPosicionesGeotab(V, http);
    expect(llamadas[0].url).toBe('https://my.geotab.com/apiv1');
    expect(llamadas[1].url).toBe('https://my3.geotab.com/apiv1');
  });

  it('InvalidUserException dentro de un 200 → credencial vencida/cambiada', async () => {
    const { http } = enrutado(() => ok(fx('geotab_error_invalid_user.json')));
    expect(await leerPosicionesGeotab(V, http)).toMatchObject({ ok: false, falla: 'credencial' });
  });

  it('OverLimitException es transitoria (proveedor), con reintento', async () => {
    const lim = JSON.stringify({ error: { errors: [{ name: 'OverLimitException' }] } });
    const { http } = enrutado(() => ok(lim));
    expect(await leerPosicionesGeotab(V, http)).toMatchObject({ ok: false, falla: 'proveedor', backlog: true });
  });

  it('una respuesta que llena el tope de la consulta NO se declara completa', async () => {
    const lleno = JSON.stringify({ result: Array.from({ length: 5000 }, (_, i) => ({ device: { id: `b${i}` }, latitude: 20, longitude: -99, speed: 1, bearing: 1, dateTime: '2026-10-01T15:30:00Z' })) });
    const { http } = enrutado((p) => metodo(p) === 'Authenticate' ? ok(fx('geotab_authenticate.json')) : ok(lleno));
    expect(await leerPosicionesGeotab(V, http)).toMatchObject({ ok: false, backlog: true });
  });

  it('fecha sin zona o coordenadas basura se descartan; dispositivo sin id también', async () => {
    const malo = JSON.stringify({ result: [
      { device: { id: 'b1' }, latitude: 20, longitude: -99, dateTime: '2026-10-01T15:30:00' },
      { device: { id: 'b2' }, latitude: 0, longitude: 0, dateTime: '2026-10-01T15:30:00Z' },
      { latitude: 20, longitude: -99, dateTime: '2026-10-01T15:30:00Z' },
    ] });
    const { http } = enrutado((p) => metodo(p) === 'Authenticate' ? ok(fx('geotab_authenticate.json')) : ok(malo));
    const r = await leerPosicionesGeotab(V, http);
    expect(r.ok && r.posiciones).toHaveLength(0);
    expect(r.ok && r.invalidas).toBe(3);
  });

  it('faltan credenciales: no llama', async () => {
    const { http, llamadas } = enrutado(() => ok('{}'));
    expect(await leerPosicionesGeotab({ database: 'x' }, http)).toMatchObject({ ok: false, falla: 'credencial' });
    expect(llamadas).toHaveLength(0);
  });
});

describe('Navixy — tracker/list + tracker/get_states', () => {
  const V = { base_url: 'https://api.us.navixy.com/v2', api_key: 'K' };
  const ahora = () => Date.parse('2026-10-01T15:30:10Z');
  const ruta = (p: PeticionHttp) => p.url.replace(/^.*\/v2\//, '');

  it('lee los estados, convierte la hora de usuario (UTC-6) a UTC y salta bloqueados y sin fix', async () => {
    const { http, llamadas } = enrutado((p) => ruta(p) === 'tracker/list' ? ok(fx('navixy_tracker_list.json')) : ok(fx('navixy_get_states.json')));
    const r = await leerPosicionesNavixy(V, http, { ahora });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.posiciones).toEqual([
      { deviceId: '501', lat: 19.4326, lng: -99.1332, medidaEn: '2026-10-01T15:29:30.000Z', velocidad: 64, rumbo: 270, ignicion: true },
    ]);
    expect(r.sinPosicion).toBe(1);
    expect(llamadas[0].encabezados?.Authorization).toBe('NVX K');
    expect(JSON.parse(llamadas[1].cuerpo ?? '{}').trackers).toEqual([501, 502]); // 503 está bloqueado
  });

  it('success:false con código 3 → API key rechazada', async () => {
    const { http } = enrutado(() => ok(fx('navixy_error_auth.json')));
    expect(await leerPosicionesNavixy(V, http, { ahora })).toMatchObject({ ok: false, falla: 'credencial' });
  });

  it('401 HTTP → credencial; 502 persistente → proveedor', async () => {
    expect(await leerPosicionesNavixy(V, enrutado(() => ok('', 401)).http, { ahora })).toMatchObject({ ok: false, falla: 'credencial' });
    expect(await leerPosicionesNavixy(V, enrutado(() => ok('', 502)).http, { ahora, ...sinEspera })).toMatchObject({ ok: false, falla: 'proveedor' });
  });

  it('parte los trackers en lotes de 500', async () => {
    const lista = JSON.stringify({ success: true, list: Array.from({ length: 1200 }, (_, i) => ({ id: i + 1, source: { blocked: false } })) });
    const { http, llamadas } = enrutado((p) => ruta(p) === 'tracker/list' ? ok(lista) : ok('{"success":true,"user_time":"2026-10-01 09:30:00","states":{}}'));
    const r = await leerPosicionesNavixy(V, http, { ahora });
    expect(r.ok).toBe(true);
    expect(llamadas.filter((l) => ruta(l) === 'tracker/get_states')).toHaveLength(3);
  });

  it('sin servidor regional no hay lectura (no hay host global)', async () => {
    expect(await leerPosicionesNavixy({ api_key: 'K' }, enrutado(() => ok('{}')).http)).toMatchObject({ ok: false });
  });
});

describe('Genérico — mapeo configurable', () => {
  const base = { base_url: 'https://api.proveedor.example/v1/vehiculos', patron: 'bearer', token: 'TOK' };
  const mapeo = (o: object) => JSON.stringify({ lista: 'data', id: 'id', lat: 'lat', lng: 'lon', fecha: 'ts', ...o });

  it('lee con bearer, convierte mph→km/h y epoch en segundos', async () => {
    const cuerpo = JSON.stringify({ data: [{ id: 'A1', lat: 19.4, lon: -99.1, ts: 1790000000, v: 60, h: 90, ign: true }] });
    const { http, llamadas } = enrutado(() => ok(cuerpo));
    const r = await leerPosicionesGenerico({ ...base, mapeo_posiciones: mapeo({ formato_fecha: 'epoch_s', velocidad: 'v', unidad_velocidad: 'mph', rumbo: 'h', ignicion: 'ign' }) }, http);
    expect(r.ok && r.posiciones[0]).toEqual({ deviceId: 'A1', lat: 19.4, lng: -99.1, medidaEn: new Date(1790000000_000).toISOString(), velocidad: 96.6, rumbo: 90, ignicion: true });
    expect(llamadas[0].encabezados?.Authorization).toBe('Bearer TOK');
    expect(llamadas[0].metodo).toBe('GET');
  });

  it('token por cabecera con nombre propio y por query', async () => {
    const cuerpo = JSON.stringify({ data: [] });
    const a = enrutado(() => ok(cuerpo));
    await leerPosicionesGenerico({ ...base, patron: 'cabecera', nombre_campo: 'X-API-Key', mapeo_posiciones: mapeo({}) }, a.http);
    expect(a.llamadas[0].encabezados?.['X-API-Key']).toBe('TOK');
    const b = enrutado(() => ok(cuerpo));
    await leerPosicionesGenerico({ ...base, patron: 'query', nombre_campo: 'key', mapeo_posiciones: mapeo({}) }, b.http);
    expect(new URL(b.llamadas[0].url).searchParams.get('key')).toBe('TOK');
  });

  it('pagina por cursor hasta que no hay siguiente, y corta un cursor repetido', async () => {
    const paginas: Record<string, object> = {
      '': { data: [{ id: '1', lat: 20, lon: -99, ts: '2026-10-01T10:00:00Z' }], meta: { next: 'c2' } },
      c2: { data: [{ id: '2', lat: 21, lon: -99, ts: '2026-10-01T10:00:00Z' }], meta: { next: null } },
    };
    const { http } = enrutado((p) => ok(JSON.stringify(paginas[new URL(p.url).searchParams.get('cursor') ?? ''])));
    const m = mapeo({ paginacion: { tipo: 'cursor', param: 'cursor', ruta_siguiente: 'meta.next' } });
    const r = await leerPosicionesGenerico({ ...base, mapeo_posiciones: m }, http);
    expect(r.ok && r.posiciones.map((p) => p.deviceId)).toEqual(['1', '2']);
    const ciclo = enrutado(() => ok(JSON.stringify({ data: [], meta: { next: 'c2' } })));
    expect(await leerPosicionesGenerico({ ...base, mapeo_posiciones: m }, ciclo.http)).toMatchObject({ ok: false, backlog: true });
  });

  it('pagina por número de página y para al llegar una página corta', async () => {
    const { http, llamadas } = enrutado((p) => {
      const pag = Number(new URL(p.url).searchParams.get('page'));
      const n = pag === 1 ? 10 : 3;
      return ok(JSON.stringify({ data: Array.from({ length: n }, (_, i) => ({ id: `${pag}-${i}`, lat: 20, lon: -99, ts: '2026-10-01T10:00:00Z' })) }));
    });
    const r = await leerPosicionesGenerico({ ...base, mapeo_posiciones: mapeo({ paginacion: { tipo: 'pagina', param: 'page', tamano: 10 } }) }, http);
    expect(r.ok && r.posiciones).toHaveLength(13);
    expect(llamadas).toHaveLength(2);
  });

  it('401 → credencial; lista ausente → formato (el mapeo no corresponde)', async () => {
    expect(await leerPosicionesGenerico({ ...base, mapeo_posiciones: mapeo({}) }, enrutado(() => ok('', 401)).http)).toMatchObject({ ok: false, falla: 'credencial' });
    expect(await leerPosicionesGenerico({ ...base, mapeo_posiciones: mapeo({}) }, enrutado(() => ok('{"otra":[]}')).http)).toMatchObject({ ok: false, falla: 'formato' });
  });

  it('el token NUNCA viaja a otro host: la URL de posiciones debe ser del mismo origen', async () => {
    const { http, llamadas } = enrutado(() => ok('{}'));
    const r = await leerPosicionesGenerico({ ...base, mapeo_posiciones: mapeo({ url: 'https://atacante.example/robar' }) }, http);
    expect(r.ok).toBe(false);
    expect(llamadas).toHaveLength(0);
  });

  it('mapeo inválido, ausente o con rutas peligrosas se rechaza sin llamar', async () => {
    const { http, llamadas } = enrutado(() => ok('{}'));
    for (const m of [undefined, 'no json', '{"id":"id"}', mapeo({ id: '__proto__.x' }), mapeo({ lat: 'a b' }), mapeo({ extra: 1 })]) {
      expect(await leerPosicionesGenerico({ ...base, mapeo_posiciones: m }, http)).toMatchObject({ ok: false, falla: 'formato' });
    }
    expect(llamadas).toHaveLength(0);
    expect(validarMapeoGenerico(mapeo({}))).toMatchObject({ ok: true });
  });

  it('una ruta no sigue prototipos: `constructor.name` no se lee', async () => {
    const { http } = enrutado(() => ok(JSON.stringify({ data: [{ id: 'x', lat: 20, lon: -99, ts: '2026-10-01T10:00:00Z' }] })));
    const r = await leerPosicionesGenerico({ ...base, mapeo_posiciones: mapeo({ velocidad: 'toString' }) }, http);
    expect(r.ok && r.posiciones[0].velocidad).toBeNull();
  });

  it('fecha ISO sin zona es ambigua y se descarta', async () => {
    const { http } = enrutado(() => ok(JSON.stringify({ data: [{ id: 'x', lat: 20, lon: -99, ts: '2026-10-01T10:00:00' }] })));
    const r = await leerPosicionesGenerico({ ...base, mapeo_posiciones: mapeo({}) }, http);
    expect(r.ok && r.invalidas).toBe(1);
  });
});

describe('el registro de lectores', () => {
  it('los cinco proveedores resuelven a su lector', () => {
    expect(lectorDe('wialon')).toBe(leerPosicionesWialon);
    expect(lectorDe('geotab')).toBe(leerPosicionesGeotab);
    expect(lectorDe('navixy')).toBe(leerPosicionesNavixy);
    expect(lectorDe('gps_generico')).toBe(leerPosicionesGenerico);
  });
});
