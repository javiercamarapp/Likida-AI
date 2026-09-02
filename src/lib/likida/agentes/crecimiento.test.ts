import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LOS NUEVE DETERMINISTAS DE CRECIMIENTO (0230).
//
// Las pruebas son de COMPORTAMIENTO, no de forma: lo que se afirma es que
// null nunca se lee como 0, que nada se inventa cuando la fuente no alcanza,
// que la pieza SIEMPRE dice que publicar es de Javier, y que los tres que
// tienen rutina local en la Mac lo declaran en su cuerpo.
// ═══════════════════════════════════════════════════════════════════════════

const respuestas = new Map<string, Array<{ data?: unknown; error?: { message: string; code?: string } | null; count?: number }>>();
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
// `rpc` comparte la cola de `respuestas` con la clave `rpc:<función>`: desde la
// correctiva del ciclo 7 el mapa de plazas se cuenta EN LA BASE
// (`prospecto_mapa_ciudades`, mig. 0238) y no trayendo filas (c7-4).
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (t: string) => builder(t), rpc: (fn: string) => builder(`rpc:${fn}`) }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));

const encolar = vi.fn(async (_p: unknown) => 'pieza-1');
vi.mock('./cola', () => ({ encolarPieza: (p: unknown) => encolar(p) }));

const registrar = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('./corridas', () => ({ registrarCorrida: (...a: unknown[]) => registrar(...a) }));

const {
  AGENTES_CRECIMIENTO, esAgenteCrecimiento, correrAgenteCrecimiento,
  lunesDe, masDias, diasEntre,
  armarEmbudo, proponerMejoras, armarParteLeadMagnet, MIN_VISTAS_PARA_TASA,
  auditarSeo, armarParteSeo, textoDeArticulo, MAX_TITULO_SERP,
  beneficiosVerificados, beneficioDelDia, copyPorCanal, armarPromoDiaria,
  articuloDeLaSemana, armarGuionSemanal, FORMAS_DE_HOOK,
  slidesDelMercado, armarCarruselNoticias, MIN_SLIDES,
  armarEncargoVisual, armarEncargoVideoDemo, armarEncargoVideoMarketing,
  armarMapaCiudades, siguienteToque, armarParteAlianzas,
} = await import('./crecimiento');
const { ARTICULOS, revisarReglasEditoriales } = await import('../marketing/articulos');

const HOY = '2026-08-27'; // jueves
const LUNES = '2026-08-24';

/** El cuerpo de la última pieza encolada. */
function ultimoCuerpo(): string {
  const p = encolar.mock.calls.at(-1)?.[0] as { cuerpo: string } | undefined;
  return p?.cuerpo ?? '';
}
function ultimoTitulo(): string {
  const p = encolar.mock.calls.at(-1)?.[0] as { titulo: string } | undefined;
  return p?.titulo ?? '';
}

beforeEach(() => {
  respuestas.clear();
  encolar.mockClear();
  encolar.mockResolvedValue('pieza-1');
  registrar.mockClear();
});

// ── El catálogo y la aritmética ────────────────────────────────────────────

describe('el catálogo de crecimiento', () => {
  it('son exactamente los diez del departamento y el predicado los reconoce', () => {
    expect(AGENTES_CRECIMIENTO).toHaveLength(10);
    expect(new Set(AGENTES_CRECIMIENTO).size).toBe(10);
    for (const id of AGENTES_CRECIMIENTO) expect(esAgenteCrecimiento(id)).toBe(true);
    expect(esAgenteCrecimiento('redactor')).toBe(false);
  });

  it('lunesDe cae en lunes cualquier día de la semana, y no cruza de fecha', () => {
    for (const d of ['2026-08-24', '2026-08-27', '2026-08-30']) {
      expect(lunesDe(d)).toBe('2026-08-24');
    }
    expect(lunesDe('2026-08-31')).toBe('2026-08-31');
    expect(masDias('2026-03-01', -1)).toBe('2026-02-28');
    expect(diasEntre('2026-08-24', '2026-08-31')).toBe(7);
  });
});

// ── 1. Lead magnet ─────────────────────────────────────────────────────────

describe('lead_magnet: el embudo real, con null ≠ 0', () => {
  it('sin vistas la tasa es NULL, no 0%', () => {
    const e = armarEmbudo([{ pagina: 'calculadora', evento: 'conversion', dia: HOY }]);
    expect(e[0]).toMatchObject({ vistas: 0, conversiones: 1, tasaPct: null });
  });

  it('con vistas la tasa se calcula y ordena por vistas descendente', () => {
    const e = armarEmbudo([
      { pagina: 'calculadora', evento: 'pageview', dia: HOY },
      { pagina: 'calculadora', evento: 'pageview', dia: HOY },
      { pagina: 'calculadora', evento: 'conversion', dia: HOY },
      { pagina: 'blog', evento: 'pageview', dia: HOY },
    ]);
    expect(e.map((x) => x.pagina)).toEqual(['calculadora', 'blog']);
    expect(e[0].tasaPct).toBe(50);
    expect(e[1].tasaPct).toBe(0);
  });

  it('el parte de una ventana VACÍA nombra las DOS lecturas y no afirma un cero', () => {
    const cuerpo = armarParteLeadMagnet([], [], '2026-08-17', '2026-08-23', 0, false);
    expect(cuerpo).toContain('NI UNA SOLA FILA');
    expect(cuerpo).toContain('nadie entró al sitio');
    expect(cuerpo).toContain('el pulso del sitio no está reportando');
    expect(cuerpo).toContain('INDEFINIDA, no 0%');
  });

  it('el parte declara que cuenta EVENTOS y no usuarios', () => {
    const cuerpo = armarParteLeadMagnet(
      armarEmbudo([{ pagina: 'blog', evento: 'pageview', dia: HOY }]), [], '2026-08-17', '2026-08-23', 1, false,
    );
    expect(cuerpo).toContain('cuenta EVENTOS');
    expect(cuerpo).toContain('sería inventada');
  });

  it('la ventana truncada se DICE y las cifras se declaran un piso', () => {
    const cuerpo = armarParteLeadMagnet([], [], '2026-08-17', '2026-08-23', 20_000, true);
    expect(cuerpo).toContain('VENTANA TRUNCADA');
    expect(cuerpo).toContain('un PISO, no el total');
  });

  it('sin tráfico: propone mirar el tráfico, NO el copy, y admite que el pulso pudo fallar', () => {
    const props = proponerMejoras([], 9);
    const p = props.find((x) => x.clave === 'sin_trafico_calculadora');
    expect(p?.que).toContain('el cuello no es la conversión'.slice(3));
    expect(p?.porque).toContain('un bloqueador lo tumba');
  });

  it('conversiones sin vistas: la contradicción se nombra en vez de promediarse', () => {
    const props = proponerMejoras(armarEmbudo([{ pagina: 'calculadora', evento: 'conversion', dia: HOY }]), 9);
    expect(props[0].porque).toContain('contradictorio');
  });

  it('tráfico sobre el piso y cero capturas: propone copy CONCRETO con su disparador', () => {
    const filas = Array.from({ length: MIN_VISTAS_PARA_TASA }, () => ({ pagina: 'calculadora', evento: 'pageview' as const, dia: HOY }));
    const props = proponerMejoras(armarEmbudo(filas), 9);
    const p = props.find((x) => x.clave === 'trafico_sin_conversion');
    expect(p?.copy).toBeTruthy();
    expect(p?.porque).toContain(`${MIN_VISTAS_PARA_TASA} vista(s) y 0 conversiones`);
  });

  it('bajo el piso de vistas NO se propone copy: 0 de 3 no es un problema de texto', () => {
    const filas = Array.from({ length: 3 }, () => ({ pagina: 'calculadora', evento: 'pageview' as const, dia: HOY }));
    const props = proponerMejoras(armarEmbudo(filas), 9);
    expect(props.find((x) => x.clave === 'trafico_sin_conversion')).toBeUndefined();
  });

  it('lectores del blog sin llegar a la calculadora: propone el puente con su texto', () => {
    const props = proponerMejoras(armarEmbudo([{ pagina: 'blog:x', evento: 'pageview', dia: HOY }]), 9);
    const p = props.find((x) => x.clave === 'blog_sin_puente');
    expect(p?.copy).toContain('la calculadora de esta página');
  });

  it('la corrida encola el parte de la semana CERRADA y anota su corrida', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    respuestas.set('sitio_evento', [{ data: [{ pagina: 'calculadora', evento: 'pageview', created_at: '2026-08-18T10:00:00Z' }], error: null, count: 1 }]);
    const r = await correrAgenteCrecimiento('lead_magnet', 'cron', HOY);
    expect(r).toMatchObject({ resultado: 'corrio', piezas: 1, costoUsd: 0 });
    expect(ultimoTitulo()).toBe('Lead magnet — semana del 2026-08-17');
    expect(registrar).toHaveBeenCalled();
  });

  it('si el parte de la semana ya está, no se fabrica encima', async () => {
    respuestas.set('cola_aprobacion', [{ count: 1, error: null }]);
    const r = await correrAgenteCrecimiento('lead_magnet', 'cron', HOY);
    expect(r.piezas).toBe(0);
    expect(encolar).not.toHaveBeenCalled();
  });

  it('sitio_evento ilegible: la corrida FALLA en vez de reportar un embudo vacío', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    respuestas.set('sitio_evento', [{ data: null, error: { message: 'base caída' } }]);
    await expect(correrAgenteCrecimiento('lead_magnet', 'cron', HOY)).rejects.toThrow(/base caída/);
    expect(encolar).not.toHaveBeenCalled();
    expect(registrar.mock.calls.at(-1)?.[2]).toMatchObject({ estado: 'fallo' });
  });

  it('un conteo que PostgREST no devolvió no se lee como 0', async () => {
    respuestas.set('cola_aprobacion', [{ count: undefined, error: null }]);
    await expect(correrAgenteCrecimiento('lead_magnet', 'cron', HOY)).rejects.toThrow(/no devolvió el conteo/);
  });
});

// ── 2. SEO ─────────────────────────────────────────────────────────────────

describe('seo_distribucion: audita lo que existe, jamás un ranking', () => {
  const base = { fecha: '2026-01-01', tema: 'carta_porte' as const, fundamento: ['x'], bloques: [] };

  it('el <title> auditado es el que DE VERDAD se sirve, con el sufijo de marca', () => {
    const largo = 'a'.repeat(MAX_TITULO_SERP - 5);
    const h = auditarSeo([{ ...base, slug: 'ok', titulo: largo, resumen: 'r'.repeat(120) }]);
    const s1 = h.find((x) => x.codigo === 'S1');
    expect(s1?.detalle).toContain(' — Likida');
    expect(s1?.detalle).toContain(String(largo.length + ' — Likida'.length));
  });

  it('meta corta y meta larga, las dos con su acción distinta', () => {
    const corta = auditarSeo([{ ...base, slug: 'a', titulo: 't', resumen: 'x' }]).find((x) => x.codigo === 'S2');
    const larga = auditarSeo([{ ...base, slug: 'b', titulo: 't', resumen: 'x'.repeat(200) }]).find((x) => x.codigo === 'S2');
    expect(corta?.accion).toContain('Ampliar');
    expect(larga?.accion).toContain('Recortar');
  });

  it('slug mal formado y slug DUPLICADO se detectan por separado', () => {
    for (const malo of ['Mal_Slug', '-al-inicio', 'al-final-', 'doble--guion', 'x'.repeat(61)]) {
      expect(auditarSeo([{ ...base, slug: malo, titulo: 't', resumen: 'r'.repeat(120) }])
        .some((x) => x.codigo === 'S3'), malo).toBe(true);
    }
    expect(auditarSeo([{ ...base, slug: 'slug-bien-formado', titulo: 't', resumen: 'r'.repeat(120) }])
      .some((x) => x.codigo === 'S3')).toBe(false);
    const dup = auditarSeo([
      { ...base, slug: 'igual', titulo: 't', resumen: 'r'.repeat(120) },
      { ...base, slug: 'igual', titulo: 't', resumen: 'r'.repeat(120) },
    ]);
    expect(dup.some((x) => x.codigo === 'S4')).toBe(true);
  });

  it('una pieza sin puente a la calculadora se marca con el texto listo', () => {
    const h = auditarSeo([{ ...base, slug: 'sin-puente', titulo: 't', resumen: 'r'.repeat(120) }]);
    expect(h.find((x) => x.codigo === 'S5')?.accion).toContain('dimensionar cuánto es en tu flota');
  });

  it('sobre la colección REAL encuentra el hueco que de verdad existe hoy', () => {
    // No es una prueba de forma: corrido contra los artículos publicados, el
    // auditor caza que «carta-porte-quien-si-quien-no» no menciona la
    // calculadora en ninguna parte, mientras los otros dos sí cierran con el
    // puente. Ese hallazgo es el producto del agente, y esta prueba lo fija:
    // si alguien le agrega el puente al artículo, esta prueba avisa que el
    // hallazgo se resolvió en vez de dejar la aserción mintiendo.
    const conPuente = ARTICULOS.filter((a) => /calculadora/i.test(textoDeArticulo(a))).map((a) => a.slug);
    const sinPuente = auditarSeo(ARTICULOS).filter((h) => h.codigo === 'S5').map((h) => h.slug);
    expect(sinPuente).toEqual(['carta-porte-quien-si-quien-no']);
    expect(conPuente).toHaveLength(ARTICULOS.length - 1);
  });

  it('el parte NIEGA explícitamente hablar de posiciones y de tiempos de build', () => {
    const cuerpo = armarParteSeo(ARTICULOS, [], LUNES);
    expect(cuerpo).toContain('nada de posiciones, rankings');
    expect(cuerpo).toContain('Search Console');
    expect(cuerpo).toContain('Tampoco dice tiempos de build');
    expect(cuerpo).toContain('convenciones son DECLARADAS, no medidas');
  });

  it('sin hallazgos lo dice, en vez de inventar trabajo', () => {
    expect(armarParteSeo([], [], LUNES)).toContain('SIN HALLAZGOS');
  });

  it('la corrida encola la auditoría de la semana en curso', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    const r = await correrAgenteCrecimiento('seo_distribucion', 'cron', HOY);
    expect(r.piezas).toBe(1);
    expect(ultimoTitulo()).toBe(`SEO — semana del ${LUNES}`);
  });
});

// ── Los beneficios VERIFICADOS ─────────────────────────────────────────────

describe('los beneficios se verifican contra el motor, no contra la memoria', () => {
  it('el 50% del peaje se MIDE corriendo la calculadora real', () => {
    const b = beneficiosVerificados(HOY).find((x) => x.clave === 'peaje_50');
    expect(b?.respaldo.medido).toContain('factor de 50%');
    expect(b?.respaldo.simbolo).toContain('calcularEstimacion');
  });

  it('el bloque de diésel declara la cuota FECHADA, o que el candado la retiró', () => {
    const vivo = beneficiosVerificados(HOY).find((x) => x.clave === 'diesel_litros');
    expect(vivo?.respaldo.medido).toContain('SIEMPRE fechada');
    // Un año después la cuota registrada venció: el motor deja de dar pesos y
    // el beneficio lo dice. Ese es el candado, medido.
    const viejo = beneficiosVerificados('2027-08-27').find((x) => x.clave === 'diesel_litros');
    expect(viejo?.respaldo.medido).toContain('ya venció y el candado la retiró sola');
  });

  it('el catálogo incluye «lo que falta se dice» probado con la entrada VACÍA', () => {
    const b = beneficiosVerificados(HOY).find((x) => x.clave === 'lo_que_falta_se_dice');
    expect(b?.respaldo.medido).toContain('el total en NULL, no en 0');
  });

  it('TODO copy de beneficio pasa las reglas editoriales de la casa', () => {
    for (const b of beneficiosVerificados(HOY)) {
      expect(revisarReglasEditoriales(`${b.titulo}. ${b.copy}`), b.clave).toEqual([]);
    }
  });

  it('la rotación es determinista por día y da la vuelta completa', () => {
    const bs = beneficiosVerificados(HOY);
    expect(beneficioDelDia(bs, HOY)?.clave).toBe(beneficioDelDia(bs, HOY)?.clave);
    const vistos = new Set(Array.from({ length: bs.length }, (_, i) => beneficioDelDia(bs, masDias(HOY, i))?.clave));
    expect(vistos.size).toBe(bs.length);
  });

  it('sin beneficios verificables devuelve null: no se inventa uno para llenar el hueco', () => {
    expect(beneficioDelDia([], HOY)).toBeNull();
  });
});

// ── 3. Promos diarias ──────────────────────────────────────────────────────

describe('promos_diarias', () => {
  it('el copy de los tres canales es la MISMA afirmación en tres largos', () => {
    const b = beneficiosVerificados(HOY)[0];
    const c = copyPorCanal(b);
    expect(c.map((x) => x.canal)).toEqual(['LinkedIn', 'Instagram', 'TikTok']);
    for (const x of c) expect(revisarReglasEditoriales(x.texto), x.canal).toEqual([]);
    expect(c[0].texto).toContain(b.respaldo.medido);
  });

  it('la pieza declara el respaldo medido, la rutina local y el tap de Javier', () => {
    const cuerpo = armarPromoDiaria(beneficiosVerificados(HOY)[0], HOY);
    expect(cuerpo).toContain('medido en ESTA corrida');
    expect(cuerpo).toContain('LA RUTINA LOCAL SIGUE VÁLIDA');
    expect(cuerpo).toContain('promos-diaria (10:00)');
    expect(cuerpo).toContain('publicarla es el tap de Javier');
    expect(cuerpo).toContain('El logo se COMPONE');
  });

  it('la corrida es DIARIA: el título ancla el día', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    const r = await correrAgenteCrecimiento('promos_diarias', 'cron', HOY);
    expect(r.piezas).toBe(1);
    expect(ultimoTitulo()).toBe(`Promo del día — ${HOY}`);
  });

  it('un duplicado que rebota en el índice único NO es un fallo', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    encolar.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint "cola_pieza_crecimiento_por_periodo"'));
    const r = await correrAgenteCrecimiento('promos_diarias', 'cron', HOY);
    expect(r).toMatchObject({ resultado: 'corrio', piezas: 0 });
    expect(r.motivo).toContain('otra corrida ganó el día');
  });
});

// ── 4. Guiones ─────────────────────────────────────────────────────────────

describe('guiones', () => {
  it('rota el artículo de la semana de forma determinista y no se sale de la lista', () => {
    expect(articuloDeLaSemana(ARTICULOS, LUNES)?.slug).toBe(articuloDeLaSemana(ARTICULOS, LUNES)?.slug);
    const vistos = new Set(Array.from({ length: ARTICULOS.length }, (_, i) => articuloDeLaSemana(ARTICULOS, masDias(LUNES, i * 7))?.slug));
    expect(vistos.size).toBe(ARTICULOS.length);
    expect(articuloDeLaSemana([], LUNES)).toBeNull();
  });

  it('cada forma de hook CITA de qué artículo publicado se destiló', () => {
    for (const f of FORMAS_DE_HOOK) {
      expect(ARTICULOS.some((a) => a.slug === f.origen), f.clave).toBe(true);
    }
  });

  it('el guion trae hook, escenas con narración de ElevenLabs, cierre y el fundamento citado', () => {
    const a = ARTICULOS[0];
    const cuerpo = armarGuionSemanal(a, FORMAS_DE_HOOK[0], LUNES);
    expect(cuerpo).toContain('HOOK (3 segundos');
    expect(cuerpo).toContain('ElevenLabs');
    expect(cuerpo).toContain('NUNCA la voz del modelo');
    expect(cuerpo).toContain(a.fundamento[0]);
    expect(cuerpo).toContain('Escena 1');
    expect(cuerpo).toContain('guiones-semanal (lunes 08:00)');
  });

  it('confiesa que NO destiló hooks nuevos: no tiene los videos ni whisper', () => {
    const cuerpo = armarGuionSemanal(ARTICULOS[0], FORMAS_DE_HOOK[0], LUNES);
    expect(cuerpo).toContain('no destiló ni un hook nuevo');
  });

  it('la corrida encola el guion de la semana', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    const r = await correrAgenteCrecimiento('guiones', 'cron', HOY);
    expect(r.piezas).toBe(1);
    expect(ultimoTitulo()).toBe(`Guion semanal — semana del ${LUNES}`);
  });
});

// ── 5. Noticias del mercado ────────────────────────────────────────────────

describe('noticias_mercado: fuente POR DATO o no hay carrusel', () => {
  it('cada slide trae su ficha, su fecha y si obliga o solo orienta', () => {
    const s = slidesDelMercado(HOY);
    expect(s.length).toBeGreaterThan(0);
    for (const x of s) {
      expect(x.normaId).toBeTruthy();
      expect(x.cita).toBeTruthy();
      expect(x.exigibleDesde).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof x.vinculante).toBe('boolean');
    }
  });

  it('una ficha sin fecha de exigibilidad NO entra: sin fecha no hay noticia', () => {
    const conFecha = new Set(slidesDelMercado(HOY, 100_000).map((x) => x.normaId));
    expect(conFecha.has('cff-69-B')).toBe(false); // exigibleDesde null en el índice
  });

  it('la ventana corta lo viejo y lo del futuro', () => {
    expect(slidesDelMercado(HOY, 1)).toHaveLength(0);
    // Antes de que nada fuera exigible, tampoco hay slides.
    expect(slidesDelMercado('2000-01-01')).toHaveLength(0);
  });

  it('con menos del mínimo NO fabrica un carrusel: dice que no y por qué', () => {
    const cuerpo = armarCarruselNoticias([], LUNES, HOY);
    expect(cuerpo).toContain('SIN CARRUSEL ESTA SEMANA');
    expect(cuerpo).toContain('NO se fabrica un carrusel con noticias inventadas');
    expect(MIN_SLIDES).toBeGreaterThanOrEqual(2);
  });

  it('confiesa que no navegó la web y nombra a la rutina que sí lo hace', () => {
    const cuerpo = armarCarruselNoticias(slidesDelMercado(HOY), LUNES, HOY);
    expect(cuerpo).toContain('NO miró la web');
    expect(cuerpo).toContain('no va a fingir una investigación que no hizo');
    expect(cuerpo).toContain('noticias-diaria (09:00)');
  });

  it('la corrida encola el carrusel y anota cuántos slides tuvo', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    const r = await correrAgenteCrecimiento('noticias_mercado', 'cron', HOY);
    expect(r.piezas).toBe(1);
    expect(ultimoTitulo()).toBe(`Noticias del mercado — semana del ${LUNES}`);
  });
});

// ── 6. Los tres encargos ───────────────────────────────────────────────────

describe('visuales / video_demo / video_marketing: el ENCARGO, jamás el render', () => {
  const b = () => beneficiosVerificados(HOY)[0];

  it('los tres DECLARAN que no generaron nada y por qué no pueden', () => {
    const cuerpos = [
      armarEncargoVisual(b(), LUNES),
      armarEncargoVideoDemo(b(), LUNES),
      armarEncargoVideoMarketing(ARTICULOS[0], LUNES),
    ];
    for (const c of cuerpos) {
      expect(c).toContain('NO GENERÓ NINGUNA IMAGEN NI NINGÚN VIDEO, Y NO PUEDE');
      expect(c).toContain('No hay pipeline de render en el servidor');
      expect(c).toContain('publicarla es el tap de Javier');
    }
  });

  it('los tres traen las referencias de marca obligatorias, con el logo que se pega', () => {
    for (const c of [armarEncargoVisual(b(), LUNES), armarEncargoVideoDemo(b(), LUNES), armarEncargoVideoMarketing(ARTICULOS[0], LUNES)]) {
      expect(c).toContain('#EDE4D3');
      expect(c).toContain('EL LOGO SE PEGA, NO SE GENERA');
      expect(c).toContain('Likida no tiene clientes');
    }
  });

  it('el encargo visual elige modelo según lleve o no texto quemado, y deja hueco para el logo', () => {
    const c = armarEncargoVisual(b(), LUNES);
    expect(c).toContain('nano_banana_2');
    expect(c).toContain('gpt_image_2');
    expect(c).toContain('espacio rectangular VACÍO');
    expect(c).toContain('NO dibujar ningún logo');
  });

  it('el video demo pone la PRUEBA en la UI real y el gate de Javier en la animación', () => {
    const c = armarEncargoVideoDemo(b(), LUNES);
    expect(c).toContain('se graba de la pantalla');
    expect(c).toContain('gate de Javier');
    expect(c).toContain('seedance_2_0');
    expect(c).toContain('std + 480p');
  });

  it('el reel sale de un artículo YA publicado y dice por qué eso importa', () => {
    const c = armarEncargoVideoMarketing(ARTICULOS[0], LUNES);
    expect(c).toContain(ARTICULOS[0].slug);
    expect(c).toContain('hereda esa verificación');
    expect(c).toContain('1080x1920');
  });

  it('el reel toma un artículo DISTINTO al del guion de la misma semana', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    await correrAgenteCrecimiento('guiones', 'cron', HOY);
    const delGuion = (encolar.mock.calls.at(-1)?.[0] as { fuentes: { articulo: string } }).fuentes.articulo;
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    await correrAgenteCrecimiento('video_marketing', 'cron', HOY);
    const delReel = (encolar.mock.calls.at(-1)?.[0] as { fuentes: { articulo: string } }).fuentes.articulo;
    expect(delReel).not.toBe(delGuion);
  });

  it('las corridas de los tres encolan y marcan que NO generan medios', async () => {
    for (const [agente, titulo] of [
      ['visuales', `Encargo visual — semana del ${LUNES}`],
      ['video_demo', `Encargo de video demo — semana del ${LUNES}`],
      ['video_marketing', `Encargo de reel — semana del ${LUNES}`],
    ] as const) {
      respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
      const r = await correrAgenteCrecimiento(agente, 'cron', HOY);
      expect(r.piezas, agente).toBe(1);
      expect(ultimoTitulo()).toBe(titulo);
      const f = (encolar.mock.calls.at(-1)?.[0] as { fuentes: Record<string, unknown> }).fuentes;
      expect(f.genera_imagen === false || f.genera_video === false, agente).toBe(true);
    }
  });
});

// ── 7. Alianzas ────────────────────────────────────────────────────────────

describe('alianzas: el siguiente toque, sin inventar un solo contacto', () => {
  it('los prospectos sin ciudad NO se reparten entre las demás: se cuentan aparte', () => {
    const m = armarMapaCiudades([{ ciudad: 'Monterrey' }, { ciudad: null }, { ciudad: '  ' }, { ciudad: 'Monterrey' }], false);
    expect(m.total).toBe(4);
    expect(m.sinCiudad).toBe(2);
    expect(m.top).toEqual([{ ciudad: 'Monterrey', n: 2 }]);
  });

  it('c7-4 · con la lectura TRUNCADA no hay ranking: `top` es null, no un orden de la rebanada', () => {
    // El hallazgo crítico, escrito como prueba. Contar las ciudades de 5,000
    // filas tomadas en orden físico de 33,071 producía un orden que se parecía
    // a un dato: Nuevo Laredo, Manzanillo y Puebla —tres de las cinco plazas
    // reales— desaparecían del parte y entraban tres que no lo eran.
    const filas = [{ ciudad: 'Aguascalientes' }, { ciudad: 'Aguascalientes' }, { ciudad: 'Tijuana' }];
    const m = armarMapaCiudades(filas, true);
    expect(m.top, 'un orden sacado de una rebanada arbitraria NO es un top-5').toBeNull();
    // Lo que SÍ se puede afirmar se sigue afirmando.
    expect(m.sinCiudad).toBe(0);
  });

  it('el turno pone primero a los que NUNCA se tocaron, luego al toque más viejo', () => {
    const base = { nombre: 'x', tipo: 'gremio', estado: 'sin_contacto', contactoNota: null, notas: null };
    const t = siguienteToque([
      { ...base, id: 'b', ultimoToqueEn: '2026-01-01' },
      { ...base, id: 'a', ultimoToqueEn: null },
      { ...base, id: 'c', ultimoToqueEn: '2025-01-01' },
    ]);
    expect(t?.id).toBe('a');
    const sinNulos = siguienteToque([
      { ...base, id: 'b', ultimoToqueEn: '2026-01-01' },
      { ...base, id: 'c', ultimoToqueEn: '2025-01-01' },
    ]);
    expect(sinNulos?.id).toBe('c');
  });

  it('los que ya son aliados o están descartados salen del turno', () => {
    const base = { nombre: 'x', tipo: 'gremio', contactoNota: null, notas: null, ultimoToqueEn: null };
    expect(siguienteToque([{ ...base, id: 'a', estado: 'aliado' }, { ...base, id: 'b', estado: 'descartado' }])).toBeNull();
  });

  it('sin contacto capturado el parte lo DICE y prohíbe inventarlo', () => {
    const aliado = { id: 'canacar', nombre: 'CANACAR', tipo: 'gremio', estado: 'sin_contacto', ultimoToqueEn: null, contactoNota: null, notas: null };
    const cuerpo = armarParteAlianzas([aliado], aliado, { total: 0, sinCiudad: 0, top: [], truncado: false }, LUNES);
    expect(cuerpo).toContain('SIN CONTACTO CAPTURADO');
    expect(cuerpo).toContain('NO inventa un nombre ni un correo');
    expect(cuerpo).toContain('nadie debería escribirle a un contacto que salió de una máquina');
  });

  it('la tracción se cuenta con la frase honesta de la casa, no con clientes', () => {
    const aliado = { id: 'anpact', nombre: 'ANPACT', tipo: 'gremio', estado: 'sin_contacto', ultimoToqueEn: null, contactoNota: 'mesa de afiliación publicada', notas: 'nota' };
    const cuerpo = armarParteAlianzas([aliado], aliado, { total: 5, sinCiudad: 1, top: [{ ciudad: 'CDMX', n: 4 }], truncado: false }, LUNES);
    expect(cuerpo).toContain('en pláticas con transportistas como Grupo GAL y Transportes Innovativos');
    expect(cuerpo).toContain('NINGUNA empresa ha firmado');
    expect(cuerpo).toContain('mesa de afiliación publicada');
  });

  it('c7-4 · el parte NO publica un ranking que no puede sostener, y lo dice con todas sus letras', () => {
    const aliado = { id: 'anpact', nombre: 'ANPACT', tipo: 'gremio', estado: 'sin_contacto', ultimoToqueEn: null, contactoNota: 'mesa', notas: null };
    const cuerpo = armarParteAlianzas([aliado], aliado, { total: 33_071, sinCiudad: 412, top: null, truncado: true }, LUNES);

    expect(cuerpo).toContain('NO SE PUBLICA UN RANKING DE PLAZAS');
    expect(cuerpo).toContain('rebanada arbitraria del censo');
    // El total SÍ se afirma: sale de un conteo exacto.
    expect(cuerpo).toContain('33,071 prospecto(s) vivos');
    // Y NO se cuela ni el rótulo del ranking ni la frase vieja, que era cierta
    // para el total y falsa para el orden.
    expect(cuerpo).not.toContain('Plazas con más prospectos capturados');
    expect(cuerpo).not.toContain('las cifras de arriba son un PISO');
  });

  it('c7-4 · con el conteo de la base, el parte dice que el top es el REAL', () => {
    const aliado = { id: 'canacar', nombre: 'CANACAR', tipo: 'gremio', estado: 'sin_contacto', ultimoToqueEn: null, contactoNota: 'mesa', notas: null };
    const cuerpo = armarParteAlianzas([aliado], aliado, {
      total: 33_071, sinCiudad: 412, truncado: false,
      top: [{ ciudad: 'Tijuana', n: 928 }, { ciudad: 'Nuevo Laredo', n: 689 }],
    }, LUNES);
    expect(cuerpo).toContain('Tijuana (928) · Nuevo Laredo (689)');
    expect(cuerpo).toContain('contado sobre el censo entero en la base, no sobre una muestra');
  });

  it('con la lista vacía lo dice, en vez de proponer un aliado inventado', () => {
    const cuerpo = armarParteAlianzas([], null, { total: 0, sinCiudad: 0, top: [], truncado: false }, LUNES);
    expect(cuerpo).toContain('LA LISTA DE ALIADOS OBJETIVO ESTÁ VACÍA');
    expect(cuerpo).toContain('NO inventa uno');
    expect(cuerpo).toContain('SIN SIGUIENTE TOQUE PROPUESTO');
  });

  it('la corrida lee las dos fuentes y encola el parte de la semana', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    respuestas.set('aliado_objetivo', [{ data: [{ id: 'canacar', nombre: 'CANACAR', tipo: 'gremio', estado: 'sin_contacto', ultimo_toque_en: null, contacto_nota: null, notas: null }], error: null }]);
    respuestas.set('rpc:prospecto_mapa_ciudades', [{
      data: { total: 3, sin_ciudad: 1, top: [{ ciudad: 'Monterrey', n: 2 }] }, error: null,
    }]);
    const r = await correrAgenteCrecimiento('alianzas', 'cron', HOY);
    expect(r.piezas).toBe(1);
    expect(ultimoTitulo()).toBe(`Alianzas — semana del ${LUNES}`);
    expect(ultimoCuerpo()).toContain('Monterrey (2)');
    // Y NO se leyó `prospecto` fila por fila: el conteo se hace en la base.
    expect(ultimoCuerpo()).not.toContain('NO SE PUBLICA UN RANKING');
  });

  it('c7-4 · si la RPC del mapa no contesta, la corrida FALLA: no se publica un censo que nadie contó', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    respuestas.set('aliado_objetivo', [{ data: [{ id: 'canacar', nombre: 'CANACAR', tipo: 'gremio', estado: 'sin_contacto', ultimo_toque_en: null, contacto_nota: null, notas: null }], error: null }]);
    respuestas.set('rpc:prospecto_mapa_ciudades', [{ data: null, error: { message: 'sin respuesta en 8000 ms (tope de consulta)' } }]);
    await expect(correrAgenteCrecimiento('alianzas', 'cron', HOY)).rejects.toThrow(/tope de consulta/);
    expect(encolar).not.toHaveBeenCalled();
  });

  it('c7-4 · sin la 0238 aplicada se cae al lector viejo, pero DEGRADADO: total exacto y ranking apagado', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    respuestas.set('aliado_objetivo', [{ data: [{ id: 'canacar', nombre: 'CANACAR', tipo: 'gremio', estado: 'sin_contacto', ultimo_toque_en: null, contacto_nota: null, notas: null }], error: null }]);
    // 42883 = `undefined_function`: la migración todavía no llegó a esta base.
    respuestas.set('rpc:prospecto_mapa_ciudades', [{ data: null, error: { message: 'function does not exist', code: '42883' } }]);
    // El lector viejo: trae 1 fila y el conteo exacto dice que hay 33,071.
    respuestas.set('prospecto', [{ data: [{ ciudad: 'Aguascalientes' }], error: null, count: 33_071 }]);

    const r = await correrAgenteCrecimiento('alianzas', 'cron', HOY);
    expect(r.piezas).toBe(1);
    expect(ultimoCuerpo()).toContain('33,071 prospecto(s) vivos');
    expect(ultimoCuerpo(), 'el respaldo degrada a «no lo sé», nunca a un ranking').toContain('NO SE PUBLICA UN RANKING DE PLAZAS');
    expect(ultimoCuerpo()).not.toContain('Aguascalientes');
  });

  it('la lista de aliados ilegible: la corrida FALLA en vez de decir que no hay a quién tocar', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    respuestas.set('aliado_objetivo', [{ data: null, error: { message: 'base caída' } }]);
    respuestas.set('rpc:prospecto_mapa_ciudades', [{ data: { total: 0, sin_ciudad: 0, top: [] }, error: null }]);
    await expect(correrAgenteCrecimiento('alianzas', 'cron', HOY)).rejects.toThrow(/base caída/);
    expect(encolar).not.toHaveBeenCalled();
  });
});

// ── La regla que gobierna a los diez ───────────────────────────────────────

describe('la regla que gobierna al departamento', () => {
  it('TODA pieza de los nueve deterministas dice que publicar es el tap de Javier', async () => {
    const agentes = AGENTES_CRECIMIENTO.filter((a) => a !== 'contenido_fiscal');
    for (const agente of agentes) {
      respuestas.clear();
      encolar.mockClear();
      respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
      respuestas.set('aliado_objetivo', [{ data: [{ id: 'canacar', nombre: 'CANACAR', tipo: 'gremio', estado: 'sin_contacto', ultimo_toque_en: null, contacto_nota: null, notas: null }], error: null }]);
      respuestas.set('rpc:prospecto_mapa_ciudades', [{ data: { total: 0, sin_ciudad: 0, top: [] }, error: null }]);
      respuestas.set('sitio_evento', [{ data: [], error: null, count: 0 }]);
      await correrAgenteCrecimiento(agente, 'cron', HOY);
      expect(encolar, agente).toHaveBeenCalledTimes(1);
      expect(ultimoCuerpo(), agente).toContain('el tap de Javier');
    }
  });

  it('las nueve corridas anotan costo 0 MEDIDO, no NULL: sí saben lo que gastaron', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    await correrAgenteCrecimiento('seo_distribucion', 'cron', HOY);
    expect(registrar.mock.calls.at(-1)?.[2]).toMatchObject({ costoUsd: 0 });
  });

  it('ninguna pieza toca un canal de salida: el motor solo encola', async () => {
    respuestas.set('cola_aprobacion', [{ count: 0, error: null }]);
    await correrAgenteCrecimiento('seo_distribucion', 'cron', HOY);
    const p = encolar.mock.calls.at(-1)?.[0] as { prioridad: string; tenantId?: unknown };
    expect(p.prioridad).toBe('normal');
    expect(p.tenantId).toBeUndefined();
  });
});
