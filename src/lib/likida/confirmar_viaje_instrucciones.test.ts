import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// HALLAZGO: aceptar el viaje por TEXTO (`atenderConfirmacion` → `decidirInicio`
// 'confirmado') o por FOTO (`aceptarPorActividad`, "mandar un comprobante ES
// aceptar") escribía el mismo `aceptado_en` que aceptar por BOTÓN, pero SOLO
// el botón (`responderAsignacion`, rama 'acepto') disparaba `armarInstrucciones`
// (caja, cita, rutas) y `preguntarGastosAlAceptar`. Con la perilla
// `asignacionBotonesActiva` encendida, un chofer que ignoraba el botón y
// escribía "sí" (o mandaba su primer ticket) quedaba con el viaje aceptado y
// SIN instrucciones ni pregunta de gastos — en silencio.
//
// Estas pruebas fijan que los dos caminos de texto/foto ahora manden lo mismo
// que el botón, con el mismo guardia contra el doble envío (la segunda
// aceptación del mismo viaje no reenvía nada) y el mismo apagado cuando la
// flota no tiene la perilla (el comportamiento de siempre).
// ═══════════════════════════════════════════════════════════════════════════

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

interface Escritura { valores: Record<string, unknown>; filtros: Array<[string, unknown]> }

const escrituras: Escritura[] = [];
/** Lo que devuelve el SELECT de `viajesPorConfirmar` (solo lo usa `atenderConfirmacion`). */
let LISTA: { data: unknown; error: { message: string } | null } = {
  data: [{ id: 'v-1', folio: 'F-1', origen: 'GDL', destino: 'MTY' }],
  error: null,
};
/** Lo que devuelve el UPDATE de `marcarAceptado`...select('id'). */
let RESULTADO_UPDATE: { data: unknown; error: { message: string } | null } = { data: [{ id: 'v-1' }], error: null };

function nodoLectura() {
  const nodo: Record<string, unknown> = {};
  const paso = () => nodo;
  nodo.eq = paso; nodo.is = paso; nodo.not = paso; nodo.order = paso; nodo.in = paso;
  nodo.limit = () => Promise.resolve(LISTA);
  return nodo;
}

function nodoUpdate(valores: Record<string, unknown>) {
  const filtros: Array<[string, unknown]> = [];
  const nodo: Record<string, unknown> = {};
  nodo.eq = (c: string, v: unknown) => { filtros.push([c, v]); return nodo; };
  nodo.is = (c: string, v: unknown) => { filtros.push([c, v]); return nodo; };
  nodo.select = () => {
    escrituras.push({ valores, filtros });
    return Promise.resolve(RESULTADO_UPDATE);
  };
  return nodo;
}

// `marcarAceptado` (dentro de confirmar_viaje.ts) escribe con `supabaseAdmin()` directo; el resto de
// `enviarInstruccionesSiBotonesActivo` (config, viaje, envío, convenio, gastos) pasa por los módulos de abajo,
// que se controlan aparte — así esta prueba no depende de replicar el esquema real de esas tablas.
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => nodoLectura(),
      update: (valores: Record<string, unknown>) => nodoUpdate(valores),
    }),
  }),
}));

let CONFIG: { asignacionBotonesActiva: boolean; patioQueManda: 'entregar_en' | 'destino'; gastosEtcActiva: boolean };
let VIAJE: Record<string, unknown> | null;

vi.mock('./conductor/repo', async (importOriginal) => {
  const real = await importOriginal<typeof import('./conductor/repo')>();
  return {
    ...real,
    leerConfigConductor: vi.fn(async () => CONFIG),
    cargarViajeContexto: vi.fn(async () => VIAJE),
  };
});

const enviados: Array<{ tel: string; texto: string; contexto: string }> = [];
const convenios: string[] = [];

vi.mock('./conductor/asignacion', async (importOriginal) => {
  const real = await importOriginal<typeof import('./conductor/asignacion')>();
  return {
    ...real,
    puertosAsignacionReales: () => ({
      aceptar: vi.fn(),
      reclamar: vi.fn(),
      cerrarAviso: vi.fn(),
      destinatarios: vi.fn(async () => []),
      datos: vi.fn(async () => ({ caja: 'CJ-5521', rutaCarga: null, rutaPatio: null })),
      enviar: vi.fn(async (tel: string, m: { texto: string }, contexto: string) => {
        enviados.push({ tel, texto: m.texto, contexto });
        return { ok: true, via: 'texto', id: 'wa-1', motivo: 'ventana_abierta', ventana: 'abierta' };
      }),
      convenio: vi.fn(async (_t: string, viajeId: string) => { convenios.push(viajeId); }),
    }),
  };
});

const gastosLlamadas: string[] = [];

vi.mock('./conductor/gastos_etc', async (importOriginal) => {
  const real = await importOriginal<typeof import('./conductor/gastos_etc')>();
  return {
    ...real,
    preguntarGastosAlAceptar: vi.fn(async (_enviar, config: { gastosEtcActiva?: boolean }, v: { id: string }) => {
      if (config.gastosEtcActiva === true) gastosLlamadas.push(v.id);
      return config.gastosEtcActiva === true;
    }),
  };
});

const { atenderConfirmacion, aceptarPorActividad } = await import('./confirmar_viaje');

beforeEach(() => {
  escrituras.length = 0;
  enviados.length = 0;
  convenios.length = 0;
  gastosLlamadas.length = 0;
  LISTA = { data: [{ id: 'v-1', folio: 'F-1', origen: 'GDL', destino: 'MTY' }], error: null };
  RESULTADO_UPDATE = { data: [{ id: 'v-1' }], error: null };
  CONFIG = { asignacionBotonesActiva: true, patioQueManda: 'entregar_en', gastosEtcActiva: true };
  VIAJE = {
    id: 'v-1', tenantId: 't-1', folio: 'F-1', origen: 'GDL', destino: 'MTY', estatus: 'abierto',
    operadorId: 'op-9', operadorNombre: 'Juan', operadorTelefono: '5219990000001',
    terminalId: null, unidadId: null, aceptadoEn: null, aceptadoOrigen: null,
    citaOrigenEn: null, citaDestinoEn: null, etaOrigenEn: null, etaDestinoEn: null,
  };
  logger.info.mockReset(); logger.warn.mockReset(); logger.error.mockReset();
});

describe('aceptar por TEXTO con la perilla de botones encendida', () => {
  it('"sí" (decidirInicio → confirmado) manda las instrucciones Y la pregunta de gastos, igual que el botón', async () => {
    const r = await atenderConfirmacion({ tenantId: 't-1', operadorId: 'op-9', texto: 'sí' });

    expect(r.viajeConfirmado).toBe('v-1');
    expect(r.estado).toBe('confirmado');
    expect(enviados).toHaveLength(1);
    expect(enviados[0].contexto).toBe('conductor.asignacion_instrucciones');
    expect(enviados[0].texto).toContain('Confirmado el viaje F-1');
    expect(enviados[0].texto).toContain('Caja: CJ-5521');
    expect(convenios).toEqual(['v-1']);
    expect(gastosLlamadas).toEqual(['v-1']);
  });

  it('un segundo "sí" del mismo viaje (ya aceptado) NO reenvía instrucciones', async () => {
    // Es lo que devuelve el UPDATE cuando `aceptado_en` ya no es null: 0 filas.
    RESULTADO_UPDATE = { data: [], error: null };

    await atenderConfirmacion({ tenantId: 't-1', operadorId: 'op-9', texto: 'sí' });

    expect(enviados).toEqual([]);
    expect(convenios).toEqual([]);
    expect(gastosLlamadas).toEqual([]);
  });

  it('sin la perilla `asignacionBotonesActiva`, no manda nada (el comportamiento de siempre)', async () => {
    CONFIG = { ...CONFIG, asignacionBotonesActiva: false };

    const r = await atenderConfirmacion({ tenantId: 't-1', operadorId: 'op-9', texto: 'sí' });

    expect(r.viajeConfirmado).toBe('v-1'); // el viaje SÍ se acepta
    expect(enviados).toEqual([]);          // pero no se inventa una instrucción para una flota que no la pidió
    expect(convenios).toEqual([]);
    expect(gastosLlamadas).toEqual([]);
  });
});

describe('aceptar por FOTO (aceptarPorActividad) con la perilla de botones encendida', () => {
  it('el primer comprobante manda las instrucciones Y la pregunta de gastos, igual que el botón', async () => {
    await aceptarPorActividad('t-1', 'v-1', 'op-9');

    expect(enviados).toHaveLength(1);
    expect(enviados[0].tel).toBe('5219990000001');
    expect(enviados[0].contexto).toBe('conductor.asignacion_instrucciones');
    expect(convenios).toEqual(['v-1']);
    expect(gastosLlamadas).toEqual(['v-1']);
  });

  it('un segundo ticket del mismo viaje (ya aceptado) NO reenvía instrucciones', async () => {
    RESULTADO_UPDATE = { data: [], error: null };

    await aceptarPorActividad('t-1', 'v-1', 'op-9');

    expect(enviados).toEqual([]);
    expect(convenios).toEqual([]);
  });

  it('sin la perilla, no manda nada', async () => {
    CONFIG = { ...CONFIG, asignacionBotonesActiva: false };

    await aceptarPorActividad('t-1', 'v-1', 'op-9');

    expect(enviados).toEqual([]);
  });

  it('si no se pudo leer el teléfono del operador, no truena: solo se queda sin mandar', async () => {
    VIAJE = { ...VIAJE, operadorTelefono: null };

    await expect(aceptarPorActividad('t-1', 'v-1', 'op-9')).resolves.toBeUndefined();

    expect(enviados).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('viaje.instrucciones_fuera_de_boton_sin_telefono', expect.anything());
  });
});
