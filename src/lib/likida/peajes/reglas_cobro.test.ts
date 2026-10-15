import { describe, it, expect } from 'vitest';
import {
  revisarCobros, ROTULO_CANDIDATO, CLASES_VALIDAS_DEFAULT, type LineaCobro, type ReglasCobro,
} from './reglas_cobro';
import { generarFilasIave, CASETAS_FIXTURE } from './fixtures/generar_desglose_iave';
import { normalizarNombre } from './formatos';

const l = (p: Partial<LineaCobro> & { indice: number }): LineaCobro => ({
  fecha: '2026-03-05', hora: '10:00:00', caseta: 'Caseta Ejemplo Norte', tag: 'IMDM00000001', unidad: '101', clase: 5, monto: 100, ...p,
});
const cats = (r: ReturnType<typeof revisarCobros>) => r.candidatos.map((c) => `${c.indice}:${c.categoria}`);

describe('clase fuera de {3, 5}', () => {
  it('3 y 5 son válidas; 2, 4, 6–10 son candidatas', () => {
    const lineas = [3, 5, 2, 4, 6, 7, 8, 9, 10].map((clase, i) => l({ indice: i, clase, hora: `10:00:${String(i).padStart(2, '0')}` }));
    const r = revisarCobros(lineas);
    expect(cats(r)).toEqual(['2:clase_fuera_de_3_5', '3:clase_fuera_de_3_5', '4:clase_fuera_de_3_5', '5:clase_fuera_de_3_5', '6:clase_fuera_de_3_5', '7:clase_fuera_de_3_5', '8:clase_fuera_de_3_5']);
    expect(CLASES_VALIDAS_DEFAULT).toEqual([3, 5]);
  });
  it('la clase 1 en una caseta de TARIFA POR PASADA no se marca; en otra caseta sí', () => {
    const excepcionesClase = new Map([[normalizarNombre('Caseta Pasada Uno'), [1]]]);
    const lineas = [
      l({ indice: 0, caseta: 'CASETA PASADA UNO     ', clase: 1 }),
      l({ indice: 1, caseta: 'Caseta Ejemplo Norte', clase: 1 }),
    ];
    const r = revisarCobros(lineas, { excepcionesClase });
    expect(cats(r)).toEqual(['1:clase_fuera_de_3_5']);
    // la explicación de la clase 1 no acusa: dice que puede ser tarifa por pasada
    expect(r.candidatos[0].queSignifica).toMatch(/tarifa por pasada/i);
    expect(r.candidatos[0].queSignifica).toMatch(/No es un error confirmado/);
  });
  it('una excepción de otra clase no deja pasar la clase 1 (y viceversa)', () => {
    const excepcionesClase = new Map([[normalizarNombre('Plaza Oriente'), [6]]]);
    const r = revisarCobros([l({ indice: 0, caseta: 'Plaza Oriente', clase: 6 }), l({ indice: 1, caseta: 'Plaza Oriente', clase: 1, hora: '11:00:00' })], { excepcionesClase });
    expect(cats(r)).toEqual(['1:clase_fuera_de_3_5']);
  });
  it('sin clase en la línea no se acusa nada, se CUENTA; sin clase en todo el archivo la regla se declara no aplicada', () => {
    const r = revisarCobros([l({ indice: 0, clase: null }), l({ indice: 1, clase: undefined, hora: '11:00:00' })]);
    expect(r.candidatos).toHaveLength(0);
    expect(r.sinClase).toBe(2);
    expect(r.reglasNoAplicadas.find((x) => x.regla === 'clase_fuera_de_3_5')?.motivo).toMatch(/no trae clase/);
  });
  it('sugiere (no aplica) las casetas donde la clase 1 domina', () => {
    const lineas = [
      ...Array.from({ length: 30 }, (_, i) => l({ indice: i, caseta: 'Pasada X', clase: 1, monto: 50 })),
      ...Array.from({ length: 30 }, (_, i) => l({ indice: 100 + i, caseta: 'Normal Y', clase: 5 })),
    ];
    const r = revisarCobros(lineas);
    expect(r.sugerenciasPasada).toEqual([{ caseta: 'Pasada X', cruces: 30, monto: 1500 }]);
    // y sigue marcando las 30 hasta que una persona lo declare
    expect(r.porCategoria.clase_fuera_de_3_5.n).toBe(30);
    const declarada = revisarCobros(lineas, { excepcionesClase: new Map([[normalizarNombre('Pasada X'), [1]]]) });
    expect(declarada.porCategoria.clase_fuera_de_3_5.n).toBe(0);
    expect(declarada.sugerenciasPasada).toHaveLength(0);
  });
});

describe('extemporáneo', () => {
  it('fecha anterior al inicio del periodo = candidato; el primer día del periodo no', () => {
    const r = revisarCobros([l({ indice: 0, fecha: '2026-02-27' }), l({ indice: 1, fecha: '2026-03-01' }), l({ indice: 2, fecha: '2026-03-10' })], { periodoDesde: '2026-03-01' });
    expect(cats(r)).toEqual(['0:extemporaneo']);
    expect(r.candidatos[0].queHacer).toMatch(/periodo en que ocurrió/);
  });
  it('SIN periodo la regla no se aplica y se avisa (no se ensancha con el mínimo de fechas)', () => {
    const r = revisarCobros([l({ indice: 0, fecha: '2026-02-27' }), l({ indice: 1, fecha: '2026-03-05' })]);
    expect(r.porCategoria.extemporaneo.n).toBe(0);
    expect(r.reglasNoAplicadas.find((x) => x.regla === 'extemporaneo')?.motivo).toMatch(/Sin periodo/);
  });
  it('una línea sin fecha no es extemporánea (no se adivina)', () => {
    expect(revisarCobros([l({ indice: 0, fecha: null })], { periodoDesde: '2026-03-01' }).candidatos).toHaveLength(0);
  });
});

describe('duplicado exacto vs. doble cobro cercano', () => {
  it('mismo TAG, segundo, caseta e importe = duplicado exacto (la segunda línea)', () => {
    const r = revisarCobros([l({ indice: 0 }), l({ indice: 1 })]);
    expect(cats(r)).toEqual(['1:duplicado_exacto']);
    expect(r.candidatos[0].quePaso).toMatch(/línea 1 del archivo/);
  });
  it('a 3 minutos (posible carril o reintento) NO es duplicado exacto; distinto importe tampoco; otra caseta tampoco', () => {
    const r = revisarCobros([
      l({ indice: 0 }),
      l({ indice: 1, hora: '10:03:00' }),
      l({ indice: 2, monto: 101 }),
      l({ indice: 3, caseta: 'Otra Caseta' }),
      l({ indice: 4, tag: 'IMDM00000002' }),
    ]);
    expect(r.porCategoria.duplicado_exacto.n).toBe(0);
  });
  it('el TAG se compara normalizado («IMDM 0000 0001» = «imdm00000001»)', () => {
    const r = revisarCobros([l({ indice: 0, tag: 'IMDM00000001' }), l({ indice: 1, tag: 'imdm 0000-0001' })]);
    expect(r.porCategoria.duplicado_exacto.n).toBe(1);
  });
  it('sin TAG o sin hora la regla se declara no aplicada, no se acusa', () => {
    const sinHora = revisarCobros([l({ indice: 0, hora: null }), l({ indice: 1, hora: null })]);
    expect(sinHora.porCategoria.duplicado_exacto.n).toBe(0);
    expect(sinHora.reglasNoAplicadas.find((x) => x.regla === 'duplicado_exacto')?.motivo).toMatch(/hora/);
    const sinTag = revisarCobros([l({ indice: 0, tag: null }), l({ indice: 1, tag: null })]);
    expect(sinTag.reglasNoAplicadas.find((x) => x.regla === 'duplicado_exacto')?.motivo).toMatch(/TAG/);
  });
});

describe('TAG dado de baja y casetas que no deben cruzarse', () => {
  const reglas: ReglasCobro = { tagsBaja: new Map([['IMDM00000001', '2026-03-05']]), casetasNoCruzar: new Set([normalizarNombre('Plaza Prohibida')]) };
  it('cualquier cruce POSTERIOR a la baja se marca; el del mismo día y los anteriores no', () => {
    const r = revisarCobros([
      l({ indice: 0, fecha: '2026-03-04' }), l({ indice: 1, fecha: '2026-03-05', hora: '23:59:00' }), l({ indice: 2, fecha: '2026-03-06', hora: '08:00:00' }),
      l({ indice: 3, fecha: '2026-03-20', tag: 'IMDM00000009' }),
    ], reglas);
    expect(cats(r)).toEqual(['2:tag_dado_de_baja']);
    expect(r.candidatos[0].quePaso).toMatch(/dado de baja el 2026-03-05/);
  });
  it('la baja se compara con el TAG normalizado', () => {
    const r = revisarCobros([l({ indice: 0, fecha: '2026-04-01', tag: 'imdm-0000 0001' })], reglas);
    expect(r.porCategoria.tag_dado_de_baja.n).toBe(1);
  });
  it('caseta prohibida por flota: se marca con el nombre normalizado; sin lista no hay ninguna precargada', () => {
    const lineas = [l({ indice: 0, caseta: 'PLAZA PROHIBIDA   ' }), l({ indice: 1, caseta: 'Plaza Permitida' })];
    expect(cats(revisarCobros(lineas, reglas))).toEqual(['0:caseta_no_debe_cruzarse']);
    expect(revisarCobros(lineas).porCategoria.caseta_no_debe_cruzarse.n).toBe(0);
    // ninguna caseta, ni siquiera una con nombre "famoso", viene precargada
    expect(revisarCobros([l({ indice: 0, caseta: 'CASETA PROHIBIDA EJEMPLO' })]).candidatos).toHaveLength(0);
  });
});

describe('lenguaje y rótulo', () => {
  it('todo candidato dice qué pasó / qué significa / qué hacer, y NUNCA afirma que el cobro sea indebido', () => {
    const r = revisarCobros([
      l({ indice: 0, clase: 9 }), l({ indice: 1, fecha: '2026-02-01' }), l({ indice: 2 }), l({ indice: 3 }),
      l({ indice: 4, fecha: '2026-04-01', tag: 'IMDM00000001', hora: '11:00:00' }), l({ indice: 5, caseta: 'Plaza Prohibida', hora: '12:00:00' }),
    ], { periodoDesde: '2026-03-01', tagsBaja: new Map([['IMDM00000001', '2026-03-31']]), casetasNoCruzar: new Set([normalizarNombre('Plaza Prohibida')]) });
    const vistas = new Set(r.candidatos.map((c) => c.categoria));
    expect(vistas.size).toBe(5);
    for (const c of r.candidatos) {
      expect(c.quePaso.length).toBeGreaterThan(20);
      expect(c.queSignifica.length).toBeGreaterThan(20);
      expect(c.queHacer.length).toBeGreaterThan(20);
      expect(`${c.quePaso} ${c.queSignifica} ${c.queHacer}`.toLowerCase()).not.toMatch(/cobro indebido|cobraron de más|fraude/);
    }
    expect(ROTULO_CANDIDATO).toMatch(/Candidato.*validar con el proveedor/);
  });
});

describe('fixture grande (9 000 filas): las cifras del generador coinciden', () => {
  const { filas, esperado } = generarFilasIave({ filas: 9000, extemporaneos: 40, duplicadosExactos: 12 });
  const SERIAL0 = Date.UTC(1899, 11, 30);
  const lineas: LineaCobro[] = filas.slice(1).map((f, i) => {
    const d = new Date(SERIAL0 + Number(f[7]) * 86_400_000).toISOString().slice(0, 10);
    const seg = Math.round(Number(f[8]) * 86_400);
    const hh = String(Math.floor(seg / 3600) % 24).padStart(2, '0');
    const mm = String(Math.floor(seg / 60) % 60).padStart(2, '0');
    const ss = String(seg % 60).padStart(2, '0');
    return { indice: i, fecha: d, hora: `${hh}:${mm}:${ss}`, caseta: String(f[10]).trim(), tag: String(f[5]), unidad: String(f[6]).trim(), clase: Number(f[9]), monto: Number(f[13]) };
  });
  const pasada = new Map(CASETAS_FIXTURE.filter((c) => c.porPasada).map((c) => [normalizarNombre(c.nombre), [1] as readonly number[]]));

  it('extemporáneos y duplicados exactos coinciden con lo inyectado; las casetas por pasada no meten ruido', () => {
    const r = revisarCobros(lineas, { periodoDesde: esperado.inicio, excepcionesClase: pasada });
    expect(r.lineasRevisadas).toBe(esperado.cruces);
    expect(r.montoRevisado).toBe(esperado.monto);
    expect(r.porCategoria.extemporaneo).toEqual({ n: esperado.extemporaneos, monto: esperado.montoExtemporaneos });
    expect(r.porCategoria.duplicado_exacto.n).toBe(esperado.duplicadosExactos);
    // clases distintas de 1, 3 y 5 (con la clase 1 de las casetas por pasada exenta) = lo que el generador contó
    const esperadasClase = Object.entries(esperado.porClase).filter(([c]) => !['3', '5', '1'].includes(c)).reduce((s, [, n]) => s + n, 0);
    expect(r.porCategoria.clase_fuera_de_3_5.n).toBe(esperadasClase);
    expect(esperadasClase).toBeGreaterThan(300);
    // SIN la excepción, la clase 1 sube el conteo exactamente en las clases 1
    const sin = revisarCobros(lineas, { periodoDesde: esperado.inicio });
    expect(sin.porCategoria.clase_fuera_de_3_5.n).toBe(esperadasClase + (esperado.porClase['1'] ?? 0));
    expect(sin.sugerenciasPasada.map((s) => s.caseta).sort()).toEqual(['CASETA PASADA DOS', 'CASETA PASADA UNO']);
  });
});
