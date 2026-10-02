import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { aCsv, aXlsx, MIME_XLSX, aJson, celdaCsv, configEstandar, construirFilas, exportarDocumentos, nombreSeguro, resolverRuta, validarConfigExport, aExportable, type ExportConfig } from './exportacion';
import { cv, extraccionAtlasOk } from './documentos_sinteticos.fixture';
import type { DocumentoFila } from './repo';

const docAprobado = (over: Partial<DocumentoFila> = {}, ext = extraccionAtlasOk()): DocumentoFila => ({
  id: 'doc-1', tenantId: 't', canal: 'manual', formato: 'excel', nombreArchivo: 'atlas.xlsx', mime: null, bytes: 1, sha256: 'a'.repeat(64), storageRuta: null, estado: 'aprobado', version: 3,
  clienteId: null, perfilId: null, perfilVersion: null, remitente: null, asunto: null, remitenteReconocido: null, textoExtracto: null, riesgoInyeccion: false, extraccion: ext, validacion: null,
  confianzaMin: null, nivelModelo: 1, modelo: null, tokensIn: 0, tokensOut: 0, costoUsd: 0, viajeId: null, procesandoHasta: null, intentos: 1, ultimoError: null, abiertoEn: null,
  revisadoPor: null, aprobadoPor: null, aprobadoEn: '2026-10-02T16:00:00.000Z', rechazoMotivo: null, tiempoRevisionSeg: 100, exportadoEn: null, retenerHasta: '2027-01-01', purgadoEn: null,
  createdAt: '', updatedAt: '', ...over,
});

const cfg = (over: Partial<ExportConfig> = {}): ExportConfig => ({ ...configEstandar(), ...over });

describe('validarConfigExport', () => {
  it('la configuración estándar es válida', () => expect(validarConfigExport(configEstandar())).toMatchObject({ ok: true }));

  it('rechaza campos que no se pueden exportar (lista cerrada)', () => {
    const r = validarConfigExport({ columnas: [{ encabezado: 'X', campo: 'password' }, { encabezado: 'Y', campo: 'mercancia.__proto__' }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores.join(' ')).toMatch(/«password» no es un campo exportable/);
  });

  it('cada columna lleva campo O constante', () => {
    expect(validarConfigExport({ columnas: [{ encabezado: 'X' }] }).ok).toBe(false);
    expect(validarConfigExport({ columnas: [{ encabezado: 'X', campo: 'origen_cp', constante: 'y' }] }).ok).toBe(false);
    expect(validarConfigExport({ columnas: [{ encabezado: 'X', constante: 'Cliente demo' }] }).ok).toBe(true);
  });

  it('encabezados repetidos, vacíos, sin columnas, delimitador raro, decimales fuera de rango', () => {
    expect(validarConfigExport({ columnas: [{ encabezado: 'A', campo: 'origen_cp' }, { encabezado: 'A', campo: 'destino_cp' }] }).ok).toBe(false);
    expect(validarConfigExport({ columnas: [{ encabezado: '', campo: 'origen_cp' }] }).ok).toBe(false);
    expect(validarConfigExport({ columnas: [] }).ok).toBe(false);
    expect(validarConfigExport({ delimitador: '$', columnas: [{ encabezado: 'A', campo: 'origen_cp' }] }).ok).toBe(false);
    expect(validarConfigExport({ decimales: 9, columnas: [{ encabezado: 'A', campo: 'origen_cp' }] }).ok).toBe(false);
    expect(validarConfigExport('x').ok).toBe(false);
    expect(validarConfigExport(null).ok).toBe(false);
  });

  it('una fila por documento no admite columnas de mercancía', () => {
    const r = validarConfigExport({ porMercancia: false, columnas: [{ encabezado: 'P', campo: 'mercancia.peso_kg' }] });
    expect(r.ok).toBe(false);
  });

  it('más de 80 columnas se rechaza', () => {
    const columnas = Array.from({ length: 81 }, (_, i) => ({ encabezado: `C${i}`, constante: 'x' }));
    expect(validarConfigExport({ columnas }).ok).toBe(false);
  });

  it('resolverRuta', () => {
    expect(resolverRuta('origen_cp')).toEqual({ tipo: 'doc', clave: 'origen_cp' });
    expect(resolverRuta('mercancia.peso_kg')).toEqual({ tipo: 'mercancia', clave: 'peso_kg' });
    expect(resolverRuta('documento.id')).toEqual({ tipo: 'sistema', clave: 'documento.id' });
    expect(resolverRuta('constructor')).toBeNull();
    expect(resolverRuta('mercancia.')).toBeNull();
  });
});

describe('construirFilas y CSV', () => {
  it('una fila POR MERCANCÍA, repitiendo los datos del documento', () => {
    const e = extraccionAtlasOk(); e.mercancias.push({ ...e.mercancias[0], descripcion: cv('Tapas'), peso_kg: cv('600') });
    const filas = construirFilas([aExportable(docAprobado({}, e), 'V-1')], cfg());
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({ Folio: 'ATL-20481', RFCRemitente: expect.any(String), Descripcion: 'Botellas de vidrio vacías', PesoKg: 8400, ClaveProdServCP: '24131500' });
    expect(filas[1]).toMatchObject({ Folio: 'ATL-20481', Descripcion: 'Tapas', PesoKg: 600 });
  });

  it('una fila por documento (formato de encabezado de embarque)', () => {
    const c = cfg({ porMercancia: false, columnas: [{ encabezado: 'Folio', campo: 'folio_cliente' }, { encabezado: 'Archivo', campo: 'documento.archivo' }, { encabezado: 'Viaje', campo: 'documento.viaje_folio' }] });
    const filas = construirFilas([aExportable(docAprobado(), 'V-9')], c);
    expect(filas).toEqual([{ Folio: 'ATL-20481', Archivo: 'atlas.xlsx', Viaje: 'V-9' }]);
  });

  it('un documento sin mercancías sale en UNA fila con las celdas de mercancía vacías', () => {
    const e = extraccionAtlasOk(); e.mercancias = [];
    expect(construirFilas([aExportable(docAprobado({}, e), null)], cfg())).toHaveLength(1);
  });

  it('constantes, transformaciones, decimales, fecha y booleanos', () => {
    const e = extraccionAtlasOk(); e.mercancias[0].peso_kg = cv('1234.56789'); e.mercancias[0].material_peligroso = cv('false');
    const c = cfg({
      decimales: 1, fecha: 'dd/mm/yyyy',
      columnas: [
        { encabezado: 'Cliente', constante: 'Cliente demo' },
        { encabezado: 'Remitente', campo: 'origen_nombre', transformacion: 'mayusculas' },
        { encabezado: 'Destino', campo: 'destino_nombre', transformacion: 'sin_acentos' },
        { encabezado: 'Peso', campo: 'mercancia.peso_kg' }, { encabezado: 'Salida', campo: 'fecha_salida' },
        { encabezado: 'Peligroso', campo: 'mercancia.material_peligroso' }, { encabezado: 'N', campo: 'documento.renglon' },
      ],
    });
    const [f] = construirFilas([aExportable(docAprobado({}, e), null)], c);
    expect(f).toEqual({ Cliente: 'Cliente demo', Remitente: 'DISTRIBUIDORA ATLAS SA DE CV', Destino: 'Comercializadora Monterrey SA de CV', Peso: 1234.6, Salida: '15/10/2026', Peligroso: 'No', N: 1 });
  });

  it('INYECCIÓN DE FÓRMULAS: el texto que empieza con = + - @ se neutraliza; los números no', () => {
    const e = extraccionAtlasOk();
    e.mercancias[0].descripcion = cv('=HYPERLINK("http://evil.test","x")');
    e.campos.origen_nombre = cv('+cmd|calc'); e.campos.destino_nombre = cv('@SUM(A1)'); e.campos.operador_nombre = cv('-2+3'); e.campos.unidad_placas = cv('\tTAB');
    const csv = aCsv(construirFilas([aExportable(docAprobado({}, e), null)], cfg()), cfg());
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.test"",""x"")"`);
    expect(csv).toContain("'+cmd|calc");
    expect(csv).toContain("'@SUM(A1)");
    expect(csv).toContain("'-2+3");
    expect(csv).toContain("'\tTAB");
    expect(celdaCsv(-350.5, ',')).toBe('-350.5');
    expect(celdaCsv('=1+1', ',')).toBe("'=1+1");
  });

  it('comillas, comas, saltos de línea y delimitador distinto', () => {
    expect(celdaCsv('a,b', ',')).toBe('"a,b"');
    expect(celdaCsv('a;b', ',')).toBe('a;b');
    expect(celdaCsv('a;b', ';')).toBe('"a;b"');
    expect(celdaCsv('di "hola"', ',')).toBe('"di ""hola"""');
    expect(celdaCsv('l1\nl2', ',')).toBe('"l1\nl2"');
    expect(celdaCsv(null, ',')).toBe('');
    expect(celdaCsv(Number.NaN, ',')).toBe('');
  });

  it('el CSV trae BOM, encabezados (opcionales) y CRLF', () => {
    const filas = construirFilas([aExportable(docAprobado(), null)], cfg());
    const csv = aCsv(filas, cfg());
    expect(csv.startsWith('﻿Folio,FechaSalida')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(aCsv(filas, cfg({ encabezados: false })).startsWith('﻿ATL-20481')).toBe(true);
    expect(aCsv(filas, cfg({ delimitador: '\t' })).split('\r\n')[0]).toContain('Folio\tFechaSalida');
  });

  it('JSON: {filas:[…]} con las mismas claves', () => {
    const j = JSON.parse(aJson(construirFilas([aExportable(docAprobado(), null)], cfg()))) as { filas: Array<Record<string, unknown>> };
    expect(j.filas).toHaveLength(1);
    expect(j.filas[0].PesoKg).toBe(8400);
  });
});

describe('exportarDocumentos: solo lo aprobado', () => {
  it('omite los no aprobados diciendo por qué y nombra el archivo sin caracteres raros', () => {
    const r = exportarDocumentos(
      [{ doc: docAprobado(), viajeFolio: null }, { doc: docAprobado({ id: 'd2', estado: 'por_revisar' }), viajeFolio: null }, { doc: docAprobado({ id: 'd3', extraccion: null }), viajeFolio: null }],
      'csv', cfg(), 'Flota demo — formato 1/2', new Date('2026-10-02T12:00:00Z'),
    );
    expect(r.documentos).toBe(1);
    expect(r.filas).toBe(1);
    expect(r.omitidos.map((o) => o.id)).toEqual(['d2', 'd3']);
    expect(r.omitidos[0].motivo).toMatch(/solo se exportan documentos aprobados/);
    expect(r.nombreArchivo).toBe('carta-porte-flota-demo-formato-1-2-2026-10-02.csv');
    expect(r.mime).toBe('text/csv; charset=utf-8');
  });

  it('json', () => {
    const r = exportarDocumentos([{ doc: docAprobado(), viajeFolio: null }], 'json', cfg(), 'x');
    expect(r.nombreArchivo.endsWith('.json')).toBe(true);
    expect(r.mime).toMatch(/json/);
  });

  it('xlsx: mismo contenido que el csv, nombre .xlsx, mime de Excel y solo lo aprobado', () => {
    const r = exportarDocumentos(
      [{ doc: docAprobado(), viajeFolio: null }, { doc: docAprobado({ id: 'd2', estado: 'por_revisar' }), viajeFolio: null }],
      'xlsx', cfg(), 'Estándar', new Date('2026-10-02T12:00:00Z'),
    );
    expect(r.nombreArchivo).toBe('carta-porte-estandar-2026-10-02.xlsx');
    expect(r.mime).toBe(MIME_XLSX);
    expect(r.documentos).toBe(1);
    expect(r.omitidos.map((o) => o.id)).toEqual(['d2']);
    expect(r.contenido).toBeInstanceOf(Uint8Array);
    const libro = XLSX.read(r.contenido, { type: 'array' });
    const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(libro.Sheets[libro.SheetNames[0]]);
    const csvFilas = construirFilas([aExportable(docAprobado(), null)], cfg());
    expect(filas).toHaveLength(csvFilas.length);
    expect(filas[0].PesoKg).toBe(csvFilas[0].PesoKg);
  });

  it('aXlsx: sin encabezados no los escribe, vacío es celda vacía y el texto con = va neutralizado', () => {
    const c = cfg({ encabezados: false, columnas: [{ encabezado: 'A', campo: 'origen_cp' }, { encabezado: 'B', constante: '=1+1' }, { encabezado: 'C', campo: 'distancia_km' }] });
    const libro = XLSX.read(aXlsx([{ A: '01000', B: '=1+1', C: null }], c), { type: 'array' });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    expect(hoja.A1.v).toBe('01000');
    expect(hoja.B1.v).toBe("'=1+1");
    expect(hoja.C1).toBeUndefined();
  });

  it('nombreSeguro nunca devuelve rutas ni vacío', () => {
    expect(nombreSeguro('../../etc/passwd')).toBe('etc-passwd');
    expect(nombreSeguro('///')).toBe('exportacion');
  });
});
