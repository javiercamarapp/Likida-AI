import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// A37-S18-04 / A37-S18-05 — las guardas del despacho antes de mandarle un WhatsApp al
// chofer (reaviso o asignación) y el texto de los errores de asignar. Datos sintéticos.
// ═══════════════════════════════════════════════════════════════════════════

type Resp = { data: unknown; error: { message: string } | null };
const respuestas: Record<string, Resp> = {};
const consultas: Array<{ tabla: string; filtros: Array<[string, unknown]>; update?: unknown }> = [];
function builder(tabla: string) {
  const q = { tabla, filtros: [] as Array<[string, unknown]>, update: undefined as unknown };
  consultas.push(q);
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b, order: () => b, limit: () => b, maybeSingle: () => b,
    eq: (k: string, v: unknown) => { q.filtros.push([k, v]); return b; },
    gte: (k: string, v: unknown) => { q.filtros.push([k, v]); return b; },
    update: (v: unknown) => { q.update = v; return b; },
    then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(respuestas[tabla] ?? { data: null, error: null }).then(res, rej),
  });
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));
const anotarBitacora = vi.hoisted(() => vi.fn(async () => true));
vi.mock('./bitacora_escritura', () => ({ anotarBitacora }));

const { guardaReaviso, guardaAsignacion, anotarAvisoAlChofer, mensajeDeAsignacion, COOLDOWN_REAVISO_MS } = await import('./despacho_asignacion');
const { DatoInvalido } = await import('./errores');

const T = 't-1';
const V = 'v-1';
const viaje = (o: Record<string, unknown> = {}): Resp => ({
  data: { estatus: 'abierto', operador_id: 'o-1', aceptado_en: null, avisado_en: '2026-10-01T10:00:00Z', avisos_enviados: 1, ...o }, error: null,
});

beforeEach(() => {
  for (const k of Object.keys(respuestas)) delete respuestas[k];
  consultas.length = 0;
  anotarBitacora.mockClear();
  respuestas.viaje = viaje();
  respuestas.operador = { data: { activo: true }, error: null };
  respuestas.bitacora_auditoria = { data: [], error: null };
});

describe('guardaReaviso', () => {
  it('feliz: abierto, con operador activo, sin aceptar y sin aviso reciente — resuelve el operador DESDE la base, anclado al tenant', async () => {
    const g = await guardaReaviso(T, V);
    expect(g).toEqual({ ok: true, operadorId: 'o-1', contarReaviso: true, avisosEnviados: 1 });
    expect(consultas.find((c) => c.tabla === 'viaje')?.filtros).toEqual(expect.arrayContaining([['tenant_id', T], ['id', V]]));
  });

  it('un viaje que NO existe en la flota (id ajeno) no se avisa', async () => {
    respuestas.viaje = { data: null, error: null };
    expect(await guardaReaviso(T, V)).toMatchObject({ ok: false, motivo: expect.stringContaining('no existe en tu flota') });
  });

  it.each(['en_cuadre', 'liquidado'])('un viaje %s ya no se avisa', async (estatus) => {
    respuestas.viaje = viaje({ estatus });
    expect(await guardaReaviso(T, V)).toMatchObject({ ok: false, motivo: expect.stringContaining('ya no se le avisa') });
  });

  it('un viaje que el chofer YA aceptó no se reavisa (pestaña vieja)', async () => {
    respuestas.viaje = viaje({ aceptado_en: '2026-10-01T11:00:00Z' });
    expect(await guardaReaviso(T, V)).toMatchObject({ ok: false, motivo: expect.stringContaining('ya aceptó') });
  });

  it('un viaje sin operador no se avisa', async () => {
    respuestas.viaje = viaje({ operador_id: null });
    expect(await guardaReaviso(T, V)).toMatchObject({ ok: false, motivo: expect.stringContaining('no tiene operador') });
  });

  it('un operador dado de baja no recibe el WhatsApp', async () => {
    respuestas.operador = { data: { activo: false }, error: null };
    expect(await guardaReaviso(T, V)).toMatchObject({ ok: false, motivo: expect.stringContaining('dado de baja') });
  });

  it('el aviso de hace 3 minutos bloquea otro (cooldown); la consulta pregunta por los últimos 10', async () => {
    respuestas.bitacora_auditoria = { data: [{ id: 9 }], error: null };
    const ahora = new Date('2026-10-01T12:00:00Z');
    expect(await guardaReaviso(T, V, ahora)).toMatchObject({ ok: false, motivo: expect.stringContaining('Espera') });
    const c = consultas.find((x) => x.tabla === 'bitacora_auditoria')!;
    expect(c.filtros).toEqual(expect.arrayContaining([
      ['tenant_id', T], ['entidad', 'viaje'], ['entidad_id', V], ['accion', 'despacho.aviso_chofer'],
      ['ocurrio_en', new Date(ahora.getTime() - COOLDOWN_REAVISO_MS).toISOString()],
    ]));
  });

  it.each(['viaje', 'operador', 'bitacora_auditoria'])('FAIL-CLOSED: si no se puede leer %s no se manda nada', async (tabla) => {
    respuestas[tabla] = { data: null, error: { message: 'base caída' } };
    expect(await guardaReaviso(T, V)).toMatchObject({ ok: false, motivo: expect.stringContaining('No pude comprobar') });
  });

  it('un viaje que nunca se había avisado no cuenta como reaviso (avisarAlChofer pone avisos_enviados=1 solo)', async () => {
    respuestas.viaje = viaje({ avisado_en: null, avisos_enviados: 0 });
    expect(await guardaReaviso(T, V)).toMatchObject({ ok: true, contarReaviso: false });
  });
});

describe('guardaAsignacion', () => {
  it('a OTRO operador: sin reaviso, no pasa por el cooldown ni por el "ya aceptó" (el reloj se reinicia al cambiar de chofer)', async () => {
    respuestas.viaje = viaje({ aceptado_en: '2026-10-01T11:00:00Z' });
    respuestas.bitacora_auditoria = { data: [{ id: 9 }], error: null };
    expect(await guardaAsignacion(T, V, 'o-2')).toMatchObject({ ok: true, reaviso: false });
  });

  it('al MISMO operador es un reaviso disfrazado: pasa por las guardas (aceptado → rechaza)', async () => {
    respuestas.viaje = viaje({ aceptado_en: '2026-10-01T11:00:00Z' });
    expect(await guardaAsignacion(T, V, 'o-1')).toMatchObject({ ok: false, motivo: expect.stringContaining('ya aceptó') });
  });

  it('viaje inexistente o cerrado no se asigna', async () => {
    respuestas.viaje = { data: null, error: null };
    expect(await guardaAsignacion(T, V, 'o-2')).toMatchObject({ ok: false });
    respuestas.viaje = viaje({ estatus: 'liquidado' });
    expect(await guardaAsignacion(T, V, 'o-2')).toMatchObject({ ok: false });
  });
});

describe('anotarAvisoAlChofer', () => {
  it('un reaviso se cuenta en avisos_enviados (optimista) y deja la huella del cooldown en la bitácora', async () => {
    await anotarAvisoAlChofer(T, V, 'o-1', { contarReaviso: true, avisosEnviados: 1, actor: { id: 'u-1' } });
    const upd = consultas.find((c) => c.tabla === 'viaje');
    expect(upd?.update).toEqual({ avisos_enviados: 2 });
    expect(upd?.filtros).toEqual(expect.arrayContaining([['tenant_id', T], ['avisos_enviados', 1]]));
    expect(anotarBitacora).toHaveBeenCalledWith(expect.objectContaining({ tenantId: T, accion: 'despacho.aviso_chofer', entidad: 'viaje', entidadId: V }), expect.anything());
  });

  it('el primer aviso no suma (ya lo hizo avisarAlChofer) pero sí deja la huella', async () => {
    await anotarAvisoAlChofer(T, V, 'o-1', { contarReaviso: false, avisosEnviados: 0, actor: { id: 'u-1' } });
    expect(consultas.find((c) => c.tabla === 'viaje')).toBeUndefined();
    expect(anotarBitacora).toHaveBeenCalledTimes(1);
  });
});

describe('mensajeDeAsignacion', () => {
  const GEN = 'No se pudo asignar. Inténtalo de nuevo.';
  it('DatoInvalido se enseña verbatim', () => {
    expect(mensajeDeAsignacion(new DatoInvalido('Esa unidad está dada de baja.'), GEN)).toBe('Esa unidad está dada de baja.');
  });
  it('traduce los rechazos conocidos y el choque de índices de viaje abierto', () => {
    expect(mensajeDeAsignacion(new Error('reasignarOperador: el operador no pertenece a esta flota'), GEN)).toMatch(/no es de tu flota/);
    expect(mensajeDeAsignacion(new Error('reasignarOperador: el operador está dado de baja en esta flota'), GEN)).toMatch(/dado de baja/);
    expect(mensajeDeAsignacion(new Error('duplicate key value violates unique constraint "uq_viaje_abierto_por_operador"'), GEN)).toMatch(/ya trae un viaje abierto/);
    expect(mensajeDeAsignacion(new Error('violates "uq_viaje_abierto_por_unidad"'), GEN)).toMatch(/otro viaje abierto/);
  });
  it('lo desconocido es el genérico, sin filtrar el error crudo', () => {
    expect(mensajeDeAsignacion(new Error('relation "viaje" does not exist'), GEN)).toBe(GEN);
  });
});
