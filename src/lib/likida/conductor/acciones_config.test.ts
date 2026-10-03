import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { guardarConfigDelPanel } = await import('./acciones_config');
const { CONFIG_CONDUCTOR_DEFAULT } = await import('./config');
const { valoresDeForma } = await import('./config_forma');
type Deps = import('./acciones_config').DepsConfigPanel;

const ctx = (rol = 'flota_admin') => ({ tenantId: 't1', rol, usuarioId: 'u1', email: 'dueno@flota.test' });

function formulario(extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(valoresDeForma({ ...CONFIG_CONDUCTOR_DEFAULT }))) fd.set(`f_${k}`, v);
  for (const k of ['activo', 'usarLlm', 'confirmarAlChofer', 'validarUbicacion', 'pedirUbicacion', 'fotoRegistraHito', 'detectarHitosGps']) fd.set(`f_${k}`, 'si');
  for (const d of [1, 2, 3, 4, 5, 6, 7]) fd.set(`f_dia_${d}`, 'si');
  fd.set('c_filas', '3');
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

function deps(o: Partial<Deps> = {}): Deps & { guardado: Array<{ tenant: string; config: unknown; contactos: unknown }>; bitacora: ReturnType<typeof vi.fn> } {
  const guardado: Array<{ tenant: string; config: unknown; contactos: unknown }> = [];
  const bitacora = vi.fn(async () => true);
  return {
    leer: async () => ({ ...CONFIG_CONDUCTOR_DEFAULT }),
    contactos: async () => [],
    guardar: async (tenant: string, config: unknown, contactos: unknown) => { guardado.push({ tenant, config, contactos }); return 'ok' as const; },
    bitacora: bitacora as unknown as Deps['bitacora'],
    ...o,
    guardado,
  } as never;
}

describe('guardar la configuración desde el panel', () => {
  it('solo el dueño: el jefe de tráfico, el contador y un rol desconocido NO guardan (y nada toca la base)', async () => {
    for (const rol of ['encargado', 'contador', 'vendedor', 'inventado', '']) {
      const d = deps();
      const r = await guardarConfigDelPanel(ctx(rol), formulario(), d);
      expect(r, rol).toMatchObject({ ok: false, error: expect.stringContaining('Solo el dueño') });
      expect(d.guardado).toHaveLength(0);
    }
  });

  it('el dueño guarda: valida con la misma regla del PUT, guarda la config completa con SU flota y deja bitácora de llaves', async () => {
    const d = deps();
    const r = await guardarConfigDelPanel(ctx(), formulario({ f_topeDiarioChofer: '8', f_solicitudesMin: '0, 10, 20', f_escalarTrasMin: '60' }), d);
    expect(r).toMatchObject({ ok: true, mensaje: expect.stringContaining('Configuración guardada') });
    expect(d.guardado).toHaveLength(1);
    expect(d.guardado[0]).toMatchObject({ tenant: 't1', config: { topeDiarioChofer: 8, solicitudesMin: [0, 10, 20], escalarTrasMin: 60 }, contactos: [] });
    const [entrada] = d.bitacora.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(entrada).toMatchObject({
      tenantId: 't1', actor: { id: 'u1', email: 'dueno@flota.test' }, accion: 'conductor.config_guardada', entidad: 'conductor_config',
      detalle: { llaves: ['avisarOficinaLlegada', 'escalarTrasMin', 'solicitudesMin', 'topeDiarioChofer'].filter((k) => k !== 'avisarOficinaLlegada'), contactos: 0, contactosCambiaron: false },
    });
  });

  it('la bitácora lleva conteos, NUNCA teléfonos ni nombres', async () => {
    const d = deps();
    await guardarConfigDelPanel(ctx(), formulario({ c_filas: '4', c_nivel_0: '1', c_nombre_0: 'Patio Norte', c_tel_0: '3312345678', c_patio_0: '' }), d);
    expect(JSON.stringify(d.bitacora.mock.calls)).not.toMatch(/3312345678|Patio Norte/);
    expect(d.guardado[0].contactos).toEqual([{ nivel: 1, nombre: 'Patio Norte', telefono: '523312345678', terminalId: null }]);
  });

  it('un valor inválido se dice en palabras y NO se guarda NADA', async () => {
    const d = deps();
    const r = await guardarConfigDelPanel(ctx(), formulario({ f_horaInicio: '22', f_horaFin: '6' }), d);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('terminar después de empezar') });
    expect(d.guardado).toHaveLength(0);
    expect(d.bitacora).not.toHaveBeenCalled();
  });

  it('sin cambios lo dice (no inventa «guardado»)', async () => {
    const d = deps();
    const r = await guardarConfigDelPanel(ctx(), formulario(), d);
    expect(r).toMatchObject({ ok: true, mensaje: expect.stringContaining('No había cambios') });
  });

  it('un patio de otra flota (la base lo rechaza) se dice y no se anota como hecho', async () => {
    const d = deps({ guardar: async () => 'terminal_ajena' });
    const r = await guardarConfigDelPanel(ctx(), formulario({ c_filas: '4', c_nivel_0: '1', c_nombre_0: 'X', c_tel_0: '3312345678', c_patio_0: '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001' }), d);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('patios elegidos no es de tu flota') });
    expect(d.bitacora).not.toHaveBeenCalled();
  });

  it('la base caída: dice «no pude» y no revienta', async () => {
    const d = deps({ leer: async () => { throw new Error('caída'); } });
    expect(await guardarConfigDelPanel(ctx(), formulario(), d)).toMatchObject({ ok: false, error: expect.stringContaining('No pude guardarlo') });
  });

  it('la tenant sale de la SESIÓN: un tenant_id en el formulario se ignora', async () => {
    const d = deps();
    await guardarConfigDelPanel(ctx(), formulario({ tenant_id: 'otra-flota', tenantId: 'otra-flota', f_topeDiarioChofer: '9' }), d);
    expect(d.guardado[0].tenant).toBe('t1');
  });
});
