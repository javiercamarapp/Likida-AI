import { describe, expect, it } from 'vitest';
import type { Http } from '../tipos';
import { leerExportacion, leerFilasExportacion, sesionDeExportaciones, type EntradaExportacion } from './archivo';
import type { MapeoTms } from './mapeo';
import { leerLiquidaciones, MAPEO_LIQUIDACIONES_SUPUESTO } from './liquidaciones';
import { leerPeajes, MAPEO_PEAJES_SUPUESTO } from './peajes';
import { SesionTms } from './sesion';
import { leerViajes, MAPEO_VIAJES_SUPUESTO } from './viajes';

// Todo sintético: Icident, unidades, casetas y montos inventados. Nada de datos reales.
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
type Cruda = Record<string, unknown>;

const MAPEO_SIMPLE: MapeoTms = {
  recurso: 'peajes', ruta: '/api/peajes', metodo: 'GET',
  params: { desde: 'desde', hasta: 'hasta', pagina: 'pagina', tam: 'tam' }, raiz: 'data.items',
  campos: {
    unidad: { fuente: 'Unidad', transformar: 'texto' },
    caseta: { fuente: 'Caseta', transformar: 'texto' },
    importe: { fuente: 'Importe', transformar: 'numero' },
    cruce_en: { fuente: 'Fecha', transformar: 'fecha_local', zona: 'America/Mexico_City', formato: 'dd/MM/yyyy HH:mm:ss' },
  },
  clave_externa: ['unidad', 'caseta', 'cruce_en'], obligatorios: ['unidad', 'caseta', 'importe', 'cruce_en'],
};

const celda = (x: unknown): string => {
  const t = String(x);
  return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const aCsv = (filas: Cruda[], sep = ';'): string => {
  const cols = Object.keys(filas[0]);
  return [cols.join(sep), ...filas.map((f) => cols.map((c) => celda(f[c])).join(sep))].join('\r\n');
};

describe('leerExportacion: CSV', () => {
  it('CSV con «;» y coma decimal: 189,50 es 189.5 (no 18950)', () => {
    const csv = 'Unidad;Caseta;Importe;Fecha\nUNI-1;Caseta Norte;189,50;05/03/2026 08:15:00\nUNI-2;Caseta Sur;"1.234,50";06/03/2026 09:00:00';
    const r = leerExportacion<{ importe: number; cruce_en: string }>(enc(csv), 'csv', MAPEO_SIMPLE);
    expect(r.error).toBeUndefined();
    expect(r.filas.map((f) => f.fila.importe)).toEqual([189.5, 1234.5]);
    // dd/MM en la zona de la flota: 05-mar-2026 08:15 en UTC−6 = 14:15 UTC.
    expect(r.filas[0].fila.cruce_en).toBe('2026-03-05T14:15:00.000Z');
  });

  it('BOM al inicio y separador distinto (coma, tabulador): mismas filas', () => {
    const base = 'Unidad,Caseta,Importe,Fecha\nUNI-1,Caseta Norte,100.00,05/03/2026 08:15:00';
    const a = leerExportacion(enc('﻿' + base), 'csv', MAPEO_SIMPLE);
    const b = leerExportacion(enc(base.replace(/,/g, '\t')), 'csv', MAPEO_SIMPLE);
    expect(a.error).toBeUndefined();
    expect(a.filas).toHaveLength(1);
    expect(b.filas).toEqual(a.filas);
  });

  it('archivo en Windows-1252 (acentos de Excel) se decodifica', () => {
    const bytes = Uint8Array.from([...enc('Unidad;Caseta;Importe;Fecha\nUNI-1;Caseta '), 0xe1, ...enc(';10,00;05/03/2026 08:15:00')]);
    const r = leerExportacion<{ caseta: string }>(bytes, 'csv', MAPEO_SIMPLE);
    expect(r.filas[0].fila.caseta).toBe('Caseta á');
  });

  it('fila corrupta (columnas de más o de menos) se rechaza con motivo y no detiene a las demás', () => {
    const csv = 'Unidad;Caseta;Importe;Fecha\nUNI-1;Caseta Norte;10,00;05/03/2026 08:15:00\nUNI-2;Caseta Sur;10,00\nUNI-3;Caseta A;1;2;3;4;5;6\nUNI-4;Caseta B;20,00;07/03/2026 10:00:00';
    const r = leerExportacion(enc(csv), 'csv', MAPEO_SIMPLE);
    expect(r.filas).toHaveLength(2);
    expect(r.rechazadas).toHaveLength(2);
    expect(r.rechazadas.map((x) => x.indice)).toEqual([1, 2]);
    expect(r.rechazadas[0].motivo).toContain('3 columnas');
  });

  it('importe no numérico o fecha imposible: rechazo por fila con la columna en el motivo', () => {
    const csv = 'Unidad;Caseta;Importe;Fecha\nUNI-1;N;abc;05/03/2026 08:15:00\nUNI-2;N;10,00;31/02/2026 08:15:00\nUNI-3;N;10,00;05/03/2026 08:15:00';
    const r = leerExportacion(enc(csv), 'csv', MAPEO_SIMPLE);
    expect(r.filas).toHaveLength(1);
    expect(r.rechazadas.map((x) => x.motivo)).toEqual([expect.stringContaining('«Importe»'), expect.stringContaining('«Fecha»')]);
  });

  it('archivo vacío, sin encabezado válido o con encabezado sin nombre: error global claro, nunca una excepción', () => {
    expect(leerExportacion(enc(''), 'csv', MAPEO_SIMPLE).error).toMatch(/vac/);
    expect(leerExportacion(enc('\n\n'), 'csv', MAPEO_SIMPLE).error).toMatch(/vac/);
    expect(leerExportacion(enc('Unidad;;Importe\n1;2;3'), 'csv', MAPEO_SIMPLE).error).toMatch(/sin nombre/);
  });

  it('2 000 filas con comillas y saltos de línea dentro de una celda', () => {
    const filas: Cruda[] = Array.from({ length: 2000 }, (_, i) => ({
      Unidad: `UNI-${i % 40}`, Caseta: i % 7 === 0 ? `Caseta "${i}"\nKm 3` : `Caseta ${i}`, Importe: `${100 + (i % 50)},${String(i % 100).padStart(2, '0')}`,
      Fecha: `${String(1 + (i % 28)).padStart(2, '0')}/03/2026 ${String(i % 24).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00`,
    }));
    const r = leerFilasExportacion(enc(aCsv(filas)), 'csv');
    expect(r.filas).toHaveLength(2000);
    expect(r.rechazadas).toEqual([]);
    expect(r.filas[7].Caseta).toBe('Caseta "7"\nKm 3');
  });
});

describe('leerExportacion: JSON', () => {
  it('JSON anidado: la lista se busca con la raíz del mapeo', () => {
    const doc = { resultado: { data: { items: [{ Unidad: 'UNI-1', Caseta: 'C1', Importe: 10.5, Fecha: '05/03/2026 08:15:00' }] } } };
    const mapeo = { ...MAPEO_SIMPLE, raiz: 'resultado.data.items' };
    const r = leerExportacion<{ importe: number }>(enc(JSON.stringify(doc)), 'json', mapeo);
    expect(r.error).toBeUndefined();
    expect(r.filas[0].fila.importe).toBe(10.5);
  });

  it('JSON con un arreglo en la raíz funciona aunque el mapeo apunte a la raíz de la API', () => {
    const r = leerExportacion(enc(JSON.stringify([{ Unidad: 'U', Caseta: 'C', Importe: '7,25', Fecha: '05/03/2026 08:15:00' }])), 'json', MAPEO_SIMPLE);
    expect(r.filas).toHaveLength(1);
  });

  it('JSON inválido o sin la lista: error global; filas que no son objeto: rechazadas por el mapeo', () => {
    expect(leerExportacion(enc('{no es json'), 'json', MAPEO_SIMPLE).error).toMatch(/JSON/);
    expect(leerExportacion(enc('{"otra":[]}'), 'json', MAPEO_SIMPLE).error).toMatch(/data\.items/);
    const r = leerExportacion(enc(JSON.stringify([5, { Unidad: 'U', Caseta: 'C', Importe: 1, Fecha: '05/03/2026 08:15:00' }])), 'json', MAPEO_SIMPLE);
    expect(r.filas).toHaveLength(1);
    expect(r.rechazadas[0].motivo).toContain('no es un objeto');
  });

  it('mapeo inválido: se dice, no se lee nada', () => {
    const r = leerExportacion(enc('[]'), 'json', { ...MAPEO_SIMPLE, clave_externa: [] });
    expect(r.error).toMatch(/mapeo inválido/);
  });
});

// ── Equivalencia: el mismo contenido por la API falsa y por archivo da resultados idénticos ──────────

const BASE = 'https://tms.ejemplo.test';
const LOGIN = { ruta: '/api/login', cuerpo: { usuario: '{usuario}', clave: '{clave}' }, campo_token: 'token' };
const CRED = { usuario: 'usuario-sintetico', clave: 'clave-sintetica' };
const RELOJ = { ahora: () => 1_000_000, dormir: async () => undefined };
const VENTANA = { desde: '2026-01-01T06:00:00.000Z', hasta: '2026-12-31T06:00:00.000Z' };

/** La API falsa: sirve las tablas con ventana y paginación, como el origen real (con números nativos). */
function apiFalsa(tablas: Record<string, Cruda[]>, campoFecha: Record<string, string>): Http {
  return async (p) => {
    const u = new URL(p.url);
    if (u.pathname === '/api/login') return { estado: 200, encabezados: {}, cuerpo: JSON.stringify({ token: 'tok' }) };
    const t = tablas[u.pathname];
    if (!t) return { estado: 404, encabezados: {}, cuerpo: '{}' };
    const campo = campoFecha[u.pathname];
    const d = Date.parse(u.searchParams.get('desde') ?? '1970-01-01T00:00:00Z'); const h = Date.parse(u.searchParams.get('hasta') ?? '2100-01-01T00:00:00Z');
    const filtradas = campo ? t.filter((f) => { const ms = Date.parse(String(f[campo]).replace(' ', 'T') + '-06:00'); return ms >= d && ms <= h; }) : t;
    const tam = Number(u.searchParams.get('tam') ?? 100); const pagina = Number(u.searchParams.get('pagina') ?? 1);
    return { estado: 200, encabezados: {}, cuerpo: JSON.stringify({ data: { items: filtradas.slice((pagina - 1) * tam, pagina * tam) } }) };
  };
}
const sesionApi = (http: Http) => new SesionTms({ http, base: BASE, login: LOGIN, credenciales: CRED, reloj: RELOJ });

const dia = (i: number): string => `2026-03-${String(1 + (i % 27)).padStart(2, '0')}`;
const viajes: Cruda[] = Array.from({ length: 30 }, (_, i) => ({
  Icident: `D-${1000 + i}`, unidad: `UNI-${100 + (i % 6)}`, 'Fecha Salida': `${dia(i)} 0${i % 9}:15:30`, 'Fecha Llegada': `${dia(i)} 1${i % 9}:45:10`,
  origen: 'Patio A', destino: `Destino ${i % 4}`, estatus: i === 5 ? 'Cancelado' : 'Cerrado',
}));
const peajes: Cruda[] = Array.from({ length: 40 }, (_, i) => ({
  TAG: i % 5 === 0 ? '' : `TAG${i}`, Unidad: `UNI-${100 + (i % 6)}`, Caseta: `Caseta ${i % 8}`, Clase: '5', Importe: 100 + i + (i % 4) * 0.5,
  Fecha: `${dia(i)} 1${i % 9}:${String(i % 60).padStart(2, '0')}:07`, Icident: `D-${1000 + (i % 30)}`,
}));
const nomina: Cruda[] = []; const operadores: Cruda[] = []; const conceptos: Cruda[] = [];
for (let b = 0; b < 8; b += 1) {
  operadores.push({ ID: 100 + b, NumeroEmpleado: `E-${100 + b}`, Telefono: '' });
  const comunes = { Poliza: `P${2000 + b}`, Bitacora: `${2000 + b}`, OperadorID: 100 + b, FechaInicio: `${dia(b)} 00:00:00`, FechaFin: `${dia(b + 9)} 23:59:59` };
  nomina.push({ ID: b * 10 + 1, ...comunes, ConceptoID: 1, Cargo: 8000.25 + b, Abono: 0 });
  nomina.push({ ID: b * 10 + 2, ...comunes, ConceptoID: 2, Cargo: 1234.5, Abono: 0 });
  nomina.push({ ID: b * 10 + 3, ...comunes, ConceptoID: 3, Cargo: 0, Abono: 410.75 });
}
conceptos.push({ ID: 1, Clave: 'C001', Descripcion: 'Sueldo base', Oculto: 'no' }, { ID: 2, Clave: 'C002', Descripcion: 'Bono', Oculto: 'no' }, { ID: 3, Clave: 'C003', Descripcion: 'Anticipo', Oculto: 'no' });

/** Lo que haría Excel en español: «;», coma decimal. */
const comaDecimal = (filas: Cruda[]): Cruda[] => filas.map((f) => Object.fromEntries(Object.entries(f).map(([k, x]) => [k, typeof x === 'number' && !Number.isInteger(x) ? String(x).replace('.', ',') : x])));
const entrada = (mapeo: MapeoTms, filas: Cruda[], formato: 'csv' | 'json'): EntradaExportacion =>
  ({ mapeo, formato, buffer: enc(formato === 'csv' ? '﻿' + aCsv(comaDecimal(filas)) : JSON.stringify({ data: { items: filas } })) });

describe('equivalencia: API falsa vs archivo (mismos mapeos, mismas salidas)', () => {
  const api = apiFalsa(
    { '/api/viajes': viajes, '/api/peajes': peajes, '/api/nomina-bitacora': nomina, '/api/operadores': operadores, '/api/conceptos-nomina': conceptos },
    { '/api/viajes': 'Fecha Salida', '/api/peajes': 'Fecha', '/api/nomina-bitacora': 'FechaInicio' },
  );

  for (const formato of ['csv', 'json'] as const) {
    it(`viajes (${formato}): resultado idéntico, incluido el cancelado ignorado`, async () => {
      const porApi = await leerViajes(sesionApi(api), VENTANA);
      const { sesion, rechazadas } = sesionDeExportaciones([entrada(MAPEO_VIAJES_SUPUESTO, viajes, formato)]);
      const porArchivo = await leerViajes(sesion, VENTANA);
      expect(porApi.ok && porApi.filas.length).toBe(29);
      expect(porApi.ok && porApi.canceladas).toBe(1);
      expect(porArchivo).toEqual(porApi);
      expect(rechazadas).toEqual([]);
    });

    it(`peajes (${formato}): resultado idéntico (importes con coma, TAG vacío, trozos de 10 días)`, async () => {
      const porApi = await leerPeajes(sesionApi(api), VENTANA);
      const { sesion } = sesionDeExportaciones([entrada(MAPEO_PEAJES_SUPUESTO, peajes, formato)]);
      const porArchivo = await leerPeajes(sesion, VENTANA);
      expect(porApi.ok && porApi.filas.length).toBe(40);
      expect(porArchivo).toEqual(porApi);
    });

    it(`liquidaciones (${formato}): tres tablas, mismos cuerpos aceptados`, async () => {
      const porApi = await leerLiquidaciones(sesionApi(api), MAPEO_LIQUIDACIONES_SUPUESTO, VENTANA);
      const { sesion } = sesionDeExportaciones([
        entrada(MAPEO_LIQUIDACIONES_SUPUESTO.nomina, nomina, formato),
        entrada(MAPEO_LIQUIDACIONES_SUPUESTO.operadores, operadores, formato),
        entrada(MAPEO_LIQUIDACIONES_SUPUESTO.conceptos, conceptos, formato),
      ]);
      const porArchivo = await leerLiquidaciones(sesion, MAPEO_LIQUIDACIONES_SUPUESTO, VENTANA);
      expect(porApi.ok && porApi.cuerpos.length).toBe(8);
      expect(porArchivo).toEqual(porApi);
    });
  }

  it('la ventana acota también por archivo: pedir solo la primera semana de marzo trae lo mismo que la API', async () => {
    const ventana = { desde: '2026-03-01T06:00:00.000Z', hasta: '2026-03-08T06:00:00.000Z' };
    const porApi = await leerViajes(sesionApi(api), ventana);
    const { sesion } = sesionDeExportaciones([entrada(MAPEO_VIAJES_SUPUESTO, viajes, 'csv')]);
    const porArchivo = await leerViajes(sesion, ventana);
    expect(porApi.ok && porApi.filas.length).toBeGreaterThan(0);
    expect(porApi.ok && porApi.filas.length).toBeLessThan(29);
    expect(porArchivo).toEqual(porApi);
  });

  it('2 000 viajes por archivo se leen completos y paginados', async () => {
    const muchos: Cruda[] = Array.from({ length: 2000 }, (_, i) => ({
      Icident: `M-${i}`, unidad: `UNI-${i % 50}`, 'Fecha Salida': `${dia(i)} 0${i % 9}:${String(i % 60).padStart(2, '0')}:00`, 'Fecha Llegada': '', origen: 'A', destino: 'B', estatus: 'Cerrado',
    }));
    const { sesion } = sesionDeExportaciones([entrada(MAPEO_VIAJES_SUPUESTO, muchos, 'csv')]);
    const r = await leerViajes(sesion, VENTANA);
    expect(r.ok && r.filas.length).toBe(2000);
    expect(r.ok && r.completa).toBe(true);
  });

  it('una fila corrupta del archivo no entra a los lectores y queda informada por ruta', async () => {
    const csv = 'Icident;unidad;Fecha Salida;Fecha Llegada;origen;destino;estatus\nD-1;UNI-1;2026-03-01 08:00:00;2026-03-01 18:00:00;A;B;Cerrado\nD-2;UNI-2;truncada';
    const { sesion, rechazadas } = sesionDeExportaciones([{ mapeo: MAPEO_VIAJES_SUPUESTO, formato: 'csv', buffer: enc(csv) }]);
    const r = await leerViajes(sesion, VENTANA);
    expect(r.ok && r.filas).toHaveLength(1);
    expect(rechazadas).toEqual([{ ruta: '/api/viajes', indice: 1, motivo: expect.stringContaining('columnas') }]);
  });

  it('un archivo ilegible se informa y el lector ve una lista vacía (no lanza)', async () => {
    const { sesion, rechazadas } = sesionDeExportaciones([{ mapeo: MAPEO_VIAJES_SUPUESTO, formato: 'json', buffer: enc('{roto') }]);
    const r = await leerViajes(sesion, VENTANA);
    expect(r.ok && r.filas).toEqual([]);
    expect(rechazadas[0].motivo).toMatch(/JSON/);
  });
});
