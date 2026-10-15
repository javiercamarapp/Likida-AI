import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./repo', async () => (await import('./repo_falso.fixture')).api);
vi.mock('../bitacora_escritura', () => ({ anotarBitacora: vi.fn(async () => true) }));
import { estado, reset } from './repo_falso.fixture';
import { A, USUARIO_A, sembrarFlotas } from './escenario.fixture';
import { esCandidatoCartaPorte, esTextoCartaPorte, senalesDeForma, ingerirDesdeWhatsapp, MAX_BYTES_WA, type DepsWhatsapp } from './whatsapp';
import { MAX_TEXTO_MODELO } from './contenido';
import { llmFalso, lecturaBoreal } from './llm_falso.fixture';
import * as repo from './repo';
import { fotoRemision, pdfBoreal, excelAtlas, xmlCartaPorte, defectuosos, RFC } from './documentos_sinteticos.fixture';

const aDataUrl = (b: Uint8Array, mime: string) => `data:${mime};base64,${Buffer.from(b).toString('base64')}`;

function deps(medios: Record<string, { mime: string; bytes: Uint8Array | null; size?: number | null }>, over: Partial<DepsWhatsapp> = {}) {
  const respuestas: string[] = [];
  const llm = llmFalso((e) => lecturaBoreal(e.nivel));
  const d: DepsWhatsapp & { respuestas: string[] } = {
    apagado: async () => false, llm: () => llm, respuestas, restanteMs: () => 40_000, senal: () => new AbortController().signal,
    metadatos: async (id) => (medios[id] ? { mimeType: medios[id].mime, fileSize: medios[id].size === undefined ? medios[id].bytes?.length ?? null : medios[id].size } : null),
    descargar: async (id) => (medios[id]?.bytes ? aDataUrl(medios[id].bytes!, medios[id].mime) : null),
    responder: async (t) => { respuestas.push(t); },
    ...over,
  };
  return d;
}
const entrada = (mensaje: { type: string; mediaId?: string; text?: string }, over = {}) => ({ tenantId: A, userId: USUARIO_A, mensaje, nombreRemitente: 'Ana', urlBandeja: 'https://app.test/dashboard/carta-porte/documentos', ...over });

beforeEach(async () => { reset(); sembrarFlotas(); await repo.crearBuzon(A, 'abcdefghjkmnpqrstvwxyz23'); });

describe('esCandidatoCartaPorte', () => {
  it('un documento siempre; una foto solo si el pie lo dice; el resto no', () => {
    expect(esCandidatoCartaPorte({ type: 'document', mediaId: 'm' })).toBe(true);
    expect(esCandidatoCartaPorte({ type: 'image', mediaId: 'm' })).toBe(false);
    expect(esCandidatoCartaPorte({ type: 'image', mediaId: 'm', text: 'ticket de gasolina' })).toBe(false);
    expect(esCandidatoCartaPorte({ type: 'image', mediaId: 'm', text: 'Carta Porte del embarque 5521' })).toBe(true);
    expect(esCandidatoCartaPorte({ type: 'image', mediaId: 'm', text: 'embarque' })).toBe(true);
    expect(esCandidatoCartaPorte({ type: 'text', mediaId: 'm' })).toBe(false);
    expect(esCandidatoCartaPorte({ type: 'document' })).toBe(false);
  });
});

describe('ingerirDesdeWhatsapp', () => {
  it('una flota que NO activó el agente (sin buzón) o lo apagó: sigue su camino, sin modelo ni archivos', async () => {
    const d = deps({ m1: { mime: 'application/pdf', bytes: await pdfBoreal() } });
    estado.buzones.clear();
    expect(await ingerirDesdeWhatsapp(entrada({ type: 'document', mediaId: 'm1' }), d)).toBe('no_aplica');
    await repo.crearBuzon(A, 'abcdefghjkmnpqrstvwxyz23');
    await repo.configurarBuzon(A, { activo: false });
    expect(await ingerirDesdeWhatsapp(entrada({ type: 'document', mediaId: 'm1' }), d)).toBe('no_aplica');
    expect(estado.docs.size).toBe(0);
    expect(estado.archivos.size).toBe(0);
    expect(d.respuestas).toEqual([]);
  });

  it('un PDF de la oficina: se guarda en SU flota, se lee y se le contesta con la liga a la bandeja', async () => {
    const d = deps({ m1: { mime: 'application/pdf', bytes: await pdfBoreal() } });
    const r = await ingerirDesdeWhatsapp(entrada({ type: 'document', mediaId: 'm1' }), d);
    expect(r).toBe('atendido');
    const doc = [...estado.docs.values()][0];
    expect(doc).toMatchObject({ tenantId: A, canal: 'whatsapp', formato: 'pdf_texto', estado: 'por_revisar' });
    expect(doc.remitente).toBe('WhatsApp · Ana');
    expect(d.respuestas).toHaveLength(1);
    expect(d.respuestas[0]).toContain(`/dashboard/carta-porte/documentos/${doc.id}`);
    expect(d.respuestas[0]).toMatch(/ya lo leí/);
  });

  it('una foto con pie «carta porte» entra; sin pie no es de este agente', async () => {
    const d = deps({ m1: { mime: 'image/png', bytes: await fotoRemision() } });
    expect(await ingerirDesdeWhatsapp(entrada({ type: 'image', mediaId: 'm1', text: 'ticket' }), d)).toBe('no_aplica');
    expect(estado.docs.size).toBe(0);
    expect(d.respuestas).toEqual([]);
    expect(await ingerirDesdeWhatsapp(entrada({ type: 'image', mediaId: 'm1', text: 'Carta porte 5521' }), d)).toBe('atendido');
    expect([...estado.docs.values()][0].formato).toBe('imagen');
  });

  it('un XML que NO es Carta Porte (factura de proveedor) sigue su camino', async () => {
    const d = deps({ m1: { mime: 'text/xml', bytes: Buffer.from('<?xml version="1.0"?><cfdi:Comprobante xmlns:cfdi="x" Total="10"/>') } });
    expect(await ingerirDesdeWhatsapp(entrada({ type: 'document', mediaId: 'm1' }), d)).toBe('no_aplica');
    expect(estado.docs.size).toBe(0);
  });

  it('un XML con Carta Porte sí entra, sin modelo', async () => {
    const d = deps({ m1: { mime: 'text/xml', bytes: Buffer.from(xmlCartaPorte()) } });
    expect(await ingerirDesdeWhatsapp(entrada({ type: 'document', mediaId: 'm1' }), d)).toBe('atendido');
    expect([...estado.docs.values()][0]).toMatchObject({ formato: 'xml', estado: 'por_revisar', nivelModelo: 0 });
  });

  it('un Excel entra', async () => {
    const d = deps({ m1: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: excelAtlas() } });
    await ingerirDesdeWhatsapp(entrada({ type: 'document', mediaId: 'm1' }), d);
    expect([...estado.docs.values()][0].formato).toBe('excel');
  });

  it('el mismo documento reenviado: no se duplica y se le dice dónde está', async () => {
    const d = deps({ m1: { mime: 'application/pdf', bytes: await pdfBoreal() }, m2: { mime: 'application/pdf', bytes: await pdfBoreal() } });
    await ingerirDesdeWhatsapp(entrada({ type: 'document', mediaId: 'm1' }), d);
    await ingerirDesdeWhatsapp(entrada({ type: 'document', mediaId: 'm2' }), d);
    expect(estado.docs.size).toBe(1);
    expect(d.respuestas[1]).toMatch(/ya estaba en la bandeja/);
  });

  it('HEIC, archivo pesado, descarga caída y formato ilegible: respuesta clara y nada guardado', async () => {
    const casos: Array<[Record<string, { mime: string; bytes: Uint8Array | null; size?: number | null }>, RegExp]> = [
      [{ m: { mime: 'image/heic', bytes: Buffer.from('x') } }, /HEIC/],
      [{ m: { mime: 'application/pdf', bytes: Buffer.from('x'), size: MAX_BYTES_WA + 1 } }, /pesa demasiado/],
      [{ m: { mime: 'application/pdf', bytes: null } }, /No pude descargar/],
      [{ m: { mime: 'application/octet-stream', bytes: defectuosos.ejecutable } }, /No pude leer ese archivo/],
    ];
    for (const [medios, re] of casos) {
      const d = deps(medios);
      expect(await ingerirDesdeWhatsapp(entrada({ type: 'document', mediaId: 'm' }), d)).toBe('atendido');
      expect(d.respuestas[0]).toMatch(re);
    }
    expect(estado.docs.size).toBe(0);
  });

  it('metadatos que fallan: se le pide reenviar', async () => {
    const d = deps({});
    expect(await ingerirDesdeWhatsapp(entrada({ type: 'document', mediaId: 'zz' }), d)).toBe('atendido');
    expect(d.respuestas[0]).toMatch(/No pude abrir/);
  });

  it('agente apagado: se le dice y no se guarda nada', async () => {
    const d = deps({ m1: { mime: 'application/pdf', bytes: await pdfBoreal() } }, { apagado: async () => true });
    expect(await ingerirDesdeWhatsapp(entrada({ type: 'document', mediaId: 'm1' }), d)).toBe('atendido');
    expect(d.respuestas[0]).toMatch(/apagado/);
    expect(estado.docs.size).toBe(0);
  });

  it('con poco reloj: se recibe y se avisa que se está leyendo (queda en la bandeja)', async () => {
    const d = deps({ m1: { mime: 'application/pdf', bytes: await pdfBoreal() } }, { restanteMs: () => 3_000 });
    await ingerirDesdeWhatsapp(entrada({ type: 'document', mediaId: 'm1' }), d);
    expect([...estado.docs.values()][0].estado).toBe('recibido');
    expect(d.respuestas[0]).toMatch(/Lo estoy leyendo/);
  });

  it('si la base falla a media operación, la persona recibe una disculpa y nunca una excepción', async () => {
    estado.fallar.set('insertarDocumento', new Error('base caída'));
    const d = deps({ m1: { mime: 'application/pdf', bytes: await pdfBoreal() } });
    expect(await ingerirDesdeWhatsapp(entrada({ type: 'document', mediaId: 'm1' }), d)).toBe('atendido');
    expect(d.respuestas[0]).toMatch(/Tuve un problema/);
  });

  it('el nombre del remitente no lleva el teléfono ni se queda sin acotar', async () => {
    const d = deps({ m1: { mime: 'application/pdf', bytes: await pdfBoreal() } });
    await ingerirDesdeWhatsapp(entrada({ type: 'document', mediaId: 'm1' }, { nombreRemitente: 'N'.repeat(300) }), d);
    expect([...estado.docs.values()][0].remitente!.length).toBeLessThanOrEqual(120);
  });
});

// ── Texto pegado (T-A3-15): sintético, sin datos reales ──────────────────────
const CUERPO = `Origen CP: 64000 Monterrey. Destino CP: 44100 Guadalajara. Cliente Boreal ${RFC.boreal}. Fecha de carga 15/10/2026. 880 pzas, 14028 kg, clave 24101500.`;
const SIN_ORDEN_4_SENALES = `Buenas tardes, les paso lo del embarque de mañana: RFC ${RFC.boreal}, C.P. 64000, 880 piezas, fecha de carga 2026-10-15.`;

describe('texto pegado — esTextoCartaPorte', () => {
  it('con orden explícita al inicio (ccp / carta porte / embarque) y cuerpo suficiente', () => {
    expect(esTextoCartaPorte({ type: 'text', text: `ccp ${CUERPO}` })).toBe(true);
    expect(esTextoCartaPorte({ type: 'text', text: `  Carta Porte: ${CUERPO}` })).toBe(true);
    expect(esTextoCartaPorte({ type: 'text', text: `EMBARQUE - ${CUERPO}` })).toBe(true);
  });
  it('la orden sola, o con cuerpo mínimo, o fuera del inicio, no basta', () => {
    expect(esTextoCartaPorte({ type: 'text', text: 'ccp' })).toBe(false);
    expect(esTextoCartaPorte({ type: 'text', text: 'embarque 5521' })).toBe(false);
    expect(esTextoCartaPorte({ type: 'text', text: 'oye el embarque ya salió, avísale al cliente por favor, gracias' })).toBe(false);
  });
  it('sin orden: ≥ 3 señales y ≥ 80 caracteres; menos no entra', () => {
    expect(senalesDeForma(SIN_ORDEN_4_SENALES)).toBe(4);
    expect(esTextoCartaPorte({ type: 'text', text: SIN_ORDEN_4_SENALES })).toBe(true);
    expect(esTextoCartaPorte({ type: 'text', text: 'Hola, ya salió el camión con 880 piezas, llega mañana temprano a la bodega de siempre.' })).toBe(false);
    expect(esTextoCartaPorte({ type: 'text', text: `RFC ${RFC.boreal} 880 pzas` })).toBe(false); // 2 señales y corto
  });
  it('un RFC con dígito verificador malo o un número cualquiera de 8 dígitos no cuentan como RFC', () => {
    expect(senalesDeForma('GBO090704XX1')).toBe(0); // grep-limpio:ok (RFC sintético con dígito verificador inválido)
    expect(senalesDeForma('folio 12345678')).toBe(1); // clave de 8 dígitos, no RFC
  });
  it('un mensaje con archivo, o que no es texto, no es texto pegado', () => {
    expect(esTextoCartaPorte({ type: 'image', text: `ccp ${CUERPO}` })).toBe(false);
    expect(esTextoCartaPorte({ type: 'text', mediaId: 'm', text: `ccp ${CUERPO}` })).toBe(false);
    expect(esTextoCartaPorte({ type: 'text' })).toBe(false);
  });
});

describe('texto pegado — ingerirDesdeWhatsapp', () => {
  it('orden «ccp» + datos: queda como documento de WhatsApp, formato correo, nombre por sha, y se responde con la liga', async () => {
    const d = deps({});
    expect(await ingerirDesdeWhatsapp(entrada({ type: 'text', text: `ccp ${CUERPO}` }), d)).toBe('atendido');
    expect(estado.docs.size).toBe(1);
    const doc = [...estado.docs.values()][0];
    expect(doc).toMatchObject({ tenantId: A, canal: 'whatsapp', formato: 'correo' });
    expect(doc.nombreArchivo).toMatch(/^whatsapp-texto-[0-9a-f]{8}\.txt$/);
    expect(doc.remitente).toBe('WhatsApp · Ana');
    expect(d.respuestas).toHaveLength(1);
    expect(d.respuestas[0]).toContain(`/dashboard/carta-porte/documentos/${doc.id}`);
  });

  it('texto largo con 4 señales y sin orden: atendido y 1 documento', async () => {
    const d = deps({});
    expect(await ingerirDesdeWhatsapp(entrada({ type: 'text', text: SIN_ORDEN_4_SENALES }), d)).toBe('atendido');
    expect(estado.docs.size).toBe(1);
  });

  it('un mensaje conversacional no se toca: no_aplica, sin documento ni respuesta', async () => {
    const d = deps({});
    expect(await ingerirDesdeWhatsapp(entrada({ type: 'text', text: 'hola, ya salió el camión' }), d)).toBe('no_aplica');
    expect(estado.docs.size).toBe(0);
    expect(estado.archivos.size).toBe(0);
    expect(d.respuestas).toEqual([]);
  });

  it('el mismo texto dos veces: duplicado, no se crea otro y se le da la liga al existente', async () => {
    const d = deps({});
    await ingerirDesdeWhatsapp(entrada({ type: 'text', text: `ccp ${CUERPO}` }), d);
    await ingerirDesdeWhatsapp(entrada({ type: 'text', text: `ccp ${CUERPO}` }), d);
    expect(estado.docs.size).toBe(1);
    const doc = [...estado.docs.values()][0];
    expect(d.respuestas[1]).toMatch(/ya estaba en la bandeja/);
    expect(d.respuestas[1]).toContain(doc.id);
  });

  it('flota sin buzón, o con el buzón apagado: no_aplica y no se guarda nada', async () => {
    const d = deps({});
    await repo.configurarBuzon(A, { activo: false });
    expect(await ingerirDesdeWhatsapp(entrada({ type: 'text', text: `ccp ${CUERPO}` }), d)).toBe('no_aplica');
    estado.buzones.clear();
    expect(await ingerirDesdeWhatsapp(entrada({ type: 'text', text: `ccp ${CUERPO}` }), d)).toBe('no_aplica');
    expect(estado.docs.size).toBe(0);
    expect(d.respuestas).toEqual([]);
  });

  it('un texto de más de 30 000 caracteres no se guarda: se le pide subirlo como archivo', async () => {
    const d = deps({});
    expect(await ingerirDesdeWhatsapp(entrada({ type: 'text', text: `ccp ${CUERPO} ${'x'.repeat(MAX_TEXTO_MODELO)}` }), d)).toBe('atendido');
    expect(estado.docs.size).toBe(0);
    expect(d.respuestas[0]).toMatch(/demasiado largo/);
  });

  it('con el agente apagado: se le dice y no se guarda nada', async () => {
    const d = deps({}, { apagado: async () => true });
    expect(await ingerirDesdeWhatsapp(entrada({ type: 'text', text: `ccp ${CUERPO}` }), d)).toBe('atendido');
    expect(d.respuestas[0]).toMatch(/apagado/);
    expect(estado.docs.size).toBe(0);
  });
});
