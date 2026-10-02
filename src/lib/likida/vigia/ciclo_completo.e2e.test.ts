import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// E2E DEL VIGÍA (agente 4), de punta a punta y con las piezas REALES: webhook (servicio) → clasificador →
// estatus armado con la función REAL del Conductor → redactor → política → aviso al gerente → botón de
// aprobación → salida al cliente por el selector de canal real → adjunto del POD → escalamiento por niveles.
//
// Lo único simulado son los bordes: la base (doble en memoria con las garantías de la 0400), el contrato de Meta
// (`client.ts`: texto, botones, plantilla y documento) y el registro de la ventana de 24 h.
//
// Cubre el criterio (g): ciclo feliz, fallo, duplicado, fuera de orden, otro tenant.
// ═══════════════════════════════════════════════════════════════════════════

const enviarTexto = vi.hoisted(() => vi.fn());
const enviarBotones = vi.hoisted(() => vi.fn());
const sendTemplate = vi.hoisted(() => vi.fn());
const sendDocument = vi.hoisted(() => vi.fn());
vi.mock('@/lib/meta/client', async () => {
  const real = await vi.importActual<typeof import('@/lib/meta/client')>('@/lib/meta/client');
  return { ...real, enviarTexto, enviarBotones, sendTemplate, sendDocument };
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

const { atenderMensajeCliente, atenderDecisionVigia, aprobarMensaje, barridoVigia } = await import('./servicio');
const { escenario } = await import('./repo.fixture');
const { estatus, AHORA, T1, T2, CLIENTE_A, CLIENTE_A2, VIAJE_1, VIAJE_AJENO } = await import('./datos.fixture');
const { parteDelConductor, mezclarEstatus } = await import('./desde_conductor');
const { construirEstatus } = await import('../conductor/estatus_viaje');
const { CONFIG_CONDUCTOR_DEFAULT } = await import('../conductor/config');
const { hitoVacio } = await import('../conductor/memoria.fixture');
type TipoHito = import('../conductor/tipos').TipoHito;
type HitoFila = import('../conductor/tipos').HitoFila;

const CLIENTE_TEL = '525511110001';
const GERENTE_TEL = '525599999999';
const DUENO_TEL = '525588888888';
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();
const en = (min: number) => hace(-min);
const GERENTE = { tenantId: T1, rol: 'encargado', userId: 'u-gerente' };

const entrante = (texto: string, id = 'w1') => ({ from: CLIENTE_TEL, type: 'text' as const, text: texto, waMessageId: id, timestampMs: AHORA.getTime() });

/** El estatus que vería el Vigía de un viaje cuyo chofer usa el Conductor: la función REAL del Conductor, no un doble. */
function estatusConConductor(hitosHechos: Partial<Record<TipoHito, string>>, viaje: { citaDestinoEn?: string | null; etaDestinoEn?: string | null } = {}, extra = {}) {
  const hs: HitoFila[] = (['llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga', 'regreso'] as TipoHito[]).map((tipo) =>
    hitoVacio({ id: `h-${tipo}`, tipo, viajeId: VIAJE_1, tenantId: T1, ...(hitosHechos[tipo] ? { estado: 'recibido', fuente: 'texto', mensajeEn: hitosHechos[tipo]!, recibidoEn: hitosHechos[tipo]! } : {}) }));
  const c = construirEstatus({
    id: VIAJE_1, folio: 'F-1042', origen: 'Guadalajara', destino: 'Monterrey', estatus: 'abierto', operadorId: 'o1', operadorNombre: 'Juan', terminalId: null, terminalNombre: null,
    clienteId: CLIENTE_A, clienteNombre: 'Acme', unidadId: null, aceptadoEn: hace(900), citaOrigenEn: null, citaDestinoEn: viaje.citaDestinoEn ?? null,
    etaOrigenEn: null, etaDestinoEn: viaje.etaDestinoEn ?? null, origenSitioId: null, destinoSitioId: null,
  }, hs, { ...CONFIG_CONDUCTOR_DEFAULT }, AHORA);
  const parte = parteDelConductor(c);
  const mezcla = mezclarEstatus({ etapa: 'en_curso', ultimoHito: null }, parte);
  return estatus({ ...mezcla, etaIso: parte.etaIso, etaFuente: parte.etaFuente, citaCarga: parte.citaCarga, enAnden: parte.enAnden, ...extra });
}

const POD = { url: 'https://firmada.test/pod.jpg?t=1', nombre: 'POD-F-1042.jpg', pie: 'Comprobante de entrega (POD) · viaje F-1042' };

beforeEach(() => {
  ventanas.clear();
  [enviarTexto, enviarBotones, sendTemplate, sendDocument].forEach((f) => f.mockReset());
  enviarTexto.mockResolvedValue({ ok: true, id: 'wamid.TXT' });
  enviarBotones.mockResolvedValue({ ok: true, id: 'wamid.BTN' });
  sendTemplate.mockResolvedValue({ ok: true, id: 'wamid.TPL' });
  sendDocument.mockResolvedValue({ ok: true, id: 'wamid.DOC' });
  ventanas.set(GERENTE_TEL, 'abierta'); ventanas.set(DUENO_TEL, 'abierta'); ventanas.set(CLIENTE_TEL, 'abierta');
});

describe('E2E · el cliente pregunta y recibe un dato real del Conductor, aprobado con un toque', () => {
  it('«¿a qué hora llega?»: la respuesta trae la CITA capturada, dice que no es GPS, y llega al cliente tras el botón', async () => {
    const { repo } = escenario();
    repo.estatus.agregar(T1, CLIENTE_A, estatusConConductor({ llegada_carga: hace(300), salida_carga: hace(240) }, { citaDestinoEn: en(600) }));
    const deps = { repo, ahora: () => AHORA };

    expect(await atenderMensajeCliente(entrante('¿A qué hora llega mi viaje F-1042?'), deps)).toBe('atendido');

    // El gerente recibe el borrador con botones; ve exactamente lo que saldrá.
    expect(enviarBotones).toHaveBeenCalledTimes(1);
    const [telGer, cuerpoGer, botones] = enviarBotones.mock.calls[0];
    expect(telGer).toBe(GERENTE_TEL);
    expect(cuerpoGer).toContain('La cita de llegada a destino de F-1042');
    expect(enviarTexto).not.toHaveBeenCalled();

    const msg = await atenderDecisionVigia(GERENTE, botones[0].id, deps);
    expect(msg).toContain('se envió la respuesta');
    const [telCli, texto] = enviarTexto.mock.calls[0];
    expect(telCli).toBe(CLIENTE_TEL);
    expect(texto).toContain('La cita de llegada a destino de F-1042');
    expect(texto).toContain('no una medición del GPS');
    expect(texto).not.toContain('lo consulto');
    // No faltó ningún dato: no hubo escalamiento.
    expect(repo.eventosDe('sin_dato')).toHaveLength(0);
    expect(repo.eventosDe('escalada')).toHaveLength(0);
    expect(repo.salientes()[0]).toMatchObject({ estado: 'enviado', via: 'texto' });
  });

  it('«¿dónde va?»: dice el último hito DEL OPERADOR con su hora y que sigue en el andén, sin llamarlo GPS', async () => {
    const { repo } = escenario();
    repo.estatus.agregar(T1, CLIENTE_A, estatusConConductor({ llegada_carga: hace(75) }, {}, { posicion: null }));
    const deps = { repo, ahora: () => AHORA };
    await atenderMensajeCliente(entrante('¿Dónde va mi viaje F-1042?'), deps);
    const [borrador] = repo.salientes();
    expect(borrador.texto).toContain('el operador reportó que llegó a cargar');
    expect(borrador.texto).toContain('Último registro del operador: llegada a cargar');
    expect(borrador.texto).toContain('Sigue en la carga desde las');
    expect(borrador.texto).toContain('Todavía no tengo posición GPS');
  });

  it('sin cita ni ETA capturadas: «lo consulto» y ESCALA al gerente (no inventa una hora)', async () => {
    const { repo } = escenario();
    repo.estatus.agregar(T1, CLIENTE_A, estatusConConductor({ llegada_carga: hace(300) }));
    await atenderMensajeCliente(entrante('¿A qué hora llega?'), { repo, ahora: () => AHORA });
    const [borrador] = repo.salientes();
    expect(borrador.texto).toContain('La consulto con tu ejecutivo');
    expect(borrador.texto).not.toMatch(/\d{1,2}:\d{2}/);
    expect(repo.eventosDe('sin_dato')).toHaveLength(1);
    expect(repo.eventosDe('escalada').length).toBeGreaterThanOrEqual(1);
  });

  it('el viaje ya llegó a descarga: no dice «no tengo hora», dice que ya llegó (y no escala por eso)', async () => {
    const { repo } = escenario();
    repo.estatus.agregar(T1, CLIENTE_A, estatusConConductor({ llegada_carga: hace(500), salida_carga: hace(400), llegada_descarga: hace(30) }, { citaDestinoEn: hace(60) }));
    await atenderMensajeCliente(entrante('¿A qué hora llega F-1042?'), { repo, ahora: () => AHORA });
    const [borrador] = repo.salientes();
    expect(borrador.texto).toContain('ya no hay hora estimada de llegada por decir');
    expect(repo.eventosDe('sin_dato')).toHaveLength(0);
  });
});

describe('E2E · el POD viaja con la respuesta (solo aprobado, solo en ventana, solo del cliente)', () => {
  const conPod = () => {
    const { repo } = escenario();
    repo.estatus.agregar(T1, CLIENTE_A, estatusConConductor({ llegada_carga: hace(500), salida_carga: hace(400), llegada_descarga: hace(100), salida_descarga: hace(30) }, {},
      { podRecibido: true, adjuntos: [{ clave: 'pod', nombre: 'Comprobante de entrega (POD)' }], documentos: [{ nombre: 'Comprobante de entrega (POD)', estado: 'entregado' }] }));
    repo.archivos.set(`${T1}|${CLIENTE_A}|${VIAJE_1}|pod`, POD);
    return repo;
  };

  it('feliz: el gerente ve «adjuntará», aprueba, sale el texto y DESPUÉS el documento con su pie', async () => {
    const repo = conPod();
    const deps = { repo, ahora: () => AHORA };
    await atenderMensajeCliente(entrante('Necesito el POD del viaje F-1042'), deps);

    const [borrador] = repo.salientes();
    expect(borrador.riesgo).toBe('medio');                       // un adjunto nunca se autoenvía
    expect(borrador.adjuntos).toEqual([{ clave: 'pod', viajeId: VIAJE_1, folio: 'F-1042' }]);
    expect(enviarBotones.mock.calls[0][1]).toContain('adjuntará: Comprobante de entrega (POD)');
    expect(sendDocument).not.toHaveBeenCalled();                  // antes de aprobar no sale NADA

    await atenderDecisionVigia(GERENTE, `vig_ok:${borrador.id}`, deps);
    expect(enviarTexto).toHaveBeenCalledTimes(1);
    expect(sendDocument).toHaveBeenCalledTimes(1);
    expect(sendDocument).toHaveBeenCalledWith(CLIENTE_TEL, POD.url, POD.nombre, POD.pie);
    expect(sendDocument.mock.invocationCallOrder[0]).toBeGreaterThan(enviarTexto.mock.invocationCallOrder[0]);
    expect(repo.eventosDe('adjunto_enviado')).toHaveLength(1);
    expect(repo.llamadasArchivo).toEqual([{ tenantId: T1, clienteId: CLIENTE_A, viajeId: VIAJE_1, clave: 'pod' }]);
  });

  it('el cliente fuera de ventana: SOLO la plantilla; el archivo NO sale y queda pendiente a la vista del gerente', async () => {
    ventanas.set(CLIENTE_TEL, 'cerrada');
    const repo = conPod();
    const deps = { repo, ahora: () => AHORA };
    await atenderMensajeCliente(entrante('Necesito el POD del viaje F-1042'), deps);
    const [borrador] = repo.salientes();
    await atenderDecisionVigia(GERENTE, `vig_ok:${borrador.id}`, deps);

    expect(enviarTexto).not.toHaveBeenCalled();
    expect(sendTemplate.mock.calls.some((c) => c[0] === CLIENTE_TEL && c[1] === 'vigia_respuesta_cliente_v1')).toBe(true);
    expect(sendDocument).not.toHaveBeenCalled();
    expect(repo.eventosDe('adjunto_pendiente')).toHaveLength(1);
    expect(repo.mensajes.get(borrador.id)).toMatchObject({ estado: 'enviado', via: 'plantilla' });
  });

  it('fallo: Meta rechaza el documento → el texto YA salió, queda adjunto_fallo (con el código) y nada se reenvía solo', async () => {
    sendDocument.mockResolvedValue({ ok: false, error: 'media inválida', codigo: 131053 });
    const repo = conPod();
    const deps = { repo, ahora: () => AHORA };
    await atenderMensajeCliente(entrante('Necesito el POD del viaje F-1042'), deps);
    const [borrador] = repo.salientes();
    const r = await atenderDecisionVigia(GERENTE, `vig_ok:${borrador.id}`, deps);
    expect(r).toContain('se envió la respuesta');
    expect(repo.mensajes.get(borrador.id)?.estado).toBe('enviado');
    expect(repo.eventosDe('adjunto_enviado')).toHaveLength(0);
    expect(repo.eventosDe('adjunto_fallo')[0].detalle).toMatchObject({ motivo: 'rechazado', codigo: 131053 });
    // Segundo toque del mismo botón: ya está atendido, no vuelve a mandar nada.
    expect(await atenderDecisionVigia(GERENTE, `vig_ok:${borrador.id}`, deps)).toContain('ya estaba atendido');
    expect(sendDocument).toHaveBeenCalledTimes(1);
  });

  it('el archivo ya no existe (o no es de este cliente): adjunto_fallo, el texto sale igual', async () => {
    const repo = conPod();
    repo.archivos.clear();
    const deps = { repo, ahora: () => AHORA };
    await atenderMensajeCliente(entrante('Necesito el POD del viaje F-1042'), deps);
    const [borrador] = repo.salientes();
    await atenderDecisionVigia(GERENTE, `vig_ok:${borrador.id}`, deps);
    expect(enviarTexto).toHaveBeenCalledTimes(1);
    expect(sendDocument).not.toHaveBeenCalled();
    expect(repo.eventosDe('adjunto_fallo')[0].detalle).toMatchObject({ motivo: 'archivo_no_disponible' });
  });

  it('fuera de orden: el doble toque (botón + tablero a la vez) manda UN texto y UN documento', async () => {
    const repo = conPod();
    const deps = { repo, ahora: () => AHORA };
    await atenderMensajeCliente(entrante('Necesito el POD del viaje F-1042'), deps);
    const [borrador] = repo.salientes();
    const [a, b] = await Promise.all([
      aprobarMensaje({ tenantId: T1, userId: 'u1' }, borrador.id, deps),
      aprobarMensaje({ tenantId: T1, userId: 'u2' }, borrador.id, deps),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(enviarTexto).toHaveBeenCalledTimes(1);
    expect(sendDocument).toHaveBeenCalledTimes(1);
  });

  it('el gerente EDITA el texto: el documento sale igual (lo aprobado incluye el adjunto que vio)', async () => {
    const repo = conPod();
    const deps = { repo, ahora: () => AHORA };
    await atenderMensajeCliente(entrante('Necesito el POD del viaje F-1042'), deps);
    const [borrador] = repo.salientes();
    await aprobarMensaje({ tenantId: T1, userId: 'u-gerente' }, borrador.id, deps, { textoEditado: 'Hola, ahí va tu POD de F-1042.' });
    expect(enviarTexto.mock.calls[0][1]).toBe('Hola, ahí va tu POD de F-1042.');
    expect(sendDocument).toHaveBeenCalledTimes(1);
  });

  it('otro tenant / otro cliente: el POD de un viaje ajeno jamás se adjunta ni se confirma', async () => {
    const repo = conPod();
    // Un viaje de OTRO cliente de la misma flota y uno de otra flota con POD y archivo propios.
    repo.estatus.agregar(T1, CLIENTE_A2, estatus({ viajeId: VIAJE_AJENO, folio: 'F-9999', podRecibido: true, adjuntos: [{ clave: 'pod', nombre: 'POD' }] }));
    repo.archivos.set(`${T1}|${CLIENTE_A2}|${VIAJE_AJENO}|pod`, { ...POD, url: 'https://firmada.test/ajeno.jpg' });
    const deps = { repo, ahora: () => AHORA };
    await atenderMensajeCliente(entrante('Mándame el POD del F-9999'), deps);
    const [borrador] = repo.salientes();
    expect(borrador.texto).toContain('no encuentro ese folio');
    expect(borrador.texto).not.toContain('F-9999');
    expect(borrador.adjuntos).toEqual([]);
    await atenderDecisionVigia(GERENTE, `vig_ok:${borrador.id}`, deps);
    expect(sendDocument).not.toHaveBeenCalled();
    // Y el gerente de OTRA flota no puede aprobar el mensaje de esta.
    expect(await atenderDecisionVigia({ tenantId: T2, rol: 'flota_admin', userId: 'x' }, `vig_ok:${borrador.id}`, deps)).toContain('No encuentro ese mensaje');
  });
});

describe('E2E · cliente molesto → escalamiento por niveles, y el agente se hace a un lado', () => {
  it('queja: nunca se autoenvía, el gerente recibe el aviso YA; si nadie contesta sube al dueño; «Yo me encargo» detiene al agente', async () => {
    const { repo } = escenario({ modoAprobacion: 'autoenviar_bajo_riesgo' });
    repo.estatus.agregar(T1, CLIENTE_A, estatusConConductor({ llegada_carga: hace(75) }));
    const deps = { repo, ahora: () => AHORA };

    await atenderMensajeCliente(entrante('Esto es una vergüenza, llevo horas esperando mi carga y nadie me contesta', 'q1'), deps);
    const [borrador] = repo.salientes();
    expect(borrador).toMatchObject({ estado: 'pendiente_aprobacion', riesgo: 'alto', autoenviado: false });
    expect(enviarTexto).not.toHaveBeenCalled();                    // al cliente no sale nada sin una persona
    expect(enviarBotones.mock.calls.some((c) => c[0] === GERENTE_TEL)).toBe(true);
    expect(repo.eventosDe('molestia').length).toBeGreaterThanOrEqual(1);
    expect([...repo.conversaciones.values()][0].molestiaNivel).toBeGreaterThanOrEqual(2);

    // Pasan 95 minutos (SLA 30 + 60 del nivel 2) sin que nadie conteste: el barrido sube al dueño (nivel 2).
    enviarBotones.mockClear();
    const luego = { repo, ahora: () => new Date(AHORA.getTime() + 95 * 60_000) };
    const r = await barridoVigia(luego);
    expect(r.escaladas).toBeGreaterThanOrEqual(1);
    expect(enviarBotones.mock.calls.some((c) => c[0] === DUENO_TEL)).toBe(true);
    // El mismo barrido otra vez no repite el aviso (sello por nivel).
    enviarBotones.mockClear();
    await barridoVigia(luego);
    expect(enviarBotones).not.toHaveBeenCalled();

    // El gerente toma el hilo: el borrador pendiente se descarta y el agente deja de redactar.
    const msg = await atenderDecisionVigia(GERENTE, `vig_tomo:${borrador.id}`, luego);
    expect(msg).toContain('el hilo es tuyo');
    expect(repo.mensajes.get(borrador.id)?.estado).toBe('descartado');
    const antes = repo.salientes().length;
    await atenderMensajeCliente({ ...entrante('¿Me van a contestar?', 'q2'), timestampMs: luego.ahora().getTime() }, luego);
    expect(repo.salientes().length).toBe(antes);
  });

  it('pide hablar con una persona: escala de inmediato aunque no haya pasado el SLA', async () => {
    const { repo } = escenario();
    await atenderMensajeCliente(entrante('Quiero hablar con una persona, por favor'), { repo, ahora: () => AHORA });
    expect(repo.eventosDe('escalada').some((e) => e.nivel === 1)).toBe(true);
    expect(repo.salientes()[0].riesgo).toBe('alto');
  });
});

describe('E2E · duplicado, fallo y otro tenant', () => {
  it('Meta reentrega el mismo mensaje: UN solo borrador y UN solo aviso', async () => {
    const { repo } = escenario();
    repo.estatus.agregar(T1, CLIENTE_A, estatusConConductor({ llegada_carga: hace(75) }));
    const deps = { repo, ahora: () => AHORA };
    await atenderMensajeCliente(entrante('¿Dónde va mi viaje?', 'dup'), deps);
    await atenderMensajeCliente(entrante('¿Dónde va mi viaje?', 'dup'), deps);
    expect(repo.salientes()).toHaveLength(1);
    expect(enviarBotones).toHaveBeenCalledTimes(1);
  });

  it('la base de viajes cae a media atención: el mensaje YA está guardado y se escala al gerente (no se pierde)', async () => {
    const { repo } = escenario();
    repo.estatus.falla = true;
    await atenderMensajeCliente(entrante('¿Dónde va mi viaje?'), { repo, ahora: () => AHORA });
    expect(repo.entrantes()).toHaveLength(1);
    expect(repo.eventosDe('sin_dato')[0].detalle).toMatchObject({ causa: 'fallo_interno' });
    expect(enviarBotones.mock.calls.some((c) => c[0] === GERENTE_TEL)).toBe(true);
  });

  it('un número que no es de ningún cliente autorizado recibe la regla de siempre (no_es_cliente) y nada más', async () => {
    const { repo } = escenario();
    const r = await atenderMensajeCliente({ ...entrante('hola'), from: '525500000000' }, { repo, ahora: () => AHORA });
    expect(r).toBe('no_es_cliente');
    expect(repo.mensajes.size).toBe(0);
    expect(enviarTexto).not.toHaveBeenCalled();
  });

  it('flota con el agente apagado: se calla (ni responde ni dice «no te tengo registrado»)', async () => {
    const { repo } = escenario({ habilitado: false });
    expect(await atenderMensajeCliente(entrante('hola'), { repo, ahora: () => AHORA })).toBe('atendido');
    expect(repo.mensajes.size).toBe(0);
    expect(enviarTexto).not.toHaveBeenCalled();
    expect(enviarBotones).not.toHaveBeenCalled();
  });

  it('aislamiento entre flotas: el contacto de la flota B no ve viajes de la A aunque el folio coincida', async () => {
    const { repo } = escenario();
    const contactoB = repo.agregarContacto({ tenantId: T2, clienteId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', telefono: '525522220002' });
    repo.habilitar(T2);
    repo.destinatario(T2, 1, { userId: 'ub', telefono: '525577777777' });
    ventanas.set('525522220002', 'abierta'); ventanas.set('525577777777', 'abierta');
    repo.estatus.agregar(T1, CLIENTE_A, estatusConConductor({ llegada_carga: hace(75) }));
    await atenderMensajeCliente({ ...entrante('¿Dónde va el F-1042?', 'b1'), from: contactoB.telefono }, { repo, ahora: () => AHORA });
    const [b] = repo.salientes();
    expect(b.tenantId).toBe(T2);
    expect(b.texto).not.toContain('Guadalajara');
    expect(b.texto).not.toContain('F-1042 (');
    expect(repo.estatus.llamadas.every((l) => l.tenantId === T2 && l.clienteId === 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).toBe(true);
  });
});
