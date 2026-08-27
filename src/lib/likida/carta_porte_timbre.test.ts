import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL FLUJO DE TIMBRE (0226 + 0227) — el archivo que mueve dinero fiscal real
// y que hasta la auditoría Fable ciclo 6 tenía CERO pruebas.
//
// Lo que esta suite fija, en orden de gravedad:
//
//  1. CLAIM-THEN-ACT (c6-1). La reserva entra ANTES de llamar al PAC. El
//     GANADOR llama una vez; el PERDEDOR rebota contra el unique y NO LLAMA
//     — la prueba que importa es `pac.timbrar` NO llamado, porque cada
//     llamada de más es un CFDI real de más.
//  2. El uuid HUÉRFANO (el ganador timbró y no consolidó) se grita SIEMPRE:
//     logger.error Y alertarOperador, con el folio dentro.
//  3. AMBIGUO ('red') NO suelta la reserva; rechazo del PAC SÍ la suelta.
//  4. Coherencia de ambiente en los DOS sentidos, antes de reservar nada.
//  5. La fecha del TFD manda; el fallback se DECLARA (c6-7).
//  6. El XML sandbox se marca por dentro (c6-10).
//
// La base va doblada por tabla con cola de respuestas —el molde de
// exito.test.ts—, y el PAC es un doble explícito: aquí nunca sale una
// petición de red.
// ═══════════════════════════════════════════════════════════════════════════

type Resp = { data?: unknown; error?: { message: string; code?: string } | null };
type Llamada = { tabla: string; op: string; payload: unknown; filtros: string[] };

let respuestas: Record<string, Resp[]>;
let llamadas: Llamada[];

function responder(tabla: string, op: string, payload: unknown, filtros: string[]): Resp {
  llamadas.push({ tabla, op, payload, filtros });
  const cola = respuestas[tabla];
  if (!cola || cola.length === 0) return { data: null, error: null };
  return cola.length > 1 ? cola.shift()! : cola[0];
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      let payload: unknown = null;
      let op = 'select';
      const filtros: string[] = [];
      const b: Record<string, unknown> = {};
      const enc = (nombre: string) => (...args: unknown[]) => {
        filtros.push(`${nombre}:${args.map((a) => JSON.stringify(a)).join(',')}`);
        return b;
      };
      Object.assign(b, {
        select: () => b,
        insert: (fila: unknown) => { op = 'insert'; payload = fila; return b; },
        update: (fila: unknown) => { op = 'update'; payload = fila; return b; },
        upsert: (fila: unknown) => { op = 'upsert'; payload = fila; return b; },
        delete: () => { op = 'delete'; return b; },
        eq: enc('eq'), neq: enc('neq'), is: enc('is'), in: enc('in'),
        gte: enc('gte'), lt: enc('lt'), not: enc('not'),
        order: () => b, range: () => b, limit: () => b,
        maybeSingle: () => b, single: () => b,
        then: (res: (r: Resp) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve().then(() => responder(tabla, op, payload, filtros)).then(res, rej),
      });
      return b;
    },
  }),
}));

vi.mock('@/lib/likida/presupuesto', async (orig) => ({
  ...(await orig() as object),
  acotada: (q: unknown) => q,
}));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger, redactarTexto: (s: string) => s }));

const alertarOperador = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: (...a: unknown[]) => alertarOperador(...a) }));

const anotarBitacora = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: (...a: unknown[]) => anotarBitacora(...a) }));

const getBorradorViaje = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ viajeId: 'v-1' }));
vi.mock('./carta_porte_datos', () => ({ getBorradorViaje: (...a: unknown[]) => getBorradorViaje(...a) }));

const armarCfdiTimbrable = vi.fn((..._a: unknown[]): unknown => ({
  ok: true, xml: '<cfdi/>', subTotal: 10000, iva: 1600, retencionIva: 400, total: 11200,
}));
vi.mock('./carta_porte_cfdi', () => ({ armarCfdiTimbrable: (...a: unknown[]) => armarCfdiTimbrable(...a) }));

// EL PAC, doblado. `timbrar` cuenta sus llamadas: ese contador ES la prueba
// de c6-1 — dos llamadas serían dos CFDIs reales.
const timbrar = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({
  ok: true, uuid: UUID, xmlTimbrado: XML_TIMBRADO, fechaTimbrado: '2026-08-27T12:00:00',
  selloSat: 'sello', noCertificadoSat: '30001',
}));
let estado: { configurado: boolean; proveedor: string | null; pareceSandbox: boolean | null } =
  { configurado: true, proveedor: 'sw', pareceSandbox: true };
let hayPac = true;
vi.mock('./pac', () => ({
  estadoPac: () => estado,
  resolverPac: () => (hayPac
    ? {
      nombre: 'sw',
      timbrar: (...a: unknown[]) => {
        // La llamada al PAC entra en la MISMA traza que las consultas: así el
        // orden «reservar → llamar» se comprueba mirando posiciones.
        llamadas.push({ tabla: '(PAC)', op: 'timbrar', payload: null, filtros: [] });
        return timbrar(...a);
      },
      cancelar: async () => ({ ok: false, mensaje: '' }),
    }
    : null),
}));

const UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';
const XML_TIMBRADO = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<cfdi:Comprobante xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital">',
  '  <cfdi:Complemento>',
  `    <tfd:TimbreFiscalDigital Version="1.1" UUID="${UUID}" FechaTimbrado="2026-08-27T11:59:00" SelloSAT="s"/>`,
  '  </cfdi:Complemento>',
  '</cfdi:Comprobante>',
].join('\n');

const {
  leerContextoTimbre, timbrarViaje, leerXmlTimbrado, listarTimbrado,
  fechaTimbradoDeTfd, marcarXmlSandbox, motivoDeReservaViva, AVISO_SANDBOX_XML,
  guardarPerfilFiscal, guardarReceptorFiscal,
} = await import('./carta_porte_timbre');

const T = 'tenant-1';
const V = 'viaje-1';
const ACTOR = { id: 'u-1', email: 'contador@flota.mx' };

/** El viaje + el perfil fiscal del emisor + (opcional) la fila viva. */
function sembrarContexto(fila: Resp['data'] = null, modo: 'sandbox' | 'produccion' = 'sandbox') {
  respuestas['viaje'] = [{ data: { id: V, ingreso_flete: 10000, cliente_id: 'c-1', cliente: { id: 'c-1', rfc: 'AAA010101AAA', razon_social: 'Cliente SA', regimen_fiscal: '601', uso_cfdi: 'S01', cp_fiscal: '64000' } }, error: null }];
  respuestas['flota_fiscal'] = [{ data: { rfc: 'EKU9003173C9', razon_social: 'KEMPER', regimen_fiscal: '601', lugar_expedicion: '42501', serie: 'CCP', modo }, error: null }];
  respuestas['ccp_timbre'] = [{ data: fila, error: null }];
}

const reservaOk: Resp = { data: { id: 'reserva-1' }, error: null };
const choqueUnique: Resp = { data: null, error: { message: 'duplicate key value violates unique constraint "ccp_timbre_vigente_unico"', code: '23505' } };

beforeEach(() => {
  vi.clearAllMocks();
  respuestas = {};
  llamadas = [];
  estado = { configurado: true, proveedor: 'sw', pareceSandbox: true };
  hayPac = true;
  armarCfdiTimbrable.mockReturnValue({ ok: true, xml: '<cfdi/>', subTotal: 10000, iva: 1600, retencionIva: 400, total: 11200 });
  getBorradorViaje.mockResolvedValue({ viajeId: V });
  timbrar.mockResolvedValue({
    ok: true, uuid: UUID, xmlTimbrado: XML_TIMBRADO, fechaTimbrado: '2026-08-27T12:00:00',
    selloSat: 'sello', noCertificadoSat: '30001',
  });
});

const escrituras = (op: string) => llamadas.filter((l) => l.tabla === 'ccp_timbre' && l.op === op);

// ── leerContextoTimbre ─────────────────────────────────────────────────────

describe('leerContextoTimbre — todo lo que la pantalla necesita, en una pasada', () => {
  it('mapea emisor, receptor, ingreso y timbre vigente', async () => {
    sembrarContexto({ uuid_fiscal: UUID, fecha_timbrado: '2026-08-27T12:00:00', modo: 'produccion', proveedor: 'sw', sello_sat: 'x', estado: 'vigente' }, 'produccion');
    const ctx = await leerContextoTimbre(T, V);
    expect(ctx?.emisor.rfc).toBe('EKU9003173C9');
    expect(ctx?.emisor.modo).toBe('produccion');
    expect(ctx?.receptor.usoCfdi).toBe('S01');
    expect(ctx?.clienteId).toBe('c-1');
    expect(ctx?.ingresoFlete).toBe(10000);
    expect(ctx?.timbreVigente).toMatchObject({ uuidFiscal: UUID, modo: 'produccion' });
    expect(ctx?.reservaPendiente).toBeNull();
  });

  it('una RESERVA no se enseña como timbre: va a reservaPendiente, con su uuid a medias', async () => {
    sembrarContexto({ uuid_fiscal: UUID, fecha_timbrado: null, modo: 'sandbox', proveedor: 'sw', sello_sat: null, estado: 'pendiente', reservado_en: '2026-08-27T11:00:00Z' });
    const ctx = await leerContextoTimbre(T, V);
    expect(ctx?.timbreVigente).toBeNull();
    expect(ctx?.reservaPendiente).toEqual({ reservadoEn: '2026-08-27T11:00:00Z', uuidFiscal: UUID });
  });

  it('sin perfil fiscal capturado, cada campo es null — jamás un default inventado', async () => {
    respuestas['viaje'] = [{ data: { id: V, ingreso_flete: null, cliente_id: null, cliente: null }, error: null }];
    respuestas['flota_fiscal'] = [{ data: null, error: null }];
    respuestas['ccp_timbre'] = [{ data: null, error: null }];
    const ctx = await leerContextoTimbre(T, V);
    expect(ctx?.emisor).toMatchObject({ rfc: null, razonSocial: null, regimenFiscal: null, modo: 'sandbox' });
    expect(ctx?.ingresoFlete).toBeNull();   // null ≠ 0
    expect(ctx?.clienteId).toBeNull();
  });

  it('el viaje de otra flota devuelve null (no la ficha ajena)', async () => {
    respuestas['viaje'] = [{ data: null, error: null }];
    respuestas['flota_fiscal'] = [{ data: null, error: null }];
    respuestas['ccp_timbre'] = [{ data: null, error: null }];
    expect(await leerContextoTimbre(T, V)).toBeNull();
  });

  it('un error de lectura LANZA — operar el timbre a ciegas es peor que no pintar', async () => {
    respuestas['viaje'] = [{ data: null, error: { message: 'base caída' } }];
    respuestas['flota_fiscal'] = [{ data: null, error: null }];
    respuestas['ccp_timbre'] = [{ data: null, error: null }];
    await expect(leerContextoTimbre(T, V)).rejects.toThrow(/base caída/);
  });
});

// ── c6-1: el claim ─────────────────────────────────────────────────────────

describe('timbrarViaje — claim-then-act (c6-1)', () => {
  it('EL GANADOR: reserva ANTES del PAC, llama UNA vez y consolida', async () => {
    sembrarContexto(null);
    respuestas['ccp_timbre'] = [
      { data: null, error: null },  // leerContexto: nada vivo
      reservaOk,                    // la reserva entra
      { data: null, error: null },  // sella el uuid
      { data: null, error: null },  // consolida
    ];
    const r = await timbrarViaje(T, V, { metodoPago: 'PPD', formaPago: '99' }, ACTOR);
    expect(r).toMatchObject({ ok: true, uuid: UUID, yaExistia: false });
    expect(timbrar).toHaveBeenCalledTimes(1);

    // EL ORDEN ES EL ARREGLO. `timbrar` deja su propia marca en la traza, así
    // que «reservar antes de llamar» se comprueba por posición, no de palabra.
    const insert = escrituras('insert')[0];
    expect(insert.payload).toMatchObject({ estado: 'pendiente', proveedor: 'sw', modo: 'sandbox', timbrado_por: 'u-1' });
    expect((insert.payload as { uuid_fiscal?: unknown }).uuid_fiscal).toBeUndefined();
    const iReserva = llamadas.indexOf(insert);
    const iPac = llamadas.findIndex((l) => l.tabla === '(PAC)');
    expect(iPac).toBeGreaterThan(iReserva);

    // El uuid se persiste SOLO, antes del resto (c6-1: si la consolidación
    // falla, el folio ya está guardado).
    const updates = escrituras('update');
    expect(updates[0].payload).toEqual({ uuid_fiscal: UUID });
    expect(updates[1].payload).toMatchObject({ estado: 'vigente', xml: XML_TIMBRADO, sello_sat: 'sello' });
    expect(anotarBitacora).toHaveBeenCalled();
  });

  it('EL PERDEDOR: el unique rebota y NO SE LLAMA AL PAC — cero CFDIs de más', async () => {
    sembrarContexto(null);
    respuestas['ccp_timbre'] = [
      { data: null, error: null },   // leerContexto: nada vivo
      choqueUnique,                  // otro ganó la reserva
      { data: { uuid_fiscal: UUID, fecha_timbrado: '2026-08-27T12:00:00', modo: 'sandbox', proveedor: 'sw', sello_sat: 's', estado: 'vigente' }, error: null },
    ];
    // El segundo leerContextoTimbre vuelve a pedir viaje y perfil.
    respuestas['viaje']!.push(respuestas['viaje']![0]);
    respuestas['flota_fiscal']!.push(respuestas['flota_fiscal']![0]);

    const r = await timbrarViaje(T, V, { metodoPago: 'PPD', formaPago: '99' }, ACTOR);
    expect(r).toMatchObject({ ok: true, uuid: UUID, yaExistia: true });
    expect(timbrar).not.toHaveBeenCalled();
  });

  it('EL PERDEDOR contra una reserva viva: dice «en curso» y tampoco llama al PAC', async () => {
    sembrarContexto(null);
    respuestas['ccp_timbre'] = [
      { data: null, error: null },
      choqueUnique,
      { data: { uuid_fiscal: null, estado: 'pendiente', reservado_en: '2026-08-27T11:00:00Z', modo: 'sandbox', proveedor: 'sw', sello_sat: null, fecha_timbrado: null }, error: null },
    ];
    respuestas['viaje']!.push(respuestas['viaje']![0]);
    respuestas['flota_fiscal']!.push(respuestas['flota_fiscal']![0]);

    const r = await timbrarViaje(T, V, { metodoPago: 'PPD', formaPago: '99' }, ACTOR);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain('en curso');
    expect(timbrar).not.toHaveBeenCalled();
    expect(alertarOperador).not.toHaveBeenCalled();   // sin uuid no hay huérfano
  });

  it('EL PERDEDOR contra una reserva CON uuid: grita el huérfano por log y por el operador', async () => {
    sembrarContexto(null);
    respuestas['ccp_timbre'] = [
      { data: null, error: null },
      choqueUnique,
      { data: { uuid_fiscal: UUID, estado: 'pendiente', reservado_en: '2026-08-27T11:00:00Z', modo: 'sandbox', proveedor: 'sw', sello_sat: null, fecha_timbrado: null }, error: null },
    ];
    respuestas['viaje']!.push(respuestas['viaje']![0]);
    respuestas['flota_fiscal']!.push(respuestas['flota_fiscal']![0]);

    const r = await timbrarViaje(T, V, { metodoPago: 'PPD', formaPago: '99' }, ACTOR);
    expect(r.ok).toBe(false);
    expect(timbrar).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('timbre.uuid_huerfano', expect.objectContaining({ uuid: UUID }));
    expect(alertarOperador).toHaveBeenCalledWith('timbre.uuid_huerfano', expect.objectContaining({ codigo: 'timbre_uuid_huerfano' }));
    expect((alertarOperador.mock.calls[0][1] as { error: string }).error).toContain(UUID);
  });

  it('si la reserva falla por algo que NO es la carrera, no se llama al PAC (fail-closed)', async () => {
    sembrarContexto(null);
    respuestas['ccp_timbre'] = [
      { data: null, error: null },
      { data: null, error: { message: 'sin respuesta en 8000 ms (tope de consulta)' } },
    ];
    const r = await timbrarViaje(T, V, { metodoPago: 'PPD', formaPago: '99' }, ACTOR);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain('No se llamó al PAC');
    expect(timbrar).not.toHaveBeenCalled();
  });

  it('un timbre vigente cortado en la primera puerta ni reserva ni llama', async () => {
    sembrarContexto({ uuid_fiscal: UUID, fecha_timbrado: '2026-08-27T12:00:00', modo: 'sandbox', proveedor: 'sw', sello_sat: 's', estado: 'vigente' });
    const r = await timbrarViaje(T, V, { metodoPago: 'PPD', formaPago: '99' }, ACTOR);
    expect(r).toMatchObject({ ok: true, yaExistia: true });
    expect(escrituras('insert')).toEqual([]);
    expect(timbrar).not.toHaveBeenCalled();
  });

  it('con una reserva viva la pantalla no vuelve a disparar el PAC', async () => {
    sembrarContexto({ uuid_fiscal: null, estado: 'pendiente', reservado_en: '2026-08-27T11:00:00Z', modo: 'sandbox', proveedor: 'sw', sello_sat: null, fecha_timbrado: null });
    const r = await timbrarViaje(T, V, { metodoPago: 'PPD', formaPago: '99' }, ACTOR);
    expect(r.ok).toBe(false);
    expect(timbrar).not.toHaveBeenCalled();
    expect(escrituras('insert')).toEqual([]);
  });
});

// ── El resultado del PAC ───────────────────────────────────────────────────

describe('timbrarViaje — lo que se hace con cada respuesta del PAC', () => {
  function prepararGanador(extra: Resp[] = []) {
    sembrarContexto(null);
    respuestas['ccp_timbre'] = [{ data: null, error: null }, reservaOk, ...extra];
  }

  it('AMBIGUO (red): la reserva SE QUEDA, se alerta y el mensaje dice que está bloqueado', async () => {
    prepararGanador();
    timbrar.mockResolvedValue({ ok: false, clase: 'red', codigo: null, mensaje: 'socket roto' });
    const r = await timbrarViaje(T, V, { metodoPago: 'PPD', formaPago: '99' }, ACTOR);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain('SIN RESPUESTA DEL PAC');
    expect(r.motivo).toContain('BLOQUEADO');
    expect(escrituras('delete')).toEqual([]);   // NO se suelta: el timbre pudo existir
    expect(alertarOperador).toHaveBeenCalledWith('timbre.ambiguo', expect.objectContaining({ codigo: 'timbre_ambiguo' }));
  });

  it('RECHAZO del PAC: la reserva se SUELTA y el mensaje del PAC viaja tal cual', async () => {
    prepararGanador([{ data: null, error: null }]);
    timbrar.mockResolvedValue({ ok: false, clase: 'rechazado', codigo: 'CFDI40147', mensaje: 'CFDI40147 - LugarExpedicion inválido' });
    const r = await timbrarViaje(T, V, { metodoPago: 'PPD', formaPago: '99' }, ACTOR);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe('CFDI40147 - LugarExpedicion inválido');
    expect(r.faltantes).toEqual(['Código del PAC: CFDI40147']);
    const del = escrituras('delete')[0];
    expect(del.filtros).toContainEqual('eq:"estado","pendiente"');
    expect(del.filtros).toContainEqual(`eq:"tenant_id","${T}"`);
  });

  it('si soltar la reserva falla, se grita: un viaje bloqueado para siempre no se calla', async () => {
    prepararGanador([{ data: null, error: { message: 'no se pudo borrar' } }]);
    timbrar.mockResolvedValue({ ok: false, clase: 'auth', codigo: null, mensaje: 'credenciales' });
    await timbrarViaje(T, V, { metodoPago: 'PPD', formaPago: '99' }, ACTOR);
    expect(alertarOperador).toHaveBeenCalledWith('timbre.reserva_atorada', expect.objectContaining({ codigo: 'timbre_reserva_atorada' }));
  });

  it('CONSOLIDACIÓN FALLIDA: el folio ya quedó en la reserva, y se grita con él', async () => {
    prepararGanador([
      { data: null, error: null },                              // el uuid SÍ se selló
      { data: null, error: { message: 'xml demasiado grande' } }, // la consolidación no
    ]);
    const r = await timbrarViaje(T, V, { metodoPago: 'PPD', formaPago: '99' }, ACTOR);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain(UUID);
    expect(r.motivo).toContain('NO vuelvas a timbrarlo');
    expect(logger.error).toHaveBeenCalledWith('timbre.emitido_sin_persistir', expect.objectContaining({ uuid: UUID }));
    expect(alertarOperador).toHaveBeenCalledWith('timbre.emitido_sin_persistir', expect.anything());
    // El uuid se escribió ANTES de intentar el resto.
    expect(escrituras('update')[0].payload).toEqual({ uuid_fiscal: UUID });
  });

  it('si NI el uuid se pudo sellar, también se alerta el huérfano', async () => {
    prepararGanador([
      { data: null, error: { message: 'red caída' } },  // ni el uuid entró
      { data: null, error: null },                      // la consolidación sí
    ]);
    await timbrarViaje(T, V, { metodoPago: 'PPD', formaPago: '99' }, ACTOR);
    expect(alertarOperador).toHaveBeenCalledWith('timbre.uuid_huerfano', expect.anything());
  });
});

// ── Coherencia de ambiente y puertas previas ───────────────────────────────

describe('timbrarViaje — las puertas que corren ANTES de reservar', () => {
  it('sin PAC configurado: se dice y jamás se simula un timbre', async () => {
    sembrarContexto(null);
    hayPac = false;
    estado = { configurado: false, proveedor: null, pareceSandbox: null };
    const r = await timbrarViaje(T, V, { metodoPago: 'PPD', formaPago: '99' }, ACTOR);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain('jamás se simula');
    expect(escrituras('insert')).toEqual([]);
  });

  it('perfil PRODUCCIÓN contra PAC de pruebas: se rechaza — ese papel no ampararía nada', async () => {
    sembrarContexto(null, 'produccion');
    estado = { configurado: true, proveedor: 'sw', pareceSandbox: true };
    const r = await timbrarViaje(T, V, { metodoPago: 'PPD', formaPago: '99' }, ACTOR);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain('PRODUCCIÓN pero el PAC configurado es el ambiente de pruebas');
    expect(timbrar).not.toHaveBeenCalled();
  });

  it('perfil SANDBOX contra PAC de producción: también se rechaza — un timbre real no se dispara por accidente', async () => {
    sembrarContexto(null, 'sandbox');
    estado = { configurado: true, proveedor: 'sw', pareceSandbox: false };
    const r = await timbrarViaje(T, V, { metodoPago: 'PPD', formaPago: '99' }, ACTOR);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain('SANDBOX pero el PAC configurado es el de PRODUCCIÓN');
    expect(escrituras('insert')).toEqual([]);
  });

  it('faltantes del CFDI (p. ej. RFC genérico): se devuelven SIN reservar ni llamar', async () => {
    sembrarContexto(null);
    armarCfdiTimbrable.mockReturnValue({
      ok: false,
      faltantes: ['El RFC del cliente es genérico (público en general / residente en el extranjero): ese CFDI requiere el nodo InformacionGlobal, que Likida todavía no arma — no soportado aún.'],
    });
    const r = await timbrarViaje(T, V, { metodoPago: 'PPD', formaPago: '99' }, ACTOR);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.faltantes?.join(' ')).toContain('InformacionGlobal');
    expect(escrituras('insert')).toEqual([]);   // sin reserva basura
    expect(timbrar).not.toHaveBeenCalled();
  });

  it('el viaje que no es de esta flota se corta antes de todo', async () => {
    respuestas['viaje'] = [{ data: null, error: null }];
    respuestas['flota_fiscal'] = [{ data: null, error: null }];
    respuestas['ccp_timbre'] = [{ data: null, error: null }];
    const r = await timbrarViaje(T, V, { metodoPago: 'PPD', formaPago: '99' }, ACTOR);
    expect(r).toEqual({ ok: false, motivo: 'Ese viaje no está en tu flota.' });
  });

  it('si el borrador desaparece entre lecturas, se corta sin reservar', async () => {
    sembrarContexto(null);
    getBorradorViaje.mockResolvedValue(null);
    const r = await timbrarViaje(T, V, { metodoPago: 'PPD', formaPago: '99' }, ACTOR);
    expect(r.ok).toBe(false);
    expect(escrituras('insert')).toEqual([]);
  });
});

// ── c6-7: de qué reloj sale fecha_timbrado ────────────────────────────────

describe('la fecha del TFD (c6-7)', () => {
  it('fechaTimbradoDeTfd lee la del TimbreFiscalDigital, no la del xmlns de la raíz', () => {
    expect(fechaTimbradoDeTfd(XML_TIMBRADO)).toBe('2026-08-27T11:59:00');
  });

  it('null cuando no hay TFD, cuando la fecha no tiene forma de fecha, o si el atributo vive fuera del TFD', () => {
    expect(fechaTimbradoDeTfd('<cfdi:Comprobante/>')).toBeNull();
    expect(fechaTimbradoDeTfd('<tfd:TimbreFiscalDigital FechaTimbrado="ayer"/>')).toBeNull();
    expect(fechaTimbradoDeTfd('<cfdi:Addenda FechaTimbrado="2026-08-27T11:59:00"/>')).toBeNull();
  });

  it('con TFD legible se guarda ESA fecha y el origen dice «tfd»', async () => {
    sembrarContexto(null);
    respuestas['ccp_timbre'] = [{ data: null, error: null }, reservaOk, { data: null, error: null }, { data: null, error: null }];
    const r = await timbrarViaje(T, V, { metodoPago: 'PPD', formaPago: '99' }, ACTOR);
    expect(r).toMatchObject({ ok: true, fechaTimbrado: '2026-08-27T11:59:00' });
    expect(escrituras('update')[1].payload).toMatchObject({
      fecha_timbrado: '2026-08-27T11:59:00', fecha_timbrado_origen: 'tfd',
    });
  });

  it('sin TFD cae a la del PAC y lo DECLARA («pac»), con aviso en el log', async () => {
    sembrarContexto(null);
    respuestas['ccp_timbre'] = [{ data: null, error: null }, reservaOk, { data: null, error: null }, { data: null, error: null }];
    timbrar.mockResolvedValue({ ok: true, uuid: UUID, xmlTimbrado: '<cfdi/>', fechaTimbrado: '2026-08-27T12:00:00', selloSat: null, noCertificadoSat: null });
    await timbrarViaje(T, V, { metodoPago: 'PPD', formaPago: '99' }, ACTOR);
    expect(escrituras('update')[1].payload).toMatchObject({
      fecha_timbrado: '2026-08-27T12:00:00', fecha_timbrado_origen: 'pac',
    });
    expect(logger.warn).toHaveBeenCalledWith('timbre.fecha_sin_tfd', expect.objectContaining({ origen: 'pac' }));
  });

  it('sin TFD y sin fecha del PAC, el reloj del servidor va MARCADO como tal', async () => {
    sembrarContexto(null);
    respuestas['ccp_timbre'] = [{ data: null, error: null }, reservaOk, { data: null, error: null }, { data: null, error: null }];
    timbrar.mockResolvedValue({ ok: true, uuid: UUID, xmlTimbrado: '<cfdi/>', fechaTimbrado: '', selloSat: null, noCertificadoSat: null });
    await timbrarViaje(T, V, { metodoPago: 'PPD', formaPago: '99' }, ACTOR);
    expect(escrituras('update')[1].payload).toMatchObject({ fecha_timbrado_origen: 'servidor' });
  });
});

// ── c6-10: el XML de prueba se rotula por dentro ──────────────────────────

describe('el XML timbrado y su rótulo de prueba (c6-10)', () => {
  it('marcarXmlSandbox mete el aviso DESPUÉS de la declaración xml (antes sería inválido)', () => {
    const marcado = marcarXmlSandbox(XML_TIMBRADO);
    expect(marcado.startsWith('<?xml')).toBe(true);
    expect(marcado.indexOf(AVISO_SANDBOX_XML)).toBeGreaterThan(marcado.indexOf('?>'));
    expect(marcado).toContain('TIMBRE DE PRUEBA — NO AMPARA');
  });

  it('sin declaración xml, el aviso va al principio y el documento no se rompe', () => {
    expect(marcarXmlSandbox('<cfdi/>')).toBe(`${AVISO_SANDBOX_XML}\n<cfdi/>`);
  });

  it('leerXmlTimbrado marca el sandbox y NO toca el de producción', async () => {
    respuestas['ccp_timbre'] = [{ data: { xml: XML_TIMBRADO, uuid_fiscal: UUID, modo: 'sandbox' }, error: null }];
    const s = await leerXmlTimbrado(T, V);
    expect(s?.modo).toBe('sandbox');
    expect(s?.xml).toContain('NO AMPARA');

    respuestas['ccp_timbre'] = [{ data: { xml: XML_TIMBRADO, uuid_fiscal: UUID, modo: 'produccion' }, error: null }];
    const p = await leerXmlTimbrado(T, V);
    expect(p?.xml).toBe(XML_TIMBRADO);
  });

  it('sin timbre vigente devuelve null, y un error de lectura LANZA', async () => {
    respuestas['ccp_timbre'] = [{ data: null, error: null }];
    expect(await leerXmlTimbrado(T, V)).toBeNull();
    respuestas['ccp_timbre'] = [{ data: null, error: { message: 'caída' } }];
    await expect(leerXmlTimbrado(T, V)).rejects.toThrow(/caída/);
  });
});

// ── La cola del contador ───────────────────────────────────────────────────

describe('listarTimbrado — por dónde llega el contador al flujo (c6-3)', () => {
  it('junta los viajes con XML generado y los que ya tienen timbre o reserva, y ordena por lo que pide acción', async () => {
    respuestas['viaje'] = [
      { data: [
        { id: 'v-a', folio: 'F-A', origen: 'León', destino: 'CDMX', ccp_xml_generado_en: '2026-08-26T10:00:00Z' },
        { id: 'v-b', folio: 'F-B', origen: 'León', destino: 'Mty', ccp_xml_generado_en: '2026-08-27T10:00:00Z' },
      ], error: null },
      { data: [{ id: 'v-c', folio: 'F-C', origen: 'A', destino: 'B', ccp_xml_generado_en: null }], error: null },
    ];
    respuestas['ccp_timbre'] = [{ data: [
      { viaje_id: 'v-b', uuid_fiscal: UUID, estado: 'vigente', modo: 'sandbox', fecha_timbrado: '2026-08-27T12:00:00' },
      { viaje_id: 'v-c', uuid_fiscal: null, estado: 'pendiente', modo: 'sandbox', fecha_timbrado: null },
    ], error: null }];

    const filas = await listarTimbrado(T);
    expect(filas.map((f) => f.viajeId)).toEqual(['v-a', 'v-c', 'v-b']);
    expect(filas[0].timbre).toBeNull();
    expect(filas[1].timbre).toMatchObject({ estado: 'pendiente' });
    expect(filas[2].timbre).toMatchObject({ estado: 'vigente', uuidFiscal: UUID });
  });

  it('un error de lectura LANZA: «no se pudo mirar» nunca es «no hay nada»', async () => {
    respuestas['viaje'] = [{ data: null, error: { message: 'caída' } }];
    respuestas['ccp_timbre'] = [{ data: [], error: null }];
    await expect(listarTimbrado(T)).rejects.toThrow(/caída/);
  });
});

// ── El mensaje de la reserva viva ─────────────────────────────────────────

describe('motivoDeReservaViva — dos verdades distintas', () => {
  it('sin uuid: «en curso», con la razón de por qué no se reintenta solo', () => {
    const m = motivoDeReservaViva({ reservadoEn: null, uuidFiscal: null });
    expect(m).toContain('en curso');
    expect(m).toContain('dos llamadas serían dos CFDIs');
  });
  it('con uuid: es asunto de soporte y lo dice con el folio', () => {
    const m = motivoDeReservaViva({ reservadoEn: null, uuidFiscal: UUID });
    expect(m).toContain(UUID);
    expect(m).toContain('NO lo vuelvas a timbrar');
  });
});

// ── Los dos escritores de datos fiscales ──────────────────────────────────

describe('el perfil del emisor y el receptor: enviar es declarar', () => {
  it('guardarPerfilFiscal hace upsert por tenant y firma la bitácora', async () => {
    respuestas['flota_fiscal'] = [{ data: null, error: null }];
    await guardarPerfilFiscal(T, {
      rfc: 'EKU9003173C9', razonSocial: 'KEMPER', regimenFiscal: '601',
      lugarExpedicion: '42501', serie: 'CCP', modo: 'sandbox',
    }, ACTOR);
    const up = llamadas.find((l) => l.tabla === 'flota_fiscal' && l.op === 'upsert');
    expect(up?.payload).toMatchObject({ tenant_id: T, rfc: 'EKU9003173C9', modo: 'sandbox' });
    expect(anotarBitacora).toHaveBeenCalled();
  });

  it('un CHECK de forma se traduce al idioma del contador, sin perder el original en el log', async () => {
    respuestas['flota_fiscal'] = [{ data: null, error: { message: 'violates check constraint "flota_fiscal_rfc_forma"' } }];
    await expect(guardarPerfilFiscal(T, {
      rfc: 'no-es-rfc', razonSocial: null, regimenFiscal: null, lugarExpedicion: null, serie: null, modo: 'sandbox',
    }, ACTOR)).rejects.toThrow(/RFC de 12-13/);
    expect(logger.warn).toHaveBeenCalledWith('timbre.perfil_rechazado', expect.anything());
  });

  it('guardarReceptorFiscal exige que el cliente sea de la flota: 0 filas = se dice, no se calla', async () => {
    respuestas['cliente'] = [{ data: [], error: null }];
    await expect(guardarReceptorFiscal(T, 'c-de-otro', {
      razonSocial: 'X', regimenFiscal: '601', usoCfdi: 'S01', cpFiscal: '64000',
    }, ACTOR)).rejects.toThrow(/no está en tu flota/);
    expect(anotarBitacora).not.toHaveBeenCalled();
  });

  it('el receptor guardado firma la bitácora con el uso CFDI', async () => {
    respuestas['cliente'] = [{ data: [{ id: 'c-1' }], error: null }];
    await guardarReceptorFiscal(T, 'c-1', {
      razonSocial: 'Cliente SA', regimenFiscal: '601', usoCfdi: 'G03', cpFiscal: '64000',
    }, ACTOR);
    expect(anotarBitacora).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'timbre.receptor_guardado' }),
      expect.anything(),
    );
  });
});
