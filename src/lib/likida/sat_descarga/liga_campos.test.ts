import { describe, it, expect, vi, beforeEach } from 'vitest';

// Auditoría 35, R04-fiscal-01: la liga del SAT debe copiar los campos fiscales
// del XML (como `updateGastoCfdiXml`) y tolerar que la migración 0858 aún no
// esté aplicada. Base FALSA: lo que se prueba es el armado de los campos, el
// cableado y el respaldo; que la base los copie y redondee lo prueba
// supabase/tests/0858_ligar_cfdi_sat_copia_campos.sql contra Postgres real.

interface Llamada { nombre: string; args: Record<string, unknown> }
const rpcs: Llamada[] = [];
const updates: Array<Record<string, unknown>> = [];
let respuestaRpc: { data: unknown; error: unknown } = { data: null, error: null };
let respuestaUpdate: { data: unknown; error: unknown } = { data: [{ id: 'g-1' }], error: null };

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: <T,>(q: T) => q }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (nombre: string, args: Record<string, unknown>) => {
      rpcs.push({ nombre, args });
      return Promise.resolve(respuestaRpc);
    },
    from: () => {
      const b: Record<string, unknown> = {};
      b.update = (v: Record<string, unknown>) => { updates.push(v); return b; };
      for (const op of ['eq', 'is', 'select']) b[op] = () => b;
      b.then = (ok: (v: unknown) => unknown) => Promise.resolve(respuestaUpdate).then(ok);
      return b;
    },
  }),
}));

const { camposFiscalesDeXml, ligarGastoAutomatico, esFuncionAusente } = await import('./liga_campos');

const TENANT = '11111111-1111-1111-1111-111111111111';
const UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';

function xmlCfdi(o: {
  uuid?: string | null; tipo?: string; total?: string | null; subTotal?: string | null; descuento?: string;
  iva?: string[]; retIva?: string; forma?: string; moneda?: string; claveUnidad?: string; cantidad?: string;
  emisor?: string; receptor?: string;
} = {}): string {
  const uuid = o.uuid === undefined ? UUID.toUpperCase() : o.uuid;
  const attr = (k: string, v: string | null | undefined) => (v == null ? '' : ` ${k}="${v}"`);
  const traslados = (o.iva ?? []).map((i) => `<cfdi:Traslado Base="1" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="${i}"/>`).join('');
  const ret = o.retIva ? `<cfdi:Retenciones><cfdi:Retencion Impuesto="002" Importe="${o.retIva}"/></cfdi:Retenciones>` : '';
  return `<?xml version="1.0"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" TipoDeComprobante="${o.tipo ?? 'I'}"${attr('Total', o.total === undefined ? '1160.00' : o.total)}${attr('SubTotal', o.subTotal === undefined ? '1000.00' : o.subTotal)}${attr('Descuento', o.descuento)}${attr('FormaPago', o.forma)}${attr('Moneda', o.moneda)} Fecha="2026-10-01T10:15:00">
<cfdi:Emisor Rfc="${o.emisor ?? 'AAA010101AAA'}"/><cfdi:Receptor Rfc="${o.receptor ?? 'BBB020202BBB'}"/>
<cfdi:Conceptos><cfdi:Concepto ClaveProdServ="78101800" ClaveUnidad="${o.claveUnidad ?? 'E48'}"${attr('Cantidad', o.cantidad ?? '1')} Importe="1000.00"/></cfdi:Conceptos>
<cfdi:Impuestos>${ret}<cfdi:Traslados>${traslados}</cfdi:Traslados></cfdi:Impuestos>
<cfdi:Complemento>${uuid ? `<tfd:TimbreFiscalDigital UUID="${uuid}"/>` : ''}</cfdi:Complemento></cfdi:Comprobante>`;
}

beforeEach(() => {
  rpcs.length = 0; updates.length = 0;
  respuestaRpc = { data: { ligado: true, campos_copiados: true, motivo: null }, error: null };
  respuestaUpdate = { data: [{ id: 'g-1' }], error: null };
});

describe('camposFiscalesDeXml — qué se copia y qué se niega', () => {
  it('copia los campos del XML con cifras sintéticas (centavos y redondeos)', () => {
    // Dos traslados de IVA que suman con ruido de coma flotante: 0.1 + 0.2.
    const r = camposFiscalesDeXml(xmlCfdi({
      total: '617.28', subTotal: '532.14', descuento: '0.285', iva: ['0.10', '0.20', '84.84'], retIva: '1.005',
      forma: '03', moneda: 'usd',
    }), UUID);
    expect(r.motivo).toBeNull();
    expect(r.campos).toMatchObject({
      uuid: UUID, total: 617.28, sub_total: 532.14, descuento: 0.285,
      iva_retenido: 1.005, forma_pago: '03', moneda: 'USD', rfc_emisor: 'AAA010101AAA', rfc_receptor: 'BBB020202BBB',
      clave_prod_serv: '78101800', clave_unidad: 'E48', tipo_comprobante: 'I',
    });
    // La suma 0.10 + 0.20 + 84.84 = 85.14 sale LIMPIA (sin 85.14000000000001).
    expect(r.campos!.iva_traslado).toBe(85.14);
    expect(r.campos!.complemento_hidrocarburos).toBe(false);
  });

  it('el caso de la auditoría: caseta de $1,160.00 trae subtotal 1,000.00 e IVA 160.00', () => {
    const r = camposFiscalesDeXml(xmlCfdi({ iva: ['160.00'] }), UUID);
    expect(r.campos).toMatchObject({ total: 1160, sub_total: 1000, iva_traslado: 160, rfc_receptor: 'BBB020202BBB' });
  });

  it('un campo opcional que el XML no trae NO viaja (queda NULL en la base)', () => {
    const r = camposFiscalesDeXml(xmlCfdi({ iva: ['160.00'] }), UUID);
    expect(r.campos).not.toHaveProperty('forma_pago');
    expect(r.campos).not.toHaveProperty('metodo_pago');
    expect(r.campos).not.toHaveProperty('moneda');
    expect(r.campos).not.toHaveProperty('descuento');
    expect(r.campos).not.toHaveProperty('tipo_cambio');
  });

  it('litros solo con ClaveUnidad LTR viajan como cantidad para el merge de ocr_extra', () => {
    const r = camposFiscalesDeXml(xmlCfdi({ claveUnidad: 'LTR', cantidad: '28.75', iva: ['160.00'] }), UUID);
    expect(r.campos).toMatchObject({ clave_unidad: 'LTR', cantidad: 28.75 });
  });

  it.each([
    ['sin XML', null, 'sin_xml'],
    ['vacío', '   ', 'sin_xml'],
    ['basura', 'esto no es un CFDI', 'xml_ilegible'],
    ['sin folio fiscal', xmlCfdi({ uuid: null }), 'sin_folio'],
    ['folio distinto', xmlCfdi({ uuid: 'cccccccc-bbbb-4ccc-8ddd-000000000009' }), 'folio_distinto'],
    ['nota de crédito', xmlCfdi({ tipo: 'E' }), 'nota_de_credito'],
    ['sin total', xmlCfdi({ total: null }), 'total_ilegible'],
    ['total en cero', xmlCfdi({ total: '0.00' }), 'total_ilegible'],
    ['sin subtotal', xmlCfdi({ subTotal: null }), 'sin_subtotal'],
  ])('%s: no se copia nada y se dice por qué', (_n, xml, motivo) => {
    const r = camposFiscalesDeXml(xml as string | null, UUID);
    expect(r.campos).toBeNull();
    expect(r.motivo).toBe(motivo);
  });
});

describe('esFuncionAusente', () => {
  it('reconoce PostgREST, Postgres y el texto, y no confunde otros errores', () => {
    expect(esFuncionAusente({ code: 'PGRST202', message: 'x' })).toBe(true);
    expect(esFuncionAusente({ code: '42883', message: 'x' })).toBe(true);
    expect(esFuncionAusente({ message: 'Could not find the function public.gasto_ligar_cfdi_campos' })).toBe(true);
    expect(esFuncionAusente({ code: 'CU001', message: 'viaje liquidado' })).toBe(false);
    expect(esFuncionAusente(null)).toBe(false);
  });
});

describe('ligarGastoAutomatico — con la migración 0858 aplicada', () => {
  it('manda los campos validados a gasto_ligar_cfdi_campos y reporta que se copiaron', async () => {
    const r = await ligarGastoAutomatico(TENANT, 'g-1', UUID, xmlCfdi({ iva: ['160.00'] }));
    expect(r).toEqual({ ligado: true, camposCopiados: true, motivo: null });
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].nombre).toBe('gasto_ligar_cfdi_campos');
    expect(rpcs[0].args).toMatchObject({ p_tenant: TENANT, p_gasto: 'g-1', p_cfdi_uuid: UUID });
    expect((rpcs[0].args.p_campos as Record<string, unknown>).iva_traslado).toBe(160);
    expect(updates).toEqual([]);
  });

  it('un XML que no pasa las guardas liga SIN campos (p_campos nulo) y lo dice', async () => {
    respuestaRpc = { data: { ligado: true, campos_copiados: false, motivo: 'sin_xml' }, error: null };
    const r = await ligarGastoAutomatico(TENANT, 'g-1', UUID, xmlCfdi({ tipo: 'E' }));
    expect(rpcs[0].args.p_campos).toBeNull();
    expect(r).toEqual({ ligado: true, camposCopiados: false, motivo: 'sin_xml' });
  });

  it('perder la carrera (el gasto ya tenía comprobante) no es éxito', async () => {
    respuestaRpc = { data: { ligado: false, campos_copiados: false, motivo: 'gasto_no_disponible' }, error: null };
    const r = await ligarGastoAutomatico(TENANT, 'g-1', UUID, xmlCfdi());
    expect(r.ligado).toBe(false);
  });

  it('un error cualquiera de la base no liga y NO cae al camino viejo', async () => {
    respuestaRpc = { data: null, error: { code: 'CU001', message: 'gasto_no_tras_liquidar' } };
    const r = await ligarGastoAutomatico(TENANT, 'g-1', UUID, xmlCfdi());
    expect(r.ligado).toBe(false);
    expect(updates).toEqual([]);
  });
});

describe('ligarGastoAutomatico — con la migración 0858 SIN aplicar', () => {
  beforeEach(() => {
    respuestaRpc = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.gasto_ligar_cfdi_campos' } };
  });

  it('cae al UPDATE de siempre (solo liga) y reporta que no se copiaron campos', async () => {
    const r = await ligarGastoAutomatico(TENANT, 'g-1', UUID, xmlCfdi());
    expect(r).toEqual({ ligado: true, camposCopiados: false, motivo: 'funcion_ausente' });
    expect(updates).toEqual([{ cfdi_uuid: UUID, cfdi_orden: 1, xml_verificado: true }]);
  });

  it('si la guardia optimista no afecta filas, devuelve false', async () => {
    respuestaUpdate = { data: [], error: null };
    const r = await ligarGastoAutomatico(TENANT, 'g-1', UUID, xmlCfdi());
    expect(r.ligado).toBe(false);
  });
});
