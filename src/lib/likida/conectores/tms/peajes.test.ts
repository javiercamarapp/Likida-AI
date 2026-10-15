import { describe, expect, it } from 'vitest';
import type { Http } from '../tipos';
import { estadoDeFila } from './huella';
import { validarMapeo, type CampoDetallado, type MapeoTms } from './mapeo';
import { SesionTms } from './sesion';
import { DIAS_POR_TROZO, leerPeajes, lectorPeajes, MAPEO_PEAJES_SUPUESTO, partirVentana } from './peajes';

// Todo sintético: TAG, unidades, casetas, importes y fechas inventados. Ninguna prueba duerme de verdad.
const BASE = 'https://tms.ejemplo.test';
const LOGIN = { ruta: '/api/login', cuerpo: { usuario: '{usuario}', clave: '{clave}' }, campo_token: 'token' };
const CRED = { usuario: 'usuario-sintetico', clave: 'clave-sintetica' };
const RELOJ = { ahora: () => 1_000_000, dormir: async () => undefined };
const VENTANA = { desde: '2026-03-01T06:00:00.000Z', hasta: '2026-03-26T06:00:00.000Z' }; // 25 días

const sesionDe = (http: Http) => new SesionTms({ http, base: BASE, login: LOGIN, credenciales: CRED, reloj: RELOJ });

type Cruda = Record<string, unknown>;
const p = (n: number, extra: Cruda = {}): Cruda =>
  ({ TAG: `TAG-${String(n).padStart(4, '0')}`, Unidad: 'UNI-101', Caseta: 'Caseta Sintética Norte', Clase: 'T3', Importe: '189.50', Fecha: `2026-03-10 08:${String(4 + (n % 50)).padStart(2, '0')}:09`, ...extra });

interface Peticion { desde: string; hasta: string; pagina: number; tam: number }

/** Origen sintético: login + /api/peajes que contesta lo que decida `datos(petición)` (una lista por página). */
function origen(datos: (q: Peticion) => Cruda[]) {
  const peticiones: Peticion[] = [];
  const metodos: string[] = [];
  const http: Http = async (pet) => {
    const u = new URL(pet.url);
    if (u.pathname === '/api/login') return { estado: 200, encabezados: {}, cuerpo: JSON.stringify({ token: 'tok-sintetico' }) };
    metodos.push(pet.metodo);
    const q: Peticion = {
      desde: u.searchParams.get('desde') ?? '', hasta: u.searchParams.get('hasta') ?? '',
      pagina: Number(u.searchParams.get('pagina') ?? 1), tam: Number(u.searchParams.get('tam') ?? 100),
    };
    peticiones.push(q);
    return { estado: 200, encabezados: {}, cuerpo: JSON.stringify({ data: { items: datos(q) } }) };
  };
  return { http, peticiones, metodos };
}

/** Una sola página con todo en el primer trozo que la pida; vacío para el resto. */
const pagina1 = (filas: Cruda[]) => (q: Peticion) => (q.pagina === 1 ? filas : []);

describe('partirVentana', () => {
  it('parte 25 días en trozos de 10, 10 y 5 días, contiguos y sin huecos', () => {
    const t = partirVentana(VENTANA.desde, VENTANA.hasta);
    if (typeof t === 'string') throw new Error(t);
    expect(DIAS_POR_TROZO).toBe(10);
    expect(t).toEqual([
      { desde: '2026-03-01T06:00:00.000Z', hasta: '2026-03-11T06:00:00.000Z' },
      { desde: '2026-03-11T06:00:00.000Z', hasta: '2026-03-21T06:00:00.000Z' },
      { desde: '2026-03-21T06:00:00.000Z', hasta: '2026-03-26T06:00:00.000Z' },
    ]);
  });

  it('una ventana de 10 días exactos o menor es un solo trozo; invertida o ilegible se rechaza con motivo', () => {
    expect(partirVentana('2026-03-01T00:00:00.000Z', '2026-03-11T00:00:00.000Z')).toHaveLength(1);
    expect(partirVentana('2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z')).toHaveLength(1);
    expect(partirVentana('2026-03-05T00:00:00.000Z', '2026-03-01T00:00:00.000Z')).toContain('antes de empezar');
    expect(partirVentana('ayer', '2026-03-01T00:00:00.000Z')).toContain('no es válida');
  });
});

describe('leerPeajes', () => {
  it('el mapeo supuesto es válido y declara la zona de las fechas', () => {
    expect(validarMapeo(MAPEO_PEAJES_SUPUESTO)).toEqual([]);
    expect(MAPEO_PEAJES_SUPUESTO.recurso).toBe('peajes');
    expect((MAPEO_PEAJES_SUPUESTO.campos.cruce_en as CampoDetallado).zona).toBe('America/Mexico_City');
  });

  it('pide al origen un trozo de 10 días por vez, con las fechas de cada trozo', async () => {
    const o = origen(() => []);
    const r = await leerPeajes(sesionDe(o.http), VENTANA);
    if (!r.ok) throw new Error(r.motivo);
    expect(r.trozos).toBe(3);
    expect(r.completa).toBe(true);
    expect(o.peticiones.map((q) => [q.desde, q.hasta])).toEqual([
      ['2026-03-01T06:00:00.000Z', '2026-03-11T06:00:00.000Z'],
      ['2026-03-11T06:00:00.000Z', '2026-03-21T06:00:00.000Z'],
      ['2026-03-21T06:00:00.000Z', '2026-03-26T06:00:00.000Z'],
    ]);
    expect(o.metodos.every((m) => m === 'GET')).toBe(true);
  });

  it('fecha local → UTC: 08:05:09 de México es 14:05:09Z; el día y la hora locales se conservan', async () => {
    const o = origen(pagina1([p(1), p(2, { Fecha: '2026-03-10 20:00:00' })]));
    const r = await leerPeajes(sesionDe(o.http), { desde: VENTANA.desde, hasta: '2026-03-11T00:00:00.000Z' });
    if (!r.ok) throw new Error(r.motivo);
    expect(r.filas[0].cruce_en).toBe('2026-03-10T14:05:09.000Z');
    expect(r.filas[0].fecha).toBe('2026-03-10');
    expect(r.filas[0].hora).toBe('08:05:09');
    // 20:00 local = 02:00Z del día siguiente: el día local sigue siendo el 10.
    expect(r.filas[1].cruce_en).toBe('2026-03-11T02:00:00.000Z');
    expect(r.filas[1].fecha).toBe('2026-03-10');
    expect(r.filas[1].hora).toBe('20:00:00');
  });

  it('emite la forma que consume A2 (tag, unidad, caseta, clase, importe, fecha+hora) con origen «tms»', async () => {
    const o = origen(pagina1([p(1, { TAG: 'TAG-0007', Icident: 'SINT-0042', Importe: '1,234.50' })]));
    const r = await leerPeajes(sesionDe(o.http), { desde: VENTANA.desde, hasta: '2026-03-11T00:00:00.000Z' });
    if (!r.ok) throw new Error(r.motivo);
    const { clave, huella: h, ...resto } = r.filas[0];
    expect(resto).toEqual({
      origen: 'tms', tag: 'TAG-0007', unidad: 'UNI-101', caseta: 'Caseta Sintética Norte', clase: 'T3', importe: 1234.5,
      cruce_en: '2026-03-10T14:05:09.000Z', fecha: '2026-03-10', hora: '08:05:09', despacho_ref: 'SINT-0042',
    });
    expect(clave).toContain('UNI-101');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sin TAG, clase ni Icident el cruce se lee igual con esos campos en null', async () => {
    const o = origen(pagina1([p(8, { TAG: undefined, Clase: undefined })]));
    const r = await leerPeajes(sesionDe(o.http), { desde: VENTANA.desde, hasta: '2026-03-11T00:00:00.000Z' });
    if (!r.ok) throw new Error(r.motivo);
    expect(r.filas[0]).toMatchObject({ tag: null, clase: null, despacho_ref: null });
  });

  it('fila sin caseta: rechazada con motivo y las demás siguen', async () => {
    const o = origen(pagina1([p(1, { Caseta: '' }), p(2, { Caseta: undefined }), p(3)]));
    const r = await leerPeajes(sesionDe(o.http), { desde: VENTANA.desde, hasta: '2026-03-11T00:00:00.000Z' });
    if (!r.ok) throw new Error(r.motivo);
    expect(r.filas.map((f) => f.tag)).toEqual(['TAG-0003']);
    expect(r.rechazadas).toHaveLength(2);
    expect(r.rechazadas[0].motivo).toContain('Caseta');
  });

  it('importe no positivo o ilegible y fecha imposible se rechazan con motivo, no se pierden en silencio', async () => {
    const o = origen(pagina1([p(1, { Importe: '0' }), p(2, { Importe: '-50' }), p(3, { Importe: 'mucho' }), p(4, { Fecha: '2026-02-30 10:00:00' }), p(5)]));
    const r = await leerPeajes(sesionDe(o.http), { desde: VENTANA.desde, hasta: '2026-03-11T00:00:00.000Z' });
    if (!r.ok) throw new Error(r.motivo);
    expect(r.filas.map((f) => f.tag)).toEqual(['TAG-0005']);
    expect(r.rechazadas).toHaveLength(4);
    expect(r.rechazadas.some((x) => x.motivo.includes('no es positivo'))).toBe(true);
  });

  it('idempotencia: leer dos veces da las mismas claves y huellas; una corrección cambia la huella y se detecta', async () => {
    const mk = (importe: string) => origen(pagina1([p(1, { Importe: importe }), p(2)]));
    const v = { desde: VENTANA.desde, hasta: '2026-03-11T00:00:00.000Z' };
    const a = await leerPeajes(sesionDe(mk('189.50').http), v);
    const b = await leerPeajes(sesionDe(mk('189.50').http), v);
    const c = await leerPeajes(sesionDe(mk('201.00').http), v);
    if (!a.ok || !b.ok || !c.ok) throw new Error('lectura fallida');
    expect(b.filas.map((f) => [f.clave, f.huella])).toEqual(a.filas.map((f) => [f.clave, f.huella]));
    const previas = new Map(a.filas.map((f) => [f.clave, f.huella]));
    expect(b.filas.map((f) => estadoDeFila(previas, f.clave, f.huella))).toEqual(['omitida', 'omitida']);
    // El mismo cruce (unidad+caseta+instante) con otro importe: misma clave, otra huella → actualizada.
    expect(c.filas.map((f) => estadoDeFila(previas, f.clave, f.huella))).toEqual(['actualizada', 'omitida']);
  });

  it('un cruce visto en el borde de dos trozos (borde inclusivo del origen) se deja una sola vez y se cuenta', async () => {
    const borde = p(9, { Fecha: '2026-03-11 00:00:00' });
    const o = origen((q) => (q.pagina === 1 ? [borde, p(q.desde.startsWith('2026-03-01') ? 1 : 2)] : []));
    const r = await leerPeajes(sesionDe(o.http), { desde: VENTANA.desde, hasta: '2026-03-21T06:00:00.000Z' });
    if (!r.ok) throw new Error(r.motivo);
    expect(r.filas.map((f) => f.tag).sort()).toEqual(['TAG-0001', 'TAG-0002', 'TAG-0009']);
    expect(r.duplicadas).toBe(1);
  });

  it('1 000 filas sintéticas en 2 páginas de 500', async () => {
    const todas = Array.from({ length: 1000 }, (_, i) => p(i + 1, { Fecha: `2026-03-05 ${String(Math.floor(i / 60) % 24).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00` }));
    const o = origen((q) => todas.slice((q.pagina - 1) * q.tam, q.pagina * q.tam));
    const r = await leerPeajes(sesionDe(o.http), { desde: VENTANA.desde, hasta: '2026-03-11T06:00:00.000Z' }, { paginacion: { tipo: 'pagina', tamano: 500 } });
    if (!r.ok) throw new Error(r.motivo);
    expect(r.filas).toHaveLength(1000);
    expect(new Set(r.filas.map((f) => f.clave)).size).toBe(1000);
    expect(r.rechazadas).toHaveLength(0);
    expect(r.completa).toBe(true);
    expect(o.peticiones.filter((q) => q.pagina <= 2).every((q) => q.tam === 500)).toBe(true);
    expect(o.peticiones.map((q) => q.pagina)).toEqual([1, 2, 3]); // 2 páginas con datos + la vacía que marca el fin
  });

  it('falla del origen en el 2.º trozo: ok false con motivo, lo del 1.º se conserva y dice dónde reanudar', async () => {
    let trozo2 = false;
    const http: Http = async (pet) => {
      const u = new URL(pet.url);
      if (u.pathname === '/api/login') return { estado: 200, encabezados: {}, cuerpo: JSON.stringify({ token: 'tok-sintetico' }) };
      if (u.searchParams.get('desde')?.startsWith('2026-03-11')) { trozo2 = true; return { estado: 400, encabezados: {}, cuerpo: '{"error":"fechas rechazadas"}' }; }
      return { estado: 200, encabezados: {}, cuerpo: JSON.stringify({ data: { items: u.searchParams.get('pagina') === '1' ? [p(1)] : [] } }) };
    };
    const r = await leerPeajes(sesionDe(http), VENTANA);
    expect(trozo2).toBe(true);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.parcial.filas).toHaveLength(1);
    expect(r.parcial.completa).toBe(false);
    expect(r.parcial.reanudar?.desde).toBe('2026-03-11T06:00:00.000Z');
  });

  it('el adaptador LectorTms entrega las filas y el recurso «peajes»; ventana inválida lanza con motivo', async () => {
    const o = origen(pagina1([p(1)]));
    const l = lectorPeajes(sesionDe(o.http));
    expect(l.recurso).toBe('peajes');
    const r = await l.leer('2026-03-01T06:00:00.000Z', '2026-03-05T06:00:00.000Z');
    expect(r.filas).toHaveLength(1);
    await expect(l.leer('2026-03-05T06:00:00.000Z', '2026-03-01T06:00:00.000Z')).rejects.toThrow('antes de empezar');
  });

  it('la zona la declara el mapeo: otra zona, otro instante UTC', async () => {
    const campo = MAPEO_PEAJES_SUPUESTO.campos.cruce_en as CampoDetallado;
    const mapeo: MapeoTms = { ...MAPEO_PEAJES_SUPUESTO, campos: { ...MAPEO_PEAJES_SUPUESTO.campos, cruce_en: { ...campo, zona: 'America/Cancun' } } };
    const o = origen(pagina1([p(1)]));
    const r = await leerPeajes(sesionDe(o.http), { desde: VENTANA.desde, hasta: '2026-03-11T00:00:00.000Z' }, { mapeo });
    if (!r.ok) throw new Error(r.motivo);
    expect(r.filas[0].cruce_en).toBe('2026-03-10T13:05:09.000Z');
    expect(r.filas[0].hora).toBe('08:05:09');
  });
});
