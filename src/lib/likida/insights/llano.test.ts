import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { componer } from './componer';
import { definirRegla } from './regla';
import type { Insight } from './tipos';
import {
  MAX_CARACTERES_LINEA,
  SIGLAS_PERMITIDAS,
  TERMINOS_VETADOS,
  revisarInsight,
  revisarQueHacer,
  revisarTexto,
  type CampoTexto,
} from './llano';

// Datos sintéticos: ninguna cifra ni nombre real.
const codigos = (t: string) => revisarTexto(t).map((h) => h.codigo);

describe('revisarTexto: términos vetados', () => {
  const casos: [string, string][] = [
    ['Se aplicó OCR al archivo.', 'OCR'],
    ['Falló el endpoint de envío.', 'endpoint'],
    ['El payload llegó vacío.', 'payload'],
    ['La carga es idempotente.', 'idempotente'],
    ['Hay que conciliar los viajes.', 'conciliar'],
    ['La conciliación quedó abierta.', 'conciliar'],
    ['Proveedor marcado como EFOS.', 'EFOS'],
    ['El webhook no respondió.', 'webhook'],
    ['Llegó un JSON vacío.', 'JSON'],
    ['Falló el parseo del archivo.', 'parsear'],
    ['Hubo un timeout en el envío.', 'timeout'],
    ['Abrir el dashboard.', 'dashboard'],
  ];
  it.each(casos)('detecta «%s»', (texto, etiqueta) => {
    const h = revisarTexto(texto);
    const v = h.find((x) => x.codigo === 'termino-vetado');
    expect(v?.termino).toBe(etiqueta);
    expect(v?.sustituto.length).toBeGreaterThan(0);
  });

  it('cada término vetado de la lista tiene sustituto y es detectable', () => {
    for (const t of TERMINOS_VETADOS) {
      expect(t.sustituto).not.toBe('');
      expect(t.etiqueta).not.toBe('');
    }
    expect(TERMINOS_VETADOS.length).toBeGreaterThanOrEqual(8);
  });

  it('ignora acentos y mayúsculas', () => {
    expect(codigos('CONCILIACIÓN pendiente.')).toContain('termino-vetado');
  });

  it('no marca una palabra que solo contiene el término', () => {
    expect(codigos('Hay un pocr de prueba en la mesa.')).not.toContain('termino-vetado');
  });
});

describe('revisarTexto: acusaciones, error y siglas', () => {
  it('«cobro indebido/ilegal» sin tarifario se marca', () => {
    expect(codigos('Hay 3 cobros indebidos este mes.')).toContain('acusacion-sin-tarifario');
    expect(codigos('Es un cobro ilegal.')).toContain('acusacion-sin-tarifario');
  });

  it('con el tarifario citado y sin acusar, no se marca', () => {
    expect(codigos('Candidato a revisar contra el tarifario.')).toEqual([]);
  });

  it('«error» a secas se marca; «error de/en …» no', () => {
    expect(codigos('Hubo un error.')).toContain('error-a-secas');
    expect(codigos('Hubo errores.')).toContain('error-a-secas');
    expect(codigos('Hubo un error de captura en el monto.')).not.toContain('error-a-secas');
  });

  it('siglas sin explicar se marcan; permitidas o explicadas no', () => {
    expect(codigos('Falta el CCP del viaje.')).toContain('sigla-sin-explicar');
    expect(codigos('Falta el PDF del viaje.')).toEqual([]);
    expect(codigos('Falta la carta de porte (CCP) del viaje.')).toEqual([]);
    expect(codigos('Falta el comprobante de operación (CCP).')).toEqual([]);
    expect(SIGLAS_PERMITIDAS.has('GPS')).toBe(true);
  });
});

describe('revisarTexto: forma', () => {
  it('línea larga (>140) se marca y 140 exactos no', () => {
    expect(codigos('a'.repeat(MAX_CARACTERES_LINEA + 1))).toContain('linea-larga');
    expect(codigos('a'.repeat(MAX_CARACTERES_LINEA))).toEqual([]);
  });

  it('varias ideas en una línea se marcan; en líneas separadas no', () => {
    expect(codigos('Llegaron 3 archivos. Faltan 2 más.')).toContain('varias-ideas');
    expect(codigos('Llegaron 3 archivos; faltan 2 más.')).toContain('varias-ideas');
    expect(codigos('Llegaron 3 archivos.\nFaltan 2 más.')).toEqual([]);
  });

  it('decimales y miles no cuentan como dos ideas', () => {
    expect(codigos('El monto fue de $1,234.50 en la semana.')).toEqual([]);
  });

  it('reporta el número de línea', () => {
    const h = revisarTexto('Línea limpia.\nSe aplicó OCR.', 'quePaso');
    expect(h[0]).toMatchObject({ campo: 'quePaso', linea: 2 });
  });

  it('texto limpio y vacío no dan hallazgos', () => {
    expect(revisarTexto('3 viajes no tienen carta porte.')).toEqual([]);
    expect(revisarTexto('')).toEqual([]);
  });
});

describe('revisarQueHacer: verbo de acción', () => {
  it('acepta infinitivos y «nada por hacer»', () => {
    expect(revisarQueHacer('Revisar los 6 cruces contra el tarifario.')).toEqual([]);
    expect(revisarQueHacer('Pedir de nuevo los archivos.')).toEqual([]);
    expect(revisarQueHacer('Nada por hacer.')).toEqual([]);
    expect(revisarQueHacer('No hace falta hacer nada.')).toEqual([]);
  });

  it('rechaza lo que no empieza con verbo', () => {
    expect(revisarQueHacer('Revisión pendiente.').map((h) => h.codigo)).toContain('sin-verbo-de-accion');
    expect(revisarQueHacer('Sin acción.').map((h) => h.codigo)).toContain('sin-verbo-de-accion');
  });

  it('también aplica las demás reglas', () => {
    expect(revisarQueHacer('Conciliar los viajes.').map((h) => h.codigo)).toContain('termino-vetado');
  });
});

describe('revisarInsight sobre componer()', () => {
  const fuente = { tabla: 'tabla_sintetica', periodo: 'semana de prueba', n: 4 };
  const mk = (id: string, extra: Partial<Insight>) =>
    definirRegla<null>({
      id,
      agente: 'peajes',
      aplica: () => true,
      producir: () =>
        ({
          id,
          agente: 'peajes',
          tipo: 'dato',
          severidad: 'info',
          quePaso: '4 cruces llegaron después del cierre del mes.',
          queSignifica: 'Es una lectura de prueba.',
          queHacer: 'Revisar los 4 cruces.',
          fuente,
          ...extra,
        }) as Insight,
    });

  it('un insight limpio compuesto no da hallazgos', () => {
    const r = componer([mk('limpio', {})], null);
    expect(r.visibles.flatMap(revisarInsight)).toEqual([]);
  });

  it('un insight con jerga compuesto da hallazgos por campo', () => {
    const r = componer([mk('sucio', { quePaso: 'Falló el endpoint.', queHacer: 'Pendiente.' })], null);
    const h = r.visibles.flatMap(revisarInsight);
    expect(h.map((x) => x.campo)).toEqual(['quePaso', 'queHacer']);
  });
});

describe('ejemplos de docs/operacion/insights-texto-llano.md', () => {
  const md = readFileSync(join(process.cwd(), 'docs/operacion/insights-texto-llano.md'), 'utf8');
  const lineas = [...md.matchAll(/^- (Bien|Mal) \((quePaso|queSignifica|queHacer)\): «(.+)»$/gm)].map((m) => ({
    veredicto: m[1],
    campo: m[2] as CampoTexto,
    texto: m[3]!,
  }));
  const hallazgos = (l: (typeof lineas)[number]) =>
    l.campo === 'queHacer' ? revisarQueHacer(l.texto) : revisarTexto(l.texto, l.campo);

  it('hay 3 ejemplos por cada uno de los 5 agentes (3 pares malo/bueno por campo)', () => {
    const secciones = md.split(/^### /m).slice(1);
    expect(secciones).toHaveLength(5);
    for (const s of secciones) {
      expect((s.match(/^Ejemplo \d$/gm) ?? []).length).toBe(3);
      expect((s.match(/^- Bien /gm) ?? []).length).toBe(9);
      expect((s.match(/^- Mal /gm) ?? []).length).toBe(9);
    }
  });

  it('todo lo marcado Bien es llano', () => {
    const buenos = lineas.filter((l) => l.veredicto === 'Bien');
    expect(buenos.length).toBe(45);
    for (const l of buenos) expect(hallazgos(l), l.texto).toEqual([]);
  });

  it('todo lo marcado Mal tiene al menos un hallazgo', () => {
    const malos = lineas.filter((l) => l.veredicto === 'Mal');
    expect(malos.length).toBe(45);
    for (const l of malos) expect(hallazgos(l).length, l.texto).toBeGreaterThan(0);
  });
});
