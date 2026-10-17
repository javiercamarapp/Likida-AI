import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { guardarConfigDelPanel } = await import('./acciones_config');
const { CONFIG_CONDUCTOR_DEFAULT } = await import('./config');
const { valoresDeForma } = await import('./config_forma');
const { evaluarPreflight } = await import('./preflight_piloto');
type Deps = import('./acciones_config').DepsConfigPanel;
type ResultadoPreflight = import('./preflight_piloto').ResultadoPreflight;

// T-A5-25: la compuerta para encender `avisarSenalVida` en el guardado del panel.
const ctx = (rol = 'flota_admin') => ({ tenantId: 't1', rol, usuarioId: 'u1', email: 'dueno@flota.test' });
function formulario(extra: Record<string, string> = {}, senalVida = true): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(valoresDeForma({ ...CONFIG_CONDUCTOR_DEFAULT }))) fd.set(`f_${k}`, v);
  for (const k of ['activo', 'usarLlm', 'confirmarAlChofer', 'validarUbicacion', 'pedirUbicacion', 'fotoRegistraHito', 'detectarHitosGps']) fd.set(`f_${k}`, 'si');
  if (senalVida) fd.set('f_avisarSenalVida', 'si');
  for (const d of [1, 2, 3, 4, 5, 6, 7]) fd.set(`f_dia_${d}`, 'si');
  fd.set('c_filas', '3');
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}
const rojo = (): ResultadoPreflight => evaluarPreflight({
  config: { activo: true, perfilSeguimiento: 'esenciales', solicitudesMin: [0, 15, 30, 45], cohortePiloto: 'sin_tableta_ni_macros' }, zonaDeclarada: 'America/Mexico_City',
  voluntarios: [], viajes: [], posicionesPorUnidad: {}, contactos: [], aprobadas: [],
});
const verde = (): ResultadoPreflight => ({ comprobaciones: [], bloqueos: [], lista: true });

function deps(o: Partial<Deps> & { actual?: Record<string, unknown> } = {}) {
  const guardado: unknown[] = [];
  const bitacora = vi.fn(async () => true);
  const { actual, ...resto } = o;
  const d = {
    leer: async () => ({ ...CONFIG_CONDUCTOR_DEFAULT, ...(actual ?? {}) }), contactos: async () => [],
    guardar: async (_t: string, config: unknown) => { guardado.push(config); return 'ok' as const; },
    bitacora, preflight: vi.fn(async () => rojo()), ...resto,
  };
  return Object.assign(d, { guardado, bitacora }) as unknown as Deps & { guardado: unknown[]; bitacora: ReturnType<typeof vi.fn>; preflight: ReturnType<typeof vi.fn> };
}

describe('encender la señal de vida desde el panel', () => {
  it('con el preflight en rojo: rechaza con «Aún no se puede encender: falta X.» y no guarda nada', async () => {
    const d = deps();
    const r = await guardarConfigDelPanel(ctx(), formulario(), d);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/^Aún no se puede encender: falta «/) });
    expect(d.guardado).toHaveLength(0);
    expect(d.bitacora).not.toHaveBeenCalled();
    expect(d.preflight).toHaveBeenCalledWith('t1', expect.objectContaining({ avisarSenalVida: true }));
  });

  it('con el preflight en verde: guarda con la señal encendida', async () => {
    const d = deps({ preflight: vi.fn(async () => verde()) });
    const r = await guardarConfigDelPanel(ctx(), formulario(), d);
    expect(r).toMatchObject({ ok: true });
    expect(d.guardado[0]).toMatchObject({ avisarSenalVida: true });
  });

  it('el dueño NO puede forzar; el superadmin sí, y queda en la bitácora', async () => {
    const dueno = deps();
    expect(await guardarConfigDelPanel(ctx('flota_admin'), formulario({ forzarPreflight: 'si' }), dueno)).toMatchObject({ ok: false });
    expect(dueno.guardado).toHaveLength(0);
    const soporte = deps();
    expect(await guardarConfigDelPanel(ctx('superadmin'), formulario({ forzarPreflight: 'si' }), soporte)).toMatchObject({ ok: true });
    expect(soporte.guardado[0]).toMatchObject({ avisarSenalVida: true });
    expect(soporte.preflight).not.toHaveBeenCalled();
    const [entrada] = soporte.bitacora.mock.calls[0] as unknown as [{ detalle: Record<string, unknown> }];
    expect(entrada.detalle).toMatchObject({ preflightForzado: true });
    // El superadmin sin la casilla pasa por la compuerta como todos.
    expect(await guardarConfigDelPanel(ctx('superadmin'), formulario(), deps())).toMatchObject({ ok: false });
  });

  it('solo se evalúa al ENCENDER: apagada, o ya encendida, no consulta el preflight', async () => {
    const apagada = deps();
    expect(await guardarConfigDelPanel(ctx(), formulario({}, false), apagada)).toMatchObject({ ok: true });
    expect(apagada.preflight).not.toHaveBeenCalled();
    const yaEncendida = deps({ actual: { avisarSenalVida: true } });
    expect(await guardarConfigDelPanel(ctx(), formulario({ f_topeDiarioChofer: '8' }), yaEncendida)).toMatchObject({ ok: true });
    expect(yaEncendida.preflight).not.toHaveBeenCalled();
  });

  it('apagar la señal de vida nunca se bloquea, aunque el preflight esté en rojo', async () => {
    const d = deps({ actual: { avisarSenalVida: true } });
    expect(await guardarConfigDelPanel(ctx(), formulario({}, false), d)).toMatchObject({ ok: true });
    expect(d.guardado[0]).toMatchObject({ avisarSenalVida: false });
  });

  it('si el preflight no se puede leer, falla cerrado con el mensaje genérico y no guarda', async () => {
    const d = deps({ preflight: async () => { throw new Error('base caída'); } });
    expect(await guardarConfigDelPanel(ctx(), formulario(), d)).toMatchObject({ ok: false, error: expect.stringContaining('No pude guardarlo') });
    expect(d.guardado).toHaveLength(0);
  });
});

// T-A5-64: `preflightReal` (el que usa el panel) arma el config del preflight CON la cohorte de la config que se quiere guardar.
describe('preflightReal y la cohorte del piloto', () => {
  it('pasa cohortePiloto de la config al preflight: con cohorte la comprobacion `cohorte` queda ok; sin ella, falta', async () => {
    vi.resetModules();
    const visto: unknown[] = [];
    vi.doMock('./repo', async (orig) => ({
      ...(await orig<typeof import('./repo')>()),
      leerDatosPreflight: async () => ({ config: { activo: true, perfilSeguimiento: 'esenciales', solicitudesMin: [0, 15, 30, 45], cohortePiloto: null }, zonaDeclarada: 'America/Mexico_City', voluntarios: [], viajes: [], posicionesPorUnidad: {}, contactos: [], aprobadas: [] }),
    }));
    const { preflightReal } = await import('./acciones_config');
    const con = await preflightReal('t1', { ...CONFIG_CONDUCTOR_DEFAULT, cohortePiloto: 'sin_tableta_ni_macros' });
    const sin = await preflightReal('t1', { ...CONFIG_CONDUCTOR_DEFAULT });
    visto.push(con, sin);
    expect(con.comprobaciones.find((x) => x.id === 'cohorte')?.estado).toBe('ok');
    expect(sin.comprobaciones.find((x) => x.id === 'cohorte')?.estado).toBe('falta');
    vi.doUnmock('./repo');
  });
});
