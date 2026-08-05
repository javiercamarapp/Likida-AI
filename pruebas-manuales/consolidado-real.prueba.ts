// ═══════════════════════════════════════════════════════════════════════════
// ARNÉS MANUAL — el CFDI CONSOLIDADO contra la BASE REAL (auditoría 10).
//
// `intake/consolidado.test.ts` y `intake/cfdi_xml.test.ts` cubren la lógica
// pura (el parser, el JOIN) con Supabase mockeado. Lo que NO pueden ver es el
// viaje redondo real: escribir `cfdi_xml` y `cfdi_consolidado_linea`, leer
// `gasto` con los nombres de columna reales, actualizar `cfdi_uuid`/
// `cfdi_orden` (mig. 0065) sin chocar con el índice único, y que la
// idempotencia (reenviar el MISMO XML) no duplique nada.
//
// Usa un CFDI ECC12 real en estructura (verificado contra el XSD oficial del
// SAT el 5-ago-2026 — mismo fixture que `cfdi_xml.test.ts`), con 3 líneas:
// dos concilian solas contra tickets ya "capturados" (sembrados aquí), una
// se deja a propósito SIN gasto que la reciba, para probar que la cola de
// "por conciliar" funciona contra Postgres y no solo contra un mock.
//
// NO entra en `npm test`: crea filas reales (tenant `ZZZ PRUEBA...`) y se
// limpia sola al final — el `finally` barre aunque una aserción truene.
//
// USO
//   npx vitest run --config pruebas-manuales/vitest.config.ts pruebas-manuales/consolidado-real.prueba.ts
// ═══════════════════════════════════════════════════════════════════════════

import { test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

function cargarEnv(ruta: string): void {
  if (!existsSync(ruta)) return;
  for (const linea of readFileSync(ruta, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(linea);
    if (!m) continue;
    const valor = m[2].trim().replace(/^["']|["']$/g, '');
    if (valor && !process.env[m[1]]) process.env[m[1]] = valor;
  }
}

const UUID_PRUEBA = randomUUID();

// Mismo fixture que `cfdi_xml.test.ts`, estructura ECC12 verificada contra el
// XSD oficial (ecc12.xsd) — 3 cargas de diésel de un monedero, días distintos.
const consolidadoXml = (uuid: string) => `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" TipoDeComprobante="I" Fecha="2026-04-30T23:59:00" Total="3300.00" SubTotal="2844.83">
  <cfdi:Emisor Rfc="edn010101aa1"/>
  <cfdi:Receptor Rfc="tin950101abc"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="84111506" ClaveUnidad="ACT" Cantidad="1" Importe="2844.83" Descripcion="Consumo de combustibles del periodo"/>
  </cfdi:Conceptos>
  <cfdi:Complemento>
    <ecc12:EstadoDeCuentaCombustible xmlns:ecc12="http://www.sat.gob.mx/ecc12" Version="1.2" TipoOperacion="Tarjeta" NumeroDeCuenta="0009182736" SubTotal="2844.83" Total="3300.00">
      <ecc12:Conceptos>
        <ecc12:ConceptoEstadoDeCuentaCombustible Identificador="1" Fecha="2026-04-03T09:12:00" Rfc="EST010101AAA" ClaveEstacion="4521" Cantidad="120.500" TipoCombustible="Diesel" Unidad="LT" NombreCombustible="Diesel" FolioOperacion="OP-100234" ValorUnitario="24.10" Importe="2904.05"/>
        <ecc12:ConceptoEstadoDeCuentaCombustible Identificador="2" Fecha="2026-04-11T18:47:00" Rfc="EST020202BBB" ClaveEstacion="7710" Cantidad="95.000" TipoCombustible="Diesel" Unidad="LT" NombreCombustible="Diesel" FolioOperacion="OP-100511" ValorUnitario="24.30" Importe="2308.50"/>
        <ecc12:ConceptoEstadoDeCuentaCombustible Identificador="3" Fecha="2026-04-22T07:03:00" Rfc="EST010101AAA" ClaveEstacion="4521" Cantidad="110.000" TipoCombustible="Diesel" Unidad="LT" NombreCombustible="Diesel" FolioOperacion="OP-100822" ValorUnitario="24.15" Importe="2656.50"/>
      </ecc12:Conceptos>
    </ecc12:EstadoDeCuentaCombustible>
    <tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" UUID="${uuid}"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;

test('consolidado ECC12: parsea, liga 2 de 3 contra gasto real y deja 1 en la cola — contra Postgres, no un mock', async () => {
  cargarEnv(resolve('.env.local'));
  expect(process.env.SUPABASE_SERVICE_ROLE_KEY, 'falta SUPABASE_SERVICE_ROLE_KEY').toBeTruthy();

  const { parseCfdiXml, esConsolidado } = await import('@/lib/cuadra/intake/cfdi_xml');
  const { guardarYConciliarConsolidado } = await import('@/lib/cuadra/intake/consolidado');
  const { supabaseAdmin } = await import('@/lib/supabase/admin');

  const admin = supabaseAdmin();
  let tenantId: string | undefined;
  try {
    const { data: tenant, error: errT } = await admin.from('tenant')
      .insert({ nombre: `ZZZ PRUEBA CONSOLIDADO ${UUID_PRUEBA}` }).select('id').single();
    expect(errT, errT?.message).toBeNull();
    tenantId = tenant!.id as string;

    const { data: op, error: errOp } = await admin.from('operador')
      .insert({ tenant_id: tenantId, nombre: 'ZZZ Op Prueba', telefono: `521999${Date.now() % 10_000_000}` })
      .select('id').single();
    expect(errOp, errOp?.message).toBeNull();

    const { data: viaje, error: errV } = await admin.from('viaje')
      .insert({ tenant_id: tenantId, operador_id: op!.id, estatus: 'en_cuadre' })
      .select('id').single();
    expect(errV, errV?.message).toBeNull();

    // Dos gastos YA CAPTURADOS (el operador fotografió el ticket antes de que
    // llegara el consolidado) que deben conciliar SOLOS: mismo monto, misma
    // fecha que dos de las tres líneas del ECC12. El tercero —Importe
    // 2656.50, 22-abr— NO se siembra: tiene que quedar en la cola.
    const { error: errG } = await admin.from('gasto').insert([
      { tenant_id: tenantId, viaje_id: viaje!.id, concepto: 'diesel', monto: 2904.05, fecha: '2026-04-03' },
      { tenant_id: tenantId, viaje_id: viaje!.id, concepto: 'diesel', monto: 2308.50, fecha: '2026-04-11' },
    ]);
    expect(errG, errG?.message).toBeNull();

    // ── El parser real, sobre el XML real ──────────────────────────────────
    const xml = parseCfdiXml(consolidadoXml(UUID_PRUEBA));
    expect(xml).not.toBeNull();
    expect(xml!.uuid).toBe(UUID_PRUEBA.toLowerCase());
    expect(esConsolidado(xml!)).toBe(true);
    expect(xml!.lineas).toHaveLength(3);

    // ── El JOIN real, contra Postgres ──────────────────────────────────────
    const resumen = await guardarYConciliarConsolidado(tenantId, xml!, consolidadoXml(UUID_PRUEBA));
    expect(resumen.totalLineas).toBe(3);
    expect(resumen.conciliadas).toBe(2);
    expect(resumen.porConciliar).toBe(1);

    // ── Lo que quedó escrito en `gasto`: cfdi_uuid + cfdi_orden reales ─────
    const { data: gastosLigados } = await admin.from('gasto')
      .select('monto, cfdi_uuid, cfdi_orden').eq('tenant_id', tenantId).order('monto');
    const ligado1 = gastosLigados!.find((g) => Number(g.monto) === 2308.5);
    const ligado2 = gastosLigados!.find((g) => Number(g.monto) === 2904.05);
    expect(ligado1?.cfdi_uuid).toBe(UUID_PRUEBA.toLowerCase());
    expect(ligado1?.cfdi_orden).toBe(2); // segunda línea del XML
    expect(ligado2?.cfdi_uuid).toBe(UUID_PRUEBA.toLowerCase());
    expect(ligado2?.cfdi_orden).toBe(1); // primera línea del XML

    // ── La cola: la línea 3 (2656.50, 22-abr) sin gasto que la reciba ──────
    const { data: lineas } = await admin.from('cfdi_consolidado_linea')
      .select('indice, monto, estatus, fecha, estacion_rfc, folio_operacion')
      .eq('tenant_id', tenantId).order('indice');
    expect(lineas).toHaveLength(3);
    expect(lineas!.map((l) => l.estatus)).toEqual(['conciliada', 'conciliada', 'por_conciliar']);
    expect(Number(lineas![2].monto)).toBe(2656.5);
    expect(lineas![2].fecha).toBe('2026-04-22');
    expect(lineas![0].estacion_rfc).toBe('EST010101AAA'); // la gasolinera real, no el monedero
    expect(lineas![0].folio_operacion).toBe('OP-100234');

    // ── IDEMPOTENCIA: reenviar el MISMO XML no duplica nada ────────────────
    const resumen2 = await guardarYConciliarConsolidado(tenantId, xml!, consolidadoXml(UUID_PRUEBA));
    expect(resumen2).toEqual(resumen);
    const { data: lineasTrasReenvio } = await admin.from('cfdi_consolidado_linea')
      .select('id').eq('tenant_id', tenantId);
    expect(lineasTrasReenvio).toHaveLength(3); // no 6

    console.log(`\n✅ consolidado real: ${resumen.conciliadas}/${resumen.totalLineas} conciliadas, ` +
      `${resumen.porConciliar} en cola — reenvío idempotente confirmado.\n`);
  } finally {
    if (tenantId) await admin.from('tenant').delete().eq('id', tenantId);
  }
});
