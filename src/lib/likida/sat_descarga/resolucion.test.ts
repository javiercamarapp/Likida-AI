import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LOS CUATRO ACTOS DEL CONTRALOR, Y LO QUE NUNCA HACEN.
//
// Lo que se prueba aquí es exactamente lo que un bug silencioso rompería sin
// que nadie lo notara hasta la declaración anual:
//
//  · LA FIRMA ES OBLIGATORIA. Sin correo no se escribe nada — ni el estatus,
//    ni el gasto. Un cruce anónimo sobre dinero deducible no es expediente.
//  · EL CHECK NO SE AFLOJA. Todo update mueve `estatus` y `gasto_id` en la
//    MISMA escritura, así que la fila jamás pasa por el estado que
//    `sat_cfdi_descargado_casado_coherente` prohíbe.
//  · NO SE PISA UN CFDI QUE YA ESTABA. La guardia optimista `.is('cfdi_uuid',
//    null)` decide la carrera, no un `if`.
//  · DESHACER NO ES BORRAR: escribe un renglón en `sat_cfdi_resolucion`.
//  · UN AMBIGUO SOLO SE RESUELVE CON UN CANDIDATO OFRECIDO.
// ═══════════════════════════════════════════════════════════════════════════

interface Llamada { tabla: string; ops: Array<{ op: string; args: unknown[] }> }

const llamadas: Llamada[] = [];
/** Cola de respuestas por tabla; si se agota, se repite la última. */
let respuestas: Record<string, Array<{ data: unknown; error: unknown }>> = {};
const bitacoras: unknown[] = [];
let correo: string | null = 'contralor@flota.test';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: <T,>(q: T) => q }));
vi.mock('@/lib/likida/bitacora_escritura', () => ({
  anotarBitacora: (e: unknown) => { bitacoras.push(e); return Promise.resolve(); },
}));
vi.mock('@/lib/likida/jornada/firma', () => ({ correoDelUsuario: () => Promise.resolve(correo) }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const registro: Llamada = { tabla, ops: [] };
      llamadas.push(registro);
      const b: Record<string, unknown> = {};
      for (const op of ['select', 'eq', 'is', 'in', 'update', 'insert', 'order', 'limit']) {
        b[op] = (...args: unknown[]) => { registro.ops.push({ op, args }); return b; };
      }
      const siguiente = () => {
        const cola = respuestas[tabla];
        if (!cola || cola.length === 0) return { data: [], error: null };
        return cola.length === 1 ? cola[0] : cola.shift()!;
      };
      b.maybeSingle = () => Promise.resolve(siguiente());
      b.then = (ok: (v: unknown) => unknown) => Promise.resolve(siguiente()).then(ok);
      return b;
    },
  }),
}));

const {
  ligarComprobante, ignorarComprobante, revertirResolucion, estatusAlRevertir,
} = await import('./resolucion');
const { DatoInvalido } = await import('../errores');

const TENANT = '11111111-1111-1111-1111-111111111111';
const ACTOR = { id: '22222222-2222-2222-2222-222222222222' };
const UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';

function cfdi(extra: Record<string, unknown> = {}) {
  return { data: { id: 'cfdi-1', cfdi_uuid: UUID, estatus: 'disponible', gasto_id: null, candidatos: null, total: '300.00', ...extra }, error: null };
}

function ops(tabla: string) { return llamadas.filter((l) => l.tabla === tabla).flatMap((l) => l.ops); }
function updates(tabla: string) { return ops(tabla).filter((x) => x.op === 'update').map((x) => x.args[0] as Record<string, unknown>); }
function inserts(tabla: string) { return ops(tabla).filter((x) => x.op === 'insert').map((x) => x.args[0] as Record<string, unknown>); }

beforeEach(() => {
  llamadas.length = 0; bitacoras.length = 0; respuestas = {};
  correo = 'contralor@flota.test';
});

describe('la firma es obligatoria', () => {
  it('sin correo no se escribe NADA — ni el gasto ni el comprobante', async () => {
    correo = null;
    respuestas.sat_cfdi_descargado = [cfdi()];
    const r = await ligarComprobante(TENANT, 'cfdi-1', 'g-1', ACTOR);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('sin_firma');
    // Fallo CERRADO: ni siquiera se leyó el comprobante.
    expect(llamadas).toHaveLength(0);
  });

  it('archivar sin firma tampoco escribe', async () => {
    correo = null;
    const r = await ignorarComprobante(TENANT, 'cfdi-1', 'no es de esta flota', ACTOR);
    expect(r.motivo).toBe('sin_firma');
    expect(updates('sat_cfdi_descargado')).toEqual([]);
  });
});

describe('ligar — el acto que afirma la deducción', () => {
  it('escribe estatus, gasto y firma EN EL MISMO update', async () => {
    respuestas.sat_cfdi_descargado = [cfdi(), { data: [{ id: 'cfdi-1' }], error: null }];
    respuestas.gasto = [
      { data: { id: 'g-1', cfdi_uuid: null, monto: '300.00' }, error: null },
      { data: [{ id: 'g-1' }], error: null },
    ];
    const r = await ligarComprobante(TENANT, 'cfdi-1', 'g-1', ACTOR);
    expect(r.ok).toBe(true);

    const u = updates('sat_cfdi_descargado')[0];
    // El CHECK `casado_coherente` no se puede violar ni un instante: los dos
    // campos viajan juntos.
    expect(u.estatus).toBe('casado');
    expect(u.gasto_id).toBe('g-1');
    expect(u.resuelto_por).toBe(ACTOR.id);
    expect(u.resuelto_por_email).toBe('contralor@flota.test');
    expect(typeof u.resuelto_en).toBe('string');
  });

  it('el update va anclado al estatus que se leyó — la carrera la decide la base', async () => {
    respuestas.sat_cfdi_descargado = [cfdi({ estatus: 'disponible' }), { data: [{ id: 'cfdi-1' }], error: null }];
    respuestas.gasto = [
      { data: { id: 'g-1', cfdi_uuid: null }, error: null },
      { data: [{ id: 'g-1' }], error: null },
    ];
    await ligarComprobante(TENANT, 'cfdi-1', 'g-1', ACTOR);
    expect(ops('sat_cfdi_descargado')).toContainEqual({ op: 'eq', args: ['estatus', 'disponible'] });
  });

  it('el gasto se liga con la guardia optimista, no con un `if`', async () => {
    respuestas.sat_cfdi_descargado = [cfdi(), { data: [{ id: 'cfdi-1' }], error: null }];
    respuestas.gasto = [
      { data: { id: 'g-1', cfdi_uuid: null }, error: null },
      { data: [{ id: 'g-1' }], error: null },
    ];
    await ligarComprobante(TENANT, 'cfdi-1', 'g-1', ACTOR);
    expect(ops('gasto')).toContainEqual({ op: 'is', args: ['cfdi_uuid', null] });
  });

  it('un gasto que YA tiene comprobante se rechaza con esas palabras', async () => {
    respuestas.sat_cfdi_descargado = [cfdi()];
    respuestas.gasto = [{ data: { id: 'g-1', cfdi_uuid: 'otro-folio' }, error: null }];
    const r = await ligarComprobante(TENANT, 'cfdi-1', 'g-1', ACTOR);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('gasto_ya_tiene_cfdi');
    // No se pisó: no hubo ni un update sobre el gasto.
    expect(updates('gasto')).toEqual([]);
  });

  it('perder la carrera del gasto no se cuenta como éxito', async () => {
    respuestas.sat_cfdi_descargado = [cfdi()];
    respuestas.gasto = [
      { data: { id: 'g-1', cfdi_uuid: null }, error: null },
      // cero filas afectadas: alguien más le pegó su XML en el intermedio.
      { data: [], error: null },
    ];
    const r = await ligarComprobante(TENANT, 'cfdi-1', 'g-1', ACTOR);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('gasto_ya_tiene_cfdi');
    expect(updates('sat_cfdi_descargado')).toEqual([]);
  });

  it('un ambiguo SOLO se resuelve con un candidato que el motor ofreció', async () => {
    respuestas.sat_cfdi_descargado = [cfdi({
      estatus: 'ambiguo',
      candidatos: { candidatos: [{ gastoId: 'g-a' }, { gastoId: 'g-b' }] },
    })];
    const r = await ligarComprobante(TENANT, 'cfdi-1', 'g-fuera-de-lista', ACTOR);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('candidato_no_ofrecido');
    expect(updates('gasto')).toEqual([]);
  });

  it('un ambiguo con un candidato ofrecido sí pasa, y conserva la lista', async () => {
    respuestas.sat_cfdi_descargado = [
      cfdi({ estatus: 'ambiguo', candidatos: { candidatos: [{ gastoId: 'g-a' }, { gastoId: 'g-b' }] } }),
      { data: [{ id: 'cfdi-1' }], error: null },
    ];
    respuestas.gasto = [
      { data: { id: 'g-a', cfdi_uuid: null }, error: null },
      { data: [{ id: 'g-a' }], error: null },
    ];
    const r = await ligarComprobante(TENANT, 'cfdi-1', 'g-a', ACTOR);
    expect(r.ok).toBe(true);
    const u = updates('sat_cfdi_descargado')[0];
    const cands = u.candidatos as Record<string, unknown>;
    // LOS CANDIDATOS NO SE BORRAN: es lo que permite que deshacer devuelva el
    // comprobante a la cola de la que salió, y no a otra.
    expect(cands.candidatos).toHaveLength(2);
    expect(cands.elegido).toBe('g-a');
    expect(cands.elegido_por).toBe('contralor@flota.test');
  });

  it('un viaje YA liquidado se dice con esas palabras, no como fallo genérico', async () => {
    respuestas.sat_cfdi_descargado = [cfdi()];
    respuestas.gasto = [
      { data: { id: 'g-1', cfdi_uuid: null }, error: null },
      { data: null, error: { code: 'CU001', message: 'el viaje ya tiene liquidación emitida' } },
    ];
    const r = await ligarComprobante(TENANT, 'cfdi-1', 'g-1', ACTOR);
    expect(r.motivo).toBe('gasto_de_viaje_liquidado');
    expect(r.mensaje).toContain('liquidación emitida');
  });

  it('si el comprobante no se pudo marcar, el gasto se SUELTA por su folio', async () => {
    respuestas.sat_cfdi_descargado = [cfdi(), { data: null, error: { message: 'boom' } }];
    respuestas.gasto = [
      { data: { id: 'g-1', cfdi_uuid: null }, error: null },
      { data: [{ id: 'g-1' }], error: null },   // se ligó
      { data: [{ id: 'g-1' }], error: null },   // …y se deshizo
    ];
    const r = await ligarComprobante(TENANT, 'cfdi-1', 'g-1', ACTOR);
    expect(r.ok).toBe(false);
    // El deshacer va anclado al folio que ESTE acto escribió: nunca suelta un
    // comprobante ajeno.
    expect(ops('gasto')).toContainEqual({ op: 'eq', args: ['cfdi_uuid', UUID] });
    expect(updates('gasto').at(-1)).toMatchObject({ cfdi_uuid: null });
  });

  it('un comprobante ya casado no se re-liga encima: primero se deshace', async () => {
    respuestas.sat_cfdi_descargado = [cfdi({ estatus: 'casado', gasto_id: 'g-viejo' })];
    const r = await ligarComprobante(TENANT, 'cfdi-1', 'g-nuevo', ACTOR);
    expect(r.motivo).toBe('ya_resuelto');
    expect(updates('gasto')).toEqual([]);
  });

  it('deja renglón en el expediente y en la bitácora', async () => {
    respuestas.sat_cfdi_descargado = [cfdi(), { data: [{ id: 'cfdi-1' }], error: null }];
    respuestas.gasto = [
      { data: { id: 'g-1', cfdi_uuid: null }, error: null },
      { data: [{ id: 'g-1' }], error: null },
    ];
    await ligarComprobante(TENANT, 'cfdi-1', 'g-1', ACTOR);
    expect(inserts('sat_cfdi_resolucion')[0]).toMatchObject({
      tenant_id: TENANT, cfdi_id: 'cfdi-1', acto: 'ligado', gasto_id: 'g-1',
      estatus_antes: 'disponible', estatus_despues: 'casado',
      actor_email: 'contralor@flota.test',
    });
    expect(bitacoras).toHaveLength(1);
  });
});

describe('archivar — no borra, anota', () => {
  it('exige motivo', async () => {
    await expect(ignorarComprobante(TENANT, 'cfdi-1', '   ', ACTOR)).rejects.toBeInstanceOf(DatoInvalido);
  });

  it('deja gasto_id en NULL: no hay cruce que afirmar', async () => {
    respuestas.sat_cfdi_descargado = [cfdi(), { data: [{ id: 'cfdi-1' }], error: null }];
    const r = await ignorarComprobante(TENANT, 'cfdi-1', 'duplicado del folio X', ACTOR);
    expect(r.ok).toBe(true);
    const u = updates('sat_cfdi_descargado')[0];
    expect(u.estatus).toBe('ignorado');
    expect(u.gasto_id).toBeUndefined();
    expect(u.resuelto_por_email).toBe('contralor@flota.test');
    expect((u.candidatos as Record<string, unknown>).ignorado_motivo).toBe('duplicado del folio X');
  });

  it('no se archiva un casado sin deshacer antes', async () => {
    respuestas.sat_cfdi_descargado = [cfdi({ estatus: 'casado', gasto_id: 'g-1' })];
    const r = await ignorarComprobante(TENANT, 'cfdi-1', 'ya no lo quiero', ACTOR);
    expect(r.motivo).toBe('ya_resuelto');
    expect(updates('sat_cfdi_descargado')).toEqual([]);
  });

  it('el renglón del expediente lleva el motivo', async () => {
    respuestas.sat_cfdi_descargado = [cfdi(), { data: [{ id: 'cfdi-1' }], error: null }];
    await ignorarComprobante(TENANT, 'cfdi-1', 'no es de esta flota', ACTOR);
    expect(inserts('sat_cfdi_resolucion')[0]).toMatchObject({
      acto: 'ignorado', estatus_despues: 'ignorado', motivo: 'no es de esta flota',
    });
  });
});

describe('deshacer — la reversión se anota, no se borra', () => {
  it('exige motivo', async () => {
    await expect(revertirResolucion(TENANT, 'cfdi-1', '', ACTOR)).rejects.toBeInstanceOf(DatoInvalido);
  });

  it('suelta el gasto SOLO por el folio de este comprobante', async () => {
    respuestas.sat_cfdi_descargado = [
      cfdi({ estatus: 'casado', gasto_id: 'g-1' }),
      { data: [{ id: 'cfdi-1' }], error: null },
    ];
    respuestas.gasto = [{ data: [{ id: 'g-1' }], error: null }];
    const r = await revertirResolucion(TENANT, 'cfdi-1', 'era del otro ticket', ACTOR);
    expect(r.ok).toBe(true);
    expect(ops('gasto')).toContainEqual({ op: 'eq', args: ['cfdi_uuid', UUID] });
    // `xml_verificado` vuelve a NULL, no a false: «no se verificó» ≠ «no cuadró».
    expect(updates('gasto')[0]).toEqual({ cfdi_uuid: null, xml_verificado: null });
  });

  it('el comprobante vuelve a esperar decisión, con estatus y gasto en el mismo update', async () => {
    respuestas.sat_cfdi_descargado = [
      cfdi({ estatus: 'casado', gasto_id: 'g-1' }),
      { data: [{ id: 'cfdi-1' }], error: null },
    ];
    respuestas.gasto = [{ data: [{ id: 'g-1' }], error: null }];
    await revertirResolucion(TENANT, 'cfdi-1', 'me equivoqué', ACTOR);
    const u = updates('sat_cfdi_descargado')[0];
    expect(u.estatus).toBe('disponible');
    expect(u.gasto_id).toBeNull();
    // La firma queda describiendo LA REVERSIÓN.
    expect(u.resuelto_por_email).toBe('contralor@flota.test');
  });

  it('si había varios candidatos, vuelve a AMBIGUO — la pregunta sigue siendo cuál', async () => {
    respuestas.sat_cfdi_descargado = [
      cfdi({ estatus: 'casado', gasto_id: 'g-a', candidatos: { candidatos: [{ gastoId: 'g-a' }, { gastoId: 'g-b' }], elegido: 'g-a' } }),
      { data: [{ id: 'cfdi-1' }], error: null },
    ];
    respuestas.gasto = [{ data: [{ id: 'g-a' }], error: null }];
    const r = await revertirResolucion(TENANT, 'cfdi-1', 'era el otro', ACTOR);
    expect(updates('sat_cfdi_descargado')[0].estatus).toBe('ambiguo');
    expect(r.mensaje).toContain('varios candidatos');
  });

  it('deshacer un archivado lo devuelve a la bandeja', async () => {
    respuestas.sat_cfdi_descargado = [
      cfdi({ estatus: 'ignorado' }),
      { data: [{ id: 'cfdi-1' }], error: null },
    ];
    const r = await revertirResolucion(TENANT, 'cfdi-1', 'sí era nuestro', ACTOR);
    expect(r.ok).toBe(true);
    expect(updates('sat_cfdi_descargado')[0].estatus).toBe('disponible');
    // No hay gasto que soltar: no se tocó ninguno.
    expect(updates('gasto')).toEqual([]);
  });

  it('no hay nada que deshacer sobre un comprobante que sigue esperando', async () => {
    respuestas.sat_cfdi_descargado = [cfdi({ estatus: 'ambiguo' })];
    const r = await revertirResolucion(TENANT, 'cfdi-1', 'x', ACTOR);
    expect(r.motivo).toBe('nada_que_revertir');
    expect(updates('sat_cfdi_descargado')).toEqual([]);
  });

  it('un viaje liquidado impide soltar el gasto, y el cruce se queda como está', async () => {
    respuestas.sat_cfdi_descargado = [cfdi({ estatus: 'casado', gasto_id: 'g-1' })];
    respuestas.gasto = [{ data: null, error: { code: 'CU001', message: 'ya liquidado' } }];
    const r = await revertirResolucion(TENANT, 'cfdi-1', 'me equivoqué', ACTOR);
    expect(r.motivo).toBe('gasto_de_viaje_liquidado');
    expect(updates('sat_cfdi_descargado')).toEqual([]);
  });

  it('escribe el renglón «revertido» con quién y por qué', async () => {
    respuestas.sat_cfdi_descargado = [
      cfdi({ estatus: 'casado', gasto_id: 'g-1' }),
      { data: [{ id: 'cfdi-1' }], error: null },
    ];
    respuestas.gasto = [{ data: [{ id: 'g-1' }], error: null }];
    await revertirResolucion(TENANT, 'cfdi-1', 'era del otro ticket', ACTOR);
    expect(inserts('sat_cfdi_resolucion')[0]).toMatchObject({
      acto: 'revertido', gasto_id: 'g-1',
      estatus_antes: 'casado', estatus_despues: 'disponible',
      motivo: 'era del otro ticket', actor_email: 'contralor@flota.test',
    });
    // Y NO se borró nada: la única escritura sobre el expediente es un insert.
    expect(ops('sat_cfdi_resolucion').map((x) => x.op)).toEqual(['insert']);
  });
});

describe('estatusAlRevertir', () => {
  it('con dos o más candidatos vuelve a ambiguo', () => {
    expect(estatusAlRevertir({ candidatos: [{ gastoId: 'a' }, { gastoId: 'b' }] })).toBe('ambiguo');
  });
  it('con uno o ninguno, disponible: no hay nada que elegir', () => {
    expect(estatusAlRevertir({ candidatos: [{ gastoId: 'a' }] })).toBe('disponible');
    expect(estatusAlRevertir(null)).toBe('disponible');
    expect(estatusAlRevertir({ motivo: 'ningún gasto corresponde' })).toBe('disponible');
  });
});

describe('el tenant de la sesión se impone en cada consulta', () => {
  it('leer, ligar y marcar van todos anclados al tenant', async () => {
    respuestas.sat_cfdi_descargado = [cfdi(), { data: [{ id: 'cfdi-1' }], error: null }];
    respuestas.gasto = [
      { data: { id: 'g-1', cfdi_uuid: null }, error: null },
      { data: [{ id: 'g-1' }], error: null },
    ];
    await ligarComprobante(TENANT, 'cfdi-1', 'g-1', ACTOR);
    for (const tabla of ['sat_cfdi_descargado', 'gasto']) {
      expect(ops(tabla)).toContainEqual({ op: 'eq', args: ['tenant_id', TENANT] });
    }
    expect(inserts('sat_cfdi_resolucion')[0].tenant_id).toBe(TENANT);
  });
});
