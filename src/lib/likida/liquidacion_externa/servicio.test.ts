import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LiquidacionExterna } from './repo';
import type { EstadoEntrega, MensajeLiquidacion, EntregaWhatsApp } from './entrega';

// ═══════════════════════════════════════════════════════════════════════════
// EL SERVICIO: recibir, entregar, reintentar y acusar.
//
// La base se reemplaza por un almacén en memoria que respeta el contrato de
// `transicionar` (CONDICIONAL al estado: es el candado entre el POST y el cron)
// y de `registrarEvento`; el puerto de WhatsApp es un doble que se programa. Lo
// que se prueba es la MÁQUINA DE ESTADOS y sus invariantes:
//
//   · nada es `enviada` sin que el puerto lo diga, nada `acusada` sin botón;
//   · un fallo transitorio se reintenta con backoff y se agota a `fallida`;
//   · el POST y el cron a la vez no se pisan ni mandan dos veces;
//   · reintentar solo aplica a `fallida`;
//   · un chofer no puede acusar la liquidación de otro.
// ═══════════════════════════════════════════════════════════════════════════

const store = new Map<string, LiquidacionExterna>();
const eventos: Array<{ id: string; tipo: string; detalle: Record<string, unknown> }> = [];
const subidas: Array<{ ruta: string; bytes: number }> = [];

let operadorResuelto: { id: string; nombre: string; telefono: string; activo: boolean } | Error = {
  id: 'op-1', nombre: 'Juan Pérez', telefono: '525512345678', activo: true,
};

vi.mock('./repo', () => ({
  resolverOperadorDestino: vi.fn(async () => { if (operadorResuelto instanceof Error) throw operadorResuelto; return operadorResuelto; }),
  resolverViajeIds: vi.fn(async (_t: string, folios: string[]) => folios.filter((f) => f === 'VJ-1').map(() => 'viaje-uuid-1')),
  subirPdfExterno: vi.fn(async (ruta: string, bytes: Uint8Array) => { subidas.push({ ruta, bytes: bytes.length }); }),
  firmarPdfExterno: vi.fn(async () => 'https://firmada'),
  leerRazonSocial: vi.fn(async () => 'Flota SA'),
  insertarLiquidacionExterna: vi.fn(async (n: { tenantId: string; datos: { claveExterna: string; total: number; moneda: 'MXN' | 'USD'; periodo: { desde: string; hasta: string }; viajes: string[]; sistemaOrigen: string | null }; huella: string; operadorId: string; viajeIds: string[]; pdfRuta: string; pdfOrigen: 'adjunto' | 'generado' }) => {
    const fila: LiquidacionExterna = {
      id: `liq-${store.size + 1}`, tenantId: n.tenantId, claveExterna: n.datos.claveExterna, huella: n.huella,
      sistemaOrigen: n.datos.sistemaOrigen, operadorId: n.operadorId, operadorNombre: 'Juan Pérez', operadorTelefono: '525512345678',
      foliosViaje: n.datos.viajes, viajeIds: n.viajeIds, periodoDesde: n.datos.periodo.desde, periodoHasta: n.datos.periodo.hasta,
      conceptos: [], total: n.datos.total, moneda: n.datos.moneda, pdfRuta: n.pdfRuta, pdfOrigen: n.pdfOrigen,
      estado: 'pendiente', via: null, generacion: 1, intentos: 0, proximoIntentoEn: '2026-09-08T00:00:00.000Z',
      ultimoError: null, wamid: null, enviadaEn: null, acuseTipo: null, acuseEn: null, creadaEn: '2026-09-08T00:00:00.000Z',
    };
    store.set(fila.id, fila);
    return { ...fila };
  }),
  registrarEvento: vi.fn(async (_t: string, id: string, tipo: string, detalle: Record<string, unknown> = {}) => { eventos.push({ id, tipo, detalle }); }),
  leerPorId: vi.fn(async (tenantId: string, id: string) => {
    const f = store.get(id);
    return f && f.tenantId === tenantId ? { ...f } : null;
  }),
  // El CONTRATO real de `transicionar`: solo aplica si el estado actual está en `desde`.
  transicionar: vi.fn(async (tenantId: string, id: string, desde: string[], cambios: Record<string, unknown>) => {
    const f = store.get(id);
    if (!f || f.tenantId !== tenantId || !desde.includes(f.estado)) return false;
    const mapa: Record<string, keyof LiquidacionExterna> = {
      estado: 'estado', via: 'via', generacion: 'generacion', intentos: 'intentos', proximo_intento_en: 'proximoIntentoEn',
      ultimo_error: 'ultimoError', wamid: 'wamid', enviada_en: 'enviadaEn', acuse_tipo: 'acuseTipo', acuse_en: 'acuseEn',
    };
    for (const [k, v] of Object.entries(cambios)) (f as unknown as Record<string, unknown>)[mapa[k]] = v;
    return true;
  }),
}));
vi.mock('./trabajo', () => ({
  trabajoPendiente: vi.fn(async (limite: number, ahoraIso: string) =>
    [...store.values()]
      .filter((f) => f.estado === 'en_cola' || (f.estado === 'pendiente' && f.proximoIntentoEn <= ahoraIso))
      .slice(0, limite).map((f) => ({ ...f }))),
}));
vi.mock('../presupuesto', async (orig) => ({ ...(await orig<typeof import('../presupuesto')>()), acotada: (q: unknown) => q }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const {
  recibirLiquidacionExterna, intentarEntrega, procesarLiquidacionesExternas,
  reintentarLiquidacionExterna, registrarAcuse, MAX_INTENTOS_ENCOLADO,
} = await import('./servicio');
const { validarLiquidacionExterna, huellaContenido } = await import('./esquema');
const repo = await import('./repo');

const AHORA = new Date('2026-09-08T12:00:00.000Z');
let firmaFalla = false;
let siguiente: EstadoEntrega | Error = { estado: 'en_cola', via: 'sesion' };
const llamadas: MensajeLiquidacion[] = [];
const entrega: EntregaWhatsApp = {
  enviarConFallback: vi.fn(async (m) => { llamadas.push(m); if (siguiente instanceof Error) throw siguiente; return siguiente; }),
};
const deps = {
  entrega, ahora: () => AHORA,
  razonSocial: async () => 'Flota SA',
  firmarPdf: async () => { if (firmaFalla) throw new Error('storage caído'); return 'https://firmada.example/x.pdf'; },
};

const PDF_MIN = '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n';
const cuerpo = (extra: Record<string, unknown> = {}) => validarLiquidacionExterna({
  claveExterna: 'SAP-1', operador: { telefono: '5512345678' }, viajes: ['VJ-1', 'VJ-9'],
  periodo: { desde: '2026-09-01', hasta: '2026-09-07' },
  conceptos: [{ descripcion: 'Sueldo', tipo: 'percepcion', monto: 100 }], total: 100, moneda: 'MXN', ...extra,
});

async function recibir(extra: Record<string, unknown> = {}) {
  const d = cuerpo(extra);
  return (await recibirLiquidacionExterna('t-1', d, huellaContenido(d), deps)).liquidacion;
}

beforeEach(() => {
  store.clear(); eventos.length = 0; subidas.length = 0; llamadas.length = 0;
  operadorResuelto = { id: 'op-1', nombre: 'Juan Pérez', telefono: '525512345678', activo: true };
  firmaFalla = false; siguiente = { estado: 'en_cola', via: 'sesion' };
  vi.mocked(entrega.enviarConFallback).mockClear();
});

describe('recibir', () => {
  it('guarda la liquidación pendiente, resuelve los viajes y deja el evento «recibida»', async () => {
    const liq = await recibir();
    expect(liq.estado).toBe('pendiente');
    expect(liq.operadorId).toBe('op-1');
    expect(liq.viajeIds).toEqual(['viaje-uuid-1']);
    expect(eventos).toEqual([{ id: liq.id, tipo: 'recibida', detalle: expect.objectContaining({ viajes: 2, viajesEnLikida: 1, pdf: 'generado' }) }]);
  });

  it('sin PDF adjunto GENERA uno con las cifras y lo sube a una ruta direccionada por contenido', async () => {
    const liq = await recibir();
    expect(liq.pdfOrigen).toBe('generado');
    expect(subidas).toHaveLength(1);
    expect(subidas[0].bytes).toBeGreaterThan(500);
    expect(subidas[0].ruta).toMatch(/^t-1\/externas\/[0-9a-f]{24}-[0-9a-f]{16}\.pdf$/);
  });

  it('con PDF adjunto sube EL DEL CLIENTE, byte por byte, y no genera otro', async () => {
    const liq = await recibir({ pdf: { base64: Buffer.from(PDF_MIN).toString('base64') } });
    expect(liq.pdfOrigen).toBe('adjunto');
    expect(subidas[0].bytes).toBe(PDF_MIN.length);
  });

  it('un operador que no existe o está de baja rechaza ANTES de subir nada a Storage', async () => {
    const { DatoInvalido } = await import('../errores');
    operadorResuelto = new DatoInvalido('Ese operador está dado de baja');
    await expect(recibir()).rejects.toThrow(/baja/);
    expect(subidas).toHaveLength(0);
    expect(store.size).toBe(0);
  });

  it('si Storage falla NO se inserta la fila (no hay liquidaciones sin PDF)', async () => {
    vi.mocked(repo.subirPdfExterno).mockRejectedValueOnce(new Error('storage caído'));
    await expect(recibir()).rejects.toThrow(/storage/);
    expect(store.size).toBe(0);
  });

  it('el PDF generado lleva la razón social de la flota (el papel es de la flota)', async () => {
    const razon = vi.fn(async () => 'Flota SA');
    const d = cuerpo();
    await recibirLiquidacionExterna('t-1', d, huellaContenido(d), { ...deps, razonSocial: razon });
    expect(razon).toHaveBeenCalledWith('t-1');
  });
});

describe('intentarEntrega: la máquina de estados', () => {
  it('pendiente → en_cola cuando el puerto la encola', async () => {
    const liq = await recibir();
    expect(await intentarEntrega(liq, deps)).toBe('en_cola');
    const f = store.get(liq.id)!;
    expect(f.estado).toBe('en_cola');
    expect(f.via).toBe('sesion');
    expect(f.intentos).toBe(1);
    expect(eventos.map((e) => e.tipo)).toEqual(['recibida', 'encolada']);
  });

  it('le pasa al puerto lo necesario: teléfono, periodo, total, URL firmada y la generación', async () => {
    const liq = await recibir();
    await intentarEntrega(liq, deps);
    expect(llamadas[0]).toMatchObject({
      tenantId: 't-1', liquidacionId: liq.id, generacion: 1, telefono: '525512345678', nombre: 'Juan Pérez',
      desde: '2026-09-01', hasta: '2026-09-07', total: 100, moneda: 'MXN', pdfUrl: 'https://firmada.example/x.pdf',
    });
    expect(llamadas[0].pdfNombre).toMatch(/^liquidacion-SAP-1\.pdf$/);
  });

  it('en_cola → enviada con su wamid cuando el outbox ya la mandó', async () => {
    const liq = await recibir();
    await intentarEntrega(liq, deps);
    siguiente = { estado: 'enviada', via: 'sesion', wamid: 'wamid.X' };
    expect(await intentarEntrega({ ...store.get(liq.id)! }, deps)).toBe('enviada');
    const f = store.get(liq.id)!;
    expect(f).toMatchObject({ estado: 'enviada', wamid: 'wamid.X', enviadaEn: AHORA.toISOString() });
    expect(eventos.map((e) => e.tipo)).toEqual(['recibida', 'encolada', 'enviada']);
  });

  it('enviada directo desde pendiente (el outbox ya la tenía) también vale', async () => {
    const liq = await recibir();
    siguiente = { estado: 'enviada', via: 'plantilla', wamid: 'wamid.Y' };
    expect(await intentarEntrega(liq, deps)).toBe('enviada');
    expect(store.get(liq.id)).toMatchObject({ estado: 'enviada', via: 'plantilla' });
  });

  it('el cambio sesión → plantilla se registra como fallback y conserva en_cola', async () => {
    const liq = await recibir();
    await intentarEntrega(liq, deps);
    siguiente = { estado: 'en_cola', via: 'plantilla' };
    expect(await intentarEntrega({ ...store.get(liq.id)! }, deps)).toBe('en_cola');
    expect(store.get(liq.id)).toMatchObject({ estado: 'en_cola', via: 'plantilla' });
    expect(eventos.map((e) => e.tipo)).toContain('fallback_plantilla');
  });

  it('sin cambios (sigue en_cola por la misma vía) NO escribe ni deja eventos nuevos', async () => {
    const liq = await recibir();
    await intentarEntrega(liq, deps);
    const n = eventos.length;
    expect(await intentarEntrega({ ...store.get(liq.id)! }, deps)).toBe('sin_cambio');
    expect(eventos).toHaveLength(n);
  });

  it('falla definitiva del outbox → fallida con el error y su evento', async () => {
    const liq = await recibir();
    siguiente = { estado: 'fallida', via: 'sesion', error: 'terminal:HTTP 400 131030', reintentable: false };
    expect(await intentarEntrega(liq, deps)).toBe('fallida');
    expect(store.get(liq.id)).toMatchObject({ estado: 'fallida', ultimoError: 'terminal:HTTP 400 131030' });
    expect(eventos.at(-1)).toMatchObject({ tipo: 'fallida' });
  });

  it('un fallo transitorio de encolado se REINTENTA con backoff creciente (2, 4, 8… minutos)', async () => {
    const liq = await recibir();
    siguiente = { estado: 'fallida', via: 'sesion', error: 'outbox no respondió', reintentable: true };
    expect(await intentarEntrega(liq, deps)).toBe('reintentar');
    let f = store.get(liq.id)!;
    expect(f).toMatchObject({ estado: 'pendiente', intentos: 1 });
    expect(Date.parse(f.proximoIntentoEn) - AHORA.getTime()).toBe(2 * 60_000);
    await intentarEntrega({ ...f }, deps);
    f = store.get(liq.id)!;
    expect(f.intentos).toBe(2);
    expect(Date.parse(f.proximoIntentoEn) - AHORA.getTime()).toBe(4 * 60_000);
  });

  it(`tras ${MAX_INTENTOS_ENCOLADO} intentos fallidos queda FALLIDA a la vista (no se queda en un limbo pendiente)`, async () => {
    const liq = await recibir();
    siguiente = { estado: 'fallida', via: 'sesion', error: 'outbox no respondió', reintentable: true };
    let resultado = '';
    for (let i = 0; i < MAX_INTENTOS_ENCOLADO; i++) resultado = await intentarEntrega({ ...store.get(liq.id)! }, deps);
    expect(resultado).toBe('fallida');
    expect(store.get(liq.id)!.estado).toBe('fallida');
    expect(eventos.at(-1)!.tipo).toBe('fallida');
  });

  it('si no se puede firmar el PDF, no se manda un mensaje sin documento: se reintenta', async () => {
    const liq = await recibir();
    firmaFalla = true;
    expect(await intentarEntrega(liq, deps)).toBe('reintentar');
    expect(entrega.enviarConFallback).not.toHaveBeenCalled();
    expect(store.get(liq.id)).toMatchObject({ estado: 'pendiente', intentos: 1 });
    expect(store.get(liq.id)!.ultimoError).toMatch(/storage caído/);
  });

  it('si el puerto LANZA tampoco se pierde: reintento con el error guardado, y NUNCA lanza al llamador', async () => {
    const liq = await recibir();
    siguiente = new Error('outbox ilegible');
    await expect(intentarEntrega(liq, deps)).resolves.toBe('reintentar');
    expect(store.get(liq.id)!.ultimoError).toBe('outbox ilegible');
  });

  it('el fallo del puerto agotado a fallida', async () => {
    const liq = await recibir();
    siguiente = new Error('outbox ilegible');
    let r = '';
    for (let i = 0; i < MAX_INTENTOS_ENCOLADO; i++) r = await intentarEntrega({ ...store.get(liq.id)! }, deps);
    expect(r).toBe('fallida');
  });

  it('una liquidación ya acusada, enviada o fallida NO se toca ni se vuelve a mandar', async () => {
    const liq = await recibir();
    for (const estado of ['acusada', 'enviada', 'fallida'] as const) {
      expect(await intentarEntrega({ ...liq, estado }, deps), estado).toBe('sin_cambio');
    }
    expect(entrega.enviarConFallback).not.toHaveBeenCalled();
  });

  it('sin PDF en Storage o sin teléfono es un fallo NUESTRO que se reintenta, no un mensaje roto', async () => {
    const liq = await recibir();
    expect(await intentarEntrega({ ...liq, pdfRuta: null }, deps)).toBe('reintentar');
    store.get(liq.id)!.intentos = 0; store.get(liq.id)!.estado = 'pendiente';
    expect(await intentarEntrega({ ...liq, operadorTelefono: null }, deps)).toBe('reintentar');
    expect(entrega.enviarConFallback).not.toHaveBeenCalled();
  });

  it('CONCURRENCIA: el POST y el cron sobre la misma fila no se pisan (la transición es condicional)', async () => {
    const liq = await recibir();
    // El cron la leyó cuando seguía pendiente, y el POST ya la movió a enviada.
    const vistaDelCron = { ...liq };
    siguiente = { estado: 'enviada', via: 'sesion', wamid: 'wamid.POST' };
    await intentarEntrega(liq, deps);
    expect(store.get(liq.id)!.estado).toBe('enviada');
    // El cron, con su foto vieja, llega después y quiere encolar: no puede retroceder el estado.
    siguiente = { estado: 'en_cola', via: 'sesion' };
    await intentarEntrega(vistaDelCron, deps);
    expect(store.get(liq.id)).toMatchObject({ estado: 'enviada', wamid: 'wamid.POST' });
    expect(eventos.filter((e) => e.tipo === 'encolada')).toHaveLength(0);
  });

  it('CONCURRENCIA: una liquidación que el chofer acusó mientras el cron trabajaba NO retrocede', async () => {
    const liq = await recibir();
    const foto = { ...liq };
    await registrarAcuse('t-1', 'op-1', liq.id, 'recibida', deps);
    siguiente = { estado: 'enviada', via: 'sesion', wamid: 'wamid.Z' };
    await intentarEntrega(foto, deps);
    expect(store.get(liq.id)!.estado).toBe('acusada');
  });
});

describe('el cron: procesarLiquidacionesExternas', () => {
  it('toma lo pendiente listo y lo en_cola, y cuenta lo que pasó', async () => {
    const a = await recibir({ claveExterna: 'A-1' });
    const b = await recibir({ claveExterna: 'B-1' });
    siguiente = { estado: 'enviada', via: 'sesion', wamid: 'w' };
    const r = await procesarLiquidacionesExternas(deps, 10);
    expect(r).toMatchObject({ tomadas: 2, enviadas: 2 });
    expect(store.get(a.id)!.estado).toBe('enviada');
    expect(store.get(b.id)!.estado).toBe('enviada');
  });

  it('NO toma pendientes cuyo reintento todavía no toca (backoff respetado)', async () => {
    const liq = await recibir();
    store.get(liq.id)!.proximoIntentoEn = new Date(AHORA.getTime() + 60_000).toISOString();
    const r = await procesarLiquidacionesExternas(deps, 10);
    expect(r.tomadas).toBe(0);
    expect(entrega.enviarConFallback).not.toHaveBeenCalled();
  });

  it('una fila que truena no detiene a las demás', async () => {
    const mala = await recibir({ claveExterna: 'MALA' });
    await recibir({ claveExterna: 'BUENA' });
    vi.mocked(entrega.enviarConFallback).mockImplementationOnce(async () => { throw new Error('solo esta'); });
    const r = await procesarLiquidacionesExternas(deps, 10);
    expect(r.tomadas).toBe(2);
    expect(r.reintentar).toBe(1);
    expect(r.en_cola).toBe(1);
    expect(store.get(mala.id)!.estado).toBe('pendiente');
  });

  it('respeta el tamaño del lote', async () => {
    for (let i = 0; i < 5; i++) await recibir({ claveExterna: `L-${i}` });
    const r = await procesarLiquidacionesExternas(deps, 3);
    expect(r.tomadas).toBe(3);
  });

  it('con la cola vacía no hace nada ni lanza', async () => {
    expect(await procesarLiquidacionesExternas(deps, 10)).toEqual({ tomadas: 0, en_cola: 0, enviadas: 0, reintentar: 0, fallidas: 0, sin_cambio: 0 });
  });

  it('IDEMPOTENTE: pasar el cron dos veces no manda dos veces lo ya encolado', async () => {
    await recibir();
    await procesarLiquidacionesExternas(deps, 10);
    const antes = eventos.filter((e) => e.tipo === 'encolada').length;
    await procesarLiquidacionesExternas(deps, 10);
    expect(eventos.filter((e) => e.tipo === 'encolada')).toHaveLength(antes);
  });
});

describe('reintentar a mano', () => {
  const fallar = async () => {
    const liq = await recibir();
    siguiente = { estado: 'fallida', via: 'sesion', error: 'terminal:131030', reintentable: false };
    await intentarEntrega(liq, deps);
    return liq;
  };

  it('solo aplica a una FALLIDA: sube la generación, la vuelve pendiente y la intenta de nuevo', async () => {
    const liq = await fallar();
    siguiente = { estado: 'en_cola', via: 'sesion' };
    expect(await reintentarLiquidacionExterna('t-1', liq.id, 'ana@flota.mx', deps)).toBe('reintentada');
    const f = store.get(liq.id)!;
    expect(f.generacion).toBe(2);
    expect(f.estado).toBe('en_cola');
    expect(f.ultimoError).toBeNull();
    expect(llamadas.at(-1)!.generacion).toBe(2);
    expect(eventos.find((e) => e.tipo === 'reintento_manual')!.detalle).toMatchObject({ actor: 'ana@flota.mx', generacion: 2 });
  });

  it('una que SÍ salió no se reintenta: sería mandarle dos veces el mismo pago al chofer', async () => {
    const liq = await recibir();
    for (const estado of ['pendiente', 'en_cola', 'enviada', 'acusada'] as const) {
      store.get(liq.id)!.estado = estado;
      expect(await reintentarLiquidacionExterna('t-1', liq.id, 'x', deps), estado).toBe('no_aplica');
    }
    expect(store.get(liq.id)!.generacion).toBe(1);
  });

  it('un id inexistente o de OTRA flota es no_encontrada', async () => {
    const liq = await fallar();
    expect(await reintentarLiquidacionExterna('t-1', 'no-existe', 'x', deps)).toBe('no_encontrada');
    expect(await reintentarLiquidacionExterna('t-OTRA', liq.id, 'x', deps)).toBe('no_encontrada');
    expect(store.get(liq.id)!.estado).toBe('fallida');
  });

  it('doble clic: dos reintentos seguidos solo aplican UNO', async () => {
    const liq = await fallar();
    siguiente = { estado: 'en_cola', via: 'sesion' };
    const [a, b] = await Promise.all([
      reintentarLiquidacionExterna('t-1', liq.id, 'x', deps),
      reintentarLiquidacionExterna('t-1', liq.id, 'x', deps),
    ]);
    expect([a, b].sort()).toEqual(['no_aplica', 'reintentada']);
    expect(store.get(liq.id)!.generacion).toBe(2);
  });
});

describe('el acuse del chofer', () => {
  it('«Recibida» deja la liquidación acusada con tipo y hora, desde cualquier estado de entrega', async () => {
    for (const estado of ['pendiente', 'en_cola', 'enviada', 'fallida'] as const) {
      const liq = await recibir({ claveExterna: `ACK-${estado}` });
      store.get(liq.id)!.estado = estado;
      expect(await registrarAcuse('t-1', 'op-1', liq.id, 'recibida', deps), estado).toBe('registrado');
      expect(store.get(liq.id)).toMatchObject({ estado: 'acusada', acuseTipo: 'recibida', acuseEn: AHORA.toISOString() });
    }
  });

  it('un chofer NO puede acusar la liquidación de otro: se contesta no_encontrada (no se revela de quién es)', async () => {
    const liq = await recibir();
    expect(await registrarAcuse('t-1', 'op-OTRO', liq.id, 'recibida', deps)).toBe('no_encontrada');
    expect(store.get(liq.id)!.estado).toBe('pendiente');
  });

  it('un id de OTRA flota tampoco', async () => {
    const liq = await recibir();
    expect(await registrarAcuse('t-OTRA', 'op-1', liq.id, 'no_coincide', deps)).toBe('no_encontrada');
  });

  it('un id inexistente es no_encontrada', async () => {
    expect(await registrarAcuse('t-1', 'op-1', 'fantasma', 'recibida', deps)).toBe('no_encontrada');
  });

  it('IDEMPOTENTE: apretar dos veces el mismo botón no duplica el evento', async () => {
    const liq = await recibir();
    expect(await registrarAcuse('t-1', 'op-1', liq.id, 'recibida', deps)).toBe('registrado');
    expect(await registrarAcuse('t-1', 'op-1', liq.id, 'recibida', deps)).toBe('ya_registrado');
    expect(eventos.filter((e) => e.tipo === 'acuse_recibida')).toHaveLength(1);
  });

  it('cambiar de opinión (recibida → no coincide) se acepta y deja AMBOS eventos en la bitácora', async () => {
    const liq = await recibir();
    await registrarAcuse('t-1', 'op-1', liq.id, 'recibida', deps);
    expect(await registrarAcuse('t-1', 'op-1', liq.id, 'no_coincide', deps)).toBe('registrado');
    expect(store.get(liq.id)!.acuseTipo).toBe('no_coincide');
    expect(eventos.map((e) => e.tipo)).toEqual(expect.arrayContaining(['acuse_recibida', 'acuse_no_coincide']));
  });

  it('el acuse NO se confunde con la entrega: una acusada que el cron vuelve a ver no cambia', async () => {
    const liq = await recibir();
    await registrarAcuse('t-1', 'op-1', liq.id, 'no_coincide', deps);
    expect(await intentarEntrega({ ...store.get(liq.id)! }, deps)).toBe('sin_cambio');
    expect(store.get(liq.id)).toMatchObject({ estado: 'acusada', acuseTipo: 'no_coincide' });
  });
});

describe('el repo se llama con el tenant de la flota, siempre', () => {
  it('toda escritura de estado lleva el tenant de la liquidación', async () => {
    const liq = await recibir();
    await intentarEntrega(liq, deps);
    for (const c of vi.mocked(repo.transicionar).mock.calls) expect(c[0]).toBe('t-1');
  });
});
