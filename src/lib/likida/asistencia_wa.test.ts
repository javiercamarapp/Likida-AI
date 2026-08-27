import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// El circuito de asistencia/siniestros (0198, Fase 4). Lo que más se prueba
// es lo que más cuesta si falla — y aquí lo que falla cuesta VIDAS, no pesos:
//
//   · el falso NEGATIVO es el caro (la asimetría invertida de talacha): un
//     "chocamos" que no se reconozca es una emergencia tratada como charla;
//   · `hay_lesionados` JAMÁS false por defecto — NULL es "no preguntado";
//   · el modo mudo (violencia activa) contesta UNA sola línea neutra;
//   · el segundo mensaje de la misma emergencia NO duplica el 🚨 al jefe;
//   · la firma del jefe es atómica: dos taps, un ganador, y el segundo
//     recibe la verdad.
// ═══════════════════════════════════════════════════════════════════════════

type Resp = { data?: unknown; error?: { message: string } | null };
let respuestas: Record<string, Resp>;
let escrituras: Array<{ clave: string; payload: unknown }>;

function claveDe(tabla: string, verbo: string, selectArg: string | null): string {
  if (verbo === 'update') return `${tabla}.claim`;
  if (verbo === 'insert') return `${tabla}.insert`;
  return `${tabla}.select:${selectArg ?? ''}`;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      let verbo = 'select';
      let selectArg: string | null = null;
      let payload: unknown = null;
      const responder = (): Resp => {
        const clave = claveDe(tabla, verbo, selectArg);
        if (verbo !== 'select') escrituras.push({ clave, payload });
        const r = respuestas[clave];
        if (!r) throw new Error(`sin respuesta preparada para ${clave}`);
        return r;
      };
      const b = {
        select: (arg: string) => { if (verbo === 'select') selectArg = arg; return b; },
        update: (fila: unknown) => { verbo = 'update'; payload = fila; return b; },
        insert: (fila: unknown) => { verbo = 'insert'; payload = fila; return b; },
        eq: () => b, in: () => b, neq: () => b, is: () => b,
        order: () => b, limit: () => b,
        maybeSingle: async () => responder(),
        then: (res: (r: Resp) => unknown, rej: (e: unknown) => unknown) => {
          try { return Promise.resolve(responder()).then(res, rej); } catch (e) { return Promise.reject(e).catch(rej); }
        },
      };
      return b;
    },
  }),
}));
vi.mock('./presupuesto', async (orig) => ({
  ...(await orig() as object),
  acotada: (q: unknown) => q,
}));
const crearIncidencia = vi.fn();
vi.mock('./operacion', () => ({ crearIncidencia: (...a: unknown[]) => crearIncidencia(...a) }));
const telefonoJefeDe = vi.fn();
vi.mock('./contactos', () => ({ telefonoJefeDe: (...a: unknown[]) => telefonoJefeDe(...a) }));
const sendText = vi.fn();
const sendButtons = vi.fn();
vi.mock('@/lib/meta/client', () => ({
  sendText: (...a: unknown[]) => sendText(...a),
  sendButtons: (...a: unknown[]) => sendButtons(...a),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const {
  interpretarAsistencia, tipoDeAsistencia, lesionadosSegunTexto,
  atenderAsistenciaChofer, atenderReconocimientoAsistencia, atenderAsistenciaOficina,
} = await import('./asistencia_wa');

const INC = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const JEFE = { tenantId: 't1', rol: 'flota_admin' as const, userId: 'u-jefe' };

/** El caso común: nada abierto, hay jefe, todo se puede leer y escribir. */
function baseFeliz() {
  respuestas = {
    'incidencia.select:id, tipo': { data: [], error: null },
    'incidencia.select:id': { data: [], error: null },
    'incidencia_evento.insert': { error: null },
    'operador.select:nombre': { data: { nombre: 'Juan Pérez' }, error: null },
    'viaje.select:folio': { data: { folio: 'VJ-0847' }, error: null },
  };
  telefonoJefeDe.mockResolvedValue('5215550000009');
  sendButtons.mockResolvedValue('wamid.BTN');
  sendText.mockResolvedValue('wamid.TXT');
  crearIncidencia.mockResolvedValue(INC);
}

beforeEach(() => {
  respuestas = {};
  escrituras = [];
  vi.clearAllMocks();
});

// ── El reconocedor ─────────────────────────────────────────────────────────

describe('interpretarAsistencia — ROJO por familia', () => {
  it.each([
    ['chocamos con un tráiler', false],
    ['se volcó, volcadura en la curva', false],
    ['atropellamos a alguien', false],
    ['se está quemando la unidad, incendio', false],
    ['hay un herido', false],
    ['derrame de diésel en la carretera', false],
    ['márquenle al 911', false],
    ['la vía está bloqueada por un accidente', false],
    ['nos asaltaron en la caseta', true],
    ['me robaron el tráiler', true],
    ['balacera adelante', true],
    ['hay un retén raro', true],
  ])('"%s" es ROJO (mudo=%s)', (texto, mudo) => {
    const r = interpretarAsistencia(texto);
    expect(r).toEqual({ nivel: 'rojo', modoMudo: mudo });
  });

  it('la pregunta NO descarta: "¿qué hago? choqué" es ROJO', () => {
    expect(interpretarAsistencia('¿qué hago? choqué')?.nivel).toBe('rojo');
  });

  it('SIN tope de largo: 500 caracteres con "chocamos" adentro reconocen (talacha corta a 220)', () => {
    const largo = 'te cuento todo lo que pasó porque fue un desastre '.repeat(9) + ' y chocamos contra el muro de contención';
    expect(largo.length).toBeGreaterThan(400);
    expect(interpretarAsistencia(largo)?.nivel).toBe('rojo');
  });

  it('el modo mudo es SOLO violencia — lesionados es ROJO normal (necesita instrucciones)', () => {
    expect(interpretarAsistencia('hay dos lesionados')).toEqual({ nivel: 'rojo', modoMudo: false });
    expect(interpretarAsistencia('nos asaltaron y hay un herido')).toEqual({ nivel: 'rojo', modoMudo: true });
  });

  it.each(['me quedé varado', 'no arranca el camión', 'se me fue el freno', 'sale humo del motor', 'se sobrecalentó'])(
    '"%s" es ÁMBAR', (texto) => {
      expect(interpretarAsistencia(texto)).toEqual({ nivel: 'ambar', modoMudo: false });
    },
  );

  it('lo que no es emergencia sigue su camino: talacha, hitos, charla', () => {
    expect(interpretarAsistencia('se me ponchó una llanta, la talacha son 800')).toBeNull();
    expect(interpretarAsistencia('ya llegué')).toBeNull();
    expect(interpretarAsistencia('¿cuánto llevo?')).toBeNull();
    // "chocolate" no es "choque": la alternancia es explícita, no raíz.
    expect(interpretarAsistencia('me compré un chocolate en el oxxo')).toBeNull();
  });
});

describe('tipoDeAsistencia y lesionados', () => {
  it('la violencia manda el protocolo aunque haya heridos: robo + hay_lesionados aparte', () => {
    const texto = 'nos asaltaron y hay un herido';
    expect(tipoDeAsistencia(texto, 'rojo')).toBe('robo');
    expect(lesionadosSegunTexto(texto)).toBe(true);
  });

  it('choque → siniestro; herido solo → emergencia_medica; vía → bloqueo; ámbar → varado', () => {
    expect(tipoDeAsistencia('chocamos feo', 'rojo')).toBe('siniestro');
    expect(tipoDeAsistencia('hay un herido', 'rojo')).toBe('emergencia_medica');
    expect(tipoDeAsistencia('la vía está bloqueada', 'rojo')).toBe('bloqueo');
    expect(tipoDeAsistencia('me quedé varado', 'ambar')).toBe('varado');
  });

  it('hay_lesionados es NULL cuando el texto no lo dice — JAMÁS false', () => {
    // La aserción más importante del circuito: el silencio no es un parte médico.
    expect(lesionadosSegunTexto('chocamos contra el muro')).toBeNull();
    expect(lesionadosSegunTexto('volcadura en la curva')).toBeNull();
  });
});

// ── El lado del chofer ─────────────────────────────────────────────────────

describe('atenderAsistenciaChofer', () => {
  it('abre la incidencia con tipo/prioridad/lesionados correctos y avisa al jefe con 🚨 y botón', async () => {
    baseFeliz();
    const r = await atenderAsistenciaChofer({
      tenantId: 't1', viajeId: 'v1', operadorId: 'o1',
      texto: 'chocamos con un coche, hay un herido',
      asistencia: { nivel: 'rojo', modoMudo: false },
      waMessageId: 'wamid.X1',
    });
    expect(crearIncidencia).toHaveBeenCalledWith('t1', expect.objectContaining({
      viajeId: 'v1', operadorId: 'o1', tipo: 'siniestro', prioridad: 'critica', hayLesionados: true,
    }));
    const [tel, cuerpo, botones] = sendButtons.mock.calls[0] as [string, string, Array<{ id: string }>];
    expect(tel).toBe('5215550000009');
    expect(cuerpo).toContain('🚨');
    expect(cuerpo).toContain('LESIONADOS');
    expect(botones[0].id).toBe(`asi_ok:${INC}`);
    expect(r.respuesta).toContain('911');
  });

  it('sin mención de lesionados, hayLesionados viaja NULL — no false', async () => {
    baseFeliz();
    await atenderAsistenciaChofer({
      tenantId: 't1', viajeId: 'v1', operadorId: 'o1',
      texto: 'volcadura en la curva del km 40',
      asistencia: { nivel: 'rojo', modoMudo: false },
    });
    expect(crearIncidencia).toHaveBeenCalledWith('t1', expect.objectContaining({ hayLesionados: null }));
  });

  it('modo mudo: UNA línea neutra al chofer, y el aviso al jefe trae el "no le marques"', async () => {
    baseFeliz();
    const r = await atenderAsistenciaChofer({
      tenantId: 't1', viajeId: 'v1', operadorId: 'o1',
      texto: 'nos están asaltando',
      asistencia: { nivel: 'rojo', modoMudo: true },
    });
    expect(r.respuesta).toBe('Recibido. Tu jefe ya lo sabe.');
    const cuerpo = String(sendButtons.mock.calls[0][1]);
    expect(cuerpo).toContain('NO le marques');
  });

  it('modo mudo NO revela el fallo del aviso: la misma línea neutra aunque el jefe no recibiera', async () => {
    baseFeliz();
    sendButtons.mockResolvedValue(null);   // Meta rechazó
    const r = await atenderAsistenciaChofer({
      tenantId: 't1', viajeId: 'v1', operadorId: 'o1',
      texto: 'nos están asaltando',
      asistencia: { nivel: 'rojo', modoMudo: true },
    });
    expect(r.respuesta).toBe('Recibido. Tu jefe ya lo sabe.');
    // Pero la bitácora sí dice la verdad, para el post-mortem y la Fase 5.
    expect(escrituras.some((e) => e.clave === 'incidencia_evento.insert'
      && (e.payload as { tipo?: string }).tipo === 'aviso_jefe_fallido')).toBe(true);
  });

  it('fuera del modo mudo, el aviso fallido se dice con la verdad: "márcale DIRECTO"', async () => {
    baseFeliz();
    sendButtons.mockResolvedValue(null);
    const r = await atenderAsistenciaChofer({
      tenantId: 't1', viajeId: 'v1', operadorId: 'o1',
      texto: 'chocamos',
      asistencia: { nivel: 'rojo', modoMudo: false },
    });
    expect(r.respuesta).toContain('NO pude avisarle a tu jefe');
    expect(r.respuesta).toContain('márcale DIRECTO');
  });

  it('la segunda llamada de la misma emergencia NO duplica: evento sí, 🚨 no', async () => {
    baseFeliz();
    respuestas['incidencia.select:id, tipo'] = { data: [{ id: INC, tipo: 'siniestro' }], error: null };
    const r = await atenderAsistenciaChofer({
      tenantId: 't1', viajeId: 'v1', operadorId: 'o1',
      texto: 'sigue el choque, ya llegó la ambulancia',
      asistencia: { nivel: 'rojo', modoMudo: false },
      waMessageId: 'wamid.X2',
    });
    expect(crearIncidencia).not.toHaveBeenCalled();
    expect(sendButtons).not.toHaveBeenCalled();
    expect(escrituras.some((e) => e.clave === 'incidencia_evento.insert'
      && (e.payload as { tipo?: string }).tipo === 'mensaje_adicional')).toBe(true);
    expect(r.respuesta).toContain('ya tiene tu reporte');
  });

  it('sin viaje, la incidencia se ata al operador (punto C): la búsqueda no revienta y crea', async () => {
    baseFeliz();
    await atenderAsistenciaChofer({
      tenantId: 't1', viajeId: null, operadorId: 'o1',
      texto: 'chocamos saliendo del patio',
      asistencia: { nivel: 'rojo', modoMudo: false },
    });
    expect(crearIncidencia).toHaveBeenCalledWith('t1', expect.objectContaining({ viajeId: null, operadorId: 'o1' }));
  });

  it('si no se puede saber si ya hay abierta, NO se crea a ciegas y la salida no depende de nosotros', async () => {
    baseFeliz();
    respuestas['incidencia.select:id, tipo'] = { data: null, error: { message: 'timeout' } };
    const r = await atenderAsistenciaChofer({
      tenantId: 't1', viajeId: 'v1', operadorId: 'o1',
      texto: 'chocamos',
      asistencia: { nivel: 'rojo', modoMudo: false },
    });
    expect(crearIncidencia).not.toHaveBeenCalled();
    expect(r.respuesta).toContain('márcale DIRECTO');
  });
});

// ── El lado del jefe ───────────────────────────────────────────────────────

describe('atenderReconocimientoAsistencia', () => {
  it('firma atómica y avisa al chofer que ya van', async () => {
    respuestas = {
      'incidencia.claim': { data: [{ id: INC, tipo: 'siniestro', viaje_id: 'v1', operador_id: 'o1' }], error: null },
      'incidencia_evento.insert': { error: null },
      'operador.select:telefono': { data: { telefono: '5219990001111' }, error: null },
    };
    sendText.mockResolvedValue('wamid.OK');
    const r = await atenderReconocimientoAsistencia(JEFE, `asi_ok:${INC}`);
    expect(r).toContain('la estás atendiendo ✅');
    expect(r).toContain('le avisé al chofer');
    expect(sendText).toHaveBeenCalledWith('5219990001111', expect.stringContaining('ayuda en camino'));
    const claim = escrituras.find((e) => e.clave === 'incidencia.claim');
    expect((claim?.payload as { reconocida_por?: string }).reconocida_por).toBe('u-jefe');
  });

  it('el segundo tap recibe la verdad, no una re-firma', async () => {
    respuestas = {
      'incidencia.claim': { data: [], error: null },
      'incidencia.select:reconocida_en': { data: { reconocida_en: '2026-08-26T00:00:00Z' }, error: null },
    };
    const r = await atenderReconocimientoAsistencia(JEFE, `asi_ok:${INC}`);
    expect(r).toContain('ya la está atendiendo');
    expect(sendText).not.toHaveBeenCalled();
  });

  it('en robo/violencia el chofer NO recibe nada — el modo mudo no termina con un botón', async () => {
    respuestas = {
      'incidencia.claim': { data: [{ id: INC, tipo: 'robo', viaje_id: 'v1', operador_id: 'o1' }], error: null },
      'incidencia_evento.insert': { error: null },
    };
    const r = await atenderReconocimientoAsistencia(JEFE, `asi_ok:${INC}`);
    expect(sendText).not.toHaveBeenCalled();
    expect(r).toContain('NO le escribimos nada');
  });

  it('el rol sin mando no reconoce, y un texto ajeno devuelve null', async () => {
    expect(await atenderReconocimientoAsistencia({ ...JEFE, rol: 'contador' }, `asi_ok:${INC}`))
      .toContain('Tu rol no atiende');
    expect(await atenderReconocimientoAsistencia(JEFE, 'buenos días')).toBeNull();
  });
});

// ── El lado de la oficina ──────────────────────────────────────────────────

describe('atenderAsistenciaOficina', () => {
  it('un ROJO del dueño abre incidencia de flota (sin viaje ni operador) con prioridad crítica', async () => {
    baseFeliz();
    const r = await atenderAsistenciaOficina(JEFE, 'chocamos saliendo de la bodega', { nivel: 'rojo', modoMudo: false });
    expect(crearIncidencia).toHaveBeenCalledWith('t1', expect.objectContaining({ tipo: 'siniestro', prioridad: 'critica' }));
    expect(r).toContain('crítica');
    expect(r).toContain('911');
  });

  it('el ámbar de oficina NO es de este circuito (el analista puede con "el camión no arranca")', async () => {
    expect(await atenderAsistenciaOficina(JEFE, 'no arranca la 12', { nivel: 'ambar', modoMudo: false })).toBeNull();
  });
});
