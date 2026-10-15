import { describe, expect, it } from 'vitest';
import { crearServidorTmsFalso, HTML_LOGIN, type Http } from './servidor';
import { generarDatos, sumaCentavos, SUMAS_1228, BITACORA_1228, aCentavos } from './datos';

// Todo sintético. El reloj es inyectado: ninguna prueba espera tiempo real.
async function entrar(http: Http) {
  const r = await http({ metodo: 'POST', ruta: '/api/login', cuerpo: { usuario: 'usuario-sintetico', clave: 'clave-sintetica' } });
  return (r.cuerpo as { token: string }).token;
}
const pedir = (http: Http, token: string, recurso: string, query: Record<string, string | number> = {}) =>
  http({ metodo: 'GET', ruta: `/api/${recurso}`, headers: { authorization: `Bearer ${token}` }, query });

describe('servidor TMS falso', () => {
  it('login: credenciales malas dan 401 y buenas dan token con vigencia', async () => {
    const s = crearServidorTmsFalso({ reloj: () => 1000, vigenciaTokenMs: 500 });
    expect((await s.http({ metodo: 'POST', ruta: '/api/login', cuerpo: { usuario: 'x', clave: 'y' } })).status).toBe(401);
    const r = await s.http({ metodo: 'POST', ruta: '/api/login', cuerpo: { usuario: 'usuario-sintetico', clave: 'clave-sintetica' } });
    expect(r.status).toBe(200);
    expect((r.cuerpo as { expira_en: number }).expira_en).toBe(1500);
  });

  it('sin token o con token desconocido responde 401', async () => {
    const s = crearServidorTmsFalso();
    expect((await s.http({ metodo: 'GET', ruta: '/api/peajes' })).status).toBe(401);
    expect((await pedir(s.http, 'inventado', 'peajes')).status).toBe(401);
  });

  it('401 determinista al vencer el token; un nuevo login lo repara', async () => {
    let ahora = 0;
    const s = crearServidorTmsFalso({ reloj: () => ahora, vigenciaTokenMs: 100 });
    const t = await entrar(s.http);
    expect((await pedir(s.http, t, 'viajes')).status).toBe(200);
    ahora = 100;
    expect((await pedir(s.http, t, 'viajes')).status).toBe(401);
    const t2 = await entrar(s.http);
    expect(t2).not.toBe(t);
    expect((await pedir(s.http, t2, 'viajes')).status).toBe(200);
    expect(s.logins).toBe(2);
  });

  it('pagina: recorre todas las páginas sin repetir ni perder filas', async () => {
    const datos = generarDatos({ n: 12 });
    const s = crearServidorTmsFalso({ datos, tamPaginaDefecto: 5 });
    const t = await entrar(s.http);
    const vistos: string[] = [];
    let pagina = 1; let total: number;
    do {
      const r = await pedir(s.http, t, 'viajes', { pagina });
      const d = (r.cuerpo as { data: { items: { Icident: string }[]; total_paginas: number } }).data;
      vistos.push(...d.items.map((i) => i.Icident));
      total = d.total_paginas; pagina++;
    } while (pagina <= total);
    expect(total).toBe(3);
    expect(vistos).toEqual(datos.viajes.map((v) => v.Icident));
    expect(new Set(vistos).size).toBe(12);
  });

  it('filtra por fechas (peajes por fechas)', async () => {
    const datos = generarDatos({ n: 12, inicio: '2026-01-05T00:00:00.000Z' });
    const s = crearServidorTmsFalso({ datos, tamPaginaDefecto: 100 });
    const t = await entrar(s.http);
    const r = await pedir(s.http, t, 'peajes', { desde: '2026-01-05T00:00:00.000Z', hasta: '2026-01-14T23:59:59.000Z' });
    const items = (r.cuerpo as { data: { items: { viaje: string; latitud: number; fecha_recibido: string }[] } }).data.items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(datos.peajes.length);
    expect(new Set(items.map((i) => i.viaje))).toEqual(new Set(['SINT-0001']));
    expect(items[0]).toHaveProperty('latitud');
    expect(items[0]).toHaveProperty('fecha_recibido');
  });

  it('429 con Retry-After tras el límite, y se reinicia', async () => {
    const s = crearServidorTmsFalso({ fallas: { limite: { maximo: 2, retryAfterSeg: 7 } } });
    const t = await entrar(s.http);
    expect((await pedir(s.http, t, 'posiciones')).status).toBe(200);
    expect((await pedir(s.http, t, 'posiciones')).status).toBe(200);
    const r = await pedir(s.http, t, 'posiciones');
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBe('7');
    s.reiniciarLimite();
    expect((await pedir(s.http, t, 'posiciones')).status).toBe(200);
  });

  it('5xx intermitente: falla exactamente cada N solicitudes de datos', async () => {
    const s = crearServidorTmsFalso({ fallas: { cincoxxCada: 3 } });
    const t = await entrar(s.http);
    const estados: number[] = [];
    for (let i = 0; i < 7; i++) estados.push((await pedir(s.http, t, 'viajes')).status);
    expect(estados).toEqual([200, 200, 503, 200, 200, 503, 200]);
  });

  it('modo «HTML de login con 200»: status 200 pero cuerpo HTML, incluso con token válido', async () => {
    const s = crearServidorTmsFalso({ fallas: { htmlLogin: true } });
    const t = await entrar(s.http);
    const r = await pedir(s.http, t, 'liquidaciones');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('text/html');
    expect(r.cuerpo).toBe(HTML_LOGIN);
    s.fallas.htmlLogin = false;
    expect((await pedir(s.http, t, 'liquidaciones')).headers['content-type']).toBe('application/json');
  });

  it('ruta inexistente responde 404', async () => {
    const s = crearServidorTmsFalso();
    expect((await s.http({ metodo: 'GET', ruta: '/api/otra' })).status).toBe(404);
  });
});

describe('datos sintéticos', () => {
  it('bitácora 1228 sintética cuadra al centavo con las sumas citadas', () => {
    const l = generarDatos().liquidaciones.find((x) => x.bitacora === BITACORA_1228)!;
    const p = sumaCentavos(l.percepciones); const d = sumaCentavos(l.deducciones);
    expect(p).toBe(SUMAS_1228.percepciones);
    expect(d).toBe(SUMAS_1228.deducciones);
    expect(p - d).toBe(SUMAS_1228.neto);
    expect(p).toBe(aCentavos(11407.46));
    expect(d).toBe(aCentavos(5114.23));
    expect(p - d).toBe(aCentavos(6293.23));
  });

  it('liquidación tiene la forma del crudo y enviado:false', () => {
    const l = generarDatos().liquidaciones[0];
    expect(Object.keys(l)).toEqual(expect.arrayContaining(['operador', 'unidad', 'bitacora', 'de', 'a', 'dias', 'percepciones', 'deducciones', 'desglose', 'enviado']));
    expect(l.enviado).toBe(false);
    expect(l.percepciones[0]).toEqual({ concepto: expect.any(String), valor: expect.any(Number) });
  });

  it('viajes con Icident y fechas con segundos; posiciones con Icident enlazado', () => {
    const d = generarDatos({ n: 4 });
    for (const v of d.viajes) {
      expect(v.Icident).toMatch(/^SINT-\d{4}$/);
      expect(v['Fecha Salida']).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
      expect(v['Fecha Llegada']).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    }
    const ids = new Set(d.viajes.map((v) => v.Icident));
    expect(d.posiciones.every((p) => ids.has(p.Icident))).toBe(true);
    expect(d.peajes.every((p) => ids.has(p.viaje))).toBe(true);
  });

  it('es determinista por semilla', () => {
    expect(generarDatos({ semilla: 3, n: 6 })).toEqual(generarDatos({ semilla: 3, n: 6 }));
    expect(generarDatos({ semilla: 3, n: 6 })).not.toEqual(generarDatos({ semilla: 4, n: 6 }));
  });
});
