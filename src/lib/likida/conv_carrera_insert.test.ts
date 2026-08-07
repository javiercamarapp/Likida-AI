import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LA CARRERA QUE EL PRODUCTO PROVOCA A DIARIO.
//
// El caso NORMAL —un operador mandando 22 fotos seguidas— arranca varias
// invocaciones de `after()` para el mismo (tenant, teléfono). Todas leen, y
// como todavía no hay conversación, todas insertan. Una gana; las demás chocan
// contra `wa_conversacion_tenant_tel_uidx` (0005).
//
// `loadConversation` no miraba el `error` del insert: `created` quedaba
// `undefined` y devolvía `id: ''`. Con ese id, el `saveConversation` posterior
// hace `.eq('id', '')` —cero filas— y el turno del asistente que el operador SÍ
// leyó desaparece. El agente arranca el siguiente mensaje sin memoria de lo que
// ya dijo, y nada en el log dice que se perdió.
// ═══════════════════════════════════════════════════════════════════════════

const maybeSingle = vi.fn();
const insertSingle = vi.fn();
const insertado = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      // Cada `.eq()` devuelve algo que acepta otro `.eq()` y cierra con
      // `.maybeSingle()`: sirve igual para la lectura de dos filtros
      // (tenant + teléfono) que para la de uno (`getTenantContext`).
      const nodo: Record<string, unknown> = {};
      nodo.eq = () => nodo;
      nodo.maybeSingle = maybeSingle;
      return {
        select: () => nodo,
        insert: (v: unknown) => { insertado(v); return { select: () => ({ single: insertSingle }) }; },
      };
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger }));

const { loadConversation, getTenantContext, ConsultaFallida } = await import('./conv');

const CHOQUE = {
  code: '23505',
  message: 'duplicate key value violates unique constraint "wa_conversacion_tenant_tel_uidx"',
  details: 'Key (tenant_id, telefono)=(t1, +52) already exists.',
};

beforeEach(() => {
  maybeSingle.mockReset();
  insertSingle.mockReset();
  insertado.mockReset();
  for (const f of Object.values(logger)) f.mockReset();
});

describe('loadConversation — el insert que pierde la carrera', () => {
  it('al chocar con el índice único RELEE la fila que ganó, con sus turnos', async () => {
    maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })                  // no existe todavía
      .mockResolvedValueOnce({                                             // relectura tras el choque
        data: { id: 'c-ganadora', viaje_id: 'v1', estado: { turns: [{ role: 'user', content: 'Listo' }] } },
        error: null,
      });
    insertSingle.mockResolvedValue({ data: null, error: CHOQUE });

    const r = await loadConversation('t1', '+52', 'v1');

    // Lo que antes salía de aquí era `{ id: '', turns: [] }`.
    expect(r.id).toBe('c-ganadora');
    expect(r.turns).toEqual([{ role: 'user', content: 'Listo' }]);
    expect(logger.info).toHaveBeenCalledWith('conv.carrera_insert', expect.objectContaining({ viaje: 'v1' }));
  });

  it('NUNCA devuelve un id vacío: con ese id el turno del operador se guarda en ninguna fila', async () => {
    maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { id: 'c-ganadora', viaje_id: 'v1', estado: {} }, error: null });
    insertSingle.mockResolvedValue({ data: null, error: CHOQUE });
    const r = await loadConversation('t1', '+52', 'v1');
    expect(r.id).not.toBe('');
  });

  it('si chocó y aun así no aparece al releer, LANZA en vez de seguir sin dónde guardar', async () => {
    maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    insertSingle.mockResolvedValue({ data: null, error: CHOQUE });
    await expect(loadConversation('t1', '+52', 'v1')).rejects.toThrow(ConsultaFallida);
  });

  it('si la RELECTURA falla, lanza — no inventa una conversación vacía', async () => {
    maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: '57014 statement timeout' } });
    insertSingle.mockResolvedValue({ data: null, error: CHOQUE });
    await expect(loadConversation('t1', '+52', 'v1')).rejects.toThrow(/57014/);
  });

  it('un error del insert QUE NO ES esta carrera se lanza: tragárselo escondería otro bug', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    insertSingle.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied for table wa_conversacion' } });
    await expect(loadConversation('t1', '+52', 'v1')).rejects.toThrow(/permission denied/);
    // Y NO se relee: solo hay una lectura, la del principio.
    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });

  it('un 23505 contra OTRO índice tampoco se confunde con esta carrera', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    insertSingle.mockResolvedValue({
      data: null,
      code: '23505',
      error: { code: '23505', message: 'violates unique constraint "uq_gasto_cfdi_uuid"' },
    });
    await expect(loadConversation('t1', '+52', 'v1')).rejects.toThrow(/uq_gasto_cfdi_uuid/);
  });

  it('control: sin carrera, el insert manda y NO se relee nada', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    insertSingle.mockResolvedValue({ data: { id: 'c-nueva', viaje_id: 'v1', estado: { turns: [] } }, error: null });
    const r = await loadConversation('t1', '+52', 'v1');
    // `desdeFila` ahora también trae las MarcasConversacion (intentosConfirmacion,
    // cierreSinComprobantes): sin marcas guardadas, una fila nueva cae a sus
    // valores por defecto — no a `undefined`, porque `saveConversation` las
    // arrastra tal cual y un `undefined` ahí borraría el contador la primera vez.
    expect(r).toEqual({ id: 'c-nueva', turns: [], intentosConfirmacion: 0, cierreSinComprobantes: false });
    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });

  it('la fila que ganó es de OTRO viaje: se empieza limpio, como en la lectura normal', async () => {
    maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: { id: 'c-ganadora', viaje_id: 'v-anterior', estado: { turns: [{ role: 'assistant', content: 'cuadré tu viaje' }] } },
        error: null,
      });
    insertSingle.mockResolvedValue({ data: null, error: CHOQUE });
    const r = await loadConversation('t1', '+52', 'v1');
    expect(r.turns).toEqual([]);
    expect(logger.info).toHaveBeenCalledWith('conv.historial_descartado', expect.objectContaining({ de: 'v-anterior', a: 'v1' }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// `getTenantContext` — el `|| 'la flota'` era un default y una tapadera.
//
// Ese texto sale impreso en el aviso de privacidad que el operador lee en su
// primer contacto ("Likida procesa esta información por cuenta de …"). Con la
// base caída decía "la flota" en vez del nombre de la empresa responsable, y
// nadie podía distinguirlo de una flota sin nombre capturado.
// ═══════════════════════════════════════════════════════════════════════════
describe('getTenantContext', () => {
  it('un fallo de lectura LANZA en vez de degradar el nombre a "la flota"', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'fetch failed' } });
    await expect(getTenantContext('t1')).rejects.toThrow(ConsultaFallida);
  });

  it('control: una flota sin nombre capturado SÍ cae al default (eso sí es un dato)', async () => {
    maybeSingle.mockResolvedValue({ data: { nombre: null }, error: null });
    await expect(getTenantContext('t1')).resolves.toMatchObject({ nombreFlota: 'la flota' });
  });

  it('control: con nombre, el del tenant', async () => {
    maybeSingle.mockResolvedValue({ data: { nombre: 'Flota Demo SA de CV' }, error: null });
    await expect(getTenantContext('t1')).resolves.toMatchObject({ nombreFlota: 'Flota Demo SA de CV' });
  });
});
