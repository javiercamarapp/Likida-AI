/* eslint-disable security/detect-non-literal-fs-filename -- prueba que lee/escribe rutas del propio repo o de un directorio temporal; ninguna ruta ni patrón viene de entrada de usuario. */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cv } from '../documentos_sinteticos.fixture';
import type { Extraccion } from '../campos';
import { MUESTRAS, RFC_DORADO, catalogoM3, correrMuestra, guionM4, type IdMuestra, type MuestraDorada } from './dorado.fixture';
import { MATRIZ_DORADA, MATRIZ_M3_CON_CATALOGO } from './esperados';
import { MARCA_DE, diferenciasConMatriz, esConversionNumerica, evaluar, resumir, tablaResumen, type CampoEsperado } from './evaluar';

const muestra = (id: IdMuestra): MuestraDorada => MUESTRAS.find((m) => m.id === id) as MuestraDorada;

async function evaluarMuestra(id: IdMuestra, op: Parameters<typeof correrMuestra>[1] = {}, matriz: ReadonlyArray<CampoEsperado> = MATRIZ_DORADA[id]) {
  const corrida = await correrMuestra(muestra(id), op);
  const ev = evaluar(corrida.extraccion, matriz);
  return { corrida, ev, resumen: resumir(ev, matriz), matriz };
}

describe('evaluar (pura): ✔ ◐ ✗', () => {
  const esperado = (campo: string, valor: string | null, estado: CampoEsperado['estado'] = 'ok'): CampoEsperado[] => [{ campo, valor, estado }];
  const ext = (campos: Extraccion['campos'], mercancias: Extraccion['mercancias'] = []): Extraccion => ({ campos, mercancias });

  it('valor igual, confianza suficiente y sin hallazgos → ✔', () => {
    const r = evaluar(ext({ origen_rfc: cv(RFC_DORADO.m1Remitente, 0.97) }), esperado('origen_rfc', RFC_DORADO.m1Remitente));
    expect(r.origen_rfc.estado).toBe('✔');
  });
  it('ausente → ✗ «ausente»; distinto → ✗ «distinto» (el error silencioso)', () => {
    expect(evaluar(ext({}), esperado('origen_rfc', RFC_DORADO.m1Remitente)).origen_rfc).toEqual({ estado: '✗', motivo: 'ausente' });
    const d = evaluar(ext({ origen_cp: cv('66001', 0.99) }), esperado('origen_cp', '66000')).origen_cp;
    expect(d.estado).toBe('✗');
    expect(d.motivo).toMatch(/distinto: leí «66001», esperaba «66000»/);
  });
  it('igual pero con confianza por debajo del umbral de los críticos → ◐', () => {
    const r = evaluar(ext({ origen_rfc: cv(RFC_DORADO.m1Remitente, 0.7) }), esperado('origen_rfc', RFC_DORADO.m1Remitente, 'revisar')).origen_rfc;
    expect(r.estado).toBe('◐');
    expect(r.motivo).toMatch(/confianza 70 %/);
  });
  it('igual pero con un hallazgo de la validación sobre ese campo → ◐', () => {
    const r = evaluar(ext({ destino_rfc: cv('581234567', 0.97) }), esperado('destino_rfc', '581234567', 'revisar')).destino_rfc;
    expect(r.estado).toBe('◐');
    expect(r.motivo).toMatch(/bloqueo: rfc_forma/);
  });
  it('un número que no es el literal del documento («812,35 km», libras) es conversión → ◐; el literal exacto no', () => {
    expect(esConversionNumerica({ clave: 'distancia_km', rotulo: '', grupo: 'documento', tipo: 'numero', critico: false, max: 12 }, { valor: '812.35', confianza: 0.95, evidencia: '812,35 km', origen: 'llm' })).toBe(true);
    expect(esConversionNumerica({ clave: 'peso_kg', rotulo: '', grupo: 'carga', tipo: 'numero', critico: true, max: 14 }, { valor: '1275.36', confianza: 0.97, evidencia: '01 LL-C01 80 PZA 1275.360 KG', origen: 'llm' })).toBe(false);
    const r = evaluar(ext({ distancia_km: cv('812.35', 0.95, 'llm', '812,35 km') }), esperado('distancia_km', '812.35', 'revisar')).distancia_km;
    expect(r.estado).toBe('◐');
    expect(r.motivo).toMatch(/conversión/);
  });
  it('el renglón de mercancía se evalúa como mercancias[i].clave y n_mercancias cuenta renglones', () => {
    const e = ext({}, [{ cantidad: cv('52', 0.97) }, { cantidad: cv('12', 0.97) }]);
    const r = evaluar(e, [{ campo: 'mercancias[0].cantidad', valor: '52', estado: 'ok' }, { campo: 'n_mercancias', valor: '3', estado: 'ok' }]);
    expect(r['mercancias[0].cantidad'].estado).toBe('✔');
    expect(r.n_mercancias.estado).toBe('✗');
  });
  it('resumir cuenta ✔ ◐ ✗, el % de lo que la forma trae limpio y los críticos fallidos', () => {
    const esp: CampoEsperado[] = [
      { campo: 'origen_rfc', valor: RFC_DORADO.m1Remitente, estado: 'ok' },
      { campo: 'destino_rfc', valor: null, estado: 'falta' },
      { campo: 'distancia_km', valor: '812.35', estado: 'revisar' },
    ];
    const ev = evaluar(ext({ origen_rfc: cv(RFC_DORADO.m1Remitente, 0.97), distancia_km: cv('812.35', 0.95, 'llm', '812,35 km') }), esp);
    expect(resumir(ev, esp)).toMatchObject({ total: 3, ok: 1, revisar: 1, falta: 1, pctOk: 33.3, pctRevisar: 33.3, pctFalta: 33.3, traidos: 1, pctOkDeTraidos: 100, criticosFallidos: ['destino_rfc'] });
  });
});

describe('conjunto dorado: cada muestra coincide con su matriz esperada (congelada)', () => {
  it.each(MUESTRAS.map((m) => [m.id, m.forma] as const))('%s · %s', async (id) => {
    const { ev, matriz } = await evaluarMuestra(id);
    expect(diferenciasConMatriz(ev, matriz)).toEqual([]);
    for (const c of matriz) if (c.campo !== 'n_mercancias') expect(ev[c.campo].estado).toBe(MARCA_DE[c.estado]);
  });

  it('la matriz tiene lo mismo para las 5 muestras y ningún valor real (todo con la forma, nada del documento)', () => {
    expect(Object.keys(MATRIZ_DORADA)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5']);
    for (const id of Object.keys(MATRIZ_DORADA) as IdMuestra[]) {
      const campos = MATRIZ_DORADA[id].map((c) => c.campo);
      expect(new Set(campos).size).toBe(campos.length);
      expect(campos).toEqual(expect.arrayContaining(['origen_rfc', 'destino_rfc', 'distancia_km', 'mercancias[0].peso_kg', 'mercancias[0].valor_mercancia', 'n_mercancias']));
    }
  });

  it('el valor de mercancía es ✗ en las 5 (ninguna forma lo trae) y la distancia sólo la trae M2', async () => {
    for (const m of MUESTRAS) {
      const { ev } = await evaluarMuestra(m.id);
      expect(ev['mercancias[0].valor_mercancia'].estado).toBe('✗');
      expect(ev.distancia_km.estado).toBe(m.id === 'M2' ? '◐' : '✗');
    }
  });
});

describe('metas de la demo (08 §4)', () => {
  it('M1 y M2: al menos 90 % ✔ en los campos que su forma trae limpios', async () => {
    for (const id of ['M1', 'M2'] as const) {
      const { resumen } = await evaluarMuestra(id);
      expect(resumen.traidos).toBeGreaterThan(0);
      expect(resumen.pctOkDeTraidos).toBeGreaterThanOrEqual(90);
    }
  });

  it('M1 se lee por ruta, sin modelo para lo que trae, y NO inventa el destino que viene vacío', async () => {
    const { corrida, ev } = await evaluarMuestra('M1');
    expect(corrida.contenido.formato).toBe('json');
    expect(corrida.extraido.origen).toBe('perfil+llm'); // el perfil lo leyó; el modelo sólo fue a buscar el destino
    expect(corrida.extraccion.campos.origen_rfc.origen).toBe('perfil');
    expect(corrida.extraccion.campos.destino_rfc).toBeUndefined();
    expect(ev.destino_rfc.estado).toBe('✗');
    for (const fila of corrida.extraccion.mercancias) for (const v of Object.values(fila)) expect(v.origen).toBe('perfil');
  });

  it('M2: la coma decimal y la unidad pegada se convierten y se marcan ◐; el ID fiscal extranjero no pasa por RFC', async () => {
    const { ev, corrida } = await evaluarMuestra('M2');
    expect(corrida.extraccion.campos.distancia_km.valor).toBe('812.35');
    expect(ev.distancia_km).toMatchObject({ estado: '◐' });
    expect(ev.distancia_km.motivo).toMatch(/conversión: «812,35 km» → 812.35/);
    expect(ev.destino_rfc.motivo).toMatch(/rfc_forma/);
  });

  it('M3: RFC del remitente ✗ sin catálogo y ✔ con el catálogo sintético cargado; el total con punto de miles se resuelve CONTRA LA SUMA, con nota (T-A3-68 b)', async () => {
    const sin = await evaluarMuestra('M3');
    expect(sin.ev.origen_rfc).toEqual({ estado: '✗', motivo: 'ausente' });
    expect(sin.corrida.extraccion.campos.peso_bruto_total.valor).toBe('14029'); // cuadra con la suma de los 14 renglones
    expect(sin.corrida.extraccion.campos.peso_bruto_total.notas?.join(' ')).toMatch(/cuadra con la suma/); // nunca en silencio
    expect(sin.ev.peso_bruto_total.estado).toBe('◐'); // resuelto con nota: una persona lo confirma
    expect(sin.corrida.extraccion.mercancias).toHaveLength(14);

    const con = await evaluarMuestra('M3', { catalogo: catalogoM3() }, MATRIZ_M3_CON_CATALOGO);
    expect(con.ev.origen_rfc.estado).toBe('✔');
    expect(con.corrida.extraccion.campos.origen_rfc).toMatchObject({ valor: RFC_DORADO.m3Remitente, origen: 'catalogo' });
    expect(diferenciasConMatriz(con.ev, MATRIZ_M3_CON_CATALOGO)).toEqual([]);
    // El catálogo sólo mejora: lo que ya era ✔ o ◐ sigue igual.
    expect(con.resumen.pctOk).toBeGreaterThan(sin.resumen.pctOk);
  });

  it('M4: el peso en libras llega a kilos y queda ◐; la unidad «20» queda ◐ (no es una clave del SAT)', async () => {
    const { ev, corrida } = await evaluarMuestra('M4');
    expect(corrida.extraccion.mercancias[0].peso_kg.valor).toBe('6577.997');
    expect(ev['mercancias[0].peso_kg'].estado).toBe('◐');
    expect(ev['mercancias[0].peso_kg'].motivo).toMatch(/libras/);
    expect(ev['mercancias[0].clave_unidad'].estado).toBe('◐');
    expect(ev['mercancias[0].clave_unidad'].motivo).toMatch(/unidad_no_sat/);
    expect(ev.origen_rfc.estado).toBe('◐'); // el RFC está en «Notes» y es del fiscal
  });

  it('M5: la fecha 10/14/2026 sale ✔ con el perfil mes/día, y las 2 pestañas son UN embarque con 2 mercancías', async () => {
    const { ev, corrida } = await evaluarMuestra('M5');
    expect(ev.fecha_salida).toEqual({ estado: '✔', motivo: 'igual al esperado' });
    expect(corrida.extraccion.campos.fecha_salida.valor).toBe('2026-10-14');
    expect(corrida.contenido.hojasMismoEmbarque).toEqual(['Producto A', 'Producto B']);
    expect(corrida.extraccion.mercancias).toHaveLength(2);
    expect(ev.n_mercancias.estado).toBe('✔');
  });
});

describe('regresiones: un cambio que rompe una conversión hace fallar la matriz', () => {
  it('libras sin avisar que son libras → el peso queda en 14502 «kg»: ✗ y la comparación con la matriz lo delata', async () => {
    const { ev, corrida, matriz } = await evaluarMuestra('M4', { guion: guionM4({ conPesoUnidad: false }) });
    expect(corrida.extraccion.mercancias[0].peso_kg.valor).toBe('14502');
    expect(ev['mercancias[0].peso_kg'].estado).toBe('✗');
    const dif = diferenciasConMatriz(ev, matriz);
    expect(dif.length).toBeGreaterThan(0);
    expect(dif.join('\n')).toMatch(/mercancias\[0\]\.peso_kg: esperaba ◐, salió ✗/);
  });

  it('M5 sin el perfil mes/día → «10/14/2026» no es una fecha día/mes: ✗, y la matriz falla en fecha_salida', async () => {
    const { ev, matriz } = await evaluarMuestra('M5', { sinPerfil: true });
    expect(ev.fecha_salida.estado).toBe('✗');
    expect(diferenciasConMatriz(ev, matriz).join('\n')).toMatch(/fecha_salida: esperaba ✔, salió ✗/);
  });

  it('M3 sin catálogo contra la matriz CON catálogo → el RFC del remitente falla (el catálogo es lo que lo llena)', async () => {
    const { ev } = await evaluarMuestra('M3');
    expect(diferenciasConMatriz(ev, MATRIZ_M3_CON_CATALOGO).join('\n')).toMatch(/origen_rfc: esperaba ✔, salió ✗/);
  });
});

describe('el resumen por muestra (para el reporte de F5)', () => {
  it('cuenta ✔ ◐ ✗ por muestra, congelado, y lo imprime como tabla', async () => {
    const filas: Array<{ id: string; resumen: ReturnType<typeof resumir> }> = [];
    for (const m of MUESTRAS) filas.push({ id: m.id, resumen: (await evaluarMuestra(m.id)).resumen });
    const con = await evaluarMuestra('M3', { catalogo: catalogoM3() }, MATRIZ_M3_CON_CATALOGO);
    filas.push({ id: 'M3 + catálogo', resumen: con.resumen });

    const cuentas = Object.fromEntries(filas.map((f) => [f.id, [f.resumen.ok, f.resumen.revisar, f.resumen.falta]]));
    expect(cuentas).toEqual({
      M1: [10, 0, 3], M2: [8, 3, 2], M3: [4, 3, 7], 'M3 + catálogo': [8, 3, 3], M4: [5, 6, 3], M5: [12, 0, 2],
    });
    // Los campos críticos que quedan ✗ son exactamente los que la forma del documento no trae.
    expect(Object.fromEntries(filas.map((f) => [f.id, f.resumen.criticosFallidos]))).toEqual({
      M1: ['destino_rfc'],
      M2: [],
      M3: ['origen_rfc', 'destino_rfc', 'mercancias[0].bienes_transp'],
      'M3 + catálogo': ['destino_rfc'],
      M4: ['destino_rfc'],
      M5: [],
    });

    const tabla = tablaResumen(filas);
    expect(tabla.split('\n')).toHaveLength(filas.length + 2);
    process.stdout.write(`\nCONJUNTO DORADO SINTÉTICO · resumen por muestra\n${tabla}\n`);
  });
});

describe('guardia de privacidad: el repo es público', () => {
  it('ningún archivo de evaluacion/ trae un RFC con forma real (los sintéticos nacen de una base «…XXX» con su dígito calculado)', () => {
    const dir = __dirname;
    const archivos = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(archivos).toEqual(expect.arrayContaining(['dorado.fixture.ts', 'esperados.ts', 'evaluar.ts', 'dorado.test.ts']));
    const sospechosos: string[] = [];
    for (const f of archivos) {
      const texto = readFileSync(join(dir, f), 'utf8');
      for (const m of texto.matchAll(/\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/g)) if (!m[0].endsWith('XXX')) sospechosos.push(`${f}: ${m[0]}`);
    }
    expect(sospechosos).toEqual([]);
  });

  it('los RFC del conjunto se reconocen por su base inventada (…XX + dígito calculado)', () => {
    for (const rfc of Object.values(RFC_DORADO)) expect(rfc).toMatch(/XX[A-Z0-9]$/);
  });
});
