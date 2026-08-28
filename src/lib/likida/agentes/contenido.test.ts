import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// CONTENIDO FISCAL (0230) — el único de crecimiento que gasta modelo.
//
// Lo que estas pruebas afirman es lo que hace peligroso a un agente que
// redacta: que ELIGE por resta y no por corazonada, que NO escribe cuando el
// corpus no lo sostiene, y que el texto del modelo se TIRA ENTERO en cuanto
// rompe una regla editorial, inventa una cifra o cita una norma que ninguna
// ficha trajo. Ninguna prueba llama a un modelo de verdad.
// ═══════════════════════════════════════════════════════════════════════════

const respuestas = new Map<string, Array<{ data?: unknown; error?: { message: string } | null; count?: number }>>();
function builder(tabla: string) {
  const responder = () => {
    const cola = respuestas.get(tabla);
    return cola && cola.length > 0 ? cola.shift()! : { data: [], error: null, count: 0 };
  };
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b, eq: () => b, is: () => b, neq: () => b, not: () => b,
    gte: () => b, lt: () => b, order: () => b, limit: () => b,
    then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve().then(responder).then(res, rej),
  });
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
// Parcial: `analista.ts` arrastra config.ts, que lee otras constantes de este
// módulo. Solo se sustituye `acotada` para que las consultas del mock resuelvan
// sin el timeout real.
vi.mock('@/lib/likida/presupuesto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/likida/presupuesto')>()),
  acotada: (q: unknown) => q,
}));

const encolar = vi.fn(async (_p: unknown) => 'pieza-1');
vi.mock('./cola', () => ({ encolarPieza: (p: unknown) => encolar(p) }));

const registrar = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('./corridas', () => ({ registrarCorrida: (...a: unknown[]) => registrar(...a) }));

const generar = vi.fn(async (_o: unknown) => ({ text: '', cost: 0.02, noMedido: false }));
vi.mock('@/lib/llm/openrouter', () => ({ generateResponse: (o: unknown) => generar(o) }));

const {
  correrContenidoFiscal, siguienteTema, guardarBorrador, esqueletoCitado,
  piezaParaHumano, armarPiezaContenido, lineaDeFicha, MIN_FICHAS_PARA_ESCRIBIR,
} = await import('./contenido');
const { TEMAS_NORMATIVOS, normasPorTema } = await import('../normas/consulta');
const { ARTICULOS } = await import('../marketing/articulos');

const HOY = '2026-08-27';

/** Una ficha de mentira, con la forma que devuelve el corpus. */
function ficha(id: string, cita: string, extra: Partial<{ afirmable: boolean; jerarquia: number }> = {}) {
  return {
    norma_id: id, cita, titulo: `Título de ${id}`,
    jerarquia: (extra.jerarquia ?? 1) as 1, vinculante: true,
    estado: 'verificado_fuente_primaria' as const,
    afirmable: extra.afirmable ?? true, exigible_desde: null,
  };
}

function ultimoCuerpo(): string {
  return (encolar.mock.calls.at(-1)?.[0] as { cuerpo: string } | undefined)?.cuerpo ?? '';
}
function ultimasFuentes(): Record<string, unknown> {
  return (encolar.mock.calls.at(-1)?.[0] as { fuentes: Record<string, unknown> } | undefined)?.fuentes ?? {};
}

/**
 * La cola de respuestas de `cola_aprobacion`, EN EL ORDEN en que la corrida
 * pregunta: primero `temasRechazados` (qué temas ya juzgó una persona) y
 * después `piezaExistente` (¿ya hay pieza de este periodo?). Existe desde la
 * correctiva del ciclo 7 (c7-10): antes había una sola consulta y las pruebas
 * ponían un solo `{count}`, que es exactamente por qué nadie notó que una
 * pieza RECHAZADA se leía como «ya está en la bandeja».
 */
function colaAprobacion(
  { rechazados = [], existe = 0 }:
  { rechazados?: Array<{ fuentes: unknown; motivo_rechazo: string }>; existe?: number | undefined },
) {
  respuestas.set('cola_aprobacion', [
    { data: rechazados, error: null },
    { count: existe, error: null },
  ]);
}

beforeEach(() => {
  respuestas.clear();
  encolar.mockClear();
  encolar.mockResolvedValue('pieza-1');
  registrar.mockClear();
  generar.mockClear();
});

// ── La elección del tema: una RESTA, no una idea ───────────────────────────

describe('elige el tema por resta contra los temas ya cubiertos', () => {
  const dos = () => [ficha('a', 'LISR 27-III'), ficha('b', 'CFF 30')];

  it('devuelve el primero SIN cubrir, en el orden declarado del catálogo', () => {
    const c = siguienteTema([TEMAS_NORMATIVOS[0]], dos);
    expect(c?.tema).toBe(TEMAS_NORMATIVOS[1]);
    expect(c?.escribible).toBe(true);
  });

  it('es determinista: dos pasadas proponen el mismo tema', () => {
    expect(siguienteTema([], dos)?.tema).toBe(siguienteTema([], dos)?.tema);
  });

  it('con TODO cubierto devuelve null: no se inventa un tema fuera del catálogo', () => {
    expect(siguienteTema([...TEMAS_NORMATIVOS], dos)).toBeNull();
  });

  it('un tema sin fichas verificadas NO es escribible, y el motivo lo dice', () => {
    const c = siguienteTema([], () => []);
    expect(c?.escribible).toBe(false);
    expect(c?.motivo).toContain('NI UNA ficha verificada');
  });

  it('las fichas SIN verificar no cuentan: el producto no afirma sobre ellas', () => {
    const c = siguienteTema([], () => [ficha('a', 'X'), ficha('b', 'Y', { afirmable: false })]);
    expect(c?.escribible).toBe(false);
    expect(c?.motivo).toContain(`piso declarado de ${MIN_FICHAS_PARA_ESCRIBIR}`);
  });

  it('los artículos publicados declaran un tema del catálogo cerrado', () => {
    for (const a of ARTICULOS) {
      expect(TEMAS_NORMATIVOS as readonly string[], a.slug).toContain(a.tema);
    }
  });

  it('sobre el corpus REAL propone un tema que el blog todavía no cubre', () => {
    const c = siguienteTema(ARTICULOS.map((a) => a.tema), normasPorTema);
    expect(c).not.toBeNull();
    expect(ARTICULOS.map((a) => a.tema)).not.toContain(c?.tema);
  });
});

// ── Las tres guardias ──────────────────────────────────────────────────────

describe('las tres guardias tiran el texto ENTERO, jamás lo remiendan', () => {
  const fichas = [ficha('lif-2026-art-20-A', 'LIF 2026 20-A'), ficha('cff-30', 'CFF 30')];
  const contexto = 'FUENTES: LIF 2026 20-A · CFF 30';

  it('un texto limpio pasa y sale tal cual', () => {
    const g = guardarBorrador('El estímulo se acredita contra el ISR. Tu contador lo aplica.', fichas, contexto);
    expect(g.motivo).toBeNull();
    expect(g.texto).toContain('El estímulo se acredita');
  });

  it('vacío no pasa', () => {
    expect(guardarBorrador('   ', fichas, contexto).texto).toBeNull();
  });

  it('si el modelo declara que el corpus no alcanza, se le CREE', () => {
    const g = guardarBorrador('No alcanza el corpus para escribir esto.', fichas, contexto);
    expect(g.texto).toBeNull();
    expect(g.motivo).toContain('se respeta');
  });

  it('«clientes reales» tira la pieza y el motivo nombra la frase de la casa', () => {
    const g = guardarBorrador('Nuestros clientes reales lo confirman.', fichas, contexto);
    expect(g.texto).toBeNull();
    expect(g.motivo).toContain('en pláticas con transportistas');
  });

  it('«hasta un X%», el guion largo y prometer la recuperación también la tiran', () => {
    for (const malo of [
      'Recuperas hasta un 90 por ciento de tu diésel.',
      'El estímulo aplica — y aplica siempre.',
      'Te recuperamos ese dinero.',
    ]) {
      const g = guardarBorrador(malo, fichas, contexto);
      expect(g.texto, malo).toBeNull();
      expect(g.motivo, malo).toContain('regla(s) editorial(es)');
    }
  });

  it('nombrar a las flotas sin la frase honesta tira la pieza', () => {
    const g = guardarBorrador('Grupo GAL ya lo usa todos los días.', fichas, contexto);
    expect(g.texto).toBeNull();
    expect(g.motivo).toContain('se leen como clientes');
  });

  it('una cifra que ninguna ficha respalda tira la pieza', () => {
    const g = guardarBorrador('La tasa aplicable es del 37.4 por ciento en 2019.', fichas, contexto);
    expect(g.texto).toBeNull();
    expect(g.motivo).toContain('ninguna ficha del corpus respalda');
  });

  it('una cita fuera del corpus recuperado tira la pieza', () => {
    // El «27» va en el contexto A PROPÓSITO: sin él la guardia de CIFRAS
    // dispara primero y esta prueba no llegaría a probar la de citas. Con la
    // cifra respaldada, lo único que queda mal es la cita, que es el punto.
    const g = guardarBorrador(
      'Lo establece el artículo 27 fracción III de la LISR.', fichas, `${contexto} · 27`,
    );
    expect(g.texto).toBeNull();
    expect(g.motivo).toContain('fuera del corpus recuperado');
  });

  it('el orden de las guardias importa: la editorial dispara antes que la de cifras', () => {
    const g = guardarBorrador('Recuperas hasta un 90 por ciento.', fichas, contexto);
    expect(g.motivo).toContain('regla(s) editorial(es)');
    expect(g.motivo).not.toContain('cifra');
  });
});

// ── Los cuerpos ────────────────────────────────────────────────────────────

describe('los cuerpos dicen la verdad de cómo se hicieron', () => {
  const fichas = [ficha('a', 'LIF 2026 20-A'), ficha('b', 'CFF 30')];

  it('la línea de ficha enseña si la norma OBLIGA o solo orienta', () => {
    expect(lineaDeFicha({ ...ficha('a', 'X'), vinculante: false })).toContain('orienta, NO obliga');
    expect(lineaDeFicha(ficha('a', 'X'))).toContain('obliga');
  });

  it('con modelo declara que pasó las tres guardias y trae el fundamento del pie', () => {
    const c = armarPiezaContenido('carta_porte', fichas, 'El texto redactado.', null);
    expect(c).toContain('pasó las tres guardias');
    expect(c).toContain('El texto redactado.');
    expect(c).toContain('LIF 2026 20-A');
  });

  it('sin modelo cae al esqueleto de citas literales y DICE por qué', () => {
    const c = armarPiezaContenido('carta_porte', fichas, null, 'el modelo no respondió');
    expect(c).toContain('SIN REDACCIÓN DEL MODELO');
    expect(c).toContain('el modelo no respondió');
    expect(c).toContain('No hay redacción del modelo en esta pieza');
  });

  it('el esqueleto NO afirma nada: solo cita', () => {
    const e = esqueletoCitado('carta_porte', fichas);
    expect(e).toContain('solo las citas');
    expect(e).toContain('entra por un PR');
  });

  it('la pieza «lo escribe un humano» explica el camino para desbloquearla', () => {
    const p = piezaParaHumano('privacidad_de_datos', 'el corpus no alcanza');
    expect(p).toContain('ESTO LO ESCRIBE UN HUMANO');
    expect(p).toContain('experto_fiscal');
    expect(p).toContain('el tap de Javier');
  });

  it('TODA pieza recuerda que aprobar NO publica: el artículo entra por un PR', () => {
    for (const c of [
      armarPiezaContenido('carta_porte', fichas, 'texto', null),
      armarPiezaContenido('carta_porte', fichas, null, 'x'),
    ]) {
      expect(c).toContain('aprobar esta pieza NO la publica');
      expect(c).toContain('Publicar es un merge');
    }
  });
});

// ── La corrida ─────────────────────────────────────────────────────────────

describe('la corrida completa', () => {
  it('redacta, guarda y encola el borrador con el costo MEDIDO', async () => {
    colaAprobacion({});
    generar.mockResolvedValue({ text: 'Un borrador limpio y sin cifras.', cost: 0.031, noMedido: false });
    const r = await correrContenidoFiscal('cron', HOY);
    expect(r).toMatchObject({ resultado: 'corrio', piezas: 1 });
    expect(r.costoUsd).toBeCloseTo(0.031, 5);
    expect(ultimoCuerpo()).toContain('Un borrador limpio');
    expect(ultimasFuentes().con_modelo).toBe(true);
    expect(registrar.mock.calls.at(-1)?.[2]).toMatchObject({ costoUsd: 0.031 });
  });

  it('usa el rol `marketing`, que es prosa con voz y cifras del guion', async () => {
    colaAprobacion({});
    generar.mockResolvedValue({ text: 'Texto.', cost: 0.01, noMedido: false });
    await correrContenidoFiscal('cron', HOY);
    expect((generar.mock.calls[0][0] as { role: string }).role).toBe('marketing');
  });

  it('el prompt del sistema PROHÍBE citar fuera de FUENTES y nombrar clientes', async () => {
    colaAprobacion({});
    generar.mockResolvedValue({ text: 'Texto.', cost: 0, noMedido: false });
    await correrContenidoFiscal('cron', HOY);
    const sys = (generar.mock.calls[0][0] as { system: string }).system;
    expect(sys).toContain('Likida NO tiene clientes');
    expect(sys).toContain('no aparezca literalmente en FUENTES');
    expect(sys).toContain('TU SALIDA NO SE PUBLICA');
  });

  it('un borrador que rompe la marca NO llega a la bandeja: sale el esqueleto', async () => {
    colaAprobacion({});
    generar.mockResolvedValue({ text: 'Cientos de flotas confían y son clientes reales.', cost: 0.02, noMedido: false });
    const r = await correrContenidoFiscal('cron', HOY);
    expect(r.piezas).toBe(1);
    // La FRASE del modelo no aparece por ningún lado. Lo que sí aparece es el
    // motivo, que nombra la regla rota: quien revisa la pieza tiene que poder
    // ver qué se descartó y por qué, sin que el texto descartado se cuele.
    expect(ultimoCuerpo()).not.toContain('Cientos de flotas confían');
    expect(ultimoCuerpo()).toContain('SIN REDACCIÓN DEL MODELO');
    expect(ultimasFuentes().con_modelo).toBe(false);
  });

  it('el modelo caído NO tumba la corrida: la pieza sale con el esqueleto', async () => {
    colaAprobacion({});
    generar.mockRejectedValue(new Error('502 del proveedor'));
    const r = await correrContenidoFiscal('cron', HOY);
    expect(r.piezas).toBe(1);
    expect(ultimoCuerpo()).toContain('el modelo no respondió');
  });

  it('si el borrador del tema ya está en la bandeja, NO se propone el siguiente', async () => {
    colaAprobacion({ existe: 1 });
    const r = await correrContenidoFiscal('cron', HOY);
    expect(r.piezas).toBe(0);
    expect(generar).not.toHaveBeenCalled();
    expect(r.motivo).toContain('ya está en la bandeja');
  });

  it('la bandeja ilegible: fail closed, ni se llama al modelo', async () => {
    // El `count` que NO llega: `piezaExistente` no puede afirmar un 0 que
    // nadie midió. Se arma a mano porque `colaAprobacion` tiene default.
    respuestas.set('cola_aprobacion', [
      { data: [], error: null },
      { count: undefined, error: null },
    ]);
    await expect(correrContenidoFiscal('cron', HOY)).rejects.toThrow(/no devolvió el conteo/);
    expect(generar).not.toHaveBeenCalled();
    expect(registrar.mock.calls.at(-1)?.[2]).toMatchObject({ estado: 'fallo' });
  });

  it('el costo gastado ANTES de un fallo se anota igual: el techo no puede quedar ciego', async () => {
    colaAprobacion({});
    generar.mockResolvedValue({ text: 'Texto.', cost: 0.05, noMedido: false });
    encolar.mockRejectedValue(new Error('la cola no aceptó'));
    await expect(correrContenidoFiscal('cron', HOY)).rejects.toThrow(/la cola no aceptó/);
    expect(registrar.mock.calls.at(-1)?.[2]).toMatchObject({ estado: 'fallo', costoUsd: 0.05 });
  });

  it('un duplicado que rebota en el índice único NO es un fallo', async () => {
    colaAprobacion({});
    generar.mockResolvedValue({ text: 'Texto.', cost: 0, noMedido: false });
    encolar.mockRejectedValue(new Error('duplicate key value violates unique constraint'));
    const r = await correrContenidoFiscal('cron', HOY);
    expect(r).toMatchObject({ resultado: 'corrio', piezas: 0 });
    expect(r.motivo).toContain('otra corrida ganó el tema');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LAS PRUEBAS QUE FALTABAN — auditoría adversarial del ciclo 7.
//
// Las dos de abajo son los dos hallazgos ALTOS de este archivo escritos como
// prueba. Las dos pasaban por debajo de la suite en verde porque el mock
// llegaba SIEMPRE en el caso feliz: nunca una pieza rechazada, nunca un
// `noMedido: true`.
// ═══════════════════════════════════════════════════════════════════════════

describe('c7-10 · un borrador RECHAZADO no deja mudo al agente, y el motivo no miente', () => {
  /** El tema que el agente propondría hoy sin nada rechazado: el primero del
   *  catálogo que /blog no cubre. Se calcula, no se escribe: publicar un
   *  artículo nuevo movería la respuesta y una constante mentiría. */
  const primerTema = siguienteTema(ARTICULOS.map((a) => a.tema), normasPorTema)!.tema;

  it('rechazado NO es «ya está en la bandeja»: el catálogo avanza al siguiente tema', async () => {
    // El primer tema del catálogo tiene su borrador rechazado, y su fila sigue
    // ocupando el título en `cola_aprobacion` (el índice único de la 0230 no
    // mira el estado). Antes de este arreglo: `piezaExistente` contaba 1 →
    // «0 piezas, ya está en la bandeja» → y como el tema seguía sin artículo
    // publicado, el selector NUNCA avanzaba. El agente quedaba apagado de
    // facto para siempre, con un motivo falso.
    colaAprobacion({
      rechazados: [{ fuentes: { tema: primerTema }, motivo_rechazo: 'muy genérico, cita mal la RMF' }],
      existe: 0,
    });
    generar.mockResolvedValue({ text: 'Texto.', cost: 0.01, noMedido: false });

    const r = await correrContenidoFiscal('cron', HOY);

    expect(r.piezas, 'el agente tiene que seguir produciendo, no callarse').toBe(1);
    expect(r.motivo).toBeUndefined();
    // Y la pieza es de OTRO tema: el rechazado no se vuelve a redactar solo.
    expect(ultimasFuentes().tema).not.toBe(primerTema);
  });

  it('con TODOS los temas cubiertos o rechazados, el motivo dice cuál es cuál y trae el motivo humano', async () => {
    // Todo el catálogo rechazado: no queda tema. El agente no puede fingir que
    // «ya está todo cubierto en /blog» — son dos hechos distintos y el que
    // desatasca es el segundo.
    colaAprobacion({
      rechazados: TEMAS_NORMATIVOS.map((t) => ({
        fuentes: { tema: t }, motivo_rechazo: `no me gustó ${t}`,
      })),
      existe: 0,
    });

    const r = await correrContenidoFiscal('cron', HOY);

    expect(r.piezas).toBe(0);
    expect(generar, 'sin tema no se gasta un peso de modelo').not.toHaveBeenCalled();
    expect(r.motivo).toContain('con el borrador RECHAZADO');
    expect(r.motivo).toContain(`no me gustó ${primerTema}`);
    expect(r.motivo).toContain('borra su pieza de la bandeja o publica el artículo');
    expect(r.motivo, 'no se puede afirmar que estén cubiertos en /blog').not.toContain('todos cubiertos en /blog');
  });

  it('una fila rechazada de otro agente o sin tema legible NO cuenta como tema juzgado', async () => {
    colaAprobacion({
      rechazados: [
        { fuentes: null, motivo_rechazo: 'sin fuentes' },
        { fuentes: { tema: 'tema_que_no_existe_en_el_catalogo' }, motivo_rechazo: 'basura' },
      ],
      existe: 0,
    });
    generar.mockResolvedValue({ text: 'Texto.', cost: 0.01, noMedido: false });

    const r = await correrContenidoFiscal('cron', HOY);
    // El catálogo NO se recorta por filas que no dicen de qué tema hablan.
    expect(ultimasFuentes().tema).toBe(primerTema);
    expect(r.piezas).toBe(1);
  });

  it('la lista de rechazados ilegible: fail closed, ni se llama al modelo', async () => {
    respuestas.set('cola_aprobacion', [{ data: null, error: { message: 'fetch failed' } }]);
    await expect(correrContenidoFiscal('cron', HOY)).rejects.toThrow(/temasRechazados: fetch failed/);
    expect(generar).not.toHaveBeenCalled();
  });
});

describe('c7-11 · un costo NO MEDIDO se anota como desconocido, jamás como $0', () => {
  it('noMedido: la corrida anota costo NULL, no cero', async () => {
    colaAprobacion({});
    // El proveedor omitió `usage`. Antes esto anotaba `costo_usd = 0` —el
    // `cost: 0` que llega en modo plataforma, donde no hay reserva—, y ese cero
    // entraba a la columna con la que el runner compara el techo de $1/día:
    // `gastoDelDiaUsd` sumaba ceros, nunca llegaba a $1.00 y el candado NUNCA
    // cortaba mientras el agente seguía gastando de verdad.
    generar.mockResolvedValue({ text: 'Texto.', cost: 0, noMedido: true });

    const r = await correrContenidoFiscal('cron', HOY);

    expect(r.costoUsd, 'un costo desconocido no es cero').toBeNull();
    expect(registrar.mock.calls.at(-1)?.[2]).toMatchObject({ estado: 'ok', costoUsd: null });
  });

  it('medido: se anota el número, y un 0 medido sigue siendo un 0', async () => {
    colaAprobacion({});
    generar.mockResolvedValue({ text: 'Texto.', cost: 0, noMedido: false });
    const r = await correrContenidoFiscal('cron', HOY);
    expect(r.costoUsd, 'este 0 SÍ se midió: no es lo mismo que null').toBe(0);
    expect(registrar.mock.calls.at(-1)?.[2]).toMatchObject({ costoUsd: 0 });
  });

  it('el costo desconocido se arrastra hasta el latido de FALLO: tampoco ahí se vuelve 0', async () => {
    colaAprobacion({});
    generar.mockResolvedValue({ text: 'Texto.', cost: 0, noMedido: true });
    encolar.mockRejectedValue(new Error('la cola no aceptó'));
    await expect(correrContenidoFiscal('cron', HOY)).rejects.toThrow(/la cola no aceptó/);
    expect(registrar.mock.calls.at(-1)?.[2]).toMatchObject({ estado: 'fallo', costoUsd: null });
  });
});
