import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// El circuito de la talacha (0107): reporte del chofer → solicitud al jefe →
// decisión FIRMADA. Lo que más se prueba es lo que más cuesta si falla: que
// una cifra jamás se invente, que el agente jamás autorice solo, y que la
// decisión del jefe quede con quién/cuándo — o no quede.
// ═══════════════════════════════════════════════════════════════════════════

// ── El doble de Supabase: respuestas por (tabla, forma de la consulta) ─────
type Resp = { data?: unknown; error?: { message: string } | null };
let respuestas: Record<string, Resp>;
/** Toda escritura queda anotada para poder afirmar QUÉ se escribió. */
let escrituras: Array<{ clave: string; payload: unknown; eqs: unknown[][] }>;

function claveDe(tabla: string, verbo: string, selectArg: string | null): string {
  if (verbo === 'update') return selectArg ? `${tabla}.claim` : `${tabla}.update`;
  if (verbo === 'insert') return `${tabla}.insert`;
  return `${tabla}.select:${selectArg ?? ''}`;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      let verbo = 'select';
      let selectArg: string | null = null;
      let payload: unknown = null;
      const eqs: unknown[][] = [];
      const responder = (): Resp => {
        const clave = claveDe(tabla, verbo, selectArg);
        if (verbo === 'update' || verbo === 'insert') escrituras.push({ clave, payload, eqs });
        const r = respuestas[clave];
        if (!r) throw new Error(`sin respuesta preparada para ${clave}`);
        return r;
      };
      const b = {
        select: (arg: string) => { selectArg = arg; return b; },
        update: (fila: unknown) => { verbo = 'update'; payload = fila; return b; },
        insert: (fila: unknown) => { verbo = 'insert'; payload = fila; return b; },
        eq: (...a: unknown[]) => { eqs.push(a); return b; },
        order: () => b,
        limit: () => b,
        maybeSingle: async () => responder(),
        // thenable: `await builder` en las cadenas sin maybeSingle
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
  interpretarTalacha, extraerMonto, atenderTalachaChofer, atenderAutorizacionTalacha,
} = await import('./talacha_wa');

const INC = '11111111-2222-3333-4444-555555555555';
const JEFE = { tenantId: 't1', rol: 'flota_admin' as const, userId: 'u-jefe' };
const AHORA = new Date('2026-08-14T17:00:00Z');
const CHOFER = { tenantId: 't1', viajeId: 'v1', operadorId: 'o1' };

/** El caso común: no hay pendiente, hay jefe, todo se puede leer. */
function baseFeliz() {
  respuestas = {
    'incidencia.select:id, monto_estimado, evidencia_path, gasto_id, avisada_jefe_en': { data: [], error: null },
    'operador.select:nombre': { data: { nombre: 'Juan Pérez' }, error: null },
    'viaje.select:folio': { data: { folio: 'VJ-2026-0847' }, error: null },
    // El sello de `avisarAlJefe` tras un envío exitoso (agentico.md:455).
    'incidencia.update': { error: null },
  };
  telefonoJefeDe.mockResolvedValue('5215550000009');
  sendButtons.mockResolvedValue('wamid.BTN');
  sendText.mockResolvedValue('wamid.TXT');
  crearIncidencia.mockResolvedValue(INC);
}

beforeEach(() => {
  respuestas = {};
  escrituras = [];
  crearIncidencia.mockReset();
  telefonoJefeDe.mockReset();
  sendText.mockReset();
  sendButtons.mockReset();
});

// ── El reconocimiento: palabra del oficio, monto solo amarrado a dinero ────

describe('interpretarTalacha', () => {
  it('reconoce el reporte real con su monto', () => {
    const r = interpretarTalacha('se me ponchó una llanta aquí en la caseta, la talacha son 800');
    expect(r).not.toBeNull();
    expect(r!.monto).toBe(800);
  });

  it('reconoce sin monto: la avería sin cifra es monto null, nunca 0', () => {
    const r = interpretarTalacha('se me ponchó una llanta');
    expect(r).not.toBeNull();
    expect(r!.monto).toBeNull();
  });

  it('la pregunta del chofer también es un reporte ("¿me autorizan la talacha de $600?")', () => {
    const r = interpretarTalacha('¿me autorizan la talacha de $600?');
    expect(r).not.toBeNull();
    expect(r!.monto).toBe(600);
  });

  it('NO se traga lo que no trae palabra del oficio', () => {
    expect(interpretarTalacha('voy a checar la llanta en la parada')).toBeNull();
    expect(interpretarTalacha('ya llegué')).toBeNull();
    expect(interpretarTalacha('¿cuánto llevo?')).toBeNull();
    expect(interpretarTalacha('listo, terminé')).toBeNull();
  });

  it('un mensaje largo no es un reporte: es una explicación', () => {
    expect(interpretarTalacha(`talacha ${'x'.repeat(230)}`)).toBeNull();
  });
});

describe('extraerMonto — el número solo cuenta amarrado a dinero', () => {
  it('lee $800, "800 pesos" y "me cobran 800"', () => {
    expect(extraerMonto('la talacha cuesta $800')).toBe(800);
    expect(extraerMonto('son 800 pesos de talacha')).toBe(800);
    expect(extraerMonto('me cobran 1,250 por la ponchadura')).toBe(1250);
  });

  it('la medida de la llanta NO es un precio', () => {
    expect(extraerMonto('se ponchó la llanta 295/80 R22')).toBeNull();
  });

  it('dos cifras de dinero DISTINTAS no se adivinan: null y se pide', () => {
    expect(extraerMonto('me cobran 800 pero con $200 de arrastre')).toBeNull();
  });

  it('la misma cifra amarrada dos veces sí cuenta (no es ambigüedad)', () => {
    expect(extraerMonto('son $800, ochocientos: 800 pesos')).toBe(800);
  });
});

// ── El lado del chofer ─────────────────────────────────────────────────────

describe('atenderTalachaChofer — abrir la solicitud', () => {
  it('abre la incidencia pendiente con monto y le manda al jefe los botones', async () => {
    baseFeliz();
    const r = await atenderTalachaChofer({ ...CHOFER, texto: 'se me ponchó una llanta, son 800', monto: 800 });

    expect(crearIncidencia).toHaveBeenCalledWith('t1', expect.objectContaining({
      viajeId: 'v1', tipo: 'averia', prioridad: 'alta',
      montoEstimado: 800, autorizacion: 'pendiente',
    }));
    // La solicitud al jefe trae el nombre real, el folio real y la cifra real.
    const [tel, cuerpo, botones] = sendButtons.mock.calls[0] as [string, string, Array<{ id: string }>];
    expect(tel).toBe('5215550000009');
    expect(cuerpo).toContain('Juan Pérez');
    expect(cuerpo).toContain('VJ-2026-0847');
    expect(cuerpo).toContain('$800.00');
    expect(botones.map((b) => b.id)).toEqual([`tal_si:${INC}`, `tal_no:${INC}`]);
    expect(r).toContain('$800.00');
    expect(r).toContain('jefe');
  });

  it('sin monto: se abre igual, y al chofer se le PIDE la cifra en vez de inventarla', async () => {
    baseFeliz();
    const r = await atenderTalachaChofer({ ...CHOFER, texto: 'se me ponchó una llanta', monto: null });
    expect(crearIncidencia).toHaveBeenCalledWith('t1', expect.objectContaining({ montoEstimado: null }));
    expect(r).toContain('¿Cuánto te cobran?');
    expect(r).not.toContain('$0');
  });

  it('si el WhatsApp al jefe NO sale, al chofer se le dice la verdad — no se promete una solicitud que nadie recibió', async () => {
    baseFeliz();
    sendButtons.mockResolvedValue(null);
    const r = await atenderTalachaChofer({ ...CHOFER, texto: 'talacha, son 800', monto: 800 });
    expect(crearIncidencia).toHaveBeenCalled();     // la incidencia SÍ queda (panel)
    expect(r).toContain('NO le pude mandar el aviso a tu jefe');
  });

  it('flota sin jefe con teléfono: misma verdad', async () => {
    baseFeliz();
    telefonoJefeDe.mockResolvedValue(null);
    const r = await atenderTalachaChofer({ ...CHOFER, texto: 'talacha, son 800', monto: 800 });
    expect(r).toContain('NO le pude mandar el aviso');
  });

  it('con la base caída NO se crea a ciegas: fallar cerrado y decirlo', async () => {
    respuestas = {
      'incidencia.select:id, monto_estimado, evidencia_path, gasto_id, avisada_jefe_en': { data: null, error: { message: 'boom' } },
    };
    const r = await atenderTalachaChofer({ ...CHOFER, texto: 'talacha', monto: null });
    expect(crearIncidencia).not.toHaveBeenCalled();
    expect(r).toContain('No pude anotar');
  });
});

describe('atenderTalachaChofer — el reporte repetido NO duplica', () => {
  it('con pendiente completa, el mismo reporte contesta "ya lo tengo" sin crear ni reavisar', async () => {
    baseFeliz();
    respuestas['incidencia.select:id, monto_estimado, evidencia_path, gasto_id, avisada_jefe_en'] = {
      data: [{ id: INC, monto_estimado: 800, evidencia_path: 'ruta/x.jpg', gasto_id: 'g1', avisada_jefe_en: '2026-08-14T10:00:00Z' }],
      error: null,
    };
    const r = await atenderTalachaChofer({ ...CHOFER, texto: 'se me ponchó una llanta, son 800', monto: 800 });
    expect(crearIncidencia).not.toHaveBeenCalled();
    expect(sendButtons).not.toHaveBeenCalled();
    expect(r).toContain('Ya tengo anotada');
  });

  it('el monto que llega DESPUÉS completa la pendiente y se le reenvía al jefe con cifra', async () => {
    baseFeliz();
    respuestas['incidencia.select:id, monto_estimado, evidencia_path, gasto_id, avisada_jefe_en'] = {
      data: [{ id: INC, monto_estimado: null, evidencia_path: null, gasto_id: null }], error: null,
    };
    respuestas['incidencia.update'] = { error: null };
    const r = await atenderTalachaChofer({ ...CHOFER, texto: 'la talacha son 950', monto: 950 });

    expect(crearIncidencia).not.toHaveBeenCalled();
    const upd = escrituras.find((e) => e.clave === 'incidencia.update');
    expect(upd?.payload).toEqual({ monto_estimado: 950 });
    // El UPDATE va anclado a la pendiente: id + tenant + autorizacion.
    expect(upd?.eqs).toContainEqual(['autorizacion', 'pendiente']);
    expect(sendButtons).toHaveBeenCalled();
    expect(r).toContain('$950.00');
  });

  it('la foto que llega después deja su evidencia sin pisar el monto ya reportado', async () => {
    baseFeliz();
    respuestas['incidencia.select:id, monto_estimado, evidencia_path, gasto_id, avisada_jefe_en'] = {
      data: [{ id: INC, monto_estimado: 800, evidencia_path: null, gasto_id: null, avisada_jefe_en: '2026-08-14T10:00:00Z' }],
      error: null,
    };
    respuestas['incidencia.update'] = { error: null };
    const r = await atenderTalachaChofer({
      ...CHOFER, texto: 'talacha, son 999', monto: 999, evidenciaPath: 'comp/foto.jpg', gastoId: 'g7',
    });
    const upd = escrituras.find((e) => e.clave === 'incidencia.update');
    // El monto YA reportado (800) manda: el 999 posterior no lo pisa.
    expect(upd?.payload).toEqual({ evidencia_path: 'comp/foto.jpg', gasto_id: 'g7' });
    expect(r).toContain('evidencia');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 25 (ALTO, agentico.md:455, REINCIDENTE de la 24) — «tu jefe ya
// tiene la solicitud» NO se afirma sin comprobarlo. `avisada_jefe_en` NULL en
// la pendiente es la prueba de que el primer aviso nunca llegó: el turno
// siguiente reintenta en vez de reafirmar una entrega que nunca pasó.
// ═══════════════════════════════════════════════════════════════════════════
describe('atenderTalachaChofer — el aviso al jefe que falló se reintenta, nunca se da por hecho', () => {
  it('reporte repetido sin nada nuevo, pero el aviso ANTERIOR falló: se reintenta y esta vez sí llega', async () => {
    baseFeliz();
    respuestas['incidencia.select:id, monto_estimado, evidencia_path, gasto_id, avisada_jefe_en'] = {
      // avisada_jefe_en ausente == NULL: el primer intento nunca se selló.
      data: [{ id: INC, monto_estimado: 800, evidencia_path: 'ruta/x.jpg', gasto_id: 'g1' }], error: null,
    };
    const r = await atenderTalachaChofer({ ...CHOFER, texto: 'se me ponchó una llanta, son 800', monto: 800 });
    expect(crearIncidencia).not.toHaveBeenCalled();
    // Se reintenta de VERDAD — no se asume.
    expect(sendButtons).toHaveBeenCalledTimes(1);
    // Y el sello queda escrito para que el turno de después no vuelva a dudar.
    const sello = escrituras.find((e) => e.clave === 'incidencia.update'
      && typeof e.payload === 'object' && e.payload !== null && 'avisada_jefe_en' in (e.payload as object));
    expect(sello).toBeDefined();
    expect(r).toContain('ahora sí le llegó');
    expect(r).not.toContain('Ya tengo anotada esa avería y tu jefe tiene la solicitud 👍');
  });

  it('reporte repetido sin nada nuevo, y el reintento TAMBIÉN falla: se dice la verdad, no "ya la tiene"', async () => {
    baseFeliz();
    sendButtons.mockResolvedValue(null);
    respuestas['incidencia.select:id, monto_estimado, evidencia_path, gasto_id, avisada_jefe_en'] = {
      data: [{ id: INC, monto_estimado: 800, evidencia_path: 'ruta/x.jpg', gasto_id: 'g1' }], error: null,
    };
    const r = await atenderTalachaChofer({ ...CHOFER, texto: 'se me ponchó una llanta, son 800', monto: 800 });
    expect(r).toContain('SIGO sin poder avisarle a tu jefe');
    expect(r).not.toContain('tu jefe tiene la solicitud');
  });

  it('la evidencia llega después del monto, pero el aviso con monto nunca se entregó: se reintenta, no se afirma', async () => {
    baseFeliz();
    respuestas['incidencia.select:id, monto_estimado, evidencia_path, gasto_id, avisada_jefe_en'] = {
      // monto ya puesto, avisada_jefe_en NULL: el aviso con la cifra falló.
      data: [{ id: INC, monto_estimado: 800, evidencia_path: null, gasto_id: null }], error: null,
    };
    respuestas['incidencia.update'] = { error: null };
    const r = await atenderTalachaChofer({
      ...CHOFER, texto: 'talacha, son 800', monto: 800, evidenciaPath: 'comp/foto.jpg', gastoId: 'g7',
    });
    expect(sendButtons).toHaveBeenCalledTimes(1);
    expect(r).toContain('ahora sí le llegó la solicitud');
    expect(r).not.toContain('Tu jefe ya tiene la solicitud — en cuanto decida te aviso.');
  });

  it('la evidencia llega y el reintento del aviso TAMBIÉN falla: se dice la verdad', async () => {
    baseFeliz();
    sendButtons.mockResolvedValue(null);
    respuestas['incidencia.select:id, monto_estimado, evidencia_path, gasto_id, avisada_jefe_en'] = {
      data: [{ id: INC, monto_estimado: 800, evidencia_path: null, gasto_id: null }], error: null,
    };
    respuestas['incidencia.update'] = { error: null };
    const r = await atenderTalachaChofer({
      ...CHOFER, texto: 'talacha, son 800', monto: 800, evidenciaPath: 'comp/foto.jpg', gastoId: 'g7',
    });
    expect(r).toContain('SIGO sin poder avisarle a tu jefe');
    expect(r).not.toContain('Tu jefe ya tiene la solicitud');
  });
});

// ── El lado del jefe ───────────────────────────────────────────────────────

/** Prepara la firma feliz del botón: claim gana, chofer localizable. */
function firmaFeliz() {
  respuestas['incidencia.claim'] = {
    data: [{ id: INC, viaje_id: 'v1', monto_estimado: 800 }], error: null,
  };
  respuestas['viaje.select:operador_id'] = { data: { operador_id: 'o1' }, error: null };
  respuestas['operador.select:nombre, telefono'] = {
    data: { nombre: 'Juan Pérez', telefono: '5219993700779' }, error: null,
  };
  sendText.mockResolvedValue('wamid.OK');
}

describe('atenderAutorizacionTalacha — la decisión del jefe', () => {
  it('lo que no es decisión devuelve null y no toca nada', async () => {
    expect(await atenderAutorizacionTalacha(JEFE, 'hola, ¿cómo van?', AHORA)).toBeNull();
    expect(await atenderAutorizacionTalacha(JEFE, 'sí', AHORA)).toBeNull();   // el "sí" pelón es de despacho/asignación
    expect(await atenderAutorizacionTalacha(JEFE, 'no', AHORA)).toBeNull();
    expect(escrituras).toEqual([]);
  });

  it('el botón AUTORIZAR firma con quién/cuándo y le avisa al chofer', async () => {
    firmaFeliz();
    const r = await atenderAutorizacionTalacha(JEFE, `tal_si:${INC}`, AHORA);

    const claim = escrituras.find((e) => e.clave === 'incidencia.claim');
    expect(claim?.payload).toEqual({
      autorizacion: 'autorizada',
      autorizada_por: 'u-jefe',                       // QUIÉN
      autorizada_en: AHORA.toISOString(),             // CUÁNDO
    });
    // El claim va anclado al tenant del LOOKUP y a la pendiente.
    expect(claim?.eqs).toContainEqual(['tenant_id', 't1']);
    expect(claim?.eqs).toContainEqual(['autorizacion', 'pendiente']);
    // El chofer se entera, con la cifra real.
    expect(String(sendText.mock.calls[0][1])).toContain('autorizó la talacha de $800.00');
    expect(r).toContain('Autorizada ✅');
    expect(r).toContain('Juan Pérez');
  });

  it('el botón RECHAZAR también se firma y también se avisa', async () => {
    firmaFeliz();
    const r = await atenderAutorizacionTalacha(JEFE, `tal_no:${INC}`, AHORA);
    const claim = escrituras.find((e) => e.clave === 'incidencia.claim');
    expect((claim?.payload as { autorizacion: string }).autorizacion).toBe('rechazada');
    expect(String(sendText.mock.calls[0][1])).toContain('NO autorizó');
    expect(r).toContain('Rechazada ❌');
  });

  it('el SEGUNDO botón no re-firma: recibe la verdad de lo ya decidido', async () => {
    respuestas['incidencia.claim'] = { data: [], error: null };   // el claim no encontró pendiente
    respuestas['incidencia.select:autorizacion'] = { data: { autorizacion: 'autorizada' }, error: null };
    const r = await atenderAutorizacionTalacha(JEFE, `tal_no:${INC}`, AHORA);
    expect(r).toContain('ya estaba autorizada');
    expect(sendText).not.toHaveBeenCalled();
  });

  // AUDITORÍA FABLE CICLO 3 (c3-4): el crash entre la firma y la orden.
  it('c3-4: el reintento tras un crash abre la orden de taller que faltaba', async () => {
    // El proceso murió después de firmar y antes de abrir la orden; Meta
    // reintenta y el claim ya no encuentra pendiente — pero la orden no existe.
    respuestas['incidencia.claim'] = { data: [], error: null };
    respuestas['incidencia.select:autorizacion'] = { data: { autorizacion: 'autorizada' }, error: null };
    respuestas['incidencia.select:id, viaje_id, unidad_id, descripcion'] = {
      data: { id: INC, viaje_id: 'v1', unidad_id: 'u-77', descripcion: 'llanta ponchada' }, error: null,
    };
    respuestas['mantenimiento.insert'] = { data: null, error: null };
    const r = await atenderAutorizacionTalacha(JEFE, `tal_si:${INC}`, AHORA);
    expect(escrituras.some((e) => e.clave === 'mantenimiento.insert')).toBe(true);
    expect(r).toContain('ya quedó abierta');
  });

  it('c3-4: si la orden YA existía (reintento normal), el mensaje no inventa nada', async () => {
    respuestas['incidencia.claim'] = { data: [], error: null };
    respuestas['incidencia.select:autorizacion'] = { data: { autorizacion: 'autorizada' }, error: null };
    respuestas['incidencia.select:id, viaje_id, unidad_id, descripcion'] = {
      data: { id: INC, viaje_id: 'v1', unidad_id: 'u-77', descripcion: 'llanta ponchada' }, error: null,
    };
    // El candado de la 0209: el duplicado no es fallo.
    respuestas['mantenimiento.insert'] = {
      data: null, error: { message: 'duplicate key value violates unique constraint "mantenimiento_incidencia_unica"' },
    };
    const r = await atenderAutorizacionTalacha(JEFE, `tal_si:${INC}`, AHORA);
    expect(r).toContain('ya estaba autorizada — no cambié nada');
    expect(r).not.toContain('quedó abierta');
  });

  it('un id que no es de esta flota recibe "no encontré", nunca toca otra flota', async () => {
    respuestas['incidencia.claim'] = { data: [], error: null };
    respuestas['incidencia.select:autorizacion'] = { data: null, error: null };
    const r = await atenderAutorizacionTalacha(JEFE, `tal_si:${INC}`, AHORA);
    expect(r).toContain('No encontré esa solicitud en tu flota');
  });

  it('el contador NO autoriza gastos de camino, ni con el botón en la mano', async () => {
    const r = await atenderAutorizacionTalacha({ ...JEFE, rol: 'contador' }, `tal_si:${INC}`, AHORA);
    expect(r).toContain('Tu rol no autoriza');
    expect(escrituras).toEqual([]);
  });

  it('superadmin sin flota: el botón recibe la verdad, la palabra cae al saludo', async () => {
    const r1 = await atenderAutorizacionTalacha({ ...JEFE, tenantId: null }, `tal_si:${INC}`, AHORA);
    expect(r1).toContain('no es de una flota tuya');
    const r2 = await atenderAutorizacionTalacha({ ...JEFE, tenantId: null }, 'autorizo', AHORA);
    expect(r2).toBeNull();
  });

  it('"autorizo" a mano decide SOLO con exactamente una pendiente', async () => {
    firmaFeliz();
    respuestas['incidencia.select:id'] = { data: [{ id: INC }], error: null };
    const r = await atenderAutorizacionTalacha(JEFE, 'autorizo', AHORA);
    expect(r).toContain('Autorizada ✅');
    const claim = escrituras.find((e) => e.clave === 'incidencia.claim');
    expect((claim?.payload as { autorizada_por: string }).autorizada_por).toBe('u-jefe');
  });

  it('"no autorizo" es rechazo, no autorización (la negación se mira primero)', async () => {
    firmaFeliz();
    respuestas['incidencia.select:id'] = { data: [{ id: INC }], error: null };
    await atenderAutorizacionTalacha(JEFE, 'no autorizo', AHORA);
    const claim = escrituras.find((e) => e.clave === 'incidencia.claim');
    expect((claim?.payload as { autorizacion: string }).autorizacion).toBe('rechazada');
  });

  it('con varias pendientes no se adivina cuál: se piden los botones', async () => {
    respuestas['incidencia.select:id'] = { data: [{ id: INC }, { id: 'otra' }], error: null };
    const r = await atenderAutorizacionTalacha(JEFE, 'autorizo', AHORA);
    expect(r).toContain('varias averías');
    expect(escrituras).toEqual([]);
  });

  it('con cero pendientes se dice la verdad', async () => {
    respuestas['incidencia.select:id'] = { data: [], error: null };
    const r = await atenderAutorizacionTalacha(JEFE, 'autorizo', AHORA);
    expect(r).toContain('ninguna avería');
  });

  it('si el aviso al chofer no sale, el jefe se entera — la firma NO se deshace', async () => {
    firmaFeliz();
    sendText.mockResolvedValue(null);   // Meta rechazó
    const r = await atenderAutorizacionTalacha(JEFE, `tal_si:${INC}`, AHORA);
    expect(r).toContain('NO le pude avisar');
    const claim = escrituras.find((e) => e.clave === 'incidencia.claim');
    expect((claim?.payload as { autorizacion: string }).autorizacion).toBe('autorizada');
  });

  it('base caída al firmar: se dice transitorio, no "no existe"', async () => {
    respuestas['incidencia.claim'] = { data: null, error: { message: 'se cayó' } };
    const r = await atenderAutorizacionTalacha(JEFE, `tal_si:${INC}`, AHORA);
    expect(r).toContain('inténtalo de nuevo');
  });
});
