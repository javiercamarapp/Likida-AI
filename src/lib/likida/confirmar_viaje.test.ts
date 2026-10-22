import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// `marcarAceptado` ESCRIBÍA CON `supabaseAdmin()` ACOTANDO SOLO POR FLOTA.
//
// El UPDATE salta RLS (service role) y filtraba por `(id, tenant_id)`. A su
// único llamador —el webhook— le bastaba: ahí el viaje lo eligió
// `viajesPorConfirmar` a partir del TELÉFONO de quien escribió, así que el
// uuid nunca vino de fuera. Pero la función quedaba lista para el error caro:
// el día que un formulario web mande el `viajeId`, un chofer marcaría como
// aceptado el viaje de un COMPAÑERO de su misma flota cambiando un uuid — y
// la escalación de las 5 h (0058) dejaría de avisarle al jefe que ese otro
// nunca contestó. Es el patrón que este repo ya documentó como el fallo más
// común del código escrito por agentes: acotar el tenant y olvidar a quién.
//
// Estas pruebas fijan las tres cosas: que el filtro por operador llegue al
// UPDATE, que un llamador de dos argumentos siga funcionando (processor.ts no
// se toca), y que `undefined` NO se traduzca a un `.eq('operador_id',
// undefined)` — que no filtraría menos, filtraría mal.
// ═══════════════════════════════════════════════════════════════════════════

interface Escritura { valores: Record<string, unknown>; filtros: Array<[string, unknown]> }

const escrituras: Escritura[] = [];
/** Lo que devuelve el SELECT de `viajesPorConfirmar`. */
let LISTA: { data: unknown; error: { message: string } | null } = { data: [], error: null };
/** Lo que devuelve el UPDATE...select('id'). */
let RESULTADO_UPDATE: { data: unknown; error: { message: string } | null } = { data: [{ id: 'v-1' }], error: null };

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

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
  // `marcarRechazados` acota con `.in('id', ...)` (puede marcar varios viajes
  // de un golpe cuando el chofer "niega" los que se le enseñaron).
  nodo.in = (c: string, v: unknown) => { filtros.push([c, v]); return nodo; };
  nodo.select = () => {
    escrituras.push({ valores, filtros });
    return Promise.resolve(RESULTADO_UPDATE);
  };
  return nodo;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => nodoLectura(),
      update: (valores: Record<string, unknown>) => nodoUpdate(valores),
    }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger }));

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA A8 ESCALACIÓN (hallazgo confirmado): el jefe tiene que enterarse
// de inmediato cuando el chofer SÍ confirma (para no reasignar un viaje que
// ya va en curso) y cuando dice EXPLÍCITAMENTE que NO (para reasignar sin
// esperar las 5 h del reloj de A8). Se simula el mismo canal que usa el resto
// del repo para avisos hacia la oficina (`avisarOficina`, `./contactos`), no
// la cadena completa de `enviar_con_fallback.ts` (esa tiene sus propias
// pruebas) — aquí se prueba el CONTRATO de `atenderConfirmacion`: a quién se
// avisa, con qué texto y solo la primera vez.
// ═══════════════════════════════════════════════════════════════════════════
const telefonoJefeDe = vi.hoisted(() => vi.fn(async (): Promise<string | null> => '5210000000001'));
const llamadasAvisoOficina = vi.hoisted(() => [] as Array<{
  telefono: string; texto: string; parametros: [string, string, string]; contexto?: Record<string, unknown>;
}>);
const avisarOficina = vi.hoisted(() => vi.fn(async (
  telefono: string, texto: string, o: { parametros: [string, string, string]; contexto?: Record<string, unknown> },
) => {
  llamadasAvisoOficina.push({ telefono, texto, parametros: o.parametros, contexto: o.contexto });
  return { ok: true, via: 'texto', id: 'wamid.TEST' };
}));
const cargarViajeContexto = vi.hoisted(() => vi.fn(async (): Promise<{ operadorNombre: string | null; folio: string | null } | null> => null));

vi.mock('./contactos', () => ({ telefonoJefeDe }));
vi.mock('@/lib/meta/aviso_oficina', () => ({
  parametrosAvisoOficina: (a: string, b: string, c: string) => [a, b, c] as [string, string, string],
  avisarOficina,
}));
// Solo `cargarViajeContexto` se sustituye; `leerConfigConductor` (usado por
// `enviarInstruccionesSiBotonesActivo`, fuera del alcance de esta tarea) sigue
// siendo el real — como ya corría ANTES de este cambio, contra el mock crudo
// de arriba, sin romper ninguna prueba existente.
vi.mock('./conductor/repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./conductor/repo')>();
  return { ...actual, cargarViajeContexto };
});

const { marcarAceptado, marcarRechazados, aceptarPorActividad, atenderConfirmacion } = await import('./confirmar_viaje');

/** Los nombres de columna por los que se acotó el UPDATE. */
const columnas = (e: Escritura) => e.filtros.map(([c]) => c);

beforeEach(() => {
  escrituras.length = 0;
  LISTA = { data: [], error: null };
  RESULTADO_UPDATE = { data: [{ id: 'v-1' }], error: null };
  logger.info.mockReset(); logger.warn.mockReset(); logger.error.mockReset();
  telefonoJefeDe.mockReset(); telefonoJefeDe.mockResolvedValue('5210000000001');
  avisarOficina.mockClear();
  llamadasAvisoOficina.length = 0;
  cargarViajeContexto.mockReset();
  cargarViajeContexto.mockResolvedValue(null);
});

describe('marcarAceptado · el UPDATE se acota también por chofer', () => {
  it('con operadorId, el filtro por operador VIAJA al UPDATE', async () => {
    await marcarAceptado('t-1', 'v-1', 'op-9');

    expect(escrituras).toHaveLength(1);
    expect(escrituras[0].filtros).toContainEqual(['operador_id', 'op-9']);
    // Y sin perder los que ya tenía.
    expect(escrituras[0].filtros).toContainEqual(['id', 'v-1']);
    expect(escrituras[0].filtros).toContainEqual(['tenant_id', 't-1']);
  });

  it('EL VIAJE DE UN COMPAÑERO NO SE MARCA: la base no encuentra fila y contesta false', async () => {
    // Es lo que devuelve Postgres cuando el uuid existe en la flota pero es de
    // otro chofer: el `.eq('operador_id')` no casa, 0 filas actualizadas.
    RESULTADO_UPDATE = { data: [], error: null };
    await expect(marcarAceptado('t-1', 'viaje-del-compañero', 'op-9')).resolves.toBe(false);
    expect(escrituras[0].filtros).toContainEqual(['operador_id', 'op-9']);
  });

  it('sin operadorId (llamador de dos argumentos) NO se cuela un .eq contra undefined', async () => {
    // Un `.eq('operador_id', undefined)` no es "sin filtro": PostgREST lo
    // serializa a `operador_id=eq.undefined` y el UPDATE deja de casar con
    // NADA, así que el webhook dejaría de registrar aceptaciones en silencio.
    await marcarAceptado('t-1', 'v-1');

    expect(columnas(escrituras[0])).not.toContain('operador_id');
    expect(escrituras[0].filtros).toContainEqual(['id', 'v-1']);
    expect(escrituras[0].filtros).toContainEqual(['tenant_id', 't-1']);
  });

  it('el guardia contra el doble mensaje sigue puesto', () => {
    // Dos mensajes seguidos ("va" y luego una foto) son dos invocaciones del
    // webhook; sin `is('aceptado_en', null)` la segunda reescribiría la hora
    // que mide cuánto tardó en contestar.
    return marcarAceptado('t-1', 'v-1', 'op-9').then(() => {
      expect(escrituras[0].filtros).toContainEqual(['aceptado_en', null]);
      expect(Object.keys(escrituras[0].valores)).toEqual(['aceptado_en']);
    });
  });
});

describe('los dos caminos internos', () => {
  it('atenderConfirmacion pasa el operador de sus args al UPDATE', async () => {
    LISTA = { data: [{ id: 'v-7', folio: 'VJ-7', origen: 'GDL', destino: 'MTY' }], error: null };
    RESULTADO_UPDATE = { data: [{ id: 'v-7' }], error: null };

    const r = await atenderConfirmacion({ tenantId: 't-1', operadorId: 'op-9', texto: 'va' });

    expect(r.viajeConfirmado).toBe('v-7');
    expect(escrituras).toHaveLength(1);
    expect(escrituras[0].filtros).toContainEqual(['operador_id', 'op-9']);
  });

  it('aceptarPorActividad reenvía el operador cuando se lo dan', async () => {
    await aceptarPorActividad('t-1', 'v-1', 'op-9');
    expect(escrituras[0].filtros).toContainEqual(['operador_id', 'op-9']);
  });

  it('aceptarPorActividad con dos argumentos (como lo llama processor.ts) sigue funcionando', async () => {
    // Es el contrato que no se puede romper: `processor.ts:827` llama
    // `aceptarPorActividad(op.tenantId, viajeId)`. Ahí el viaje sale de
    // `getOpenViaje(tenantId, operadorId)`, no de la red.
    await expect(aceptarPorActividad('t-1', 'v-1')).resolves.toBeUndefined();
    expect(escrituras).toHaveLength(1);
    expect(columnas(escrituras[0])).not.toContain('operador_id');
  });

  it('sigue siendo silenciosa: un error de la base no tumba el acuse del comprobante', async () => {
    RESULTADO_UPDATE = { data: null, error: { message: 'boom' } };
    await expect(aceptarPorActividad('t-1', 'v-1', 'op-9')).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA A8 ESCALACIÓN (hallazgo confirmado, dos ángulos del mismo hueco).
// `armarRecordatorioChofer` (escalar_viaje.ts) le promete al chofer: "con
// cualquiera de las dos [sí o no] le aviso a tu encargado." Hasta este
// cambio, NINGÚN código cumplía la promesa en ninguno de los dos casos.
// ═══════════════════════════════════════════════════════════════════════════

describe('A8 ESCALACIÓN · caso "SÍ" — el jefe recibe un aviso de confirmación', () => {
  it('tras aceptar por PRIMERA vez, se avisa al jefe que el chofer YA confirmó', async () => {
    LISTA = { data: [{ id: 'v-7', folio: 'VJ-7', origen: 'GDL', destino: 'MTY' }], error: null };
    RESULTADO_UPDATE = { data: [{ id: 'v-7' }], error: null };
    cargarViajeContexto.mockResolvedValue({ operadorNombre: 'Juan Pérez', folio: 'VJ-7' });

    const r = await atenderConfirmacion({ tenantId: 't-1', operadorId: 'op-9', texto: 'va' });

    expect(r.viajeConfirmado).toBe('v-7');
    expect(telefonoJefeDe).toHaveBeenCalledWith('t-1');
    expect(avisarOficina).toHaveBeenCalledTimes(1);
    expect(llamadasAvisoOficina[0].telefono).toBe('5210000000001');
    // El jefe se queda, HASTA HOY, con "no ha confirmado, conviene
    // reasignarlo" (armarAvisoJefe, escalar_viaje.ts) sin que nadie le diga
    // que SÍ confirmó: el riesgo real es que reasigne un viaje en curso.
    expect(llamadasAvisoOficina[0].texto).toContain('Juan Pérez');
    expect(llamadasAvisoOficina[0].texto).toMatch(/confirmó/i);
    // No repite el "conviene reasignarlo" de `armarAvisoJefe` (escalar_viaje.ts):
    // es el aviso CONTRARIO, el que evita que lo haga.
    expect(llamadasAvisoOficina[0].texto).not.toMatch(/conviene/i);
  });

  it('si el viaje YA estaba aceptado (no es la primera vez), NO se avisa de nuevo al jefe', async () => {
    LISTA = { data: [{ id: 'v-7', folio: 'VJ-7' }], error: null };
    RESULTADO_UPDATE = { data: [], error: null }; // marcarAceptado: 0 filas, ya estaba aceptado

    await atenderConfirmacion({ tenantId: 't-1', operadorId: 'op-9', texto: 'va' });

    expect(avisarOficina).not.toHaveBeenCalled();
  });

  it('si la flota no tiene teléfono de jefe registrado, no truena (best-effort)', async () => {
    telefonoJefeDe.mockResolvedValue(null);
    LISTA = { data: [{ id: 'v-7', folio: 'VJ-7' }], error: null };
    RESULTADO_UPDATE = { data: [{ id: 'v-7' }], error: null };

    await expect(atenderConfirmacion({ tenantId: 't-1', operadorId: 'op-9', texto: 'va' })).resolves.toMatchObject({ viajeConfirmado: 'v-7' });
    expect(avisarOficina).not.toHaveBeenCalled();
  });
});

describe('A8 ESCALACIÓN · caso "NO" — rastro en la base + aviso inmediato al jefe', () => {
  it('el chofer dice "no": se escribe `rechazado_en` (acotado por operador y flota) y se avisa DE INMEDIATO al jefe', async () => {
    LISTA = { data: [{ id: 'v-7', folio: 'VJ-7', origen: 'GDL', destino: 'MTY' }], error: null };
    RESULTADO_UPDATE = { data: [{ id: 'v-7' }], error: null };
    cargarViajeContexto.mockResolvedValue({ operadorNombre: 'Juan Pérez', folio: 'VJ-7' });

    const r = await atenderConfirmacion({ tenantId: 't-1', operadorId: 'op-9', texto: 'no' });

    // La "verdad operativa" que protege la liquidación (inicio_viaje.ts): sin
    // viaje abierto, ningún gasto se carga a nadie.
    expect(r.estado).toBe('sin_viaje');

    // El UPDATE escribió `rechazado_en` (NO `aceptado_en`) y quedó acotado
    // por operador y flota, igual que `marcarAceptado`.
    expect(escrituras).toHaveLength(1);
    expect(Object.keys(escrituras[0].valores)).toEqual(['rechazado_en']);
    expect(escrituras[0].filtros).toContainEqual(['id', ['v-7']]);
    expect(escrituras[0].filtros).toContainEqual(['tenant_id', 't-1']);
    expect(escrituras[0].filtros).toContainEqual(['operador_id', 'op-9']);
    expect(escrituras[0].filtros).toContainEqual(['aceptado_en', null]);
    expect(escrituras[0].filtros).toContainEqual(['rechazado_en', null]);

    // Y el jefe se entera DE INMEDIATO — no cinco horas después, cuando A8 lo
    // trataría como "no contestó" perdiendo que SÍ contestó y dijo que no.
    expect(telefonoJefeDe).toHaveBeenCalledWith('t-1');
    expect(avisarOficina).toHaveBeenCalledTimes(1);
    expect(llamadasAvisoOficina[0].texto).toContain('Juan Pérez');
    expect(llamadasAvisoOficina[0].texto).toMatch(/NO le toca/);
    expect(llamadasAvisoOficina[0].texto).toMatch(/VJ-7/);
  });

  it('un segundo "no" sobre un viaje YA rechazado no manda un segundo aviso al jefe', async () => {
    LISTA = { data: [{ id: 'v-7', folio: 'VJ-7' }], error: null };
    RESULTADO_UPDATE = { data: [], error: null }; // marcarRechazados: 0 filas, ya estaba rechazado

    const r = await atenderConfirmacion({ tenantId: 't-1', operadorId: 'op-9', texto: 'no' });

    expect(r.estado).toBe('sin_viaje');
    expect(avisarOficina).not.toHaveBeenCalled();
  });

  it('si la flota no tiene teléfono de jefe registrado, no truena (best-effort)', async () => {
    telefonoJefeDe.mockResolvedValue(null);
    LISTA = { data: [{ id: 'v-7', folio: 'VJ-7' }], error: null };
    RESULTADO_UPDATE = { data: [{ id: 'v-7' }], error: null };

    await expect(atenderConfirmacion({ tenantId: 't-1', operadorId: 'op-9', texto: 'no' })).resolves.toMatchObject({ estado: 'sin_viaje' });
    expect(avisarOficina).not.toHaveBeenCalled();
  });
});

describe('marcarRechazados — el UPDATE directo', () => {
  it('con varios ids, acota con `.in` y conserva el resto de los candados', async () => {
    RESULTADO_UPDATE = { data: [{ id: 'v-1' }, { id: 'v-2' }], error: null };

    const r = await marcarRechazados('t-1', ['v-1', 'v-2'], 'op-9');

    expect(r).toEqual(['v-1', 'v-2']);
    expect(escrituras[0].filtros).toContainEqual(['id', ['v-1', 'v-2']]);
    expect(escrituras[0].filtros).toContainEqual(['operador_id', 'op-9']);
  });

  it('con la lista vacía no llega a tocar la base', async () => {
    const r = await marcarRechazados('t-1', []);
    expect(r).toEqual([]);
    expect(escrituras).toHaveLength(0);
  });

  it('sin operadorId no se cuela un `.eq` contra undefined', async () => {
    await marcarRechazados('t-1', ['v-1']);
    expect(columnas(escrituras[0])).not.toContain('operador_id');
  });

  it('un error de la base no lanza: devuelve [] y se queda constancia en el log', async () => {
    RESULTADO_UPDATE = { data: null, error: { message: 'boom' } };
    await expect(marcarRechazados('t-1', ['v-1'])).resolves.toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
  });
});
