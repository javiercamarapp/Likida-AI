import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { clasificarTitulo, normalizar } from './disparadores';
import { DISPARADORES } from './disparadores';
import { evaluarDia, type RespuestaHttp } from './dof';
import { ejecutarVigilancia, marcarAvisados, cambioReal, MAX_FETCH, MAX_DIAS, URL_SAT, urlLey, URL_SIDOF, type Traer } from './ejecutar';
import { estadoVacio, leerEstado, TOPE_VISTOS, type EstadoVigilancia } from './estado';
import { hoyMx, sumarDias, diaDeSemana, aFormatoSidof } from './fechas';

// ═══════════════════════════════════════════════════════════════════════════
// La lógica pura de la vigilancia normativa con respuestas SIDOF SIMULADAS (la forma real se verificó con curl el
// 14-nov-2026: ver el encabezado de `dof.ts`). El reloj se congela: ninguna prueba depende de la fecha de hoy.
//
// Calendario de las pruebas: «hoy» = lunes 16-nov-2026 (08:00 CDMX), así que «ayer» = domingo 15-nov-2026.
//   13-nov viernes · 14-nov sábado · 15-nov domingo.
// ═══════════════════════════════════════════════════════════════════════════

const AHORA = new Date('2026-11-16T14:00:00Z');

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(AHORA); });
afterEach(() => { vi.useRealTimers(); });

type Item = { codNota: number; titulo?: string };
interface Dia {
  matutina?: Item[];
  vespertina?: Item[];
  extraordinaria?: Item[];
  /** Qué dice `diarios/porFecha`; por omisión se deduce de las notas. `'ninguna'` = 404. */
  diarios?: 'ninguna' | { Matutina?: boolean; Vespertina?: boolean; Extraordinaria?: boolean };
}

const ok = (cuerpo: unknown, extra: Partial<RespuestaHttp> = {}): RespuestaHttp => ({ status: 200, etag: null, lastModified: null, cuerpo, ...extra });
const edicion = (hay: boolean | undefined) => (hay ? [{ codDiario: 1 }] : null);

function respuestasDelDia(d: Dia): { diarios: RespuestaHttp; notas: RespuestaHttp } {
  const mat = d.matutina ?? [];
  const ves = d.vespertina ?? [];
  const ext = d.extraordinaria ?? [];
  const diarios = d.diarios === 'ninguna' || (d.diarios === undefined && mat.length + ves.length + ext.length === 0)
    ? { status: 404, etag: null, lastModified: null, cuerpo: { messageCode: 404, response: 'NOT_FOUND' } }
    : ok({
      messageCode: 200, response: 'OK',
      Matutina: edicion(typeof d.diarios === 'object' ? d.diarios.Matutina : mat.length > 0),
      Vespertina: edicion(typeof d.diarios === 'object' ? d.diarios.Vespertina : ves.length > 0),
      Extraordinaria: edicion(typeof d.diarios === 'object' ? d.diarios.Extraordinaria : ext.length > 0),
    });
  const notas = ok({ messageCode: 200, response: 'OK', NotasMatutinas: mat, NotasVespertinas: ves, NotasExtraordinarias: ext, imagenesDiario: [], audioSumario: [] });
  return { diarios, notas };
}

interface Mundo {
  dias?: Record<string, Dia>;
  /** Respuesta a un HEAD; una función puede lanzar. */
  heads?: Record<string, RespuestaHttp | Error>;
  /** Todo GET falla de red. */
  redCaida?: boolean;
}

function traerDe(m: Mundo) {
  const llamadas: string[] = [];
  const traer: Traer = async (url, metodo) => {
    llamadas.push(`${metodo} ${url}`);
    if (m.redCaida && metodo === 'GET') throw new Error('getaddrinfo ENOTFOUND sidofqa.segob.gob.mx');
    if (metodo === 'HEAD') {
      const h = m.heads?.[url];
      if (h instanceof Error) throw h;
      return h ?? { status: 404, etag: null, lastModified: null, cuerpo: null };
    }
    const mDiarios = /\/diarios\/porFecha\/(\d{2})-(\d{2})-(\d{4})$/.exec(url);
    const mNotas = /\/notas\/(\d{2})-(\d{2})-(\d{4})$/.exec(url);
    const mm = mDiarios ?? mNotas;
    if (!mm) throw new Error(`URL inesperada en la prueba: ${url}`);
    const iso = `${mm[3]}-${mm[2]}-${mm[1]}`;
    const dia = m.dias?.[iso] ?? {};
    const r = respuestasDelDia(dia);
    return mDiarios ? r.diarios : r.notas;
  };
  return { traer, llamadas };
}

/** Estado de partida con lo semanal y lo trimestral YA hechos, para aislar el barrido diario. */
const base = (extra: Partial<EstadoVigilancia> = {}): EstadoVigilancia => ({
  ...estadoVacio(), ultimoDiaBarrido: '2026-11-12', ultimoSemanal: '2026-11-16', ultimoTrimestral: '2026-10', ...extra,
});

const correr = (estado: EstadoVigilancia, mundo: Mundo, ahora: Date = AHORA) => {
  const t = traerDe(mundo);
  return ejecutarVigilancia({ estado, ahora, traer: t.traer, pausar: async () => {}, reloj: () => Date.now(), venceEn: Date.now() + 105_000 })
    .then((r) => ({ r, llamadas: t.llamadas }));
};

const MISCELANEA = 'Resolución Miscelánea Fiscal para 2026, Anexos 1, 3 y 20.';

describe('el diccionario de disparadores', () => {
  it('normaliza acentos y mayúsculas', () => {
    expect(normalizar('  MISCELÁNEA   Fiscal ')).toBe('miscelanea fiscal');
    expect(clasificarTitulo('RESOLUCION MISCELANEA FISCAL')?.etiquetas).toContain('Miscelánea Fiscal');
    expect(clasificarTitulo(MISCELANEA)?.etiquetas).toEqual(expect.arrayContaining(['Miscelánea Fiscal', 'Anexo']));
  });
  it('cada frase del SKILL.md dispara', () => {
    const casos: Array<[string, string]> = [
      ['facilidades administrativas', 'Resolución de facilidades administrativas para 2026'],
      ['Resolución de Facilidades', 'Resolución de Facilidades Administrativas'],
      ['Ley de Ingresos', 'Decreto por el que se expide la Ley de Ingresos de la Federación para el Ejercicio Fiscal de 2027.'],
      ['Código Fiscal', 'Decreto que reforma el Código Fiscal de la Federación'],
      ['Impuesto sobre la Renta', 'Decreto que modifica la Ley del Impuesto sobre la Renta'],
      ['valor agregado', 'Ley del Impuesto al Valor Agregado'],
      ['producción y servicios', 'Ley del Impuesto Especial sobre Producción y Servicios'],
      ['datos personales', 'Lineamientos de protección de datos personales'],
      ['autotransporte', 'Norma de autotransporte federal'],
      ['Nota Aclaratoria', 'NOTA Aclaratoria a la Resolución'],
      ['Fe de erratas', 'FE de erratas al Anexo 3'],
    ];
    for (const [etiqueta, titulo] of casos) expect(clasificarTitulo(titulo)?.etiquetas, titulo).toContain(etiqueta);
  });
  it('«anexo» exige palabra completa y un título ajeno no dispara', () => {
    expect(clasificarTitulo('Convenio de colaboración. Anexo técnico 2')?.etiquetas).toContain('Anexo');
    expect(clasificarTitulo('Cañaverales del anexo-a')?.etiquetas ?? []).toContain('Anexo'); // guion = límite de palabra
    expect(clasificarTitulo('Los Anexos 1 y 3 de la Resolución')?.etiquetas).toContain('Anexo');
    expect(clasificarTitulo('Convocatoria Anexonet y reanexos')).toBeNull();
    expect(clasificarTitulo('Decreto por el que se reforma el Código Penal Federal y la Ley Federal de Protección a la Propiedad Industrial.')).toBeNull();
    expect(clasificarTitulo('')).toBeNull();
  });
  it('la cuota/estímulo del diésel entra con su etiqueta, sin calcular nada', () => {
    const c = clasificarTitulo('ACUERDO por el que se dan a conocer los montos de los estímulos fiscales aplicables a la enajenación de diésel (cuota IEPS)');
    expect(c?.etiquetas).toContain('cuota diésel');
    expect(c?.fichas).toContain('lif-2026-20-A.yaml');
    expect(clasificarTitulo('Precio del diésel para el transporte marítimo')).toBeNull();
  });
  it('cada ficha del mapa existe en normas/ (renombrar una ficha sin actualizar el mapa falla aquí)', () => {
    const todas = new Set([...DISPARADORES.flatMap((d) => d.fichas), 'lif-2026-20-A.yaml']);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- los nombres salen de las constantes del propio diccionario, no de una entrada de usuario.
    for (const f of todas) expect(existsSync(`normas/${f}`), `normas/${f}`).toBe(true);
  });
});

describe('fechas en hora de México', () => {
  it('a las 23:30 del domingo en CDMX ya es lunes en UTC, pero «hoy» sigue siendo domingo', () => {
    expect(hoyMx(new Date('2026-11-16T05:30:00Z'))).toBe('2026-11-15'); // 23:30 del domingo en CDMX (UTC-6)
    expect(hoyMx(new Date('2026-11-16T06:30:00Z'))).toBe('2026-11-16');
  });
  it('aritmética y día de la semana', () => {
    expect(sumarDias('2026-11-16', -1)).toBe('2026-11-15');
    expect(sumarDias('2026-02-28', 1)).toBe('2026-03-01');
    expect(diaDeSemana('2025-12-28')).toBe(0); // la RMF 2026 salió en domingo
    expect(aFormatoSidof('2026-11-13')).toBe('13-11-2026');
  });
});

describe('evaluarDia: el cruce anti-silencio', () => {
  const vi13 = '2026-11-13'; // viernes
  it('día normal: notas leídas, sin fallo', () => {
    const { diarios, notas } = respuestasDelDia({ matutina: [{ codNota: 1, titulo: 'a' }] });
    const r = evaluarDia(vi13, diarios, notas);
    expect(r.fallo).toBeNull();
    expect(r.notas).toHaveLength(1);
  });
  it('edición presente con notas vacías = fallo de la fuente, no «sin novedades»', () => {
    const { diarios, notas } = respuestasDelDia({ matutina: [{ codNota: 1, titulo: 'a' }], diarios: { Matutina: true, Vespertina: true } });
    const r = evaluarDia(vi13, diarios, notas);
    expect(r.fallo?.codigo).toBe('edicion_sin_notas');
    expect(r.fallo?.causa).toContain('Vespertina');
  });
  it('día hábil con 0 notas = fallo, y lo marca como respaldado por diarios', () => {
    const { diarios, notas } = respuestasDelDia({});
    const r = evaluarDia(vi13, diarios, notas);
    expect(r.fallo).toMatchObject({ codigo: 'dia_habil_sin_notas', diariosSinEdicion: true });
  });
  it('fin de semana con 0 notas y diarios sin edición = día sin publicación, no fallo', () => {
    const { diarios, notas } = respuestasDelDia({});
    expect(evaluarDia('2026-11-14', diarios, notas).fallo).toBeNull();
  });
  it('un fin de semana CON edición se lee (la RMF 2026 salió en domingo)', () => {
    const { diarios, notas } = respuestasDelDia({ matutina: [{ codNota: 5777217, titulo: MISCELANEA }] });
    const r = evaluarDia('2025-12-28', diarios, notas);
    expect(r.fallo).toBeNull();
    expect(r.notas[0]).toMatchObject({ codNota: 5777217, edicion: 'Matutina' });
  });
  it('forma inesperada de notas (HTTP 200 sin las listas) es fallo, no vacío', () => {
    const { diarios } = respuestasDelDia({ matutina: [{ codNota: 1, titulo: 'a' }] });
    expect(evaluarDia(vi13, diarios, ok({ messageCode: 200, response: 'OK' })).fallo?.codigo).toBe('notas_forma');
    expect(evaluarDia(vi13, diarios, ok('<html>', { status: 200 })).fallo?.codigo).toBe('notas_forma');
    expect(evaluarDia(vi13, diarios, { status: 500, etag: null, lastModified: null, cuerpo: null }).fallo?.codigo).toBe('notas_forma');
  });
  it('diarios con forma inesperada es fallo', () => {
    const { notas } = respuestasDelDia({ matutina: [{ codNota: 1, titulo: 'a' }] });
    expect(evaluarDia(vi13, { status: 502, etag: null, lastModified: null, cuerpo: null }, notas).fallo?.codigo).toBe('diarios_forma');
  });
  it('un item sin título se cuenta y no rompe nada', () => {
    const { diarios, notas } = respuestasDelDia({ vespertina: [{ codNota: 5803836 }, { codNota: 5803837, titulo: 'Decreto X' }] });
    const r = evaluarDia(vi13, diarios, notas);
    expect(r.fallo).toBeNull();
    expect(r.sinTitulo).toBe(1);
    expect(r.notas.map((n) => n.titulo)).toEqual([null, 'Decreto X']);
  });
});

describe('ejecutarVigilancia: el barrido diario', () => {
  it('día normal con coincidencia: un aviso con codNota, URL SIDOF y fichas; el cursor llega a ayer', async () => {
    const { r } = await correr(base({ ultimoDiaBarrido: '2026-11-14' }), {
      dias: { '2026-11-15': { matutina: [{ codNota: 5800001, titulo: MISCELANEA }, { codNota: 5800002, titulo: 'Convocatoria de licitación de obra' }] } },
    });
    expect(r.fallos).toEqual([]);
    expect(r.estado.ultimoDiaBarrido).toBe('2026-11-15');
    expect(r.nuevos).toHaveLength(1);
    expect(r.nuevos[0]).toMatchObject({ tipo: 'dof', codNota: 5800001 });
    expect(r.nuevos[0].linea).toContain('15-11-2026');
    expect(r.nuevos[0].linea).toContain('Matutina');
    expect(r.nuevos[0].linea).toContain(`${URL_SIDOF}/notas/nota/5800001`);
    expect(r.nuevos[0].linea).toContain('rmf-2026-2.7.1.21.yaml');
    expect(r.nuevos[0].linea).not.toContain('nota_detalle'); // robots.txt lo prohíbe
    expect(r.nuevos[0].linea.length).toBeLessThanOrEqual(300);
    expect(r.notasRevisadas).toBe(2);
    expect(r.estado.pendientes).toHaveLength(1);
  });

  it('día sin coincidencias: nada que avisar, pero se leyeron notas (eso sí es «sin cambios»)', async () => {
    const { r } = await correr(base({ ultimoDiaBarrido: '2026-11-14' }), {
      dias: { '2026-11-15': { matutina: [{ codNota: 1, titulo: 'Convocatoria de licitación' }] } },
    });
    expect(r.nuevos).toEqual([]);
    expect(r.notasRevisadas).toBe(1);
    expect(r.estado.ultimoDiaBarrido).toBe('2026-11-15');
    expect(r.fallos).toEqual([]);
  });

  it('domingo con RMF: se barre (7 días de la semana) y se avisa', async () => {
    const domingo = new Date('2025-12-29T14:00:00Z'); // lunes 29-dic; ayer = domingo 28-dic
    const { r } = await correr(
      { ...estadoVacio(), ultimoDiaBarrido: '2025-12-27', ultimoSemanal: '2025-12-29', ultimoTrimestral: '2025-12' },
      { dias: { '2025-12-28': { matutina: [{ codNota: 5777217, titulo: 'RESOLUCIÓN Miscelánea Fiscal para 2026.' }] } } },
      domingo,
    );
    expect(r.nuevos.map((n) => n.codNota)).toEqual([5777217]);
    expect(r.estado.ultimoDiaBarrido).toBe('2025-12-28');
  });

  it('la vespertina se lee igual que la matutina', async () => {
    const { r } = await correr(base({ ultimoDiaBarrido: '2026-11-14' }), {
      dias: { '2026-11-15': { vespertina: [{ codNota: 7, titulo: 'ACUERDO por el que se dan a conocer los estímulos fiscales del diésel (cuota IEPS)' }] } },
    });
    expect(r.nuevos[0].linea).toContain('Vespertina');
    expect(r.nuevos[0].linea).toContain('cuota diésel');
  });

  it('edición presente con notas vacías: FALLO, el cursor NO avanza más allá del día anterior', async () => {
    const { r } = await correr(base(), {
      dias: {
        '2026-11-13': { matutina: [{ codNota: 1, titulo: 'Convocatoria' }], diarios: { Matutina: true, Vespertina: true } }, // vespertina dice que salió y viene vacía
        '2026-11-14': {}, '2026-11-15': {},
      },
    });
    expect(r.estado.ultimoDiaBarrido).toBe('2026-11-12'); // no se movió
    expect(r.fallos).toEqual([expect.objectContaining({ codigo: 'edicion_sin_notas', dia: '2026-11-13' })]);
    expect(r.estado.fallosSeguidos).toBe(1);
  });

  it('un fallo no se salta: los días siguientes se leen (sus avisos salen) pero el cursor se queda', async () => {
    const { r } = await correr(base(), {
      dias: {
        '2026-11-13': { matutina: [{ codNota: 1, titulo: 'x' }], diarios: { Matutina: true, Extraordinaria: true } },
        '2026-11-14': { matutina: [{ codNota: 9, titulo: 'Fe de erratas a la Resolución Miscelánea Fiscal' }] },
        '2026-11-15': {},
      },
    });
    expect(r.estado.ultimoDiaBarrido).toBe('2026-11-12');
    expect(r.nuevos.map((n) => n.codNota)).toEqual([9]);
  });

  it('fallo de NUESTRA red: el cursor no avanza, no se presenta como «sin cambios» y no se sale a otras fuentes', async () => {
    const t = await correr({ ...base(), ultimoSemanal: null, ultimoTrimestral: null }, { redCaida: true });
    expect(t.r.estado.ultimoDiaBarrido).toBe('2026-11-12');
    expect(t.r.fallos[0]).toMatchObject({ codigo: 'red', dia: '2026-11-13' });
    expect(t.r.diasBarridos).toBe(0);
    expect(t.r.notasRevisadas).toBe(0);
    expect(t.llamadas.some((l) => l.startsWith('HEAD'))).toBe(false);
  });

  it('un día hábil con 0 notas retiene el cursor (modo de falla 3)', async () => {
    const { r } = await correr(base(), { dias: { '2026-11-13': {}, '2026-11-14': {}, '2026-11-15': {} } });
    expect(r.estado.ultimoDiaBarrido).toBe('2026-11-12');
    expect(r.fallos[0].codigo).toBe('dia_habil_sin_notas');
    expect(r.estado.retenido).toEqual({ dia: '2026-11-13', intentos: 1 });
  });

  it('feriado: tras 3 corridas con diarios Y notas vacíos, el día se da por sin edición y queda declarado', async () => {
    const mundo: Mundo = { dias: { '2026-11-13': {}, '2026-11-14': {}, '2026-11-15': {} } };
    let estado = base();
    const resultados: Array<Awaited<ReturnType<typeof correr>>['r']> = [];
    for (let i = 0; i < 3; i += 1) {
      const { r } = await correr(estado, mundo);
      resultados.push(r);
      estado = r.estado;
    }
    expect(resultados[0].estado.ultimoDiaBarrido).toBe('2026-11-12');
    expect(resultados[1].estado.retenido).toEqual({ dia: '2026-11-13', intentos: 2 });
    expect(resultados[2].estado.ultimoDiaBarrido).toBe('2026-11-15');
    expect(resultados[2].estado.diasSinEdicion).toContain('2026-11-13');
    expect(resultados[2].estado.retenido).toBeNull();
  });

  it('el feriado NO se acepta si diarios dice que salió una edición (eso es caída, siempre)', async () => {
    let estado = base({ retenido: { dia: '2026-11-13', intentos: 5 } });
    const { r } = await correr(estado, { dias: { '2026-11-13': { diarios: { Matutina: true } } } });
    expect(r.estado.ultimoDiaBarrido).toBe('2026-11-12');
    expect(r.fallos[0].codigo).toBe('edicion_sin_notas');
    estado = r.estado;
  });

  it('dedup por codNota: ni lo ya avisado ni lo pendiente se repite', async () => {
    const mundo: Mundo = { dias: { '2026-11-15': { matutina: [{ codNota: 11, titulo: MISCELANEA }, { codNota: 12, titulo: 'Fe de erratas a la RMF' }] } } };
    const e = base({ ultimoDiaBarrido: '2026-11-14', vistos: [11] });
    const a = await correr(e, mundo);
    expect(a.r.nuevos.map((n) => n.codNota)).toEqual([12]);
    // Reintento tras un fallo de correo: 12 sigue pendiente y NO se vuelve a anotar.
    const b = await correr({ ...a.r.estado, ultimoDiaBarrido: '2026-11-14' }, mundo);
    expect(b.r.nuevos).toEqual([]);
    expect(b.r.estado.pendientes).toHaveLength(1);
  });

  it('marcarAvisados mueve a vistos, acota a 200 y vacía los pendientes enviados', () => {
    const vistos = Array.from({ length: TOPE_VISTOS }, (_, i) => i + 1);
    const e = { ...estadoVacio(), vistos, pendientes: [{ tipo: 'dof' as const, codNota: 999, linea: 'l1' }, { tipo: 'sat' as const, linea: 'l2' }] };
    const r = marcarAvisados(e, [e.pendientes[0]]);
    expect(r.vistos).toHaveLength(TOPE_VISTOS);
    expect(r.vistos.at(-1)).toBe(999);
    expect(r.vistos[0]).toBe(2);
    expect(r.pendientes.map((p) => p.linea)).toEqual(['l2']);
  });

  it('rezago de más de 10 días: se barren 10, el cursor se queda 10 adelante y el latido lo declara', async () => {
    const ahora = new Date('2026-12-16T14:00:00Z'); // ayer = 15-dic; cursor 12-nov → 33 días atrás
    const dias: Record<string, Dia> = {};
    for (let i = 1; i <= 40; i += 1) { const d = sumarDias('2026-11-12', i); dias[d] = { matutina: [{ codNota: 100 + i, titulo: 'Convocatoria' }] }; }
    const { r } = await correr({ ...base(), ultimoSemanal: '2026-12-14', ultimoTrimestral: '2026-10' }, { dias }, ahora);
    expect(r.diasBarridos).toBe(MAX_DIAS);
    expect(r.estado.ultimoDiaBarrido).toBe(sumarDias('2026-11-12', MAX_DIAS));
    expect(r.rezagoDias).toBe(33 - MAX_DIAS);
  });

  it('primera corrida: arranca 7 días atrás', async () => {
    const { llamadas } = await correr({ ...estadoVacio(), ultimoSemanal: '2026-11-16', ultimoTrimestral: '2026-10' }, {});
    const primer = llamadas.find((l) => l.includes('/diarios/porFecha/'));
    expect(primer).toContain('09-11-2026'); // hoy 16 − 7
  });

  it('ya al día: no hay nada que barrer y NO se declara lectura', async () => {
    const { r, llamadas } = await correr(base({ ultimoDiaBarrido: '2026-11-15' }), {});
    expect(r.diasBarridos).toBe(0);
    expect(r.notasRevisadas).toBe(0);
    expect(llamadas).toEqual([]);
  });

  it('nunca pide más de MAX_FETCH, con lo semanal y lo trimestral encima', async () => {
    const ahora = new Date('2026-10-05T14:00:00Z'); // lunes 5-oct, mes de trimestre
    const dias: Record<string, Dia> = {};
    for (let i = 1; i <= 20; i += 1) dias[sumarDias('2026-09-01', i)] = { matutina: [{ codNota: i, titulo: 'x' }] };
    const heads: Record<string, RespuestaHttp> = {};
    for (const u of [URL_SAT['2026'], ...['CFF', 'LISR', 'LIVA', 'LFPDPPP'].map(urlLey)]) heads[u] = ok(null, { etag: '"a"', lastModified: 'x' });
    const { r, llamadas } = await correr({ ...estadoVacio(), ultimoDiaBarrido: '2026-09-01', ultimoSemanal: null, ultimoTrimestral: null }, { dias, heads }, ahora);
    expect(llamadas.length).toBeLessThanOrEqual(MAX_FETCH);
    expect(r.peticiones).toBe(llamadas.length);
    expect(r.corrioSemanal && r.corrioTrimestral).toBe(true);
  });

  it('sin tiempo para otro día: se detiene y lo declara (parcial), sin avanzar de más', async () => {
    const t = traerDe({ dias: { '2026-11-13': { matutina: [{ codNota: 1, titulo: 'x' }] } } });
    const r = await ejecutarVigilancia({ estado: base(), ahora: AHORA, traer: t.traer, pausar: async () => {}, reloj: () => Date.now(), venceEn: Date.now() + 1_000 });
    expect(r.sinTurno).toBe(true);
    expect(r.diasBarridos).toBe(0);
    expect(r.estado.ultimoDiaBarrido).toBe('2026-11-12');
  });
});

describe('ejecutarVigilancia: SAT (semanal) y leyes (trimestral)', () => {
  const lunes = base({ ultimoDiaBarrido: '2026-11-15', ultimoSemanal: '2026-11-09' }); // el lunes anterior
  const sat = (etag: string, lm = 'Fri, 13 Nov 2026 00:15:11 GMT') => ok(null, { etag, lastModified: lm });

  it('primer HEAD: línea base sin aviso; el 2027 en 404 se ignora sin alarma', async () => {
    const { r } = await correr(lunes, { heads: { [URL_SAT['2026']]: sat('"v1"') } });
    expect(r.nuevos).toEqual([]);
    expect(r.fallos).toEqual([]);
    expect(r.estado.sat['2026']?.etag).toBe('"v1"');
    expect(r.estado.sat['2027']).toBeUndefined();
    expect(r.estado.ultimoSemanal).toBe('2026-11-16');
  });

  it('cambio de ETag: aviso «anticipada SAT posible»', async () => {
    const e = { ...lunes, sat: { '2026': { etag: '"v1"', lastModified: 'Fri, 13 Nov 2026 00:15:11 GMT' } } };
    const { r } = await correr(e, { heads: { [URL_SAT['2026']]: sat('"v2"', 'Mon, 16 Nov 2026 01:00:00 GMT') } });
    expect(r.nuevos).toHaveLength(1);
    expect(r.nuevos[0].tipo).toBe('sat');
    expect(r.nuevos[0].linea).toContain('anticipada SAT posible');
    expect(r.nuevos[0].linea).toContain('"v1"');
    expect(r.nuevos[0].linea).toContain('"v2"');
  });

  it('el balanceador del SAT (otro nodo: segundos de diferencia y ETag débil/gzip) NO es un cambio; uno real sí', async () => {
    // Medido el 14-nov-2026: 00:15:11 con "6af6568f-44eb1" y 00:14:54 con W/"6af6567e-44eb1-gunzip-gzip" para la MISMA página.
    const e = { ...lunes, sat: { '2026': { etag: '"6af6568f-44eb1"', lastModified: 'Fri, 13 Nov 2026 00:15:11 GMT' } } };
    const { r } = await correr(e, { heads: { [URL_SAT['2026']]: sat('W/"6af6567e-44eb1-gunzip-gzip"', 'Fri, 13 Nov 2026 00:14:54 GMT') } });
    expect(r.nuevos).toEqual([]);
    expect(cambioReal({ etag: '"a"', lastModified: 'Fri, 13 Nov 2026 00:15:11 GMT' }, { etag: '"b"', lastModified: 'Mon, 16 Nov 2026 01:00:00 GMT' })).toBe(true);
    expect(cambioReal({ etag: 'W/"abc-gzip"', lastModified: null }, { etag: '"abc"', lastModified: null })).toBe(false);
    expect(cambioReal({ etag: '"abc"', lastModified: null }, { etag: '"abd"', lastModified: null })).toBe(true);
  });

  it('mismo ETag y Last-Modified: sin aviso', async () => {
    const e = { ...lunes, sat: { '2026': { etag: '"v1"', lastModified: 'Fri, 13 Nov 2026 00:15:11 GMT' } } };
    const { r } = await correr(e, { heads: { [URL_SAT['2026']]: sat('"v1"') } });
    expect(r.nuevos).toEqual([]);
  });

  it('no es lunes y la última vez fue hace menos de 7 días: no hay HEAD', async () => {
    const martes = new Date('2026-11-17T14:00:00Z');
    const { llamadas } = await correr(base({ ultimoDiaBarrido: '2026-11-15', ultimoSemanal: '2026-11-16' }), {}, martes);
    expect(llamadas.some((l) => l.startsWith('HEAD'))).toBe(false);
  });

  it('si el HEAD del lunes falló, se reintenta al día siguiente (pasaron ≥ 7 días desde el último éxito)', async () => {
    const martes = new Date('2026-11-17T14:00:00Z');
    const { llamadas } = await correr(base({ ultimoDiaBarrido: '2026-11-16', ultimoSemanal: '2026-11-09' }), { heads: { [URL_SAT['2026']]: sat('"v1"') } }, martes);
    expect(llamadas.some((l) => l.startsWith('HEAD') && l.includes('rgce2026'))).toBe(true);
  });

  it('aparece la variante 2027 con la base 2026 ya tomada: aviso', async () => {
    const e = { ...lunes, sat: { '2026': { etag: '"v1"', lastModified: 'x' } } };
    const { r } = await correr(e, { heads: { [URL_SAT['2026']]: sat('"v1"', 'x'), [URL_SAT['2027']]: sat('"n1"') } });
    expect(r.nuevos.map((n) => n.linea).join('\n')).toContain('2027');
  });

  it('un HEAD que falla es fallo declarado (no silencio) y NO marca la semana como hecha', async () => {
    const { r } = await correr(lunes, { heads: { [URL_SAT['2026']]: { status: 503, etag: null, lastModified: null, cuerpo: null } } });
    expect(r.fallos).toEqual([expect.objectContaining({ codigo: 'sat_head' })]);
    expect(r.estado.ultimoSemanal).toBe('2026-11-09');
  });

  describe('trimestral', () => {
    const octubre = new Date('2026-10-01T14:00:00Z');
    const e0 = (extra: Partial<EstadoVigilancia> = {}): EstadoVigilancia => ({ ...estadoVacio(), ultimoDiaBarrido: '2026-09-30', ultimoSemanal: '2026-10-01', ultimoTrimestral: '2026-7', ...extra });
    const leyes = (lm: Record<string, string>): Record<string, RespuestaHttp> => Object.fromEntries(Object.entries(lm).map(([k, v]) => [urlLey(k), ok(null, { lastModified: v })]));

    it('deriva de Last-Modified: aviso «deriva de ley» solo de la ley que cambió', async () => {
      const guardado = { CFF: 'Sat, 18 Apr 2026 02:15:00 GMT', LISR: 'a', LIVA: 'b', LFPDPPP: 'c' };
      const { r } = await correr(e0({ leyes: guardado }), {
        dias: { '2026-09-30': { matutina: [{ codNota: 1, titulo: 'x' }] } },
        heads: leyes({ ...guardado, CFF: 'Wed, 30 Sep 2026 10:00:00 GMT' }),
      }, octubre);
      expect(r.corrioTrimestral).toBe(true);
      expect(r.nuevos).toHaveLength(1);
      expect(r.nuevos[0].tipo).toBe('ley');
      expect(r.nuevos[0].linea).toContain('CFF');
      expect(r.nuevos[0].linea).toContain('Deriva de ley');
      expect(r.estado.ultimoTrimestral).toBe('2026-10');
    });

    it('línea base sin aviso, y no repite en el mismo trimestre', async () => {
      const mundo: Mundo = { dias: { '2026-09-30': { matutina: [{ codNota: 1, titulo: 'x' }] } }, heads: leyes({ CFF: 'a', LISR: 'b', LIVA: 'c', LFPDPPP: 'd' }) };
      const a = await correr(e0(), mundo, octubre);
      expect(a.r.nuevos).toEqual([]);
      const b = await correr({ ...a.r.estado, ultimoDiaBarrido: '2026-09-30' }, mundo, new Date('2026-10-02T14:00:00Z'));
      expect(b.r.corrioTrimestral).toBe(false);
    });

    it('en un mes sin trimestre no corre', async () => {
      const { r } = await correr(base({ ultimoTrimestral: '2026-10' }), {});
      expect(r.corrioTrimestral).toBe(false);
    });
  });
});

describe('leerEstado: defensivo', () => {
  it('un detalle ajeno o malformado se lee como vacío en ese campo, sin lanzar', () => {
    expect(leerEstado(null)).toEqual(estadoVacio());
    expect(leerEstado({ vigilancia: 'x' })).toEqual(estadoVacio());
    const e = leerEstado({ vigilancia: { ultimoDiaBarrido: 'mañana', vistos: [1, 'a', NaN, 2], pendientes: [{ tipo: 'dof', linea: 'l' }, { tipo: 'otro' }], sat: { '2026': { etag: '"a"', lastModified: 5 } } } });
    expect(e.ultimoDiaBarrido).toBeNull();
    expect(e.vistos).toEqual([1, 2]);
    expect(e.pendientes).toHaveLength(1);
    expect(e.sat['2026']).toEqual({ etag: '"a"', lastModified: null });
  });
  it('acota vistos y pendientes', () => {
    const e = leerEstado({ vigilancia: { vistos: Array.from({ length: 500 }, (_, i) => i), pendientes: Array.from({ length: 80 }, (_, i) => ({ tipo: 'sat', linea: String(i) })) } });
    expect(e.vistos).toHaveLength(TOPE_VISTOS);
    expect(e.pendientes).toHaveLength(50);
    expect(e.vistos.at(-1)).toBe(499);
  });
});
