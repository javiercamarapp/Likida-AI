import { describe, it, expect } from 'vitest';
import { armarLote, enviarLote, procesarEntregas, type DepsEntrega } from './entrega';
import { leerZipSeguro } from './zip_seguro';
import { CONFIG_ENTREGA_DEFAULT, MAX_INTENTOS, type ConfigEntrega } from './entrega_pura';
import type { Entrega, EstadoEntrega, EventoEntrega, FacturaDeLote } from './entrega_repo';
import type { FacturaProveedor } from '../proveedores';
import type { ResultadoEnvio } from '@/lib/correo/enviar';

// ═══════════════════════════════════════════════════════════════════════════
// E2E de la ENTREGA AL CONTADOR (Agente 9, criterio a–i): de las facturas aprobadas
// al correo con su CSV y su ZIP, con una base en memoria que respeta lo que la 0531
// garantiza (reserva atómica por `entrega_id is null`, claim optimista por `intentos`)
// y un doble de Resend que acepta, falla o se cae. Nada sale a la red.
// ═══════════════════════════════════════════════════════════════════════════

const T = 'flota-1';
const factura = (n: number, extra: Partial<FacturaProveedor> = {}): FacturaProveedor => ({
  id: `f${n}`, cfdiUuid: `aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee0${n}`, emisorRfc: 'AAA010101AAA', emisorNombre: 'Taller', receptorRfc: 'BBB010101BBB',
  receptorEsFlota: true, fecha: '2026-09-30', subTotal: 1000, iva: 160, total: 1160, descripcion: 'Refacciones', conceptos: 1,
  estado: 'aprobada', decididoPor: 'ana', decididoEn: '2026-10-01T10:00:00Z', creadoEn: `2026-10-01T10:0${n}:00Z`, origen: 'correo',
  ocrConfianza: null, estadoSat: 'vigente', exportadaEn: null, requiereRevision: false, revisionMotivo: null, fuenteDatos: 'xml',
  tienePdf: false, entregaId: null, entregadaEn: null, ...extra,
});
const xmlDe = (f: FacturaProveedor) => `<cfdi:Comprobante UUID="${f.cfdiUuid}"/>`;

interface Fila { f: FacturaProveedor; xml: string | null; pdf: string | null }

function mundo(opciones: { config?: Partial<ConfigEntrega>; facturas?: Fila[] } = {}) {
  const config: ConfigEntrega = { ...CONFIG_ENTREGA_DEFAULT, activo: true, destinatarios: ['conta@x.mx'], ...opciones.config };
  const filas: Fila[] = opciones.facturas ?? [1, 2, 3].map((n) => ({ f: factura(n), xml: xmlDe(factura(n)), pdf: n === 1 ? `${T}/p1.pdf` : null }));
  const lotes: Entrega[] = [];
  const eventos: Array<{ id: string; evento: EventoEntrega; detalle?: string }> = [];
  const correos: Array<{ para: string[]; asunto: string; parrafos: string[]; llave: string; adjuntos: Array<{ filename: string; content: string }> }> = [];
  let ahora = new Date('2026-10-02T14:00:00Z');
  let resend: Array<ResultadoEnvio> = [];
  let n = 0;

  const repo: DepsEntrega['repo'] = {
    leerConfigEntrega: async () => ({ config, disponible: true }),
    flotasConEntregaAutomatica: async () => (config.activo && config.automatica ? [{ tenantId: T, config }] : []),
    ultimoLoteAutomaticoEn: async () => lotes.filter((l) => l.disparo === 'automatica' && l.estado !== 'cancelada').map((l) => l.creadoEn).sort().at(-1) ?? null,
    facturasSinEntregar: async (_t, lim) => filas.filter((x) => x.f.estado === 'aprobada' && x.f.entregaId === null).slice(0, lim).map((x) => x.f),
    crearLote: async (_t, l) => {
      const id = `L${++n}`;
      lotes.push({ id, tenantId: T, creadoEn: ahora.toISOString(), creadoPor: l.creadoPor, disparo: l.disparo, estado: 'pendiente', formato: l.formato,
        incluyeZip: l.incluyeZip, destinatarios: l.destinatarios, nFacturas: l.nFacturas, total: l.total, intentos: 0, proximoIntentoEn: ahora.toISOString(),
        leaseHasta: null, resendId: null, enviadaEn: null, entregadaEn: null, error: null });
      return id;
    },
    reservarFacturas: async (_t, id, ids) => {
      const mias: string[] = [];
      for (const x of filas) if (ids.includes(x.f.id) && x.f.entregaId === null && x.f.estado === 'aprobada') { x.f.entregaId = id; mias.push(x.f.id); }
      return mias;
    },
    ajustarLote: async (_t, id, nf, total) => { const l = lotes.find((x) => x.id === id)!; l.nFacturas = nf; l.total = total; },
    borrarLote: async (_t, id) => { lotes.splice(lotes.findIndex((x) => x.id === id), 1); },
    lotesParaEnviar: async (a) => lotes.filter((l) => (l.estado === 'pendiente' && new Date(l.proximoIntentoEn) <= a) || (l.estado === 'enviando' && new Date(l.leaseHasta!) < a)).map((l) => ({ ...l })),
    reclamarLote: async (l, a) => {
      const real = lotes.find((x) => x.id === l.id)!;
      if (real.intentos !== l.intentos || real.estado !== l.estado) return null; // optimista
      real.estado = 'enviando'; real.intentos++; real.leaseHasta = new Date(a.getTime() + 300_000).toISOString();
      return { ...real };
    },
    facturasDelLote: async (_t, id): Promise<FacturaDeLote[]> => filas.filter((x) => x.f.entregaId === id).map((x) => ({ factura: x.f, xmlCrudo: x.xml, pdfRuta: x.pdf })),
    marcarEnviada: async (_t, id, rid, a) => {
      const l = lotes.find((x) => x.id === id)!; l.estado = 'enviada'; l.resendId = rid; l.enviadaEn = a.toISOString(); l.leaseHasta = null;
      filas.filter((x) => x.f.entregaId === id).forEach((x) => { x.f.entregadaEn = a.toISOString(); });
    },
    marcarFallo: async (_t, id, estado: 'pendiente' | 'fallida', prox, msg) => {
      const l = lotes.find((x) => x.id === id)!; l.estado = estado as EstadoEntrega; l.leaseHasta = null; l.error = msg; if (prox) l.proximoIntentoEn = prox.toISOString();
    },
    anotarEvento: async (_t, id, evento, detalle) => { eventos.push({ id, evento, detalle }); },
    marcarRetrasos: async () => 0,
  };

  const deps: DepsEntrega = {
    repo,
    enviarCorreo: async (para, correo, op) => {
      correos.push({ para, asunto: correo.asunto, parrafos: correo.parrafos, llave: op.idempotencyKey, adjuntos: op.adjuntos });
      return resend.shift() ?? { ok: true, id: `re_${correos.length}` };
    },
    descargarPdf: async (ruta) => new Uint8Array(Buffer.from(`%PDF-1.4 ${ruta}`)),
    nombreFlota: async () => 'Cliente demo',
    ahora: () => ahora,
  };
  return { deps, filas, lotes, eventos, correos, config, avanzar: (ms: number) => { ahora = new Date(ahora.getTime() + ms); }, resend: (...r: ResultadoEnvio[]) => { resend = r; } };
}

describe('E2E entrega al contador — del lote al correo', () => {
  it('arma, envía con CSV + ZIP (XML y PDF) y deja el rastro: enviada, facturas marcadas, evento por paso', async () => {
    const m = mundo();
    const a = await armarLote(m.deps, T, 'manual', 'ana');
    expect(a).toMatchObject({ armado: true, nFacturas: 3, total: 3480 });
    const r = await enviarLote(m.deps, m.lotes[0]);
    expect(r.estado).toBe('enviada');
    expect(m.correos).toHaveLength(1);
    expect(m.correos[0].para).toEqual(['conta@x.mx']);
    expect(m.correos[0].llave).toBe('buzon-entrega-L1');
    const [csv, zip] = m.correos[0].adjuntos;
    expect(Buffer.from(csv.content, 'base64').toString()).toContain('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee01');
    const z = leerZipSeguro(new Uint8Array(Buffer.from(zip.content, 'base64')));
    expect(z.rechazado).toBeNull();
    expect(z.entradas.map((e) => e.nombre).sort()).toEqual([
      'AAA010101AAA_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee01.pdf', 'AAA010101AAA_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee01.xml',
      'AAA010101AAA_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee02.xml', 'AAA010101AAA_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee03.xml',
    ]);
    expect(m.lotes[0]).toMatchObject({ estado: 'enviada', resendId: 're_1' });
    expect(m.filas.every((x) => x.f.entregadaEn !== null)).toBe(true);
    expect(m.eventos.map((e) => e.evento)).toEqual(['creada', 'intento', 'enviada']);
  });

  it('una factura NUNCA viaja en dos lotes: el segundo armado no encuentra nada que reservar', async () => {
    const m = mundo();
    await armarLote(m.deps, T, 'manual', null);
    expect(await armarLote(m.deps, T, 'manual', null)).toEqual({ armado: false, motivo: 'sin_facturas' });
    expect(m.lotes).toHaveLength(1);
  });

  it('carrera de armado: otra corrida se lleva TODAS entre la lectura y la reserva → el lote vacío no existe', async () => {
    const m = mundo();
    const reservar = m.deps.repo.reservarFacturas;
    m.deps.repo.reservarFacturas = async (...args) => { m.filas.forEach((x) => { x.f.entregaId = 'OTRO'; }); return reservar(...args); };
    expect(await armarLote(m.deps, T, 'manual', null)).toEqual({ armado: false, motivo: 'carrera' });
    expect(m.lotes).toHaveLength(0);
  });

  it('dos corridas solapadas sobre el MISMO lote: gana una (claim), el correo sale UNA vez', async () => {
    const m = mundo();
    await armarLote(m.deps, T, 'manual', null);
    const copia = { ...m.lotes[0] };
    const [a, b] = await Promise.all([enviarLote(m.deps, { ...copia }), enviarLote(m.deps, { ...copia })]);
    expect([a.estado, b.estado].sort()).toEqual(['enviada', 'no_tomado']);
    expect(m.correos).toHaveLength(1);
  });

  it('Resend cae: reprograma con backoff (15 min, 1 h…), reintenta con la MISMA llave y al fin queda enviada', async () => {
    const m = mundo();
    m.resend({ ok: false, motivo: 'red', detalle: 'timeout' });
    await armarLote(m.deps, T, 'manual', null);
    let pasada = await procesarEntregas(m.deps);
    expect(pasada).toMatchObject({ enviados: 0, reprogramados: 1 });
    expect(m.lotes[0].estado).toBe('pendiente');
    // todavía no vence
    expect((await procesarEntregas(m.deps)).enviados).toBe(0);
    m.avanzar(16 * 60_000);
    pasada = await procesarEntregas(m.deps);
    expect(pasada.enviados).toBe(1);
    expect(m.correos.map((c) => c.llave)).toEqual(['buzon-entrega-L1', 'buzon-entrega-L1']);
    expect(m.eventos.map((e) => e.evento)).toEqual(['creada', 'intento', 'fallo', 'reintento_programado', 'intento', 'enviada']);
  });

  it('agota los intentos: queda FALLIDA a la vista (con el motivo) y deja de reintentarse sola', async () => {
    const m = mundo();
    m.resend(...Array.from({ length: MAX_INTENTOS }, () => ({ ok: false, motivo: 'rechazado', detalle: 'HTTP 422' }) as ResultadoEnvio));
    await armarLote(m.deps, T, 'manual', null);
    for (let i = 0; i < MAX_INTENTOS; i++) { await procesarEntregas(m.deps); m.avanzar(13 * 3_600_000); }
    expect(m.lotes[0]).toMatchObject({ estado: 'fallida', intentos: MAX_INTENTOS });
    expect(m.lotes[0].error).toMatch(/422/);
    const antes = m.correos.length;
    await procesarEntregas(m.deps);
    expect(m.correos).toHaveLength(antes);
  });

  it('un PDF que no baja no tumba el lote: el XML sí viaja y el correo lo dice', async () => {
    const m = mundo();
    m.deps.descargarPdf = async () => { throw new Error('storage caído'); };
    await armarLote(m.deps, T, 'manual', null);
    expect((await enviarLote(m.deps, m.lotes[0])).estado).toBe('enviada');
    const z = leerZipSeguro(new Uint8Array(Buffer.from(m.correos[0].adjuntos[1].content, 'base64')));
    expect(z.entradas.every((e) => e.nombre.endsWith('.xml'))).toBe(true);
    expect(m.correos[0].parrafos.join(' ')).toMatch(/1 PDF no se pudieron adjuntar/);
  });

  it('una factura leída de PDF (sin XML) viaja, y el correo AVISA que sus cifras no son del CFDI', async () => {
    const f = factura(1, { fuenteDatos: 'pdf_vision' });
    const m = mundo({ facturas: [{ f, xml: null, pdf: `${T}/p1.pdf` }] });
    await armarLote(m.deps, T, 'manual', null);
    await enviarLote(m.deps, m.lotes[0]);
    expect(m.correos).toHaveLength(1);
    expect(m.correos[0].parrafos.join(' ')).toMatch(/no tiene XML/);
  });
});

describe('E2E entrega al contador — el cron automático', () => {
  it('lote automático: una vez al día a su hora, respeta el mínimo y no repite aunque el cron corra cada 15 min', async () => {
    const m = mundo({ config: { automatica: true, horaEnvio: 8, minFacturas: 3 } });
    m.avanzar(-30 * 60_000); // 07:30 México
    expect(await procesarEntregas(m.deps)).toMatchObject({ armados: 0, enviados: 0 });
    m.avanzar(31 * 60_000); // 08:01
    expect(await procesarEntregas(m.deps)).toMatchObject({ armados: 1, enviados: 1 });
    m.avanzar(15 * 60_000);
    expect(await procesarEntregas(m.deps)).toMatchObject({ armados: 0, enviados: 0 });
    expect(m.correos).toHaveLength(1);
  });

  it('bajo el mínimo no sale lote automático (no un correo por factura)', async () => {
    const m = mundo({ config: { automatica: true, horaEnvio: 8, minFacturas: 5 } });
    expect(await procesarEntregas(m.deps)).toMatchObject({ armados: 0 });
    expect(m.lotes).toHaveLength(0);
  });

  it('flota apagada o sin destinatarios: no arma nada (la aprobación humana sigue siendo lo único que mueve facturas)', async () => {
    expect(await armarLote(mundo({ config: { activo: false } }).deps, T, 'manual', null)).toEqual({ armado: false, motivo: 'apagada' });
    expect(await armarLote(mundo({ config: { destinatarios: [] } }).deps, T, 'manual', null)).toEqual({ armado: false, motivo: 'sin_destinatarios' });
  });

  it('solo viaja lo APROBADO: lo pendiente o rechazado no se reserva', async () => {
    const m = mundo({ facturas: [
      { f: factura(1, { estado: 'pendiente' }), xml: '<x/>', pdf: null }, { f: factura(2, { estado: 'rechazada' }), xml: '<x/>', pdf: null }, { f: factura(3), xml: '<x/>', pdf: null },
    ] });
    expect(await armarLote(m.deps, T, 'manual', null)).toMatchObject({ armado: true, nFacturas: 1 });
  });

  it('el reloj corta la pasada: lo que no cupo queda pendiente para la siguiente (no se pierde)', async () => {
    const m = mundo();
    await armarLote(m.deps, T, 'manual', null);
    const r = await procesarEntregas(m.deps, { vencePorReloj: m.deps.ahora().getTime() - 1 });
    expect(r.enviados).toBe(0);
    expect(m.lotes[0].estado).toBe('pendiente');
  });
});
