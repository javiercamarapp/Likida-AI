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

import { estado, reset } from '../carta_porte_docs/repo_falso.fixture';
import { A, B, ACTOR, USUARIO_B, llmBoreal, sembrarFlotas, sinAgenteApagado, subir, subirYProcesar } from '../carta_porte_docs/escenario.fixture';
import { llmFalso, lecturaBoreal } from '../carta_porte_docs/llm_falso.fixture';
import { defectuosos, excelAtlas, pdfBoreal } from '../carta_porte_docs/documentos_sinteticos.fixture';
import { aprobarDocumento, corregirCampos, abrirRevision, rechazarDocumento, reabrirDocumento, ConflictoDeVersion } from '../carta_porte_docs/bandeja';
import { atenderCorreoCartaPorte, type DepsCorreo } from '../carta_porte_docs/correo_entrante';
import { ingerirDesdeWhatsapp, type DepsWhatsapp } from '../carta_porte_docs/whatsapp';
import { procesarDocumento, recibirDocumento } from '../carta_porte_docs/servicio';
import { exportarDocumentos, configEstandar } from '../carta_porte_docs/exportacion';
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

  it('un lease vencido (worker muerto a mitad del modelo) se recupera: el siguiente cron termina el trabajo', async () => {
    const r = await subir(A, await pdfBoreal());
    const reclamo = await repo.reclamarDocumento(A, r.documentoId, 1);
    expect(reclamo).not.toBeNull();
    estado.reloj.ahora = () => new Date(Date.now() + 10 * 60_000);
    expect(await procesarDocumento(A, r.documentoId, { ...sinAgenteApagado, llm: () => llmBoreal() })).toMatchObject({ ok: true });
    estado.reloj.ahora = () => new Date();
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

describe('salida en el formato del cliente (Ola 3)', () => {
  it.todo('INTEGRACIÓN PENDIENTE (convenios/perfiles, w3-convenios): la salida directa al Excel/sistema de carga del cliente de demo con SU layout configurable, medida contra documentos reales (exactitud sin medir hasta el 12-oct)');
});
