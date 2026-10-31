/* eslint-disable security/detect-non-literal-fs-filename -- recorre el propio árbol src/ del repo; ninguna ruta viene de entrada externa. */
// GUARDA GLOBAL ANTI-FÓRMULAS EN CSV (lote L6, criterio «CSV con guarda anti-inyección en TODOS los exports»).
//
// 1) Barrido estructural: todo archivo de producción que ESCAPA comillas de CSV (`replace(/"/g, '""')`) —o sea, que serializa
//    celdas— tiene que neutralizar también las fórmulas (el patrón `[=+\-@\t\r]` o el módulo `csv_seguro`). Un exportador nuevo
//    que olvide la guarda hace fallar esta prueba, no un auditor seis meses después.
// 2) Comportamiento: cada exportador real recibe cargas hostiles y NINGUNA celda de texto sale empezando con = + - @ tab o CR.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fuentesDeProduccion, sinComentarios } from '@/lib/pruebas/codigo';
import { toCsv } from '@/lib/likida/export';
import { tablaConfigurable } from '@/lib/likida/export_configurable';
import { aContpaqi, aSapB1, archivoContpaqi, archivoSapB1, SAP_B1_BASE } from '@/lib/likida/contabilidad/formatos';
import type { Poliza } from '@/lib/likida/contabilidad/poliza';
import { celdaCsv as celdaEstadias } from '@/lib/likida/conductor/estadias_anden';
import { csvTextosSinSitio } from '@/lib/likida/conductor/sitios';
import { aCsv } from '@/lib/likida/carta_porte_docs/multiembarque';
import { plantillaCsv } from '@/lib/likida/importacion/archivo';
import { csvDeProblemas } from '@/app/dashboard/importador-masivo';
import { celdaCsv as celdaProspectos } from '@/app/admin/mapa-prospectos/csv_prospectos';
import { PAYLOADS_HOSTILES } from '@/lib/pruebas/cargas_hostiles_csv';

const RAIZ = new URL('../', import.meta.url).pathname.replace(/\/$/, '');

/** Serializadores que escapan comillas SIN guarda propia, con la razón por la que no la necesitan. */
const EXENTOS: Record<string, string> = {
  'lib/likida/liquidacion_externa/importar_archivo.ts': 'Re-serializa la hoja SUBIDA a texto para el lector interno (no es una descarga): nadie la abre en una hoja de cálculo.',
  'lib/likida/carta_porte_docs/catalogo_distancias.ts': 'Plantilla descargable con una fila de ejemplo CONSTANTE del código; ningún texto del usuario entra.',
  'lib/likida/carta_porte_docs/documentos_sinteticos.fixture.ts': 'Fixture sintético de pruebas.',
};

describe('barrido 2: serializadores que unen celdas con join(\',\') sin escapar', () => {
  // Un archivo que arma CSV con `.join(',')` (o con `;`/tab) y habla de CSV tiene que pasar por una guarda; si no, una celda con = + - @ viaja intacta.
  const SOSPECHOSO = /\.join\((['"])[,;]\1\)/;
  const HABLA_DE_CSV = /text\/csv|\.csv|Csv|CSV/;
  const GUARDA = /\[=\+\\-@\\t\\r\]|csv_seguro|toCsv|celdaCsv|celdaTexto|tablaConfigurable|csvCell/;
  /** Usos de join(',') que NO son un archivo CSV (listas para texto, claves, logs). */
  const NO_ES_CSV = new Set<string>([
    'app/dashboard/agentes/vigia/avisos/page.tsx', 'app/api/cron/facturar/lote.ts',
    'lib/likida/vigia/programa/fixtures.ts', // fixtures sintéticos de pruebas
    'lib/likida/vigia/programa/lector_xlsx.ts', // re-serializa el XLSX SUBIDO a texto para el lector interno; no es una descarga
  ]);
  const candidatos = fuentesDeProduccion(RAIZ)
    .map((f) => ({ rel: f.slice(RAIZ.length + 1), codigo: sinComentarios(readFileSync(f, 'utf8')) }))
    .filter(({ codigo }) => SOSPECHOSO.test(codigo) && HABLA_DE_CSV.test(codigo));
  it('todo archivo que une celdas con coma y habla de CSV tiene guarda (o está declarado como no-CSV)', () => {
    const sin = candidatos.filter(({ rel, codigo }) => !GUARDA.test(codigo) && !NO_ES_CSV.has(rel)).map((c) => c.rel);
    expect(sin, `serializan con join(',') sin ninguna guarda anti-fórmulas; usa lib/csv_seguro.ts: ${sin.join(', ')}`).toEqual([]);
  });
  it('(control) el detector sí ve un join(\',\') con CSV y sin guarda', () => {
    const cuerpo = "const csv = filas.map((f) => f.join(','));  // text/csv";
    expect(SOSPECHOSO.test(cuerpo) && HABLA_DE_CSV.test(cuerpo) && !GUARDA.test(cuerpo)).toBe(true);
  });
});

describe('barrido: todo serializador de CSV neutraliza fórmulas', () => {
  const archivos = fuentesDeProduccion(RAIZ)
    .map((f) => ({ f, rel: f.slice(RAIZ.length + 1), codigo: sinComentarios(readFileSync(f, 'utf8')) }))
    .filter(({ codigo }) => /replace\(\/"\/g,\s*['"]""['"]\)|replaceAll\('"',\s*'""'\)/.test(codigo));

  it('encuentra los serializadores conocidos (la prueba no está ciega)', () => {
    const rels = archivos.map((a) => a.rel);
    for (const esperado of ['lib/likida/export.ts', 'lib/likida/export_configurable.ts', 'lib/csv_seguro.ts', 'lib/likida/carta_porte_docs/multiembarque.ts', 'app/dashboard/importador-masivo.tsx']) {
      expect(rels, esperado).toContain(esperado);
    }
  });

  it.each(archivos.map((a) => [a.rel, a.codigo] as const))('%s aplica la guarda', (rel, codigo) => {
    if (EXENTOS[rel]) return;
    const guarda = /\[=\+\\-@\\t\\r\]/.test(codigo) || /csv_seguro/.test(codigo);
    expect(guarda, `${rel} serializa CSV (escapa comillas) sin neutralizar = + - @ tab CR; usa lib/csv_seguro.ts`).toBe(true);
  });

  it('las exenciones siguen apuntando a archivos que existen y que de verdad serializan', () => {
    const rels = new Set(archivos.map((a) => a.rel));
    for (const rel of Object.keys(EXENTOS)) expect(rels.has(rel), `exención obsoleta: ${rel}`).toBe(true);
  });
});

/** Parte un CSV (RFC 4180, con comillas dobles) en filas de celdas, sin asumir nada del exportador. */
function partir(texto: string, sep = ','): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [], celda = '', dentro = false;
  const t = texto.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (dentro) {
      if (c === '"' && t[i + 1] === '"') { celda += '"'; i++; } else if (c === '"') dentro = false; else celda += c;
    } else if (c === '"') dentro = true;
    else if (c === sep) { fila.push(celda); celda = ''; }
    else if (c === '\n') { fila.push(celda); filas.push(fila); fila = []; celda = ''; }
    else if (c === '\r' && t[i + 1] === '\n') { /* CRLF */ }
    else celda += c;
  }
  if (celda !== '' || fila.length) { fila.push(celda); filas.push(fila); }
  return filas;
}
const FORMULA = /^[=+\-@\t\r]/;
/** Un número plano («-12.50», «-12,50», «340») no es fórmula. */
const ENTERO = /^-?\d+$/;
const DECIMAL = /^-?\d+[.,]\d+$/;
const esNumero = (c: string) => ENTERO.test(c) || DECIMAL.test(c);
function sinFormulas(csv: string, sep = ',', permitidas: (c: string) => boolean = esNumero) {
  return partir(csv, sep).flat().filter((c) => FORMULA.test(c) && !permitidas(c));
}

describe('comportamiento: cargas hostiles en cada exportador real', () => {
  it('toCsv (facturas, liquidaciones, peajes, jornada, buzón al contador)', () => {
    const filas = PAYLOADS_HOSTILES.map((p, i) => ({ folio: `V-${i}`, concepto: p, total: -100.5 }));
    const csv = toCsv(filas);
    expect(sinFormulas(csv)).toEqual([]);
    expect(csv).toContain('-100.5'); // los números negativos legítimos NO se tocan
    expect(partir(csv).length).toBeGreaterThan(PAYLOADS_HOSTILES.length); // encabezado + una fila por carga
  });

  it('tablaConfigurable (export configurable, vigía)', () => {
    for (const separador of ['coma', 'punto_y_coma', 'tab'] as const) {
      const csv = tablaConfigurable(['a', 'b'], PAYLOADS_HOSTILES.map((p) => [p, -3]), { separador, decimal: 'punto', fechas: 'iso', encabezado: true, bom: false });
      const sep = { coma: ',', punto_y_coma: ';', tab: '\t' }[separador];
      expect(sinFormulas(csv, sep), separador).toEqual([]);
    }
  });

  it('CONTPAQi y SAP B1 (concepto y referencia vienen de CFDI ajenos); los importes negativos se respetan', () => {
    const poliza: Poliza = {
      fecha: '2026-10-31', concepto: PAYLOADS_HOSTILES[0],
      movimientos: PAYLOADS_HOSTILES.map((p, i) => ({ cuenta: i === 0 ? p : '5010-001', cargo: i === 0 ? 0 : 10, abono: i === 0 ? 10 : 0, concepto: p, referencia: PAYLOADS_HOSTILES[(i + 1) % PAYLOADS_HOSTILES.length] })),
    };
    const contpaqi = [aContpaqi(poliza, { tipo: 'Dr', numero: 1 }), archivoContpaqi([poliza], { tipo: 'Dr', numeroInicial: 1 })];
    for (const csv of contpaqi) expect(sinFormulas(csv)).toEqual([]);
    const sap = [aSapB1(poliza), archivoSapB1([poliza], SAP_B1_BASE)];
    for (const a of sap) for (const csv of [a.cabecera, a.lineas]) {
      const cuerpo = csv.split('\n').slice(0, -1).filter((l) => !/^(JdtNum)/.test(l)).join('\n') + '\n';
      expect(sinFormulas(cuerpo, '\t')).toEqual([]);
    }
    expect(aContpaqi({ ...poliza, movimientos: [{ cuenta: '5010-001', cargo: 10, abono: 0, concepto: 'ok', referencia: 'r' }] }, { tipo: 'Dr', numero: 1 })).toContain('10.00');
  });

  it('estadías, textos sin sitio, errores de importación y plantilla', () => {
    for (const p of PAYLOADS_HOSTILES) {
      expect(sinFormulas(celdaEstadias(p))).toEqual([]);
      expect(sinFormulas(celdaProspectos(p))).toEqual([]);
    }
    expect(celdaEstadias(-5)).toBe('-5');
    expect(celdaProspectos(-99.1)).toBe('"-99.1"'); // número: sin apóstrofo (queda entrecomillado, que sigue siendo número en Excel)
    expect(sinFormulas(csvTextosSinSitio(PAYLOADS_HOSTILES.map((t) => ({ texto: t, textoNormalizado: t.toLowerCase(), lado: 'origen' as const, frecuencia: 2 }))))).toEqual([]);
    expect(sinFormulas(csvDeProblemas(PAYLOADS_HOSTILES.map((m, i) => ({ fila: i + 1, motivo: m }))))).toEqual([]);
    expect(sinFormulas(plantillaCsv(['a', 'b'], PAYLOADS_HOSTILES.slice(0, 2) as unknown as string[]))).toEqual([]);
  });

  it('CSV derivado de embarques (multiembarque): antes «-2+3+cmd|…» pasaba porque solo se vigilaba «-letra»', () => {
    const csv = aCsv(['folio', 'texto'], PAYLOADS_HOSTILES.map((p, i) => [`E-${i}`, p]));
    expect(sinFormulas(csv)).toEqual([]);
    expect(partir(aCsv(['n'], [['-12.5'], ['-2+3']])).flat()).toEqual(['n', '-12.5', "'-2+3"]);
  });

  it('(control) la prueba SÍ ve una fórmula sin neutralizar', () => {
    expect(sinFormulas('a,b\n=1+1,ok\n')).toEqual(['=1+1']);
  });
});
