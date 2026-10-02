import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LA ENTREGA POR WHATSAPP, A TRAVÉS DEL OUTBOX.
//
// Lo que se fija:
//   · los payloads cumplen los límites de Meta (el rechazo de Meta es del
//     mensaje ENTERO, no recorta): títulos de botón ≤ 20, cuerpo ≤ 1,024, id de
//     botón ≤ 256, y el id del botón lleva el uuid de la liquidación;
//   · `enviarConFallback` es IDEMPOTENTE: llamarla dos veces no manda dos
//     mensajes (la llave de deduplicación lo garantiza, y aquí se prueba que
//     NO se vuelve a encolar);
//   · la sesión que muere por ventana cerrada cae a plantilla UNA vez; la que
//     muere por otra razón NO cae a plantilla (no la arreglaría) y se reporta.
// ═══════════════════════════════════════════════════════════════════════════

interface FilaOutbox { dedupe_key: string; estado: 'pending' | 'sending' | 'sent' | 'dead'; provider_message_id: string | null; ultimo_error: string | null }
const outbox = new Map<string, FilaOutbox>();
const encolados: Array<{ llave: string; payload: Record<string, unknown> }> = [];
let outboxCaido = false;
let lecturaFalla = false;

let ventanaEstado: 'abierta' | 'cerrada' | 'desconocida' = 'desconocida';
const decisiones: Array<Record<string, unknown>> = [];

vi.mock('../wa_outbox', async (orig) => ({
  ...(await orig<typeof import('../wa_outbox')>()),
  encolarSalidaWhatsAppDedupe: vi.fn(async (llave: string, payload: Record<string, unknown>) => {
    if (outboxCaido) return null;
    // La RPC real: si la llave ya existe devuelve LA MISMA fila, sin duplicar.
    const previa = outbox.get(llave);
    if (previa) return { id: llave, estado: previa.estado, providerMessageId: previa.provider_message_id };
    encolados.push({ llave, payload });
    outbox.set(llave, { dedupe_key: llave, estado: 'pending', provider_message_id: null, ultimo_error: null });
    return { id: llave, estado: 'pending', providerMessageId: null };
  }),
  // `null` = no se pudo leer (el selector falla cerrado y reintentable).
  leerSalidasPorLlave: vi.fn(async (llaves: string[]) => (
    lecturaFalla ? null : new Map(llaves.filter((l) => outbox.has(l)).map((l) => [l, outbox.get(l)!]))
  )),
}));

vi.mock('@/lib/likida/wa_ventana', () => ({
  ventanaDeContacto: vi.fn(async () => ({ estado: ventanaEstado })),
  registrarDecisionEnvio: vi.fn(async (d: Record<string, unknown>) => { decisiones.push(d); }),
}));

const {
  payloadSesion, variablesPlantilla, entregaPorOutbox, murioPorVentana,
  llaveSesion, llavePlantilla, PLANTILLA_LIQUIDACION,
} = await import('./entrega');

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const msg = (p: Record<string, unknown> = {}) => ({
  tenantId: 't-1', liquidacionId: ID, generacion: 1, telefono: '525512345678', nombre: 'Juan Pérez García',
  desde: '2026-09-01', hasta: '2026-09-07', total: 2499.75, moneda: 'MXN' as const, sistemaOrigen: 'SAP',
  pdfUrl: 'https://storage.example/firmada?token=abc', pdfNombre: 'liquidacion-SAP-1.pdf', ...p,
});

beforeEach(() => {
  outbox.clear(); encolados.length = 0; decisiones.length = 0; outboxCaido = false; lecturaFalla = false; ventanaEstado = 'desconocida';
});

describe('los payloads cumplen los límites de Meta', () => {
  it('sesión: un solo mensaje interactivo con documento, resumen y DOS botones', () => {
    const p = payloadSesion(msg()) as { to: string; type: string; interactive: { header: { document: { link: string; filename: string } }; body: { text: string }; action: { buttons: Array<{ reply: { id: string; title: string } }> } } };
    expect(p.type).toBe('interactive');
    expect(p.to).toBe('525512345678');
    expect(p.interactive.header.document.link).toContain('storage.example');
    const { buttons } = p.interactive.action;
    expect(buttons).toHaveLength(2);
    for (const b of buttons) {
      expect(b.reply.title.length).toBeLessThanOrEqual(20);
      expect(b.reply.id.length).toBeLessThanOrEqual(256);
      expect(b.reply.id.endsWith(ID)).toBe(true);
    }
    expect(new Set(buttons.map((b) => b.reply.title)).size).toBe(2);
    expect(p.interactive.body.text.length).toBeLessThanOrEqual(1024);
  });

  it('el cuerpo trae periodo y total con moneda, y llama al chofer por su primer nombre', () => {
    const p = payloadSesion(msg()) as { interactive: { body: { text: string } } };
    expect(p.interactive.body.text).toContain('Hola Juan,');
    expect(p.interactive.body.text).toContain('$2,499.75 MXN');
    expect(p.interactive.body.text).toMatch(/Periodo: .*sep.*2026/);
  });

  it('el total en dólares lleva su moneda (un «$» a secas es ambiguo en un documento de pago)', () => {
    const p = payloadSesion(msg({ moneda: 'USD' })) as { interactive: { body: { text: string } } };
    expect(p.interactive.body.text).toContain('USD');
  });

  it('un nombre larguísimo o hostil no revienta el límite de 1,024 ni inyecta saltos', () => {
    const p = payloadSesion(msg({ nombre: 'X'.repeat(5000), sistemaOrigen: 'S'.repeat(40) })) as { interactive: { body: { text: string } } };
    // el saludo se acota a 40 caracteres: un nombre sin tope no puede romper el 1,024 de Meta
    expect(p.interactive.body.text.length).toBeLessThanOrEqual(1024);
    expect(p.interactive.body.text).not.toContain('X'.repeat(41));
  });

  /** El payload de plantilla tal como lo encola el selector (ventana cerrada). */
  async function payloadPlantillaEncolado(m = msg()) {
    ventanaEstado = 'cerrada';
    await entregaPorOutbox.enviarConFallback(m);
    return encolados.at(-1)!.payload as { type: string; to: string; template: { name: string; language: { code: string }; components: Array<Record<string, unknown>> } };
  }

  it('plantilla: encabezado de documento, cuatro variables de cuerpo y dos botones de respuesta rápida', async () => {
    const p = await payloadPlantillaEncolado();
    expect(p.type).toBe('template');
    expect(p.template.name).toBe(PLANTILLA_LIQUIDACION);
    expect(p.template.language.code).toBe('es_MX');
    const [header, body, b0, b1] = p.template.components as Array<{ type: string; parameters: Array<Record<string, unknown>>; sub_type?: string; index?: string }>;
    expect(header.type).toBe('header');
    expect(header.parameters[0]).toEqual({ type: 'document', document: { link: 'https://storage.example/firmada?token=abc', filename: 'liquidacion-SAP-1.pdf' } });
    expect(body.parameters).toHaveLength(4);
    // el orden es el del catálogo: nombre, origen, periodo, total
    expect(body.parameters.map((x) => x.text)).toEqual(['Juan', 'SAP', expect.stringContaining('2026'), '$2,499.75 MXN']);
    for (const b of [b0, b1]) {
      expect(b.type).toBe('button');
      expect(b.sub_type).toBe('quick_reply');
      expect((b.parameters[0] as { payload: string }).payload.endsWith(ID)).toBe(true);
    }
    expect([b0.index, b1.index]).toEqual(['0', '1']);
    expect((b0.parameters[0] as { payload: string }).payload).toBe(`liqext_ok:${ID}`);
    expect((b1.parameters[0] as { payload: string }).payload).toBe(`liqext_no:${ID}`);
  });

  it('las variables de plantilla no llevan saltos de línea ni tabuladores (Meta los rechaza)', () => {
    for (const v of variablesPlantilla(msg({ nombre: 'Ana\nLaura', sistemaOrigen: 'SAP\t\nERP' }))) expect(v).not.toMatch(/[\n\t]/);
  });

  it('sin sistema de origen la plantilla dice «tu empresa», no deja la variable vacía', () => {
    expect(variablesPlantilla(msg({ sistemaOrigen: null }))[1]).toBe('tu empresa');
  });

  it('las variables coinciden en número con el cuerpo aprobado del catálogo', async () => {
    const { plantillaDeCatalogo, variablesDeTexto } = await import('@/lib/meta/plantillas_catalogo');
    const cat = plantillaDeCatalogo(PLANTILLA_LIQUIDACION)!;
    expect(variablesPlantilla(msg())).toHaveLength(variablesDeTexto(cat.cuerpo).length);
    expect(cat.encabezado).toEqual({ tipo: 'DOCUMENT' });
  });

  it('el teléfono sale sin el «1» de los wa_id mexicanos (Meta rechaza los salientes con él)', () => {
    const p = payloadSesion(msg({ telefono: '5215512345678' })) as { to: string };
    expect(p.to).toBe('525512345678');
  });
});

describe('enviarConFallback: sesión primero', () => {
  it('encola el mensaje de sesión y devuelve en_cola', async () => {
    const r = await entregaPorOutbox.enviarConFallback(msg());
    expect(r).toEqual({ estado: 'en_cola', via: 'sesion' });
    expect(encolados).toHaveLength(1);
    expect(encolados[0].llave).toBe(llaveSesion(ID, 1));
  });

  it('IDEMPOTENTE: llamarla otra vez NO encola un segundo mensaje', async () => {
    await entregaPorOutbox.enviarConFallback(msg());
    await entregaPorOutbox.enviarConFallback(msg());
    await entregaPorOutbox.enviarConFallback(msg());
    expect(encolados).toHaveLength(1);
  });

  it('dos llamadas CONCURRENTES (POST y cron a la vez) no duplican', async () => {
    await Promise.all([entregaPorOutbox.enviarConFallback(msg()), entregaPorOutbox.enviarConFallback(msg()), entregaPorOutbox.enviarConFallback(msg())]);
    expect(encolados).toHaveLength(1);
  });

  it('cuando el outbox la manda, devuelve enviada con su wamid', async () => {
    await entregaPorOutbox.enviarConFallback(msg());
    outbox.set(llaveSesion(ID, 1), { dedupe_key: llaveSesion(ID, 1), estado: 'sent', provider_message_id: 'wamid.ABC', ultimo_error: null });
    expect(await entregaPorOutbox.enviarConFallback(msg())).toEqual({ estado: 'enviada', via: 'sesion', wamid: 'wamid.ABC' });
    expect(encolados).toHaveLength(1);
  });

  it('mientras el outbox la tiene pending o sending sigue en_cola', async () => {
    await entregaPorOutbox.enviarConFallback(msg());
    outbox.get(llaveSesion(ID, 1))!.estado = 'sending';
    expect((await entregaPorOutbox.enviarConFallback(msg())).estado).toBe('en_cola');
  });

  it('el outbox caído al encolar es una falla REINTENTABLE (nunca llegó a Meta)', async () => {
    outboxCaido = true;
    const r = await entregaPorOutbox.enviarConFallback(msg());
    expect(r).toMatchObject({ estado: 'fallida', via: 'sesion', reintentable: true });
  });

  it('si no se puede LEER el outbox, falla reintentable y NO encola (no se decide a ciegas)', async () => {
    lecturaFalla = true;
    expect(await entregaPorOutbox.enviarConFallback(msg())).toMatchObject({ estado: 'fallida', reintentable: true });
    expect(encolados).toHaveLength(0);
  });

  it('el encabezado del mensaje de sesión es un documento https y deja constancia de la decisión', async () => {
    ventanaEstado = 'abierta';
    await entregaPorOutbox.enviarConFallback(msg());
    const p = encolados[0].payload as { interactive: { header: { type: string } } };
    expect(p.interactive.header.type).toBe('document');
    expect(decisiones).toHaveLength(1);
    expect(decisiones[0]).toMatchObject({ contexto: 'liquidacion_externa', canal: 'botones', motivo: 'ventana_abierta', tenantId: 't-1', ok: true });
  });

  it('un PDF con URL no https se rechaza ANTES de encolar (Meta lo rechazaría)', async () => {
    const r = await entregaPorOutbox.enviarConFallback(msg({ pdfUrl: 'http://storage.example/x.pdf' }));
    expect(r).toMatchObject({ estado: 'fallida', reintentable: false });
    expect(encolados).toHaveLength(0);
  });
});

describe('ventana de 24 h cerrada: plantilla directa', () => {
  it('con la ventana cerrada se encola DIRECTO la plantilla, sin gastar un intento de sesión', async () => {
    ventanaEstado = 'cerrada';
    const r = await entregaPorOutbox.enviarConFallback(msg());
    expect(r).toEqual({ estado: 'en_cola', via: 'plantilla' });
    expect(encolados.map((e) => e.llave)).toEqual([llavePlantilla(ID, 1)]);
    expect(decisiones[0]).toMatchObject({ canal: 'plantilla', motivo: 'ventana_cerrada', plantilla: PLANTILLA_LIQUIDACION });
  });

  it('IDEMPOTENTE también por plantilla: la segunda llamada reporta la misma fila', async () => {
    ventanaEstado = 'cerrada';
    await entregaPorOutbox.enviarConFallback(msg());
    ventanaEstado = 'abierta'; // aunque la ventana se abra después, la plantilla ya es la que manda
    await entregaPorOutbox.enviarConFallback(msg());
    expect(encolados).toHaveLength(1);
  });
});

describe('el fallback a plantilla', () => {
  const morir = (llave: string, error: string) => {
    outbox.set(llave, { dedupe_key: llave, estado: 'dead', provider_message_id: null, ultimo_error: error });
  };

  it('la sesión muerta por ventana cerrada (131047) cae a plantilla, UNA vez', async () => {
    await entregaPorOutbox.enviarConFallback(msg());
    morir(llaveSesion(ID, 1), 'terminal:HTTP 400: {"error":{"code":131047,"message":"Re-engagement message"}}');
    const r1 = await entregaPorOutbox.enviarConFallback(msg());
    expect(r1).toEqual({ estado: 'en_cola', via: 'plantilla' });
    const r2 = await entregaPorOutbox.enviarConFallback(msg());
    expect(r2).toEqual({ estado: 'en_cola', via: 'plantilla' });
    expect(encolados.filter((e) => e.llave === llavePlantilla(ID, 1))).toHaveLength(1);
    expect((encolados.at(-1)!.payload as { type: string }).type).toBe('template');
  });

  it('los tres códigos de ventana (131047, 131026, 131042) y el texto «re-engagement» disparan el fallback', () => {
    for (const e of ['code":131047', '131026', 'HTTP 400 131042', 'Re-engagement message', 'reengagement']) {
      expect(murioPorVentana(e), e).toBe(true);
    }
  });

  it('otro error terminal NO cae a plantilla: no la arreglaría, se reporta tal cual', async () => {
    await entregaPorOutbox.enviarConFallback(msg());
    morir(llaveSesion(ID, 1), 'terminal:HTTP 400: {"error":{"code":131030,"message":"not in allowed list"}}');
    const r = await entregaPorOutbox.enviarConFallback(msg());
    expect(r).toMatchObject({ estado: 'fallida', via: 'sesion', reintentable: false });
    expect(encolados).toHaveLength(1);
  });

  it('un error nulo o vacío no se confunde con ventana cerrada', () => {
    expect(murioPorVentana(null)).toBe(false);
    expect(murioPorVentana('')).toBe(false);
    expect(murioPorVentana('sin_wamid:abc')).toBe(false);
  });

  it('una vez en plantilla, el estado es el de la PLANTILLA (enviada con su wamid)', async () => {
    await entregaPorOutbox.enviarConFallback(msg());
    morir(llaveSesion(ID, 1), 'terminal:131047');
    await entregaPorOutbox.enviarConFallback(msg());
    outbox.set(llavePlantilla(ID, 1), { dedupe_key: llavePlantilla(ID, 1), estado: 'sent', provider_message_id: 'wamid.PLANT', ultimo_error: null });
    expect(await entregaPorOutbox.enviarConFallback(msg())).toEqual({ estado: 'enviada', via: 'plantilla', wamid: 'wamid.PLANT' });
  });

  it('si la plantilla también muere (no aprobada), fallida definitiva con su vía', async () => {
    await entregaPorOutbox.enviarConFallback(msg());
    morir(llaveSesion(ID, 1), 'terminal:131047');
    await entregaPorOutbox.enviarConFallback(msg());
    morir(llavePlantilla(ID, 1), 'terminal:HTTP 400: {"error":{"code":132001}}');
    expect(await entregaPorOutbox.enviarConFallback(msg())).toMatchObject({ estado: 'fallida', via: 'plantilla', reintentable: false });
  });

  it('el outbox caído al encolar la plantilla es reintentable', async () => {
    await entregaPorOutbox.enviarConFallback(msg());
    morir(llaveSesion(ID, 1), 'terminal:131047');
    outboxCaido = true;
    expect(await entregaPorOutbox.enviarConFallback(msg())).toMatchObject({ estado: 'fallida', via: 'plantilla', reintentable: true });
  });

  it('un reintento manual (generación 2) usa llaves NUEVAS: no rebota contra la fila muerta de la 1', async () => {
    await entregaPorOutbox.enviarConFallback(msg());
    morir(llaveSesion(ID, 1), 'terminal:131030');
    expect((await entregaPorOutbox.enviarConFallback(msg())).estado).toBe('fallida');
    const r = await entregaPorOutbox.enviarConFallback(msg({ generacion: 2 }));
    expect(r).toEqual({ estado: 'en_cola', via: 'sesion' });
    expect(encolados.map((e) => e.llave)).toEqual([llaveSesion(ID, 1), llaveSesion(ID, 2)]);
  });
});
