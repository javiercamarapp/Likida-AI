import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));

const { altaGrupoPanel, criticoGrupoPanel, borrarGrupoPanel, importarHistorialPanel, nombresDelEquipo, MAX_ARCHIVO_BYTES } = await import('./acciones');
type Deps = import('./acciones').DepsGrupos;

const G = '11111111-1111-4111-8111-111111111111';
const C = '22222222-2222-4222-8222-222222222222';
const dueno = { tenantId: 't1', rol: 'flota_admin', usuarioId: 'u1', email: 'a@b.mx' };
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

function deps(sobre: Partial<Deps> = {}): Deps & { bitacora: ReturnType<typeof vi.fn> } {
  return {
    crearGrupo: vi.fn(async () => ({ ok: true as const, id: G })),
    marcarCritico: vi.fn(async () => true),
    grupoDeFlota: vi.fn(async () => ({ id: G, nombre: 'Operación Cliente A' })),
    guardarImportacion: vi.fn(async () => ({ ok: true as const, id: 'imp-1' })),
    borrarGrupo: vi.fn(async () => true),
    bitacora: vi.fn(async () => true),
    ...sobre,
  } as never;
}

const CHAT = [
  '[12/09/2026, 10:23:45] Cliente Uno: ¿Dónde va mi viaje? llámame al 33 1234 5678',
  '[12/09/2026, 10:25:00] Ana Servicio: Va por Querétaro',
].join('\n');
const archivo = (txt: string, nombre = 'chat.txt') => ({ nombre, bytes: new TextEncoder().encode(txt) });

describe('permiso y entradas', () => {
  it('solo el dueño: contador, encargado y jefe de tráfico no dan de alta, marcan, borran ni importan', async () => {
    for (const rol of ['contador', 'encargado', 'jefe_trafico', 'vendedor']) {
      const d = deps();
      const ctx = { ...dueno, rol };
      expect((await altaGrupoPanel(ctx, fd({ clienteId: C, nombre: 'X' }), d)).ok).toBe(false);
      expect((await criticoGrupoPanel(ctx, fd({ grupoId: G, critico: 'si' }), d)).ok).toBe(false);
      expect((await borrarGrupoPanel(ctx, fd({ grupoId: G }), d)).ok).toBe(false);
      expect((await importarHistorialPanel(ctx, fd({ grupoId: G, equipo: 'Ana Servicio' }), archivo(CHAT), d)).ok).toBe(false);
      expect(d.crearGrupo).not.toHaveBeenCalled();
      expect(d.guardarImportacion).not.toHaveBeenCalled();
    }
  });

  it('alta: valida cliente y nombre, usa el tenant de la sesión y deja bitácora sin texto del chat', async () => {
    const d = deps();
    expect((await altaGrupoPanel(dueno, fd({ clienteId: 'x', nombre: 'A' }), d)).ok).toBe(false);
    expect((await altaGrupoPanel(dueno, fd({ clienteId: C, nombre: '  ' }), d)).ok).toBe(false);
    const r = await altaGrupoPanel(dueno, fd({ clienteId: C, nombre: '  Operación   Cliente A ', critico: 'on', tenantId: 'ajeno' }), d);
    expect(r.ok).toBe(true);
    expect(d.crearGrupo).toHaveBeenCalledWith('t1', { clienteId: C, nombre: 'Operación Cliente A', critico: true });
    expect(d.bitacora).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', accion: 'vigia.grupo_creado', entidad: 'vigia_grupo', entidadId: G }));
  });

  it('marcar crítico y borrar: grupo inexistente en la flota se dice, y no hay bitácora', async () => {
    const d = deps({ marcarCritico: vi.fn(async () => false), borrarGrupo: vi.fn(async () => false) });
    expect(await criticoGrupoPanel(dueno, fd({ grupoId: G, critico: 'si' }), d)).toMatchObject({ ok: false });
    expect(await borrarGrupoPanel(dueno, fd({ grupoId: G }), d)).toMatchObject({ ok: false });
    expect(d.bitacora).not.toHaveBeenCalled();
    const ok = deps();
    expect(await criticoGrupoPanel(dueno, fd({ grupoId: G, critico: 'si' }), ok)).toMatchObject({ ok: true, mensaje: expect.stringContaining('crítico') });
    expect(ok.marcarCritico).toHaveBeenCalledWith('t1', G, true);
  });

  it('nombresDelEquipo limpia, deduplica y acota', () => {
    expect(nombresDelEquipo(' Ana  Servicio, Luis ;\nAna Servicio,, ')).toEqual(['Ana Servicio', 'Luis']);
  });
});

describe('importarHistorialPanel', () => {
  it('guarda lo leído SIN teléfonos ni nombres, con la sal de la flota, y la bitácora solo lleva conteos', async () => {
    const d = deps();
    const r = await importarHistorialPanel(dueno, fd({ grupoId: G, equipo: 'Ana Servicio' }), archivo(CHAT), d);
    expect(r).toMatchObject({ ok: true, mensaje: expect.stringContaining('2 mensajes de 2 personas') });
    const [tenant, entrada] = (d.guardarImportacion as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(tenant).toBe('t1');
    expect(entrada.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(entrada.mensajes.map((m: { rol: string }) => m.rol)).toEqual(['cliente', 'equipo']);
    expect(JSON.stringify(entrada)).not.toMatch(/Cliente Uno|Ana Servicio|1234 5678/);
    const b = d.bitacora.mock.calls[0][0];
    expect(b).toMatchObject({ accion: 'vigia.historial_importado', entidadId: 'imp-1' });
    expect(JSON.stringify(b)).not.toMatch(/Querétaro|Cliente Uno/);
  });

  it('exige los nombres del equipo, un archivo, un tipo válido y un tamaño razonable', async () => {
    const d = deps();
    expect(await importarHistorialPanel(dueno, fd({ grupoId: G, equipo: '' }), archivo(CHAT), d)).toMatchObject({ ok: false });
    expect(await importarHistorialPanel(dueno, fd({ grupoId: G, equipo: 'Ana' }), null, d)).toMatchObject({ ok: false });
    expect(await importarHistorialPanel(dueno, fd({ grupoId: G, equipo: 'Ana' }), archivo(CHAT, 'chat.pdf'), d)).toMatchObject({ ok: false });
    expect(await importarHistorialPanel(dueno, fd({ grupoId: 'no' , equipo: 'Ana' }), archivo(CHAT), d)).toMatchObject({ ok: false });
    expect(await importarHistorialPanel(dueno, fd({ grupoId: G, equipo: 'Ana' }), { nombre: 'a.txt', bytes: new Uint8Array(MAX_ARCHIVO_BYTES + 1) }, d)).toMatchObject({ ok: false, error: expect.stringContaining('9 MB') });
    expect(d.guardarImportacion).not.toHaveBeenCalled();
  });

  it('un archivo que no es un chat, o donde nadie (o todos) es del equipo, se rechaza con su causa', async () => {
    const d = deps();
    expect(await importarHistorialPanel(dueno, fd({ grupoId: G, equipo: 'Ana Servicio' }), archivo('hola mundo'), d)).toMatchObject({ ok: false, error: expect.stringContaining('ningún mensaje') });
    expect(await importarHistorialPanel(dueno, fd({ grupoId: G, equipo: 'Nadie Así' }), archivo(CHAT), d)).toMatchObject({ ok: false, error: expect.stringContaining('Ningún mensaje coincide') });
    expect(await importarHistorialPanel(dueno, fd({ grupoId: G, equipo: 'Ana Servicio, Cliente Uno' }), archivo(CHAT), d)).toMatchObject({ ok: false, error: expect.stringContaining('Todos los mensajes') });
    expect(d.guardarImportacion).not.toHaveBeenCalled();
  });

  it('el mismo chat dos veces no se duplica; un grupo ajeno no existe; una falla de la base no filtra el error crudo', async () => {
    const dup = deps({ guardarImportacion: vi.fn(async () => ({ ok: false as const, duplicada: true as const })) });
    expect(await importarHistorialPanel(dueno, fd({ grupoId: G, equipo: 'Ana Servicio' }), archivo(CHAT), dup)).toMatchObject({ ok: false, error: expect.stringContaining('ya se había subido') });
    const ajeno = deps({ grupoDeFlota: vi.fn(async () => null) });
    expect(await importarHistorialPanel(dueno, fd({ grupoId: G, equipo: 'Ana Servicio' }), archivo(CHAT), ajeno)).toMatchObject({ ok: false, error: expect.stringContaining('No encuentro') });
    const caida = deps({ guardarImportacion: vi.fn(async () => { throw new Error('connection refused 10.0.0.5'); }) });
    const r = await importarHistorialPanel(dueno, fd({ grupoId: G, equipo: 'Ana Servicio' }), archivo(CHAT), caida);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('10.0.0.5');
  });
});
