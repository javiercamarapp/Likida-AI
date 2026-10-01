import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./repo', async () => (await import('./repo_falso.test.util')).api);
vi.mock('../bitacora_escritura', () => ({ anotarBitacora: vi.fn(async () => true) }));
import { estado, reset } from './repo_falso.test.util';
import { A, B, lecturaAtlas, sembrarFlotas } from './escenario.test.util';
import {
  MAX_ADJUNTO_BYTES, atenderCorreoCartaPorte, direccionCp, generarTokenCp, remitenteReconocido, tokenCpDeDestinatarios, tokenCpDeDireccion, type DepsCorreo,
} from './correo_entrante';
import { llmFalso, lecturaBoreal } from './llm_falso.test.util';
import { correoTexto, defectuosos, excelAtlas, pdfBoreal, xmlCartaPorte } from './fixtures.test.util';
import * as repo from './repo';

const DOM = 'mail.likida.test';
const TOKEN_A = 'abcdefghjkmnpqrstvwxyz23';
const TOKEN_B = 'zyxwvtsrqpnmkjhgfedcba98'.slice(0, 24);

function deps(adjuntos: Record<string, Uint8Array | 'caida' | 'permanente'> = {}, over: Partial<DepsCorreo> = {}): DepsCorreo & { descargas: string[] } {
  const descargas: string[] = [];
  const llm = llmFalso((e) => lecturaBoreal(e.nivel));
  return {
    apagado: async () => false, llm: () => llm, restanteMs: () => 60_000,
    descargar: async (_email, id) => {
      descargas.push(id);
      const v = adjuntos[id];
      if (v === 'caida') return { ok: false, transitorio: true };
      if (v === 'permanente' || v === undefined) return { ok: false, transitorio: false };
      return { ok: true, bytes: v };
    },
    descargas, ...over,
  };
}

beforeEach(async () => {
  reset(); sembrarFlotas();
  process.env.RESEND_API_KEY = 're_test';
  await repo.crearBuzon(A, TOKEN_A);
  await repo.crearBuzon(B, TOKEN_B);
});

describe('la dirección del buzón', () => {
  it('se arma y se lee de vuelta; el token generado es del alfabeto de la casa', () => {
    const t = generarTokenCp();
    expect(t).toMatch(/^[abcdefghjkmnpqrstvwxyz2-9]{24}$/);
    expect(direccionCp(t, DOM)).toBe(`cp-${t}@${DOM}`);
    expect(tokenCpDeDireccion(`cp-${t}@${DOM}`, DOM)).toBe(t);
    expect(direccionCp('corto', DOM)).toBeNull();
    expect(direccionCp(t, null)).toBeNull();
  });
  it('tolera mayúsculas, «Nombre <correo>» y el sufijo +algo', () => {
    expect(tokenCpDeDireccion(`Logística <CP-${TOKEN_A.toUpperCase()}@${DOM.toUpperCase()}>`, DOM)).toBe(TOKEN_A);
    expect(tokenCpDeDireccion(`cp-${TOKEN_A}+reenviado@${DOM}`, DOM)).toBe(TOKEN_A);
  });
  it('un dominio ajeno, el prefijo del buzón de facturas o un token mal formado NO son nuestros', () => {
    expect(tokenCpDeDireccion(`cp-${TOKEN_A}@otro.com`, DOM)).toBeNull();
    expect(tokenCpDeDireccion(`f-${TOKEN_A}@${DOM}`, DOM)).toBeNull();
    expect(tokenCpDeDireccion(`cp-${TOKEN_A.slice(1)}@${DOM}`, DOM)).toBeNull();
    expect(tokenCpDeDireccion(`cp-${'0'.repeat(24)}@${DOM}`, DOM)).toBeNull();
    expect(tokenCpDeDireccion('sin-arroba', DOM)).toBeNull();
  });
  it('dos buzones distintos en el mismo correo = ninguno (no se adivina a cuál iba)', () => {
    expect(tokenCpDeDestinatarios([`cp-${TOKEN_A}@${DOM}`, 'otro@x.com'], DOM)).toBe(TOKEN_A);
    expect(tokenCpDeDestinatarios([`cp-${TOKEN_A}@${DOM}`, `cp-${TOKEN_B}@${DOM}`], DOM)).toBeNull();
    expect(tokenCpDeDestinatarios([`cp-${TOKEN_A}@${DOM}`, `cp-${TOKEN_A}@${DOM}`], DOM)).toBe(TOKEN_A);
  });
  it('remitenteReconocido: por correo, por dominio o por @dominio; sin lista no hay veredicto', () => {
    expect(remitenteReconocido('Ana <ana@cliente.com>', [])).toBeNull();
    expect(remitenteReconocido('Ana <ana@cliente.com>', ['ana@cliente.com'])).toBe(true);
    expect(remitenteReconocido('Ana <ana@cliente.com>', ['cliente.com'])).toBe(true);
    expect(remitenteReconocido('Ana <ana@cliente.com>', ['@cliente.com'])).toBe(true);
    expect(remitenteReconocido('x@evil-cliente.com', ['cliente.com'])).toBe(false);
    expect(remitenteReconocido('sin correo', ['cliente.com'])).toBe(false);
  });
});

describe('atenderCorreoCartaPorte', () => {
  const base = { emailId: 'em-1', from: 'Logística <logistica@cliente.example>', subject: 'Embarque CG-5521' };

  it('buzón desconocido o apagado: 200 sin hacer nada', async () => {
    expect(await atenderCorreoCartaPorte('x'.repeat(24), { ...base, text: correoTexto() }, deps())).toMatchObject({ status: 200, cuerpo: { ignorado: 'buzon_desconocido' } });
    await repo.configurarBuzon(A, { activo: false });
    expect(await atenderCorreoCartaPorte(TOKEN_A, { ...base, text: correoTexto() }, deps())).toMatchObject({ status: 200, cuerpo: { ignorado: 'buzon_apagado' } });
    expect(estado.docs.size).toBe(0);
  });

  it('un «gracias» sin adjuntos no es un documento', async () => {
    expect(await atenderCorreoCartaPorte(TOKEN_A, { ...base, text: 'Gracias, recibido.' }, deps())).toMatchObject({ status: 200, cuerpo: { ignorado: 'sin_contenido' } });
    expect(estado.docs.size).toBe(0);
    expect(estado.correos.size).toBe(0); // y no consumió el email_id
  });

  it('los adjuntos de varios formatos entran a la flota DEL TOKEN, con remitente y asunto, y se extraen', async () => {
    const xlsx = excelAtlas();
    const d = deps({ a1: await pdfBoreal(), a2: xlsx, a3: Buffer.from(xmlCartaPorte()) });
    const r = await atenderCorreoCartaPorte(TOKEN_A, { ...base, attachments: [{ id: 'a1', filename: 'orden.pdf' }, { id: 'a2', filename: 'plan.xlsx' }, { id: 'a3', filename: 'ccp.xml' }, { id: 'a4', filename: 'firma.png.exe' }] }, d);
    expect(r).toMatchObject({ status: 200, cuerpo: { ok: true, recibidos: 3, duplicados: 0, procesados: 3, pendientes: 0 } });
    expect(d.descargas).toEqual(['a1', 'a2', 'a3']); // el .exe ni se descarga
    const docs = [...estado.docs.values()];
    expect(docs.every((x) => x.tenantId === A && x.canal === 'correo' && x.asunto === 'Embarque CG-5521' && x.remitente?.includes('logistica@cliente.example'))).toBe(true);
    expect(docs.map((x) => x.formato).sort()).toEqual(['excel', 'pdf_texto', 'xml']);
    expect(docs.every((x) => x.estado === 'por_revisar')).toBe(true);
    expect([...estado.docs.values()].some((x) => x.tenantId === B)).toBe(false);
  });

  it('el CUERPO del correo (con datos) también es un documento, y no se confunde con CSV', async () => {
    const cuerpo = correoTexto().replace(/\n/g, ',\n'); // parece delimitado a propósito
    const r = await atenderCorreoCartaPorte(TOKEN_A, { ...base, text: cuerpo }, deps());
    expect(r.cuerpo).toMatchObject({ recibidos: 1 });
    expect([...estado.docs.values()][0].formato).toBe('correo');
    expect([...estado.docs.values()][0].nombreArchivo).toBe('cuerpo-del-correo.txt');
  });

  it('el cuerpo HTML se convierte a texto', async () => {
    const r = await atenderCorreoCartaPorte(TOKEN_A, { ...base, html: `<p>${correoTexto().replace(/\n/g, '<br>')}</p><script>x</script>` }, deps());
    expect(r.cuerpo).toMatchObject({ recibidos: 1 });
  });

  it('IDEMPOTENCIA: el reintento de Resend (mismo email_id) no duplica; el mismo archivo en otro correo tampoco', async () => {
    const d = () => deps({ a1: pdfBytes });
    const pdfBytes = await pdfBoreal();
    const ev = { ...base, attachments: [{ id: 'a1', filename: 'orden.pdf' }] };
    const uno = await atenderCorreoCartaPorte(TOKEN_A, ev, d());
    expect(uno.cuerpo).toMatchObject({ recibidos: 1 });
    const dos = await atenderCorreoCartaPorte(TOKEN_A, ev, d());
    expect(dos).toMatchObject({ status: 200, cuerpo: { ignorado: 'ya_procesado' } });
    const reenvio = await atenderCorreoCartaPorte(TOKEN_A, { ...ev, emailId: 'em-2' }, d());
    expect(reenvio.cuerpo).toMatchObject({ recibidos: 0, duplicados: 1 });
    expect(estado.docs.size).toBe(1);
  });

  it('una descarga caída (transitoria) devuelve 503 y NO consume el correo: el reintento lo recupera', async () => {
    const pdf = await pdfBoreal();
    const ev = { ...base, attachments: [{ id: 'a1', filename: 'orden.pdf' }, { id: 'a2', filename: 'plan.xlsx' }] };
    const r1 = await atenderCorreoCartaPorte(TOKEN_A, ev, deps({ a1: pdf, a2: 'caida' }));
    expect(r1.status).toBe(503);
    expect(estado.correos.has('em-1')).toBe(false);
    const r2 = await atenderCorreoCartaPorte(TOKEN_A, ev, deps({ a1: pdf, a2: excelAtlas() }));
    expect(r2).toMatchObject({ status: 200, cuerpo: { recibidos: 1, duplicados: 1 } }); // a1 ya estaba (misma huella)
    expect(estado.docs.size).toBe(2);
  });

  it('un adjunto gigante o ilegible se ignora sin tumbar los demás ni pedir reintento', async () => {
    const grande = new Uint8Array(MAX_ADJUNTO_BYTES + 1).fill(37);
    const r = await atenderCorreoCartaPorte(TOKEN_A, { ...base, attachments: [{ id: 'g', filename: 'enorme.pdf' }, { id: 'e', filename: 'virus.pdf' }, { id: 'b', filename: 'ok.pdf' }] },
      deps({ g: grande, e: defectuosos.ejecutable, b: await pdfBoreal() }));
    expect(r).toMatchObject({ status: 200, cuerpo: { recibidos: 1, ignorados: 2 } });
  });

  it('con el agente apagado: 503 (para que vuelva) y sin consumir el email_id', async () => {
    const r = await atenderCorreoCartaPorte(TOKEN_A, { ...base, text: correoTexto() }, deps({}, { apagado: async () => true }));
    expect(r.status).toBe(503);
    expect(estado.correos.size).toBe(0);
    expect(estado.docs.size).toBe(0);
  });

  it('sin RESEND_API_KEY y con adjuntos: 503 sin consumir el correo', async () => {
    delete process.env.RESEND_API_KEY;
    const r = await atenderCorreoCartaPorte(TOKEN_A, { ...base, attachments: [{ id: 'a1', filename: 'x.pdf' }] }, deps({ a1: await pdfBoreal() }));
    expect(r.status).toBe(503);
    expect(estado.correos.size).toBe(0);
  });

  it('un correo en proceso por otra entrega: 503 con claim ocupado', async () => {
    estado.correos.set('em-1', { estado: 'claimed', token: 'otro' });
    expect((await atenderCorreoCartaPorte(TOKEN_A, { ...base, text: correoTexto() }, deps())).status).toBe(503);
  });

  it('el remitente fuera de la lista del buzón entra IGUAL, marcado para revisión', async () => {
    await repo.configurarBuzon(A, { remitentesPermitidos: ['cliente.example'] });
    await atenderCorreoCartaPorte(TOKEN_A, { ...base, emailId: 'em-ok', attachments: [{ id: 'a1', filename: 'a.pdf' }] }, deps({ a1: await pdfBoreal() }));
    await atenderCorreoCartaPorte(TOKEN_A, { ...base, emailId: 'em-x', from: 'x@falso.test', attachments: [{ id: 'a2', filename: 'b.xlsx' }] }, deps({ a2: excelAtlas() }));
    const docs = [...estado.docs.values()];
    expect(docs.find((d) => d.formato === 'pdf_texto')!.remitenteReconocido).toBe(true);
    const ajeno = docs.find((d) => d.formato === 'excel')!;
    expect(ajeno.remitenteReconocido).toBe(false);
    expect(ajeno.validacion?.hallazgos.some((h) => h.codigo === 'remitente_no_reconocido')).toBe(true);
  });

  it('sin tiempo en el reloj, el documento queda «recibido» para procesarlo desde la bandeja', async () => {
    const r = await atenderCorreoCartaPorte(TOKEN_A, { ...base, attachments: [{ id: 'a1', filename: 'a.pdf' }] }, deps({ a1: await pdfBoreal() }, { restanteMs: () => 5_000 }));
    expect(r.cuerpo).toMatchObject({ recibidos: 1, procesados: 0, pendientes: 1 });
    expect([...estado.docs.values()][0].estado).toBe('recibido');
  });

  it('si la base falla al guardar: 503 y el claim se libera', async () => {
    estado.fallar.set('subirArchivo', new Error('storage 500'));
    const r = await atenderCorreoCartaPorte(TOKEN_A, { ...base, attachments: [{ id: 'a1', filename: 'a.pdf' }] }, deps({ a1: await pdfBoreal() }));
    expect(r.status).toBe(503);
    expect(estado.correos.has('em-1')).toBe(false);
  });

  it('máximo 10 adjuntos por correo', async () => {
    const adj = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`a${i}`, Buffer.from(correoTexto(`n${i}`))]));
    const d = deps(adj);
    await atenderCorreoCartaPorte(TOKEN_A, { ...base, attachments: Object.keys(adj).map((id) => ({ id, filename: `${id}.txt` })) }, d);
    expect(d.descargas).toHaveLength(10);
  });
  void lecturaAtlas;
});
