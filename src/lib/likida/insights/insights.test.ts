import { describe, expect, it } from 'vitest';
import { componer, MAX_POR_PANTALLA } from './componer';
import { definirRegla, ErrorInsight, validarInsight, type Regla } from './regla';
import { ROTULO_SEVERIDAD, ROTULO_TIPO, TIPOS_INSIGHT, SEVERIDADES, type Insight, type Severidad } from './tipos';

// Datos sintéticos: ninguna cifra ni nombre real.
interface Datos {
  n: number;
}
const fuente = { tabla: 'tabla_sintetica', periodo: 'semana de prueba', n: 4 };

const insight = (id: string, severidad: Severidad, extra: Partial<Insight> = {}): Insight =>
  ({
    id,
    agente: 'liquidacion',
    tipo: 'dato',
    severidad,
    quePaso: 'Hubo 4 casos sintéticos.',
    queSignifica: 'Es una lectura de prueba.',
    queHacer: 'Revisar la lista.',
    fuente,
    ...extra,
  }) as Insight;

const regla = (id: string, severidad: Severidad, aplica = true): Regla<Datos> =>
  definirRegla<Datos>({
    id,
    agente: 'liquidacion',
    aplica: () => aplica,
    producir: () => insight(id, severidad),
  });

describe('componer', () => {
  it('sin reglas o ninguna aplica devuelve vacío', () => {
    expect(componer<Datos>([], { n: 1 })).toEqual({ visibles: [], verMas: [], total: 0 });
    const r = componer([regla('a', 'info', false), regla('b', 'urgente', false)], { n: 1 });
    expect(r.total).toBe(0);
    expect(r.visibles).toEqual([]);
  });

  it('solo produce las reglas que aplican', () => {
    const r = componer([regla('a', 'info', false), regla('b', 'info', true)], { n: 1 });
    expect(r.visibles.map((i) => i.id)).toEqual(['b']);
  });

  it('ordena por severidad: urgente, atención, info', () => {
    const r = componer([regla('i', 'info'), regla('u', 'urgente'), regla('a', 'atencion')], { n: 1 });
    expect(r.visibles.map((i) => i.id)).toEqual(['u', 'a', 'i']);
  });

  it('a igual severidad conserva el orden de declaración', () => {
    const r = componer([regla('x', 'atencion'), regla('y', 'atencion'), regla('z', 'atencion')], { n: 1 });
    expect(r.visibles.map((i) => i.id)).toEqual(['x', 'y', 'z']);
  });

  it('tope por defecto 3; el resto va a «ver más»', () => {
    expect(MAX_POR_PANTALLA).toBe(3);
    const reglas = [regla('1', 'info'), regla('2', 'urgente'), regla('3', 'atencion'), regla('4', 'info'), regla('5', 'urgente')];
    const r = componer(reglas, { n: 1 });
    expect(r.visibles.map((i) => i.id)).toEqual(['2', '5', '3']);
    expect(r.verMas.map((i) => i.id)).toEqual(['1', '4']);
    expect(r.total).toBe(5);
  });

  it('el tope es configurable y valida el valor', () => {
    const reglas = [regla('1', 'info'), regla('2', 'info')];
    expect(componer(reglas, { n: 1 }, { max: 1 }).verMas).toHaveLength(1);
    expect(componer(reglas, { n: 1 }, { max: 0 }).visibles).toHaveLength(0);
    expect(() => componer(reglas, { n: 1 }, { max: -1 })).toThrow(ErrorInsight);
    expect(() => componer(reglas, { n: 1 }, { max: 1.5 })).toThrow(ErrorInsight);
  });

  it('es pura: mismo input, mismo output, sin mutar datos', () => {
    const datos = Object.freeze({ n: 7 });
    const reglas = [regla('a', 'atencion'), regla('b', 'urgente')];
    expect(componer(reglas, datos)).toEqual(componer(reglas, datos));
  });

  it('rechaza ids de regla duplicados e insights con id repetido', () => {
    expect(() => componer([regla('a', 'info'), regla('a', 'info')], { n: 1 })).toThrow(/duplicado/);
    const r1 = definirRegla<Datos>({ id: 'r1', agente: 'liquidacion', aplica: () => true, producir: () => insight('mismo', 'info') });
    const r2 = definirRegla<Datos>({ id: 'r2', agente: 'liquidacion', aplica: () => true, producir: () => insight('mismo', 'info') });
    expect(() => componer([r1, r2], { n: 1 })).toThrow(/mismo id/);
  });

  it('el agente del insight debe coincidir con el de la regla', () => {
    const mala = definirRegla<Datos>({
      id: 'm',
      agente: 'peajes',
      aplica: () => true,
      producir: () => insight('m', 'info'),
    });
    expect(() => componer([mala], { n: 1 })).toThrow(/agente/);
  });

  it('todo insight compuesto trae fuente con n y periodo (sin números sin fuente)', () => {
    const r = componer([regla('a', 'info'), regla('b', 'urgente')], { n: 1 });
    for (const i of [...r.visibles, ...r.verMas]) {
      expect(i.fuente.periodo.length).toBeGreaterThan(0);
      expect(Number.isInteger(i.fuente.n)).toBe(true);
    }
  });
});

describe('validarInsight', () => {
  it('acepta un dato completo', () => {
    const i = insight('ok', 'info');
    expect(validarInsight(i)).toBe(i);
  });

  it('fuente ausente → error', () => {
    const i = { ...insight('s', 'info'), fuente: undefined } as unknown as Insight;
    expect(() => validarInsight(i, 's')).toThrow(/fuente/);
  });

  it('fuente sin periodo, sin n válido o sin origen → error', () => {
    const base = insight('s', 'info');
    expect(() => validarInsight({ ...base, fuente: { tabla: 't', n: 1 } } as unknown as Insight)).toThrow(/periodo/);
    expect(() => validarInsight({ ...base, fuente: { tabla: 't', periodo: 'p' } } as unknown as Insight)).toThrow(/fuente\.n/);
    expect(() => validarInsight({ ...base, fuente: { tabla: 't', periodo: 'p', n: -1 } } as unknown as Insight)).toThrow(/fuente\.n/);
    expect(() => validarInsight({ ...base, fuente: { periodo: 'p', n: 1 } } as unknown as Insight)).toThrow(/tabla, archivo ni calculo/);
  });

  it('acepta fuente por archivo o por cálculo', () => {
    const base = insight('s', 'info');
    expect(() => validarInsight({ ...base, fuente: { archivo: 'a.xlsx', periodo: 'p', n: 0 } } as Insight)).not.toThrow();
    expect(() => validarInsight({ ...base, fuente: { calculo: 'suma', periodo: 'p', n: 2 } } as Insight)).not.toThrow();
  });

  it('textos vacíos → error', () => {
    for (const campo of ['quePaso', 'queSignifica', 'queHacer'] as const) {
      expect(() => validarInsight({ ...insight('t', 'info'), [campo]: '  ' } as Insight)).toThrow(new RegExp(campo));
    }
  });

  it('acción incompleta → error', () => {
    expect(() => validarInsight(insight('a', 'info', { accion: { rotulo: 'Ir', ruta: '' } }))).toThrow(/accion/);
  });

  it('candidato sin la palabra «candidato» → error', () => {
    const i = insight('c', 'atencion', { tipo: 'candidato', queSignifica: 'Parece un cobro de más.', queHacer: 'Validar con el tarifario.' } as unknown as Partial<Insight>);
    expect(() => validarInsight(i)).toThrow(/candidato/);
  });

  it('candidato con queHacer que reclama directo o no verifica → error', () => {
    const base = { tipo: 'candidato', queSignifica: 'Es un candidato a revisión.' } as unknown as Partial<Insight>;
    expect(() => validarInsight(insight('c', 'info', { ...base, queHacer: 'Reclamar al proveedor.' } as unknown as Partial<Insight>))).toThrow(/reclama|verific/);
    expect(() => validarInsight(insight('c', 'info', { ...base, queHacer: 'Mandar el caso.' } as unknown as Partial<Insight>))).toThrow(/verificación/);
  });

  it('candidato correcto pasa', () => {
    const i = insight('c', 'atencion', {
      tipo: 'candidato',
      queSignifica: 'Es un candidato: falta el tarifario.',
      queHacer: 'Validar con el proveedor o el tarifario antes de reclamar.',
    } as unknown as Partial<Insight>);
    expect(() => validarInsight(i)).not.toThrow();
  });

  it('simulado y ejemplo exigen rótulo visible', () => {
    for (const tipo of ['simulado', 'ejemplo'] as const) {
      expect(() => validarInsight(insight('r', 'info', { tipo } as unknown as Partial<Insight>))).toThrow(/rótulo/);
      expect(() => validarInsight(insight('r', 'info', { tipo, rotulo: 'Datos de demostración' } as unknown as Partial<Insight>))).not.toThrow();
    }
  });

  it('valores fuera de catálogo → error', () => {
    expect(() => validarInsight(insight('x', 'info', { agente: 'otro' } as unknown as Partial<Insight>))).toThrow(/agente/);
    expect(() => validarInsight(insight('x', 'info', { tipo: 'rumor' } as unknown as Partial<Insight>))).toThrow(/tipo/);
    expect(() => validarInsight(insight('x', 'grave' as Severidad))).toThrow(/severidad/);
  });

  it('un error de validación en una regla aborta componer con su id', () => {
    const rota = definirRegla<Datos>({
      id: 'rota',
      agente: 'liquidacion',
      aplica: () => true,
      producir: () => ({ ...insight('rota', 'info'), fuente: undefined }) as unknown as Insight,
    });
    expect(() => componer([rota], { n: 1 })).toThrow(/\[insight rota\]/);
  });
});

describe('rótulos exhaustivos', () => {
  it('hay rótulo para cada tipo y severidad', () => {
    for (const t of TIPOS_INSIGHT) expect(ROTULO_TIPO[t].length).toBeGreaterThan(0);
    for (const s of SEVERIDADES) expect(ROTULO_SEVERIDAD[s].length).toBeGreaterThan(0);
  });
});
