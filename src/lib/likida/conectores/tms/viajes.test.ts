import { describe, expect, it } from 'vitest';
import type { Http, PeticionHttp, RespuestaHttp } from '../tipos';
import { crearServidorTmsFalso, type ServidorTmsFalso } from './falso/servidor';
import { generarDatos } from './falso/datos';
import { validarMapeo, type CampoDetallado, type MapeoTms } from './mapeo';
import { SesionTms } from './sesion';
import { leerViajes, lectorViajes, MAPEO_VIAJES_SUPUESTO } from './viajes';

// Todo sintético: Icident, unidades y fechas inventados. Ninguna prueba duerme de verdad.
const BASE = 'https://tms.ejemplo.test';
const LOGIN = { ruta: '/api/login', cuerpo: { usuario: '{usuario}', clave: '{clave}' }, campo_token: 'token' };
const CRED = { usuario: 'usuario-sintetico', clave: 'clave-sintetica' };
const VENTANA = { desde: '2026-01-01 00:00:00', hasta: '2026-12-31 23:59:59' };
const RELOJ = { ahora: () => 1_000_000, dormir: async () => undefined };

const sesionDe = (http: Http) => new SesionTms({ http, base: BASE, login: LOGIN, credenciales: CRED, reloj: RELOJ });

function adaptar(s: ServidorTmsFalso): Http {
  return async (p: PeticionHttp): Promise<RespuestaHttp> => {
    const u = new URL(p.url);
    const r = await s.http({ metodo: p.metodo, ruta: u.pathname, query: Object.fromEntries(u.searchParams), headers: p.encabezados, cuerpo: p.cuerpo ? JSON.parse(p.cuerpo) : undefined });
    return { estado: r.status, encabezados: r.headers, cuerpo: typeof r.cuerpo === 'string' ? r.cuerpo : JSON.stringify(r.cuerpo) };
  };
}

type Cruda = Record<string, unknown>;
const v = (icident: string, extra: Cruda = {}): Cruda =>
  ({ Icident: icident, unidad: 'UNI-101', 'Fecha Salida': '2026-03-10 08:05:09', 'Fecha Llegada': '2026-03-10 20:30:45', ...extra });

/** Origen mínimo: login + lista paginada por página en /api/viajes. Registra métodos y rutas. */
function origen(todas: Cruda[], tam = 100) {
  const vistas: { metodo: string; ruta: string }[] = [];
  const http: Http = async (p) => {
    const u = new URL(p.url);
    vistas.push({ metodo: p.metodo, ruta: u.pathname });
    if (u.pathname === '/api/login') return { estado: 200, encabezados: {}, cuerpo: JSON.stringify({ token: 'tok-sintetico' }) };
    const pagina = Number(u.searchParams.get('pagina') ?? 1);
    const items = todas.slice((pagina - 1) * tam, pagina * tam);
    return { estado: 200, encabezados: {}, cuerpo: JSON.stringify({ data: { items } }) };
  };
  return { http, vistas };
}

describe('leerViajes', () => {
  it('el mapeo supuesto es válido y declara la zona de las fechas', () => {
    expect(validarMapeo(MAPEO_VIAJES_SUPUESTO)).toEqual([]);
    expect(MAPEO_VIAJES_SUPUESTO.recurso).toBe('viajes');
  });

  it('lee del servidor falso en varias páginas: Icident → despacho_ref y folio, hitos con segundos en UTC', async () => {
    const s = crearServidorTmsFalso({ datos: generarDatos({ n: 12 }), tamPaginaDefecto: 5 });
    const r = await leerViajes(sesionDe(adaptar(s)), VENTANA, { paginacion: { tipo: 'pagina', tamano: 5 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filas).toHaveLength(12);
    expect(r.completa).toBe(true);
    expect(r.filas[0].despacho_ref).toBe('SINT-0001');
    expect(r.filas[0].folio).toBe('SINT-0001');
    expect(r.filas[0].salida_en).toMatch(/^2026-01-\d\dT\d\d:\d\d:\d\d\.000Z$/);
    expect(s.solicitudesDatos).toBe(4); // 5 + 5 + 2 + página vacía
  });

  it('fecha con segundos: 08:05:09 hora de México es 14:05:09 UTC', async () => {
    const o = origen([v('SINT-0100')]);
    const r = await leerViajes(sesionDe(o.http), VENTANA);
    if (!r.ok) throw new Error(r.motivo);
    expect(r.filas[0].salida_en).toBe('2026-03-10T14:05:09.000Z');
    expect(r.filas[0].llegada_en).toBe('2026-03-11T02:30:45.000Z');
  });

  it('fechaInicio es el día LOCAL de la salida, no el del instante UTC', async () => {
    const o = origen([v('SINT-0101', { 'Fecha Salida': '2026-03-10 20:00:00', 'Fecha Llegada': '2026-03-11 06:00:00' })]);
    const r = await leerViajes(sesionDe(o.http), VENTANA);
    if (!r.ok) throw new Error(r.motivo);
    expect(r.filas[0].salida_en).toBe('2026-03-11T02:00:00.000Z');
    expect(r.filas[0].fechaInicio).toBe('2026-03-10');
  });

  it('la zona la declara el mapeo: otra zona, otro instante UTC', async () => {
    const salida = MAPEO_VIAJES_SUPUESTO.campos.salida_en as CampoDetallado;
    const campos: MapeoTms['campos'] = { ...MAPEO_VIAJES_SUPUESTO.campos, salida_en: { ...salida, zona: 'America/Cancun' } };
    const mapeo: MapeoTms = { ...MAPEO_VIAJES_SUPUESTO, campos };
    const o = origen([v('SINT-0102')]);
    const r = await leerViajes(sesionDe(o.http), VENTANA, { mapeo });
    if (!r.ok) throw new Error(r.motivo);
    expect(r.filas[0].salida_en).toBe('2026-03-10T13:05:09.000Z');
  });

  it('Icident duplicado en dos viajes: se leen ambos y se advierte', async () => {
    const o = origen([v('SINT-0200'), v('SINT-0200', { unidad: 'UNI-102', 'Fecha Salida': '2026-03-12 07:00:00', 'Fecha Llegada': '2026-03-12 18:00:00' }), v('SINT-0201')]);
    const r = await leerViajes(sesionDe(o.http), VENTANA);
    if (!r.ok) throw new Error(r.motivo);
    expect(r.filas).toHaveLength(3);
    expect(r.advertencias).toHaveLength(1);
    expect(r.advertencias[0]).toContain('SINT-0200');
    expect(r.advertencias[0]).toContain('2 viajes');
  });

  it('viaje sin unidad: rechazado con motivo y los demás siguen', async () => {
    const o = origen([v('SINT-0300', { unidad: '' }), v('SINT-0301', { unidad: undefined }), v('SINT-0302')]);
    const r = await leerViajes(sesionDe(o.http), VENTANA);
    if (!r.ok) throw new Error(r.motivo);
    expect(r.filas.map((f) => f.despacho_ref)).toEqual(['SINT-0302']);
    expect(r.rechazadas).toHaveLength(2);
    expect(r.rechazadas[0].motivo).toContain('unidad');
  });

  it('viaje cancelado se ignora y se cuenta (sin acentos ni mayúsculas)', async () => {
    const o = origen([v('SINT-0400', { estatus: 'Cancelado' }), v('SINT-0401', { estatus: 'ANULADA' }), v('SINT-0402', { estatus: 'en ruta' })]);
    const r = await leerViajes(sesionDe(o.http), VENTANA);
    if (!r.ok) throw new Error(r.motivo);
    expect(r.filas.map((f) => f.despacho_ref)).toEqual(['SINT-0402']);
    expect(r.canceladas).toBe(2);
    expect(r.rechazadas).toHaveLength(0);
  });

  it('sin llegada el viaje sigue en curso (llegada_en null); llegada anterior a la salida se rechaza', async () => {
    const o = origen([
      v('SINT-0500', { 'Fecha Llegada': undefined }),
      v('SINT-0501', { 'Fecha Llegada': '2026-03-09 10:00:00' }),
    ]);
    const r = await leerViajes(sesionDe(o.http), VENTANA);
    if (!r.ok) throw new Error(r.motivo);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].llegada_en).toBeNull();
    expect(r.rechazadas.map((x) => x.motivo)).toEqual([expect.stringContaining('anterior a la salida')]);
  });

  it('solo lee y no toca aceptado_en: ninguna petición de datos es de escritura y la fila no lo trae', async () => {
    const o = origen([v('SINT-0600')]);
    const r = await leerViajes(sesionDe(o.http), VENTANA);
    if (!r.ok) throw new Error(r.motivo);
    expect(o.vistas.filter((x) => x.ruta !== '/api/login').every((x) => x.metodo === 'GET')).toBe(true);
    expect('aceptado_en' in r.filas[0]).toBe(false);
    expect('aceptadoEn' in r.filas[0]).toBe(false);
  });

  it('falla del origen: ok false con motivo y lo ya leído se conserva como parcial', async () => {
    let n = 0;
    const http: Http = async (p) => {
      const u = new URL(p.url);
      if (u.pathname === '/api/login') return { estado: 200, encabezados: {}, cuerpo: JSON.stringify({ token: 't' }) };
      n += 1;
      if (n === 1) return { estado: 200, encabezados: {}, cuerpo: JSON.stringify({ data: { items: [v('SINT-0700'), v('SINT-0701')] } }) };
      return { estado: 403, encabezados: {}, cuerpo: '{}' };
    };
    const r = await leerViajes(sesionDe(http), VENTANA, { paginacion: { tipo: 'pagina', tamano: 2 } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain('403');
    expect(r.parcial.filas).toHaveLength(2);
  });

  it('lectorViajes cumple el contrato LectorTms y lanza si la lectura falla', async () => {
    const bueno = lectorViajes(sesionDe(origen([v('SINT-0800')]).http));
    expect(bueno.recurso).toBe('viajes');
    const l = await bueno.leer(VENTANA.desde, VENTANA.hasta);
    expect(l.filas).toHaveLength(1);
    const malo = lectorViajes(sesionDe(async (p) => (new URL(p.url).pathname === '/api/login'
      ? { estado: 200, encabezados: {}, cuerpo: JSON.stringify({ token: 't' }) } : { estado: 500, encabezados: {}, cuerpo: '' })));
    await expect(malo.leer(VENTANA.desde, VENTANA.hasta)).rejects.toThrow();
  });
});
