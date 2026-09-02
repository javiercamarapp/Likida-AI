import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LOS SEIS DE LEADS (0235).
//
// Las pruebas son de COMPORTAMIENTO, no de forma: lo que se afirma es que un
// prospecto sin señal NO recibe un cero, que «nunca se le tocó» no se lee como
// «hace mucho», que una propuesta sin precio declarado sale sin precio, y que
// el cazador declara con todas sus letras que no buscó nada en internet.
// ═══════════════════════════════════════════════════════════════════════════

const respuestas = new Map<string, Array<{ data?: unknown; error?: { message: string } | null; count?: number }>>();
/** Cuántas veces se consultó cada tabla. Es lo único que deja verificar que
 *  un `.in(...)` de miles de ids se parta en lotes: la URL que PostgREST no
 *  aguanta no se ve desde aquí, pero el número de vueltas sí. */
const consultas = new Map<string, number>();
function builder(tabla: string) {
  consultas.set(tabla, (consultas.get(tabla) ?? 0) + 1);
  const responder = () => {
    const cola = respuestas.get(tabla);
    return cola && cola.length > 0 ? cola.shift()! : { data: [], error: null, count: 0 };
  };
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b, eq: () => b, is: () => b, neq: () => b, not: () => b,
    in: () => b, gte: () => b, lt: () => b, order: () => b, limit: () => b,
    maybeSingle: () => b,
    then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve().then(responder).then(res, rej),
  });
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));

const encolar = vi.fn(async (_p: unknown) => 'pieza-1');
vi.mock('./cola', () => ({ encolarPieza: (p: unknown) => encolar(p) }));

const registrar = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('./corridas', () => ({ registrarCorrida: (...a: unknown[]) => registrar(...a) }));

const {
  AGENTES_LEADS, esAgenteLeads, correrAgenteLeads,
  lunesDe, diasDesde,
  puntuar, armarParteScorer, MIN_SENALES,
  armarFicha, tituloFicha,
  avisosDelVigia, armarParteVigia, DIAS_PLAZO, DIAS_RESPUESTA_FRIA,
  armarBriefDemo, tituloBrief,
  armarPropuesta, tituloPropuesta,
  perfilQueConvierte, celdasSinTrabajar, nuevosSinTocar, armarEncargoCaza,
  MIN_AVANZADOS_PARA_PERFIL, IDS_POR_LOTE, TOPE_PROSPECTOS,
} = await import('./leads');

const HOY = '2026-08-27'; // jueves
const LUNES = '2026-08-24';

function ultimoCuerpo(): string {
  const p = encolar.mock.calls.at(-1)?.[0] as { cuerpo: string } | undefined;
  return p?.cuerpo ?? '';
}
function ultimoTitulo(): string {
  const p = encolar.mock.calls.at(-1)?.[0] as { titulo: string } | undefined;
  return p?.titulo ?? '';
}

/** Las señales completas de una empresa que sí se investigó. */
function senalesLlenas(over: Record<string, unknown> = {}) {
  return {
    id: 'p1', empresa: 'Transportes ZZZ',
    numUnidades: 40, unidades: '31-100',
    sitio: 'zzz.mx', sitioWeb: 'https://zzz.mx', sitioVerificado: true,
    scian: '484110', vacante: 'Auxiliar de liquidaciones', estado: 'nuevo',
    correos: 2, similitudPct: 100, necesidadPct: 75,
    ...over,
  };
}

beforeEach(() => {
  respuestas.clear();
  consultas.clear();
  encolar.mockClear();
  encolar.mockResolvedValue('pieza-1');
  registrar.mockClear();
});

// ── El catálogo y la aritmética ────────────────────────────────────────────

describe('el catálogo de leads', () => {
  it('son exactamente los seis del departamento y el predicado los reconoce', () => {
    expect(AGENTES_LEADS).toHaveLength(6);
    expect(new Set(AGENTES_LEADS).size).toBe(6);
    for (const id of AGENTES_LEADS) expect(esAgenteLeads(id)).toBe(true);
    expect(esAgenteLeads('redactor')).toBe(false);
    expect(esAgenteLeads('automejora')).toBe(false);
  });

  it('lunesDe cae en lunes cualquier día de la semana y no cruza de fecha', () => {
    for (const d of ['2026-08-24', '2026-08-27', '2026-08-30']) {
      expect(lunesDe(d)).toBe(LUNES);
    }
    expect(lunesDe('2026-08-31')).toBe('2026-08-31');
  });

  it('diasDesde distingue «nunca» de «hoy»: null NO es 0', () => {
    expect(diasDesde(null, HOY)).toBeNull();
    expect(diasDesde('no-es-una-fecha', HOY)).toBeNull();
    expect(diasDesde('2026-08-27T12:00:00Z', HOY)).toBe(0);
    expect(diasDesde('2026-08-17T12:00:00Z', HOY)).toBe(10);
  });
});

// ── 1. Scorer ──────────────────────────────────────────────────────────────

describe('scorer: sin señal NO hay número', () => {
  it('con menos del piso de señales el puntaje es NULL, no 0', () => {
    const p = puntuar(senalesLlenas({
      numUnidades: null, unidades: null, sitio: null, sitioWeb: null,
      correos: 0, similitudPct: 0,
    }));
    expect(p.senales).toBeLessThan(MIN_SENALES);
    expect(p.puntoPct).toBeNull();
    expect(p.motivoInsuficiente).toContain('SEÑAL INSUFICIENTE');
    expect(p.motivoInsuficiente).toContain('AUSENCIA');
  });

  it('la lista de lo que falta dice CÓMO se consigue, no solo qué falta', () => {
    const p = puntuar(senalesLlenas({ numUnidades: null, unidades: null, sitio: null, sitioWeb: null, correos: 0 }));
    expect(p.faltan.some((f) => f.includes('/getdemo'))).toBe(true);
    expect(p.faltan.some((f) => f.includes('investigador'))).toBe(true);
  });

  it('con señal suficiente CITA el derivado de la base y no lo recalcula', () => {
    const p = puntuar(senalesLlenas({ similitudPct: 85 }));
    expect(p.senales).toBe(5);
    expect(p.puntoPct).toBe(85);
    expect(p.motivoInsuficiente).toBeNull();
  });

  it('señales suficientes pero derivado NULL: tampoco se afirma un puntaje', () => {
    const p = puntuar(senalesLlenas({ similitudPct: null }));
    expect(p.puntoPct).toBeNull();
    expect(p.motivoInsuficiente).toContain('no que valga cero');
  });

  it('el parte sin una sola fila nombra las DOS lecturas y no afirma un cero', () => {
    const cuerpo = armarParteScorer([], HOY, false);
    expect(cuerpo).toContain('NI UN SOLO PROSPECTO VIVO');
    expect(cuerpo).toContain('no hay prospectos sin cerrar');
    expect(cuerpo).toContain('ninguna es un puntaje');
  });

  it('el parte dice que a los insuficientes NO se les descarta', () => {
    const cuerpo = armarParteScorer([puntuar(senalesLlenas({
      numUnidades: null, unidades: null, sitio: null, sitioWeb: null, correos: 0,
    }))], HOY, false);
    expect(cuerpo).toContain('ESTOS NO LLEVAN NÚMERO');
    expect(cuerpo).toContain('no descartarlos');
  });

  it('la ventana truncada se DICE y los conteos se declaran un piso', () => {
    expect(armarParteScorer([puntuar(senalesLlenas())], HOY, true)).toContain('un PISO, no el total');
  });

  it('la corrida encola con título por semana y anota su corrida', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    respuestas.set('prospecto', [{ data: [{ id: 'p1', empresa: 'ZZZ', similitud_icp_pct: 90, scian: '484', vacante: 'x', num_unidades: 10, sitio: 'z.mx', sitio_verificado: true, estado: 'nuevo' }], error: null, count: 1 }]);
    respuestas.set('prospecto_correo', [{ data: [{ prospecto_id: 'p1' }], error: null }]);
    const r = await correrAgenteLeads('scorer', 'cron', HOY);
    expect(r).toMatchObject({ resultado: 'corrio', piezas: 1, costoUsd: 0 });
    expect(ultimoTitulo()).toBe(`Scorer — semana del ${LUNES}`);
    expect(registrar).toHaveBeenCalled();
  });

  it('si la pieza de la semana ya está, no fabrica otra', async () => {
    respuestas.set('cola_aprobacion', [{ count: 1, error: null }]);
    const r = await correrAgenteLeads('scorer', 'cron', HOY);
    expect(r.piezas).toBe(0);
    expect(encolar).not.toHaveBeenCalled();
  });

  it('un conteo que PostgREST no devuelve es fail-closed, no un cero', async () => {
    respuestas.set('cola_aprobacion', [{ count: undefined, error: null }]);
    await expect(correrAgenteLeads('scorer', 'cron', HOY)).rejects.toThrow(/no se afirma un 0/);
  });

  // Con el censo real (decenas de miles de filas), un `.in()` con todos los
  // ids son cientos de KB de query string y PostgREST contesta 414 antes de
  // llegar a Postgres. El lote no es una optimización: sin él este camino se
  // rompe SIEMPRE.
  it('la lista de ids se parte en lotes: un solo .in() con miles de ids no cabe en la URL', async () => {
    const n = IDS_POR_LOTE * 2 + 1;
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    respuestas.set('prospecto', [{
      data: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, empresa: `ZZZ ${i}`, estado: 'nuevo' })),
      error: null, count: n,
    }]);
    await correrAgenteLeads('scorer', 'cron', HOY);
    expect(consultas.get('prospecto_correo')).toBe(3);
  });

  it('un lote que falla LANZA: media lista diría «sin correos» de los que no llegaron', async () => {
    const n = IDS_POR_LOTE + 1;
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    respuestas.set('prospecto', [{
      data: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, empresa: `ZZZ ${i}`, estado: 'nuevo' })),
      error: null, count: n,
    }]);
    respuestas.set('prospecto_correo', [
      { data: [], error: null },
      { data: null, error: { message: 'el segundo lote no llegó' } },
    ]);
    await expect(correrAgenteLeads('scorer', 'cron', HOY)).rejects.toThrow(/el segundo lote no llegó/);
  });

  it('la tabla ilegible LANZA en vez de afirmar que no hay señal', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    respuestas.set('prospecto', [{ data: null, error: { message: 'base caída' } }]);
    await expect(correrAgenteLeads('scorer', 'cron', HOY)).rejects.toThrow(/base caída/);
  });
});

// ── 2. Dossier ─────────────────────────────────────────────────────────────

describe('dossier: la raya entre lo verificado y lo que solo se supone', () => {
  const base = {
    id: 'p1', empresa: 'Transportes ZZZ', ciudad: 'Monterrey', estado: 'demo',
    vacante: null, numUnidades: null, unidades: null, sitio: null,
    sitioVerificado: false, historiaProspecto: null,
    dossier: null, personas: [], correos: [],
  };

  it('lo que no consta se imprime como NO CONSTA, no como un guion', () => {
    const c = armarFicha(base, HOY);
    expect(c).toContain('Vacante publicada (la señal del censo): NO CONSTA');
    expect(c).toContain('Tamaño de flota (unidades): NO CONSTA');
  });

  it('sin dossier del investigador NO se inventa historia', () => {
    const c = armarFicha(base, HOY);
    expect(c).toContain('NUNCA SE INVESTIGÓ');
    expect(c).toContain('inventar una historia de empresa');
  });

  it('un sitio sin verificar se rotula como no verificado', () => {
    const c = armarFicha({ ...base, sitio: 'zzz.mx' }, HOY);
    expect(c).toContain('NO VERIFICADO: nadie ha comprobado');
  });

  it('un dossier SIN fuentes registradas se declara no verificado entero', () => {
    const c = armarFicha({
      ...base,
      dossier: { historia: 'Fundada en 1990', empleados: null, flotilla: null, telefonos: null, fuentes: [], investigadoEn: '2026-08-01T00:00:00Z' },
    }, HOY);
    expect(c).toContain('NINGUNA REGISTRADA');
    expect(c).toContain('se lee como no verificado');
  });

  it('un contacto INFERIDO se rotula como no verificado en el texto', () => {
    const c = armarFicha({
      ...base,
      personas: [{ nombre: 'ZZZ', puesto: null, correo: 'a@zzz.mx', telefono: null, origen: 'inferido', confianza: 'baja', evidencia: null }],
    }, HOY);
    expect(c).toContain('INFERIDO — NO VERIFICADO');
  });

  it('la ficha declara lo que NO puede decir', () => {
    expect(armarFicha(base, HOY)).toContain('estimarlo sería inventarlo');
  });

  // La regla de la #152: un motor que ITERA honra el reloj de la vuelta. Este
  // busca candidato preguntando a la bandeja UNA VEZ POR EMPRESA, así que la
  // búsqueda misma puede comerse el turno de quien viene detrás.
  it('con el reloj YA vencido no gasta ni una consulta de bandeja y lo dice', async () => {
    respuestas.set('prospecto', [{ data: [{ id: 'p1', empresa: 'ZZZ', estado: 'demo' }], error: null }]);
    // Si preguntara por la pieza, esta cola contestaría con un fallo y la
    // corrida lanzaría. Que devuelva limpio prueba que ni la pidió.
    respuestas.set('cola_aprobacion', [{ data: null, error: { message: 'nadie debería preguntar' } }]);
    const r = await correrAgenteLeads('dossier', 'cron', HOY, Date.now() - 1);
    expect(r).toMatchObject({ resultado: 'corrio', piezas: 0, sinTurno: true });
    expect(r.motivo).toContain('quedaron empresas sin mirar');
    expect(encolar).not.toHaveBeenCalled();
  });

  it('«no me alcanzó el reloj» NO se confunde con «no había a quién fichar»', async () => {
    respuestas.set('prospecto', [{ data: [], error: null }]);
    const sinNadie = await correrAgenteLeads('dossier', 'cron', HOY, Date.now() - 1);
    expect(sinNadie.sinTurno).toBeUndefined();
    expect(sinNadie.motivo).toContain('no hay a quién fichar');
  });

  it('con reloj de sobra la búsqueda corre entera', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    respuestas.set('prospecto', [{ data: [{ id: 'p1', empresa: 'ZZZ', estado: 'demo' }], error: null }]);
    const r = await correrAgenteLeads('dossier', 'cron', HOY, Date.now() + 60_000);
    expect(r).toMatchObject({ resultado: 'corrio', piezas: 1 });
    expect(r.sinTurno).toBeUndefined();
  });

  it('sin candidato NO fabrica nada y lo dice sin llamarlo fallo', async () => {
    respuestas.set('prospecto', [{ data: [], error: null }]);
    const r = await correrAgenteLeads('dossier', 'cron', HOY);
    expect(r).toMatchObject({ resultado: 'corrio', piezas: 0 });
    expect(r.motivo).toContain('no es un fallo');
    expect(encolar).not.toHaveBeenCalled();
  });

  it('el título es por EMPRESA, no por periodo', () => {
    expect(tituloFicha('  Transportes ZZZ  ')).toBe('Dossier — Transportes ZZZ');
  });
});

// ── 3. Vigía ───────────────────────────────────────────────────────────────

describe('vigia: contestó, se venció el plazo, o la etapa no cuadra', () => {
  it('quien contestó DESPUÉS de la última salida encabeza la lista', () => {
    const a = avisosDelVigia([
      { id: 'a', empresa: 'A', estado: 'contactado', ultimaSalida: '2026-08-01T00:00:00Z', ultimaRespuesta: null },
      { id: 'b', empresa: 'B', estado: 'contactado', ultimaSalida: '2026-08-20T00:00:00Z', ultimaRespuesta: '2026-08-22T00:00:00Z' },
    ], HOY);
    expect(a[0]).toMatchObject({ id: 'b', senal: 'contesto' });
    expect(a[0].que).toContain('más rápido se enfría');
  });

  it('si ya se le volvió a escribir DESPUÉS de que contestó, la pelota es de ellos', () => {
    const a = avisosDelVigia([
      { id: 'b', empresa: 'B', estado: 'contactado', ultimaSalida: '2026-08-26T00:00:00Z', ultimaRespuesta: '2026-08-22T00:00:00Z' },
    ], HOY);
    expect(a).toHaveLength(0);
  });

  it(`el plazo se levanta a los ${DIAS_PLAZO} días, y no antes`, () => {
    const salida = (dias: number) => {
      const d = new Date(`${HOY}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - dias);
      return d.toISOString();
    };
    expect(avisosDelVigia([{ id: 'a', empresa: 'A', estado: 'contactado', ultimaSalida: salida(DIAS_PLAZO - 1), ultimaRespuesta: null }], HOY)).toHaveLength(0);
    const a = avisosDelVigia([{ id: 'a', empresa: 'A', estado: 'contactado', ultimaSalida: salida(DIAS_PLAZO), ultimaRespuesta: null }], HOY);
    expect(a[0].senal).toBe('plazo_vencido');
  });

  it('«nunca se le tocó» NO se lee como «hace mucho»: es una contradicción y se dice así', () => {
    const a = avisosDelVigia([{ id: 'a', empresa: 'A', estado: 'demo', ultimaSalida: null, ultimaRespuesta: null }], HOY);
    expect(a[0]).toMatchObject({ senal: 'etapa_sin_historial', dias: null });
    expect(a[0].que).toContain('No es «lleva mucho sin toque»');
  });

  it('una respuesta reciente se distingue de una fría por el umbral declarado', () => {
    const hace = (dias: number) => {
      const d = new Date(`${HOY}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - dias);
      return d.toISOString();
    };
    const reciente = avisosDelVigia([{ id: 'a', empresa: 'A', estado: 'demo', ultimaSalida: null, ultimaRespuesta: hace(DIAS_RESPUESTA_FRIA - 1) }], HOY);
    expect(reciente[0].que).toContain('La pelota es nuestra');
    const fria = avisosDelVigia([{ id: 'a', empresa: 'A', estado: 'demo', ultimaSalida: null, ultimaRespuesta: hace(DIAS_RESPUESTA_FRIA) }], HOY);
    expect(fria[0].que).toContain('nadie le ha vuelto');
  });

  it('cero vigilados NO es «cero actividad» y el parte lo separa', () => {
    expect(armarParteVigia([], 0, HOY, false)).toContain('no hay a quién vigilar');
  });

  it('vigilados sin señales es un resultado medido, no un hueco', () => {
    expect(armarParteVigia([], 12, HOY, false)).toContain('resultado medido, no un hueco');
  });

  it('el parte declara que NO devuelve leads al pool ni manda seguimientos', () => {
    expect(armarParteVigia([], 3, HOY, false)).toContain('NO devuelve leads al pool');
  });

  it('la corrida titula por DÍA (no por semana): el vigía es diario', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    respuestas.set('prospecto', [{ data: [{ id: 'p1', empresa: 'ZZZ', estado: 'contactado' }], error: null, count: 1 }]);
    respuestas.set('prospecto_contacto', [{ data: [], error: null }]);
    await correrAgenteLeads('vigia', 'cron', HOY);
    expect(ultimoTitulo()).toBe(`Vigía de leads — ${HOY}`);
  });

  it('el historial ilegible LANZA: poner a todos en «nunca se le tocó» sería una afirmación falsa', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    respuestas.set('prospecto', [{ data: [{ id: 'p1', empresa: 'ZZZ', estado: 'contactado' }], error: null, count: 1 }]);
    respuestas.set('prospecto_contacto', [{ data: null, error: { message: 'sin respuesta' } }]);
    await expect(correrAgenteLeads('vigia', 'cron', HOY)).rejects.toThrow(/sin respuesta/);
  });
});

// ── 4. Demo prep ───────────────────────────────────────────────────────────

describe('demo_prep: lo medido y lo supuesto, separados', () => {
  const base = {
    id: 'p1', empresa: 'Transportes ZZZ', ciudad: null, estado: 'demo',
    vacante: null, urgencia: null, numUnidades: null, unidades: null,
    viajesMesEstimado: null, necesidadPct: null, historia: null, vendedor: null,
    personas: [], toques: [],
  };

  it('declara que la ETAPA no es una cita y que no sabe día ni hora', () => {
    expect(armarBriefDemo(base, HOY)).toContain('NO una cita');
  });

  it('sin flota capturada NO la estima: la vuelve la primera pregunta', () => {
    const c = armarBriefDemo(base, HOY);
    expect(c).toContain('Tamaño de flota: NO CONSTA');
    expect(c).toContain('PRIMERA pregunta');
    expect(c).toContain('no se encadena sobre un supuesto');
  });

  it('los viajes al mes se rotulan ESTIMADO, con su supuesto a la vista', () => {
    const c = armarBriefDemo({ ...base, numUnidades: 40, viajesMesEstimado: 720 }, HOY);
    expect(c).toContain('ESTIMADO, NO MEDIDO');
    expect(c).toContain('unidades × 18');
  });

  it('sin toques registrados lo dice, en vez de fingir un historial', () => {
    expect(armarBriefDemo(base, HOY)).toContain('NADA REGISTRADO');
  });

  it('el brief declara qué preguntas NO puede contestar', () => {
    expect(armarBriefDemo(base, HOY)).toContain('no huecos que este agente vaya a rellenar');
  });

  it('el título es por empresa', () => {
    expect(tituloBrief('Transportes ZZZ')).toBe('Demo prep — Transportes ZZZ');
  });

  it('sin demos agendadas no fabrica nada y no lo llama fallo', async () => {
    respuestas.set('prospecto', [{ data: [], error: null }]);
    const r = await correrAgenteLeads('demo_prep', 'cron', HOY);
    expect(r.piezas).toBe(0);
    expect(r.motivo).toContain('no hay demo que preparar');
  });
});

// ── 5. Propuestas ──────────────────────────────────────────────────────────

describe('propuestas: el pricing REAL, o ninguno', () => {
  const base = {
    id: 'p1', empresa: 'Transportes ZZZ', estado: 'negociacion',
    numUnidades: null, unidades: null, viajesMesEstimado: null, vendedor: null,
    planes: [] as Array<{ clave: string; nombre: string; precioMensual: number | null; moneda: string; limiteViajesMes: number | null; limiteOperadores: number | null }>,
  };

  it('con TODOS los planes sin precio el borrador sale SIN CIFRA y lo explica', () => {
    const c = armarPropuesta({ ...base, planes: [
      { clave: 'flota', nombre: 'Flota', precioMensual: null, moneda: 'MXN', limiteViajesMes: 500, limiteOperadores: 50 },
    ] }, HOY);
    expect(c).toContain('VA SIN PRECIO, Y ES A PROPÓSITO');
    expect(c).toContain('NULL no es cero');
    expect(c).not.toMatch(/\$\s?\d/);
  });

  it('con precio declarado lo cita tal cual, con la moneda de la base', () => {
    const c = armarPropuesta({ ...base, planes: [
      { clave: 'flota', nombre: 'Flota', precioMensual: 17500, moneda: 'MXN', limiteViajesMes: 500, limiteOperadores: 50 },
    ] }, HOY);
    expect(c).toContain('17,500');
    expect(c).toContain('MXN/mes');
  });

  it('los planes sin precio NO heredan el de otro plan', () => {
    const c = armarPropuesta({ ...base, planes: [
      { clave: 'flota', nombre: 'Flota', precioMensual: 17500, moneda: 'MXN', limiteViajesMes: 500, limiteOperadores: null },
      { clave: 'empresa', nombre: 'Empresa', precioMensual: null, moneda: 'MXN', limiteViajesMes: null, limiteOperadores: null },
    ] }, HOY);
    expect(c).toContain('PRECIO NO DECLARADO EN LA BASE');
    expect(c).toContain('no se rellena con el de otro plan');
  });

  it('sin un solo plan activo no propone un esquema inventado', () => {
    expect(armarPropuesta(base, HOY)).toContain('no va a inventar un esquema');
  });

  it('sin flota capturada la recomendación de plan queda ABIERTA', () => {
    expect(armarPropuesta(base, HOY)).toContain('recomendación queda ABIERTA');
  });

  it('un volumen que ningún plan cubre se dice, en vez de recomendar el más grande', () => {
    const c = armarPropuesta({ ...base, numUnidades: 500, viajesMesEstimado: 9000, planes: [
      { clave: 'flota', nombre: 'Flota', precioMensual: 17500, moneda: 'MXN', limiteViajesMes: 500, limiteOperadores: 50 },
    ] }, HOY);
    expect(c).toContain('NINGÚN PLAN DECLARADO cubre');
  });

  it('el borrador jamás dice «clientes reales»', () => {
    expect(armarPropuesta(base, HOY)).not.toMatch(/clientes\s+reales(?!»)/);
    expect(armarPropuesta(base, HOY)).toContain('en pláticas con transportistas');
  });

  it('el título es por empresa', () => {
    expect(tituloPropuesta('Transportes ZZZ')).toBe('Propuesta — Transportes ZZZ');
  });

  it('sin prospectos en negociación no fabrica nada', async () => {
    respuestas.set('prospecto', [{ data: [], error: null }]);
    const r = await correrAgenteLeads('propuestas', 'cron', HOY);
    expect(r.piezas).toBe(0);
    expect(encolar).not.toHaveBeenCalled();
  });
});

// ── 6. Cazador ─────────────────────────────────────────────────────────────

describe('cazador: el encargo de caza, no la caza', () => {
  const fila = (o: Partial<{ id: string; empresa: string; estado: string; scian: string | null; ciudad: string | null; numUnidades: number | null; creadoEn: string; tocado: boolean }> = {}) => ({
    id: 'x', empresa: 'ZZZ', estado: 'nuevo', scian: '484110', ciudad: 'Monterrey',
    numUnidades: null, creadoEn: '2026-01-01T00:00:00Z', tocado: false, ...o,
  });

  it(`con menos de ${MIN_AVANZADOS_PARA_PERFIL} avanzados NO afirma un perfil`, () => {
    const p = perfilQueConvierte([fila({ estado: 'demo' }), fila({ estado: 'won' })]);
    expect(p.scianes).toBeNull();
    expect(p.motivoSinPerfil).toContain('anécdota');
  });

  it('con avanzados suficientes usa MEDIANA y no promedio', () => {
    const avanzados = [10, 20, 30, 40, 800].map((n, i) => fila({ id: `a${i}`, estado: 'demo', numUnidades: n }));
    const p = perfilQueConvierte(avanzados);
    expect(p.medianaUnidades).toBe(30);
    expect(p.avanzadosConFlota).toBe(5);
  });

  it('si ningún avanzado tiene flota, la mediana es NULL y se dice', () => {
    const avanzados = Array.from({ length: MIN_AVANZADOS_PARA_PERFIL }, (_, i) => fila({ id: `a${i}`, estado: 'demo' }));
    const p = perfilQueConvierte(avanzados);
    expect(p.medianaUnidades).toBeNull();
    expect(armarEncargoCaza(p, [], [], 5, HOY, false)).toContain('una mediana sobre cero datos no existe');
  });

  it('una celda con un solo toque YA no es una celda sin trabajar', () => {
    expect(celdasSinTrabajar([fila({ tocado: true }), fila({ id: 'y', tocado: false })])).toHaveLength(0);
    expect(celdasSinTrabajar([fila(), fila({ id: 'y' })])).toEqual([
      { scian: '484110', ciudad: 'Monterrey', total: 2, tocados: 0 },
    ]);
  });

  it('las filas sin giro o sin ciudad no arman una celda fantasma', () => {
    expect(celdasSinTrabajar([fila({ scian: null }), fila({ id: 'y', ciudad: null })])).toHaveLength(0);
  });

  it('los nuevos sin tocar salen del que lleva más esperando al más reciente', () => {
    const r = nuevosSinTocar([
      fila({ id: 'nuevo', creadoEn: '2026-06-01T00:00:00Z' }),
      fila({ id: 'viejo', creadoEn: '2025-01-01T00:00:00Z' }),
      fila({ id: 'tocado', tocado: true }),
      fila({ id: 'demo', estado: 'demo' }),
    ]);
    expect(r.map((f) => f.id)).toEqual(['viejo', 'nuevo']);
  });

  it('EL ENCARGO DECLARA que no buscó nada en internet ni dio de alta nada', () => {
    const c = armarEncargoCaza(perfilQueConvierte([]), [], [], 0, HOY, false);
    expect(c).toContain('no buscó una sola empresa en internet');
    expect(c).toContain('no dio de alta ni un prospecto');
    expect(c).toContain('una dirección que nadie verificó');
  });

  it('con gente sin tocar adentro, la conclusión es no cazar afuera', () => {
    const c = armarEncargoCaza(perfilQueConvierte([]), [], [fila()], 1, HOY, false);
    expect(c).toContain('cazar afuera mientras hay este número adentro');
  });

  it('la corrida titula por semana y no toca ninguna tabla de escritura', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    respuestas.set('prospecto', [
      { data: [{ id: 'p1', empresa: 'ZZZ', estado: 'nuevo', scian: '484', ciudad: 'MTY', num_unidades: null, created_at: '2026-01-01T00:00:00Z' }], error: null, count: 1 },
      { data: [], error: null },
    ]);
    respuestas.set('prospecto_contacto', [{ data: [], error: null }]);
    const r = await correrAgenteLeads('cazador', 'cron', HOY);
    expect(r).toMatchObject({ resultado: 'corrio', piezas: 1 });
    expect(ultimoTitulo()).toBe(`Cazador — semana del ${LUNES}`);
    // La única escritura de todo el módulo es la pieza en la bandeja.
    expect(encolar).toHaveBeenCalledTimes(1);
  });

  // El perfil sale de SU consulta, no de la ventana del censo: si saliera de
  // ahí, con decenas de miles de filas el «perfil que convierte» retrataría a
  // las filas más viejas del censo importado.
  it('el perfil NO se calcula sobre la ventana truncada del censo: tiene consulta propia', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    respuestas.set('prospecto', [
      // La ventana del censo: truncada, y sin un solo avanzado dentro.
      { data: [{ id: 'p1', empresa: 'ZZZ', estado: 'nuevo', scian: '484', ciudad: 'MTY', num_unidades: null, created_at: '2026-01-01T00:00:00Z' }], error: null, count: TOPE_PROSPECTOS + 1 },
      // La consulta propia de los avanzados: cinco, con flota, fuera de esa ventana.
      { data: Array.from({ length: 5 }, (_, i) => ({ estado: 'demo', scian: '484110', ciudad: 'Guadalajara', num_unidades: 20 + i })), error: null },
    ]);
    respuestas.set('prospecto_contacto', [{ data: [], error: null }]);
    await correrAgenteLeads('cazador', 'cron', HOY);
    const cuerpo = ultimoCuerpo();
    expect(cuerpo).toContain('Guadalajara');
    expect(cuerpo).toContain('MEDIANA');
    expect(cuerpo).toContain('El PERFIL de la sección 1 NO está afectado');
  });
});

// ── Lo que gobierna a los seis ─────────────────────────────────────────────

describe('las reglas del departamento', () => {
  it('TODA pieza dice que mandarla es de una persona', () => {
    const cuerpos = [
      armarParteScorer([], HOY, false),
      armarFicha({ id: 'p', empresa: 'Z', ciudad: null, estado: 'demo', vacante: null, numUnidades: null, unidades: null, sitio: null, sitioVerificado: false, historiaProspecto: null, dossier: null, personas: [], correos: [] }, HOY),
      armarParteVigia([], 0, HOY, false),
      armarBriefDemo({ id: 'p', empresa: 'Z', ciudad: null, estado: 'demo', vacante: null, urgencia: null, numUnidades: null, unidades: null, viajesMesEstimado: null, necesidadPct: null, historia: null, vendedor: null, personas: [], toques: [] }, HOY),
      armarPropuesta({ id: 'p', empresa: 'Z', estado: 'negociacion', numUnidades: null, unidades: null, viajesMesEstimado: null, vendedor: null, planes: [] }, HOY),
      armarEncargoCaza(perfilQueConvierte([]), [], [], 0, HOY, false),
    ];
    for (const c of cuerpos) expect(c).toContain('es el tap de una persona');
  });

  it('un fallo del motor anota la corrida como fallo antes de propagar', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    respuestas.set('prospecto', [{ data: null, error: { message: 'tabla ilegible' } }]);
    await expect(correrAgenteLeads('scorer', 'cron', HOY)).rejects.toThrow();
    const ultima = registrar.mock.calls.at(-1) as unknown[] | undefined;
    expect((ultima?.[2] as { estado: string }).estado).toBe('fallo');
    expect((ultima?.[2] as { error: string }).error).toContain('tabla ilegible');
  });

  it('las corridas van con tenant NULL: el CRM es de Likida, no de una flota', async () => {
    respuestas.set('cola_aprobacion', [{ count: 1, error: null }]);
    await correrAgenteLeads('scorer', 'cron', HOY);
    expect((registrar.mock.calls.at(-1) as unknown[])[0]).toBeNull();
  });

  it('el costo se anota 0 MEDIDO, que no es lo mismo que NULL', async () => {
    respuestas.set('cola_aprobacion', [{ count: 1, error: null }]);
    await correrAgenteLeads('scorer', 'cron', HOY);
    expect((registrar.mock.calls.at(-1) as unknown[])[2]).toMatchObject({ costoUsd: 0 });
  });

  it('un duplicado del índice único se trata como «ya existía», no como fallo', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    respuestas.set('prospecto', [{ data: [], error: null, count: 0 }]);
    encolar.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint "cola_pieza_leads_por_periodo"'));
    const r = await correrAgenteLeads('scorer', 'cron', HOY);
    expect(r).toMatchObject({ resultado: 'corrio', piezas: 0 });
    expect(r.motivo).toContain('otra corrida ganó');
  });

  it('un fallo de encolado que NO es duplicado sí propaga', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    respuestas.set('prospecto', [{ data: [], error: null, count: 0 }]);
    encolar.mockRejectedValueOnce(new Error('el cuerpo de la pieza es obligatorio'));
    await expect(correrAgenteLeads('scorer', 'cron', HOY)).rejects.toThrow(/obligatorio/);
  });

  it('ninguna pieza de este módulo pide aprobación urgente sin razón', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    respuestas.set('prospecto', [{ data: [], error: null, count: 0 }]);
    await correrAgenteLeads('scorer', 'cron', HOY);
    expect(encolar.mock.calls.at(-1)?.[0]).toMatchObject({ prioridad: 'normal' });
    expect(ultimoCuerpo().length).toBeGreaterThan(0);
  });
});
