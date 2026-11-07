import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { TZ_MX } = await import('@/lib/formato');
const { enviarResumenPanel, guardarConfigPanel, revisarPanel, revisarSinAtender, recortarPorCorte, resumenSinAtenderDeGrupo, resumenSinAtenderDeGrupos } = await import('./acciones');
const { resumenHabilitadoParaFlota } = await import('./interruptor');
const { copiaConfigGuardadaPorOmision } = await import('../sin_atender/config_guardada');
const { salDeFlota, hashAutor } = await import('../historial/export_whatsapp');
type Deps = import('./acciones').DepsSinAtender;
const { detectarSinAtender } = await import('../sin_atender/detectar');
const { alerta, resultado, crudos, TENANT_A, TENANT_B, CLIENTE_A, AHORA_DIA, AHORA_NOCHE } = await import('./fixtures');

const ctx = (rol = 'flota_admin', tenantId = TENANT_A) => ({ tenantId, rol, usuarioId: 'u1', email: 'u@ejemplo.test', liga: 'https://app.ejemplo.test/x' });
const form = (o: Record<string, string> = {}) => { const fd = new FormData(); for (const [k, v] of Object.entries(o)) fd.set(k, v); return fd; };

function deps(p: Partial<Deps> = {}): Deps & { llamadas: { leerChats: string[] } } {
  const llamadas = { leerChats: [] as string[] };
  const d: Deps = {
    leerChats: async (t) => { llamadas.leerChats.push(t); return { chats: [{ clienteId: CLIENTE_A, chat: { chatId: 'g1', nombre: 'Grupo A', critico: false, mensajes: [] } }], gruposOmitidos: 0 }; },
    leerPlazos: async () => ({ slaRespuestaMin: 30, slaCriticoMin: 10 }),
    leerDestinatarios: async () => crudos(),
    puertoConfig: { leer: async () => null, guardar: vi.fn(async () => ({ ok: true as const })) },
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
    const r = recortarPorCorte(resultado([alerta({ desde: '2026-10-01T16:00:00.000Z', clave: 'vieja' }), alerta({ chatId: 'g2', clave: 'nueva' })]), TZ_MX, '2026-11-01');
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

describe('revisión tras importar un chat', () => {
  it('cuenta solo las alertas del grupo importado, con el equipo declarado y el tenant de la sesión', async () => {
    let equipoVisto: readonly string[] | undefined;
    const d = deps({
      detectar: (_c, cfg) => { equipoVisto = cfg.equipoHashes; return resultado([alerta({ chatId: 'g1', nivel: 'alta' }), alerta({ chatId: 'g1', nivel: 'normal', clave: 'otra' }), alerta({ chatId: 'g2', clave: 'ajena' })]); },
    });
    const r = await resumenSinAtenderDeGrupo(TENANT_A, 'g1', ['Operador 1'], d);
    expect(r).toEqual({ alertas: 2, altas: 1 });
    expect(equipoVisto).toHaveLength(1);
    expect(d.llamadas.leerChats).toEqual([TENANT_A]);
    expect(d.enviar).not.toHaveBeenCalled();
    expect(d.bitacora).not.toHaveBeenCalled();
  });
  it('varios grupos: UNA sola lectura de la flota sin importar cuántos grupos se pidan (R7-A4)', async () => {
    const d = deps({ detectar: () => resultado([alerta({ chatId: 'g1', nivel: 'alta' }), alerta({ chatId: 'g2', clave: 'b' }), alerta({ chatId: 'g9', clave: 'c' })]) });
    const r = await resumenSinAtenderDeGrupos(TENANT_A, ['g1', 'g2', 'g3', 'g1'], ['Operador 1'], d);
    expect(d.llamadas.leerChats).toEqual([TENANT_A]);
    expect([...r!.entries()]).toEqual([['g1', { alertas: 1, altas: 1 }], ['g2', { alertas: 1, altas: 0 }], ['g3', { alertas: 0, altas: 0 }]]);
  });
  it('si no se puede revisar devuelve null, nunca lanza', async () => {
    expect(await resumenSinAtenderDeGrupo(TENANT_A, 'g1', [], deps({ leerChats: async () => null }))).toBeNull();
    expect(await resumenSinAtenderDeGrupo(TENANT_A, 'g1', [], deps({ leerChats: async () => { throw new Error('boom'); } }))).toBeNull();
  });
});

const formaGuardar = (o: Record<string, string> = {}) => form({ insistenciaMin: '3', umbralUrgenteMin: '15', equipo: 'Operador 1, Operador 2', palabrasClave: 'retraso', resumenCorreo: 'on', ...o });

describe('guardar la configuración de la flota (acción)', () => {
  it('solo quien administra: otro rol no guarda ni lee nada', async () => {
    const d = deps();
    const r = await guardarConfigPanel(ctx('encargado'), formaGuardar(), d);
    expect(r).toMatchObject({ ok: false });
    expect(d.puertoConfig.guardar).not.toHaveBeenCalled();
    expect(d.bitacora).not.toHaveBeenCalled();
  });
  it('rangos inválidos: se rechaza con mensaje llano y no se guarda', async () => {
    const d = deps();
    const malos: Array<Record<string, string>> = [{ insistenciaMin: '99' }, { umbralUrgenteMin: '0' }, { umbralUrgenteMin: '2000' }, { insistenciaMin: 'x' }];
    for (const malo of malos) {
      expect((await guardarConfigPanel(ctx(), formaGuardar(malo), d)).ok).toBe(false);
    }
    expect(d.puertoConfig.guardar).not.toHaveBeenCalled();
  });
  it('guarda con el tenant y el usuario de la sesión (nunca del formulario) y asienta SOLO conteos, sin nombres', async () => {
    const d = deps();
    const r = await guardarConfigPanel(ctx('flota_admin', TENANT_A), formaGuardar({ tenantId: TENANT_B, tenant: TENANT_B }), d);
    expect(r.ok).toBe(true);
    const guardar = d.puertoConfig.guardar as ReturnType<typeof vi.fn>;
    expect(guardar).toHaveBeenCalledTimes(1);
    expect(guardar.mock.calls[0]![0]).toBe(TENANT_A);
    expect(guardar.mock.calls[0]![1]).toBe('u1');
    expect(guardar.mock.calls[0]![2]).toMatchObject({ insistenciaMin: 3, umbralUrgenteMin: 15, equipoNombres: ['Operador 1', 'Operador 2'], resumenCorreoHabilitado: true });
    const asiento = (d.bitacora as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(asiento.tenantId).toBe(TENANT_A);
    expect(asiento.detalle).toMatchObject({ equipo: 2, palabrasClave: 1, resumenCorreo: true });
    expect(JSON.stringify(asiento)).not.toContain('Operador');
    expect(d.llamadas.leerChats).toEqual([]);
  });
  it('base sin la tabla: lo dice y no asienta un guardado que no ocurrió', async () => {
    const d = deps({ puertoConfig: { leer: async () => null, guardar: async () => ({ ok: false as const, error: 'La configuración de esta pantalla todavía no está disponible en tu cuenta.' }) } });
    const r = await guardarConfigPanel(ctx(), formaGuardar(), d);
    expect(r).toMatchObject({ ok: false });
    expect(d.bitacora).not.toHaveBeenCalled();
  });
  it('si la bitácora falla después de guardar, devuelve ok (ya quedó guardado)', async () => {
    const d = deps({ bitacora: vi.fn(async () => { throw new Error('boom'); }) as never });
    expect(await guardarConfigPanel(ctx(), formaGuardar(), d)).toMatchObject({ ok: true });
    expect(d.puertoConfig.guardar).toHaveBeenCalledTimes(1);
  });
  it('si la base falla no lanza: explica', async () => {
    const d = deps({ puertoConfig: { leer: async () => null, guardar: async () => { throw new Error('boom'); } } });
    expect(await guardarConfigPanel(ctx(), formaGuardar(), d)).toMatchObject({ ok: false });
  });
});

describe('la revisión usa lo guardado por la flota', () => {
  it('el motor recibe equipo, palabras, horario e insistencia guardados; el equipo se une con lo escrito en la prueba', async () => {
    const guardada = { ...copiaConfigGuardadaPorOmision(), horarioAtencion: { desdeHora: 8, hastaHora: 18 }, palabrasClave: ['retraso'], equipoNombres: ['Operador 1'], insistenciaMin: 4, umbralUrgenteMin: 20 };
    let visto: import('./motor').ConfigSinAtender | null = null;
    const d = deps({ puertoConfig: { leer: async () => guardada, guardar: vi.fn() as never }, detectar: (_c, cfg) => { visto = cfg; return resultado([]); } });
    const r = await revisarSinAtender(TENANT_A, { equipoNombres: ['Operador 2'] }, 0, d);
    expect(r.ok).toBe(true);
    expect(visto).toMatchObject({ horarioAtencion: { desdeHora: 8, hastaHora: 18 }, palabrasClave: ['retraso'], insistenciaMin: 4, umbralUrgenteMin: 20 });
    const sal = salDeFlota(TENANT_A);
    expect([...visto!.equipoHashes].sort()).toEqual([hashAutor(sal, 'Operador 1'), hashAutor(sal, 'Operador 2')].sort());
  });
  it('de punta a punta con el detector real: la espera de la noche no cuenta con el horario guardado', async () => {
    // Mensaje del cliente miércoles 22:00 (hora de México); el equipo había contestado antes. Plazo de 30 min.
    const chat = { chatId: 'g1', nombre: 'Grupo A', critico: false, mensajes: [
      { enviadoEn: '2026-11-05T03:00:00.000Z', rol: 'equipo' as const, autorHash: 'h-equipo', texto: 'listo' },
      { enviadoEn: '2026-11-05T04:00:00.000Z', rol: 'cliente' as const, autorHash: 'h-cliente', texto: 'necesito el estatus del viaje' },
    ] };
    const leerChats = async () => ({ chats: [{ clienteId: CLIENTE_A, chat }], gruposOmitidos: 0 });
    const conHorario = { ...copiaConfigGuardadaPorOmision(), horarioAtencion: { desdeHora: 8, hastaHora: 18 } };
    const al = (ahora: number, guardada: typeof conHorario | null) => revisarSinAtender(TENANT_A, {}, 0, deps({ leerChats, detectar: detectarSinAtender, ahora: () => ahora, puertoConfig: { leer: async () => guardada, guardar: vi.fn() as never } }));
    const ocho10 = Date.parse('2026-11-05T14:10:00Z'); // jueves 08:10 México: 10 min de oficina
    const nueve10 = Date.parse('2026-11-05T15:10:00Z'); // jueves 09:10 México: 70 min de oficina
    const sin = await al(ocho10, null);
    const con8 = await al(ocho10, conHorario);
    const con9 = await al(nueve10, conHorario);
    expect(sin.ok && sin.revision.resultado.alertas).toHaveLength(1); // sin horario: 610 min corridos, alerta
    expect(con8.ok && con8.revision.resultado.alertas).toHaveLength(0); // con horario: solo 10 min dentro del horario
    expect(con9.ok && con9.revision.resultado.alertas).toHaveLength(1); // ya pasó el plazo dentro del horario
  });
  it('lee lo guardado de la flota de la sesión y no de otra', async () => {
    const leer = vi.fn(async () => null);
    await revisarSinAtender(TENANT_A, {}, 0, deps({ puertoConfig: { leer, guardar: vi.fn() as never } }));
    expect(leer).toHaveBeenCalledWith(TENANT_A);
    expect(leer).not.toHaveBeenCalledWith(TENANT_B);
  });
  it('sin nada guardado (sin fila o tabla ausente): sin horario y con las palabras de arranque', async () => {
    let visto: import('./motor').ConfigSinAtender | null = null;
    const d = deps({ detectar: (_c, cfg) => { visto = cfg; return resultado([]); } });
    await revisarSinAtender(TENANT_A, {}, 0, d);
    expect(visto!.horarioAtencion).toBeUndefined();
    expect(visto!.palabrasClave).toEqual(['embarque', 'embarques']);
    expect(visto!.equipoHashes).toEqual([]);
  });
  it('si la base de la configuración falla, la revisión lo dice en vez de enseñar una lista como si todo estuviera apagado', async () => {
    const d = deps({ puertoConfig: { leer: async () => { throw new Error('caída'); }, guardar: vi.fn() as never } });
    expect(await revisarPanel(ctx(), form(), d)).toMatchObject({ ok: false });
  });
});

describe('el resumen por correo respeta el interruptor de cada flota', () => {
  const plataforma = { bandera: () => true, leer: async () => 'encendido' as const };
  it('flota apagada: no lee chats, no manda, no asienta, y lo dice', async () => {
    const d = deps({ habilitado: (t) => resumenHabilitadoParaFlota(t, async () => false, plataforma) });
    const r = await enviarResumenPanel(ctx(), form({ fechaCorte: '2026-11-01' }), d);
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toContain('apagado para tu flota');
    expect(d.llamadas.leerChats).toEqual([]);
    expect(d.enviar).not.toHaveBeenCalled();
  });
  it('flota encendida y plataforma encendida: sale; cada flota se consulta con su propio tenant', async () => {
    const consultados: string[] = [];
    const d = deps({ habilitado: (t) => resumenHabilitadoParaFlota(t, async (id) => { consultados.push(id); return id === TENANT_A; }, plataforma) });
    expect((await enviarResumenPanel(ctx('flota_admin', TENANT_A), form({ fechaCorte: '2026-11-01' }), d)).ok).toBe(true);
    const d2 = deps({ habilitado: (t) => resumenHabilitadoParaFlota(t, async (id) => { consultados.push(id); return id === TENANT_A; }, plataforma) });
    expect((await enviarResumenPanel(ctx('flota_admin', TENANT_B), form({ fechaCorte: '2026-11-01' }), d2)).ok).toBe(false);
    expect(consultados).toContain(TENANT_A);
    expect(consultados).toContain(TENANT_B);
  });
  it('flota encendida pero plataforma apagada: no sale', async () => {
    const d = deps({ habilitado: (t) => resumenHabilitadoParaFlota(t, async () => true, { bandera: () => false, leer: async () => 'encendido' }) });
    expect((await enviarResumenPanel(ctx(), form({ fechaCorte: '2026-11-01' }), d)).ok).toBe(false);
    expect(d.enviar).not.toHaveBeenCalled();
  });
  it('el envío vuelve a comprobar la flota al mandar (fail-closed en la segunda puerta)', async () => {
    const habilitado = vi.fn(async () => ({ ok: true as const }));
    const d = deps({ habilitado });
    await enviarResumenPanel(ctx('flota_admin', TENANT_A), form({ fechaCorte: '2026-11-01' }), d);
    expect(habilitado).toHaveBeenCalledWith(TENANT_A);
    const opciones = (d.enviar as ReturnType<typeof vi.fn>).mock.calls[0]![1] as { habilitado: () => Promise<unknown> };
    await opciones.habilitado();
    expect(habilitado).toHaveBeenLastCalledWith(TENANT_A);
  });
});
