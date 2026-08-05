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

const { marcarAceptado, aceptarPorActividad, atenderConfirmacion } = await import('./confirmar_viaje');

/** Los nombres de columna por los que se acotó el UPDATE. */
const columnas = (e: Escritura) => e.filtros.map(([c]) => c);

beforeEach(() => {
  escrituras.length = 0;
  LISTA = { data: [], error: null };
  RESULTADO_UPDATE = { data: [{ id: 'v-1' }], error: null };
  logger.info.mockReset(); logger.warn.mockReset(); logger.error.mockReset();
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
