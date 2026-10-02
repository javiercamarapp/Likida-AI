import { beforeEach, describe, expect, it, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// E2E AGENTE 3 — CARTA PORTE MULTI-FORMATO (lo que manda el cliente → revisión → viaje → export a SU formato).
//
// Cadena REAL: 3 canales (panel, WhatsApp, correo Resend) → recibirDocumento (huella sha256, retención) → procesarDocumento
// (claim con lease, escalamiento de modelo) → validación → revisión humana (versión optimista) → aprobación → salida
// al viaje (aplicarSalidaViaje) → exportarDocumentos. DOBLES: repo en memoria (repo_falso.fixture), LLM de guion, Resend, Meta.
// Documentos SINTÉTICOS (clientes «Boreal»/«Atlas», RFC de prueba).
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('../carta_porte_docs/repo', async () => (await import('../carta_porte_docs/repo_falso.fixture')).api);
vi.mock('../bitacora_escritura', () => ({ anotarBitacora: vi.fn(async () => true) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
// El CRON de la bandeja (0640-0642): la ruta REAL con su motor real; solo la puerta, los interruptores, el teléfono de la
// oficina y WhatsApp son dobles. Los datos pasan por el repo en memoria.
const { avisosOficina, latidos, depsHolder } = vi.hoisted(() => ({
  avisosOficina: [] as Array<{ telefono: string; texto: string }>,
  latidos: [] as unknown[][],
  depsHolder: { envio: null as null | (() => unknown), modelo: null as null | (() => unknown) },
}));
vi.mock('@/lib/admin/salud', () => ({ puertaCron: async () => null, registrarLatido: async (...a: unknown[]) => { latidos.push(a); } }));
vi.mock('@/lib/likida/interruptores', async (original) => ({ ...(await original<Record<string, unknown>>()), leerInterruptor: async () => 'encendido', estaApagado: async () => false }));
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: async () => {} }));
vi.mock('@/lib/likida/contactos', () => ({ telefonoJefeDe: async (t: string) => (t === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' ? '5215500000001' : null) }));
vi.mock('../carta_porte_docs/worker_deps', async (original) => {
  const real = await original<typeof import('../carta_porte_docs/worker_deps')>();
  return { depsWorkerReales: () => real.depsWorkerReales({ apagado: async () => false, llm: () => (depsHolder.modelo as () => LlmExtractor)() }) };
});
vi.mock('@/lib/meta/aviso_oficina', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  avisarOficina: async (telefono: string, texto: string) => {
    avisosOficina.push({ telefono, texto });
    return depsHolder.envio ? depsHolder.envio() : { ok: true, via: 'texto', id: 'w1' };
  },
}));

import { estado, reset } from '../carta_porte_docs/repo_falso.fixture';
import { A, B, ACTOR, USUARIO_B, lecturaAtlas, llmBoreal, sembrarFlotas, sinAgenteApagado, subir, subirYProcesar } from '../carta_porte_docs/escenario.fixture';
import { llmFalso, lecturaBoreal, type LlmFalso } from '../carta_porte_docs/llm_falso.fixture';
import type { LlmExtractor } from '../carta_porte_docs/extractor';
import { defectuosos, EMBARQUE_ATLAS, excelAtlas, filaAtlas, pdfBoreal } from '../carta_porte_docs/documentos_sinteticos.fixture';
import { aprobarDocumento, corregirCampos, abrirRevision, rechazarDocumento, reabrirDocumento, ConflictoDeVersion } from '../carta_porte_docs/bandeja';
import { atenderCorreoCartaPorte, type DepsCorreo } from '../carta_porte_docs/correo_entrante';
import { ingerirDesdeWhatsapp, type DepsWhatsapp } from '../carta_porte_docs/whatsapp';
import { procesarDocumento, recibirDocumento } from '../carta_porte_docs/servicio';
import { exportarDocumentos, configEstandar } from '../carta_porte_docs/exportacion';
import { calcularMetricas } from '../carta_porte_docs/metricas';
import * as repo from '../carta_porte_docs/repo';

const TOKEN_A = 'abcdefghjkmnpqrstvwxyz23';
const TOKEN_B = 'zyxwvtsrqpnmkjhgfedcba98'.slice(0, 24);
const tipos = (id: string) => estado.eventos.filter((e) => e.documentoId === id).map((e) => e.tipo);
const docs = (t: string) => [...estado.docs.values()].filter((d) => d.tenantId === t);

beforeEach(async () => {
  reset(); sembrarFlotas();
  process.env.RESEND_API_KEY = 'llave-sintetica';
  await repo.crearBuzon(A, TOKEN_A); await repo.crearBuzon(B, TOKEN_B);
});

const depsCorreo = (adjuntos: Record<string, Uint8Array | 'caida'>, over: Partial<DepsCorreo> = {}): DepsCorreo => ({
  ...sinAgenteApagado, llm: () => llmBoreal(), restanteMs: () => 60_000,
  descargar: async (_e, id) => { const a = adjuntos[id]; return a === 'caida' || !a ? { ok: false, transitorio: true } : { ok: true, bytes: a }; }, ...over,
});
const aDataUrl = (b: Uint8Array, mime: string) => `data:${mime};base64,${Buffer.from(b).toString('base64')}`;
const depsWa = (bytes: Uint8Array | null, mime = 'application/pdf', respuestas: string[] = []): DepsWhatsapp => ({
  ...sinAgenteApagado, llm: () => llmBoreal(), restanteMs: () => 60_000,
  metadatos: async () => (bytes ? { mimeType: mime, fileSize: bytes.length } : null),
  descargar: async () => (bytes ? aDataUrl(bytes, mime) : null), responder: async (t) => { respuestas.push(t); },
});
const wa = (tenantId: string, id = 'media-0001') => ({ tenantId, userId: ACTOR.id, mensaje: { type: 'document', mediaId: id }, nombreRemitente: 'Oficina Ficticia', urlBandeja: 'https://app.likida.ai/dashboard/carta-porte/documentos' });

describe('feliz: tres canales → una bandeja → aprobación → viaje → export', () => {
  it('el PDF del cliente por el PANEL se lee, se revisa, se aprueba, crea el viaje con su mercancía y sale en el CSV', async () => {
    const r = await subirYProcesar(A, await pdfBoreal(), llmBoreal(), 'orden.pdf', { clienteId: 'cli-boreal', remitente: 'logistica@boreal.example' });
    expect(r.proceso).toMatchObject({ ok: true, estado: 'por_revisar' });
    const d = () => estado.docs.get(r.documentoId)!;
    await abrirRevision(A, r.documentoId, ACTOR.id, new Date('2026-10-02T10:00:00Z'));
    const ap = await aprobarDocumento(A, r.documentoId, d().version, ACTOR, { ahora: new Date('2026-10-02T10:03:00Z') });
    expect(ap.documento).toMatchObject({ estado: 'aprobado', tiempoRevisionSeg: 180 });
    expect(estado.viajes.filter((v) => v.folio === 'BOR-77120')).toHaveLength(1);
    expect(estado.mercancias.filter((m) => m.documentoId === r.documentoId)).toHaveLength(1);

    const { filas } = await repo.listarDocumentos(A, { estados: ['aprobado', 'por_revisar'] });
    const csv = exportarDocumentos(filas.map((doc) => ({ doc, viajeFolio: 'BOR-77120' })), 'csv', configEstandar(), 'Formato Ficticio', new Date('2026-10-02T12:00:00Z'));
    expect(csv).toMatchObject({ documentos: 1, filas: 1 });
    expect(csv.contenido).toMatch(/BOR-77120/);
  });

  it('el mismo flujo por WHATSAPP (el operador manda el PDF) contesta con la liga a la bandeja y deja el documento por revisar', async () => {
    const respuestas: string[] = [];
    expect(await ingerirDesdeWhatsapp(wa(A), depsWa(await pdfBoreal(), 'application/pdf', respuestas))).toBe('atendido');
    expect(respuestas[0]).toMatch(/ya lo leí.*\/dashboard\/carta-porte\/documentos\//);
    expect(docs(A)).toHaveLength(1);
    expect(docs(A)[0]).toMatchObject({ canal: 'whatsapp', estado: 'por_revisar' });
  });

  it('el mismo flujo por CORREO (Resend firmado, ya verificado por la ruta): adjuntos de varios formatos entran a la flota del TOKEN', async () => {
    const r = await atenderCorreoCartaPorte(TOKEN_A, { emailId: 'em-1', from: 'Logística <logistica@cliente.example>', subject: 'Embarque CG-1', attachments: [{ id: 'a1', filename: 'orden.pdf' }, { id: 'a2', filename: 'plan.xlsx' }] },
      depsCorreo({ a1: await pdfBoreal(), a2: excelAtlas() }, { llm: () => llmFalso((e) => lecturaBoreal(e.nivel)) }));
    expect(r).toMatchObject({ status: 200, cuerpo: { ok: true, recibidos: 2 } });
    expect(docs(A).every((d) => d.canal === 'correo')).toBe(true);
    expect(docs(B)).toHaveLength(0);
  });
});

describe('fallo', () => {
  it('un PDF dañado queda fallido PERMANENTE con el motivo; un fallo del modelo es REINTENTABLE y el reintento funciona', async () => {
    const roto = await subir(A, await defectuosos.pdfTruncado());
    expect(await procesarDocumento(A, roto.documentoId, { ...sinAgenteApagado, llm: () => llmBoreal() })).toMatchObject({ ok: false, motivo: 'ilegible', permanente: true });
    const ok = await subir(A, await pdfBoreal());
    const caido = llmFalso(() => { throw new Error('502 bad gateway'); });
    expect(await procesarDocumento(A, ok.documentoId, { ...sinAgenteApagado, llm: () => caido })).toMatchObject({ ok: false, motivo: 'modelo', permanente: false });
    expect(await procesarDocumento(A, ok.documentoId, { ...sinAgenteApagado, llm: () => llmBoreal() })).toMatchObject({ ok: true });
    expect(estado.docs.get(ok.documentoId)!.estado).toBe('por_revisar');
  });

  it('NO se aprueba con un bloqueo (falta el RFC del destino): el mensaje dice qué falta y NO se crea viaje', async () => {
    const llm = llmFalso((e) => { const s = lecturaBoreal(e.nivel); s.campos = s.campos.filter((c) => c.clave !== 'destino_rfc'); return s; });
    const r = await subirYProcesar(A, await pdfBoreal(), llm);
    await expect(aprobarDocumento(A, r.documentoId, estado.docs.get(r.documentoId)!.version, ACTOR)).rejects.toThrow(/RFC del destinatario/);
    expect(estado.viajes).toHaveLength(0);
  });

  it('un adjunto de correo que se cae (transitorio): 503 para que Resend reintente, el claim se libera y el segundo intento entra sin duplicar', async () => {
    const adj = [{ id: 'a1', filename: 'orden.pdf' }];
    const r1 = await atenderCorreoCartaPorte(TOKEN_A, { emailId: 'em-2', from: 'x@cliente.example', subject: 's', attachments: adj }, depsCorreo({ a1: 'caida' }));
    expect(r1.status).toBe(503);
    const r2 = await atenderCorreoCartaPorte(TOKEN_A, { emailId: 'em-2', from: 'x@cliente.example', subject: 's', attachments: adj }, depsCorreo({ a1: await pdfBoreal() }));
    expect(r2).toMatchObject({ status: 200, cuerpo: { recibidos: 1 } });
    expect(docs(A)).toHaveLength(1);
  });

  it('por WhatsApp: archivo que no se puede abrir o foto HEIC reciben una respuesta útil y no crean documento', async () => {
    const r1: string[] = []; const r2: string[] = [];
    await ingerirDesdeWhatsapp(wa(A), depsWa(null, 'application/pdf', r1));
    await ingerirDesdeWhatsapp(wa(A, 'media-0002'), depsWa(new Uint8Array([1, 2, 3]), 'image/heic', r2));
    expect(r1[0]).toMatch(/No pude abrir/);
    expect(r2[0]).toMatch(/HEIC/);
    expect(docs(A)).toHaveLength(0);
  });

  it('agente apagado: no se recibe nada (y el correo contesta 503 para que no se pierda)', async () => {
    const r = await atenderCorreoCartaPorte(TOKEN_A, { emailId: 'em-3', from: 'x@c.example', subject: 's', attachments: [{ id: 'a1', filename: 'o.pdf' }] }, depsCorreo({ a1: await pdfBoreal() }, { apagado: async () => true }));
    expect(r.status).toBe(503);
    expect(docs(A)).toHaveLength(0);
  });
});

describe('duplicado', () => {
  it('el MISMO archivo por panel, correo y WhatsApp es UN documento (huella), con un evento «duplicado_recibido» por cada reintento', async () => {
    const bytes = await pdfBoreal();
    const a = await subir(A, bytes, 'a.pdf');
    await recibirDocumento(A, { canal: 'correo', nombre: 'b.pdf', bytes }, sinAgenteApagado);
    await ingerirDesdeWhatsapp(wa(A), depsWa(bytes));
    expect(docs(A)).toHaveLength(1);
    expect(tipos(a.documentoId).filter((t) => t === 'duplicado_recibido')).toHaveLength(2);
  });

  it('Resend reentrega el mismo correo: «ya_procesado», sin segundo documento', async () => {
    const d = depsCorreo({ a1: await pdfBoreal() });
    const correo = { emailId: 'em-4', from: 'x@c.example', subject: 's', attachments: [{ id: 'a1', filename: 'o.pdf' }] };
    await atenderCorreoCartaPorte(TOKEN_A, correo, d);
    expect(await atenderCorreoCartaPorte(TOKEN_A, correo, d)).toMatchObject({ status: 200, cuerpo: { ignorado: 'ya_procesado' } });
    expect(docs(A)).toHaveLength(1);
  });

  it('dos aprobaciones simultáneas: gana una, la otra recibe conflicto, y el viaje se crea UNA vez', async () => {
    const r = await subirYProcesar(A, await pdfBoreal(), llmBoreal(), 'o.pdf', { clienteId: 'cli-boreal' });
    const v = estado.docs.get(r.documentoId)!.version;
    const res = await Promise.allSettled([aprobarDocumento(A, r.documentoId, v, ACTOR), aprobarDocumento(A, r.documentoId, v, ACTOR)]);
    expect(res.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(estado.viajes.filter((x) => x.folio === 'BOR-77120')).toHaveLength(1);
  });

  it('dos workers procesando el mismo documento: UNO extrae y le paga al modelo', async () => {
    const r = await subir(A, await pdfBoreal());
    const llm = llmBoreal();
    const [x, y] = await Promise.all([procesarDocumento(A, r.documentoId, { ...sinAgenteApagado, llm: () => llm }), procesarDocumento(A, r.documentoId, { ...sinAgenteApagado, llm: () => llm })]);
    expect([x, y].filter((p) => p.ok)).toHaveLength(1);
  });
});

describe('fuera de orden', () => {
  it('la pantalla estaba vieja: aprobar con una versión anterior a una corrección es un CONFLICTO, no una aprobación a ciegas', async () => {
    const r = await subirYProcesar(A, await pdfBoreal(), llmBoreal(), 'o.pdf', { clienteId: 'cli-boreal' });
    const v = estado.docs.get(r.documentoId)!.version;
    await corregirCampos(A, r.documentoId, v, [{ campo: 'origen_cp', renglon: null, valor: '66601' }], ACTOR.id);
    await expect(aprobarDocumento(A, r.documentoId, v, ACTOR)).rejects.toBeInstanceOf(ConflictoDeVersion);
  });

  it('el viaje YA existía con ese folio (lo capturó la oficina antes): solo se llenan sus huecos y lo capturado no se pisa', async () => {
    const r = await subirYProcesar(A, await pdfBoreal(), llmBoreal(), 'o.pdf', { clienteId: 'cli-boreal' });
    estado.viajes.push({ tenantId: A, id: 'v-previo', folio: 'BOR-77120', origen: 'Origen capturado a mano', operadorId: null, estatus: 'abierto' } as never);
    await aprobarDocumento(A, r.documentoId, estado.docs.get(r.documentoId)!.version, ACTOR);
    expect(estado.viajes.filter((v) => v.folio === 'BOR-77120')).toHaveLength(1);
    expect(estado.viajes.find((v) => v.folio === 'BOR-77120')!.origen).toBe('Origen capturado a mano');
  });

  it('rechazar y reabrir: un aprobado se reabre a revisión sin tocar el viaje ya creado; solo se exporta lo aprobado', async () => {
    const r = await subirYProcesar(A, await pdfBoreal(), llmBoreal(), 'o.pdf', { clienteId: 'cli-boreal' });
    const ap = await aprobarDocumento(A, r.documentoId, estado.docs.get(r.documentoId)!.version, ACTOR);
    const viajes = estado.viajes.length;
    const re = await reabrirDocumento(A, r.documentoId, ap.documento.version, ACTOR.id);
    expect(re.estado).toBe('por_revisar');
    expect(estado.viajes).toHaveLength(viajes);
    const todos = (await repo.listarDocumentos(A, {})).filas;
    expect(exportarDocumentos(todos.map((doc) => ({ doc, viajeFolio: null })), 'csv', configEstandar(), 'x')).toMatchObject({ documentos: 0, omitidos: [{ id: r.documentoId }] });
    await rechazarDocumento(A, r.documentoId, re.version, 'Documento duplicado del cliente', ACTOR.id);
    expect(estado.docs.get(r.documentoId)!.estado).toBe('rechazado');
  });

  it('un lease vencido (worker muerto a mitad del modelo) se recupera: el siguiente CRON termina el trabajo', async () => {
    const r = await subir(A, await pdfBoreal());
    const reclamo = await repo.reclamarDocumento(A, r.documentoId, 1);
    expect(reclamo).not.toBeNull();
    estado.reloj.ahora = () => new Date(Date.now() + 10 * 60_000);
    const res = await cron();
    expect(res).toMatchObject({ corrio: true, procesados: 1 });
    expect(estado.docs.get(r.documentoId)!.estado).toBe('por_revisar');
    estado.reloj.ahora = () => new Date();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL WORKER (cron carta-porte-docs, 0640-0642): lo que el cliente pidió — «que se procese solo y que me avisen de las dudas».
// ═══════════════════════════════════════════════════════════════════════════
const URL_BANDEJA = 'https://app.likida.ai/dashboard/carta-porte/documentos';
const minutos = (n: number) => { estado.reloj.ahora = () => new Date(Date.now() + n * 60_000); };

async function cron(llm: () => LlmFalso = llmBoreal) {
  const { GET } = await import('../../../app/api/cron/carta-porte-docs/route');
  depsHolder.modelo = llm;
  const r = await GET(new Request('https://app.likida.ai/api/cron/carta-porte-docs'));
  return (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

describe('el worker de la bandeja (cron)', () => {
  beforeEach(() => { avisosOficina.length = 0; latidos.length = 0; depsHolder.envio = null; vi.useRealTimers(); });

  it('un documento «recibido» que ninguna petición alcanzó a leer se extrae SOLO; una gracia evita pelear con la petición que lo recibió', async () => {
    const r = await subir(A, await pdfBoreal(), 'orden.pdf', { clienteId: 'cli-boreal', canal: 'correo', remitente: 'logistica@boreal.example' });
    expect(estado.docs.get(r.documentoId)!.estado).toBe('recibido');
    expect(await cron()).toMatchObject({ corrio: true, pendientes: 0, procesados: 0 });          // dentro de la gracia: no se toca
    minutos(10);
    expect(await cron()).toMatchObject({ pendientes: 1, procesados: 1 });
    expect(estado.docs.get(r.documentoId)!.estado).toBe('por_revisar');
    expect(tipos(r.documentoId)).toContain('extraccion_ok');
    expect(latidos.at(-1)).toEqual(['carta-porte-docs', 'ok', expect.objectContaining({ procesados: 1 })]);
  });

  it('un fallo reintentable (modelo) se reintenta con ESPERA creciente y a los 5 intentos es TERMINAL: la oficina se entera UNA vez', async () => {
    const r = await subir(A, await pdfBoreal(), 'roto.pdf', { clienteId: 'cli-boreal', canal: 'correo' });
    const id = r.documentoId;
    const caido = () => llmFalso(() => { throw new Error('proveedor caído'); });
    const espera = [10, 20, 40, 70, 130];       // minutos que pasan antes de cada pasada (2 de gracia, luego 15, 30, 60, 120)
    let reloj = 0;
    for (let i = 0; i < 5; i++) {
      reloj += espera[i]; minutos(reloj);
      const res = await cron(caido);
      expect(res, `pasada ${i + 1}`).toMatchObject({ procesados: 0, fallidos: 1 });
      expect(estado.docs.get(id)!.intentos).toBe(i + 1);
    }
    expect(estado.docs.get(id)).toMatchObject({ estado: 'fallido', intentos: 5 });
    // Terminal: nadie lo reclama más, aunque pase una semana.
    minutos(reloj + 7 * 24 * 60);
    const despues = await cron(caido);
    expect(despues).toMatchObject({ pendientes: 0 });
    expect(estado.docs.get(id)!.intentos).toBe(5);
    // La oficina se entera UNA vez (el aviso `agotado` se reclama con candado).
    expect(avisosOficina.filter((a) => a.texto.includes('No pude leer'))).toHaveLength(1);
  });

  it('entre un intento y el siguiente respeta la espera: una pasada a los 5 min de un fallo NO reintenta', async () => {
    const r = await subir(A, await pdfBoreal(), 'espera.pdf', { clienteId: 'cli-boreal', canal: 'correo' });
    minutos(10);
    await cron(() => llmFalso(() => { throw new Error('proveedor caído'); }));
    expect(estado.docs.get(r.documentoId)!.intentos).toBe(1);
    minutos(10 + 5);
    expect(await cron()).toMatchObject({ pendientes: 0, procesados: 0 });
    expect(estado.docs.get(r.documentoId)!.estado).toBe('fallido');
    minutos(10 + 20);
    expect(await cron()).toMatchObject({ procesados: 1 });
    expect(estado.docs.get(r.documentoId)!.estado).toBe('por_revisar');
  });

  it('el presupuesto de IA agotado no gasta intentos: el documento sigue vivo para cuando se amplíe el techo', async () => {
    const r = await subir(A, await pdfBoreal(), 'p.pdf', { clienteId: 'cli-boreal', canal: 'correo' });
    minutos(10);
    const sinPresupuesto = () => llmFalso(() => { throw Object.assign(new Error('presupuesto de IA del día agotado'), { name: 'LlmBudgetExceededError' }); });
    expect(await cron(sinPresupuesto)).toMatchObject({ paradaPorPresupuesto: true, fallidos: 1 });
    expect(estado.docs.get(r.documentoId)!.intentos).toBe(0);
    minutos(40);
    expect(await cron()).toMatchObject({ procesados: 1 });
  });

  it('un documento de correo que trae bloqueos o dudas avisa a la oficina UNA vez, con liga, y sin repetir en la pasada siguiente', async () => {
    const r = await subir(A, await pdfBoreal(), 'dudoso.pdf', { clienteId: 'cli-boreal', canal: 'correo' });
    minutos(10);
    // Lectura con confianza baja en los campos críticos: queda por revisar con dudas.
    const dudoso = () => llmFalso((e) => lecturaBoreal(e.nivel, 0.4));
    // La MISMA pasada que extrae el documento avisa a la oficina de sus dudas.
    const c1 = await cron(dudoso);
    expect(c1).toMatchObject({ procesados: 1, hallazgos: 1, avisosEnviados: 1 });
    expect(estado.docs.get(r.documentoId)!.estado).toBe('por_revisar');
    expect(avisosOficina).toHaveLength(1);
    expect(avisosOficina[0].telefono).toBe('5215500000001');
    expect(avisosOficina[0].texto).toContain(`${URL_BANDEJA}/${r.documentoId}`);
    expect(tipos(r.documentoId)).toContain('aviso_oficina');
    await cron();
    await cron();
    expect(avisosOficina).toHaveLength(1);
  });

  it('un documento limpio o de otro canal NO molesta a la oficina', async () => {
    await subir(A, await pdfBoreal(), 'limpio.pdf', { clienteId: 'cli-boreal', canal: 'correo' });
    minutos(10);
    expect(await cron()).toMatchObject({ procesados: 1, hallazgos: 0, avisosEnviados: 0 });
    const m = await subir(A, await excelAtlas(), 'panel.xlsx', { canal: 'manual' });
    minutos(20);
    await cron(() => llmFalso((e) => lecturaBoreal(e.nivel, 0.4)));
    expect(estado.docs.get(m.documentoId)!.estado).not.toBe('recibido');
    await cron();
    expect(avisosOficina).toHaveLength(0);
  });

  it('REGLA DEL OUTBOX: si el aviso rebota por algo reintentable ya está en wa_outbox: la pasada siguiente NO lo reenvía', async () => {
    const r = await subir(A, await pdfBoreal(), 'dudoso.pdf', { clienteId: 'cli-boreal', canal: 'correo' });
    minutos(10);
    depsHolder.envio = () => ({ ok: false, motivo: 'límite de tasa', fueraDeVentana: false, reintentable: true });
    const c1 = await cron(() => llmFalso((e) => lecturaBoreal(e.nivel, 0.4)));
    expect(c1).toMatchObject({ procesados: 1, avisosEnCola: 1, avisosFallidos: 0 });
    expect(avisosOficina).toHaveLength(1);
    depsHolder.envio = null;
    const c2 = await cron();
    expect(c2).toMatchObject({ avisosEnviados: 0, avisosEnCola: 0 });
    expect(avisosOficina).toHaveLength(1);
    expect(estado.avisos.get(r.documentoId)).toHaveProperty('hallazgos');
  });

  it('el worker no cruza flotas: el aviso sale al teléfono de la flota DUEÑA del documento y la flota sin teléfono no recibe nada', async () => {
    await subir(B, await pdfBoreal(), 'otra.pdf', { canal: 'correo' });
    minutos(10);
    const c1 = await cron(() => llmFalso((e) => lecturaBoreal(e.nivel, 0.4)));
    expect(c1).toMatchObject({ procesados: 1, sinTelefono: 1, avisosEnviados: 0 });
    expect(avisosOficina).toHaveLength(0);
  });

  it('una base SIN las migraciones nuevas: el cron procesa igual y los avisos quedan apagados (sin repetirse)', async () => {
    estado.sinMigracion = true;
    const r = await subir(A, await pdfBoreal(), 'dudoso.pdf', { clienteId: 'cli-boreal', canal: 'correo' });
    minutos(10);
    await cron(() => llmFalso((e) => lecturaBoreal(e.nivel, 0.4)));
    expect(estado.docs.get(r.documentoId)!.estado).toBe('por_revisar');
    expect(await cron()).toMatchObject({ avisosSinMigracion: true, avisosEnviados: 0 });
    expect(avisosOficina).toHaveLength(0);
    expect(latidos.at(-1)![1]).toBe('parcial');
  });
});

describe('otro tenant', () => {
  it('el mismo archivo en OTRA flota es OTRO documento; el correo entra a la flota de SU token', async () => {
    const bytes = await pdfBoreal();
    await subir(A, bytes); await subir(B, bytes);
    expect(docs(A)).toHaveLength(1); expect(docs(B)).toHaveLength(1);
    await atenderCorreoCartaPorte(TOKEN_B, { emailId: 'em-5', from: 'x@c.example', subject: 's', attachments: [{ id: 'a1', filename: 'otro.pdf' }] }, depsCorreo({ a1: excelAtlas() }));
    expect(docs(B).some((d) => d.canal === 'correo')).toBe(true);
    expect(docs(A).every((d) => d.canal !== 'correo')).toBe(true);
  });

  it('la flota B no puede abrir, corregir, aprobar ni rechazar el documento de la A; el viaje se crea solo en la flota dueña', async () => {
    const r = await subirYProcesar(A, await pdfBoreal(), llmBoreal(), 'o.pdf', { clienteId: 'cli-boreal' });
    const v = estado.docs.get(r.documentoId)!.version;
    await expect(aprobarDocumento(B, r.documentoId, v, { id: USUARIO_B })).rejects.toThrow();
    await expect(rechazarDocumento(B, r.documentoId, v, 'intruso', USUARIO_B)).rejects.toThrow();
    expect(estado.docs.get(r.documentoId)!.estado).toBe('por_revisar');
    expect(estado.viajes.filter((x) => x.tenantId === B)).toHaveLength(0);
  });

  it('el export de una flota nunca incluye documentos de otra', async () => {
    const a = await subirYProcesar(A, await pdfBoreal(), llmBoreal(), 'a.pdf', { clienteId: 'cli-boreal' });
    await aprobarDocumento(A, a.documentoId, estado.docs.get(a.documentoId)!.version, ACTOR);
    const deB = (await repo.listarDocumentos(B, { estados: ['aprobado'] })).filas;
    expect(deB).toHaveLength(0);
  });

  it('procesar con la flota equivocada no toca el documento', async () => {
    const r = await subir(A, await pdfBoreal());
    expect(await procesarDocumento(B, r.documentoId, { ...sinAgenteApagado, llm: () => llmBoreal() })).toMatchObject({ ok: false, motivo: 'no_reclamable' });
    expect(estado.docs.get(r.documentoId)!.estado).toBe('recibido');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-EMBARQUE (P13, 0670-0671): un Excel con N embarques se parte en N documentos con huella base común, en lugar de
// leer el primero y avisar «sube el resto por separado» (los demás embarques se perdían en silencio).
// ═══════════════════════════════════════════════════════════════════════════
describe('multi-embarque: un Excel con tres embarques', () => {
  beforeEach(() => { avisosOficina.length = 0; latidos.length = 0; depsHolder.envio = null; vi.useRealTimers(); });

  // Tres embarques de «Atlas» con operadores y unidades distintos (la base admite UN viaje abierto por operador).
  const planDelDia = () => excelAtlas([
    filaAtlas({ ...EMBARQUE_ATLAS, folio: 'ATL-1', operador: 'Juan Pérez López', placas: 'ABC1234' }),
    filaAtlas({ ...EMBARQUE_ATLAS, folio: 'ATL-1', producto: 'Tapas metálicas', cantidad: '300', pesoKg: '600', operador: 'Juan Pérez López', placas: 'ABC1234' }),
    filaAtlas({ ...EMBARQUE_ATLAS, folio: 'ATL-2', producto: 'Cajas de cartón', operador: 'María Hernández Soto', placas: 'XYZ9876' }),
    filaAtlas({ ...EMBARQUE_ATLAS, folio: 'ATL-3', producto: 'Etiquetas', operador: 'Juan Pérez López', placas: 'ABC1234' }),
  ]);
  /** El modelo lee el folio que ve en el texto que le llega: cada hijo trae UN solo embarque. */
  const PRODUCTO: Record<string, string> = { 'ATL-2': 'Cajas de cartón', 'ATL-3': 'Etiquetas' };
  const modeloPorFolio = (): LlmFalso => llmFalso((e) => {
    const folios = new Set(String(e.texto).match(/ATL-\d+/g));
    if (folios.size !== 1) throw new Error(`el modelo recibió ${folios.size} folios: un documento es UN embarque`);
    const base = lecturaAtlas(e.nivel, [...folios][0]);
    // «1,200» / «8,400» son ambiguos (miles o decimal) y la aprobación exige confirmarlos: aquí el modelo los lee ya sin ambigüedad.
    const sinAmbiguedad = (v: string): string => v.replace(',', '');
    const lectura = { ...base, mercancias: base.mercancias.map((m) => ({ ...m, campos: m.campos.map((c) => (c.clave === 'cantidad' || c.clave === 'peso_kg' ? { ...c, valor: sinAmbiguedad(String(c.valor)) } : c.clave === 'descripcion' && PRODUCTO[[...folios][0]] ? { ...c, valor: PRODUCTO[[...folios][0]], evidencia: PRODUCTO[[...folios][0]] } : c)) })) };
    if ([...folios][0] !== 'ATL-2') return lectura;
    return { ...lectura, campos: lectura.campos.map((c) => (c.clave === 'operador_nombre' ? { ...c, valor: 'María Hernández Soto', evidencia: 'María Hernández Soto' } : c.clave === 'unidad_placas' ? { ...c, valor: 'XYZ9876', evidencia: 'XYZ9876' } : c)) };
  });
  const nadaDeModelo = (): LlmFalso => llmFalso(() => { throw new Error('partir el archivo no debe llamar al modelo'); });
  const hijos = (padre: string) => estado.embarques.filter((h) => h.padreId === padre).sort((a, b) => a.indice - b.indice);

  it('por CORREO: el adjunto se parte al recibirlo, el cron lee los 3 embarques, se aprueban y salen 3 viajes', async () => {
    const r = await atenderCorreoCartaPorte(TOKEN_A, { emailId: 'em-multi', from: 'Logística <plan@cliente.example>', subject: 'Plan del día', attachments: [{ id: 'a1', filename: 'plan-del-dia.xlsx' }] },
      depsCorreo({ a1: planDelDia() }, { llm: nadaDeModelo }));
    expect(r).toMatchObject({ status: 200, cuerpo: { ok: true, recibidos: 1, procesados: 1 } });

    // El original queda como constancia (`dividido`) y NO se lee; cada embarque es su propio documento `recibido`.
    const padre = docs(A).find((d) => d.nombreArchivo === 'plan-del-dia.xlsx')!;
    expect(padre.estado).toBe('dividido');
    expect(docs(A)).toHaveLength(4);
    expect(hijos(padre.id).map((h) => [h.indice, h.total, h.clave, h.huellaBase === padre.sha256])).toEqual([[1, 3, 'ATL-1', true], [2, 3, 'ATL-2', true], [3, 3, 'ATL-3', true]]);
    expect(hijos(padre.id).every((h) => estado.docs.get(h.documentoId)!.estado === 'recibido' && estado.docs.get(h.documentoId)!.canal === 'correo')).toBe(true);
    expect(docs(B)).toHaveLength(0);

    // El cron (pasada la gracia) lee los TRES, cada uno con su modelo y sus filas; ninguno ve el embarque de otro.
    minutos(10);
    expect(await cron(modeloPorFolio)).toMatchObject({ pendientes: 3, procesados: 3, fallidos: 0, divididos: 0 });
    const lista = hijos(padre.id).map((h) => estado.docs.get(h.documentoId)!);
    expect(lista.map((d) => d.estado)).toEqual(['por_revisar', 'por_revisar', 'por_revisar']);
    expect(lista.map((d) => d.extraccion?.campos.folio_cliente.valor)).toEqual(['ATL-1', 'ATL-2', 'ATL-3']);

    // Revisión y aprobación POR EMBARQUE: los dos primeros (operadores distintos) crean su viaje; el tercero sigue por revisar.
    for (const d of lista.slice(0, 2)) {
      await abrirRevision(A, d.id, ACTOR.id, new Date('2026-10-02T10:00:00Z'));
      const ap = await aprobarDocumento(A, d.id, estado.docs.get(d.id)!.version, ACTOR, { ahora: new Date('2026-10-02T10:02:00Z') });
      expect(ap.documento.estado).toBe('aprobado');
    }
    expect(estado.viajes.map((v) => v.folio).sort()).toEqual(['ATL-1', 'ATL-2']);
    expect(estado.docs.get(lista[2].id)!.estado).toBe('por_revisar');

    // El original NO cuenta como documento por revisar ni se exporta: lo que se mide y sale son los embarques.
    const { filas } = await repo.listarDocumentos(A, { completo: true });
    expect(calcularMetricas(filas, new Map())).toMatchObject({ recibidos: 3, aprobados: 2, porRevisar: 1 });
    const csv = exportarDocumentos(filas.map((doc) => ({ doc, viajeFolio: doc.viajeId ? 'viaje' : null })), 'csv', configEstandar(), 'Formato Ficticio', new Date('2026-10-02T12:00:00Z'));
    expect(csv).toMatchObject({ documentos: 2 });
    expect(csv.omitidos.some((o) => o.id === padre.id)).toBe(true);
  });

  it('por el PANEL / WhatsApp: el mensaje dice cuántos embarques traía y cada uno queda en la bandeja', async () => {
    const respuestas: string[] = [];
    expect(await ingerirDesdeWhatsapp(wa(A, 'media-multi'), depsWa(planDelDia(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', respuestas))).toBe('atendido');
    expect(respuestas).toHaveLength(1);
    expect(respuestas[0]).toMatch(/trae 3 embarques.*separé en 3 documentos/);
    expect(docs(A).filter((d) => d.estado === 'recibido')).toHaveLength(3);
    expect(docs(A).filter((d) => d.estado === 'dividido')).toHaveLength(1);
  });

  it('mandar el MISMO Excel dos veces (correo y luego WhatsApp) es un duplicado: no se parte otra vez ni se duplican los embarques', async () => {
    const bytes = planDelDia();
    await atenderCorreoCartaPorte(TOKEN_A, { emailId: 'em-m1', from: 'plan@cliente.example', subject: 'Plan', attachments: [{ id: 'a1', filename: 'plan.xlsx' }] }, depsCorreo({ a1: bytes }, { llm: nadaDeModelo }));
    const respuestas: string[] = [];
    await ingerirDesdeWhatsapp(wa(A, 'media-dup'), depsWa(bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', respuestas));
    expect(respuestas[0]).toMatch(/ya estaba en la bandeja/);
    expect(docs(A)).toHaveLength(4);
    expect(estado.embarques).toHaveLength(3);
  });

  it('un cron sin el modelo disponible NO pierde embarques: partir no lo necesita, y cada hijo se reintenta con su espera', async () => {
    const r = await subir(A, planDelDia(), 'plan.xlsx', { canal: 'correo' });
    minutos(10);
    const caido = () => llmFalso(() => { throw new Error('proveedor caído'); });
    // 1.ª pasada: parte el original (sin modelo) — los hijos nacen `recibido`, dentro de la gracia de la pasada siguiente.
    expect(await cron(caido)).toMatchObject({ pendientes: 1, procesados: 1, divididos: 1, fallidos: 0 });
    expect(estado.docs.get(r.documentoId)!.estado).toBe('dividido');
    expect(hijos(r.documentoId)).toHaveLength(3);
    // 2.ª: el proveedor sigue caído: los tres hijos fallan reintentables (no se pierden ni se marcan terminales).
    minutos(20);
    expect(await cron(caido)).toMatchObject({ pendientes: 3, procesados: 0, fallidos: 3 });
    expect(hijos(r.documentoId).every((h) => estado.docs.get(h.documentoId)!.estado === 'fallido' && estado.docs.get(h.documentoId)!.intentos === 1)).toBe(true);
    // El proveedor vuelve: con su espera cumplida se leen los tres.
    minutos(60);
    expect(await cron(modeloPorFolio)).toMatchObject({ procesados: 3, fallidos: 0 });
  });

  it('una base SIN la 0670/0671 sigue funcionando como hasta hoy: lee el primer embarque y AVISA que hay más', async () => {
    estado.sinDivision = true;
    const r = await subirYProcesar(A, planDelDia(), llmFalso((e) => lecturaAtlas(e.nivel, 'ATL-1')), 'plan.xlsx');
    expect(r.proceso).toMatchObject({ ok: true, estado: 'por_revisar' });
    expect(estado.embarques).toHaveLength(0);
    expect(estado.docs.get(r.documentoId)!.extraccion?.meta?.avisos.join(' ')).toMatch(/3 embarques pero esta base aún no sabe partirlos/);
  });

  it('aislamiento: la flota B manda la misma planilla y obtiene sus propios hijos; los de A no se tocan', async () => {
    await subirYProcesar(A, planDelDia(), nadaDeModelo(), 'plan.xlsx');
    await subirYProcesar(B, planDelDia(), nadaDeModelo(), 'plan.xlsx');
    expect(estado.embarques.filter((h) => h.tenantId === A)).toHaveLength(3);
    expect(estado.embarques.filter((h) => h.tenantId === B)).toHaveLength(3);
    expect(new Set(estado.embarques.map((h) => h.documentoId)).size).toBe(6);
    expect(estado.embarques.every((h) => estado.docs.get(h.documentoId)!.tenantId === h.tenantId && estado.docs.get(h.padreId)!.tenantId === h.tenantId)).toBe(true);
  });
});

describe('salida en el formato del cliente', () => {
  it.todo('PENDIENTE (depende del cliente): la salida directa al Excel/sistema de carga del cliente de demo con SU layout configurable, medida contra documentos reales (exactitud sin medir hasta el 12-oct)');
});
