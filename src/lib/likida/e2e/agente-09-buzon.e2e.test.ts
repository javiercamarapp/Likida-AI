import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { crearDbMemoria, type DbMemoria } from './db_memoria.fixture';

// ═══════════════════════════════════════════════════════════════════════════
// E2E AGENTE 9 — BUZÓN DE FACTURAS DE PROVEEDORES.
//
// Cadena REAL: webhook de Resend firmado (svix) → ruta /api/correo/entrante → token de buzón → claim del correo
// (reclamar/finalizar_correo) → descarga del adjunto → parseCfdiXml real → guardarFacturaProveedor (unique tenant+uuid) →
// decisión humana (candado de estado) → export SAP B1 / CONTPAQi → marca anti-doble-import.
// DOBLES: base en memoria con RPC de claim, Resend (fetch), SAT, interruptor. CFDI SINTÉTICOS (RFC y UUID ficticios).
// ═══════════════════════════════════════════════════════════════════════════

let db: DbMemoria;
const correos = new Map<string, { estado: 'claimed' | 'applied'; token: string }>();
let apagado = false;
const xmlDe = new Map<string, string>(); // attachment id → contenido
let descargaCaida = false;

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/interruptores', () => ({ estaApagado: async () => apagado }));
vi.mock('@/lib/likida/agentes/corridas', () => ({ registrarCorrida: vi.fn(async () => {}) }));
vi.mock('@/lib/likida/intake/sat', async (orig) => ({ ...(await orig<Record<string, unknown>>()), consultarCFDI: async () => ({ estado: 'vigente' }) }));

const { POST } = await import('@/app/api/correo/entrante/route');
const { listarFacturasProveedor, decidirFacturaProveedor, exportarAprobadas, marcarExportadas } = await import('../proveedores');

const SECRETO = 'whsec_' + Buffer.from('secreto-e2e-buzon-sintetico').toString('base64');
const TOK_A = 'abcdefghjkmnpqrstvwxyz23'; const TOK_B = 'bcdefghjkmnpqrstvwxyz234';
const A = 't-a'; const B = 't-b';
const RFC_FLOTA_A = 'AAA010101AAA';

const cfdi = (uuid: string, total: string, receptor = RFC_FLOTA_A, tipo = 'I') => `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" TipoDeComprobante="${tipo}" Fecha="2026-09-30T10:00:00" SubTotal="${(Number(total) / 1.16).toFixed(2)}" Total="${total}">
  <cfdi:Emisor Rfc="TAL010101XX1" Nombre="Taller Ficticio SA"/>
  <cfdi:Receptor Rfc="${receptor}"/>
  <cfdi:Conceptos><cfdi:Concepto ClaveProdServ="78181500" Cantidad="1" Descripcion="Servicio de taller ficticio" ValorUnitario="${total}" Importe="${total}"/></cfdi:Conceptos>
  <cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" UUID="${uuid}"/></cfdi:Complemento>
</cfdi:Comprobante>`;
const U1 = '11111111-AAAA-4AAA-8AAA-000000000001'; const U2 = '11111111-AAAA-4AAA-8AAA-000000000002';

let n = 0;
function webhook(emailId: string, adjuntos: Array<{ id: string; filename: string; contenido: string }>, token = TOK_A, opts: { firmar?: boolean } = {}) {
  for (const a of adjuntos) xmlDe.set(a.id, a.contenido);
  const texto = JSON.stringify({ type: 'email.received', data: { email_id: emailId, from: 'taller@proveedor.example', to: [`f-${token}@mail.likida.ai`], attachments: adjuntos.map((a) => ({ id: a.id, filename: a.filename, content_type: 'application/xml' })) } });
  const id = `msg_${++n}`; const ts = String(Math.floor(Date.now() / 1000));
  const h = new Headers({ 'content-type': 'application/json' });
  if (opts.firmar !== false) {
    const f = createHmac('sha256', Buffer.from(SECRETO.slice(6), 'base64')).update(`${id}.${ts}.${texto}`, 'utf8').digest('base64');
    h.set('svix-id', id); h.set('svix-timestamp', ts); h.set('svix-signature', `v1,${f}`);
  }
  return POST(new Request('https://app.likida.ai/api/correo/entrante', { method: 'POST', headers: h, body: texto }));
}

beforeEach(() => {
  process.env.RESEND_WEBHOOK_SECRET = SECRETO; process.env.RESEND_EMAIL_DOMAIN = 'mail.likida.ai'; process.env.RESEND_API_KEY = 'llave-sintetica';
  apagado = false; descargaCaida = false; correos.clear(); xmlDe.clear();
  db = crearDbMemoria(
    { tenant: [{ id: A, rfc: RFC_FLOTA_A, buzon_token: TOK_A }, { id: B, rfc: 'BBB020202BBB', buzon_token: TOK_B }], factura_proveedor: [] },
    {
      reclamar_correo: (a) => {
        const id = String(a.p_email_id); const c = correos.get(id);
        if (c?.estado === 'applied') return [{ resultado: 'applied', token: null }];
        if (c?.estado === 'claimed') return [{ resultado: 'busy', token: null }];
        correos.set(id, { estado: 'claimed', token: `claim:${id}` });
        return [{ resultado: 'claimed', token: `claim:${id}` }];
      },
      finalizar_correo: (a) => {
        const id = String(a.p_email_id); const c = correos.get(id);
        if (!c || c.token !== a.p_token) return false;
        if (a.p_ok) c.estado = 'applied'; else correos.delete(id);
        return true;
      },
    },
    { factura_proveedor: [['tenant_id', 'cfdi_uuid']] },
    { factura_proveedor: { estado: 'pendiente', exportada_en: null, decidido_por: null, decidido_en: null, ocr_confianza: null } },
  );
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    const m = /\/attachments\/(.+)$/.exec(u);
    if (m) return descargaCaida ? new Response('boom', { status: 500 }) : new Response(JSON.stringify({ download_url: `https://dl.example.invalid/${m[1]}` }), { status: 200 });
    return new Response(xmlDe.get(u.split('/').pop()!) ?? '', { status: 200 });
  }));
});

describe('feliz: correo → bandeja → aprobación → export', () => {
  it('el XML del proveedor aterriza pendiente con receptor validado y estatus SAT; aprobado sale en el layout SAP B1 y se marca una sola vez', async () => {
    const r = await webhook('em_1', [{ id: 'a1', filename: 'factura.xml', contenido: cfdi(U1, '1160.00') }]);
    expect(await r.json()).toMatchObject({ ok: true, guardadas: 1 });
    const bandeja = await listarFacturasProveedor(A);
    expect(bandeja).toHaveLength(1);
    expect(bandeja[0]).toMatchObject({ cfdiUuid: U1.toLowerCase(), total: 1160, estado: 'pendiente', receptorEsFlota: true, origen: 'correo', estadoSat: 'vigente' });

    expect(await decidirFacturaProveedor(A, bandeja[0].id, 'aprobada', 'contador@ejemplo.invalid')).toEqual({});
    const exp = await exportarAprobadas(A, 'sap_b1');
    expect(exp.filas).toHaveLength(1);
    expect(JSON.stringify(exp.filas[0])).toContain(U1.toLowerCase());
    expect(await marcarExportadas(A, exp.ids)).toMatchObject({ marcadas: 1 });
    expect(await marcarExportadas(A, exp.ids)).toMatchObject({ marcadas: 0 }); // la fecha del PRIMER export no se repisa
  });

  it('una factura a nombre de OTRO RFC entra marcada receptorEsFlota=false (no se acusa ni se descarta)', async () => {
    await webhook('em_2', [{ id: 'a2', filename: 'f.xml', contenido: cfdi(U2, '580.00', 'CCC030303CCC') }]);
    expect((await listarFacturasProveedor(A))[0]).toMatchObject({ receptorEsFlota: false, estado: 'pendiente' });
  });
});

describe('fallo', () => {
  it('firma ausente: 401 y no se toca ninguna base', async () => {
    const r = await webhook('em_x', [{ id: 'ax', filename: 'f.xml', contenido: cfdi(U1, '100.00') }], TOK_A, { firmar: false });
    expect(r.status).toBe(401);
    expect(db.tablas.factura_proveedor).toHaveLength(0);
  });

  it('agente apagado: 503 para que Resend reintente, y al encenderlo el MISMO correo entra', async () => {
    apagado = true;
    expect((await webhook('em_3', [{ id: 'a3', filename: 'f.xml', contenido: cfdi(U1, '100.00') }])).status).toBe(503);
    apagado = false;
    expect(await (await webhook('em_3', [{ id: 'a3', filename: 'f.xml', contenido: cfdi(U1, '100.00') }])).json()).toMatchObject({ guardadas: 1 });
  });

  it('la descarga del adjunto falla: 503, el claim se LIBERA y el reintento de Resend sí lo procesa', async () => {
    descargaCaida = true;
    expect((await webhook('em_4', [{ id: 'a4', filename: 'f.xml', contenido: cfdi(U1, '100.00') }])).status).toBe(503);
    expect(correos.has('em_4')).toBe(false);
    descargaCaida = false;
    expect(await (await webhook('em_4', [{ id: 'a4', filename: 'f.xml', contenido: cfdi(U1, '100.00') }])).json()).toMatchObject({ guardadas: 1 });
  });

  it('un adjunto que no es CFDI se ignora sin tumbar al resto del correo', async () => {
    const r = await webhook('em_5', [{ id: 'a5', filename: 'basura.xml', contenido: '<html>no soy un cfdi</html>' }, { id: 'a6', filename: 'ok.xml', contenido: cfdi(U1, '232.00') }]);
    expect(await r.json()).toMatchObject({ guardadas: 1, ignoradas: 1 });
  });

  it('un buzón desconocido o un correo sin adjuntos procesables no guarda nada y no acusa error', async () => {
    expect(await (await webhook('em_6', [{ id: 'a7', filename: 'f.xml', contenido: cfdi(U1, '100.00') }], 'zzzzzzzzzzzzzzzzzzzzzzzz')).json()).toMatchObject({ ignorado: expect.stringMatching(/buzon/) });
    expect(await (await webhook('em_7', [{ id: 'a8', filename: 'foto.png', contenido: '' }])).json()).toMatchObject({ ignorado: 'sin_adjuntos' });
    expect(db.tablas.factura_proveedor).toHaveLength(0);
  });
});

describe('duplicado', () => {
  it('Resend reentrega el MISMO correo: no se guarda dos veces (claim aplicado)', async () => {
    const adj = [{ id: 'a1', filename: 'f.xml', contenido: cfdi(U1, '1160.00') }];
    await webhook('em_8', adj);
    expect(await (await webhook('em_8', adj)).json()).toMatchObject({ ignorado: 'ya_procesado' });
    expect(db.tablas.factura_proveedor).toHaveLength(1);
  });

  it('el proveedor manda la MISMA factura en OTRO correo: el unique (flota, UUID) lo cuenta como duplicada, nunca dos filas', async () => {
    await webhook('em_9', [{ id: 'a1', filename: 'f.xml', contenido: cfdi(U1, '1160.00') }]);
    const r = await webhook('em_10', [{ id: 'a2', filename: 'reenvio.xml', contenido: cfdi(U1, '1160.00') }]);
    expect(await r.json()).toMatchObject({ guardadas: 0, duplicadas: 1, ignoradas: 0 });
    expect(db.tablas.factura_proveedor).toHaveLength(1);
  });

  it('dos clics de «Aprobar»/«Rechazar» sobre la misma factura: gana el primero y el segundo se entera', async () => {
    await webhook('em_11', [{ id: 'a1', filename: 'f.xml', contenido: cfdi(U1, '100.00') }]);
    const id = (await listarFacturasProveedor(A))[0].id;
    expect(await decidirFacturaProveedor(A, id, 'aprobada', 'u1')).toEqual({});
    expect(await decidirFacturaProveedor(A, id, 'rechazada', 'u2')).toMatchObject({ error: expect.stringMatching(/ya no está pendiente/) });
    expect((await listarFacturasProveedor(A))[0]).toMatchObject({ estado: 'aprobada', decididoPor: 'u1' });
  });
});

describe('fuera de orden', () => {
  it('el correo trae el PDF primero y el XML después: solo el XML cuenta (el PDF de relleno no es un PDF válido y el buzón lo rechaza), sin importar el orden de los adjuntos', async () => {
    const r = await webhook('em_12', [{ id: 'p1', filename: 'factura.pdf', contenido: '%PDF-1.4 sintetico' }, { id: 'x1', filename: 'factura.xml', contenido: cfdi(U1, '100.00') }]);
    // Desde la ingesta de PDF (0530) un PDF que no lo es se RECHAZA (antes se ignoraba): lo que importa es que la factura entra una vez.
    expect(await r.json()).toMatchObject({ guardadas: 1, rechazadas: 1, ignoradas: 0 });
    expect(db.tablas.factura_proveedor).toHaveLength(1);
  });

  it('exportar ANTES de aprobar no incluye la pendiente; aprobar después y re-exportar la incluye; una rechazada nunca sale', async () => {
    await webhook('em_13', [{ id: 'a1', filename: 'a.xml', contenido: cfdi(U1, '100.00') }]);
    await webhook('em_14', [{ id: 'a2', filename: 'b.xml', contenido: cfdi(U2, '200.00') }]);
    expect((await exportarAprobadas(A, 'contpaqi')).filas).toHaveLength(0);
    const [f2, f1] = await listarFacturasProveedor(A);
    await decidirFacturaProveedor(A, f1.id, 'aprobada', 'u'); await decidirFacturaProveedor(A, f2.id, 'rechazada', 'u');
    const exp = await exportarAprobadas(A, 'contpaqi');
    expect(exp.ids).toEqual([f1.id]);
  });

  it('una aprobada ya exportada se puede volver a pedir (el archivo se pierde) y conserva su marca', async () => {
    await webhook('em_15', [{ id: 'a1', filename: 'a.xml', contenido: cfdi(U1, '100.00') }]);
    const f = (await listarFacturasProveedor(A))[0];
    await decidirFacturaProveedor(A, f.id, 'aprobada', 'u');
    const e1 = await exportarAprobadas(A, 'generico'); await marcarExportadas(A, e1.ids);
    const marca = db.tablas.factura_proveedor[0].exportada_en;
    expect(marca).not.toBeNull();                                   // la marca de exportada quedó puesta
    const e2 = await exportarAprobadas(A, 'generico');
    expect(e2.filas).toHaveLength(1);
    expect(e2.ids).toEqual(e1.ids);
    expect(db.tablas.factura_proveedor[0].exportada_en).toBe(marca); // y volver a pedir el archivo no la mueve
  });
});

describe('otro tenant', () => {
  it('cada buzón es de SU flota; el mismo UUID en dos flotas son dos facturas, y la bandeja de una no ve la de la otra', async () => {
    await webhook('em_16', [{ id: 'a1', filename: 'a.xml', contenido: cfdi(U1, '100.00') }], TOK_A);
    await webhook('em_17', [{ id: 'a2', filename: 'a.xml', contenido: cfdi(U1, '100.00', 'BBB020202BBB') }], TOK_B);
    expect(db.tablas.factura_proveedor).toHaveLength(2);
    expect((await listarFacturasProveedor(A))).toHaveLength(1);
    expect((await listarFacturasProveedor(B))[0]).toMatchObject({ receptorEsFlota: true }); // el RFC se compara con el de SU flota
  });

  it('la flota B no puede decidir ni exportar la factura de la A', async () => {
    await webhook('em_18', [{ id: 'a1', filename: 'a.xml', contenido: cfdi(U1, '100.00') }], TOK_A);
    const idA = (await listarFacturasProveedor(A))[0].id;
    expect(await decidirFacturaProveedor(B, idA, 'aprobada', 'intruso')).toMatchObject({ error: expect.any(String) });
    expect((await exportarAprobadas(B, 'sap_b1')).filas).toHaveLength(0);
    expect((await listarFacturasProveedor(A))[0].estado).toBe('pendiente');
  });
});

// PDF solo, zip y pareja XML+PDF con rastro y marca de revisión (0530): `buzon/ingesta_e2e.test.ts`.
// Entrega al contador (0531: CSV+ZIP, reserva atómica, rebote libera, backoff, cron): `buzon/entrega_e2e.test.ts`;
// el cron en sí: `src/app/api/cron/buzon-entrega/route.test.ts`.
