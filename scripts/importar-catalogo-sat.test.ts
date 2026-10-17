import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cargarCatalogo, filasDesdeMatriz, importarCatalogo, leerArchivoCatalogo, normalizarFecha, ErrorImportacion,
  TAMANO_LOTE, type DestinoCatalogo, type FilaCatalogo,
} from './importar-catalogo-sat';

/** Destino en memoria con la semántica de upsert por (catalogo, clave) de la tabla. */
function destinoMemoria() {
  const filas = new Map<string, FilaCatalogo>();
  const lotes: number[] = [];
  const destino: DestinoCatalogo = {
    async upsert(lote) { lotes.push(lote.length); for (const f of lote) filas.set(`${f.catalogo}|${f.clave}`, f); },
  };
  return { filas, lotes, destino };
}

function csvSintetico(n: number, extra: string[] = []): string {
  const l = ['c_ClaveProdServCP,Descripción,Fecha inicio de vigencia,Fecha fin de vigencia,Material peligroso'];
  for (let i = 1; i <= n; i++) {
    l.push(`${String(10000000 + i)},Producto sintético ${i},01/01/2020,,${i % 2 ? '0' : '1'}`);
  }
  return [...l, ...extra].join('\n') + '\n';
}

function archivo(nombre: string, contenido: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'sat-'));
  const ruta = join(dir, nombre);
  writeFileSync(ruta, contenido, 'utf8');
  return ruta;
}

describe('importar-catalogo-sat', () => {
  it('un CSV sintético de 20 filas con el formato oficial carga 20 filas', async () => {
    const { filas, destino } = destinoMemoria();
    const r = await importarCatalogo(archivo('c_ClaveProdServCP.csv', csvSintetico(20)), destino);
    expect(r.catalogo).toBe('c_ClaveProdServCP');
    expect(r.cargadas).toBe(20);
    expect(r.rechazos).toEqual([]);
    expect(filas.size).toBe(20);
    const f = filas.get('c_ClaveProdServCP|10000001')!;
    expect(f.descripcion).toBe('Producto sintético 1');
    expect(f.vigente_desde).toBe('2020-01-01');
    expect(f.vigente_hasta).toBeNull();
    expect(f.extra).toEqual({ 'Material peligroso': '0' });
  });

  it('reimportar el mismo archivo es idempotente (sigue habiendo 20)', async () => {
    const { filas, destino } = destinoMemoria();
    const ruta = archivo('c_ClaveProdServCP.csv', csvSintetico(20));
    await importarCatalogo(ruta, destino);
    await importarCatalogo(ruta, destino);
    expect(filas.size).toBe(20);
  });

  it('una fila con la clave vacía se rechaza, con su número de fila, y las demás se cargan', async () => {
    const { filas, destino } = destinoMemoria();
    const r = await importarCatalogo(archivo('c.csv', csvSintetico(19, [',Sin clave,01/01/2020,,0'])), destino);
    expect(r.cargadas).toBe(19);
    expect(filas.size).toBe(19);
    expect(r.rechazos).toEqual([{ fila: 21, motivo: 'clave vacía' }]);
  });

  it('el archivo oficial trae renglones de título arriba del encabezado: se saltan', () => {
    const matriz = [['Catálogo publicado por el SAT'], [], ['c_Pais', 'Descripción'], ['MEX', 'México'], ['USA', 'Estados Unidos']];
    const r = filasDesdeMatriz(matriz);
    expect(r.catalogo).toBe('c_Pais');
    expect(r.filas.map((f) => f.clave)).toEqual(['MEX', 'USA']);
  });

  it('sin encabezado c_… exige --catalogo, y valida su forma', () => {
    const m = [['MEX', 'México']];
    expect(() => filasDesdeMatriz(m)).toThrow(/--catalogo/);
    expect(() => filasDesdeMatriz(m, 'pais')).toThrow(/no es válido/);
    expect(filasDesdeMatriz([['clave', 'desc'], ['MEX', 'México']], 'c_Pais').filas).toHaveLength(1);
  });

  it('claves repetidas en el archivo: gana la última y no revienta el upsert por lotes', () => {
    const r = filasDesdeMatriz([['c_Pais', 'Descripción'], ['MEX', 'vieja'], ['MEX', 'nueva']]);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].descripcion).toBe('nueva');
  });

  it('vigencia fin anterior al inicio se rechaza', () => {
    const r = filasDesdeMatriz([
      ['c_Pais', 'Descripción', 'Fecha inicio de vigencia', 'Fecha fin de vigencia'],
      ['MEX', 'México', '01/01/2024', '01/01/2023'],
    ]);
    expect(r.filas).toHaveLength(0);
    expect(r.rechazos[0].motivo).toMatch(/vigencia/);
  });

  it('carga por lotes de 1 000', async () => {
    const { lotes, destino } = destinoMemoria();
    const filas: FilaCatalogo[] = Array.from({ length: 2500 }, (_, i) => ({
      catalogo: 'c_CodigoPostal', clave: String(i), descripcion: '', extra: {}, vigente_desde: null, vigente_hasta: null,
    }));
    expect(await cargarCatalogo(filas, destino)).toBe(2500);
    expect(lotes).toEqual([TAMANO_LOTE, TAMANO_LOTE, 500]);
  });

  it('fechas: dd/mm/yyyy, ISO y vacío', () => {
    expect(normalizarFecha('05/03/2021')).toBe('2021-03-05');
    expect(normalizarFecha('2021-03-05 00:00:00')).toBe('2021-03-05');
    expect(normalizarFecha('')).toBeNull();
    expect(normalizarFecha('no es fecha')).toBeNull();
  });

  it('falla con mensaje llano si el archivo no existe, sin tocar la red', () => {
    expect(() => leerArchivoCatalogo('/no/existe/catalogo.xlsx')).toThrow(ErrorImportacion);
    expect(() => leerArchivoCatalogo('/no/existe/catalogo.xlsx')).toThrow(/No existe el archivo/);
    expect(() => leerArchivoCatalogo('')).toThrow(/Falta el archivo/);
  });
});
