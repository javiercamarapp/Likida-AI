import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { enviarResumenPanel, revisarPanel, recortarPorCorte } = await import('./acciones');
type Deps = import('./acciones').DepsSinAtender;
const { alerta, resultado, crudos, TENANT_A, TENANT_B, CLIENTE_A, AHORA_DIA, AHORA_NOCHE } = await import('./fixtures');

const ctx = (rol = 'flota_admin', tenantId = TENANT_A) => ({ tenantId, rol, usuarioId: 'u1', email: 'u@ejemplo.test', liga: 'https://app.ejemplo.test/x' });
const form = (o: Record<string, string> = {}) => { const fd = new FormData(); for (const [k, v] of Object.entries(o)) fd.set(k, v); return fd; };

function deps(p: Partial<Deps> = {}): Deps & { llamadas: { leerChats: string[] } } {
  const llamadas = { leerChats: [] as string[] };
  const d: Deps = {
    leerChats: async (t) => { llamadas.leerChats.push(t); return { chats: [{ clienteId: CLIENTE_A, chat: { chatId: 'g1', nombre: 'Grupo A', critico: false, mensajes: [] } }], gruposOmitidos: 0 }; },
    leerPlazos: async () => ({ slaRespuestaMin: 30, slaCriticoMin: 10 }),
    leerDestinatarios: async () => crudos(),
    puertoConfig: { leer: async () => null },
    detectar: () => resultado([alerta()]),
    habilitado: async () => ({ ok: true }),
    enviar: vi.fn(async (e) => ({ ok: true as const, destinatarios: e.destinatarios.length, alertas: e.resultado.alertas.length, clave: 'k' })),
    bitacora: vi.fn(async () => undefined) as never,
    ahora: () => AHORA_DIA,
    ...p,
  };
  return Object.assign(d, { llamadas });
}

describe('enviar el resumen (acción)', () => {
  it('solo quien administra: otro rol no lee ni manda nada', async () => {
    const d = deps();
    const r = await enviarResumenPanel(ctx('encargado'), form({ fechaCorte: '2026-11-01' }), d);
    expect(r.ok).toBe(false);
    expect(d.llamadas.leerChats).toEqual([]);
    expect(d.enviar).not.toHaveBeenCalled();
  });
  it('apagado: no lee chats, no manda, lo dice', async () => {
    const d = deps({ habilitado: async () => ({ ok: false, motivo: 'bandera_apagada' }) });
    const r = await enviarResumenPanel(ctx(), form({ fechaCorte: '2026-11-01' }), d);
    expect(r).toMatchObject({ ok: false });
    expect(d.llamadas.leerChats).toEqual([]);
    expect(d.enviar).not.toHaveBeenCalled();
  });
  it('sin fecha de corte no se manda', async () => {
    const d = deps();
    expect((await enviarResumenPanel(ctx(), form(), d)).ok).toBe(false);
    expect(d.enviar).not.toHaveBeenCalled();
  });
  it('sin destinatarios con correo: no se manda y se asienta', async () => {
    const d = deps({ leerDestinatarios: async () => crudos({ servicio: [], nivel1: [], nivel2: [] }), enviar: vi.fn(async () => ({ ok: false as const, motivo: 'sin_destinatarios' as const })) });
    const r = await enviarResumenPanel(ctx(), form({ fechaCorte: '2026-11-01' }), d);
    expect(r).toMatchObject({ ok: false });
    expect((d.enviar as ReturnType<typeof vi.fn>).mock.calls[0]![0].destinatarios).toEqual([]);
  });
  it('de día y de noche el turno cambia y la guardia de noche solo entra de noche', async () => {
    const dia = deps();
    await enviarResumenPanel(ctx(), form({ fechaCorte: '2026-11-01' }), dia);
    const eDia = (dia.enviar as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const noche = deps({ ahora: () => AHORA_NOCHE });
    await enviarResumenPanel(ctx(), form({ fechaCorte: '2026-11-01' }), noche);
    const eNoche = (noche.enviar as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(eDia.turno).toBe('dia');
    expect(eNoche.turno).toBe('noche');
    expect(eDia.destinatarios.map((x: { correo: string }) => x.correo)).not.toContain('noche@ejemplo.test');
    expect(eNoche.destinatarios.map((x: { correo: string }) => x.correo)).toContain('noche@ejemplo.test');
  });
  it('éxito: bitácora con conteos y sin texto; error del proveedor también se asienta y se explica', async () => {
    const ok = deps();
    const r = await enviarResumenPanel(ctx(), form({ fechaCorte: '2026-11-01' }), ok);
    expect(r.ok).toBe(true);
    const asiento = (ok.bitacora as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(asiento.tenantId).toBe(TENANT_A);
    expect(JSON.stringify(asiento)).not.toMatch(/texto|mensaje:/i);
    const mal = deps({ enviar: vi.fn(async () => ({ ok: false as const, motivo: 'rechazado' as const })) });
    const r2 = await enviarResumenPanel(ctx(), form({ fechaCorte: '2026-11-01' }), mal);
    expect(r2).toMatchObject({ ok: false });
    expect((mal.bitacora as ReturnType<typeof vi.fn>).mock.calls[0]![0].detalle.enviado).toBe(false);
  });
  it('aislamiento: lee y asienta solo con el tenant de la sesión, nunca uno del formulario', async () => {
    const d = deps();
    await enviarResumenPanel(ctx('flota_admin', TENANT_A), form({ fechaCorte: '2026-11-01', tenantId: TENANT_B, tenant: TENANT_B }), d);
    expect(d.llamadas.leerChats).toEqual([TENANT_A]);
    expect((d.enviar as ReturnType<typeof vi.fn>).mock.calls[0]![0].tenantId).toBe(TENANT_A);
    expect((d.bitacora as ReturnType<typeof vi.fn>).mock.calls[0]![0].tenantId).toBe(TENANT_A);
  });
  it('la fecha de corte descarta conversaciones anteriores', () => {
    const r = recortarPorCorte(resultado([alerta({ desde: '2026-10-01T16:00:00.000Z', clave: 'vieja' }), alerta({ chatId: 'g2', clave: 'nueva' })]), 'America/Mexico_City', '2026-11-01');
    expect(r.alertas.map((a) => a.clave)).toEqual(['nueva']);
    expect(r.resumen.alertas).toBe(1);
  });
});

describe('revisar (acción)', () => {
  it('la prueba no guarda ni manda nada y usa los plazos de la flota', async () => {
    let cfgVisto: { umbralMin: number; umbralCriticoMin: number } | null = null;
    const d = deps({ detectar: (_c, cfg) => { cfgVisto = cfg; return resultado([alerta()]); } });
    const r = await revisarPanel(ctx('encargado'), form({ umbralUrgenteMin: '5' }), d);
    expect(r?.ok).toBe(true);
    expect(cfgVisto).toMatchObject({ umbralMin: 30, umbralCriticoMin: 10 });
    expect(d.enviar).not.toHaveBeenCalled();
    expect(d.bitacora).not.toHaveBeenCalled();
  });
  it('un número ilegible se rechaza con mensaje llano', async () => {
    expect(await revisarPanel(ctx(), form({ umbralMin: 'abc' }), deps())).toMatchObject({ ok: false });
  });
  it('base sin las tablas: lo dice en vez de enseñar vacío', async () => {
    const r = await revisarPanel(ctx(), form(), deps({ leerChats: async () => null }));
    expect(r).toMatchObject({ ok: false });
  });
  it('nombres de equipo que no coinciden con nadie: avisa', async () => {
    const r = await revisarPanel(ctx(), form({ equipo: 'Operador 1' }), deps());
    expect(r?.ok && r.notas.join(' ')).toContain('Ningún mensaje coincide');
  });
});
