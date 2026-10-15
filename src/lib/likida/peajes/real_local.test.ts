// ═══════════════════════════════════════════════════════════════════════════
// ARNÉS LOCAL: verifica el importador de peajes contra los xlsx REALES del mes.
//
// Se SALTA si no existe la variable PEAJES_REAL_DIR (así en CI aparece como `skipped`).
// Este archivo NO contiene ninguna cifra del cliente: los números esperados viven FUERA
// del repo, en un JSON (PEAJES_REAL_ESPERADO; por defecto
// ~/likida-loop/cinco-agentes/local/peajes/esperado.json).
//
// Comando:
//   PEAJES_REAL_DIR=<carpeta con los .xlsx> ~/likida-loop/heavy.sh npx vitest run \
//     src/lib/likida/peajes/real_local.test.ts
//
// Usa la misma ruta de código que el importador: parsearArchivoDesglose → periodoDeNombreArchivo
// → revisarCobros → cierreMensual. La salida imprime solo agregados: sin tags ni unidades.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsearArchivoDesglose, type LineaDesgloseParseada, type CalidadArchivo } from '../intake/desglose_peaje';
import { revisarCobros, CLASES_VALIDAS_DEFAULT } from './reglas_cobro';
import { periodoDeNombreArchivo } from './periodo';
import { cierreMensual, type CierreMensual } from './cierre_mensual';

const DIR = process.env.PEAJES_REAL_DIR ?? '';
const ESPERADO_RUTA = process.env.PEAJES_REAL_ESPERADO
  ?? path.join(os.homedir(), 'likida-loop/cinco-agentes/local/peajes/esperado.json');
const hay = DIR !== '' && fs.existsSync(DIR);
const r2 = (n: number) => Math.round(n * 100) / 100;

interface Esperado {
  mes: string;
  total: {
    cruces: number; monto: number; unidades: number;
    extemporaneos: number; extemporaneosMonto: number; extemporaneosMesAnterior: number;
    clasesCandidatas: number; clasesCandidatasMonto: number;
    duplicadosExactos: number; repetidosEntreArchivos: number;
  };
  porArchivo?: Record<string, { cruces: number; monto: number; hojaLeida: string }>;
}
interface Leido { nombre: string; lineas: LineaDesgloseParseada[]; calidad: CalidadArchivo; avisos: string[] }

describe.skipIf(!hay)('arnés local: peajes con los xlsx reales', () => {
  let esperado: Esperado;
  const leidos: Leido[] = [];
  const agg = {
    cruces: 0, monto: 0, unidades: new Set<string>(), ext: 0, extMonto: 0, extMesAnt: 0,
    clasesCand: 0, clasesCandMonto: 0, dup: 0,
  };
  let cierre: CierreMensual;

  beforeAll(async () => {
    esperado = JSON.parse(fs.readFileSync(ESPERADO_RUTA, 'utf8')) as Esperado;
    const archivos = fs.readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.xlsx')).sort();
    const paraCierre = [];
    for (const f of archivos) {
      const r = await parsearArchivoDesglose(f, fs.readFileSync(path.join(DIR, f)));
      if (!r.ok) throw new Error(`No se pudo leer ${f}: ${r.motivo}`);
      leidos.push({ nombre: f, lineas: r.lineas, calidad: r.calidad, avisos: r.avisos });
      const per = periodoDeNombreArchivo(f, r.lineas.map((l) => l.fecha));
      const rev = revisarCobros(
        r.lineas.map((l) => ({ indice: l.indice, fecha: l.fecha, hora: l.hora ?? null, caseta: l.caseta, tag: l.tag, unidad: l.unidad ?? null, clase: l.clase, monto: l.monto })),
        { periodoDesde: per?.desde ?? null },
      );
      agg.cruces += r.lineas.length;
      for (const l of r.lineas) {
        agg.monto += l.monto;
        if (l.unidad) agg.unidades.add(l.unidad);
        if (l.clase != null && !(CLASES_VALIDAS_DEFAULT as readonly number[]).includes(l.clase) && l.clase !== 1) {
          agg.clasesCand++; agg.clasesCandMonto += l.monto;
        }
      }
      agg.ext += rev.porCategoria.extemporaneo.n;
      agg.extMonto += rev.porCategoria.extemporaneo.monto;
      agg.dup += rev.porCategoria.duplicado_exacto.n;
      const mesDeEsp = esperado.mes;
      agg.extMesAnt += rev.candidatos.filter((c) => c.categoria === 'extemporaneo' && (c.fecha ?? '') < `${mesDeEsp}-01`).length;
      paraCierre.push({ id: f, etiqueta: f, periodoDesde: per?.desde ?? null, periodoHasta: per?.hasta ?? null, lineas: r.lineas });
    }
    const c = cierreMensual(esperado.mes, paraCierre);
    if ('error' in c) throw new Error(c.error);
    cierre = c;
    // Resumen sin tags ni unidades.
    // eslint-disable-next-line no-console
    console.log(`[real_local] archivos=${leidos.length} cruces=${agg.cruces} monto=${r2(agg.monto)} unidades=${agg.unidades.size} extemporaneos=${agg.ext}/${r2(agg.extMonto)} (mes anterior ${agg.extMesAnt}) clasesCandidatas=${agg.clasesCand}/${r2(agg.clasesCandMonto)} duplicadosExactos=${agg.dup} repetidosEntreArchivos=${cierre.repetidosEntreArchivos.length}`);
    for (const l of leidos) {
      // eslint-disable-next-line no-console
      console.log(`[real_local] ${l.nombre}: cruces=${l.lineas.length} monto=${r2(l.lineas.reduce((s, x) => s + x.monto, 0))} hoja=${l.calidad.hojaLeida} ignoradas=${l.calidad.hojasIgnoradas.length}`);
    }
  }, 180_000);

  it('hay archivos y el esperado declara su mes', () => {
    expect(leidos.length).toBeGreaterThan(0);
    expect(esperado.mes).toMatch(/^\d{4}-\d{2}$/);
  });

  it('número de cruces total', () => { expect(agg.cruces).toBe(esperado.total.cruces); });
  // El esperado viene redondeado al peso: tolerancia de medio peso.
  it('suma de importes total', () => { expect(Math.abs(agg.monto - esperado.total.monto)).toBeLessThan(0.5); });
  it('unidades distintas', () => { expect(agg.unidades.size).toBe(esperado.total.unidades); });

  it('cruces e importe por archivo (si el esperado los declara)', () => {
    const por = esperado.porArchivo;
    if (!por) return;
    expect(Object.keys(por).sort()).toEqual(leidos.map((l) => l.nombre).sort());
    for (const l of leidos) {
      expect(l.lineas.length, l.nombre).toBe(por[l.nombre].cruces);
      expect(Math.abs(l.lineas.reduce((s, x) => s + x.monto, 0) - por[l.nombre].monto), l.nombre).toBeLessThan(0.5);
    }
  });

  it('lee solo la hoja principal y la secundaria se ignora (no se duplica)', () => {
    for (const l of leidos) {
      expect(l.calidad.hojaLeida, l.nombre).not.toBeNull();
      if (esperado.porArchivo) expect(l.calidad.hojaLeida, l.nombre).toBe(esperado.porArchivo[l.nombre].hojaLeida);
      expect(l.calidad.lineasImportadas, l.nombre).toBe(l.lineas.length);
    }
    expect(leidos.some((l) => l.calidad.hojasIgnoradas.length > 0)).toBe(true);
  });

  it('extemporáneos (cantidad e importe) por regla de periodo del nombre de archivo', () => {
    expect(agg.ext).toBe(esperado.total.extemporaneos);
    expect(Math.abs(agg.extMonto - esperado.total.extemporaneosMonto)).toBeLessThan(0.5);
    expect(agg.extMesAnt).toBe(esperado.total.extemporaneosMesAnterior);
  });

  it('clases fuera de {3,5} sin las de clase 1 y 3: cantidad e importe', () => {
    expect(agg.clasesCand).toBe(esperado.total.clasesCandidatas);
    expect(Math.abs(agg.clasesCandMonto - esperado.total.clasesCandidatasMonto)).toBeLessThan(0.5);
  });

  it('duplicados exactos = lo esperado', () => { expect(agg.dup).toBe(esperado.total.duplicadosExactos); });

  it('claves repetidas entre archivos = lo esperado', () => {
    expect(cierre.repetidosEntreArchivos.length).toBe(esperado.total.repetidosEntreArchivos);
  });
});
