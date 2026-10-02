import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LiquidacionExterna } from '../liquidacion_externa/repo';

// ═══════════════════════════════════════════════════════════════════════════
// E2E AGENTE 1 — LIQUIDACIÓN FASE 1 (solo entregar el pago que la flota ya calculó).
//
// Cadena REAL: validación del cuerpo → recibirLiquidacionExterna → cron
// (procesarLiquidacionesExternas) → entregaPorOutbox (sesión y fallback a plantilla)
// → botón del chofer (atenderAcuseLiquidacionExterna) → registrarAcuse.
// DOBLES: la base (almacén en memoria con el contrato condicional de `transicionar`),
// el outbox y el proveedor Meta (drenarMeta decide si la ventana de 24 h está abierta),
// Storage. Todos los datos son sintéticos.
// Casos del criterio (g): feliz, fallo, duplicado, fuera de orden, otro tenant.
// ═══════════════════════════════════════════════════════════════════════════

const store = new Map<string, LiquidacionExterna>();
const eventos: Array<{ id: string; tipo: string }> = [];
const storage = new Map<string, number>();
interface FilaOutbox { dedupe_key: string; estado: 'pending' | 'sending' | 'sent' | 'dead'; provider_message_id: string | null; ultimo_error: string | null }
const outbox = new Map<string, FilaOutbox>();
const encolados: Array<{ llave: string; payload: Record<string, unknown> }> = [];

const OPERADORES: Record<string, { id: string; nombre: string; telefono: string; activo: boolean; tenant: string }> = {
  '5510000001': { id: 'op-a1', nombre: 'Operador Ficticio Uno', telefono: '525510000001', activo: true, tenant: 't-a' },
  '5510000002': { id: 'op-a2', nombre: 'Operador Ficticio Dos', telefono: '525510000002', activo: true, tenant: 't-a' },
  '5510000009': { id: 'op-b1', nombre: 'Operador Ficticio Otra Flota', telefono: '525510000009', activo: true, tenant: 't-b' },
};

vi.mock('../wa_outbox', () => ({
  // La entrega lee el estado de la salida por llave con `leerSalidasPorLlave` (0560): mapa vacío = «no hay fila».
  leerSalidasPorLlave: vi.fn(async (llaves: string[]) => new Map(llaves.filter((l) => outbox.has(l)).map((l) => [l, outbox.get(l)!]))),
  encolarSalidaWhatsAppDedupe: vi.fn(async (llave: string, payload: Record<string, unknown>) => {
    const previa = outbox.get(llave);
    if (previa) return { id: llave, estado: previa.estado, providerMessageId: previa.provider_message_id };
    encolados.push({ llave, payload });
    outbox.set(llave, { dedupe_key: llave, estado: 'pending', provider_message_id: null, ultimo_error: null });
    return { id: llave, estado: 'pending', providerMessageId: null };
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => {
      if (t !== 'wa_outbox') throw new Error(`tabla inesperada ${t}`);
      return { select: () => ({ in: async (_c: string, llaves: string[]) => ({ data: llaves.map((l) => outbox.get(l)).filter(Boolean), error: null }) }) };
    },
  }),
}));
vi.mock('../presupuesto', async (orig) => ({ ...(await orig<typeof import('../presupuesto')>()), acotada: (q: unknown) => q }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// leerFilasOutbox real (lee 'wa_outbox' por el cliente simulado de arriba); el resto del repo es el almacén.
vi.mock('../liquidacion_externa/repo', async (orig) => {
  const real = await orig<typeof import('../liquidacion_externa/repo')>();
  return {
    ...real,
    resolverOperadorDestino: vi.fn(async (tenantId: string, ref: { telefono?: string }) => {
      const o = OPERADORES[(ref.telefono ?? '').replace(/^52/, '')];
      if (!o || o.tenant !== tenantId || !o.activo) throw new Error('operador no encontrado en esta flota');
      return o;
    }),
    resolverViajeIds: vi.fn(async (_t: string, folios: string[]) => folios.filter((f) => f.startsWith('VJ-')).map((f) => `uuid-${f}`)),
    subirPdfExterno: vi.fn(async (ruta: string, bytes: Uint8Array) => { storage.set(ruta, bytes.length); }),
    firmarPdfExterno: vi.fn(async () => 'https://firmada.example.invalid/x.pdf'),
    leerRazonSocial: vi.fn(async () => 'Flota Ficticia SA'),
    insertarLiquidacionExterna: vi.fn(async (n: { tenantId: string; datos: { claveExterna: string; total: number; moneda: 'MXN' | 'USD'; periodo: { desde: string; hasta: string }; viajes: string[]; sistemaOrigen: string | null }; huella: string; operadorId: string; viajeIds: string[]; pdfRuta: string; pdfOrigen: 'adjunto' | 'generado' }) => {
      // Contrato real: (tenant, clave_externa) es único → el duplicado devuelve LA MISMA fila.
      const previa = [...store.values()].find((f) => f.tenantId === n.tenantId && f.claveExterna === n.datos.claveExterna);
      if (previa) return { ...previa };
      const op = Object.values(OPERADORES).find((o) => o.id === n.operadorId)!;
      const fila: LiquidacionExterna = {
        id: `3f2504e0-4f89-41d3-9a0c-03055e82c${String(store.size + 1).padStart(3, '0')}`, tenantId: n.tenantId, claveExterna: n.datos.claveExterna, huella: n.huella,
        sistemaOrigen: n.datos.sistemaOrigen, operadorId: n.operadorId, operadorNombre: op.nombre, operadorTelefono: op.telefono,
        foliosViaje: n.datos.viajes, viajeIds: n.viajeIds, periodoDesde: n.datos.periodo.desde, periodoHasta: n.datos.periodo.hasta,
        conceptos: [], total: n.datos.total, moneda: n.datos.moneda, pdfRuta: n.pdfRuta, pdfOrigen: n.pdfOrigen,
        estado: 'pendiente', via: null, generacion: 1, intentos: 0, proximoIntentoEn: AHORA.toISOString(),
        ultimoError: null, wamid: null, enviadaEn: null, acuseTipo: null, acuseEn: null, acuseConfirmadoEn: null, creadaEn: AHORA.toISOString(),
      };
      store.set(fila.id, fila);
      return { ...fila };
    }),
    registrarEvento: vi.fn(async (_t: string, id: string, tipo: string) => { eventos.push({ id, tipo }); }),
    leerPorId: vi.fn(async (tenantId: string, id: string) => { const f = store.get(id); return f && f.tenantId === tenantId ? { ...f } : null; }),
    transicionar: vi.fn(async (tenantId: string, id: string, desde: string[], cambios: Record<string, unknown>) => {
      const f = store.get(id);
      if (!f || f.tenantId !== tenantId || !desde.includes(f.estado)) return false;
      const mapa: Record<string, keyof LiquidacionExterna> = {
        estado: 'estado', via: 'via', generacion: 'generacion', intentos: 'intentos', proximo_intento_en: 'proximoIntentoEn',
        ultimo_error: 'ultimoError', wamid: 'wamid', enviada_en: 'enviadaEn', acuse_tipo: 'acuseTipo', acuse_en: 'acuseEn',
      };
      for (const [k, v] of Object.entries(cambios)) (f as unknown as Record<string, unknown>)[mapa[k]] = v;
      return true;
    }),
  };
});
vi.mock('../liquidacion_externa/trabajo', () => ({
  trabajoPendiente: vi.fn(async (limite: number, ahoraIso: string) =>
    [...store.values()].filter((f) => f.estado === 'en_cola' || (f.estado === 'pendiente' && f.proximoIntentoEn <= ahoraIso)).slice(0, limite).map((f) => ({ ...f }))),
}));

const AHORA = new Date('2026-10-02T15:00:00.000Z');
const { validarLiquidacionExterna, huellaContenido } = await import('../liquidacion_externa/esquema');
const { recibirLiquidacionExterna, procesarLiquidacionesExternas, reintentarLiquidacionExterna, registrarAcuse } = await import('../liquidacion_externa/servicio');
const { atenderAcuseLiquidacionExterna } = await import('../liquidacion_externa/acuse');
const { entregaPorOutbox } = await import('../liquidacion_externa/entrega');
const { PREFIJO_BOTON_RECIBIDA } = await import('../liquidacion_externa/presentacion');

const deps = { entrega: entregaPorOutbox, ahora: () => AHORA, razonSocial: async () => 'Flota Ficticia SA', firmarPdf: async () => 'https://firmada.example.invalid/x.pdf',
  // Piezas de la ola 3b (formato de la flota 0564 y avisos): sin formato, sin jefe y con el aviso a la oficina aceptado — esta
  // prueba ejerce el ciclo base; la copia al jefe y el formato tienen sus propias pruebas en `liquidacion_externa/`.
  avisarNoCoincide: async () => true,
  formato: async () => null,
  subirArchivo: async (ruta: string, bytes: Uint8Array) => { storage.set(ruta, bytes.length); },
  copiarAJefe: async () => ({ estado: 'sin_destinatarios' as const }),
};

/** El proveedor Meta: drena el outbox. Con ventana abierta la sesión sale; cerrada, muere con 131047 y solo la plantilla sale. */
function drenarMeta(ventanaAbierta: boolean, plantillaAprobada = true) {
  for (const f of outbox.values()) {
    if (f.estado !== 'pending') continue;
    const esPlantilla = f.dedupe_key.endsWith(':plantilla');
    if (esPlantilla) {
      if (plantillaAprobada) { f.estado = 'sent'; f.provider_message_id = `wamid.${f.dedupe_key}`; } else { f.estado = 'dead'; f.ultimo_error = 'template not approved'; }
    } else if (ventanaAbierta) { f.estado = 'sent'; f.provider_message_id = `wamid.${f.dedupe_key}`; }
    else { f.estado = 'dead'; f.ultimo_error = '(#131047) Re-engagement message'; }
  }
}

const cuerpo = (extra: Record<string, unknown> = {}) => validarLiquidacionExterna({
  claveExterna: 'SAP-E2E-1', sistemaOrigen: 'SAP', operador: { telefono: '5510000001' }, viajes: ['VJ-100', 'VJ-101'],
  periodo: { desde: '2026-09-21', hasta: '2026-09-27' },
  conceptos: [{ descripcion: 'Pago por viaje', tipo: 'percepcion', monto: 3000 }, { descripcion: 'Anticipo', tipo: 'deduccion', monto: 500 }],
  total: 2500, moneda: 'MXN', ...extra,
});
async function post(tenantId: string, extra: Record<string, unknown> = {}) {
  const d = cuerpo(extra);
  return (await recibirLiquidacionExterna(tenantId, d, huellaContenido(d), deps)).liquidacion;
}
const tipos = (id: string) => eventos.filter((e) => e.id === id).map((e) => e.tipo);

beforeEach(() => { store.clear(); eventos.length = 0; storage.clear(); outbox.clear(); encolados.length = 0; });

describe('feliz: POST → cron → WhatsApp → «Recibida»', () => {
  it('entrega el pago con documento y botones, y el acuse del chofer cierra el ciclo', async () => {
    const liq = await post('t-a');
    expect(liq.estado).toBe('pendiente');
    expect(storage.size).toBe(1); // el PDF generado quedó en Storage

    expect(await procesarLiquidacionesExternas(deps)).toMatchObject({ tomadas: 1, en_cola: 1 });
    expect(encolados).toHaveLength(1);
    expect(JSON.stringify(encolados[0].payload)).toContain(liq.id); // los botones llevan el id de la liquidación
    drenarMeta(true);
    expect(await procesarLiquidacionesExternas(deps)).toMatchObject({ enviadas: 1 });
    expect(store.get(liq.id)).toMatchObject({ estado: 'enviada', via: 'sesion' });

    const respuesta = await atenderAcuseLiquidacionExterna({ tenantId: 't-a', operadorId: 'op-a1' }, `${PREFIJO_BOTON_RECIBIDA}${liq.id}`);
    expect(respuesta).not.toBeNull();
    expect(respuesta).toMatch(/recibiste tu liquidación/);
    expect(store.get(liq.id)).toMatchObject({ estado: 'acusada', acuseTipo: 'recibida' });
    expect(tipos(liq.id)).toEqual(['recibida', 'encolada', 'enviada', 'acuse_recibida']);
  });
});

describe('fallo', () => {
  it('ventana cerrada: cae UNA vez a la plantilla aprobada y sale', async () => {
    const liq = await post('t-a');
    await procesarLiquidacionesExternas(deps);
    drenarMeta(false);
    await procesarLiquidacionesExternas(deps); // la sesión murió → encola la plantilla
    drenarMeta(false);
    await procesarLiquidacionesExternas(deps);
    expect(store.get(liq.id)).toMatchObject({ estado: 'enviada', via: 'plantilla' });
    expect(encolados.map((e) => e.llave.split(':').pop())).toEqual(['sesion', 'plantilla']);
    expect(tipos(liq.id)).toContain('fallback_plantilla');
  });

  it('plantilla sin aprobar: queda FALLIDA (no «enviada» en falso) y el reintento manual sube la generación y la entrega', async () => {
    const liq = await post('t-a');
    await procesarLiquidacionesExternas(deps);
    drenarMeta(false, false);
    await procesarLiquidacionesExternas(deps);
    drenarMeta(false, false);
    await procesarLiquidacionesExternas(deps);
    expect(store.get(liq.id)!.estado).toBe('fallida');
    expect(store.get(liq.id)!.wamid).toBeNull();

    // Ya aprobada la plantilla y con ventana abierta, la persona reintenta desde el panel.
    expect(await reintentarLiquidacionExterna('t-a', liq.id, 'oficina@ejemplo.invalid', deps)).toBe('reintentada');
    expect(store.get(liq.id)!.generacion).toBe(2);
    drenarMeta(true);
    await procesarLiquidacionesExternas(deps);
    expect(store.get(liq.id)).toMatchObject({ estado: 'enviada', generacion: 2 });
  });

  it('operador que no existe en la flota: se rechaza ANTES de guardar nada y no sube PDF', async () => {
    await expect(post('t-a', { operador: { telefono: '5510000099' } })).rejects.toThrow();
    expect(store.size).toBe(0);
    expect(storage.size).toBe(0);
  });

  it('el total que no es la suma de sus renglones se rechaza en la validación (nada llega al chofer)', () => {
    expect(() => cuerpo({ total: 9999 })).toThrow();
  });
});

describe('duplicado', () => {
  it('el mismo POST dos veces (reintento del cliente) no crea otra liquidación ni manda dos mensajes', async () => {
    const a = await post('t-a');
    const b = await post('t-a');
    expect(b.id).toBe(a.id);
    expect(store.size).toBe(1);
    await procesarLiquidacionesExternas(deps);
    await procesarLiquidacionesExternas(deps);
    await procesarLiquidacionesExternas(deps);
    expect(encolados).toHaveLength(1);
  });

  it('el cron dos veces sobre lo ya enviado no la vuelve a mandar; reintentar una enviada no aplica', async () => {
    const liq = await post('t-a');
    await procesarLiquidacionesExternas(deps); drenarMeta(true); await procesarLiquidacionesExternas(deps);
    expect(await procesarLiquidacionesExternas(deps)).toMatchObject({ tomadas: 0 });
    expect(await reintentarLiquidacionExterna('t-a', liq.id, 'x', deps)).toBe('no_aplica');
    expect(encolados).toHaveLength(1);
  });

  it('apretar «Recibida» dos veces deja UN solo evento de acuse', async () => {
    const liq = await post('t-a');
    expect(await registrarAcuse('t-a', 'op-a1', liq.id, 'recibida', deps)).toBe('registrado');
    expect(await registrarAcuse('t-a', 'op-a1', liq.id, 'recibida', deps)).toBe('ya_registrado');
    expect(tipos(liq.id).filter((t) => t === 'acuse_recibida')).toHaveLength(1);
  });
});

describe('fuera de orden', () => {
  it('el chofer acusa ANTES de que el cron vea el estado del proveedor: la acusada no retrocede a enviada', async () => {
    const liq = await post('t-a');
    await procesarLiquidacionesExternas(deps);                 // en_cola
    await registrarAcuse('t-a', 'op-a1', liq.id, 'recibida', deps); // el acuse llega primero
    drenarMeta(true);
    await procesarLiquidacionesExternas(deps);                 // el cron no debe pisarla
    expect(store.get(liq.id)).toMatchObject({ estado: 'acusada', acuseTipo: 'recibida' });
  });

  it('«No coincide» y después «Recibida»: se acepta el cambio de opinión y la bitácora conserva los dos', async () => {
    const liq = await post('t-a');
    await registrarAcuse('t-a', 'op-a1', liq.id, 'no_coincide', deps);
    await registrarAcuse('t-a', 'op-a1', liq.id, 'recibida', deps);
    expect(tipos(liq.id)).toEqual(expect.arrayContaining(['acuse_no_coincide', 'acuse_recibida']));
    expect(store.get(liq.id)!.acuseTipo).toBe('recibida');
  });

  it('un botón de un mensaje viejo con un id inexistente contesta sin inventar nada', async () => {
    const r = await atenderAcuseLiquidacionExterna({ tenantId: 't-a', operadorId: 'op-a1' }, `${PREFIJO_BOTON_RECIBIDA}00000000-0000-4000-8000-000000000000`);
    expect(r).toMatch(/No encontré esa liquidación/);
  });
});

describe('otro tenant / otro chofer', () => {
  it('un chofer de la MISMA flota no acusa la liquidación de otro; uno de OTRA flota tampoco; no se revela de quién es', async () => {
    const liq = await post('t-a');
    expect(await registrarAcuse('t-a', 'op-a2', liq.id, 'recibida', deps)).toBe('no_encontrada');
    expect(await registrarAcuse('t-b', 'op-b1', liq.id, 'recibida', deps)).toBe('no_encontrada');
    expect(store.get(liq.id)!.estado).toBe('pendiente');
  });

  it('la flota B no puede reintentar ni leer la liquidación de la flota A, y su operador no se resuelve en la A', async () => {
    const liq = await post('t-a');
    store.get(liq.id)!.estado = 'fallida';
    expect(await reintentarLiquidacionExterna('t-b', liq.id, 'x', deps)).toBe('no_encontrada');
    expect(store.get(liq.id)!.estado).toBe('fallida');
    await expect(post('t-b', { claveExterna: 'SAP-E2E-2', operador: { telefono: '5510000001' } })).rejects.toThrow();
  });

  it('la misma clave externa en dos flotas son DOS liquidaciones independientes', async () => {
    const a = await post('t-a');
    const b = await post('t-b', { operador: { telefono: '5510000009' } });
    expect(a.id).not.toBe(b.id);
    expect(store.size).toBe(2);
  });
});
