// Compuerta del Vigía contra el oráculo REAL (T-A4-04), solo en local.
//
// La parte real se ejecuta SOLO si LIKIDA_PROGRAMA_CSV y LIKIDA_PROGRAMA_ORACULO
// apuntan a los archivos reales (que jamás se copian al repo). Sin las variables
// el bloque se SALTA de forma explícita (`describe.skipIf`: vitest lo cuenta como
// «skipped» con su nombre, no como verde). La parte sintética corre siempre y
// prueba la propia compuerta con datos inventados.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CONTEOS_ESPERADOS, compararConOraculo, desviosDeConteos, formatearInforme, leerOraculo, main,
  medirConteos, parsearCsv,
} from '../../../../../scripts/verificar-programa-despacho';
import { construirProgramaSinteticoConOraculo, type FilaOraculo } from './fixtures';
import { leerProgramaCsv } from './lector';
import { normalizarPrograma } from './normalizar';

const RUTA_CSV = process.env.LIKIDA_PROGRAMA_CSV;
const RUTA_ORACULO = process.env.LIKIDA_PROGRAMA_ORACULO;
const HAY_DATOS_REALES = Boolean(RUTA_CSV && RUTA_ORACULO);

// ---------------------------------------------------------------------------
// Parte sintética (siempre corre)

const TRANSITO_A_TEXTO: Record<string, string> = {
  patio_nld: 'PATIO NLD', en_ruta: 'EN RUTA', pend_cruce: 'PEND CRUCE', ok: 'OK', na: 'N/A', vacio: '',
  patio_otro: 'PATIO OTRO', desconocido: 'ZZ-DESCONOCIDO',
};
const CCP_A_TEXTO: Record<string, string> = {
  listo: 'LISTO', despachado: 'DESPACHADO', pend_reque: 'PEND REQUE CCP', pend_ccp: 'PEND CCP',
  falta_complemento: 'FALTA DE COMPLEMENTO', vacio: '', desconocido: 'ZZ-DESCONOCIDO',
};

function csvOraculoDe(filas: FilaOraculo[]): string {
  const celda = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const out = ['linea_csv,fecha,seccion,bloque,#,CAJA,UNIDAD,TRANSITO,CCP'];
  for (const o of filas.filter((x) => !x.descartable)) {
    const seccion = o.tipo === 'DOMESTICO' && o.rutaSeccion ? `DOMESTICO ${o.rutaSeccion}` : o.tipo;
    out.push([
      o.lineaCsv, o.fecha, seccion, '', o.num ?? '', o.caja ?? '', o.unidad ?? '',
      TRANSITO_A_TEXTO[o.transito] ?? '', CCP_A_TEXTO[o.ccp] ?? '',
    ].map((v) => celda(String(v))).join(','));
  }
  return out.join('\n');
}

function corrida() {
  const { texto, oraculo } = construirProgramaSinteticoConOraculo({ dias: 3, filasPorSeccion: 14 });
  const lectura = leerProgramaCsv(texto, { terminal: 'GDL' });
  const programa = normalizarPrograma(lectura);
  return { texto, oraculo, lectura, programa, csvOraculo: csvOraculoDe(oraculo.filas) };
}

describe('compuerta del programa · parte sintética', () => {
  it('parsearCsv respeta comillas, comas internas y comillas dobles', () => {
    expect(parsearCsv('a,"b,c","d""e"\n1,2,3\n')).toEqual([['a', 'b,c', 'd"e'], ['1', '2', '3']]);
  });

  it('leerOraculo exige las columnas y reporta cuál falta', () => {
    expect(() => leerOraculo('linea_csv,fecha\n1,2026-10-05')).toThrow(/seccion/);
  });

  it('pipeline sobre el fixture contra su oráculo: 0 diferencias', () => {
    const { programa, csvOraculo } = corrida();
    const dif = compararConOraculo(programa.filas, leerOraculo(csvOraculo));
    expect(dif.total).toBe(0);
    expect(dif.oraculo).toBe(programa.filas.length);
  });

  it('un valor distinto se reporta por campo y por NÚMERO DE LÍNEA', () => {
    const { programa, oraculo } = corrida();
    const objetivo = oraculo.filas.find((o) => !o.descartable && o.caja !== null)!;
    const alterado = oraculo.filas.map((o) =>
      (o.lineaCsv === objetivo.lineaCsv ? { ...o, caja: 'OTRA-CAJA' } : o));
    const dif = compararConOraculo(programa.filas, leerOraculo(csvOraculoDe(alterado)));
    expect(dif.porCampo.CAJA).toEqual([objetivo.lineaCsv]);
    expect(dif.total).toBe(1);
  });

  it('una fila que el normalizador no entrega aparece como faltante; una de más, como sobrante', () => {
    const { programa, csvOraculo } = corrida();
    const sinPrimera = programa.filas.slice(1);
    const faltante = compararConOraculo(sinPrimera, leerOraculo(csvOraculo));
    expect(faltante.faltantes).toEqual([programa.filas[0].lineaCsv]);
    const filasOraculo = leerOraculo(csvOraculo).slice(1);
    const sobrante = compararConOraculo(programa.filas, filasOraculo);
    expect(sobrante.sobrantes).toEqual([programa.filas[0].lineaCsv]);
  });

  it('el informe trae solo conteos y líneas: ningún valor de celda', () => {
    const { texto, lectura, programa, oraculo } = corrida();
    const centinela = 'ZZCENTINELA77';
    const lecturaMarcada = leerProgramaCsv(texto, { terminal: 'GDL' });
    const filas = programa.filas.map((f, i) => (i === 0 ? { ...f, caja: centinela, unidad: centinela, cliente: centinela } : f));
    const dif = compararConOraculo(filas, leerOraculo(csvOraculoDe(oraculo.filas)));
    expect(dif.porCampo.CAJA.length).toBeGreaterThan(0);
    const conteos = medirConteos(filas);
    const informe = formatearInforme(lecturaMarcada, { ...programa, filas }, dif, conteos, desviosDeConteos(conteos));
    expect(informe).not.toContain(centinela);
    expect(informe).toContain('RESULTADO: DISCREPANCIA');
    expect(lectura.resumen.lineas).toBeGreaterThan(0);
  });

  it('desviosDeConteos: los esperados contra sí mismos no desvían; un cambio se nombra', () => {
    expect(desviosDeConteos(CONTEOS_ESPERADOS)).toEqual([]);
    const cambiado = { ...CONTEOS_ESPERADOS, ccpListoImportacion: 409 };
    expect(desviosDeConteos(cambiado)).toEqual(['CCP LISTO importación: medido 409, esperado 410']);
  });

  it('main sin rutas termina con código 2 y no lee nada', async () => {
    expect(await main([], {})).toBe(2);
  });

  it('main con un archivo inexistente termina con código 2', async () => {
    expect(await main(['--csv', '/no/existe.csv', '--oraculo', '/no/existe2.csv'], {})).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Parte real (solo local; se SALTA sin las dos variables)

describe.skipIf(!HAY_DATOS_REALES)(
  'compuerta del programa · oráculo real (requiere LIKIDA_PROGRAMA_CSV y LIKIDA_PROGRAMA_ORACULO)',
  () => {
    it('reproduce el oráculo: 0 diferencias y los conteos de la ficha', () => {
      const lectura = leerProgramaCsv(readFileSync(RUTA_CSV!, 'utf8'), { terminal: 'GDL' });
      const programa = normalizarPrograma(lectura);
      const dif = compararConOraculo(programa.filas, leerOraculo(readFileSync(RUTA_ORACULO!, 'utf8')));
      const desvios = desviosDeConteos(medirConteos(programa.filas));
      // Solo conteos y líneas: nunca valores de celda en el mensaje de fallo.
      expect({ total: dif.total, faltantes: dif.faltantes.length, sobrantes: dif.sobrantes.length, desvios })
        .toEqual({ total: 0, faltantes: 0, sobrantes: 0, desvios: [] });
    });
  },
);
