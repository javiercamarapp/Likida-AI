import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// `avisarAlChofer` ERA SILENCIOSA POR PARTIDA DOBLE.
//
// Sus dos lecturas desestructuraban solo `data`, así que un fallo de Supabase
// se volvía `op = null` → `!op?.telefono` → `return` limpio: el aviso no salía
// Y no quedaba una línea de log. Y como `avisado_en` es lo ÚNICO que hace
// visible el viaje para la escalación de las 5 h (`viajesSinAceptar` filtra por
// él), ese viaje no escalaba nunca. Nadie le dijo al chofer y nadie se iba a
// enterar.
//
// La segunda lectura además era asimétrica dentro de su propio `Promise.all`:
// la de `operador` acotaba por `tenant_id` y la de `viaje` no.
// ═══════════════════════════════════════════════════════════════════════════

/** Respuesta por tabla; `undefined` = fila normal. */
let RESPUESTAS: Record<string, { data: unknown; error: { message: string } | null }> = {};
/** Filtros que recibió cada lectura, por tabla. */
let FILTROS: Record<string, Array<[string, unknown]>> = {};
const actualizado: Array<{ tabla: string; valores: unknown; filtros: Array<[string, unknown]> }> = [];

const notificarAsignacion = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

interface Nodo {
  eq: (c: string, v: unknown) => Nodo;
  is: () => Nodo;
  maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
}

function nodoLectura(tabla: string): Nodo {
  const nodo: Nodo = {
    eq: (c: string, v: unknown) => { (FILTROS[tabla] ??= []).push([c, v]); return nodo; },
    is: () => nodo,
    maybeSingle: () => Promise.resolve(RESPUESTAS[tabla] ?? { data: null, error: null }),
  };
  return nodo;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => ({
      select: () => nodoLectura(tabla),
      update: (valores: unknown) => {
        const filtros: Array<[string, unknown]> = [];
        const nodo: Record<string, unknown> = {};
        nodo.eq = (c: string, v: unknown) => { filtros.push([c, v]); return nodo; };
        nodo.is = (c: string, v: unknown) => { filtros.push([c, v]); return nodo; };
        nodo.then = (r: (v: unknown) => unknown) => {
          actualizado.push({ tabla, valores, filtros });
          return Promise.resolve({ error: null }).then(r);
        };
        return nodo;
      },
    }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('./notificar', () => ({ notificarAsignacion }));

const { avisarAlChofer } = await import('./operacion');

const VIAJE_OK = { data: { folio: 'VJ-9', origen: 'GDL', destino: 'MTY', fecha_inicio: null, anticipo: 5000, unidad_id: null }, error: null };
const OPERADOR_OK = { data: { telefono: '+5219993700779' }, error: null };

beforeEach(() => {
  RESPUESTAS = {}; FILTROS = {}; actualizado.length = 0;
  notificarAsignacion.mockReset();
  notificarAsignacion.mockResolvedValue({ enviado: true });
  for (const f of Object.values(logger)) f.mockReset();
});

describe('avisarAlChofer — un fallo de lectura ya no se lee como "no hay chofer"', () => {
  it('con la lectura del OPERADOR caída, lanza y lo deja en el log — no se traga el aviso', async () => {
    RESPUESTAS.operador = { data: null, error: { message: '57014 statement timeout' } };
    RESPUESTAS.viaje = VIAJE_OK;
    await expect(avisarAlChofer('t-1', 'o-1', 'v-1')).rejects.toThrow(/57014/);
    expect(notificarAsignacion).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('viaje.aviso_no_se_pudo_leer',
      expect.objectContaining({ viajeId: 'v-1', escalaSolo: false }));
  });

  it('con la lectura del VIAJE caída, igual — y sin marcar `avisado_en`', async () => {
    RESPUESTAS.operador = OPERADOR_OK;
    RESPUESTAS.viaje = { data: null, error: { message: 'fetch failed' } };
    await expect(avisarAlChofer('t-1', 'o-1', 'v-1')).rejects.toThrow(/fetch failed/);
    // Marcarlo sería sacar el viaje de la escalación de 5 h sin haber avisado.
    expect(actualizado).toEqual([]);
  });

  it('sin teléfono capturado NO lanza (es un dato, no un fallo) pero tampoco pasa sin rastro', async () => {
    RESPUESTAS.operador = { data: { telefono: null }, error: null };
    RESPUESTAS.viaje = VIAJE_OK;
    await expect(avisarAlChofer('t-1', 'o-1', 'v-1')).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('viaje.aviso_sin_destinatario',
      expect.objectContaining({ viajeId: 'v-1', escalaSolo: false }));
  });

  it('si no se puede leer la UNIDAD, no manda un aviso que la omite', async () => {
    // `unidad = null` imprime "sin unidad asignada", y aquí se sabe que sí trae
    // una porque `viaje.unidad_id` no es null. Ese mensaje marcaría `avisado_en`
    // —el viaje deja de escalar— con un chofer que no sabe qué camión sacar.
    RESPUESTAS.operador = OPERADOR_OK;
    RESPUESTAS.viaje = { data: { ...VIAJE_OK.data, unidad_id: 'u-1' }, error: null };
    RESPUESTAS.unidad = { data: null, error: { message: 'boom' } };
    await expect(avisarAlChofer('t-1', 'o-1', 'v-1')).rejects.toThrow(/boom/);
    expect(notificarAsignacion).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('viaje.aviso_unidad_ilegible', expect.objectContaining({ viajeId: 'v-1' }));
  });

  it('control: con todo en orden avisa y marca `avisado_en`', async () => {
    RESPUESTAS.operador = OPERADOR_OK;
    RESPUESTAS.viaje = VIAJE_OK;
    await avisarAlChofer('t-1', 'o-1', 'v-1');
    expect(notificarAsignacion).toHaveBeenCalledWith(expect.objectContaining({ telefono: '+5219993700779', tenantId: 't-1' }));
    expect(actualizado).toHaveLength(1);
    expect(actualizado[0].valores).toMatchObject({ avisos_enviados: 1 });
  });
});

describe('avisarAlChofer — aislamiento entre flotas', () => {
  it('la lectura del VIAJE acota por tenant, igual que la del operador de al lado', async () => {
    // Estaban en el mismo `Promise.all` y solo una filtraba. Con un `viajeId` de
    // otra flota, al chofer de A le llegaba el anticipo de un viaje de B.
    RESPUESTAS.operador = OPERADOR_OK;
    RESPUESTAS.viaje = VIAJE_OK;
    await avisarAlChofer('t-1', 'o-1', 'v-1');
    expect(FILTROS.viaje).toContainEqual(['tenant_id', 't-1']);
    expect(FILTROS.operador).toContainEqual(['tenant_id', 't-1']);
  });

  it('la lectura de la UNIDAD también', async () => {
    RESPUESTAS.operador = OPERADOR_OK;
    RESPUESTAS.viaje = { data: { ...VIAJE_OK.data, unidad_id: 'u-1' }, error: null };
    RESPUESTAS.unidad = { data: { numero_economico: 'C2-08' }, error: null };
    await avisarAlChofer('t-1', 'o-1', 'v-1');
    expect(FILTROS.unidad).toContainEqual(['tenant_id', 't-1']);
  });

  it('el `update` de `avisado_en` lleva el tenant en el where', async () => {
    RESPUESTAS.operador = OPERADOR_OK;
    RESPUESTAS.viaje = VIAJE_OK;
    await avisarAlChofer('t-1', 'o-1', 'v-1');
    expect(actualizado[0].filtros).toContainEqual(['tenant_id', 't-1']);
  });
});
