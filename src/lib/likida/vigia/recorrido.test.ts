import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL RECORRIDO COMPLETO, con las piezas REALES de punta a punta: servicio +
// clasificador + redactor + política + avisos + salida al cliente + selector de
// canal (`enviarConFallback`). Lo único simulado es la base (doble en memoria que
// respeta las garantías de la 0400) y el contrato de Meta (`client.ts`/ventana).
//
// Es la prueba de que las costuras encajan: el botón que arma `avisos.ts` es el que
// entiende `servicio.ts`, la plantilla del catálogo trae los parámetros que el
// llamador manda, y el selector decide texto/botones/plantilla según la ventana de
// CADA destinatario (el gerente puede tener la ventana abierta y el cliente cerrada).
// ═══════════════════════════════════════════════════════════════════════════

const enviarTexto = vi.hoisted(() => vi.fn());
const enviarBotones = vi.hoisted(() => vi.fn());
const sendTemplate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/meta/client', async () => {
  const real = await vi.importActual<typeof import('@/lib/meta/client')>('@/lib/meta/client');
  return { ...real, enviarTexto, enviarBotones, sendTemplate };
});
const ventanas = vi.hoisted(() => new Map<string, 'abierta' | 'cerrada' | 'desconocida'>());
vi.mock('@/lib/likida/wa_ventana', async () => {
  const real = await vi.importActual<typeof import('@/lib/likida/wa_ventana')>('@/lib/likida/wa_ventana');
  return {
    ...real,
    ventanaDeContacto: async (tel: string) => ({ estado: ventanas.get(tel) ?? 'desconocida', ultimoEntranteEn: null, expiraEn: null }),
    registrarDecisionEnvio: async () => {},
  };
});
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { atenderMensajeCliente, atenderDecisionVigia, barridoVigia } = await import('./servicio');
const { escenario } = await import('./repo.fixture');
const { estatus, AHORA, T1, CLIENTE_A } = await import('./datos.fixture');

const CLIENTE_TEL = '525511110001';
const GERENTE_TEL = '525599999999';
const DUENO_TEL = '525588888888';

beforeEach(() => {
  ventanas.clear();
  [enviarTexto, enviarBotones, sendTemplate].forEach((f) => f.mockReset());
  enviarTexto.mockResolvedValue({ ok: true, id: 'wamid.TXT' });
  enviarBotones.mockResolvedValue({ ok: true, id: 'wamid.BTN' });
  sendTemplate.mockResolvedValue({ ok: true, id: 'wamid.TPL' });
});

const entrante = (texto: string, id = 'w1') => ({ from: CLIENTE_TEL, type: 'text' as const, text: texto, waMessageId: id, timestampMs: AHORA.getTime() });

describe('de la pregunta del cliente a la respuesta aprobada con un toque', () => {
  it('ventanas abiertas: el gerente recibe BOTONES, aprueba, y el cliente recibe TEXTO con el dato real', async () => {
    ventanas.set(GERENTE_TEL, 'abierta'); ventanas.set(CLIENTE_TEL, 'abierta');
    const { repo } = escenario();
    repo.estatus.agregar(T1, CLIENTE_A, estatus());
    const deps = { repo, ahora: () => AHORA };

    await atenderMensajeCliente(entrante('¿Dónde va mi viaje F-1042?'), deps);

    // al gerente: mensaje con tres botones cuyo id es el del borrador
    expect(enviarBotones).toHaveBeenCalledTimes(1);
    const [telGer, cuerpo, botones] = enviarBotones.mock.calls[0];
    expect(telGer).toBe(GERENTE_TEL);
    expect(cuerpo).toContain('¿Dónde va mi viaje F-1042?');
    expect(cuerpo).toContain('F-1042');
    const [borrador] = repo.salientes();
    expect(botones).toEqual([
      { id: `vig_ok:${borrador.id}`, titulo: 'Enviar' }, { id: `vig_no:${borrador.id}`, titulo: 'No enviar' }, { id: `vig_tomo:${borrador.id}`, titulo: 'Yo me encargo' },
    ]);
    expect(enviarTexto).not.toHaveBeenCalled();

    // el gerente aprieta «Enviar»: lo que llega es exactamente el id del botón
    const r = await atenderDecisionVigia({ tenantId: T1, rol: 'encargado', userId: 'u-gerente' }, botones[0].id, deps);
    expect(r).toContain('se envió la respuesta');
    expect(enviarTexto).toHaveBeenCalledTimes(1);
    const [telCli, texto] = enviarTexto.mock.calls[0];
    expect(telCli).toBe(CLIENTE_TEL);
    expect(texto).toContain('F-1042');
    expect(texto).toContain('Guadalajara → Monterrey');
    expect(texto).toContain('maps.google.com');
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(repo.mensajes.get(borrador.id)).toMatchObject({ estado: 'enviado', via: 'texto' });
  });

  it('el gerente fuera de ventana: recibe la PLANTILLA con los botones; el cliente (ventana abierta) recibe texto', async () => {
    ventanas.set(GERENTE_TEL, 'cerrada'); ventanas.set(CLIENTE_TEL, 'abierta');
    const { repo } = escenario();
    repo.estatus.agregar(T1, CLIENTE_A, estatus());
    const deps = { repo, ahora: () => AHORA };
    await atenderMensajeCliente(entrante('¿Dónde va mi viaje?'), deps);

    expect(enviarBotones).not.toHaveBeenCalled();
    expect(sendTemplate).toHaveBeenCalledTimes(1);
    const [tel, nombre, op] = sendTemplate.mock.calls[0];
    const [borrador] = repo.salientes();
    expect([tel, nombre]).toEqual([GERENTE_TEL, 'vigia_aprobacion_v1']);
    expect(op.parametros).toHaveLength(3);
    expect(op.botones.map((b: { payload: string }) => b.payload)).toEqual([`vig_ok:${borrador.id}`, `vig_no:${borrador.id}`, `vig_tomo:${borrador.id}`]);
    // el payload de la plantilla ES lo que entiende el servicio
    await atenderDecisionVigia({ tenantId: T1, rol: 'flota_admin', userId: 'u-dueno' }, op.botones[0].payload, deps);
    expect(enviarTexto).toHaveBeenCalledTimes(1);
  });

  it('el CLIENTE fuera de ventana (escribió hace más de 24 h y la ventana cerró): SOLO la plantilla, jamás texto libre', async () => {
    ventanas.set(GERENTE_TEL, 'abierta'); ventanas.set(CLIENTE_TEL, 'cerrada');
    const { repo } = escenario();
    repo.estatus.agregar(T1, CLIENTE_A, estatus());
    const deps = { repo, ahora: () => AHORA };
    await atenderMensajeCliente(entrante('¿Dónde va mi viaje?'), deps);
    const [borrador] = repo.salientes();
    await atenderDecisionVigia({ tenantId: T1, rol: 'encargado', userId: 'u-gerente' }, `vig_ok:${borrador.id}`, deps);

    expect(enviarTexto).not.toHaveBeenCalled();
    const llamadaCliente = sendTemplate.mock.calls.find((c) => c[0] === CLIENTE_TEL)!;
    expect(llamadaCliente[1]).toBe('vigia_respuesta_cliente_v1');
    expect(llamadaCliente[2].parametros[0]).toBe('Transportes del Norte');
    expect(llamadaCliente[2].parametros[1]).not.toMatch(/[\n\t]/);
    expect(llamadaCliente[2].parametros[1]).toContain('F-1042');
    expect(repo.mensajes.get(borrador.id)).toMatchObject({ estado: 'enviado', via: 'plantilla' });
  });
});

describe('escalamiento de punta a punta', () => {
  it('el cliente espera: a los 30 min el responsable recibe el aviso con «Yo me encargo»; lo aprieta y el hilo es suyo', async () => {
    ventanas.set(GERENTE_TEL, 'abierta'); ventanas.set(DUENO_TEL, 'abierta'); ventanas.set(CLIENTE_TEL, 'abierta');
    const { repo } = escenario();
    repo.estatus.agregar(T1, CLIENTE_A, estatus());
    await atenderMensajeCliente(entrante('¿Dónde va mi viaje?'), { repo, ahora: () => AHORA });
    enviarBotones.mockClear();

    const luego = { repo, ahora: () => new Date(AHORA.getTime() + 31 * 60_000) };
    const r = await barridoVigia(luego);
    expect(r.escaladas).toBe(1);
    expect(enviarBotones).toHaveBeenCalledTimes(1);
    const [tel, cuerpo, botones] = enviarBotones.mock.calls[0];
    expect(tel).toBe(GERENTE_TEL);
    expect(cuerpo).toContain('lleva 31 minutos sin respuesta');
    expect(botones).toHaveLength(1);
    expect(botones[0].titulo).toBe('Yo me encargo');

    // el botón resuelve al hilo (el id es el del último mensaje ENTRANTE)
    const msg = await atenderDecisionVigia({ tenantId: T1, rol: 'encargado', userId: 'u-gerente' }, botones[0].id, luego);
    expect(msg).toContain('el hilo es tuyo');
    expect([...repo.conversaciones.values()][0]).toMatchObject({ control: 'humano', tomadaPor: 'u-gerente' });
  });
});
