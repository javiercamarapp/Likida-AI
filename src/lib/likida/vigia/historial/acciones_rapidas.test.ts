import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));

const { aprobarRespuestaRapidaPanel, retirarRespuestaRapidaPanel } = await import('./acciones');
type Deps = import('./acciones').DepsRapidas;

const R = '33333333-3333-4333-8333-333333333333';
const ctx = (rol: string) => ({ tenantId: 't1', rol, usuarioId: 'u1', email: 'a@b.mx' });
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const forma = { tema: 'tarifa', pregunta: '¿Cuánto cuesta el flete a Monterrey?', texto: 'Tu ejecutivo te manda la cotización hoy.' };

function deps(sobre: Partial<Deps> = {}): Deps & { aprobar: ReturnType<typeof vi.fn>; retirar: ReturnType<typeof vi.fn>; bitacora: ReturnType<typeof vi.fn> } {
  return {
    aprobar: vi.fn(async () => ({ ok: true as const, id: R })),
    retirar: vi.fn(async () => true),
    bitacora: vi.fn(async () => true),
    ...sobre,
  } as never;
}

describe('aprobar una respuesta rápida', () => {
  it('lo hacen el dueño y el encargado (el gerente que ya aprueba cada mensaje); el contador, el jefe de tráfico y el vendedor no', async () => {
    for (const rol of ['flota_admin', 'encargado', 'superadmin']) {
      const d = deps();
      expect((await aprobarRespuestaRapidaPanel(ctx(rol), fd(forma), d)).ok, rol).toBe(true);
    }
    for (const rol of ['contador', 'jefe_trafico', 'vendedor']) {
      const d = deps();
      expect((await aprobarRespuestaRapidaPanel(ctx(rol), fd(forma), d)).ok, rol).toBe(false);
      expect(d.aprobar).not.toHaveBeenCalled();
    }
  });

  it('guarda con el tenant de la SESIÓN y quien aprobó; la bitácora lleva el tema y los largos, jamás el texto', async () => {
    const d = deps();
    await aprobarRespuestaRapidaPanel(ctx('encargado'), fd({ ...forma, tenantId: 'otra-flota' }), d);
    expect(d.aprobar).toHaveBeenCalledWith('t1', { tema: 'tarifa', pregunta: forma.pregunta, texto: forma.texto, usuarioId: 'u1' });
    const llamada = JSON.stringify(d.bitacora.mock.calls[0][0]);
    expect(llamada).toContain('vigia.respuesta_rapida_aprobada');
    expect(llamada).not.toContain('cotización');
    expect(llamada).not.toContain('Monterrey');
  });

  it('rechaza lo inválido sin tocar la base: tema de queja, pregunta corta, texto vacío', async () => {
    for (const malo of [{ tema: 'queja' }, { pregunta: 'ab' }, { texto: '  ' }]) {
      const d = deps();
      expect((await aprobarRespuestaRapidaPanel(ctx('flota_admin'), fd({ ...forma, ...malo }), d)).ok).toBe(false);
      expect(d.aprobar).not.toHaveBeenCalled();
    }
  });

  it('el tope de la base y una base sin la 0647 vuelven como mensaje legible; un error inesperado no filtra el detalle', async () => {
    const tope = deps({ aprobar: vi.fn(async () => ({ ok: false as const, error: 'Ya tienes 200 respuestas rápidas aprobadas: retira alguna antes de agregar otra.' })) });
    expect(await aprobarRespuestaRapidaPanel(ctx('flota_admin'), fd(forma), tope)).toEqual({ ok: false, error: expect.stringContaining('200') });
    const roto = deps({ aprobar: vi.fn(async () => { throw new Error('connection refused 10.0.0.5'); }) });
    const r = await aprobarRespuestaRapidaPanel(ctx('flota_admin'), fd(forma), roto);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('10.0.0.5');
  });
});

describe('retirar una respuesta rápida', () => {
  it('mismo permiso, id válido y del tenant de la sesión; una que no existe o ya se retiró avisa', async () => {
    const d = deps();
    expect((await retirarRespuestaRapidaPanel(ctx('contador'), fd({ respuestaId: R }), d)).ok).toBe(false);
    expect((await retirarRespuestaRapidaPanel(ctx('encargado'), fd({ respuestaId: 'no-es-uuid' }), d)).ok).toBe(false);
    expect(d.retirar).not.toHaveBeenCalled();
    expect((await retirarRespuestaRapidaPanel(ctx('encargado'), fd({ respuestaId: R }), d)).ok).toBe(true);
    expect(d.retirar).toHaveBeenCalledWith('t1', R);
    const nada = deps({ retirar: vi.fn(async () => false) });
    expect((await retirarRespuestaRapidaPanel(ctx('encargado'), fd({ respuestaId: R }), nada)).ok).toBe(false);
    expect(nada.bitacora).not.toHaveBeenCalled();
  });
});
