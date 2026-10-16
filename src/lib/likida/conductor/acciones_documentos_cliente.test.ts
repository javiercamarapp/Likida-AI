import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./repo', () => ({ altaDocumentoCliente: vi.fn(), bajaDocumentoCliente: vi.fn() }));

const { altaDocumentoDelPanel, bajaDocumentoDelPanel } = await import('./acciones_documentos_cliente');

const alta = vi.fn();
const baja = vi.fn();
const deps = { alta, baja } as never;
const entrada = { clienteId: 'c1', nombre: 'Documento demo A', tipo: 'basico', requiereFirma: 'on' };
const ctx = { tenantId: 't1', rol: 'flota_admin' };

beforeEach(() => { alta.mockReset(); baja.mockReset(); });

describe('altaDocumentoDelPanel', () => {
  it('sin permiso (contador, operador, rol vacío) no escribe nada', async () => {
    for (const rol of ['contador', 'operador', '']) {
      expect((await altaDocumentoDelPanel({ tenantId: 't1', rol }, entrada, deps)).ok).toBe(false);
    }
    expect(alta).not.toHaveBeenCalled();
  });
  it('una entrada inválida no llega a la base y dice por qué', async () => {
    const r = await altaDocumentoDelPanel(ctx, { ...entrada, tipo: 'raro' }, deps);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/básico o complementario/) });
    expect(alta).not.toHaveBeenCalled();
  });
  it('el tenant sale del contexto (nunca del formulario) y manda el documento normalizado', async () => {
    alta.mockResolvedValue('ok');
    const r = await altaDocumentoDelPanel(ctx, { ...entrada, tenantId: 'otra-flota', nombre: '  Documento   demo A ' } as never, deps);
    expect(alta).toHaveBeenCalledWith('t1', { clienteId: 'c1', nombre: 'Documento demo A', tipo: 'basico', requiereFirma: true, requiereSello: false });
    expect(r).toMatchObject({ ok: true, mensaje: expect.stringMatching(/agregado como básico/) });
  });
  it('duplicado, cliente inexistente y tope se dicen en palabras', async () => {
    alta.mockResolvedValueOnce('duplicado'); alta.mockResolvedValueOnce('cliente_inexistente'); alta.mockResolvedValueOnce('tope');
    expect(await altaDocumentoDelPanel(ctx, entrada, deps)).toMatchObject({ ok: false, error: expect.stringMatching(/ya tiene un documento/) });
    expect(await altaDocumentoDelPanel(ctx, entrada, deps)).toMatchObject({ ok: false, error: expect.stringMatching(/No encuentro ese cliente/) });
    expect(await altaDocumentoDelPanel(ctx, entrada, deps)).toMatchObject({ ok: false, error: expect.stringMatching(/hasta 30/) });
  });
  it('si la base falla, no finge que guardó', async () => {
    alta.mockRejectedValue(new Error('timeout'));
    expect(await altaDocumentoDelPanel(ctx, entrada, deps)).toMatchObject({ ok: false, error: expect.stringMatching(/No pude guardarlo/) });
  });
});

describe('bajaDocumentoDelPanel', () => {
  it('sin permiso no borra; sin id no borra', async () => {
    expect((await bajaDocumentoDelPanel({ tenantId: 't1', rol: 'contador' }, { id: 'd1' }, deps)).ok).toBe(false);
    expect((await bajaDocumentoDelPanel(ctx, { id: '  ' }, deps)).ok).toBe(false);
    expect(baja).not.toHaveBeenCalled();
  });
  it('borra por id con el tenant de la sesión; un id que ya no existe se dice', async () => {
    baja.mockResolvedValueOnce(true); baja.mockResolvedValueOnce(false);
    expect(await bajaDocumentoDelPanel(ctx, { id: 'd1' }, deps)).toMatchObject({ ok: true });
    expect(baja).toHaveBeenCalledWith('t1', 'd1');
    expect(await bajaDocumentoDelPanel(ctx, { id: 'd2' }, deps)).toMatchObject({ ok: false, error: expect.stringMatching(/ya no existe/) });
  });
  it('si la base falla, lo dice', async () => {
    baja.mockRejectedValue(new Error('timeout'));
    expect(await bajaDocumentoDelPanel(ctx, { id: 'd1' }, deps)).toMatchObject({ ok: false, error: expect.stringMatching(/No pude quitarlo/) });
  });
});
