import { describe, expect, it } from 'vitest';
import {
  ErrorCatalogoCajas,
  ESTADOS_CAJA,
  FORMA_PLACAS,
  TOPE_AVISOS_CAJAS,
  claveCaja,
  importarCatalogoCajas,
  normalizarEstadoCaja,
  normalizarNumeroCaja,
  normalizarPlacas,
} from './cajas';

// Todos los datos son sintéticos: números, líneas y placas inventados con la forma de los reales.
const ENC = 'Número de caja,Línea,Placas,Estado';

describe('importarCatalogoCajas · CSV válido', () => {
  it('lee número, línea, placas y estado y los normaliza', () => {
    const r = importarCatalogoCajas([ENC, ' c-0101 ,linea uno,ab-123-c,Vacía', '00777,,,en patio'].join('\n'));
    expect(r.avisos).toEqual([]);
    expect(r.descartadas).toEqual([]);
    expect(r.filasLeidas).toBe(2);
    expect(r.cajas).toEqual([
      { numero: 'C-0101', linea: 'LINEA UNO', placas: 'AB-123-C', estado: 'vacia', lineaCsv: 2 },
      { numero: '00777', linea: null, placas: null, estado: 'en_patio', lineaCsv: 3 },
    ]);
  });

  it('conserva los ceros a la izquierda y las letras: el número es texto, nunca número', () => {
    const r = importarCatalogoCajas([ENC, '000123,L1,,', 'x9z,L1,,'].join('\n'));
    expect(r.cajas.map((c) => c.numero)).toEqual(['000123', 'X9Z']);
  });

  it('acepta punto y coma, BOM, encabezados con otro nombre y columnas en otro orden', () => {
    const csv = '﻿Estatus;Placa;Caja\r\ncargada;ab 123 cd;C-1\r\n';
    const r = importarCatalogoCajas(csv);
    expect(r.cajas).toEqual([{ numero: 'C-1', linea: null, placas: 'AB123CD', estado: 'cargada', lineaCsv: 2 }]);
  });

  it('acepta solo la columna del número (lo demás queda en null, sin avisos)', () => {
    const r = importarCatalogoCajas('Caja\nC-1\nC-2');
    expect(r.cajas.map((c) => [c.numero, c.linea, c.placas, c.estado])).toEqual([
      ['C-1', null, null, null],
      ['C-2', null, null, null],
    ]);
    expect(r.avisos).toEqual([]);
  });

  it('respeta comillas: comas, comillas escapadas y renglones en blanco no rompen la cuenta de líneas', () => {
    const csv = [ENC, '"C-1","Linea, con coma",,vacia', '', '"C-2",L2,"AB-1234",cargada'].join('\n');
    const r = importarCatalogoCajas(csv);
    expect(r.cajas.map((c) => c.linea)).toEqual(['LINEA, CON COMA', 'L2']);
    expect(r.cajas[1].lineaCsv).toBe(4);
  });
});

describe('importarCatalogoCajas · duplicados', () => {
  it('se queda con el primer renglón y reporta el resto como duplicado, sin importar mayúsculas ni espacios', () => {
    const r = importarCatalogoCajas([ENC, 'c-1,L1,AAA-111,vacia', ' C-1 ,L2,BBB-222,cargada', 'c-2,L1,,'].join('\n'));
    expect(r.cajas.map((c) => [c.numero, c.linea, c.placas])).toEqual([
      ['C-1', 'L1', 'AAA-111'],
      ['C-2', 'L1', null],
    ]);
    expect(r.descartadas).toEqual([{ lineaCsv: 3, motivo: 'duplicado' }]);
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]).toMatchObject({ codigo: 'duplicado', lineaCsv: 3 });
  });

  it('la clave de unicidad coincide con el índice de la base (lower(btrim))', () => {
    expect(claveCaja('  C-01 ')).toBe('c-01');
    expect(claveCaja(normalizarNumeroCaja(' c-01 '))).toBe(claveCaja('C-01'));
  });
});

describe('importarCatalogoCajas · placas inválidas', () => {
  it('deja la caja sin placas y avisa con el texto original', () => {
    const r = importarCatalogoCajas([ENC, 'C-1,L1,"??",vacia', 'C-2,L1,AB,vacia', 'C-3,L1,"ABCDEFGHIJKLM",vacia'].join('\n'));
    expect(r.cajas.map((c) => c.placas)).toEqual([null, null, null]);
    expect(r.cajas).toHaveLength(3);
    expect(r.avisos.map((a) => a.codigo)).toEqual(['placas_invalidas', 'placas_invalidas', 'placas_invalidas']);
    expect(r.avisos[0].original).toBe('??');
  });

  it('las placas válidas pasan la misma forma que el CHECK de la base', () => {
    for (const p of ['AB-123-C', 'abc123', 'A1B2C3D4E5F6', 'XYZ']) {
      const n = normalizarPlacas(p);
      expect(n).not.toBeNull();
      expect(FORMA_PLACAS.test(n as string)).toBe(true);
    }
    expect(normalizarPlacas('a b')).toBeNull();
    expect(normalizarPlacas('ñandú-1')).toBeNull();
  });
});

describe('importarCatalogoCajas · estado fuera de dominio', () => {
  it('deja el estado en null, avisa y conserva la caja', () => {
    const r = importarCatalogoCajas([ENC, 'C-1,L1,,reparacion', 'C-2,L1,,CARGADA'].join('\n'));
    expect(r.cajas.map((c) => c.estado)).toEqual([null, 'cargada']);
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]).toMatchObject({ codigo: 'estado_fuera_de_dominio', lineaCsv: 2, original: 'reparacion' });
  });

  it('todo estado que sale del importador pertenece al dominio de la base', () => {
    const textos = ['Vacía', 'vacio', 'cargada', 'Llena', 'En Patio', 'patio', 'en tránsito', 'transito', 'en ruta', 'desconocido'];
    for (const t of textos) {
      const e = normalizarEstadoCaja(t);
      expect(e).not.toBeNull();
      expect(ESTADOS_CAJA).toContain(e);
    }
    expect(normalizarEstadoCaja('reparación')).toBeNull();
  });
});

describe('importarCatalogoCajas · renglones inservibles y errores', () => {
  it('descarta el renglón sin número de caja y los renglones en blanco no cuentan', () => {
    const r = importarCatalogoCajas([ENC, ',L1,AB-123,vacia', ',,,', 'C-1,L1,,'].join('\n'));
    expect(r.cajas.map((c) => c.numero)).toEqual(['C-1']);
    expect(r.descartadas).toEqual([{ lineaCsv: 2, motivo: 'numero_vacio' }]);
    expect(r.filasLeidas).toBe(2);
  });

  it('descarta un número de caja demasiado largo en vez de truncarlo', () => {
    const r = importarCatalogoCajas([ENC, `${'9'.repeat(41)},L1,,`].join('\n'));
    expect(r.cajas).toEqual([]);
    expect(r.descartadas).toEqual([{ lineaCsv: 2, motivo: 'numero_muy_largo' }]);
  });

  it('un archivo vacío o sin la columna del número falla con mensaje llano, no devuelve cero cajas en silencio', () => {
    expect(() => importarCatalogoCajas('')).toThrow(ErrorCatalogoCajas);
    expect(() => importarCatalogoCajas(' \n ,,\n')).toThrow(/vacío/);
    expect(() => importarCatalogoCajas('Línea,Placas\nL1,AB-123')).toThrow(/columna del número de caja/);
  });

  it('solo encabezado: sin cajas y sin error', () => {
    const r = importarCatalogoCajas(ENC);
    expect(r.cajas).toEqual([]);
    expect(r.filasLeidas).toBe(0);
  });
});

describe('importarCatalogoCajas · topes', () => {
  it('pasado el tope de filas descarta el resto y avisa una sola vez', () => {
    const filas = Array.from({ length: 7 }, (_, i) => `C-${i + 1},L1,,`);
    const r = importarCatalogoCajas([ENC, ...filas].join('\n'), { topeFilas: 5 });
    expect(r.cajas).toHaveLength(5);
    expect(r.descartadas.map((d) => d.motivo)).toEqual(['tope_de_filas', 'tope_de_filas']);
    expect(r.avisos.filter((a) => a.codigo === 'tope_de_filas')).toHaveLength(1);
  });

  it('el reporte de avisos está acotado y cuenta lo omitido', () => {
    const filas = Array.from({ length: TOPE_AVISOS_CAJAS + 25 }, (_, i) => `C-${i},L1,,inventado`);
    const r = importarCatalogoCajas([ENC, ...filas].join('\n'));
    expect(r.cajas).toHaveLength(TOPE_AVISOS_CAJAS + 25);
    expect(r.avisos).toHaveLength(TOPE_AVISOS_CAJAS);
    expect(r.avisosOmitidos).toBe(25);
  });

  it('el original de un aviso va recortado: no repite una celda enorme', () => {
    const r = importarCatalogoCajas([ENC, `C-1,L1,,${'x'.repeat(500)}`].join('\n'));
    expect(r.avisos[0].original.length).toBeLessThanOrEqual(61);
  });
});
