import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';
import type { LiquidacionExterna, ConfigFormatoFlota } from './repo';

// ═══════════════════════════════════════════════════════════════════════════
// EL CICLO COMPLETO DE LA LIQUIDACIÓN EXTERNA, DE PUNTA A PUNTA (con dobles).
//
//   entrada  → el SAP/TMS manda la liquidación (`recibirLiquidacionExterna`)
//   salida   → el selector central (modo durable) la encola por WhatsApp: sesión
//              con documento dentro de las 24 h, plantilla fuera
//   outbox   → un doble del cron de `wa_outbox` la manda (o la entierra con el
//              código de Meta) y el cron de Likida concilia
//   chofer   → aprieta «Recibida» / «No coincide» (`atenderAcuseLiquidacionExterna`)
//   oficina  → «No coincide» AVISA a quien ve dinero (selector → `avisarOficina`)
//   retorno  → el SAP/TMS lee los acuses por pull, los confirma y exporta
//
// Los dobles son los límites del sistema (base en memoria con el contrato de
// `transicionar`, outbox con llave de deduplicación, Meta, contactos); TODO lo de
// en medio —selector, servicio, acuse, aviso, exportación— es el código real.
// Casos: feliz, fallo, duplicado, fuera de orden, otro tenant.
// ═══════════════════════════════════════════════════════════════════════════

// ── la base en memoria ──────────────────────────────────────────────────────
const store = new Map<string, LiquidacionExterna>();
const eventos: Array<{ id: string; tipo: string; detalle: Record<string, unknown> }> = [];
let seq = 0;
/** Lo que se subió a Storage, por ruta (PDF y Excel), y el formato configurado por flota (0564). */
const archivos = new Map<string, { bytes: Uint8Array; tipo: string }>();
const formatos = new Map<string, ConfigFormatoFlota>();
/** Reclamos de la copia al jefe (0620): llave liquidación|generación|teléfono → 'reclamada' | 'aceptada'. */
const reclamosCopia = new Map<string, 'reclamada' | 'aceptada'>();
let sinCandado = false;

vi.mock('./repo', () => ({
  TIPO_XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  subirArchivoExterno: vi.fn(async (ruta: string, bytes: Uint8Array, tipo: string) => { archivos.set(ruta, { bytes, tipo }); }),
  leerFormatoFlota: vi.fn(async (t: string) => formatos.get(t) ?? null),
  reclamarCopiaJefe: vi.fn(async (_t: string, id: string, gen: number, tel: string) => {
    if (sinCandado) return 'sin_candado' as const;
    const k = `${id}|${gen}|${tel}`;
    if (reclamosCopia.has(k)) return null;
    reclamosCopia.set(k, 'reclamada');
    return { token: k };
  }),
  cerrarCopiaJefe: vi.fn(async (_t: string, id: string, gen: number, tel: string, _r: unknown, aceptada: boolean) => {
    const k = `${id}|${gen}|${tel}`;
    if (aceptada) reclamosCopia.set(k, 'aceptada'); else reclamosCopia.delete(k);
    return true;
  }),
  eventosDe: vi.fn(async (_t: string, id: string) => eventos.filter((e) => e.id === id).map((e) => ({ tipo: e.tipo, detalle: e.detalle, creadoEn: '' }))),
  resolverOperadorDestino: vi.fn(async (t: string) => ({ id: t === 't-A' ? 'op-A' : 'op-B', nombre: 'Juan Pérez García', telefono: '525512345678', activo: true })),
  resolverViajeIds: vi.fn(async () => []),
  subirPdfExterno: vi.fn(async () => {}),
  firmarPdfExterno: vi.fn(async () => 'https://storage.example/firmada.pdf?token=abc'),
  leerRazonSocial: vi.fn(async () => 'Flota SA'),
  insertarLiquidacionExterna: vi.fn(async (n: { tenantId: string; datos: { claveExterna: string; total: number; moneda: 'MXN' | 'USD'; periodo: { desde: string; hasta: string }; viajes: string[]; sistemaOrigen: string | null; conceptos: LiquidacionExterna['conceptos'] }; huella: string; operadorId: string; viajeIds: string[]; pdfRuta: string; pdfOrigen: 'adjunto' | 'generado' }) => {
    const fila: LiquidacionExterna = {
      id: `0000000${++seq}-0000-4000-8000-00000000000${seq}`, tenantId: n.tenantId, claveExterna: n.datos.claveExterna, huella: n.huella,
      sistemaOrigen: n.datos.sistemaOrigen, operadorId: n.operadorId, operadorNombre: 'Juan Pérez García', operadorTelefono: '525512345678',
      foliosViaje: n.datos.viajes, viajeIds: n.viajeIds, periodoDesde: n.datos.periodo.desde, periodoHasta: n.datos.periodo.hasta,
      conceptos: n.datos.conceptos, total: n.datos.total, moneda: n.datos.moneda, pdfRuta: n.pdfRuta, pdfOrigen: n.pdfOrigen,
      estado: 'pendiente', via: null, generacion: 1, intentos: 0, proximoIntentoEn: '2026-09-08T00:00:00.000Z',
      ultimoError: null, wamid: null, enviadaEn: null, acuseTipo: null, acuseEn: null, acuseConfirmadoEn: null, creadaEn: `2026-09-08T09:00:0${seq}.000Z`,
    };
    store.set(fila.id, fila);
    return { ...fila };
  }),
  registrarEvento: vi.fn(async (_t: string, id: string, tipo: string, detalle: Record<string, unknown> = {}) => { eventos.push({ id, tipo, detalle }); }),
  leerPorId: vi.fn(async (t: string, id: string) => { const f = store.get(id); return f && f.tenantId === t ? { ...f } : null; }),
  transicionar: vi.fn(async (t: string, id: string, desde: string[], cambios: Record<string, unknown>) => {
    const f = store.get(id);
    if (!f || f.tenantId !== t || !desde.includes(f.estado)) return false;
    const mapa: Record<string, keyof LiquidacionExterna> = {
      estado: 'estado', via: 'via', generacion: 'generacion', intentos: 'intentos', proximo_intento_en: 'proximoIntentoEn', ultimo_error: 'ultimoError',
      wamid: 'wamid', enviada_en: 'enviadaEn', acuse_tipo: 'acuseTipo', acuse_en: 'acuseEn', acuse_confirmado_en: 'acuseConfirmadoEn',
    };
    for (const [k, v] of Object.entries(cambios)) (f as unknown as Record<string, unknown>)[mapa[k]] = v;
    return true;
  }),
  listarAcusesPendientes: vi.fn(async (t: string) => ({
    filas: [...store.values()].filter((f) => f.tenantId === t && f.acuseEn && !f.acuseConfirmadoEn).map((f) => ({ ...f })), hayMas: false,
  })),
  confirmarAcuses: vi.fn(async (t: string, ids: string[], ahoraIso: string) => {
    const r = { confirmadas: [] as string[], yaConfirmadas: [] as string[], noAplican: [] as string[] };
    for (const id of ids) {
      const f = store.get(id);
      if (!f || f.tenantId !== t || !f.acuseEn) r.noAplican.push(id);
      else if (f.acuseConfirmadoEn) r.yaConfirmadas.push(id);
      else { f.acuseConfirmadoEn = ahoraIso; r.confirmadas.push(id); }
    }
    return r;
  }),
  listarParaExportacion: vi.fn(async (t: string) => ({ filas: [...store.values()].filter((f) => f.tenantId === t).map((f) => ({ ...f })), truncado: false })),
}));
vi.mock('./trabajo', () => ({
  trabajoPendiente: vi.fn(async (limite: number, ahoraIso: string) =>
    [...store.values()].filter((f) => f.estado === 'en_cola' || (f.estado === 'pendiente' && f.proximoIntentoEn <= ahoraIso)).slice(0, limite).map((f) => ({ ...f }))),
}));

// ── el outbox de WhatsApp (con llave de deduplicación) ──────────────────────
interface FilaOutbox { dedupe_key: string; estado: 'pending' | 'sending' | 'sent' | 'dead'; provider_message_id: string | null; ultimo_error: string | null; payload: Record<string, unknown> }
const outbox = new Map<string, FilaOutbox>();
vi.mock('@/lib/likida/wa_outbox', async (orig) => ({
  ...(await orig<typeof import('@/lib/likida/wa_outbox')>()),
  encolarSalidaWhatsAppDedupe: vi.fn(async (llave: string, payload: Record<string, unknown>) => {
    const previa = outbox.get(llave);
    if (previa) return { id: llave, estado: previa.estado, providerMessageId: previa.provider_message_id };
    outbox.set(llave, { dedupe_key: llave, estado: 'pending', provider_message_id: null, ultimo_error: null, payload });
    return { id: llave, estado: 'pending', providerMessageId: null };
  }),
  leerSalidasPorLlave: vi.fn(async (llaves: string[]) => new Map(llaves.filter((l) => outbox.has(l)).map((l) => [l, outbox.get(l)!]))),
}));
/** El cron de wa_outbox: lo manda (con wamid) o lo entierra con el cuerpo del error de Meta. */
function cronOutbox(resultado: 'sent' | { dead: string }) {
  for (const f of outbox.values()) {
    if (f.estado !== 'pending') continue;
    if (resultado === 'sent') { f.estado = 'sent'; f.provider_message_id = `wamid.${f.dedupe_key.slice(-12)}`; } else { f.estado = 'dead'; f.ultimo_error = resultado.dead; }
  }
}

// ── la ventana de 24 h, el aviso a la oficina y los contactos ───────────────
let ventana: 'abierta' | 'cerrada' | 'desconocida' = 'abierta';
vi.mock('@/lib/likida/wa_ventana', () => ({
  ventanaDeContacto: vi.fn(async () => ({ estado: ventana })),
  registrarDecisionEnvio: vi.fn(async () => {}),
}));
let telefonoDinero: string | null = '525599990000';
vi.mock('../contactos', () => ({ telefonoParaDineroDe: vi.fn(async (t: string) => (t === 't-A' ? telefonoDinero : '525588880000')) }));
const avisos: Array<{ tel: string; texto: string }> = [];
const telefonosQueFallan = new Set<string>();
let avisoOk = true;
vi.mock('@/lib/meta/aviso_oficina', async (orig) => ({
  ...(await orig<typeof import('@/lib/meta/aviso_oficina')>()),
  avisarOficina: vi.fn(async (tel: string, texto: string) => { avisos.push({ tel, texto }); return avisoOk && !telefonosQueFallan.has(tel) ? { ok: true, via: 'texto', id: 'w' } : { ok: false, motivo: 'x', fueraDeVentana: true }; }),
}));
vi.mock('../presupuesto', async (orig) => ({ ...(await orig<typeof import('../presupuesto')>()), acotada: (q: unknown) => q }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const serv = await import('./servicio');
const { entregaPorOutbox } = await import('./entrega');
const { atenderAcuseLiquidacionExterna } = await import('./acuse');
const { validarLiquidacionExterna, huellaContenido } = await import('./esquema');
const { generarExportacion, leerOpcionesExportacion } = await import('./exportacion');
const { aAcuseApi } = await import('./api');

const AHORA = new Date('2026-09-10T12:00:00.000Z');
const deps = { ...serv.dependenciasPorOmision, entrega: entregaPorOutbox, ahora: () => AHORA, firmarPdf: async () => 'https://storage.example/firmada.pdf?token=abc', razonSocial: async () => 'Flota SA' };

const cuerpo = (clave = 'SAP-1') => validarLiquidacionExterna({
  claveExterna: clave, sistemaOrigen: 'SAP', operador: { telefono: '5512345678' }, viajes: ['VJ-1'],
  periodo: { desde: '2026-09-01', hasta: '2026-09-07' },
  conceptos: [{ clave: 'P010', descripcion: 'Sueldo', tipo: 'percepcion', monto: 1500 }, { clave: 'D020', descripcion: 'Anticipo', tipo: 'deduccion', monto: 300 }],
  total: 1200, moneda: 'MXN',
});
async function entrar(tenant = 't-A', clave = 'SAP-1') {
  const d = cuerpo(clave);
  return (await serv.recibirLiquidacionExterna(tenant, d, huellaContenido(d), deps)).liquidacion;
}
const tocar = (id: string) => ({ tenantId: store.get(id)!.tenantId, operadorId: store.get(id)!.operadorId });

beforeEach(() => {
  store.clear(); eventos.length = 0; outbox.clear(); avisos.length = 0; seq = 0; archivos.clear(); formatos.clear(); reclamosCopia.clear(); telefonosQueFallan.clear(); sinCandado = false;
  ventana = 'abierta'; avisoOk = true; telefonoDinero = '525599990000';
});

describe('FELIZ: de la entrada al retorno al SAP', () => {
  it('recibe → entrega con documento+botones → chofer «Recibida» → pull de acuses → confirmación → ya no sale', async () => {
    const liq = await entrar();
    expect(liq.estado).toBe('pendiente');

    // salida: dentro de la ventana, UN mensaje de sesión con el PDF en el encabezado y dos botones
    expect(await serv.intentarEntrega(liq, deps)).toBe('en_cola');
    const [salida] = [...outbox.values()];
    expect(salida.dedupe_key).toBe(`liqext:${liq.id}:g1:sesion`);
    const interactivo = (salida.payload as { interactive: { header: { type: string }; action: { buttons: Array<{ reply: { id: string } }> } } }).interactive;
    expect(interactivo.header.type).toBe('document');
    expect(interactivo.action.buttons.map((b) => b.reply.id)).toEqual([`liqext_ok:${liq.id}`, `liqext_no:${liq.id}`]);

    // el cron del outbox la manda; el cron de Likida concilia
    cronOutbox('sent');
    const r = await serv.procesarLiquidacionesExternas(deps, 10);
    expect(r).toMatchObject({ tomadas: 1, enviadas: 1 });
    expect(store.get(liq.id)).toMatchObject({ estado: 'enviada', via: 'sesion' });

    // el chofer aprieta «Recibida»
    const respuesta = await atenderAcuseLiquidacionExterna(tocar(liq.id), `liqext_ok:${liq.id}`);
    expect(respuesta).toMatch(/quedó registrado que recibiste/);
    expect(store.get(liq.id)).toMatchObject({ estado: 'acusada', acuseTipo: 'recibida' });
    expect(avisos).toHaveLength(0); // «Recibida» no molesta a la oficina

    // retorno por pull: el SAP lee, registra y confirma
    const { filas } = await (await import('./repo')).listarAcusesPendientes('t-A', 50, null);
    expect(filas.map(aAcuseApi)).toEqual([expect.objectContaining({ id: liq.id, claveExterna: 'SAP-1', respuestaChofer: 'recibida' })]);
    expect(await serv.confirmarAcusesLeidos('t-A', [liq.id], 'api', deps)).toEqual({ confirmadas: [liq.id], yaConfirmadas: [], noAplican: [] });
    expect((await (await import('./repo')).listarAcusesPendientes('t-A', 50, null)).filas).toHaveLength(0);

    // la exportación para su contabilidad
    const o = leerOpcionesExportacion(new URLSearchParams('columnas=claveExterna,total,respuestaChofer,acuseConfirmadoEn&fechas=sap&decimal=coma&separador=punto_y_coma'));
    if (!o.ok) throw new Error(o.mensaje);
    const { filas: todas } = await (await import('./repo')).listarParaExportacion('t-A', {}, 900);
    expect(generarExportacion(todas, o.opciones)).toBe('claveExterna;total;respuestaChofer;acuseConfirmadoEn\nSAP-1;1200,00;recibida;20260910\n');
    expect(eventos.map((e) => e.tipo)).toEqual(expect.arrayContaining(['recibida', 'encolada', 'enviada', 'acuse_recibida', 'acuse_confirmado']));
  });

  it('«No coincide» avisa a quien ve dinero y SOLO entonces se le promete al chofer', async () => {
    const liq = await entrar();
    await serv.intentarEntrega(liq, deps); cronOutbox('sent'); await serv.procesarLiquidacionesExternas(deps, 10);
    const respuesta = await atenderAcuseLiquidacionExterna(tocar(liq.id), `liqext_no:${liq.id}`);
    expect(respuesta).toMatch(/Ya le avisé a tu oficina/);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].tel).toBe('525599990000');
    expect(avisos[0].texto).toMatch(/Juan Pérez García.*No coincide.*SAP-1/);
    expect(avisos[0].texto).not.toMatch(/1,?200|\$/); // el aviso no lleva cifras
    expect(eventos.find((e) => e.tipo === 'aviso_oficina')?.detalle).toEqual({ enviado: true });
  });
});

describe('FALLO', () => {
  it('ventana cerrada → plantilla con documento; no aprobada (132001) → fallida; el reintento manual usa llaves nuevas y sale', async () => {
    ventana = 'cerrada';
    const liq = await entrar();
    await serv.intentarEntrega(liq, deps);
    expect([...outbox.keys()]).toEqual([`liqext:${liq.id}:g1:plantilla`]);
    cronOutbox({ dead: 'terminal:HTTP 400: {"error":{"code":132001,"message":"template not found"}}' });
    await serv.procesarLiquidacionesExternas(deps, 10);
    expect(store.get(liq.id)).toMatchObject({ estado: 'fallida', via: 'plantilla' });

    // el panel reintenta: generación 2 → llaves nuevas (no rebota contra la fila muerta)
    expect(await serv.reintentarLiquidacionExterna('t-A', liq.id, 'dueño', deps)).toBe('reintentada');
    expect([...outbox.keys()]).toContain(`liqext:${liq.id}:g2:plantilla`);
    cronOutbox('sent'); await serv.procesarLiquidacionesExternas(deps, 10);
    expect(store.get(liq.id)).toMatchObject({ estado: 'enviada', via: 'plantilla' });
  });

  it('ventana desconocida: la sesión muere por 131047 → cae a plantilla UNA vez', async () => {
    ventana = 'desconocida';
    const liq = await entrar();
    await serv.intentarEntrega(liq, deps);
    cronOutbox({ dead: 'terminal:HTTP 400: {"error":{"code":131047,"message":"Re-engagement message"}}' });
    await serv.procesarLiquidacionesExternas(deps, 10);
    await serv.procesarLiquidacionesExternas(deps, 10);
    expect([...outbox.keys()].sort()).toEqual([`liqext:${liq.id}:g1:plantilla`, `liqext:${liq.id}:g1:sesion`]);
    cronOutbox('sent'); await serv.procesarLiquidacionesExternas(deps, 10);
    expect(store.get(liq.id)).toMatchObject({ estado: 'enviada', via: 'plantilla' });
  });

  it('«No coincide» sin destinatario de dinero o con el aviso rechazado: se DICE (no se promete) y el acuse queda', async () => {
    telefonoDinero = null;
    const a = await entrar('t-A', 'A-1');
    await serv.intentarEntrega(a, deps); cronOutbox('sent'); await serv.procesarLiquidacionesExternas(deps, 10);
    expect(await atenderAcuseLiquidacionExterna(tocar(a.id), `liqext_no:${a.id}`)).toMatch(/no pude avisarles/);
    expect(avisos).toHaveLength(0);
    expect(store.get(a.id)!.estado).toBe('acusada');

    telefonoDinero = '525599990000'; avisoOk = false;
    const b = await entrar('t-A', 'A-2');
    expect(await atenderAcuseLiquidacionExterna(tocar(b.id), `liqext_no:${b.id}`)).toMatch(/no pude avisarles/);
    expect(avisos).toHaveLength(1);
  });
});

describe('DUPLICADO', () => {
  it('POST y cron a la vez, y el cron otra vez: UNA sola fila en el outbox', async () => {
    const liq = await entrar();
    await Promise.all([serv.intentarEntrega({ ...liq }, deps), serv.intentarEntrega({ ...liq }, deps), serv.procesarLiquidacionesExternas(deps, 10)]);
    await serv.procesarLiquidacionesExternas(deps, 10);
    expect(outbox.size).toBe(1);
  });

  it('el mismo botón dos veces: un solo acuse, un solo aviso a la oficina; confirmar dos veces es inocuo', async () => {
    const liq = await entrar();
    await serv.intentarEntrega(liq, deps); cronOutbox('sent'); await serv.procesarLiquidacionesExternas(deps, 10);
    await atenderAcuseLiquidacionExterna(tocar(liq.id), `liqext_no:${liq.id}`);
    expect(await atenderAcuseLiquidacionExterna(tocar(liq.id), `liqext_no:${liq.id}`)).toMatch(/Ya tenía registrada/);
    expect(avisos).toHaveLength(1);
    await serv.confirmarAcusesLeidos('t-A', [liq.id], 'api', deps);
    expect(await serv.confirmarAcusesLeidos('t-A', [liq.id], 'api', deps)).toEqual({ confirmadas: [], yaConfirmadas: [liq.id], noAplican: [] });
    expect(eventos.filter((e) => e.tipo === 'acuse_confirmado')).toHaveLength(1);
  });
});

describe('FUERA DE ORDEN', () => {
  it('el chofer acusa ANTES de que el cron concilie el envío: la liquidación no retrocede a «enviada»', async () => {
    const liq = await entrar();
    const foto = { ...liq };
    await serv.intentarEntrega(liq, deps);
    await atenderAcuseLiquidacionExterna(tocar(liq.id), `liqext_ok:${liq.id}`);
    cronOutbox('sent');
    expect(await serv.intentarEntrega(foto, deps)).toBe('enviada'); // el cron con una foto vieja
    expect(store.get(liq.id)).toMatchObject({ estado: 'acusada', acuseTipo: 'recibida' });
  });

  it('el chofer cambia de «Recibida» a «No coincide» DESPUÉS de que el SAP confirmó: el acuse nuevo vuelve a salir', async () => {
    const liq = await entrar();
    await serv.intentarEntrega(liq, deps); cronOutbox('sent'); await serv.procesarLiquidacionesExternas(deps, 10);
    await atenderAcuseLiquidacionExterna(tocar(liq.id), `liqext_ok:${liq.id}`);
    await serv.confirmarAcusesLeidos('t-A', [liq.id], 'api', deps);
    await atenderAcuseLiquidacionExterna(tocar(liq.id), `liqext_no:${liq.id}`);
    const { filas } = await (await import('./repo')).listarAcusesPendientes('t-A', 50, null);
    expect(filas.map((f) => [f.id, f.acuseTipo])).toEqual([[liq.id, 'no_coincide']]);
  });

  it('una confirmación de un id SIN acuse todavía no aplica (no se «adelanta» al chofer)', async () => {
    const liq = await entrar();
    expect(await serv.confirmarAcusesLeidos('t-A', [liq.id], 'api', deps)).toEqual({ confirmadas: [], yaConfirmadas: [], noAplican: [liq.id] });
    expect(store.get(liq.id)!.acuseConfirmadoEn).toBeNull();
  });
});

describe('OTRO TENANT', () => {
  it('la flota B no acusa, no confirma, no lista ni exporta lo de la flota A', async () => {
    const a = await entrar('t-A');
    await serv.intentarEntrega(a, deps); cronOutbox('sent'); await serv.procesarLiquidacionesExternas(deps, 10);

    // un chofer de OTRA flota (mismo botón) no puede acusar
    expect(await atenderAcuseLiquidacionExterna({ tenantId: 't-B', operadorId: 'op-B' }, `liqext_ok:${a.id}`)).toMatch(/No encontré esa liquidación/);
    expect(store.get(a.id)!.estado).toBe('enviada');

    await atenderAcuseLiquidacionExterna(tocar(a.id), `liqext_ok:${a.id}`);
    const repo = await import('./repo');
    expect((await repo.listarAcusesPendientes('t-B', 50, null)).filas).toHaveLength(0);
    expect(await serv.confirmarAcusesLeidos('t-B', [a.id], 'llave-B', deps)).toEqual({ confirmadas: [], yaConfirmadas: [], noAplican: [a.id] });
    expect((await repo.listarParaExportacion('t-B', {}, 900)).filas).toHaveLength(0);
    expect(store.get(a.id)!.acuseConfirmadoEn).toBeNull();
  });

  it('el aviso de «No coincide» va al destinatario de dinero de SU flota, no al de otra', async () => {
    const b = await entrar('t-B', 'B-1');
    await serv.intentarEntrega(b, deps); cronOutbox('sent'); await serv.procesarLiquidacionesExternas(deps, 10);
    await atenderAcuseLiquidacionExterna(tocar(b.id), `liqext_no:${b.id}`);
    expect(avisos.map((x) => x.tel)).toEqual(['525588880000']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FASE 1 COMO LA PIDIÓ LA FLOTA: el cálculo es SUYO; Likida toma el dato del
// pago y lo manda al operador en SU formato (PDF y Excel), con COPIA al jefe de
// flota, y las discrepancias («No coincide») AVISAN a la persona responsable.
//
// El formato sale de un Excel de muestra SINTÉTICO (una flota inventada) que se
// construye con la misma librería de hojas; cuando llegue el formato real del
// cliente (BLOQUEO EXTERNO) se agrega como fixture y se calibra el diccionario.
// ═══════════════════════════════════════════════════════════════════════════

const { derivarFormatoDeMatriz } = await import('./formato_flota');

const MUESTRA_FLOTA: unknown[][] = [
  ['LIQUIDACIÓN DE OPERADORES'],
  ['Operador:', 'Nombre'],
  ['Folio:', 'X'],
  ['Periodo:', 'X'],
  [],
  ['Cve.', 'Concepto', 'Percepciones', 'Deducciones'],
  ['P1', 'Sueldo', 100, ''],
  ['', 'Total a pagar', 100],
];
function formatoDeMuestra(salida: 'pdf' | 'xlsx', extra: Partial<ConfigFormatoFlota> = {}): ConfigFormatoFlota {
  const r = derivarFormatoDeMatriz(MUESTRA_FLOTA as never);
  if (!r.ok) throw new Error(r.motivo);
  return { formato: { ...r.formato, salida }, nombreMuestra: 'muestra.xlsx', copiaTelefonos: [], discrepanciaTelefonos: [], ...extra };
}
const JEFE = '525511110001';
const RESPONSABLE = '525511110002';
// Cada documento firmado conserva su ruta: así se ve QUÉ archivo viaja.
const depsFormato = { ...deps, firmarPdf: async (ruta: string) => `https://storage.example/${ruta}?token=abc` };
const leerExcel = (ruta: string) => {
  const a = archivos.get(ruta);
  if (!a) throw new Error(`no se subió ${ruta}`);
  return XLSX.utils.sheet_to_json<unknown[]>(XLSX.read(a.bytes, { type: 'array' }).Sheets.Liquidación, { header: 1, defval: null });
};
async function entrarFmt(tenant = 't-A', clave = 'SAP-1') {
  const d = cuerpo(clave);
  return (await serv.recibirLiquidacionExterna(tenant, d, huellaContenido(d), depsFormato)).liquidacion;
}

describe('FORMATO DE LA FLOTA: PDF y Excel con sus columnas', () => {
  it('con formato configurado suben el PDF y el Excel de la flota (cifras tal cual, total del cliente como número)', async () => {
    formatos.set('t-A', formatoDeMuestra('pdf'));
    const liq = await entrarFmt();
    const rutaPdf = liq.pdfRuta as string;
    expect(archivos.get(rutaPdf)?.tipo).toBe('application/pdf');
    const rutaXlsx = rutaPdf.replace(/\.pdf$/, '.xlsx');
    expect(archivos.get(rutaXlsx)?.tipo).toMatch(/spreadsheetml/);
    const m = leerExcel(rutaXlsx);
    expect(m[0][0]).toBe('LIQUIDACIÓN DE OPERADORES');
    const enc = m.findIndex((f) => f[0] === 'Cve.');
    expect(m[enc].slice(0, 4)).toEqual(['Cve.', 'Concepto', 'Percepciones', 'Deducciones']);
    expect(m[enc + 1].slice(0, 4)).toEqual(['P010', 'Sueldo', 1500, null]);
    expect(m[enc + 2].slice(0, 4)).toEqual(['D020', 'Anticipo', null, 300]);
    expect(m.find((f) => f[0] === 'Total a pagar')).toContain(1200);
    expect(eventos.find((e) => e.tipo === 'recibida')?.detalle.formatoFlota).toBe(true);
  });

  it('sin formato todo sigue como siempre: solo el PDF genérico, sin Excel', async () => {
    const liq = await entrarFmt();
    expect([...archivos.keys()]).toEqual([liq.pdfRuta]);
    expect(eventos.find((e) => e.tipo === 'recibida')?.detalle.formatoFlota).toBe(false);
  });

  it('salida pdf: por WhatsApp viaja el PDF; salida xlsx: viaja el Excel con su nombre', async () => {
    formatos.set('t-A', formatoDeMuestra('pdf'));
    const a = await entrarFmt('t-A', 'F-1');
    await serv.intentarEntrega(a, depsFormato);
    const hdr = (k: string) => (outbox.get(k)!.payload as { interactive: { header: { document: { link: string; filename: string } } } }).interactive.header.document;
    expect(hdr(`liqext:${a.id}:g1:sesion`).filename).toBe('liquidacion-F-1.pdf');
    expect(hdr(`liqext:${a.id}:g1:sesion`).link).toMatch(/\.pdf\?/);

    formatos.set('t-A', formatoDeMuestra('xlsx'));
    const b = await entrarFmt('t-A', 'F-2');
    await serv.intentarEntrega(b, depsFormato);
    expect(hdr(`liqext:${b.id}:g1:sesion`).filename).toBe('liquidacion-F-2.xlsx');
    expect(hdr(`liqext:${b.id}:g1:sesion`).link).toMatch(/\.xlsx\?/);
  });

  it('el PDF que adjunta el cliente manda: no se reformatea ni se sube Excel', async () => {
    formatos.set('t-A', formatoDeMuestra('xlsx'));
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n').toString('base64');
    const d = validarLiquidacionExterna({
      claveExterna: 'ADJ-1', operador: { telefono: '5512345678' }, viajes: ['VJ-1'], periodo: { desde: '2026-09-01', hasta: '2026-09-07' },
      conceptos: [{ descripcion: 'Sueldo', tipo: 'percepcion', monto: 100 }], total: 100, moneda: 'MXN', pdf: { base64: pdf },
    });
    const liq = (await serv.recibirLiquidacionExterna('t-A', d, huellaContenido(d), depsFormato)).liquidacion;
    expect(liq.pdfOrigen).toBe('adjunto');
    expect([...archivos.keys()]).toEqual([liq.pdfRuta]);
    await serv.intentarEntrega(liq, depsFormato);
    const doc = (outbox.get(`liqext:${liq.id}:g1:sesion`)!.payload as { interactive: { header: { document: { filename: string } } } }).interactive.header.document;
    expect(doc.filename).toMatch(/\.pdf$/);
  });

  it('salida xlsx pero el Excel no está en Storage (llegó antes del formato): se entrega el PDF, no se cae', async () => {
    const liq = await entrarFmt('t-A', 'VIEJA'); // sin formato → solo PDF
    formatos.set('t-A', formatoDeMuestra('xlsx'));
    const sinExcel = { ...depsFormato, firmarPdf: async (ruta: string) => { if (ruta.endsWith('.xlsx')) throw new Error('Object not found'); return `https://storage.example/${ruta}`; } };
    expect(await serv.intentarEntrega(liq, sinExcel)).toBe('en_cola');
    const doc = (outbox.get(`liqext:${liq.id}:g1:sesion`)!.payload as { interactive: { header: { document: { filename: string } } } }).interactive.header.document;
    expect(doc.filename).toBe('liquidacion-VIEJA.pdf');
  });

  it('el formato de la flota A no se aplica a la flota B', async () => {
    formatos.set('t-A', formatoDeMuestra('xlsx'));
    const b = await entrarFmt('t-B', 'B-9');
    expect([...archivos.keys()]).toEqual([b.pdfRuta]);
  });
});

describe('COPIA AL JEFE DE FLOTA', () => {
  const textoCopia = () => avisos.filter((a) => a.tel === JEFE);

  it('al quedar en cola la entrega, el jefe recibe UNA copia con periodo, total y la liga del documento', async () => {
    formatos.set('t-A', formatoDeMuestra('pdf', { copiaTelefonos: [JEFE] }));
    const liq = await entrarFmt();
    await serv.intentarEntrega(liq, depsFormato);
    expect(textoCopia()).toHaveLength(1);
    const t = textoCopia()[0].texto;
    expect(t).toMatch(/Copia de la liquidación SAP-1 de Juan Pérez García/);
    expect(t).toMatch(/1,200\.00/);
    expect(t).toMatch(/https:\/\/storage\.example\/.+\.pdf\?token=abc/);
    expect(eventos.find((e) => e.tipo === 'aviso_oficina')?.detalle).toMatchObject({ destino: 'copia_jefe', enviado: true, aceptados: 1, destinatarios: 1 });
  });

  it('el cron, el POST otra vez y la conciliación NO repiten la copia', async () => {
    formatos.set('t-A', formatoDeMuestra('pdf', { copiaTelefonos: [JEFE] }));
    const liq = await entrarFmt();
    await serv.intentarEntrega(liq, depsFormato);
    cronOutbox('sent');
    await serv.procesarLiquidacionesExternas(depsFormato, 10);
    await serv.procesarLiquidacionesExternas(depsFormato, 10);
    await serv.intentarEntrega({ ...liq }, depsFormato);
    expect(store.get(liq.id)!.estado).toBe('enviada');
    expect(textoCopia()).toHaveLength(1);
  });

  it('sin jefe designado NO se manda copia a nadie (la copia lleva cifras: no se adivina el destinatario)', async () => {
    formatos.set('t-A', formatoDeMuestra('pdf'));
    const liq = await entrarFmt();
    await serv.intentarEntrega(liq, depsFormato);
    expect(avisos).toHaveLength(0);
  });

  it('si la copia no sale, la entrega al chofer NO se cae; queda dicho y se puede reenviar desde el panel', async () => {
    formatos.set('t-A', formatoDeMuestra('pdf', { copiaTelefonos: [JEFE] }));
    avisoOk = false;
    const liq = await entrarFmt();
    expect(await serv.intentarEntrega(liq, depsFormato)).toBe('en_cola');
    expect(eventos.find((e) => e.tipo === 'aviso_oficina')?.detalle).toMatchObject({ destino: 'copia_jefe', enviado: false });

    avisoOk = true;
    const r = await serv.reenviarCopiaAJefe('t-A', liq.id, depsFormato);
    expect(r).toMatchObject({ estado: 'enviada', aceptados: 1 });
    expect(await serv.reenviarCopiaAJefe('t-A', liq.id, depsFormato)).toEqual({ estado: 'ya_enviada' });
    expect(await serv.reenviarCopiaAJefe('t-B', liq.id, depsFormato)).toEqual({ estado: 'no_encontrada' });
  });

  it('con varios jefes, cada uno por su cuenta: que uno falle no calla a los demás', async () => {
    formatos.set('t-A', formatoDeMuestra('pdf', { copiaTelefonos: [JEFE, '525511110009'] }));
    const liq = await entrarFmt();
    await serv.intentarEntrega(liq, depsFormato);
    expect(avisos.map((a) => a.tel)).toEqual([JEFE, '525511110009']);
  });

  it('M3: si solo uno de dos jefes la recibe, NO queda «enviada» y el reintento va SOLO al faltante', async () => {
    const OTRO = '525511110009';
    formatos.set('t-A', formatoDeMuestra('pdf', { copiaTelefonos: [JEFE, OTRO] }));
    telefonosQueFallan.add(OTRO);
    const liq = await entrarFmt();
    await serv.intentarEntrega(liq, depsFormato);
    const ev = eventos.filter((e) => e.tipo === 'aviso_oficina' && e.detalle.destino === 'copia_jefe');
    expect(ev).toHaveLength(1);
    expect(ev[0].detalle).toMatchObject({ enviado: false, aceptados: 1, destinatarios: 2, telefonos_aceptados: [JEFE] });

    telefonosQueFallan.clear();
    avisos.length = 0;
    const r = await serv.reenviarCopiaAJefe('t-A', liq.id, depsFormato);
    expect(r).toMatchObject({ estado: 'enviada', aceptados: 2, destinatarios: 2 });
    expect(avisos.map((a) => a.tel)).toEqual([OTRO]); // el primero NO la recibe dos veces
    expect(await serv.reenviarCopiaAJefe('t-A', liq.id, depsFormato)).toEqual({ estado: 'ya_enviada' });
  });

  it('M3: un evento anterior sin la lista de aceptados y con enviado=true se lee como «todos»', async () => {
    formatos.set('t-A', formatoDeMuestra('pdf', { copiaTelefonos: [JEFE] }));
    const liq = await entrarFmt();
    store.get(liq.id)!.estado = 'enviada';
    eventos.push({ id: liq.id, tipo: 'aviso_oficina', detalle: { destino: 'copia_jefe', generacion: 1, enviado: true, aceptados: 1, destinatarios: 1 } });
    expect(await serv.reenviarCopiaAJefe('t-A', liq.id, depsFormato)).toEqual({ estado: 'ya_enviada' });
    expect(avisos).toHaveLength(0);
  });

  it('M4: dos invocaciones concurrentes mandan UNA sola copia por teléfono', async () => {
    formatos.set('t-A', formatoDeMuestra('pdf', { copiaTelefonos: [JEFE, '525511110009'] }));
    const liq = await entrarFmt();
    store.get(liq.id)!.estado = 'enviada';
    await Promise.all([
      serv.reenviarCopiaAJefe('t-A', liq.id, depsFormato),
      serv.reenviarCopiaAJefe('t-A', liq.id, depsFormato),
    ]);
    expect(avisos.filter((x) => x.tel === JEFE)).toHaveLength(1);
    expect(avisos.filter((x) => x.tel === '525511110009')).toHaveLength(1);
    expect(avisos).toHaveLength(2);
  });

  it('M4: una copia que falla SUELTA el reclamo (se puede reintentar); una aceptada lo deja cerrado', async () => {
    formatos.set('t-A', formatoDeMuestra('pdf', { copiaTelefonos: [JEFE] }));
    avisoOk = false;
    const liq = await entrarFmt();
    await serv.intentarEntrega(liq, depsFormato);
    expect([...reclamosCopia.values()]).toEqual([]);
    avisoOk = true;
    expect(await serv.reenviarCopiaAJefe('t-A', liq.id, depsFormato)).toMatchObject({ estado: 'enviada' });
    expect([...reclamosCopia.values()]).toEqual(['aceptada']);
  });

  it('sin la 0620 en la base (sin candado) la copia sigue saliendo por la bitácora', async () => {
    sinCandado = true;
    formatos.set('t-A', formatoDeMuestra('pdf', { copiaTelefonos: [JEFE] }));
    const liq = await entrarFmt();
    await serv.intentarEntrega(liq, depsFormato);
    expect(textoCopia()).toHaveLength(1);
    expect(await serv.reenviarCopiaAJefe('t-A', liq.id, depsFormato)).toEqual({ estado: 'ya_enviada' });
    expect(textoCopia()).toHaveLength(1);
  });
});

describe('DISCREPANCIA: «No coincide» AVISA a la persona responsable', () => {
  async function conNoCoincide() {
    const liq = await entrarFmt();
    await serv.intentarEntrega(liq, depsFormato); cronOutbox('sent'); await serv.procesarLiquidacionesExternas(depsFormato, 10);
    avisos.length = 0; // lo que importa es el aviso de la discrepancia, no la copia
    return atenderAcuseLiquidacionExterna(tocar(liq.id), `liqext_no:${liq.id}`);
  }

  it('va a la persona responsable designada (no a quien ve dinero)', async () => {
    formatos.set('t-A', formatoDeMuestra('pdf', { discrepanciaTelefonos: [RESPONSABLE], copiaTelefonos: [JEFE] }));
    expect(await conNoCoincide()).toMatch(/Ya le avisé a tu oficina/);
    expect(avisos.map((a) => a.tel)).toEqual([RESPONSABLE]);
    expect(avisos[0].texto).toMatch(/No coincide.*SAP-1/);
  });

  it('sin responsable designado cae al jefe de la copia, y sin copia, a quien ve dinero', async () => {
    formatos.set('t-A', formatoDeMuestra('pdf', { copiaTelefonos: [JEFE] }));
    await conNoCoincide();
    expect(avisos.map((a) => a.tel)).toEqual([JEFE]);

    avisos.length = 0; formatos.set('t-A', formatoDeMuestra('pdf'));
    const liq = await entrarFmt('t-A', 'D-2');
    await serv.intentarEntrega(liq, depsFormato); cronOutbox('sent'); await serv.procesarLiquidacionesExternas(depsFormato, 10);
    await atenderAcuseLiquidacionExterna(tocar(liq.id), `liqext_no:${liq.id}`);
    expect(avisos.map((a) => a.tel)).toEqual(['525599990000']);
  });

  it('si el aviso a la persona responsable no sale, NO se le promete nada al chofer y el acuse queda registrado', async () => {
    formatos.set('t-A', formatoDeMuestra('pdf', { discrepanciaTelefonos: [RESPONSABLE] }));
    avisoOk = false;
    const liq = await entrarFmt();
    await serv.intentarEntrega(liq, depsFormato); cronOutbox('sent'); await serv.procesarLiquidacionesExternas(depsFormato, 10);
    expect(await atenderAcuseLiquidacionExterna(tocar(liq.id), `liqext_no:${liq.id}`)).toMatch(/no pude avisarles/);
    expect(store.get(liq.id)!.acuseTipo).toBe('no_coincide');
  });
});
