import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// El CABLEADO de los hitos (0090 → Agente 5 «Conductor», 0380) en el dispatcher —
// lo que las unidades del módulo no pueden probar: que "ya llegué" se atiende
// ANTES del freno de cierre, que "listo" sigue siendo del cierre, que la hora que
// llega al motor es la del MENSAJE (DAT-38) y que el «Ya lo atiendo» del jefe se
// atiende ANTES de resolver al operador.
// (Desde AUD3 AG-A1 el regex de `pareceCierre` ya NO empata el "ya" pelón, así
// que "ya llegué" tampoco le parece cierre — pero el orden hito-antes-de-freno
// sigue siendo el contrato que este archivo fija.)
// ═══════════════════════════════════════════════════════════════════════════

const runAgent = vi.fn();
const resolveOperador = vi.fn();
const atenderConductor = vi.fn();
const atenderAcuseJefe = vi.fn();
const atenderPinConductor = vi.fn();
const hitoParaEvidenciaDelChofer = vi.fn();
const registrarEvidenciaDelChofer = vi.fn();
const registrarHitoDesdeFoto = vi.fn();
const subirComprobante = vi.fn();
const enviarSolicitudUbicacion = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock('@/lib/agents/run', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));
// El motor de hitos (conductor/atender.ts) tiene sus propias pruebas con una base en
// memoria (atender.test.ts); AQUÍ se prueba el CABLEADO en el dispatcher.
vi.mock('@/lib/likida/conductor/atender', () => ({
  atenderConductor: (...a: unknown[]) => atenderConductor(...a),
  atenderAcuseJefe: (...a: unknown[]) => atenderAcuseJefe(...a),
  atenderPinConductor: (...a: unknown[]) => atenderPinConductor(...a),
  hitoParaEvidenciaDelChofer: (...a: unknown[]) => hitoParaEvidenciaDelChofer(...a),
  registrarEvidenciaDelChofer: (...a: unknown[]) => registrarEvidenciaDelChofer(...a),
  registrarHitoDesdeFoto: (...a: unknown[]) => registrarHitoDesdeFoto(...a),
}));
vi.mock('@/lib/likida/intake/almacen', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  subirComprobante: (...a: unknown[]) => subirComprobante(...a),
}));
const FOTO_DE_PRUEBA = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////';
const descargarMedia = vi.fn(async (..._a: unknown[]): Promise<string | null> => FOTO_DE_PRUEBA);
vi.mock('@/lib/meta/client', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  enviarSolicitudUbicacion: (...a: unknown[]) => enviarSolicitudUbicacion(...a),
  downloadMediaAsDataUrl: (...a: unknown[]) => descargarMedia(...a),
}));
vi.mock('@/lib/likida/conv', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveOperador: (...a: unknown[]) => resolveOperador(...a),
  viajeAbiertoDesdeMs: vi.fn(async () => null),
  fotoAnteriorSinProcesar: vi.fn(async () => ({ vivas: 0, muertas: [] })),
  getOpenViaje: vi.fn(async () => 'v1'),
  getTenantContext: vi.fn(async () => ({ nombre: 'Flota' })),
  loadConversation: vi.fn(async () => ({ id: 'c1', turns: [] })),
  saveConversation: vi.fn(),
  claimMessage: vi.fn(async () => 'nuevo' as const),
  acquireViajeLock: vi.fn(async () => true), intentarLockViaje: vi.fn(async () => 'obtenido' as const), releaseViajeLock: vi.fn(),
  releaseMessageClaim: vi.fn(),
  intakeDelta: vi.fn(async () => 0), esperarIntake: vi.fn(async () => true),
}));
vi.mock('@/lib/likida/repo', () => ({
  ubicarGastoPorHash: vi.fn(async () => null),
  getHuerfanos: vi.fn(async () => []), guardarHuerfano: vi.fn(async () => true),
  resolverHuerfanos: vi.fn(), marcarHuerfanosOfrecidos: vi.fn(),
  addGasto: vi.fn(), getGastos: vi.fn(async () => []), updateGastoCfdiXml: vi.fn(),
  saveCfdiXmlRaw: vi.fn(), gastoExistePorHash: vi.fn(async () => false),
  enriquecerGastoConCodigo: vi.fn(), guardarCodigoPendiente: vi.fn(),
  getCodigosPendientes: vi.fn(async () => []), reclamarCodigoPendiente: vi.fn(),
  getDatosResponsable: vi.fn(async () => ({
    razonSocial: 'FLOTA SA DE CV', domicilio: 'Calle 1, Mérida', urlAvisoIntegral: 'https://flota.mx/p',
  })),
  reclamarEnvioAviso: vi.fn(async () => false), liberarEnvioAviso: vi.fn(),
  getViaje: vi.fn(async () => ({ id: 'v1', anticipo: 0 })),
  getOperador: vi.fn(async () => ({ id: 'o1', nombre: 'Operador', telefono: '5219993700779' })),
  saveLiquidacion: vi.fn(async () => 'L1'),
  getAcumuladoCombustible: vi.fn(async () => { throw new Error('sin base en pruebas'); }),
}));
vi.mock('@/lib/likida/costos', () => ({
  registrarCosto: vi.fn(), registrarCostoWhatsApp: vi.fn(),
  faseDeModelo: vi.fn(() => 'cuadre'), vincularCostosALiquidacion: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: null, error: { message: 'sin storage' } }) }) },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger }));

const { processInbound } = await import('./processor');

const salientes: string[] = [];
const envioPorDefecto = async (_url: string, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? '{}'));
  salientes.push(String((body.text as { body?: string } | undefined)?.body ?? ''));
  return new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST' }] }),
    { status: 200, headers: { 'content-type': 'application/json' } });
};
const fetchSpy = vi.fn(envioPorDefecto);

function msg(text: string, timestampMs?: number) {
  return { from: '5219993700779', type: 'text' as const, text, waMessageId: `wa-${text.slice(0, 8)}`, timestampMs };
}

describe('processInbound — los hitos del chofer, cableados', () => {
  beforeEach(() => {
    salientes.length = 0;
    runAgent.mockReset(); resolveOperador.mockReset(); atenderConductor.mockReset(); atenderAcuseJefe.mockReset();
    atenderPinConductor.mockReset(); hitoParaEvidenciaDelChofer.mockReset(); registrarEvidenciaDelChofer.mockReset(); registrarHitoDesdeFoto.mockReset(); subirComprobante.mockReset(); enviarSolicitudUbicacion.mockReset(); descargarMedia.mockClear();
    atenderPinConductor.mockResolvedValue(null); hitoParaEvidenciaDelChofer.mockResolvedValue(null); enviarSolicitudUbicacion.mockResolvedValue({ ok: true });
    resolveOperador.mockResolvedValue({ tenantId: 't1', operadorId: 'o1' });
    atenderConductor.mockResolvedValue(null);
    atenderAcuseJefe.mockResolvedValue(null);
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockReset();
    fetchSpy.mockImplementation(envioPorDefecto);
    process.env.WHATSAPP_ACCESS_TOKEN = 'tok-de-prueba';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
  });

  it('"ya llegué" lo atiende el Conductor con el contexto del chofer, y NO cae al freno de cierre ni al agente', async () => {
    atenderConductor.mockResolvedValue({ mensajes: [{ texto: 'Anotado ✅ llegaste a CARGAR a las 14:32.' }] });
    await processInbound(msg('ya llegué'));
    expect(atenderConductor).toHaveBeenCalledTimes(1);
    expect(atenderConductor.mock.calls[0][0]).toMatchObject({
      tenantId: 't1', operadorId: 'o1', viajeAbiertoId: 'v1', texto: 'ya llegué', telefono: '5219993700779', waMessageId: 'wa-ya llegu',
    });
    expect(salientes).toEqual(['Anotado ✅ llegaste a CARGAR a las 14:32.']);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('un acuse con BOTONES sale como mensaje interactivo (y el texto de respaldo si Meta lo rechaza)', async () => {
    atenderConductor.mockResolvedValue({ mensajes: [{ texto: '¿Ya llegaste a DESCARGAR?', botones: [{ id: 'hito_llegada_descarga:v1', titulo: 'Llegué a descargar' }] }] });
    const cuerpos: Array<Record<string, unknown>> = [];
    fetchSpy.mockImplementation(async (_u: string, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body ?? '{}'));
      cuerpos.push(b);
      if (b.type === 'interactive') return new Response(JSON.stringify({ error: { code: 131009, message: 'rechazado' } }), { status: 400 });
      salientes.push(String((b.text as { body?: string } | undefined)?.body ?? ''));
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.T' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    await processInbound(msg('ya llegué'));
    expect(cuerpos[0].type).toBe('interactive');
    expect(salientes).toEqual(['¿Ya llegaste a DESCARGAR?']);
  });

  it('"listo" sigue siendo del CIERRE: si el Conductor no lo reclama, nadie se lo come', async () => {
    await processInbound(msg('listo', 1788534000000));
    expect(atenderConductor).toHaveBeenCalledTimes(1);
    // El freno de cierre contesta (pregunta si va sin comprobantes) — lo que
    // importa aquí es que el mensaje NO se lo comió el módulo de hitos.
    expect(salientes).toHaveLength(1);
    expect(salientes[0]).not.toMatch(/Anotado/);
  });

  it('un mensaje que el Conductor no reclama sigue su camino al resto del dispatcher', async () => {
    atenderConductor.mockResolvedValue(null);
    await processInbound(msg('ya quedó'));
    expect(atenderConductor).toHaveBeenCalledTimes(1);
  });

  // ── DAT-38 · LA HORA ES LA DEL MENSAJE, NO LA DEL PROCESAMIENTO ──────────
  it('le pasa al motor la hora de META, no la del servidor', async () => {
    const metaMs = Date.UTC(2026, 7, 1, 20, 32, 0);
    await processInbound(msg('ya llegué', metaMs));
    const { mensajeEn } = atenderConductor.mock.calls[0][0] as { mensajeEn: Date | null };
    expect(mensajeEn).toBeInstanceOf(Date);
    expect(mensajeEn!.getTime()).toBe(metaMs);
  });

  it('sin hora de Meta (QA, simulador) no inventa una: el motor usa su reloj', async () => {
    await processInbound(msg('descargando'));
    expect((atenderConductor.mock.calls[0][0] as { mensajeEn: Date | null }).mensajeEn).toBeNull();
  });

  it('si el Conductor responde varios mensajes, salen todos en orden', async () => {
    atenderConductor.mockResolvedValue({ mensajes: [{ texto: 'uno' }, { texto: 'dos' }] });
    await processInbound(msg('me equivoqué'));
    expect(salientes).toEqual(['uno', 'dos']);
  });

  it('con `mensajes: []` el hito se atendió en silencio y el mensaje NO sigue al agente', async () => {
    atenderConductor.mockResolvedValue({ mensajes: [] });
    await processInbound(msg('ya llegué'));
    expect(salientes).toHaveLength(0);
    expect(runAgent).not.toHaveBeenCalled();
  });

  // ── «YA LO ATIENDO»: el botón del jefe se atiende ANTES de resolver al operador ──
  it('el acuse del jefe/patio se contesta sin resolver al operador (puede no ser chofer ni cuenta)', async () => {
    atenderAcuseJefe.mockResolvedValue('Anotado ✅ lo marqué como atendido; ya no insisto por este viaje.');
    await processInbound({ from: '5219990000099', type: 'text' as const, text: 'jefe_atiendo:4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001', waMessageId: 'wa-jefe' });
    expect(atenderAcuseJefe).toHaveBeenCalledWith('5219990000099', 'jefe_atiendo:4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001');
    expect(resolveOperador).not.toHaveBeenCalled();
    expect(atenderConductor).not.toHaveBeenCalled();
    expect(salientes).toEqual(['Anotado ✅ lo marqué como atendido; ya no insisto por este viaje.']);
  });

  it('un mensaje común nunca pasa por el acuse del jefe con costo: solo texto lo evalúa', async () => {
    await processInbound(msg('ya llegué'));
    expect(atenderAcuseJefe).toHaveBeenCalledTimes(1);
    expect(salientes.length).toBeLessThanOrEqual(1);
  });

  // ── 0385: la ubicación y la evidencia ──────────────────────────────────────
  it('tras el acuse de una llegada «sin ubicación», le PIDE el pin (después del acuse, no antes)', async () => {
    atenderConductor.mockResolvedValue({ mensajes: [{ texto: 'Anotado ✅ llegaste a CARGAR.' }], solicitarUbicacion: '📍 Para dejar tu llegada confirmada, comparte tu ubicación.' });
    const orden: string[] = [];
    fetchSpy.mockImplementation(async (_u: string, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body ?? '{}'));
      orden.push(`texto:${String((b.text as { body?: string } | undefined)?.body ?? '')}`);
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.T' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    enviarSolicitudUbicacion.mockImplementation(async () => { orden.push('pin'); return { ok: true }; });
    await processInbound(msg('ya llegué'));
    expect(enviarSolicitudUbicacion).toHaveBeenCalledWith('5219993700779', expect.stringContaining('comparte tu ubicación'));
    expect(orden).toEqual(['texto:Anotado ✅ llegaste a CARGAR.', 'pin']);
  });

  it('si Meta rechaza la solicitud de ubicación, el acuse ya salió y nada se rompe', async () => {
    atenderConductor.mockResolvedValue({ mensajes: [{ texto: 'Anotado ✅' }], solicitarUbicacion: 'pide' });
    enviarSolicitudUbicacion.mockRejectedValue(new Error('red'));
    await expect(processInbound(msg('ya llegué'))).resolves.not.toThrow();
    expect(salientes).toEqual(['Anotado ✅']);
  });

  it('sin `solicitarUbicacion` no se manda ninguna solicitud', async () => {
    atenderConductor.mockResolvedValue({ mensajes: [{ texto: 'Anotado ✅' }] });
    await processInbound(msg('ya llegué'));
    expect(enviarSolicitudUbicacion).not.toHaveBeenCalled();
  });

  it('el pin DENTRO de un viaje se entrega al Conductor (esta llamada vivía en el bloque «sin viaje» y nunca corría) y su línea se agrega a la respuesta', async () => {
    atenderPinConductor.mockResolvedValue('✅ Con tu ubicación quedó confirmada tu llegada a cargar en «Planta Zapopan».');
    await processInbound({ from: '5219993700779', type: 'location' as const, lat: 20.72, lng: -103.39, waMessageId: 'wa-pin', timestampMs: 1788534000000 });
    expect(atenderPinConductor).toHaveBeenCalledTimes(1);
    expect(atenderPinConductor.mock.calls[0][0]).toMatchObject({ tenantId: 't1', operadorId: 'o1', viajeId: 'v1', lat: 20.72, lng: -103.39 });
    expect((atenderPinConductor.mock.calls[0][0] as { enviadoEn: Date }).enviadoEn.getTime()).toBe(1788534000000);
    expect(salientes).toHaveLength(1);
    expect(salientes[0]).toMatch(/Recibida tu ubicación/);
    expect(salientes[0]).toMatch(/quedó confirmada tu llegada a cargar/);
  });

  it('el pin sin nada que decir deja la respuesta de siempre', async () => {
    await processInbound({ from: '5219993700779', type: 'location' as const, lat: 20.72, lng: -103.39, waMessageId: 'wa-pin2' });
    expect(salientes).toHaveLength(1);
    expect(salientes[0]).toMatch(/Recibida tu ubicación/);
    expect(salientes[0]).not.toMatch(/confirmada/);
  });

  describe('la foto de evidencia (caption «sello», «andén», «recibido»)', () => {
    const foto = (caption?: string) => ({ from: '5219993700779', type: 'image' as const, mediaId: 'media-1', text: caption, waMessageId: 'wa-foto' });
    const hito = { id: 'abcdef12-0000-4000-8000-000000000001', tipo: 'salida_carga', ciclo: 1 };

    it('sube la foto con el pipeline del POD (nombre por hito) y registra la evidencia', async () => {
      hitoParaEvidenciaDelChofer.mockResolvedValue({ tipo: 'sello', hito });
      subirComprobante.mockResolvedValue('t1/v1/ev_abcdef12_x.jpg');
      registrarEvidenciaDelChofer.mockResolvedValue('Recibí la foto de el sello ✅');
      await processInbound(foto('sello'));
      expect(descargarMedia).toHaveBeenCalledWith('media-1');
      expect(hitoParaEvidenciaDelChofer.mock.calls[0][0]).toMatchObject({ tenantId: 't1', operadorId: 'o1', viajeId: 'v1', caption: 'sello' });
      expect(subirComprobante).toHaveBeenCalledWith('t1', 'v1', expect.stringMatching(/^ev_abcdef12_[0-9a-f]{24}$/), expect.stringContaining('data:image'));
      expect(registrarEvidenciaDelChofer.mock.calls[0][0]).toMatchObject({
        tenantId: 't1', hito, tipo: 'sello', ruta: 't1/v1/ev_abcdef12_x.jpg', waMessageId: 'wa-foto', sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      expect(salientes).toEqual(['Recibí la foto de el sello ✅']);
      expect(runAgent).not.toHaveBeenCalled();
    });

    it('un caption que no es de evidencia sigue el camino de comprobante (no se sube como evidencia)', async () => {
      hitoParaEvidenciaDelChofer.mockResolvedValue(null);
      await processInbound(foto('diésel 800')).catch(() => {});
      expect(subirComprobante).not.toHaveBeenCalledWith('t1', 'v1', expect.stringMatching(/^ev_/), expect.anything());
      expect(registrarEvidenciaDelChofer).not.toHaveBeenCalled();
    });

    it('sin hito al cual colgarla: se lo dice y NO descarga ni sube nada', async () => {
      hitoParaEvidenciaDelChofer.mockResolvedValue({ tipo: 'sello', hito: null });
      await processInbound(foto('sello'));
      expect(salientes[0]).toMatch(/Primero dime/);
      expect(subirComprobante).not.toHaveBeenCalled();
      expect(descargarMedia).not.toHaveBeenCalled(); // sin hito no se paga la descarga
      expect(registrarEvidenciaDelChofer).not.toHaveBeenCalled();
    });

    describe('0483 · la foto ES el aviso (sin hito al cual colgarla)', () => {
      it('descarga, sube con el hito que la máquina eligió en el nombre y registra el hito DESDE la foto con la hora del mensaje', async () => {
        hitoParaEvidenciaDelChofer.mockResolvedValue({ tipo: 'anden', hito: null, comoHito: 'llegada_carga' });
        subirComprobante.mockResolvedValue('t1/v1/ev_llegada_carga_x.jpg');
        registrarHitoDesdeFoto.mockResolvedValue({ mensajes: [{ texto: 'Anotado ✅ llegaste a CARGAR a las 08:10.\n📷 Lo anoté con tu foto del andén.' }] });
        await processInbound({ ...foto('andén'), timestampMs: Date.parse('2026-10-02T14:10:00Z') });
        expect(descargarMedia).toHaveBeenCalledWith('media-1');
        expect(subirComprobante).toHaveBeenCalledWith('t1', 'v1', expect.stringMatching(/^ev_llegada_carga_[0-9a-f]{24}$/), expect.stringContaining('data:image'));
        expect(registrarHitoDesdeFoto.mock.calls[0][0]).toMatchObject({
          tenantId: 't1', operadorId: 'o1', telefono: '5219993700779', viajeId: 'v1', tipo: 'anden', ruta: 't1/v1/ev_llegada_carga_x.jpg', waMessageId: 'wa-foto',
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        });
        expect(registrarHitoDesdeFoto.mock.calls[0][0].mensajeEn).toEqual(new Date('2026-10-02T14:10:00Z'));
        expect(registrarEvidenciaDelChofer).not.toHaveBeenCalled();     // el registro del hito ya cuelga la foto
        expect(salientes).toEqual(['Anotado ✅ llegaste a CARGAR a las 08:10.\n📷 Lo anoté con tu foto del andén.']);
        expect(runAgent).not.toHaveBeenCalled();
      });

      it('si el hito quedó sin ubicación y hay sitio, la solicitud de ubicación va DESPUÉS del acuse', async () => {
        hitoParaEvidenciaDelChofer.mockResolvedValue({ tipo: 'anden', hito: null, comoHito: 'llegada_carga' });
        subirComprobante.mockResolvedValue('t1/v1/x.jpg');
        registrarHitoDesdeFoto.mockResolvedValue({ mensajes: [{ texto: 'Anotado ✅' }], solicitarUbicacion: 'Comparte tu ubicación' });
        await processInbound(foto('andén'));
        expect(salientes).toEqual(['Anotado ✅']);
        expect(enviarSolicitudUbicacion).toHaveBeenCalledWith('5219993700779', 'Comparte tu ubicación');
      });

      it('si la descarga o la subida fallan NO se registra ningún hito (la foto no es evidencia de nada si no existe)', async () => {
        hitoParaEvidenciaDelChofer.mockResolvedValue({ tipo: 'sello', hito: null, comoHito: 'salida_carga' });
        descargarMedia.mockResolvedValueOnce(null);
        await processInbound(foto('sello'));
        expect(salientes[0]).toMatch(/No pude descargar tu foto/);
        subirComprobante.mockResolvedValue(undefined);
        salientes.length = 0;
        await processInbound(foto('sello'));
        expect(salientes[0]).toMatch(/No pude guardar esa foto/);
        expect(registrarHitoDesdeFoto).not.toHaveBeenCalled();
      });

      it('un fallo al registrar el hito se dice (nunca silencio)', async () => {
        hitoParaEvidenciaDelChofer.mockResolvedValue({ tipo: 'recibido', hito: null, comoHito: 'salida_descarga' });
        subirComprobante.mockResolvedValue('t1/v1/x.jpg');
        registrarHitoDesdeFoto.mockRejectedValue(new Error('base caída'));
        await processInbound(foto('recibido'));
        expect(salientes[0]).toMatch(/No pude guardar esa foto/);
      });
    });

    it('si la descarga de Meta falla, se le dice y no se sube ni se registra nada', async () => {
      hitoParaEvidenciaDelChofer.mockResolvedValue({ tipo: 'sello', hito });
      descargarMedia.mockResolvedValueOnce(null);
      await processInbound(foto('sello'));
      expect(salientes[0]).toMatch(/No pude descargar tu foto/);
      expect(subirComprobante).not.toHaveBeenCalled();
      expect(registrarEvidenciaDelChofer).not.toHaveBeenCalled();
    });

    it('si la subida falla, se le dice y no se registra una evidencia sin archivo', async () => {
      hitoParaEvidenciaDelChofer.mockResolvedValue({ tipo: 'anden', hito });
      subirComprobante.mockResolvedValue(undefined);
      await processInbound(foto('andén'));
      expect(salientes[0]).toMatch(/No pude guardar esa foto/);
      expect(registrarEvidenciaDelChofer).not.toHaveBeenCalled();
    });

    it('si registrar lanza, también se le dice (nunca silencio)', async () => {
      hitoParaEvidenciaDelChofer.mockResolvedValue({ tipo: 'recibido', hito });
      subirComprobante.mockResolvedValue('t1/v1/x.jpg');
      registrarEvidenciaDelChofer.mockRejectedValue(new Error('base caída'));
      await processInbound(foto('recibido'));
      expect(salientes[0]).toMatch(/No pude guardar esa foto/);
    });
  });
});
