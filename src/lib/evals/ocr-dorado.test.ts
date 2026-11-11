import { describe, it, expect } from 'vitest';
/* eslint-disable security/detect-non-literal-fs-filename -- carpetas temporales de la propia prueba */
import { mkdtempSync, writeFileSync, readFileSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CORPUS_SINTETICO, generarCorpusOcr, huellaCorpus, renderizarSvg } from './ocr-corpus';
import { calificarCampo, esVolteoDiaMes, normalizarRfc, type CasoOcr, type LecturaOcr } from './ocr-contrato';
import { aucMannWhitney, calcularMetricas, evaluarCompuerta, informeCalibracion, lineaBaseDe } from './ocr-metricas';
import { lecturaDoble } from './ocr-doble';
import { calificarCorrida, correrLector, informeTexto, lectorDoble } from './ocr-corrida';
import { ManifiestoOcrSchema, compuertaModeloDinero, verificarDeriva } from './ocr-congelado';
import { huellaOcrViva } from './ocr-huella';
import { CORRIDA_REAL_OCR, cargarCorpusReal, permisoCorridaReal } from './ocr-real';
import { esRfcValido, rfcChecksumOk } from '@/lib/likida/intake/cfdi';

const leerManifiesto = () => ManifiestoOcrSchema.parse(JSON.parse(readFileSync(join(__dirname, 'fixtures/ocr-congelado.json'), 'utf8')));
const lec = (o: Partial<LecturaOcr> = {}): LecturaOcr => ({ concepto: 'otro', monto: 100, fecha: '2026-01-02', rfc_emisor: null, litros: null, moneda: null, documento: 'comprobante', texto_sospechoso: false, confianza: 0.95, legible: true, ...o });

describe('el corpus sintético (el repo es público)', () => {
  it('es determinista y su huella no cambia entre corridas', () => {
    expect(huellaCorpus(generarCorpusOcr())).toBe(huellaCorpus(CORPUS_SINTETICO));
  });
  it('cubre cada categoría de riesgo y trae ids únicos', () => {
    const ids = CORPUS_SINTETICO.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const cats = new Set(CORPUS_SINTETICO.map((c) => c.categoria));
    for (const c of ['inyeccion', 'ilegible', 'fecha_ambigua', 'voucher_pago', 'sin_rfc', 'moneda_extranjera', 'fecha_sin_anio']) expect(cats.has(c as never)).toBe(true);
  });
  it('no contiene RFC reales, teléfonos, correos ni nombres: todo viene marcado como sintético', () => {
    const todo = CORPUS_SINTETICO.flatMap((c) => c.lineas ?? []).join('\n');
    expect(todo).not.toMatch(/[\w.+-]+@[\w-]+\.\w+/);
    expect(todo).not.toMatch(/\b\d{10}\b/);
    for (const c of CORPUS_SINTETICO) {
      const rfc = c.esperado.rfc_emisor;
      if (rfc) {
        expect(rfc.startsWith('ZZ')).toBe(true);
        expect(esRfcValido(rfc) && rfcChecksumOk(rfc)).toBe(true);
        expect(c.lineas!.join('\n')).not.toContain(rfc); // se imprime con guiones, como el papel real
      }
      const enc = (c.lineas ?? [])[0] ?? '';
      if (!['voucher_pago', 'ilegible', 'sin_rfc'].includes(c.categoria)) expect(/SINTETICO|EJEMPLO/.test(enc)).toBe(true);
    }
  });
  it('renderiza SVG para la corrida real', () => {
    expect(renderizarSvg(CORPUS_SINTETICO[0])).toMatch(/^<svg/);
  });
});

describe('calificar un campo: 0 no es null, «no sé» no es error', () => {
  const e = (p = {}) => ({ legible: true, monto: 100, fecha: '2026-01-02', rfc_emisor: 'ZZA100101AB1', litros: null, documento: 'comprobante' as const, texto_sospechoso: false, moneda: null, concepto: 'otro' as const, ...p });
  it('acierto / error / no_se', () => {
    expect(calificarCampo('monto', e(), lec())).toBe('acierto');
    expect(calificarCampo('monto', e(), lec({ monto: 101 }))).toBe('error');
    expect(calificarCampo('monto', e(), lec({ monto: null }))).toBe('no_se');
  });
  it('un 0 donde va null es cero_por_null; otro valor es invento', () => {
    expect(calificarCampo('litros', e(), lec({ litros: 0 }))).toBe('cero_por_null');
    expect(calificarCampo('litros', e(), lec({ litros: 40 }))).toBe('invento');
    expect(calificarCampo('litros', e(), lec({ litros: null }))).toBe('acierto');
  });
  it('el RFC se compara normalizado; el concepto ausente no califica', () => {
    expect(calificarCampo('rfc_emisor', e(), lec({ rfc_emisor: 'zza-100101-ab1' }))).toBe('acierto');
    expect(normalizarRfc(' ')).toBeNull();
    expect(calificarCampo('concepto', e({ concepto: undefined }), lec())).toBe('no_califica');
  });
  it('detecta el volteo día/mes', () => {
    expect(esVolteoDiaMes('2026-08-01', '2026-01-08')).toBe(true);
    expect(esVolteoDiaMes('2026-08-01', '2026-08-01')).toBe(false);
  });
});

describe('métricas y calibración', () => {
  it('sin muestra es null, no 0', () => {
    const m = calcularMetricas([]);
    expect(m.campos.every((c) => c.exactitud === null)).toBe(true);
    expect(m.ilegiblesDetectadas).toBeNull();
  });
  it('AUC: separa perfecto = 1, empate = 0.5, falta una clase = null', () => {
    expect(aucMannWhitney([0.9, 0.95], [0.5])).toBe(1);
    expect(aucMannWhitney([0.9], [0.9])).toBe(0.5);
    expect(aucMannWhitney([0.9], [])).toBeNull();
  });
  it('con muestra chica la calibración se declara sin_muestra y no propone nada', () => {
    const r = calificarCorrida(CORPUS_SINTETICO, lecturasDe('realista'), 'doble');
    expect(r.calibracion.separa).toBe('sin_muestra');
    expect(r.calibracion.proponerEscalacion).toBe(false);
  });
  it('si TODA la confianza es alta (patrón ARRENDIA A7) y hay errores confiados, dice que no separa y propone escalación', () => {
    const casos: CasoOcr[] = Array.from({ length: 12 }, (_, i) => ({
      id: `c${i}`, origen: 'sintetico', categoria: 'caseta',
      esperado: { legible: true, concepto: 'caseta', monto: 100, fecha: '2026-01-02', rfc_emisor: null, litros: null, documento: 'comprobante', texto_sospechoso: false, moneda: null },
    }));
    const pares = casos.map((caso, i) => ({ caso, lectura: lec({ concepto: 'caseta', monto: i < 6 ? 100 : 999, confianza: 0.97 }) }));
    const cal = informeCalibracion(pares);
    expect(cal.muestraSuficiente).toBe(true);
    expect(cal.separa).toBe('no');
    expect(cal.proponerEscalacion).toBe(true);
    expect(cal.erroresQuePasan).toBe(6);
    expect(cal.notas.join(' ')).toMatch(/no distingue/);
  });
});

function lecturasDe(perfil: 'fiel' | 'realista' | 'sabotaje') {
  // los dobles son síncronos: se resuelven sin red ni reloj.
  const lecturas: Record<string, LecturaOcr> = {};
  for (const c of CORPUS_SINTETICO) lecturas[c.id] = lecturaDoble(c, perfil);
  return { lecturas, gastadoUsd: 0, detenidoPorTope: false, pendientes: [], costosNoMedidos: 0 };
}

describe('la compuerta de regresión', () => {
  const fiel = () => calificarCorrida(CORPUS_SINTETICO, lecturasDe('realista'), 'doble');
  it('el doble realista pasa', () => { expect(fiel().compuerta.veredicto).toBe('paso'); });
  it('el doble saboteado FALLA (un examen que siempre pasa no mide nada)', async () => {
    const res = await correrLector({ lector: lectorDoble('sabotaje'), casos: CORPUS_SINTETICO });
    const r = calificarCorrida(CORPUS_SINTETICO, res, 'doble');
    expect(r.compuerta.veredicto).toBe('fallo');
    const reglas = r.compuerta.hallazgos.map((h) => h.regla);
    expect(reglas).toEqual(expect.arrayContaining(['piso', 'cero_por_null', 'error_confiado', 'inyeccion', 'ilegible']));
  });
  it('un importe equivocado con confianza alta falla aunque el piso se cumpla', async () => {
    const res = await correrLector({ lector: lectorDoble('fiel'), casos: CORPUS_SINTETICO });
    const id = CORPUS_SINTETICO.find((c) => c.categoria === 'caseta')!.id;
    res.lecturas[id] = { ...res.lecturas[id], monto: (res.lecturas[id].monto ?? 0) + 5, confianza: 0.97 };
    const r = calificarCorrida(CORPUS_SINTETICO, res, 'doble');
    expect(r.metricas.erroresConfiadosDeImporte).toBe(1);
    expect(r.compuerta.veredicto).toBe('fallo');
  });
  it('regresión contra la línea base: bajar una exactitud, aunque siga sobre el piso, falla', () => {
    const base = lineaBaseDe(calcularMetricas(CORPUS_SINTETICO.map((caso) => ({ caso, lectura: lecturaDoble(caso, 'fiel') }))));
    const m = calcularMetricas(CORPUS_SINTETICO.map((caso) => ({ caso, lectura: lecturaDoble(caso, 'realista') })));
    const v = evaluarCompuerta(m, informeCalibracion([]), base);
    expect(v.hallazgos.some((h) => h.regla === 'regresion')).toBe(true);
    expect(v.veredicto).toBe('fallo');
  });
  it('el informe se imprime con su origen y su muestra', () => {
    const t = informeTexto(fiel());
    expect(t).toMatch(/DOBLE/);
    expect(t).toMatch(/Muestra: 35/);
  });
});

describe('--check de deriva (corre en CI, sin red)', () => {
  it('el congelado coincide con el prompt, el modelo, el esquema y el corpus vivos', () => {
    const m = leerManifiesto();
    const r = verificarDeriva(m, huellaOcrViva(CORPUS_SINTETICO), CORPUS_SINTETICO);
    expect(r.diferencias).toEqual([]);
  });
  it('falla si cambia el prompt, el modelo, el esquema o el corpus sin re-congelar', () => {
    const m = leerManifiesto();
    const viva = huellaOcrViva(CORPUS_SINTETICO);
    expect(verificarDeriva(m, { ...viva, prompt: 'a'.repeat(64) }, CORPUS_SINTETICO).diferencias[0]).toMatch(/PROMPT/);
    expect(verificarDeriva(m, { ...viva, modelo: 'otro/modelo' }, CORPUS_SINTETICO).diferencias[0]).toMatch(/MODELO/);
    expect(verificarDeriva(m, { ...viva, esquema: 'b'.repeat(64) }, CORPUS_SINTETICO).diferencias[0]).toMatch(/ESQUEMA/);
    const otro = [...CORPUS_SINTETICO.slice(1)];
    expect(verificarDeriva(m, huellaOcrViva(otro), otro).ok).toBe(false);
  });
});

describe('un slug de dinero sin examen REAL vigente queda bloqueado', () => {
  const m = leerManifiesto();
  const q = { rol: 'ocr', slug: m.huella.modelo, promptSha: m.huella.prompt };
  it('hoy el congelado es de un doble: no certifica a nadie', () => {
    expect(m.origen).toBe('doble');
    const d = compuertaModeloDinero(m, q);
    expect(d.aceptado).toBe(false);
    expect(d.razon).toMatch(/doble/);
  });
  it('sin examen: bloqueado; en modo advertir se acepta pero con la razón', () => {
    expect(compuertaModeloDinero(null, q).aceptado).toBe(false);
    const a = compuertaModeloDinero(null, q, 'advertir');
    expect(a.aceptado).toBe(true);
    expect(a.certificadoPorExamenReal).toBe(false);
  });
  it('con examen real vigente, mismo slug y mismo prompt: aceptado; otro slug o prompt cambiado: no', () => {
    const real = { ...m, origen: 'real' as const, veredicto: 'paso' as const };
    expect(compuertaModeloDinero(real, q).aceptado).toBe(true);
    expect(compuertaModeloDinero(real, { ...q, slug: 'otro/modelo' }).aceptado).toBe(false);
    expect(compuertaModeloDinero(real, { ...q, promptSha: 'c'.repeat(64) }).aceptado).toBe(false);
    expect(compuertaModeloDinero({ ...real, veredicto: 'revisar' }, q).aceptado).toBe(false);
  });
});

describe('la corrida real: apagada y con tope duro', () => {
  it('hoy está apagada y sin tope declarado', () => {
    expect(CORRIDA_REAL_OCR.habilitada).toBe(false);
    expect(CORRIDA_REAL_OCR.topeMaximoUsd).toBeNull();
    expect(permisoCorridaReal(1, { LIKIDA_EVAL_OCR_REAL: '1' }).permitido).toBe(false);
  });
  it('encendida exige --max-usd, no pasarse del tope del dueño y la confirmación del entorno', () => {
    const decl = { habilitada: true, topeMaximoUsd: 2 };
    const env = { LIKIDA_EVAL_OCR_REAL: '1' };
    expect(permisoCorridaReal(undefined, env, decl).permitido).toBe(false);
    expect(permisoCorridaReal(0, env, decl).permitido).toBe(false);
    expect(permisoCorridaReal(3, env, decl).permitido).toBe(false);
    expect(permisoCorridaReal(1, {}, decl).permitido).toBe(false);
    expect(permisoCorridaReal(1, env, decl)).toEqual({ permitido: true, razon: null, maxUsd: 1 });
  });
  it('se detiene al llegar a --max-usd (proveedor simulado) y no certifica', async () => {
    let llamadas = 0;
    const res = await correrLector({
      casos: CORPUS_SINTETICO, maxUsd: 0.01, costoEstimadoUsd: 0.004,
      lector: async (c) => { llamadas += 1; return { lectura: lecturaDoble(c, 'fiel'), costoUsd: 0.004 }; },
    });
    expect(llamadas).toBe(2); // 0.004 + 0.004 = 0.008; una tercera pasaría de 0.01
    expect(res.detenidoPorTope).toBe(true);
    expect(res.gastadoUsd).toBeCloseTo(0.008, 6);
    expect(res.pendientes.length).toBe(CORPUS_SINTETICO.length - 2);
    const r = calificarCorrida(CORPUS_SINTETICO, res, 'sintetico_real');
    expect(r.compuerta.veredicto).not.toBe('paso');
  });
  it('un costo no medido NO es cero: se carga la estimación', async () => {
    const res = await correrLector({
      casos: CORPUS_SINTETICO, maxUsd: 0.01, costoEstimadoUsd: 0.004,
      lector: async (c) => ({ lectura: lecturaDoble(c, 'fiel'), noMedido: true }),
    });
    expect(res.costosNoMedidos).toBe(2);
    expect(res.detenidoPorTope).toBe(true);
  });
});

describe('el corpus real vive FUERA de git', () => {
  it('rechaza una carpeta dentro del repo', () => {
    const dentro = mkdtempSync(join(process.cwd(), 'tmp-ocr-real-'));
    try {
      expect(() => cargarCorpusReal(dentro, process.cwd())).toThrow(/dentro del repo/);
    } finally {
      // limpieza: carpeta vacía creada por esta prueba
      rmdirSync(dentro);
    }
  });
  it('carga un manifest válido desde fuera del repo y exige que existan las imágenes', () => {
    const fuera = mkdtempSync(join(tmpdir(), 'ocr-real-'));
    const esperado = { legible: true, monto: 10, fecha: null, rfc_emisor: null, litros: null, documento: 'comprobante', texto_sospechoso: false, moneda: null };
    writeFileSync(join(fuera, 'manifest.json'), JSON.stringify({ redactadoPor: 'prueba', redactadoEn: '2026-11-10', casos: [{ id: 'r1', categoria: 'caseta', imagen: 'r1.jpg', esperado }] }));
    expect(() => cargarCorpusReal(fuera, process.cwd())).toThrow(/falta la imagen/);
    writeFileSync(join(fuera, 'r1.jpg'), 'x');
    const casos = cargarCorpusReal(fuera, process.cwd());
    expect(casos[0].origen).toBe('real');
    expect(casos[0].imagenPath).toContain('r1.jpg');
  });
  it('rechaza rutas de imagen que escapan de la carpeta', () => {
    const fuera = mkdtempSync(join(tmpdir(), 'ocr-real-'));
    const esperado = { legible: true, monto: 10, fecha: null, rfc_emisor: null, litros: null, documento: 'comprobante', texto_sospechoso: false, moneda: null };
    writeFileSync(join(fuera, 'manifest.json'), JSON.stringify({ redactadoPor: 'p', redactadoEn: '2026-11-10', casos: [{ id: 'r1', categoria: 'caseta', imagen: '../x.jpg', esperado }] }));
    expect(() => cargarCorpusReal(fuera, process.cwd())).toThrow();
  });
});
