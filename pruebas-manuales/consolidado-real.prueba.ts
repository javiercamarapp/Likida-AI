// ═══════════════════════════════════════════════════════════════════════════
// ARNÉS MANUAL — el CFDI CONSOLIDADO contra la BASE REAL (auditoría 10).
//
// `intake/consolidado.test.ts` y `intake/cfdi_xml.test.ts` cubren la lógica
// pura (el parser, el JOIN, `resolverLineaAMano`) con Supabase mockeado. Lo
// que NO pueden ver es el viaje redondo real: escribir `cfdi_xml` y
// `cfdi_consolidado_linea`, leer `gasto` con los nombres de columna reales,
// actualizar `cfdi_uuid`/`cfdi_orden` (mig. 0065) sin chocar con el índice
// único, que la idempotencia (reenviar el MISMO XML) no duplique nada, Y —
// desde el 5-ago-2026— que la RESOLUCIÓN A MANO (`resolverLineaAMano`, la
// pantalla de Combustible & Casetas) cierre de verdad contra Postgres: que el
// candidato elegido quede ligado, que el descartado NO se toque, y que el
// check constraint `sin_match` de la migración 0077 exista de verdad en la
// base (si no existiera, este `finally` de aquí abajo sí lo demuestra:
// `resolverLineaAMano` devolvería `error_bd`, no `{ ok: true }`).
//
// Usa un CFDI ECC12 real en estructura (verificado contra el XSD oficial del
// SAT el 5-ago-2026 — mismo fixture que `cfdi_xml.test.ts`), con 3 líneas:
// dos concilian solas contra tickets ya "capturados" (sembrados aquí), una
// se deja a propósito SIN gasto que la reciba, para probar que la cola de
// "por conciliar" funciona contra Postgres y no solo contra un mock. Un
// SEGUNDO CFDI, más chico (una sola línea), se manda con DOS candidatos
// igual de buenos sembrados a propósito — la línea AMBIGUA que un contador
// real resuelve a mano, distinta de la de cero candidatos de arriba: son los
// dos caminos que la pantalla ofrece (`resolverLineaAMano` con `tipo:
// 'ligar'` y con `tipo: 'sin_match'`), y valía la pena separarlos en vez de
// reusar la misma línea para los dos.
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
/** El segundo CFDI, el de la línea AMBIGUA (ver el encabezado). */
const UUID_AMBIGUA = randomUUID();

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

// El segundo CFDI: UNA sola línea, para la que se siembran DOS gastos con el
// mismo monto y la misma fecha — la línea ambigua (2 candidatos, ninguno se
// escoge solo) que un contador real resuelve a mano más abajo.
const consolidadoAmbiguoXml = (uuid: string) => `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" TipoDeComprobante="I" Fecha="2026-05-15T23:59:00" Total="1200.00" SubTotal="1034.48">
  <cfdi:Emisor Rfc="edn010101aa1"/>
  <cfdi:Receptor Rfc="tin950101abc"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="84111506" ClaveUnidad="ACT" Cantidad="1" Importe="1034.48" Descripcion="Consumo de combustibles del periodo"/>
  </cfdi:Conceptos>
  <cfdi:Complemento>
    <ecc12:EstadoDeCuentaCombustible xmlns:ecc12="http://www.sat.gob.mx/ecc12" Version="1.2" TipoOperacion="Tarjeta" NumeroDeCuenta="0009182736" SubTotal="1034.48" Total="1200.00">
      <ecc12:Conceptos>
        <ecc12:ConceptoEstadoDeCuentaCombustible Identificador="1" Fecha="2026-05-15T10:00:00" Rfc="EST030303CCC" ClaveEstacion="9012" Cantidad="43.000" TipoCombustible="Diesel" Unidad="LT" NombreCombustible="Diesel" FolioOperacion="OP-200100" ValorUnitario="24.05" Importe="1034.48"/>
      </ecc12:Conceptos>
    </ecc12:EstadoDeCuentaCombustible>
    <tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" UUID="${uuid}"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;

test('consolidado ECC12: parsea, liga 2 de 3 contra gasto real y deja 1 en la cola — contra Postgres, no un mock', async () => {
  cargarEnv(resolve('.env.local'));
  expect(process.env.SUPABASE_SERVICE_ROLE_KEY, 'falta SUPABASE_SERVICE_ROLE_KEY').toBeTruthy();

  const { parseCfdiXml, esConsolidado } = await import('@/lib/cuadra/intake/cfdi_xml');
  const { guardarYConciliarConsolidado, resolverLineaAMano } = await import('@/lib/cuadra/intake/consolidado');
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

    // ═══════════════════════════════════════════════════════════════════════
    // LA RESOLUCIÓN A MANO — el otro lado del mismo hallazgo (5-ago-2026).
    // `resolverLineaAMano` es lo que llama la Server Action de
    // `combustible-casetas/page.tsx`; aquí se prueba contra Postgres real,
    // con el `app_user` real que la migración 0076 exige para `resuelto_por`.
    // ═══════════════════════════════════════════════════════════════════════
    const { data: contador, error: errUser } = await admin.from('app_user')
      .insert({ id: randomUUID(), tenant_id: tenantId, email: `zzz-contador-${UUID_PRUEBA}@likida.test`, rol: 'contador', nombre: 'ZZZ Contador Prueba' })
      .select('id').single();
    expect(errUser, errUser?.message).toBeNull();
    const contadorId = contador!.id as string;

    // ── Camino 1: "ninguno de estos aplica" sobre la línea de CERO candidatos ──
    const { data: lineaSinCandidato } = await admin.from('cfdi_consolidado_linea')
      .select('id').eq('tenant_id', tenantId).eq('indice', 3).single();
    const rSinMatch = await resolverLineaAMano(tenantId, lineaSinCandidato!.id as string, { tipo: 'sin_match' }, contadorId);
    expect(rSinMatch).toEqual({ ok: true });

    const { data: lineaCerrada } = await admin.from('cfdi_consolidado_linea')
      .select('estatus, gasto_id, resuelto_por, resuelto_en').eq('id', lineaSinCandidato!.id).single();
    expect(lineaCerrada!.estatus).toBe('sin_match'); // el check constraint de la 0077, aplicado de verdad
    expect(lineaCerrada!.gasto_id).toBeNull(); // documentada, sin inventarle un gasto
    expect(lineaCerrada!.resuelto_por).toBe(contadorId);
    expect(lineaCerrada!.resuelto_en).toBeTruthy();

    // Y esa línea YA NO cuenta como "por conciliar" — el resumen agregado
    // (`getConciliacionConsolidado`, analytics.ts) hace la misma cuenta.
    const { data: todasLasLineas } = await admin.from('cfdi_consolidado_linea')
      .select('estatus').eq('tenant_id', tenantId);
    const estatusPorTipo = { conciliada: 0, por_conciliar: 0, sin_match: 0 } as Record<string, number>;
    for (const l of todasLasLineas!) estatusPorTipo[l.estatus as string]++;
    expect(estatusPorTipo).toEqual({ conciliada: 2, por_conciliar: 0, sin_match: 1 });

    // ── Camino 2: la línea AMBIGUA (2 candidatos) — se elige uno de verdad ──
    const { data: candidatoA, error: errCandA } = await admin.from('gasto')
      .insert({ tenant_id: tenantId, viaje_id: viaje!.id, concepto: 'diesel', monto: 1034.48, fecha: '2026-05-15' })
      .select('id').single();
    expect(errCandA, errCandA?.message).toBeNull();
    const { data: candidatoB, error: errCandB } = await admin.from('gasto')
      .insert({ tenant_id: tenantId, viaje_id: viaje!.id, concepto: 'diesel', monto: 1034.48, fecha: '2026-05-15' })
      .select('id').single();
    expect(errCandB, errCandB?.message).toBeNull();

    const xmlAmbiguo = parseCfdiXml(consolidadoAmbiguoXml(UUID_AMBIGUA));
    expect(xmlAmbiguo).not.toBeNull();
    const resumenAmbiguo = await guardarYConciliarConsolidado(tenantId, xmlAmbiguo!, consolidadoAmbiguoXml(UUID_AMBIGUA));
    // Dos candidatos igual de buenos → NINGUNO se liga solo, la disciplina de
    // "ante la duda no se adivina" (mismo criterio que `emparejar.ts`).
    expect(resumenAmbiguo).toEqual({ cfdiXmlId: resumenAmbiguo.cfdiXmlId, totalLineas: 1, conciliadas: 0, porConciliar: 1 });

    const { data: lineaAmbigua } = await admin.from('cfdi_consolidado_linea')
      .select('id, candidatos').eq('cfdi_xml_id', resumenAmbiguo.cfdiXmlId).single();
    const candidatosJson = lineaAmbigua!.candidatos as Array<{ gastoId: string; monto: number; fecha: string | null }>;
    expect(candidatosJson).toHaveLength(2);
    expect(candidatosJson.map((c) => c.gastoId).sort()).toEqual([candidatoA!.id as string, candidatoB!.id as string].sort());

    // Cuál de los dos se elige no importa para la prueba — lo que importa es
    // que el elegido quede ligado y el otro se quede sin tocar.
    const [elegido, descartado] = candidatosJson.map((c) => c.gastoId);

    const rLigar = await resolverLineaAMano(tenantId, lineaAmbigua!.id as string, { tipo: 'ligar', gastoId: elegido }, contadorId);
    expect(rLigar).toEqual({ ok: true });

    // La línea queda conciliada, con dueño y con hora.
    const { data: lineaAmbiguaResuelta } = await admin.from('cfdi_consolidado_linea')
      .select('estatus, gasto_id, resuelto_por, resuelto_en').eq('id', lineaAmbigua!.id).single();
    expect(lineaAmbiguaResuelta!.estatus).toBe('conciliada');
    expect(lineaAmbiguaResuelta!.gasto_id).toBe(elegido);
    expect(lineaAmbiguaResuelta!.resuelto_por).toBe(contadorId);
    expect(lineaAmbiguaResuelta!.resuelto_en).toBeTruthy();

    // El gasto ELEGIDO quedó ligado — mismo mecanismo que el camino automático
    // (`cfdi_uuid` + `cfdi_orden`, migración 0065).
    const { data: gastoElegido } = await admin.from('gasto')
      .select('cfdi_uuid, cfdi_orden').eq('id', elegido).single();
    expect(gastoElegido!.cfdi_uuid).toBe(UUID_AMBIGUA.toLowerCase());
    expect(gastoElegido!.cfdi_orden).toBe(1);

    // El candidato DESCARTADO se queda SIN TOCAR — el punto entero de pedir
    // una elección en vez de adivinar.
    const { data: gastoDescartado } = await admin.from('gasto')
      .select('cfdi_uuid').eq('id', descartado).single();
    expect(gastoDescartado!.cfdi_uuid).toBeNull();

    // Y una línea ya resuelta NO SE PUEDE RESOLVER OTRA VEZ — ni con el
    // candidato que quedó libre.
    const rSegundoIntento = await resolverLineaAMano(tenantId, lineaAmbigua!.id as string, { tipo: 'ligar', gastoId: descartado }, contadorId);
    expect(rSegundoIntento).toEqual({ ok: false, motivo: 'ya_resuelta' });

    console.log(`\n✅ resolución a mano real: 1 línea sin candidato → sin_match, ` +
      `1 línea ambigua (2 candidatos) → ligada al elegido, el descartado sigue sin cfdi_uuid.\n`);
  } finally {
    if (tenantId) await admin.from('tenant').delete().eq('id', tenantId);
  }
});
