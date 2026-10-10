import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('./repo_validacion', () => ({ atenderEscalacionOficina: vi.fn(), capturarHitoOficina: vi.fn(), validarHitoOficina: vi.fn() }));

const { ejecutarAccionOficina, horaMxAUtc, leerAccion, MOTIVO_MAX } = await import('./acciones_oficina');
type Deps = import('./acciones_oficina').DepsAcciones;

const HITO = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001';
const VIAJE = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d002';
const AHORA = new Date('2026-10-02T20:00:00.000Z');
const fd = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
const ctx = (rol = 'encargado', email: string | null = 'jefe@flota.mx') => ({ tenantId: 't1', rol, usuarioId: 'u1', email });

function deps(o: Partial<Record<keyof Deps, unknown>> = {}) {
  const llamadas: Array<[string, unknown[]]> = [];
  const d = {
    capturar: vi.fn(async (...a: unknown[]) => { llamadas.push(['capturar', a]); return o.capturar ?? 'ok'; }),
    validar: vi.fn(async (...a: unknown[]) => { llamadas.push(['validar', a]); return o.validar ?? 'ok'; }),
    atender: vi.fn(async (...a: unknown[]) => { llamadas.push(['atender', a]); return o.atender === undefined ? 1 : o.atender; }),
  } as unknown as Deps;
  return { d, llamadas };
}

describe('horaMxAUtc', () => {
  it('interpreta la hora como de MÉXICO (UTC-6), no del servidor', () => {
    expect(horaMxAUtc('2026-10-02T14:32')?.toISOString()).toBe('2026-10-02T20:32:00.000Z');
    expect(horaMxAUtc('2026-10-02 08:00')?.toISOString()).toBe('2026-10-02T14:00:00.000Z');
    expect(horaMxAUtc('2026-10-02T23:59')?.toISOString()).toBe('2026-10-03T05:59:00.000Z');
  });
  it('rechaza lo que no es una fecha-hora real', () => {
    for (const x of ['', 'ayer', '2026-02-31T10:00', '2026-13-01T10:00', '2026-10-02T25:00', '2026-10-02T10:61', '02/10/2026 10:00', '2026-10-02']) {
      expect(horaMxAUtc(x), x).toBeNull();
    }
  });
});

describe('leerAccion', () => {
  it('el motivo es obligatorio (≥ 5 letras), se normaliza y tiene tope', () => {
    expect(leerAccion(fd({ tipo: 'validar', hitoId: HITO, motivo: '   ok ' }))).toHaveProperty('error');
    expect(leerAccion(fd({ tipo: 'validar', hitoId: HITO, motivo: 'x'.repeat(MOTIVO_MAX + 1) }))).toHaveProperty('error');
    const r = leerAccion(fd({ tipo: 'validar', hitoId: HITO.toUpperCase(), motivo: '  confirmado \n\t por   teléfono ' }));
    expect(r).toEqual({ ok: { tipo: 'validar', hitoId: HITO, motivo: 'confirmado por teléfono' } });
  });
  it('capturar exige hora real; atender exige un viaje uuid', () => {
    expect(leerAccion(fd({ tipo: 'capturar', hitoId: HITO, motivo: 'avisó por radio' }))).toHaveProperty('error');
    const r = leerAccion(fd({ tipo: 'capturar', hitoId: HITO, motivo: 'avisó por radio', hora: '2026-10-02T14:00' }));
    expect(r).toMatchObject({ ok: { tipo: 'capturar', hora: new Date('2026-10-02T20:00:00.000Z') } });
    expect(leerAccion(fd({ tipo: 'atender', viajeId: 'no-uuid', motivo: 'ya hablé con él' }))).toHaveProperty('error');
    expect(leerAccion(fd({ tipo: 'atender', viajeId: VIAJE, motivo: 'ya hablé con él' }))).toMatchObject({ ok: { tipo: 'atender', viajeId: VIAJE } });
  });
  it('hostil: id inventado, acción desconocida y campos con tipo raro no pasan', () => {
    expect(leerAccion(fd({ tipo: 'validar', hitoId: "'; drop table viaje_hito;--", motivo: 'válido válido' }))).toHaveProperty('error');
    expect(leerAccion(fd({ tipo: 'borrar', hitoId: HITO, motivo: 'válido válido' }))).toMatchObject({ error: 'No reconozco la acción.' });
    expect(leerAccion({ get: () => 42 })).toHaveProperty('error');
  });
});

describe('ejecutarAccionOficina', () => {
  const capturar = { tipo: 'capturar' as const, hitoId: HITO, hora: new Date('2026-10-02T19:00:00.000Z'), motivo: 'avisó por radio' };

  it('el jefe de tráfico captura: la hora, el motivo y su firma llegan a la base con SU flota', async () => {
    const { d, llamadas } = deps();
    const r = await ejecutarAccionOficina(ctx(), capturar, AHORA, d);
    expect(r).toMatchObject({ ok: true });
    expect(llamadas[0]).toEqual(['capturar', ['t1', HITO, capturar.hora, { usuarioId: 'u1', email: 'jefe@flota.mx' }, 'avisó por radio', AHORA]]);
  });

  it.each(['flota_admin', 'encargado', 'superadmin'])('%s puede', async (rol) => {
    const { d } = deps();
    expect((await ejecutarAccionOficina(ctx(rol), capturar, AHORA, d)).ok).toBe(true);
  });

  it.each(['contador', 'vendedor', 'operador', 'sin_rol', 'cualquier_cosa', ''])('el rol «%s» NO puede (fail closed) y no toca la base', async (rol) => {
    const { d } = deps();
    const r = await ejecutarAccionOficina(ctx(rol), capturar, AHORA, d);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Solo el dueño/) });
    expect(d.capturar).not.toHaveBeenCalled();
    expect(d.validar).not.toHaveBeenCalled();
    expect(d.atender).not.toHaveBeenCalled();
  });

  it('sin correo no hay firma: no se escribe nada', async () => {
    const { d } = deps();
    const r = await ejecutarAccionOficina(ctx('encargado', null), capturar, AHORA, d);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/firmar la bitácora/) });
    expect(d.capturar).not.toHaveBeenCalled();
  });

  it('cada desenlace de la base se dice en palabras', async () => {
    expect(await ejecutarAccionOficina(ctx(), capturar, AHORA, deps({ capturar: 'hito_cambio' }).d)).toMatchObject({ ok: false, error: expect.stringMatching(/ya cambió/) });
    expect(await ejecutarAccionOficina(ctx(), capturar, AHORA, deps({ capturar: 'hora_invalida' }).d)).toMatchObject({ ok: false, error: expect.stringMatching(/no puede ser futura/) });
    expect(await ejecutarAccionOficina(ctx(), capturar, AHORA, deps({ capturar: 'fallo' }).d)).toMatchObject({ ok: false, error: expect.stringMatching(/No pude guardarlo/) });
  });

  it('validar: ok y hito que cambió', async () => {
    const a = { tipo: 'validar' as const, hitoId: HITO, motivo: 'confirmado con el cliente' };
    expect(await ejecutarAccionOficina(ctx(), a, AHORA, deps().d)).toMatchObject({ ok: true, mensaje: expect.stringMatching(/validado por la oficina/) });
    expect(await ejecutarAccionOficina(ctx(), a, AHORA, deps({ validar: 'hito_cambio' }).d)).toMatchObject({ ok: false });
  });

  it('atender: cuenta lo marcado; 0 es «no había nada», null es fallo', async () => {
    const a = { tipo: 'atender' as const, viajeId: VIAJE, motivo: 'ya hablé con el chofer' };
    expect(await ejecutarAccionOficina(ctx(), a, AHORA, deps({ atender: 2 }).d)).toMatchObject({ ok: true });
    expect(await ejecutarAccionOficina(ctx(), a, AHORA, deps({ atender: 0 }).d)).toMatchObject({ ok: false, error: expect.stringMatching(/No había nada pendiente/) });
    expect(await ejecutarAccionOficina(ctx(), a, AHORA, deps({ atender: null }).d)).toMatchObject({ ok: false, error: expect.stringMatching(/No pude guardarlo/) });
  });

  it('una base que LANZA no tumba la pantalla: se dice y se registra', async () => {
    const d = { capturar: vi.fn(async () => { throw new Error('boom'); }), validar: vi.fn(), atender: vi.fn() } as unknown as Deps;
    expect(await ejecutarAccionOficina(ctx(), capturar, AHORA, d)).toMatchObject({ ok: false, error: expect.stringMatching(/No pude guardarlo/) });
  });

  it('el tenant sale del contexto de sesión, nunca de la acción pedida (una acción no puede traer otra flota)', async () => {
    const { d, llamadas } = deps();
    await ejecutarAccionOficina({ ...ctx(), tenantId: 'flota-de-la-sesion' }, { ...capturar, tenantId: 'otra-flota' } as never, AHORA, d);
    expect(llamadas[0][1][0]).toBe('flota-de-la-sesion');
  });
});
