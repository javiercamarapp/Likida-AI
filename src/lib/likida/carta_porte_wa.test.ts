import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// El circuito de Carta Porte por WhatsApp (Fase B). Lo más probado son los
// CANDADOS: el «no necesita» solo sale de la DECLARACIÓN firmada del jefe
// (jamás del software), el rol equivocado no declara nada, y el radio no se
// escribe sin el «sí pisa» previo. El disparo al despachar se prueba con el
// veredicto en las tres ramas: botones, pregunta del radio, y texto final.
// ═══════════════════════════════════════════════════════════════════════════

let filaViaje: Record<string, unknown> | null = null;
let filasFolio: Array<Record<string, unknown>> = [];
// Los viajes en curso que el fallback por prefijo de UUID (c2-5) recorre
// cuando el folio no matcheó — la consulta SIN ilike.
let filasPorId: Array<Record<string, unknown>> = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      if (tabla !== 'viaje') throw new Error(`carta_porte_wa solo lee viaje; pidió ${tabla}`);
      let usoIlike = false;
      const b = {
        select: () => b, eq: () => b, in: () => b,
        ilike: () => { usoIlike = true; return b; },
        maybeSingle: async () => ({ data: filaViaje, error: null }),
        limit: async () => ({ data: usoIlike ? filasFolio : filasPorId, error: null }),
      };
      return b;
    },
  }),
}));
vi.mock('./presupuesto', async (orig) => ({
  ...(await orig() as object),
  acotada: (q: unknown) => q,
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const bitacora = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: (...a: unknown[]) => bitacora(...a) }));
const telefonoJefe = vi.fn(async (..._a: unknown[]): Promise<string | null> => '5215550000001');
vi.mock('./contactos', () => ({ telefonoJefeDe: (...a: unknown[]) => telefonoJefe(...a) }));
const sendText = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
const sendButtons = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
vi.mock('@/lib/meta/client', () => ({
  sendText: (...a: unknown[]) => sendText(...a),
  sendButtons: (...a: unknown[]) => sendButtons(...a),
}));
vi.mock('./repo', () => ({ getPerfilCrudo: async () => ({}) }));
const registrarCorrida = vi.fn(async (..._a: unknown[]) => {});
vi.mock('./agentes/corridas', () => ({ registrarCorrida: (...a: unknown[]) => registrarCorrida(...a) }));
// La palanca (0250): encendida por default en toda la suite — sin este mock,
// `estaApagado` cae al supabase de mentiras (que solo sabe de `viaje`), truena
// y el fail-closed apaga el agente para TODAS las pruebas.
const palancaApagada = vi.fn(async (..._a: unknown[]) => false);
vi.mock('./interruptores', () => ({ estaApagado: (...a: unknown[]) => palancaApagada(...a) }));

const getBorradorViaje = vi.fn();
const declararCcp = vi.fn(async (..._a: unknown[]) => {});
vi.mock('./carta_porte_datos', async (orig) => ({
  ...(await orig() as object),
  getBorradorViaje: (...a: unknown[]) => getBorradorViaje(...a),
  declararCcp: (...a: unknown[]) => declararCcp(...a),
}));

import { atenderCcpOficina, evaluarYAvisarCcpDespacho } from './carta_porte_wa';

const VIAJE_ID = '11111111-2222-4333-8444-555555555555';

/** Un ViajeCcp mínimo para el circuito: solo lo que los textos leen. */
function viajeCcp(sobre: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    viajeId: VIAJE_ID, folio: 'F-123', origen: 'Monterrey', destino: 'Querétaro',
    estatus: 'abierto', unidadEconomico: 'U-7', operadorNombre: 'Juan',
    clienteNombre: 'Acme',
    declarado: { pisaFederal: null, radioKm: null },
    decision: { necesita: 'falta_declarar', motivo: 'Falta declarar.', fundamento: 'RMF 2.7.7.2.1', pendientes: ['¿Pisa federal?'] },
    checklist: { campos: [], faltanCliente: 19, faltanTransportista: 3, transportistaListo: false },
    datosCliente: {}, mercancias: [], borrador: { borrador: null, faltantes: [], advertencias: [], fallas: [] },
    ...sobre,
  };
}

const JEFE = { tenantId: 't-1', rol: 'flota_admin' as const, userId: 'u-1' };

beforeEach(() => {
  vi.clearAllMocks();
  filaViaje = null;
  filasFolio = [];
  filasPorId = [];
  getBorradorViaje.mockResolvedValue(viajeCcp());
  telefonoJefe.mockResolvedValue('5215550000001');
  palancaApagada.mockReset();
  palancaApagada.mockResolvedValue(false);
});

describe('atenderCcpOficina — qué es nuestro y qué pasa de largo', () => {
  it('un texto cualquiera devuelve null y sigue su camino', async () => {
    expect(await atenderCcpOficina(JEFE, 'buenos días')).toBeNull();
    expect(await atenderCcpOficina(JEFE, 'viaje MTY a QRO con Juan')).toBeNull();
    expect(declararCcp).not.toHaveBeenCalled();
  });

  it('el contador NO declara rutas: se le dice y no se escribe nada', async () => {
    const r = await atenderCcpOficina({ ...JEFE, rol: 'contador' }, `ccp_no:${VIAJE_ID}`);
    expect(r).toContain('Tu rol no declara');
    expect(declararCcp).not.toHaveBeenCalled();
  });

  it('el superadmin sin flota no tiene viajes que declarar', async () => {
    const r = await atenderCcpOficina({ ...JEFE, rol: 'superadmin', tenantId: null }, `ccp_si:${VIAJE_ID}`);
    expect(r).toContain('no es de una flota tuya');
    expect(declararCcp).not.toHaveBeenCalled();
  });
});

describe('atenderCcpOficina — los botones', () => {
  it('«No pisa» escribe la declaración FIRMADA (pisa=false, radio limpio) con el actor', async () => {
    getBorradorViaje.mockResolvedValue(viajeCcp({
      declarado: { pisaFederal: false, radioKm: null },
      decision: { necesita: 'no', motivo: 'No pisa federal declarado.', fundamento: 'RMF 2.7.7.2.1', pendientes: [] },
    }));
    const r = await atenderCcpOficina(JEFE, `ccp_no:${VIAJE_ID}`);
    expect(declararCcp).toHaveBeenCalledWith('t-1', VIAJE_ID, { pisaFederal: false, radioKm: null }, { id: 'u-1' });
    // El candado 1 en el texto: el «no» viene de LO DECLARADO y deja rastro.
    expect(r).toContain('según lo declarado');
    expect(r).toContain('La declaración quedó firmada');
  });

  it('«Sí pisa» PRESERVA el radio ya medido en vez de borrarlo', async () => {
    filaViaje = { ccp_radio_federal_km: 25 };
    await atenderCcpOficina(JEFE, `ccp_si:${VIAJE_ID}`);
    expect(declararCcp).toHaveBeenCalledWith('t-1', VIAJE_ID, { pisaFederal: true, radioKm: 25 }, { id: 'u-1' });
  });

  it('un id que no es UUID estricto no se atiende como botón', async () => {
    expect(await atenderCcpOficina(JEFE, 'ccp_si:123')).toBeNull();
    expect(declararCcp).not.toHaveBeenCalled();
  });
});

describe('atenderCcpOficina — «radio F-123 25»', () => {
  it('con «sí pisa» declarado, escribe el radio y contesta el veredicto', async () => {
    filasFolio = [{ id: VIAJE_ID, folio: 'F-123', ccp_pisa_federal: true }];
    getBorradorViaje.mockResolvedValue(viajeCcp({
      declarado: { pisaFederal: true, radioKm: 25 },
      decision: { necesita: 'no', motivo: 'Radio de 25 km dentro de la excepción.', fundamento: 'RMF 2.7.7.2.8', pendientes: [] },
    }));
    const r = await atenderCcpOficina(JEFE, 'radio F-123 25');
    expect(declararCcp).toHaveBeenCalledWith('t-1', VIAJE_ID, { pisaFederal: true, radioKm: 25 }, { id: 'u-1' });
    expect(r).toContain('según lo declarado');
  });

  it('SIN el «sí pisa» previo, el radio NO se escribe: primero se declara la ruta', async () => {
    filasFolio = [{ id: VIAJE_ID, folio: 'F-123', ccp_pisa_federal: null }];
    const r = await atenderCcpOficina(JEFE, 'radio F-123 25');
    expect(r).toContain('Primero declara');
    expect(declararCcp).not.toHaveBeenCalled();
  });

  it('con «no pisa» declarado, el radio se rechaza en vez de guardar la contradicción', async () => {
    filasFolio = [{ id: VIAJE_ID, folio: 'F-123', ccp_pisa_federal: false }];
    const r = await atenderCcpOficina(JEFE, 'radio F-123 25');
    expect(r).toContain('NO pisa federal');
    expect(declararCcp).not.toHaveBeenCalled();
  });

  it('dos viajes en curso con el mismo folio: ambigüedad dicha, nada escrito', async () => {
    filasFolio = [
      { id: VIAJE_ID, folio: 'F-123', ccp_pisa_federal: true },
      { id: '99999999-2222-4333-8444-555555555555', folio: 'F-123', ccp_pisa_federal: true },
    ];
    const r = await atenderCcpOficina(JEFE, 'radio F-123 25');
    expect(r).toContain('más de un viaje');
    expect(declararCcp).not.toHaveBeenCalled();
  });

  it('un radio absurdo rebota con el mensaje del validador (es RADIO, no odómetro)', async () => {
    filasFolio = [{ id: VIAJE_ID, folio: 'F-123', ccp_pisa_federal: true }];
    const r = await atenderCcpOficina(JEFE, 'radio F-123 9000');
    expect(r).toContain('RADIO');
    expect(declararCcp).not.toHaveBeenCalled();
  });

  // ── AUDITORÍA FABLE CICLO 2 (c2-5) ─────────────────────────────────────────

  it('c2-5: el viaje SIN folio se declara con el prefijo de UUID que el bot mismo dictó', async () => {
    // `rotuloViaje` sin folio = viajeId.slice(0, 8): el comando que preguntaRadio
    // dicta es «radio 11111111 25» — y tiene que funcionar.
    filasFolio = [];
    filasPorId = [{ id: VIAJE_ID, folio: null, ccp_pisa_federal: true }];
    getBorradorViaje.mockResolvedValue(viajeCcp({
      folio: null,
      declarado: { pisaFederal: true, radioKm: 25 },
      decision: { necesita: 'no', motivo: 'Radio de 25 km dentro de la excepción.', fundamento: 'RMF 2.7.7.2.8', pendientes: [] },
    }));
    const r = await atenderCcpOficina(JEFE, `radio ${VIAJE_ID.slice(0, 8)} 25`);
    expect(declararCcp).toHaveBeenCalledWith('t-1', VIAJE_ID, { pisaFederal: true, radioKm: 25 }, { id: 'u-1' });
    expect(r).toContain('según lo declarado');
  });

  it('c2-5: dos viajes cuyo UUID comparte el prefijo — ambigüedad dicha, nada escrito', async () => {
    filasFolio = [];
    filasPorId = [
      { id: VIAJE_ID, folio: null, ccp_pisa_federal: true },
      { id: '11111111-9999-4333-8444-555555555555', folio: null, ccp_pisa_federal: true },
    ];
    const r = await atenderCcpOficina(JEFE, 'radio 11111111 25');
    expect(r).toContain('más de un viaje');
    expect(declararCcp).not.toHaveBeenCalled();
  });

  it('c2-5: un token corto que no es prefijo de UUID no dispara el fallback — «no encontré» honesto', async () => {
    filasFolio = [];
    filasPorId = [{ id: VIAJE_ID, folio: null, ccp_pisa_federal: true }];
    const r = await atenderCcpOficina(JEFE, 'radio F-999 25');
    expect(r).toContain('No encontré');
    expect(declararCcp).not.toHaveBeenCalled();
  });
});

describe('evaluarYAvisarCcpDespacho — el disparo al crear el viaje (H1)', () => {
  it('sin declarar el tramo federal: la pregunta con BOTONES ccp_si/ccp_no, y rastro en bitácora', async () => {
    await evaluarYAvisarCcpDespacho('t-1', VIAJE_ID);
    expect(sendButtons).toHaveBeenCalledTimes(1);
    const [, cuerpo, botones] = sendButtons.mock.calls[0] as unknown as [string, string, Array<{ id: string }>];
    expect(cuerpo).toContain('carretera FEDERAL');
    expect(botones.map((b) => b.id)).toEqual([`ccp_si:${VIAJE_ID}`, `ccp_no:${VIAJE_ID}`]);
    expect(bitacora).toHaveBeenCalledTimes(1);
    expect(registrarCorrida).toHaveBeenCalledWith('t-1', 'carta_porte', expect.objectContaining({ estado: 'ok' }));
  });

  it('pisa federal declarado pero falta el radio: pide «radio F-123 <km>» por texto', async () => {
    getBorradorViaje.mockResolvedValue(viajeCcp({
      declarado: { pisaFederal: true, radioKm: null },
      decision: { necesita: 'falta_declarar', motivo: 'Falta el radio.', fundamento: 'RMF 2.7.7.2.8', pendientes: ['El radio entre origen y destino'] },
    }));
    await evaluarYAvisarCcpDespacho('t-1', VIAJE_ID);
    expect(sendButtons).not.toHaveBeenCalled();
    const [, cuerpo] = sendText.mock.calls[0] as unknown as [string, string];
    expect(cuerpo).toContain('radio F-123');
    expect(cuerpo).toContain('RADIO entre origen y destino');
  });

  it('«sí necesita»: el checklist recortado con los conteos por responsable', async () => {
    getBorradorViaje.mockResolvedValue(viajeCcp({
      declarado: { pisaFederal: true, radioKm: null },
      decision: { necesita: 'si', motivo: 'Pisa federal con T3S2.', fundamento: 'RMF 2.7.7.2.1', pendientes: [] },
    }));
    await evaluarYAvisarCcpDespacho('t-1', VIAJE_ID);
    const [, cuerpo] = sendText.mock.calls[0] as unknown as [string, string];
    expect(cuerpo).toContain('NECESITA complemento');
    expect(cuerpo).toContain('19');
  });

  it('sin teléfono del jefe: el rastro en bitácora queda IGUAL, el aviso simplemente no sale', async () => {
    telefonoJefe.mockResolvedValue(null);
    await evaluarYAvisarCcpDespacho('t-1', VIAJE_ID);
    expect(bitacora).toHaveBeenCalledTimes(1);
    expect(sendText).not.toHaveBeenCalled();
    expect(sendButtons).not.toHaveBeenCalled();
  });

  it('el WhatsApp caído registra la corrida como PARCIAL, con el error dicho', async () => {
    sendButtons.mockResolvedValue(null as never);
    await evaluarYAvisarCcpDespacho('t-1', VIAJE_ID);
    expect(registrarCorrida).toHaveBeenCalledWith('t-1', 'carta_porte', expect.objectContaining({ estado: 'parcial' }));
  });
});

describe('la palanca agente:carta_porte (0250) — el agente vivo que no se podía apagar', () => {
  it('apagada, el disparo deja su rastro en bitácora pero NO le escribe a nadie', async () => {
    palancaApagada.mockResolvedValue(true);
    await evaluarYAvisarCcpDespacho('t-1', VIAJE_ID);
    // El contrato del docstring sigue: rastro SIEMPRE, aunque el aviso no salga.
    expect(bitacora).toHaveBeenCalledTimes(1);
    expect(sendText).not.toHaveBeenCalled();
    expect(sendButtons).not.toHaveBeenCalled();
  });

  it('apagada, al humano se le contesta la VERDAD (no silencio) y no se escribe nada', async () => {
    palancaApagada.mockResolvedValue(true);
    const r = await atenderCcpOficina(JEFE, `ccp_no:${VIAJE_ID}`);
    expect(r).toContain('apagado');
    expect(r).toContain('NO quedó registrada');
    expect(declararCcp).not.toHaveBeenCalled();
  });

  it('un texto que no es de este agente NO gasta lectura de palanca', async () => {
    palancaApagada.mockResolvedValue(true);
    expect(await atenderCcpOficina(JEFE, 'buenos días')).toBeNull();
    expect(palancaApagada).not.toHaveBeenCalled();
  });
});
