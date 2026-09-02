// ═══════════════════════════════════════════════════════════════════════════
// SIMULACIÓN DE UN MES COMPLETO — flota sintética de 4 unidades, ~20 viajes,
// gastos con OCR real (fotos sintéticas), cuadre real, liquidación con PDF
// real, una factura CFDI (captura, no timbrado — Likida NO es PAC) y un ciclo
// de cobranza con dos abonos.
//
// EXTIENDE el ejército de QA existente (config.qa.ts / agentes/operador.qa.ts
// / oraculos/*): mismo guard `exigirTenantZZZ`, mismo cliente Meta falso, MISMO
// `processInbound` en proceso (nunca una copia). Lo único nuevo es el tenant
// —`ZZZ QA MES DEMO`, UUID propio— para no interferir con `ZZZ QA` (el que usa
// `npm run qa:nocturno`, que borra y re-siembra su tenant en cada corrida: si
// esta demo viviera ahí, la próxima corrida nocturna se la llevaría entre
// escenarios de ataque).
//
// A DIFERENCIA del orquestador nocturno, esta corrida NO llama a
// `limpiezaFinal()`: el propósito es dejar el tenant CON la actividad, como
// evidencia de que el pipeline funciona con datos reales, no con mocks de
// TypeScript.
//
// CÓMO CORRERLO (gasta dinero real — OCR + cuadre por OpenRouter):
//   npx vitest run --config vitest.qa.config.ts scripts/qa-agentes/simulacion-mes.qa.ts
// ═══════════════════════════════════════════════════════════════════════════

import { describe, test, beforeAll, afterAll, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  cargaEnvLocal, exigirClaves, exigirTenantZZZ, dirCorrida, type VeredictoOraculo,
} from './config.qa';
import { registrarUso, resumenLedgerQA, leerLedgerQA, totalLedgerQA } from './ledger.qa';
import {
  instalarMetaFalso, generarTicketPng, enviarFoto, enviarTexto, drenarSalientes,
} from './agentes/operador.qa';
import { mulberry32, semillaDesde, pesos, entre, folioSintetico } from './escenarios/rng';

// EL MOCK VA PRIMERO — antes de cualquier import (aunque sea transitivo) de
// src/. Por eso TODO lo de src/ (operacion.ts, clientes.ts,
// facturacion_escritura.ts, los oráculos, supabase/admin) se carga con import
// DINÁMICO dentro de beforeAll, nunca como import estático arriba.
instalarMetaFalso();

// ── El tenant de esta demo (DISTINTO de TENANT_QA_ID de config.qa) ─────────
const TENANT_ID = 'aaaaaaaa-0000-4000-8000-000000009902';
const TENANT_NOMBRE = 'ZZZ QA MES DEMO';
const TELEFONOS = (process.env.QA_MES_SMOKE ? ['5215559920001'] : ['5215559920001', '5215559920002', '5215559920003', '5215559920004']) as readonly string[];
const NOMBRES_OP = ['ZZZ QA MES Chofer Uno', 'ZZZ QA MES Chofer Dos', 'ZZZ QA MES Chofer Tres', 'ZZZ QA MES Chofer Cuatro'];
const TRIPS_POR_OPERADOR = process.env.QA_MES_SMOKE ? 1 : 5;
const MES = '2026-08';

const FECHA = `${new Date().toISOString().slice(0, 10)}-simulacion-mes`;

let db: SupabaseClient;
let Op: typeof import('@/lib/likida/operacion');
let Cl: typeof import('@/lib/likida/clientes');
let Fa: typeof import('@/lib/likida/facturacion_escritura');
let cuadreOraculo: typeof import('./oraculos/cuadre_balancea.oraculo');

interface TicketPlan { tipo: 'diesel' | 'caseta' | 'alimentacion'; monto: number; folio: string; fecha: string }
interface TripPlan {
  opIdx: number; folio: string; fechaInicio: string; anticipo: number;
  ingresoFlete: number; kmRecorridos: number; tickets: TicketPlan[]; sobrePolitica: boolean;
}
interface TripResultado {
  folio: string; viajeId: string; operadorTel: string; cerradoAlPrimerIntento: boolean;
  cerrado: boolean; veredicto: VeredictoOraculo; costoUsd: number; tickets: TicketPlan[];
  anticipo: number; ingresoFlete: number;
}

const RESULTADOS: TripResultado[] = [];
const idsLedgereados = new Set<string>();

// ── Tickets sintéticos (mismo patrón sharp+SVG que operador.qa.ts) ─────────

async function ticketCaseta(t: TicketPlan): Promise<string> {
  const [y, m, d] = t.fecha.split('-');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="620" height="480">
    <rect width="620" height="480" fill="#ffffff"/>
    <g font-family="monospace" font-size="21" fill="#111111">
      <text x="40" y="60">CAPUFE</text>
      <text x="40" y="90">AUTOPISTA ZZZ QA KM 90</text>
      <text x="40" y="130">CASETA 12   CARRIL 3</text>
      <text x="40" y="165">FECHA   ${d}/${m}/${y}  11:40</text>
      <text x="40" y="200">FOLIO   ${t.folio}</text>
      <text x="40" y="235">CLASE   3 EJES</text>
      <text x="40" y="300" font-size="27">IMPORTE   $${t.monto.toFixed(2)}</text>
      <text x="40" y="350">FORMA DE PAGO  IAVE</text>
      <text x="40" y="400">GRACIAS POR SU PREFERENCIA</text>
    </g>
  </svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

async function ticketAlimentacion(t: TicketPlan): Promise<string> {
  const [y, m, d] = t.fecha.split('-');
  const subtotal = (t.monto / 1.16).toFixed(2);
  const iva = (t.monto - t.monto / 1.16).toFixed(2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="620" height="560">
    <rect width="620" height="560" fill="#ffffff"/>
    <g font-family="monospace" font-size="21" fill="#111111">
      <text x="40" y="60">RESTAURANTE EL BUEN SABOR ZZZ QA SA DE CV</text>
      <text x="40" y="90">CARR FEDERAL KM 45   MESA 4</text>
      <text x="40" y="130">FOLIO   ${t.folio}</text>
      <text x="40" y="165">FECHA   ${d}/${m}/${y}  13:20</text>
      <text x="40" y="220">1 COMIDA CORRIDA</text>
      <text x="40" y="250">1 REFRESCO</text>
      <text x="40" y="300">SUBTOTAL   $${subtotal}</text>
      <text x="40" y="330">IVA 16%    $${iva}</text>
      <text x="40" y="365" font-size="27">TOTAL      $${t.monto.toFixed(2)}</text>
      <text x="40" y="420">GRACIAS POR SU VISITA</text>
    </g>
  </svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

// ── Plan del mes (PURO, determinístico: sha256('simulacion-mes-2026-08')) ──

function planDelMes(): TripPlan[] {
  const rng = mulberry32(semillaDesde(`simulacion-mes-${MES}`));
  const planes: TripPlan[] = [];
  let dia = 1;
  for (let opIdx = 0; opIdx < TELEFONOS.length; opIdx++) {
    for (let k = 0; k < TRIPS_POR_OPERADOR; k++) {
      const fechaInicio = `${MES}-${String(Math.min(28, dia)).padStart(2, '0')}`;
      dia += entre(rng, 1, 2);
      const sobrePolitica = opIdx === 0 && k === 0; // el ataque real: 1er viaje del 1er chofer
      const dieselMonto = sobrePolitica ? 4500 : pesos(rng, 1500, 3900);
      const tickets: TicketPlan[] = [
        { tipo: 'diesel', monto: dieselMonto, folio: folioSintetico(rng, 'DSL'), fecha: fechaInicio },
      ];
      if (rng() < 0.7) tickets.push({ tipo: 'caseta', monto: pesos(rng, 200, 1400), folio: folioSintetico(rng, 'CAS'), fecha: fechaInicio });
      if (rng() < 0.5) tickets.push({ tipo: 'alimentacion', monto: pesos(rng, 150, 750), folio: folioSintetico(rng, 'ALM'), fecha: fechaInicio });
      planes.push({
        opIdx, folio: folioSintetico(rng, 'QAMES'), fechaInicio,
        anticipo: pesos(rng, 3000, 6000), ingresoFlete: pesos(rng, 7000, 12000),
        kmRecorridos: entre(rng, 180, 650), tickets, sobrePolitica,
      });
    }
  }
  return planes;
}

// ── Siembra del tenant, operadores, unidades, cliente ──────────────────────

async function limpiarTenantPrevio(): Promise<void> {
  const { data, error } = await db.from('tenant').select('id, nombre').eq('id', TENANT_ID).maybeSingle();
  if (error) throw new Error(`no se pudo consultar el tenant: ${error.message}`);
  if (data) {
    await exigirTenantZZZ(db, TENANT_ID);
    const del = await db.from('tenant').delete().eq('id', TENANT_ID);
    if (del.error) throw new Error(`no se pudo limpiar el tenant previo: ${del.error.message}`);
  }
}

interface OperadorInfo { operadorId: string; unidadId: string; telefono: string }
const OPERADORES: OperadorInfo[] = [];
let CLIENTE_ID = '';

async function sembrarTodo(): Promise<void> {
  await limpiarTenantPrevio();
  const ins = await db.from('tenant').insert({
    id: TENANT_ID,
    nombre: TENANT_NOMBRE,
    plan: 'demo',
    razon_social: 'ZZZ QA MES DEMO SA DE CV',
    domicilio_fiscal: 'Carretera Sintetica QA Km 1, Monterrey NL',
    config: {
      politica: [
        { concepto: 'diesel', topeMonto: 4000 },
        { concepto: 'caseta', topeMonto: 1500 },
        { concepto: 'alimentacion', topeMonto: 800 },
      ],
    },
  });
  if (ins.error) throw new Error(`no se pudo sembrar el tenant: ${ins.error.message}`);

  for (let i = 0; i < TELEFONOS.length; i++) {
    const { data: opRow, error: opErr } = await db.from('operador').insert({
      tenant_id: TENANT_ID, nombre: NOMBRES_OP[i], telefono: TELEFONOS[i], activo: true,
    }).select('id').single();
    if (opErr) throw new Error(`no se pudo sembrar el operador ${TELEFONOS[i]}: ${opErr.message}`);
    const unidadId = await Op.crearUnidad(TENANT_ID, {
      numeroEconomico: `ZZZ-${101 + i}`, placas: `QAMES-${1000 + i}`, marca: 'Kenworth', modelo: 'T680', anio: 2022,
    });
    OPERADORES.push({ operadorId: (opRow as { id: string }).id, unidadId, telefono: TELEFONOS[i] });
  }

  const c = Cl.validarCliente({
    nombre: 'ZZZ QA Cliente Demo SA de CV', rfc: 'GMX0902279I1', contacto: 'ZZZ Contacto QA',
    correo: 'contacto@zzzqa.example.mx', telefono: '8112345678', diasCredito: '30', activo: true,
  });
  CLIENTE_ID = await Cl.crearCliente(TENANT_ID, c);
}

// ── Utilería ─────────────────────────────────────────────────────────────

async function hayLiquidacion(viajeId: string): Promise<boolean> {
  const { data } = await db.from('liquidacion').select('id').eq('tenant_id', TENANT_ID).eq('viaje_id', viajeId).maybeSingle();
  return Boolean(data);
}

async function ledgerearCostos(quien: string): Promise<number> {
  const { data, error } = await db.from('llm_costo')
    .select('id, fase, modelo, tokens_in, tokens_out, costo_usd')
    .eq('tenant_id', TENANT_ID);
  if (error) throw new Error(`no se pudo leer llm_costo: ${error.message}`);
  let suma = 0;
  for (const fila of data ?? []) {
    const id = String(fila.id);
    if (idsLedgereados.has(id)) continue;
    idsLedgereados.add(id);
    if (fila.fase === 'whatsapp') continue; // Meta falso: sin costo real
    const costo = Number(fila.costo_usd);
    suma += costo;
    registrarUso(FECHA, `${quien}/${fila.fase}`, String(fila.modelo), Number(fila.tokens_in), Number(fila.tokens_out), costo);
  }
  return suma;
}

async function generarFoto(t: TicketPlan): Promise<string> {
  if (t.tipo === 'diesel') return generarTicketPng({ monto: t.monto, fecha: t.fecha, folio: t.folio, litros: Math.round((t.monto / 24) * 100) / 100 });
  if (t.tipo === 'caseta') return ticketCaseta(t);
  return ticketAlimentacion(t);
}

// ── Un viaje completo: crear → fotos (OCR real) → "listo" → cuadre real ────

async function correrViaje(plan: TripPlan): Promise<TripResultado> {
  const op = OPERADORES[plan.opIdx];
  const viajeId = await Op.crearViaje(TENANT_ID, {
    folio: plan.folio, origen: 'ZZZ Origen QA', destino: 'ZZZ Destino QA',
    fechaInicio: plan.fechaInicio, anticipo: plan.anticipo,
    operadorId: op.operadorId, unidadId: op.unidadId,
    clienteId: CLIENTE_ID, ingresoFlete: plan.ingresoFlete, kmRecorridos: plan.kmRecorridos,
  });

  for (const t of plan.tickets) {
    const dataUrl = await generarFoto(t);
    await enviarFoto(op.telefono, dataUrl, `${plan.folio}-${t.tipo}`);
  }
  drenarSalientes(); // limpia los acuses de cada foto; no se auditan aquí

  await enviarTexto(op.telefono, 'listo', `${plan.folio}-cierre1`);
  let cerradoAlPrimerIntento = await hayLiquidacion(viajeId);
  let cerrado = cerradoAlPrimerIntento;
  if (!cerrado) {
    await enviarTexto(op.telefono, 'listo', `${plan.folio}-cierre2`);
    cerrado = await hayLiquidacion(viajeId);
  }
  drenarSalientes();

  const costoUsd = await ledgerearCostos(plan.folio);
  const veredicto = await cuadreOraculo.oraculoCuadreBalancea(TENANT_ID, viajeId, {
    esperaLiquidacion: true,
    ...(plan.sobrePolitica ? { esperaSobrePolitica: { cuantas: 1, excesoTotal: 500 } } : {}),
  });

  return {
    folio: plan.folio, viajeId, operadorTel: op.telefono, cerradoAlPrimerIntento, cerrado,
    veredicto, costoUsd, tickets: plan.tickets, anticipo: plan.anticipo, ingresoFlete: plan.ingresoFlete,
  };
}

// ── Factura CFDI (captura — Likida NO timbra) + ciclo de cobranza ──────────

interface FacturacionResultado {
  facturaId: string; total: number; viajeIds: string[]; cfdiUuid: string;
  pago1: number; pago2: number; estatusFinal: string;
}

async function facturarYCobrar(viajeIds: string[]): Promise<FacturacionResultado> {
  const seleccionados = RESULTADOS.filter((r) => viajeIds.includes(r.viajeId));
  const subtotal = Math.round(seleccionados.reduce((s, r) => s + r.ingresoFlete, 0) * 100) / 100;
  const iva = Math.round(subtotal * 0.16 * 100) / 100;
  const cfdiUuid = randomUUID(); // representa el UUID que el PAC externo ya timbró; Likida solo lo captura

  const cruda = Fa.validarFactura({
    clienteId: CLIENTE_ID, fecha: `${MES}-28`, subtotal: subtotal.toFixed(2), iva: iva.toFixed(2),
    serie: 'QAMES', folio: '1', cfdiUuid, viajeIds,
  });
  const facturaId = await Fa.crearFactura(TENANT_ID, cruda);
  const total = cruda.total;

  const pago1 = Math.round(total * 0.6 * 100) / 100;
  const pago2 = Math.round((total - pago1) * 100) / 100;

  await Fa.registrarPago(TENANT_ID, Fa.validarPago({
    facturaId, fecha: `${MES}-30`, monto: pago1.toFixed(2), metodo: 'transferencia', referencia: 'ZZZQA-ABONO-1',
  }));
  await Fa.registrarPago(TENANT_ID, Fa.validarPago({
    facturaId, fecha: '2026-09-05', monto: pago2.toFixed(2), metodo: 'transferencia', referencia: 'ZZZQA-ABONO-2',
  }));

  const { data: fila, error } = await db.from('factura_emitida').select('estatus').eq('id', facturaId).single();
  if (error) throw new Error(`no se pudo releer la factura: ${error.message}`);

  return { facturaId, total, viajeIds, cfdiUuid, pago1, pago2, estatusFinal: String((fila as { estatus: string }).estatus) };
}

// ── Reporte ─────────────────────────────────────────────────────────────

function escribirReporte(fact: FacturacionResultado | null, notaFacturacion: string): string {
  const okCuadre = RESULTADOS.filter((r) => r.veredicto.estado === 'ok').length;
  const totalAnticipo = RESULTADOS.reduce((s, r) => s + r.anticipo, 0);
  const totalIngresoFlete = RESULTADOS.reduce((s, r) => s + r.ingresoFlete, 0);
  const totalGastos = RESULTADOS.reduce((s, r) => s + r.tickets.reduce((a, t) => a + t.monto, 0), 0);
  const sobrePoliticaCount = RESULTADOS.filter((r) => r.veredicto.detalle?.includes('sobre_politica') || r.tickets.some((t) => t.tipo === 'diesel' && t.monto > 4000)).length;

  const filas = RESULTADOS.map((r) => {
    const gastos = r.tickets.reduce((a, t) => a + t.monto, 0);
    return `| ${r.folio} | ${r.operadorTel} | ${r.cerrado ? '✅' : '❌'} | ${r.veredicto.estado} | $${r.anticipo.toFixed(2)} | $${gastos.toFixed(2)} | $${r.ingresoFlete.toFixed(2)} | ${r.tickets.length} | $${r.costoUsd.toFixed(4)} |`;
  }).join('\n');

  const ledger = leerLedgerQA(FECHA);
  const md = `# Simulación de un mes completo — ZZZ QA MES DEMO — ${FECHA}

Tenant sintético \`${TENANT_NOMBRE}\` (\`${TENANT_ID}\`), 4 unidades, ${RESULTADOS.length} viajes
en ${MES}. Extiende el ejército de QA existente (mismo guard, mismo Meta falso,
MISMO \`processInbound\`); NO se limpia al final — el tenant queda como evidencia.

## Viajes (${RESULTADOS.length})

| folio | chofer | cerró | cuadre | anticipo | gastos | ingreso flete | tickets | costo OCR/cuadre |
|---|---|---|---|---|---|---|---|---|
${filas}

## Resumen

- Viajes cerrados con liquidación: ${RESULTADOS.filter((r) => r.cerrado).length}/${RESULTADOS.length}
- Oráculo cuadre_balancea en ✅: ${okCuadre}/${RESULTADOS.length}
- Viajes con diesel sobre política (>$4000): ${sobrePoliticaCount}
- Total anticipos: $${totalAnticipo.toFixed(2)}
- Total gastos comprobados (tickets enviados): $${totalGastos.toFixed(2)}
- Total ingreso de flete capturado: $${totalIngresoFlete.toFixed(2)}

## Facturación y cobranza

${notaFacturacion}
${fact ? `
- Factura \`${fact.facturaId}\` — serie QAMES folio 1, UUID \`${fact.cfdiUuid}\`
- Ampara ${fact.viajeIds.length} viajes, total $${fact.total.toFixed(2)}
- Abono 1: $${fact.pago1.toFixed(2)} · Abono 2: $${fact.pago2.toFixed(2)}
- Estatus final: **${fact.estatusFinal}**
` : ''}

## Gasto real de la corrida (ledger)

\`\`\`
${resumenLedgerQA(FECHA)}
\`\`\`

Total: $${totalLedgerQA(ledger).toFixed(4)} USD.

## Limpieza

NO se ejecutó — el tenant \`${TENANT_NOMBRE}\` queda sembrado a propósito, como
demostración de un mes de actividad real sobre el pipeline de producción.
`;
  mkdirSync(dirCorrida(FECHA), { recursive: true });
  const ruta = join(dirCorrida(FECHA), 'simulacion-mes.md');
  writeFileSync(ruta, md);
  return ruta;
}

// ═══════════════════════════════════════════════════════════════════════════

describe('Simulación de un mes completo — ZZZ QA MES DEMO', () => {
  const planes = planDelMes();

  beforeAll(async () => {
    cargaEnvLocal();
    exigirClaves();
    db = (await import('@/lib/supabase/admin')).supabaseAdmin();
    Op = await import('@/lib/likida/operacion');
    Cl = await import('@/lib/likida/clientes');
    Fa = await import('@/lib/likida/facturacion_escritura');
    cuadreOraculo = await import('./oraculos/cuadre_balancea.oraculo');
    await sembrarTodo();
  }, 300_000);

  for (let opIdx = 0; opIdx < TELEFONOS.length; opIdx++) {
    test(`chofer ${opIdx + 1} — ${TRIPS_POR_OPERADOR} viajes del mes`, async () => {
      const misPlanes = planes.filter((p) => p.opIdx === opIdx);
      for (const plan of misPlanes) {
        const r = await correrViaje(plan);
        RESULTADOS.push(r);
        expect(r.veredicto.estado, `${r.folio}: ${JSON.stringify(r.veredicto)}`).not.toBe('no_verificado');
      }
    }, 1_800_000);
  }

  test('factura CFDI (captura) + ciclo de cobranza sobre 3 viajes cerrados', async () => {
    const cerrados = RESULTADOS.filter((r) => r.cerrado);
    expect(cerrados.length, 'no hay viajes cerrados para facturar').toBeGreaterThanOrEqual(1);
    const elegidos = cerrados.slice(0, Math.min(3, cerrados.length)).map((r) => r.viajeId);
    const fact = await facturarYCobrar(elegidos);
    expect(fact.estatusFinal).toBe('pagada');
    (globalThis as { __FACTURA__?: FacturacionResultado }).__FACTURA__ = fact;
  }, 120_000);

  afterAll(async () => {
    const fact = (globalThis as { __FACTURA__?: FacturacionResultado }).__FACTURA__ ?? null;
    const nota = fact ? 'Factura y cobranza completadas sobre viajes reales del mes.' : 'No se pudo facturar (ver test de facturación).';
    const ruta = escribirReporte(fact, nota);
    console.log(`\n═══ REPORTE: ${ruta}`);
    console.log(resumenLedgerQA(FECHA));
    console.log(`═══ Tenant ${TENANT_NOMBRE} (${TENANT_ID}) NO se limpió — queda como demostración.\n`);
  }, 60_000);
});
