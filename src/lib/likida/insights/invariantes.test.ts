// Invariantes globales del marco de insights (T-INS-09), puerta F4:
//  1. todo número con fuente;  2. todo candidato rotulado como candidato;
//  3. ninguna cifra de ahorro sin línea base (solo sale de `ahorroSeguro`).
// Recorre las reglas de cualquier `registro.ts` de insights (contrato abajo) con sus fixtures,
// y los textos de pantalla de los 5 agentes. Con datos sintéticos; no toca código de producción.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { componer } from './componer';
import { ahorroSeguro, type LineaBase, type Medida } from './linea_base';
import { definirRegla, validarInsight, type Regla } from './regla';
import type { Insight } from './tipos';

/**
 * Contrato de `registro.ts`: `export const REGISTRO: ReadonlyArray<{ reglas: Regla<any>[]; fixtures: unknown[] }>`.
 * Cada regla debe aplicar en al menos un fixture (si no, sus invariantes no se verían).
 */
interface Registro {
  reglas: readonly Regla<never>[];
  fixtures: readonly unknown[];
}

const RAIZ = process.cwd();

// ---------- Invariantes sobre un Insight ----------

const TIENE_CIFRA = /\d/;
const MENCIONA_AHORRO = /ahorr/i;
const TABLA_LINEA_BASE = 'insight_linea_base';

export function violaciones(i: Insight): string[] {
  const v: string[] = [];
  const textos = [i.quePaso, i.queSignifica, i.queHacer];
  const f = i.fuente as unknown as Record<string, unknown> | undefined;

  // 1. todo número con fuente
  const fuenteOk =
    !!f &&
    [f.tabla, f.archivo, f.calculo].some((x) => typeof x === 'string' && x.trim() !== '') &&
    typeof f.periodo === 'string' &&
    f.periodo.trim() !== '' &&
    Number.isInteger(f.n) &&
    (f.n as number) >= 0;
  if (!fuenteOk) v.push('sin fuente completa (tabla|archivo|calculo, periodo, n)');
  else if (textos.some((t) => TIENE_CIFRA.test(t)) && f && (f.n as number) === 0 && !/(0|ning)/i.test(i.quePaso)) {
    v.push('muestra una cifra pero la fuente respalda 0 casos');
  }

  // 2. candidato rotulado
  if (i.tipo === 'candidato') {
    if (!/candidato/i.test(i.queSignifica)) v.push('candidato que no dice «candidato» en queSignifica');
    if (!/valid|verific/i.test(i.queHacer) || /^\s*reclam/i.test(i.queHacer)) {
      v.push('candidato sin siguiente paso de verificación');
    }
  }

  // 3. sin cifra de ahorro sin línea base
  const dicenAhorro = textos.some((t) => MENCIONA_AHORRO.test(t));
  const conCifra = textos.some((t) => TIENE_CIFRA.test(t));
  if (dicenAhorro && conCifra && f?.tabla !== TABLA_LINEA_BASE) {
    v.push('cifra de ahorro sin línea base (usar ahorroSeguro: fuente.tabla = insight_linea_base)');
  }
  return v;
}

// ---------- Descubrimiento de registros ----------

function archivosRegistro(dir: string): string[] {
  const salida: string[] = [];
  const recorrer = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) recorrer(p);
      else if (e.name === 'registro.ts' && /(^|\/)insights\//.test(relative(RAIZ, p))) salida.push(p);
    }
  };
  recorrer(dir);
  return salida;
}

async function cargarRegistros(): Promise<{ archivo: string; registro: Registro }[]> {
  const salida: { archivo: string; registro: Registro }[] = [];
  for (const archivo of archivosRegistro(join(RAIZ, 'src'))) {
    const modulo = (await import(/* @vite-ignore */ archivo)) as { REGISTRO?: Registro[] };
    if (!Array.isArray(modulo.REGISTRO)) {
      throw new Error(`${relative(RAIZ, archivo)} debe exportar REGISTRO: Registro[]`);
    }
    for (const registro of modulo.REGISTRO) salida.push({ archivo: relative(RAIZ, archivo), registro });
  }
  return salida;
}

/** Aplica TODAS las reglas a TODOS los fixtures y devuelve las violaciones y la cobertura. */
export function auditarRegistro(r: Registro): { violaciones: string[]; sinCobertura: string[] } {
  const viol: string[] = [];
  const cubiertas = new Set<string>();
  for (const [k, fx] of r.fixtures.entries()) {
    for (const regla of r.reglas as readonly Regla<unknown>[]) {
      if (!regla.aplica(fx)) continue;
      cubiertas.add(regla.id);
      const insight = regla.producir(fx);
      try {
        validarInsight(insight, regla.id);
      } catch (e) {
        viol.push(`${regla.id} [fixture ${k}]: ${(e as Error).message}`);
      }
      for (const m of violaciones(insight)) viol.push(`${regla.id} [fixture ${k}]: ${m}`);
    }
  }
  const sinCobertura = (r.reglas as readonly Regla<unknown>[]).map((x) => x.id).filter((id) => !cubiertas.has(id));
  return { violaciones: viol, sinCobertura };
}

// ---------- Registro sintético para probar las propias invariantes ----------

interface D {
  n: number;
}
const fuenteBuena = { tabla: 'filas_sinteticas', periodo: 'semana sintética', n: 8 };
const base = (id: string): Pick<Insight, 'id' | 'agente' | 'severidad' | 'fuente'> => ({
  id,
  agente: 'peajes',
  severidad: 'info',
  fuente: fuenteBuena,
});

const reglaBuena = definirRegla<D>({
  id: 'SINT-OK',
  agente: 'peajes',
  aplica: () => true,
  producir: (d): Insight => ({
    ...base('SINT-OK'),
    tipo: 'candidato',
    quePaso: `${d.n} cruces parecen cobrados de más.`,
    queSignifica: 'Es un candidato, no un cobro confirmado.',
    queHacer: 'Validar con el tarifario antes de reclamar.',
  }),
});

describe('invariantes: motor de auditoría (con reglas sintéticas)', () => {
  it('una regla bien hecha pasa las tres invariantes', () => {
    const r = auditarRegistro({ reglas: [reglaBuena as Regla<never>], fixtures: [{ n: 8 }] });
    expect(r.violaciones).toEqual([]);
    expect(r.sinCobertura).toEqual([]);
  });

  it('NEGATIVO: una regla sin fuente falla', () => {
    const mala = definirRegla<D>({
      ...reglaBuena,
      id: 'SINT-SIN-FUENTE',
      producir: (d) => ({ ...reglaBuena.producir(d), fuente: undefined as never }),
    });
    const r = auditarRegistro({ reglas: [mala as Regla<never>], fixtures: [{ n: 1 }] });
    expect(r.violaciones.join('\n')).toMatch(/SINT-SIN-FUENTE.*fuente/);
  });

  it('NEGATIVO: una fuente sin periodo o con n inválido falla', () => {
    for (const fuente of [
      { tabla: 't', periodo: '', n: 3 },
      { tabla: 't', periodo: 'x', n: -1 },
      { periodo: 'x', n: 3 },
    ]) {
      const i = { ...reglaBuena.producir({ n: 1 }), fuente } as unknown as Insight;
      expect(violaciones(i).length).toBeGreaterThan(0);
    }
  });

  it('NEGATIVO: un candidato que no dice «candidato» o no pide verificar falla', () => {
    const base_ = reglaBuena.producir({ n: 2 });
    expect(violaciones({ ...base_, queSignifica: 'Es un cobro de más.' } as Insight)).toEqual(
      expect.arrayContaining([expect.stringMatching(/candidato/)]),
    );
    expect(violaciones({ ...base_, queHacer: 'Reclamar el monto al proveedor.' } as Insight).length).toBeGreaterThan(0);
  });

  it('NEGATIVO: una cifra de ahorro sin línea base falla; con línea base pasa', () => {
    const sinBase = {
      ...base('SINT-AHORRO'),
      tipo: 'dato',
      quePaso: 'Se ahorró el 30% del tiempo.',
      queSignifica: 'El proceso es más rápido.',
      queHacer: 'Seguir midiendo.',
    } as Insight;
    expect(violaciones(sinBase)).toEqual(
      expect.arrayContaining([expect.stringMatching(/ahorro sin línea base/)]),
    );
    const conBase = { ...sinBase, fuente: { ...fuenteBuena, tabla: TABLA_LINEA_BASE } } as Insight;
    expect(violaciones(conBase)).toEqual([]);
  });

  it('el texto de ahorro sin cifra (pendiente) es válido', () => {
    const pendiente = {
      ...base('SINT-PEND'),
      tipo: 'dato',
      quePaso: 'El ahorro está pendiente: falta la medida de hoy.',
      queSignifica: 'Todavía no se puede decir cuánto se ahorra.',
      queHacer: 'Esperar a tener 30 días de datos.',
    } as Insight;
    // «30 días» es una cifra de plazo, no de ahorro: con la fuente buena se acepta solo si no hay cifra de ahorro.
    expect(violaciones({ ...pendiente, queHacer: 'Esperar a tener datos suficientes.' } as Insight)).toEqual([]);
  });

  it('ahorroSeguro nunca da cifra sin línea base ni medida suficiente', () => {
    const linea: LineaBase = {
      proceso: 'p',
      minutosPorUnidad: 20,
      unidad: 'viaje',
      fuente: 'cronometraje sintético',
      capturadaEn: '2026-09-01T00:00:00Z',
    };
    const medida: Medida = {
      proceso: 'p',
      minutosPorUnidad: 5,
      unidad: 'viaje',
      n: 40,
      desde: '2026-09-01T00:00:00Z',
      hasta: '2026-10-05T00:00:00Z',
      fuente: 'registro sintético',
    };
    expect(ahorroSeguro(null, medida).pct).toBeNull();
    expect(ahorroSeguro(linea, null).pct).toBeNull();
    expect(ahorroSeguro(linea, { ...medida, n: 3 }).pct).toBeNull();
    const ok = ahorroSeguro(linea, medida);
    expect(ok.pct).toBe(75);
    expect(ok.fuente?.base.tabla).toBe(TABLA_LINEA_BASE);
  });

  it('componer deja pasar solo insights válidos (la puerta de ejecución coincide con las invariantes)', () => {
    const sinFuente = definirRegla<D>({
      ...reglaBuena,
      id: 'SINT-X',
      producir: (d) => ({ ...reglaBuena.producir(d), fuente: undefined as never }),
    });
    expect(() => componer([sinFuente], { n: 1 })).toThrow();
    expect(componer([reglaBuena], { n: 1 }).total).toBe(1);
  });
});

describe('invariantes: reglas registradas (registro.ts de insights)', () => {
  it('todas las reglas registradas cumplen las tres invariantes en todos sus fixtures', async () => {
    const registros = await cargarRegistros();
    const todos = registros.flatMap(({ archivo, registro }) => {
      const r = auditarRegistro(registro);
      return [
        ...r.violaciones.map((m) => `${archivo}: ${m}`),
        ...r.sinCobertura.map((id) => `${archivo}: la regla ${id} no aplica en ningún fixture`),
      ];
    });
    expect(todos).toEqual([]);
  });

  it('los ids de regla son únicos entre todos los registros', async () => {
    const registros = await cargarRegistros();
    const ids = registros.flatMap(({ registro }) => (registro.reglas as readonly Regla<unknown>[]).map((r) => r.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------- Textos de pantalla de los 5 agentes ----------

const DIRS_AGENTES = ['liquidacion', 'peajes', 'carta-porte', 'vigia', 'conductores'];

/** Porcentajes admitidos que NO son ahorro: umbrales legales/fiscales con su cita. */
const PORCENTAJES_ADMITIDOS: { archivo: string; fragmento: string; motivo: string }[] = [
  {
    archivo: 'src/app/dashboard/agentes/liquidacion/rotulo-diferencia.ts',
    fragmento: '15%',
    motivo: 'umbral fiscal de combustible pagado sin medio admitido, no es ahorro',
  },
];
/** Textos que nombran «ahorro» solo para NEGARLO (no estiman ni muestran una cifra). Exactos, por archivo; cualquier otro texto con «ahorro» sigue fallando. */
const AHORRO_NEGADO_ADMITIDO: { archivo: string; fragmento: string; motivo: string }[] = [
  {
    archivo: 'src/app/dashboard/agentes/conductores/vista.tsx',
    fragmento: 'ninguna cifra de ahorro se estima sobre cero',
    motivo: 'el estado vacío declara que NO se estima ahorro sin hitos medidos; es la regla, no una cifra',
  },
];
const CITA_LEGAL = /\b(ley|LIF|RMF|art\.|regla)\b/i;

/** Quita comentarios y devuelve solo texto visible: literales de cadena y texto JSX. */
export function textosVisibles(codigo: string): string[] {
  const sinComentarios = codigo.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
  const salida: string[] = [];
  for (const m of sinComentarios.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) salida.push(m[2]);
  for (const m of sinComentarios.matchAll(/(?<![=-])>([^<>{};]*[^\s<>{};][^<>{};]*)</g)) salida.push(m[1].replace(/\s+/g, ' ').trim());
  return salida;
}

/** Hallazgos de un texto visible: porcentaje o ahorro. */
export function hallazgosTexto(texto: string, archivo: string): string[] {
  const h: string[] = [];
  if (/^\d+(\.\d+)?%$/.test(texto.trim()) && /ancho|alto/.test(texto)) return h;
  if (/\d+\s?%/.test(texto)) {
    const admitido =
      CITA_LEGAL.test(texto) || PORCENTAJES_ADMITIDOS.some((a) => a.archivo === archivo && texto.includes(a.fragmento));
    if (!admitido) h.push(`porcentaje sin cita ni fuente: «${texto}»`);
  }
  if (/ahorr/i.test(texto) && !AHORRO_NEGADO_ADMITIDO.some((a) => a.archivo === archivo && texto.includes(a.fragmento))) h.push(`menciona ahorro fuera de ahorroSeguro: «${texto}»`);
  return h;
}

function archivosPantalla(dir: string): string[] {
  const salida: string[] = [];
  const recorrer = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) recorrer(p);
      else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) salida.push(p);
    }
  };
  recorrer(dir);
  return salida;
}

/** Anchos de barras de carga (`ancho="55%"`) son estilo, no un dato. */
const sinEstilos = (codigo: string) => codigo.replace(/\b(ancho|alto|width|height)=(["'{]+)\s*[\d.]+%["'}]+/g, '');

describe('invariantes: textos de pantalla de los 5 agentes', () => {
  it('el escáner detecta «30%» y «ahorr…» en texto visible (caso negativo)', () => {
    const codigo = `const a = <p>Ahorras 30% de tiempo</p>; const b = "Se ahorró mucho"; // ahorro 90%`;
    const hallazgos = textosVisibles(codigo).flatMap((t) => hallazgosTexto(t, 'x.tsx'));
    expect(hallazgos.length).toBe(3);
    expect(textosVisibles(codigo).join('|')).not.toMatch(/90/);
  });

  it('un porcentaje con cita legal se admite y uno sin cita no', () => {
    expect(hallazgosTexto('hasta el 50% según la ley', 'x.tsx')).toEqual([]);
    expect(hallazgosTexto('mejoró 20%', 'x.tsx')).toHaveLength(1);
  });

  it('ni identificadores ni comentarios ni anchos de barra cuentan como texto de pantalla', () => {
    const codigo = `// ahorro 10%\nconst pAhorro = f(ahorro);\nreturn <Barra ancho="55%" />;`;
    const hallazgos = textosVisibles(sinEstilos(codigo)).flatMap((t) => hallazgosTexto(t, 'x.tsx'));
    expect(hallazgos).toEqual([]);
  });

  it('las pantallas de los 5 agentes no muestran porcentajes sin cita ni hablan de ahorro', () => {
    const todos: string[] = [];
    let revisados = 0;
    for (const a of DIRS_AGENTES) {
      for (const archivo of archivosPantalla(join(RAIZ, 'src/app/dashboard/agentes', a))) {
        revisados += 1;
        const rel = relative(RAIZ, archivo);
        const codigo = sinEstilos(readFileSync(archivo, 'utf8'));
        for (const t of textosVisibles(codigo)) for (const m of hallazgosTexto(t, rel)) todos.push(`${rel}: ${m}`);
      }
    }
    expect(revisados).toBeGreaterThan(5);
    expect(todos).toEqual([]);
  });
});
