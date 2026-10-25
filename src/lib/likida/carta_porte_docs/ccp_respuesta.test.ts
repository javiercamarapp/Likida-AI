import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  confirmarYResponder, correoCcpTimbrado, destinoDeRemitente, leerCcpTimbrado, procesarCcpTimbrado, MAX_ADJUNTO_BYTES,
} from './ccp_respuesta';
import { dobleCcp, pdfSintetico, REFERENCIA, TENANT, OTRO_TENANT, UUID_FISCAL, xmlCcp, xmlSinCartaPorte } from './ccp_respuesta.fixture';

const entrada = (p: Partial<{ tenantId: string; referencia: string; xml: Uint8Array; pdf: Uint8Array }> = {}) =>
  ({ tenantId: TENANT, referencia: REFERENCIA, xml: xmlCcp(), pdf: pdfSintetico(), ...p });

/** Una flota que YA le respondió antes a ese cliente (la primera vez pide confirmación humana). */
const conClienteConocido = (e: ReturnType<typeof dobleCcp>['e']) => e.filas.push({
  id: 'previa', tenantId: TENANT, documentoId: 'd-x', envioId: 'e-x', uuid: 'cccccccc-1111-4222-8333-dddddddddddd',
  pdfRuta: 'p', xmlRuta: 'x', destinoCorreo: 'compras@cliente-sintetico.test', estado: 'respondido', respondidoEn: '2026-10-01T00:00:00.000Z',
});

describe('leerCcpTimbrado', () => {
  it('lee el UUID fiscal (en minúsculas) y el folio de un CCP con timbre', () => {
    expect(leerCcpTimbrado(xmlCcp())).toEqual({ uuid: UUID_FISCAL, folio: 'SF-100' });
  });
  it('rechaza un XML sin complemento Carta Porte, sin timbre, mal formado, con entidades o que no es texto', () => {
    expect(leerCcpTimbrado(xmlSinCartaPorte())).toBeNull();
    expect(leerCcpTimbrado(xmlCcp(null))).toBeNull();
    expect(leerCcpTimbrado(new TextEncoder().encode('<a><b></a>'))).toBeNull();
    expect(leerCcpTimbrado(new TextEncoder().encode('<!DOCTYPE x [<!ENTITY e "boom">]><cfdi:Comprobante/>'))).toBeNull();
    expect(leerCcpTimbrado(new Uint8Array([0xff, 0xfe, 0x00]))).toBeNull();
    expect(leerCcpTimbrado(xmlCcp('no-es-uuid'))).toBeNull();
  });
});

describe('procesarCcpTimbrado', () => {
  it('flota activa + remitente reconocido y ya conocido: 1 correo con 2 adjuntos y respondido_en', async () => {
    const { deps, e } = dobleCcp(); conClienteConocido(e);
    const r = await procesarCcpTimbrado(deps, entrada());
    expect(r).toEqual({ ok: true, duplicado: false, estado: 'respondido', respondido: true });
    expect(e.correos).toHaveLength(1);
    expect(e.correos[0].para).toBe('compras@cliente-sintetico.test');
    expect(e.correos[0].adjuntos.map((a) => a.filename).sort()).toEqual([`${UUID_FISCAL}.pdf`, `${UUID_FISCAL}.xml`]);
    // El XML viaja byte a byte (su sello no se rompe) y el PDF también.
    const xml = e.correos[0].adjuntos.find((a) => a.contentType === 'application/xml')!;
    expect(Buffer.from(xml.content, 'base64').equals(Buffer.from(xmlCcp()))).toBe(true);
    const fila = e.filas.find((f) => f.uuid === UUID_FISCAL)!;
    expect(fila.respondidoEn).not.toBeNull();
    expect(fila.estado).toBe('respondido');
    expect(e.archivos.size).toBe(2); // PDF y XML guardados
  });

  it('el mismo UUID dos veces: una fila y UN solo correo', async () => {
    const { deps, e } = dobleCcp(); conClienteConocido(e);
    await procesarCcpTimbrado(deps, entrada());
    const r2 = await procesarCcpTimbrado(deps, entrada());
    expect(r2).toEqual({ ok: true, duplicado: true, estado: 'respondido', respondido: true });
    expect(e.correos).toHaveLength(1);
    expect(e.filas.filter((f) => f.uuid === UUID_FISCAL)).toHaveLength(1);
  });

  it('referencia ajena o inventada: no_encontrado, sin guardar y sin correo', async () => {
    const { deps, e } = dobleCcp(); conClienteConocido(e);
    expect(await procesarCcpTimbrado(deps, entrada({ referencia: 'REF-AJENA' }))).toMatchObject({ ok: false, codigo: 'no_encontrado' });
    // Una referencia que existe, pero en OTRA flota, tampoco aparece para esta.
    e.envios.set(`${OTRO_TENANT}|REF-DE-OTRA`, { envioId: 'e2', documentoId: 'd2', remitente: 'x@y.test', remitenteReconocido: true });
    expect(await procesarCcpTimbrado(deps, entrada({ referencia: 'REF-DE-OTRA' }))).toMatchObject({ ok: false, codigo: 'no_encontrado' });
    expect(e.correos).toHaveLength(0);
    expect(e.archivos.size).toBe(0);
    expect(e.filas.filter((f) => f.uuid === UUID_FISCAL)).toHaveLength(0);
  });

  it('el mismo UUID bajo OTRO envío no se re-liga: no_encontrado', async () => {
    const { deps, e } = dobleCcp();
    await procesarCcpTimbrado(deps, entrada());
    e.envios.set(`${TENANT}|REF-2`, { envioId: 'otro-envio', documentoId: 'd9', remitente: null, remitenteReconocido: null });
    expect(await procesarCcpTimbrado(deps, entrada({ referencia: 'REF-2' }))).toMatchObject({ ok: false, codigo: 'no_encontrado' });
  });

  it('remitente no reconocido: queda pendiente_confirmacion y 0 correos', async () => {
    const { deps, e } = dobleCcp(); conClienteConocido(e);
    e.envios.set(`${TENANT}|${REFERENCIA}`, { envioId: 'e1', documentoId: 'd1', remitente: 'desconocido@otro.test', remitenteReconocido: false });
    const r = await procesarCcpTimbrado(deps, entrada());
    expect(r).toEqual({ ok: true, duplicado: false, estado: 'pendiente_confirmacion', respondido: false });
    expect(e.correos).toHaveLength(0);
  });

  it('la PRIMERA vez por cliente pide confirmación humana aunque el remitente sea reconocido', async () => {
    const { deps, e } = dobleCcp(); // sin respuestas previas a ese destino
    const r = await procesarCcpTimbrado(deps, entrada());
    expect(r).toMatchObject({ estado: 'pendiente_confirmacion', respondido: false });
    expect(e.correos).toHaveLength(0);
  });

  it('sin remitente (el documento no vino de un correo): pendiente_confirmacion sin destino', async () => {
    const { deps, e } = dobleCcp();
    e.envios.set(`${TENANT}|${REFERENCIA}`, { envioId: 'e1', documentoId: 'd1', remitente: null, remitenteReconocido: null });
    expect(await procesarCcpTimbrado(deps, entrada())).toMatchObject({ estado: 'pendiente_confirmacion', respondido: false });
    expect(e.filas[0].destinoCorreo).toBeNull();
  });

  it('flota sin activar: guarda sin responder (0 correos) — el valor por omisión', async () => {
    const { deps, e } = dobleCcp({ config: { activa: false } }); conClienteConocido(e);
    const r = await procesarCcpTimbrado(deps, entrada());
    expect(r).toEqual({ ok: true, duplicado: false, estado: 'guardado', respondido: false });
    expect(e.correos).toHaveLength(0);
    expect(e.filas.some((f) => f.uuid === UUID_FISCAL)).toBe(true);
  });

  it('sin la migración 0794: sin_migracion y nada se guarda', async () => {
    const { deps, e } = dobleCcp({ config: { activa: 'sin_migracion' } });
    expect(await procesarCcpTimbrado(deps, entrada())).toMatchObject({ ok: false, codigo: 'sin_migracion' });
    expect(e.archivos.size).toBe(0);
  });

  it('si el correo no sale: queda error_envio y un nuevo aviso del MISMO UUID NO reenvía solo (A37-S31-08); lo confirma una persona', async () => {
    const { deps, e } = dobleCcp({ correoOk: false }); conClienteConocido(e);
    const r1 = await procesarCcpTimbrado(deps, entrada());
    expect(r1).toEqual({ ok: true, duplicado: false, estado: 'error_envio', respondido: false });
    expect(e.logs.some((l) => l.evento === 'ccp_respuesta.correo_no_salio')).toBe(true);
    e.correoOk = true;
    const r2 = await procesarCcpTimbrado(deps, entrada());
    expect(r2).toEqual({ ok: true, duplicado: true, estado: 'error_envio', respondido: false });
    expect(e.correos).toHaveLength(0);
  });

  it('si otro hilo ganó el candado, este no manda un segundo correo', async () => {
    const { deps, e } = dobleCcp({ perderCandado: true }); conClienteConocido(e);
    const r = await procesarCcpTimbrado(deps, entrada());
    expect(r).toMatchObject({ ok: true, respondido: false });
    expect(e.correos).toHaveLength(0);
  });

  it('adjuntos grandes, PDF falso y XML que no es CCP: error y nada guardado', async () => {
    const { deps, e } = dobleCcp(); conClienteConocido(e);
    expect(await procesarCcpTimbrado(deps, entrada({ pdf: new Uint8Array(MAX_ADJUNTO_BYTES + 1) }))).toMatchObject({ codigo: 'adjunto_grande' });
    expect(await procesarCcpTimbrado(deps, entrada({ xml: new Uint8Array(MAX_ADJUNTO_BYTES + 1) }))).toMatchObject({ codigo: 'adjunto_grande' });
    expect(await procesarCcpTimbrado(deps, entrada({ pdf: new TextEncoder().encode('no soy pdf') }))).toMatchObject({ codigo: 'pdf_invalido' });
    expect(await procesarCcpTimbrado(deps, entrada({ xml: xmlSinCartaPorte() }))).toMatchObject({ codigo: 'xml_invalido' });
    expect(e.correos).toHaveLength(0);
    expect(e.archivos.size).toBe(0);
  });

  it('el log no lleva direcciones, folios ni UUID', async () => {
    const { deps, e } = dobleCcp({ correoOk: false }); conClienteConocido(e);
    await procesarCcpTimbrado(deps, entrada());
    const volcado = JSON.stringify(e.logs);
    expect(volcado).not.toMatch(/@|compras|SF-100|aaaaaaaa/i);
  });
});

describe('confirmarYResponder (la primera vez por cliente)', () => {
  it('una persona confirma: sale UN correo con los archivos guardados y la próxima vez ya no pide confirmación', async () => {
    const { deps, e } = dobleCcp();
    await procesarCcpTimbrado(deps, entrada());
    const fila = e.filas[0];
    expect(fila.estado).toBe('pendiente_confirmacion');
    const r = await confirmarYResponder(deps, TENANT, fila);
    expect(r).toEqual({ ok: true, respondido: true, estado: 'respondido' });
    expect(e.correos).toHaveLength(1);
    expect(e.correos[0].correo.asunto).toContain('SF-100');
    // Otro CCP del mismo cliente: ya conocido, sale solo.
    const r2 = await procesarCcpTimbrado(deps, entrada({ xml: xmlCcp('eeeeeeee-1111-4222-8333-ffffffffffff') }));
    expect(r2).toMatchObject({ estado: 'respondido', respondido: true });
    expect(e.correos).toHaveLength(2);
  });

  it('puede corregir el destino; uno inválido se rechaza sin mandar nada', async () => {
    const { deps, e } = dobleCcp();
    e.envios.set(`${TENANT}|${REFERENCIA}`, { envioId: 'e1', documentoId: 'd1', remitente: null, remitenteReconocido: null });
    await procesarCcpTimbrado(deps, entrada());
    const fila = e.filas[0];
    expect(await confirmarYResponder(deps, TENANT, fila)).toEqual({ ok: false, motivo: 'sin_destino' });
    expect(await confirmarYResponder(deps, TENANT, fila, 'esto no es un correo')).toEqual({ ok: false, motivo: 'destino_invalido' });
    expect(e.correos).toHaveLength(0);
    expect(await confirmarYResponder(deps, TENANT, fila, ' Otro@Cliente.test ')).toMatchObject({ ok: true, respondido: true });
    expect(e.correos[0].para).toBe('otro@cliente.test');
  });

  it('no actúa sobre filas de otra flota, ya respondidas o que solo se guardaron', async () => {
    const { deps, e } = dobleCcp({ config: { activa: false } });
    await procesarCcpTimbrado(deps, entrada());
    const guardada = e.filas[0];
    expect(await confirmarYResponder(deps, TENANT, guardada)).toEqual({ ok: false, motivo: 'no_aplica' });
    expect(await confirmarYResponder(deps, OTRO_TENANT, guardada)).toEqual({ ok: false, motivo: 'no_encontrada' });
    expect(await confirmarYResponder(deps, TENANT, null)).toEqual({ ok: false, motivo: 'no_encontrada' });
    expect(await confirmarYResponder(deps, TENANT, { ...guardada, estado: 'respondido' })).toEqual({ ok: false, motivo: 'ya_respondida' });
    expect(e.correos).toHaveLength(0);
  });
});

describe('utilidades', () => {
  it('destinoDeRemitente saca el correo de «Nombre <a@b>» y de «a@b»', () => {
    expect(destinoDeRemitente('Ana <Ana@Ejemplo.test>')).toBe('ana@ejemplo.test');
    expect(destinoDeRemitente('solo@ejemplo.test')).toBe('solo@ejemplo.test');
    expect(destinoDeRemitente('sin correo')).toBeNull();
    expect(destinoDeRemitente(null)).toBeNull();
  });
  it('el correo lleva folio y UUID, sin texto libre ni etiquetas del folio', () => {
    const c = correoCcpTimbrado(UUID_FISCAL, 'F-1 <script>alert(1)</script>');
    expect(c.asunto).not.toMatch(/[<>]/);
    expect(c.datos).toEqual([['UUID fiscal', UUID_FISCAL]]);
    expect(correoCcpTimbrado(UUID_FISCAL, null).asunto).toBe('Carta Porte timbrada');
  });
  it('este módulo no timbra ni importa el camino del timbre', () => {
    const fuentes: Record<string, string> = {
      'ccp_respuesta.ts': readFileSync('src/lib/likida/carta_porte_docs/ccp_respuesta.ts', 'utf8'),
      'ccp_respuesta_repo.ts': readFileSync('src/lib/likida/carta_porte_docs/ccp_respuesta_repo.ts', 'utf8'),
    };
    for (const [f, src] of Object.entries(fuentes)) {
      expect(/from ['"][^'"]*(carta_porte_timbre|carta_porte_cfdi|\/pac\/|pac\/index|carta_porte_xml)['"]/.test(src), `${f} importa el timbre`).toBe(false);
      expect(/resolverPac|LIKIDA_PAC_|\.timbrar\(|timbrarCcp|timbrarCfdi/.test(src), `${f} llama al timbre`).toBe(false);
    }
  });
});
