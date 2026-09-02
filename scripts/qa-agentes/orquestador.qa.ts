// ═══════════════════════════════════════════════════════════════════════════
// ORQUESTADOR DE QA — Fase 1: agente Operador contra el tenant ZZZ QA.
//
// Implementa el bucle de 7 pasos del diseño (00-DISENO-QA-AUTONOMO.md §3):
//   1. generar escenario con semilla (PRNG mulberry32, escenarios/rng.ts)
//   2. asignar personaje (Operador sintético, agentes/operador.qa.ts)
//   3. ejecutar — processInbound EN PROCESO, con el cliente Meta sustituido
//   4. consultar DB con service_role (SOLO tenant ZZZ QA)
//   5. comparar esperado vs real — los 5 oráculos (funciones puras, sin LLM)
//   6. capturar evidencia en docs/qa/<fecha>/evidencia/operador/<esc>-rep<n>/
//   7. reportar SOLO con reproducción — docs/qa/<fecha>/operador.md, formato
//      de tabla del diseño (✅/⚠️/❌, severidad, N/N de reproducibilidad)
//
// El gasto REAL de cada llamada (llm_costo, costo del proveedor) se registra
// en el ledger vía registrarUso, que ABORTA la corrida si pasa el tope.
//
// CÓMO CORRERLO (gasta dinero de verdad — OCR + cuadre por OpenRouter):
//   npm run qa:nocturno
//   (= npx vitest run --config vitest.qa.config.ts scripts/qa-agentes/orquestador.qa.ts)
// ═══════════════════════════════════════════════════════════════════════════

import { describe, test, beforeAll, afterAll, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  cargaEnvLocal, exigirClaves, exigirTenantZZZ, exigirPrefijoQA,
  TENANT_QA_ID, TENANT_QA_NOMBRE, TELEFONOS_QA, PREFIJO_QA, REPETICIONES,
  fechaCorrida, dirCorrida, dirEvidencia, type VeredictoOraculo,
} from './config.qa';
import { registrarUso, resumenLedgerQA, leerLedgerQA, totalLedgerQA } from './ledger.qa';
import {
  generarEscenario, ATAQUES_FASE_1,
  type AtaqueOperador, type EscenarioOperador,
} from './escenarios/operador.escenarios';
import {
  ATAQUES_FUZZING, generarEscenarioFuzzing,
  type AtaqueFuzzing, type EscenarioFuzzing,
} from './escenarios/fuzzing.escenarios';
import {
  ATAQUES_CAOS, programarCaos, crearDespachador, fetchConCaosPorHost,
  type AtaqueCaos, type PlanDeCaos, type Despachador, type FetchLike,
} from './escenarios/chaos.escenarios';
import {
  instalarMetaFalso, generarTicketPng, generarFotoFuzzPng, capturarBitacora,
  enviarFoto, enviarTexto, drenarSalientes, type MensajeSaliente,
} from './agentes/operador.qa';

// EL MOCK VA PRIMERO — antes de que cualquier import (aunque sea de un
// oráculo) cargue módulos de src/ que dependen del cliente de Meta.
instalarMetaFalso();

// ── EL CAOS SE INSTALA UNA VEZ, Y SE ENCIENDE POR REPETICIÓN ───────────────
//
// `supabase/admin.ts` no recibe un `fetch` inyectable —construye el cliente con
// `global.fetch`— y el SDK de OpenRouter tampoco. La única palanca que alcanza
// a los dos es sustituir el fetch GLOBAL, y hay que hacerlo AQUÍ, en el cuerpo
// del módulo: `supabaseAdmin()` cachea el cliente en un singleton, así que si
// se sustituyera después del primer uso, ese cliente seguiría con el fetch de
// antes y el caos no lo tocaría nunca.
//
// Sustituirlo no lo enciende: mientras `caosActivo` sea `null`, TODA petición
// pasa limpia y el arnés se comporta exactamente como antes de este cambio.
// Cada repetición de un ataque de caos lo enciende y lo apaga en su `finally`.
let caosActivo: Despachador | null = null;
const fetchOriginal = globalThis.fetch;
globalThis.fetch = fetchConCaosPorHost(fetchOriginal as FetchLike, () => caosActivo) as typeof fetch;

const FECHA = fechaCorrida();

// Los oráculos y el resto de src/ se cargan DESPUÉS del mock (import dinámico).
let db: SupabaseClient;
let O: {
  cuadre: typeof import('./oraculos/cuadre_balancea.oraculo');
  dedup: typeof import('./oraculos/dedup_comprobante.oraculo');
  huerfano: typeof import('./oraculos/huerfano_post_cierre.oraculo');
  cifras: typeof import('./oraculos/cifras_con_fuente.oraculo');
  bitacora: typeof import('./oraculos/bitacora_registro.oraculo');
};
let hashImagen: (dataUrl: string) => Promise<string>;

// ── Resultados acumulados para el reporte ──────────────────────────────────

/** Los tres modos que corren sobre el mismo arnés. */
type Ataque = AtaqueOperador | AtaqueFuzzing | AtaqueCaos;

interface ResultadoRep {
  ataque: Ataque;
  familia: 'operador' | 'fuzzing' | 'chaos';
  rep: number;
  veredictos: VeredictoOraculo[];
  costoUsd: number;
  rutaEvidencia: string;
  nota?: string;
}

/**
 * La vista NORMALIZADA de un escenario para el reporte.
 *
 * El reporte leía `esc.tickets`, `esc.folioViaje2` y `esc.anticipo` directo del
 * `EscenarioOperador`. Un escenario de fuzzing tiene `fotos` en vez de
 * `tickets`, y un plan de caos no tiene ninguno de los dos: en vez de llenar el
 * reporte de `?.` y de campos opcionales que no significan nada en dos de cada
 * tres familias, cada familia dice EN UNA LÍNEA qué sembró. El reporte imprime
 * esa línea y no sabe de qué familia vino.
 */
interface EscenarioReportable {
  ataque: Ataque;
  familia: 'operador' | 'fuzzing' | 'chaos';
  semillaTexto: string;
  seed: number;
  invariantes: string[];
  sembrado: string;
}

const RESULTADOS: ResultadoRep[] = [];
const ESCENARIOS = new Map<Ataque, EscenarioReportable>();

function reportableOperador(e: EscenarioOperador): EscenarioReportable {
  return {
    ataque: e.ataque, familia: 'operador', semillaTexto: e.semillaTexto, seed: e.seed,
    invariantes: e.invariantes,
    sembrado: `anticipo $${e.anticipo.toFixed(2)}, viaje \`${e.folioViaje}\``
      + (e.folioViaje2 ? ` + \`${e.folioViaje2}\`` : '')
      + `, tickets ${e.tickets.map((t) => `$${t.monto.toFixed(2)} (${t.fecha}, ${t.folio})`).join(' · ') || '(ninguno)'}`
      + (e.textos.length ? `, textos: ${e.textos.map((t) => `«${t}»`).join(', ')}` : ''),
  };
}

function reportableFuzz(e: EscenarioFuzzing): EscenarioReportable {
  // Los textos se imprimen con `JSON.stringify` a propósito: la mitad de los
  // ataques de este modo SON caracteres invisibles, y pegarlos crudos en el
  // Markdown haría un reporte donde el ataque no se ve.
  return {
    ataque: e.ataque, familia: 'fuzzing', semillaTexto: e.semillaTexto, seed: e.seed,
    invariantes: e.invariantes,
    sembrado: `anticipo $${e.anticipo.toFixed(2)}, viaje \`${e.folioViaje}\``
      + `, fotos ${e.fotos.map((f) => f.clase).join(' · ') || '(ninguna)'}`
      + (e.montoInyectado ? `, monto inyectado $${e.montoInyectado.toFixed(2)} (NO debe aparecer en la liquidación)` : '')
      + (e.textos.length ? `, textos: ${e.textos.map((t) => `\`${JSON.stringify(t)}\``).join(', ')}` : '')
      + `<br>PROHIBIDO: ${e.prohibido.join(' · ')}`,
  };
}

function reportableCaos(p: PlanDeCaos, d: Despachador | null): EscenarioReportable {
  // `sinAplicar` es la mitad honesta: una falla programada para la llamada 9 en
  // una corrida que hizo 5 NO se probó, y decir ✅ ahí sería presumir cobertura
  // que no hubo.
  const aplicadas = d?.aplicadas() ?? [];
  const sin = d?.sinAplicar() ?? p.fallas;
  return {
    ataque: p.ataque, familia: 'chaos', semillaTexto: p.semillaTexto, seed: p.seed,
    invariantes: p.invariantes,
    sembrado: `fallas programadas: ${p.fallas.map((f) => `${f.canal}#${f.llamada}→${f.falla}`).join(' · ')}`
      + `<br>APLICADAS: ${aplicadas.map((f) => `${f.canal}#${f.llamada}→${f.falla}`).join(' · ') || '(ninguna)'}`
      + (sin.length ? `<br>⚠️ NO SE APLICARON (la corrida no llegó a esa llamada): ${sin.map((f) => `${f.canal}#${f.llamada}`).join(' · ')}` : '')
      + `<br>PROHIBIDO: ${p.prohibido.join(' · ')}`,
  };
}
let LIMPIEZA_FINAL = 'no ejecutada';
const idsLedgereados = new Set<string>();

// ── Utilería de siembra (siempre detrás del guard cuando borra) ────────────

async function sembrarTenantQA(): Promise<void> {
  const { data, error } = await db.from('tenant').select('id, nombre').eq('id', TENANT_QA_ID).maybeSingle();
  if (error) throw new Error(`no se pudo consultar el tenant QA: ${error.message}`);
  if (data) {
    await exigirTenantZZZ(db, TENANT_QA_ID);
    const del = await db.from('tenant').delete().eq('id', TENANT_QA_ID);
    if (del.error) throw new Error(`no se pudo limpiar el tenant QA previo: ${del.error.message}`);
  }
  const ins = await db.from('tenant').insert({
    id: TENANT_QA_ID,
    nombre: TENANT_QA_NOMBRE,
    plan: 'demo',
    // Sin dígitos a propósito: el aviso de privacidad que el operador recibe
    // imprime estos campos, y el oráculo #5 revisa TODO mensaje saliente.
    razon_social: 'ZZZ QA SA DE CV',
    domicilio_fiscal: 'Carretera Sintetica QA SN, Monterrey NL',
    config: {
      politica: [
        { concepto: 'diesel', topeMonto: 4000 },
        { concepto: 'caseta', topeMonto: 1500 },
        { concepto: 'alimentacion', topeMonto: 800 },
      ],
    },
  });
  if (ins.error) throw new Error(`no se pudo sembrar el tenant QA: ${ins.error.message}`);

  const ops = await db.from('operador').insert(
    TELEFONOS_QA.map((tel, i) => ({
      tenant_id: TENANT_QA_ID,
      nombre: `ZZZ QA Chofer ${i + 1}`,
      telefono: tel,
      activo: true,
    })),
  );
  if (ops.error) throw new Error(`no se pudo sembrar operadores QA: ${ops.error.message}`);
}

async function operadorPorTelefono(tel: string): Promise<string> {
  const { data, error } = await db.from('operador')
    .select('id').eq('tenant_id', TENANT_QA_ID).eq('telefono', tel).single();
  if (error) throw new Error(`operador QA no encontrado (${tel}): ${error.message}`);
  return data.id as string;
}

async function sembrarViaje(opts: {
  operadorId: string; folio: string; anticipo: number; fechaInicio: string;
  estatus: 'abierto' | 'liquidado';
}): Promise<string> {
  const { data, error } = await db.from('viaje').insert({
    tenant_id: TENANT_QA_ID,
    operador_id: opts.operadorId,
    folio: opts.folio,
    origen: 'ZZZ Origen QA',
    destino: 'ZZZ Destino QA',
    anticipo: opts.anticipo,
    fecha_inicio: opts.fechaInicio,
    estatus: opts.estatus,
    // aceptado_en puesto: el flujo de confirmación de viaje no debe secuestrar
    // los mensajes del escenario. El constraint `viaje_aceptado_requiere_aviso`
    // exige entonces avisado_en también. Los crons reales NO alcanzan estos
    // viajes: la escalación filtra `aceptado_en is null` (aquí está puesto) y
    // la cobranza arranca por días desde fecha_inicio (aquí hoy−1 → 1 día,
    // bajo el primer tier) — y el viaje vive minutos antes de su limpieza.
    aceptado_en: new Date().toISOString(),
    avisado_en: new Date().toISOString(),
  }).select('id').single();
  if (error) throw new Error(`no se pudo sembrar el viaje ${opts.folio}: ${error.message}`);
  return data.id as string;
}

async function sembrarLiquidacion(viajeId: string, liq: { totalComprobado: number; totalAnticipo: number; diferencia: number }, fechaCierre: string): Promise<void> {
  const { error } = await db.from('liquidacion').insert({
    tenant_id: TENANT_QA_ID,
    viaje_id: viajeId,
    total_comprobado: liq.totalComprobado,
    total_anticipo: liq.totalAnticipo,
    diferencia: liq.diferencia,
    estatus: 'cuadrada',
    diferencias: [],
    created_at: `${fechaCierre}T18:00:00Z`,
  });
  if (error) throw new Error(`no se pudo sembrar la liquidación: ${error.message}`);
}

/** Borra los HIJOS del tenant QA entre repeticiones (viajes, gastos, …).
 *  SIEMPRE detrás del guard ZZZ; wa_mensaje_procesado (sin tenant_id) va
 *  detrás del guard de prefijo. */
async function limpiarHijosTenant(): Promise<void> {
  await exigirTenantZZZ(db, TENANT_QA_ID);
  for (const tabla of ['gasto', 'liquidacion', 'comprobante_huerfano', 'wa_conversacion', 'viaje']) {
    const { error } = await db.from(tabla).delete().eq('tenant_id', TENANT_QA_ID);
    if (error) throw new Error(`limpieza de ${tabla} falló: ${error.message}`);
  }
  const patron = `${PREFIJO_QA}%`;
  exigirPrefijoQA(patron);
  await db.from('wa_mensaje_procesado').delete().like('wa_message_id', patron);
}

/** Copia al ledger el costo REAL (llm_costo) que la corrida generó y aún no
 *  está ledgereado. Lanza si el tope se rebasa — eso ABORTA la corrida. */
async function ledgerearCostos(quien: string): Promise<number> {
  const { data, error } = await db.from('llm_costo')
    .select('id, fase, modelo, tokens_in, tokens_out, costo_usd')
    .eq('tenant_id', TENANT_QA_ID);
  if (error) throw new Error(`no se pudo leer llm_costo: ${error.message}`);
  let suma = 0;
  for (const fila of data ?? []) {
    const id = String(fila.id);
    if (idsLedgereados.has(id)) continue;
    idsLedgereados.add(id);
    // Los 'whatsapp' salen por el cliente Meta FALSO: no son gasto real.
    if (fila.fase === 'whatsapp') continue;
    const costo = Number(fila.costo_usd);
    suma += costo;
    registrarUso(FECHA, `${quien}/${fila.fase}`, String(fila.modelo), Number(fila.tokens_in), Number(fila.tokens_out), costo);
  }
  return suma;
}

async function filasDelTenant(): Promise<Record<string, unknown[]>> {
  const dump: Record<string, unknown[]> = {};
  for (const tabla of ['viaje', 'gasto', 'liquidacion', 'comprobante_huerfano']) {
    const { data, error } = await db.from(tabla).select('*').eq('tenant_id', TENANT_QA_ID);
    dump[tabla] = error ? [{ error: error.message }] : (data ?? []);
  }
  return dump;
}

async function hayLiquidacion(viajeId: string): Promise<boolean> {
  const { data } = await db.from('liquidacion').select('id').eq('tenant_id', TENANT_QA_ID).eq('viaje_id', viajeId).maybeSingle();
  return Boolean(data);
}

function guardarEvidencia(
  esc: { ataque: Ataque }, rep: number,
  contenidos: Record<string, unknown>,
  pngs: Record<string, string> = {},
  familia: 'operador' | 'fuzzing' | 'chaos' = 'operador',
): string {
  const dir = dirEvidencia(FECHA, esc.ataque, rep, familia);
  mkdirSync(dir, { recursive: true });
  for (const [nombre, contenido] of Object.entries(contenidos)) {
    writeFileSync(join(dir, `${nombre}.json`), JSON.stringify(contenido, null, 2));
  }
  for (const [nombre, dataUrl] of Object.entries(pngs)) {
    writeFileSync(join(dir, `${nombre}.png`), Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
  }
  return dir;
}

/** Lo que el sistema le dijo a ESE teléfono, para el oráculo #5. */
function textosDe(salientes: MensajeSaliente[], tel: string): string[] {
  return salientes.filter((m) => m.para === tel).map((m) => m.texto);
}

// ── Ejecución de UNA repetición de UN ataque ───────────────────────────────

async function correrRep(esc: EscenarioOperador, rep: number): Promise<ResultadoRep> {
  await limpiarHijosTenant();
  drenarSalientes();   // tira restos de una repetición anterior
  const bit = await capturarBitacora();
  const veredictos: VeredictoOraculo[] = [];
  let nota: string | undefined;
  const pngs: Record<string, string> = {};
  // TODO lo que el sistema le contestó al chofer en esta repetición — se
  // acumula aquí para que los oráculos Y la evidencia vean lo mismo.
  const salientes: MensajeSaliente[] = [];
  const acumular = () => { salientes.push(...drenarSalientes()); };
  const textosPara = (tel: string) =>
    salientes.filter((m) => m.para === tel).map((m) => m.texto);

  try {
    const [tel1, tel2] = TELEFONOS_QA;
    const op1 = await operadorPorTelefono(tel1);

    if (esc.ataque === 'foto_duplicada') {
      const op2 = await operadorPorTelefono(tel2);
      const v1 = await sembrarViaje({ operadorId: op1, folio: esc.folioViaje, anticipo: esc.anticipo, fechaInicio: esc.fechaInicioViaje, estatus: 'abierto' });
      const v2 = await sembrarViaje({ operadorId: op2, folio: esc.folioViaje2!, anticipo: esc.anticipo, fechaInicio: esc.fechaInicioViaje, estatus: 'abierto' });
      const dataUrl = await generarTicketPng(esc.tickets[0]);
      pngs['ticket'] = dataUrl;
      const hash = await hashImagen(dataUrl);
      // La MISMA foto, byte a byte: primero al viaje del chofer 1…
      await enviarFoto(tel1, dataUrl, `${esc.ataque}-r${rep}-f1`);
      // …y después al viaje del chofer 2, MISMO tenant. El pre-check del
      // processor mira un solo viaje: el rechazo tiene que venir de la base.
      await enviarFoto(tel2, dataUrl, `${esc.ataque}-r${rep}-f2`);
      veredictos.push(await O.dedup.oraculoDedupComprobante(TENANT_QA_ID, v2, hash));
      veredictos.push(O.bitacora.oraculoBitacoraRegistro(bit.eventos, ['foto.ya_en_otro_viaje']));
      void v1;
    }

    if (esc.ataque === 'post_cierre') {
      const v3 = await sembrarViaje({ operadorId: op1, folio: esc.folioViaje, anticipo: esc.anticipo, fechaInicio: esc.fechaInicioViaje, estatus: 'liquidado' });
      await sembrarLiquidacion(v3, esc.liquidacionSembrada!, esc.fechaCierre!);
      const dataUrl = await generarTicketPng(esc.tickets[0]);
      pngs['ticket'] = dataUrl;
      // El viaje YA está liquidado: la foto llega tarde (fecha 2 días antes
      // del cierre, mandada después del cierre).
      await enviarFoto(tel1, dataUrl, `${esc.ataque}-r${rep}-f1`);
      veredictos.push(await O.huerfano.oraculoHuerfanoPostCierre(TENANT_QA_ID, v3, {
        liqSembrada: esc.liquidacionSembrada!,
        montoTicket: esc.tickets[0].monto,
      }));
      veredictos.push(O.bitacora.oraculoBitacoraRegistro(bit.eventos, ['huerfano.guardado']));
    }

    if (esc.ataque === 'texto_sin_fotos') {
      const v4 = await sembrarViaje({ operadorId: op1, folio: esc.folioViaje, anticipo: esc.anticipo, fechaInicio: esc.fechaInicioViaje, estatus: 'abierto' });
      await enviarTexto(tel1, esc.textos[0], `${esc.ataque}-r${rep}-t1`);
      acumular();
      veredictos.push(await O.cuadre.oraculoCuadreBalancea(TENANT_QA_ID, v4, { esperaLiquidacion: false }));
      const filas = await filasDelTenant();
      const respaldo = O.cifras.respaldoDesdeFuentes([filas, esc, esc.textos]);
      veredictos.push(O.cifras.oraculoCifrasConFuente(textosPara(tel1), respaldo));
      veredictos.push(O.bitacora.oraculoBitacoraRegistro(bit.eventos, ['agent.run']));
    }

    if (esc.ataque === 'borde_tope') {
      const v5 = await sembrarViaje({ operadorId: op1, folio: esc.folioViaje, anticipo: esc.anticipo, fechaInicio: esc.fechaInicioViaje, estatus: 'abierto' });
      const png1 = await generarTicketPng(esc.tickets[0]);   // tope + 1
      const png2 = await generarTicketPng(esc.tickets[1]);   // tope − 1
      pngs['ticket-tope-mas-1'] = png1;
      pngs['ticket-tope-menos-1'] = png2;
      await enviarFoto(tel1, png1, `${esc.ataque}-r${rep}-f1`);
      await enviarFoto(tel1, png2, `${esc.ataque}-r${rep}-f2`);
      await enviarTexto(tel1, esc.textos[0], `${esc.ataque}-r${rep}-t1`);
      if (!(await hayLiquidacion(v5))) {
        // El chofer insiste UNA vez (p. ej. si el agente pidió confirmación).
        nota = 'el primer "listo" no cerró; se insistió una vez';
        await enviarTexto(tel1, esc.textos[0], `${esc.ataque}-r${rep}-t2`);
      }
      acumular();
      veredictos.push(await O.cuadre.oraculoCuadreBalancea(TENANT_QA_ID, v5, {
        esperaLiquidacion: true,
        esperaSobrePolitica: { cuantas: 1, excesoTotal: 1 },
      }));
      const filas = await filasDelTenant();
      const respaldo = O.cifras.respaldoDesdeFuentes([filas, esc, esc.textos]);
      veredictos.push(O.cifras.oraculoCifrasConFuente(textosPara(tel1), respaldo));
      veredictos.push(O.bitacora.oraculoBitacoraRegistro(bit.eventos, ['agent.run']));
    }
  } finally {
    bit.restaurar();
  }

  acumular();   // lo que quedara sin drenar (ataques a/b, o mensajes tardíos)
  const costoUsd = await ledgerearCostos(`${esc.ataque}#rep${rep}`);
  const rutaEvidencia = guardarEvidencia(esc, rep, {
    escenario: esc,
    salientes,
    bitacora: bit.eventos,
    filas: await filasDelTenant(),
    oraculos: veredictos,
  }, pngs);

  return { ataque: esc.ataque, familia: 'operador', rep, veredictos, costoUsd, rutaEvidencia, nota };
}

// ── MODO 4: fuzzing — una repetición ───────────────────────────────────────
//
// Reusa entero el arnés de Fase 1: mismo `processInbound`, mismo Meta falso,
// mismos oráculos. Lo único distinto es lo que se le mete por la puerta.
//
// Los oráculos que se aplican son #1 (el cuadre no puede cerrar sobre una
// entrada que no se pudo leer) y #8 (la bitácora tiene que contar lo que pasó).
// El diseño nombra también un #2 «snapshot consistente»; de los cinco oráculos
// que dejó la Fase 1 ése NO está construido, así que no se cita como si lo
// estuviera: #1 sobre la liquidación es lo que hoy cubre esa pregunta.

async function correrRepFuzz(esc: EscenarioFuzzing, rep: number): Promise<ResultadoRep> {
  await limpiarHijosTenant();
  drenarSalientes();
  const bit = await capturarBitacora();
  const veredictos: VeredictoOraculo[] = [];
  const pngs: Record<string, string> = {};
  const salientes: MensajeSaliente[] = [];
  const acumular = () => { salientes.push(...drenarSalientes()); };

  try {
    const [tel1] = TELEFONOS_QA;
    const op1 = await operadorPorTelefono(tel1);
    const viaje = await sembrarViaje({
      operadorId: op1, folio: esc.folioViaje, anticipo: esc.anticipo,
      fechaInicio: esc.fechaInicioViaje, estatus: 'abierto',
    });

    for (const [i, foto] of esc.fotos.entries()) {
      // La semilla del render sale de la del escenario, no del reloj: la misma
      // foto byte a byte en las 3 repeticiones, que es lo que hace comparable
      // un N/N. Sumarle `i` separa dos fotos del mismo escenario.
      const dataUrl = await generarFotoFuzzPng(foto, esc.seed + i);
      pngs[`${foto.etiqueta}-${i}`] = dataUrl;
      await enviarFoto(tel1, dataUrl, `${esc.ataque}-r${rep}-f${i}`);
    }
    for (const [i, t] of esc.textos.entries()) {
      await enviarTexto(tel1, t, `${esc.ataque}-r${rep}-t${i}`);
    }
    acumular();

    // Con una entrada ilegible, corrupta u hostil, la liquidación NO debe
    // existir: no hay un solo comprobante que se haya podido leer.
    veredictos.push(await O.cuadre.oraculoCuadreBalancea(TENANT_QA_ID, viaje, { esperaLiquidacion: false }));
    const filas = await filasDelTenant();
    const respaldo = O.cifras.respaldoDesdeFuentes([filas, esc, esc.textos]);
    veredictos.push(O.cifras.oraculoCifrasConFuente(textosDe(salientes, tel1), respaldo));
    veredictos.push(O.bitacora.oraculoBitacoraRegistro(bit.eventos, ['agent.run']));
  } finally {
    bit.restaurar();
  }

  acumular();
  const costoUsd = await ledgerearCostos(`${esc.ataque}#rep${rep}`);
  const rutaEvidencia = guardarEvidencia(esc, rep, {
    escenario: esc, salientes, bitacora: bit.eventos,
    filas: await filasDelTenant(), oraculos: veredictos,
  }, pngs, 'fuzzing');

  return { ataque: esc.ataque, familia: 'fuzzing', rep, veredictos, costoUsd, rutaEvidencia };
}

// ── MODO 5: caos — una repetición ──────────────────────────────────────────

async function correrRepCaos(plan: PlanDeCaos, rep: number): Promise<{ resultado: ResultadoRep; despachador: Despachador }> {
  await limpiarHijosTenant();
  drenarSalientes();
  const bit = await capturarBitacora();
  const veredictos: VeredictoOraculo[] = [];
  const salientes: MensajeSaliente[] = [];
  const acumular = () => { salientes.push(...drenarSalientes()); };
  const despachador = crearDespachador(plan);
  // Un ticket LIMPIO y creíble: lo que se ataca aquí no es el dato, es el
  // momento. Si además la foto fuera hostil no se sabría cuál de las dos cosas
  // rompió, y un hallazgo que no se puede atribuir no es reproducible.
  const ticket = { monto: 1234.56, fecha: fechaCorrida(), folio: 'ZZZQA-000001', litros: 47 };

  try {
    const [tel1] = TELEFONOS_QA;
    const op1 = await operadorPorTelefono(tel1);
    // La SIEMBRA va sin caos: si fallara aquí, el escenario no probaría el
    // sistema, probaría que no se pudo montar.
    const viaje = await sembrarViaje({
      operadorId: op1, folio: `ZZZQA-V-${plan.seed % 1_000_000}`, anticipo: 10_000,
      fechaInicio: fechaCorrida(), estatus: 'abierto',
    });
    const dataUrl = await generarTicketPng(ticket);

    caosActivo = despachador;   // ── el caos empieza AQUÍ
    try {
      await enviarFoto(tel1, dataUrl, `${plan.ataque}-r${rep}-f0`);
      await enviarTexto(tel1, 'listo', `${plan.ataque}-r${rep}-t0`);
    } catch (e) {
      // Que `processInbound` LANCE bajo caos es un dato del reporte, no un
      // fallo del arnés: en producción ese throw es un 500 que Meta no
      // reintenta. Se anota y se sigue a los oráculos, que son los que dicen
      // en qué estado quedó la base.
      bit.eventos.push({ nivel: 'error', msg: 'qa.caos.processInbound_lanzo', meta: { error: String(e) } });
    } finally {
      caosActivo = null;        // ── y termina AQUÍ, pase lo que pase
    }
    acumular();

    // La pregunta del caos NO es «¿se cerró?»: con una falla programada puede
    // ser correcto no cerrar. Es «¿quedó la base en un estado que se sostiene?».
    // Eso lo contesta #1: si hay liquidación, tiene que balancear consigo misma
    // Y con `cuadrarDesdeDB`. Una liquidación a medias es el fallo.
    const hay = await hayLiquidacion(viaje);
    veredictos.push(await O.cuadre.oraculoCuadreBalancea(TENANT_QA_ID, viaje, { esperaLiquidacion: hay }));
    const filas = await filasDelTenant();
    const respaldo = O.cifras.respaldoDesdeFuentes([filas, plan, [ticket]]);
    veredictos.push(O.cifras.oraculoCifrasConFuente(textosDe(salientes, tel1), respaldo));
    veredictos.push(O.bitacora.oraculoBitacoraRegistro(bit.eventos, ['agent.run']));
  } finally {
    bit.restaurar();
    caosActivo = null;
  }

  acumular();
  const costoUsd = await ledgerearCostos(`${plan.ataque}#rep${rep}`);
  const rutaEvidencia = guardarEvidencia(plan, rep, {
    escenario: plan,
    caos: { aplicadas: despachador.aplicadas(), sinAplicar: despachador.sinAplicar(), llamadas: despachador.llamadas() },
    salientes, bitacora: bit.eventos,
    filas: await filasDelTenant(), oraculos: veredictos,
  }, {}, 'chaos');

  return {
    resultado: { ataque: plan.ataque, familia: 'chaos', rep, veredictos, costoUsd, rutaEvidencia },
    despachador,
  };
}

// ── Reporte (formato de tabla del diseño §3) ────────────────────────────────

const INVARIANTE_DE = {
  'cuadre_balancea (#1)': { linea: '#1  anticipo − gastos = diferencia', severidad: 'CRÍTICO' },
  'dedup_comprobante (#3)': { linea: '#3  un comprobante = un gasto (dedup)', severidad: 'ALTO' },
  'huerfano_post_cierre (#4)': { linea: '#4  ticket post-cierre → huérfanos', severidad: 'ALTO' },
  'cifras_con_fuente (#5)': { linea: '#5  ninguna cifra sin fuente', severidad: 'MEDIO' },
  'bitacora_registro (#8)': { linea: '#8  bitácora registró lo ocurrido', severidad: 'MEDIO' },
} as const;

function escribirReporte(): string {
  const porOraculo = new Map<string, { ok: number; total: number; noVerif: number; fallosPorAtaque: Map<string, { fallos: number; total: number }> }>();
  for (const r of RESULTADOS) {
    for (const v of r.veredictos) {
      const s = porOraculo.get(v.oraculo) ?? { ok: 0, total: 0, noVerif: 0, fallosPorAtaque: new Map() };
      s.total += 1;
      if (v.estado === 'ok') s.ok += 1;
      if (v.estado === 'no_verificado') s.noVerif += 1;
      const pa = s.fallosPorAtaque.get(r.ataque) ?? { fallos: 0, total: 0 };
      pa.total += 1;
      if (v.estado === 'fallo') pa.fallos += 1;
      s.fallosPorAtaque.set(r.ataque, pa);
      porOraculo.set(v.oraculo, s);
    }
  }
  const filasTabla = Object.entries(INVARIANTE_DE).map(([oraculo, info]) => {
    const s = porOraculo.get(oraculo);
    if (!s) return `${info.linea.padEnd(45)} —        —      (no corrió en esta fase)`;
    const simbolo = s.ok === s.total ? '✅' : s.ok === 0 ? '❌' : '⚠️';
    // «intermitente» SOLO cuando la MISMA semilla dio veredictos distintos.
    // Un invariante que falla N/N en un ataque y pasa N/N en otro no es
    // intermitente: es un bug reproducible de ese ataque, y se nombra.
    const reproducibles = [...s.fallosPorAtaque.entries()]
      .filter(([, pa]) => pa.fallos === pa.total && pa.total > 0)
      .map(([ataque, pa]) => `${ataque} ${pa.fallos}/${pa.total}`);
    const intermitentes = [...s.fallosPorAtaque.entries()]
      .filter(([, pa]) => pa.fallos > 0 && pa.fallos < pa.total)
      .map(([ataque, pa]) => `${ataque} ${pa.fallos}/${pa.total}`);
    const sev = s.ok === s.total ? '—'
      : [
          reproducibles.length ? `${info.severidad} — REPRODUCIBLE en ${reproducibles.join(', ')}` : '',
          intermitentes.length ? `${info.severidad} (intermitente en ${intermitentes.join(', ')})` : '',
        ].filter(Boolean).join(' · ');
    const extra = s.noVerif > 0 ? ` · ${s.noVerif} no verificado(s)` : '';
    return `${info.linea.padEnd(45)} ${simbolo}       ${s.ok}/${s.total}    ${sev}${extra}`;
  });

  const ledger = leerLedgerQA(FECHA);
  const secciones: string[] = [];
  const TODOS: Ataque[] = [...ATAQUES_FASE_1, ...ATAQUES_FUZZING, ...ATAQUES_CAOS];
  for (const ataque of TODOS) {
    const esc = ESCENARIOS.get(ataque);
    const reps = RESULTADOS.filter((r) => r.ataque === ataque);
    if (!esc || reps.length === 0) continue;
    const lineas = [
      `### ${ataque} · modo ${esc.familia}`,
      '',
      `- **Semilla**: \`${esc.semillaTexto}\` → seed mulberry32 \`${esc.seed}\` (misma semilla en las ${reps.length} repeticiones)`,
      `- **Invariantes que dispara**: ${esc.invariantes.join(', ')}`,
      `- **Datos sembrados**: ${esc.sembrado}`,
      '',
      '| rep | oráculo | estado | esperado | real |',
      '|---|---|---|---|---|',
    ];
    for (const r of reps) {
      for (const v of r.veredictos) {
        const e = typeof v.esperado === 'string' ? v.esperado : JSON.stringify(v.esperado);
        const re = typeof v.real === 'string' ? v.real : JSON.stringify(v.real);
        lineas.push(`| ${r.rep} | ${v.oraculo} | ${v.estado === 'ok' ? '✅ ok' : v.estado === 'fallo' ? '❌ fallo' : '⚠️ no verificado'} | ${e.slice(0, 120).replace(/\|/g, '\\|')} | ${re.slice(0, 160).replace(/\|/g, '\\|')} |`);
      }
      if (r.nota) lineas.push(`| ${r.rep} | (nota) | — | — | ${r.nota} |`);
    }
    lineas.push('', `- Costo real: ${reps.map((r) => `rep${r.rep} $${r.costoUsd.toFixed(4)}`).join(' · ')}`);
    lineas.push(`- Evidencia: ${reps.map((r) => `\`${r.rutaEvidencia.replace(process.cwd() + '/', '')}\``).join(' · ')}`);
    secciones.push(lineas.join('\n'));
  }

  const md = `# QA autónomo — corrida del agente Operador — ${FECHA}

Fase 1 del ejército de QA (encargo-fase-1). Tenant sintético \`${TENANT_QA_NOMBRE}\`
(\`${TENANT_QA_ID}\`) sobre el proyecto único de Supabase, con guard \`ZZZ %\`
antes de todo borrado en lote. El LLM explora, el código juzga: cada estado de
esta tabla lo decidió una función pura leyendo la base — nunca un modelo.

\`\`\`
INVARIANTE                                    ESTADO  REPRO  SEVERIDAD
${filasTabla.join('\n')}
\`\`\`

Reproducibilidad N/N = repeticiones de la MISMA semilla con el mismo veredicto.
Un ⚠️ intermitente se reporta con su conteo, no se oculta (diseño §3).

## Ataques

${secciones.join('\n\n')}

## Gasto de la corrida (real, del ledger)

\`\`\`
${resumenLedgerQA(FECHA)}
\`\`\`

Total: $${totalLedgerQA(ledger).toFixed(4)} USD de $${ledger.tope} de tope. Los mensajes de
WhatsApp salieron por el cliente Meta FALSO del arnés (número de prueba de Meta:
un chofer externo no puede escribir) — no hay gasto real de mensajería.

## Limpieza del tenant

${LIMPIEZA_FINAL}
`;
  mkdirSync(dirCorrida(FECHA), { recursive: true });
  const ruta = join(dirCorrida(FECHA), 'operador.md');
  writeFileSync(ruta, md);
  return ruta;
}

// ── Limpieza final ─────────────────────────────────────────────────────────

async function limpiarStorage(): Promise<string[]> {
  const notas: string[] = [];
  for (const bucket of ['comprobantes', 'liquidaciones']) {
    try {
      const raiz = await db.storage.from(bucket).list(TENANT_QA_ID, { limit: 100 });
      if (raiz.error || !raiz.data?.length) continue;
      const rutas: string[] = [];
      for (const entrada of raiz.data) {
        if (entrada.id) { rutas.push(`${TENANT_QA_ID}/${entrada.name}`); continue; }
        const sub = await db.storage.from(bucket).list(`${TENANT_QA_ID}/${entrada.name}`, { limit: 200 });
        for (const f of sub.data ?? []) rutas.push(`${TENANT_QA_ID}/${entrada.name}/${f.name}`);
      }
      if (rutas.length) {
        const rm = await db.storage.from(bucket).remove(rutas);
        notas.push(rm.error
          ? `storage/${bucket}: no se pudieron borrar ${rutas.length} objetos (${rm.error.message})`
          : `storage/${bucket}: ${rutas.length} objetos borrados`);
      }
    } catch (e) {
      notas.push(`storage/${bucket}: limpieza best-effort falló (${e instanceof Error ? e.message : e})`);
    }
  }
  return notas;
}

async function limpiezaFinal(): Promise<string> {
  const notas: string[] = [];
  try {
    await exigirTenantZZZ(db, TENANT_QA_ID);
    notas.push(...await limpiarStorage());
    const del = await db.from('tenant').delete().eq('id', TENANT_QA_ID);
    if (del.error) return `❌ el DELETE del tenant falló: ${del.error.message}`;
    const patron = `${PREFIJO_QA}%`;
    exigirPrefijoQA(patron);
    await db.from('wa_mensaje_procesado').delete().like('wa_message_id', patron);

    const sobras: string[] = [];
    for (const tabla of ['operador', 'viaje', 'gasto', 'liquidacion', 'comprobante_huerfano', 'wa_conversacion', 'llm_costo']) {
      const { count, error } = await db.from(tabla).select('*', { count: 'exact', head: true }).eq('tenant_id', TENANT_QA_ID);
      if (error) sobras.push(`${tabla}: no se pudo contar (${error.message})`);
      else if ((count ?? 0) > 0) sobras.push(`${tabla}: ${count} filas`);
    }
    const { count: claims } = await db.from('wa_mensaje_procesado').select('*', { count: 'exact', head: true }).like('wa_message_id', patron);
    if ((claims ?? 0) > 0) sobras.push(`wa_mensaje_procesado: ${claims} claims ${PREFIJO_QA}*`);

    const detalle = notas.length ? `\n${notas.map((n) => `- ${n}`).join('\n')}` : '';
    return sobras.length === 0
      ? `✅ tenant \`${TENANT_QA_NOMBRE}\` borrado (cascada) y verificado en 0 filas en operador, viaje, gasto, liquidacion, comprobante_huerfano, wa_conversacion y llm_costo; 0 claims \`${PREFIJO_QA}*\`.${detalle}`
      : `⚠️ el tenant se borró pero quedaron sobras: ${sobras.join('; ')}.${detalle}`;
  } catch (e) {
    return `❌ limpieza abortada por el guard o un error: ${e instanceof Error ? e.message : e}`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════

describe('QA autónomo — Fase 1 — agente Operador contra ZZZ QA', () => {
  beforeAll(async () => {
    cargaEnvLocal();
    exigirClaves();
    db = (await import('@/lib/supabase/admin')).supabaseAdmin();
    O = {
      cuadre: await import('./oraculos/cuadre_balancea.oraculo'),
      dedup: await import('./oraculos/dedup_comprobante.oraculo'),
      huerfano: await import('./oraculos/huerfano_post_cierre.oraculo'),
      cifras: await import('./oraculos/cifras_con_fuente.oraculo'),
      bitacora: await import('./oraculos/bitacora_registro.oraculo'),
    };
    hashImagen = (await import('@/lib/likida/intake/hash')).hashImagen;
    await sembrarTenantQA();
  }, 120_000);

  for (const ataque of ATAQUES_FASE_1) {
    test(`ataque ${ataque} — ${REPETICIONES} repeticiones con la misma semilla`, async () => {
      const esc = generarEscenario(FECHA, ataque, 0);
      ESCENARIOS.set(ataque, reportableOperador(esc));
      for (let rep = 1; rep <= REPETICIONES; rep++) {
        const r = await correrRep(esc, rep);
        RESULTADOS.push(r);
        // Fallar CERRADO: un oráculo que no pudo leer la DB no es un "pasó".
        expect(r.veredictos.length).toBeGreaterThan(0);
      }
      // Las expectativas DETERMINÍSTICAS (las decide la base, no un LLM):
      const reps = RESULTADOS.filter((r) => r.ataque === ataque);
      if (ataque === 'foto_duplicada') {
        for (const r of reps) {
          const d = r.veredictos.find((v) => v.oraculo.startsWith('dedup'));
          expect(d?.estado, `dedup rep${r.rep}: ${JSON.stringify(d)}`).toBe('ok');
        }
      }
      if (ataque === 'post_cierre') {
        for (const r of reps) {
          const h = r.veredictos.find((v) => v.oraculo.startsWith('huerfano'));
          expect(h?.estado, `huerfano rep${r.rep}: ${JSON.stringify(h)}`).toBe('ok');
        }
      }
    }, 900_000);
  }

  // ── MODO 4: FUZZING ──────────────────────────────────────────────────────
  for (const ataque of ATAQUES_FUZZING) {
    test(`fuzzing ${ataque} — ${REPETICIONES} repeticiones con la misma semilla`, async () => {
      const esc = generarEscenarioFuzzing(FECHA, ataque, 0);
      ESCENARIOS.set(ataque, reportableFuzz(esc));
      for (let rep = 1; rep <= REPETICIONES; rep++) {
        const r = await correrRepFuzz(esc, rep);
        RESULTADOS.push(r);
        expect(r.veredictos.length).toBeGreaterThan(0);
      }

      // LA EXPECTATIVA DURA DEL MODO 4, y es una sola porque es la que no
      // admite matiz: la cifra que el payload intentó colar NO puede aparecer
      // en un mensaje al chofer. Todo lo demás (si el sistema pide otra foto,
      // si avisa distinto) es criterio de producto y lo juzga el reporte.
      if (esc.montoInyectado !== undefined) {
        for (const r of RESULTADOS.filter((x) => x.ataque === ataque)) {
          const cifras = r.veredictos.find((v) => v.oraculo.startsWith('cifras'));
          expect(
            JSON.stringify(cifras ?? {}),
            `rep${r.rep}: el monto inyectado $${esc.montoInyectado} no puede salir en un mensaje`,
          ).not.toContain(String(esc.montoInyectado));
        }
      }
    }, 900_000);
  }

  // ── MODO 5: CAOS ─────────────────────────────────────────────────────────
  for (const ataque of ATAQUES_CAOS) {
    test(`caos ${ataque} — ${REPETICIONES} repeticiones con la misma semilla`, async () => {
      const plan = programarCaos(FECHA, ataque, 0);
      let ultimo: Despachador | null = null;
      for (let rep = 1; rep <= REPETICIONES; rep++) {
        const { resultado, despachador } = await correrRepCaos(plan, rep);
        RESULTADOS.push(resultado);
        ultimo = despachador;
        expect(resultado.veredictos.length).toBeGreaterThan(0);
      }
      ESCENARIOS.set(ataque, reportableCaos(plan, ultimo));

      // EL ARNÉS TIENE QUE HABER HECHO SU TRABAJO. Si ninguna falla llegó a
      // aplicarse, la corrida no probó caos: probó el camino feliz con un
      // envoltorio puesto, y reportarlo como ✅ sería la mentira exacta que
      // esta máquina existe para evitar.
      expect(
        ultimo?.aplicadas().length ?? 0,
        `ninguna falla programada se aplicó (${JSON.stringify(plan.fallas)}); ` +
        `llamadas por canal: ${JSON.stringify(ultimo?.llamadas())}. ` +
        'Sube el ordinal máximo de `programar()` o revisa el ruteo por host.',
      ).toBeGreaterThan(0);

      // Y el caos NO puede quedarse encendido entre pruebas.
      expect(caosActivo, 'el caos quedó activo después del ataque').toBeNull();
    }, 900_000);
  }

  afterAll(async () => {
    LIMPIEZA_FINAL = await limpiezaFinal();
    const ruta = escribirReporte();
    console.log(`\n═══ REPORTE: ${ruta}`);
    console.log(resumenLedgerQA(FECHA));
    console.log(`═══ LIMPIEZA: ${LIMPIEZA_FINAL}\n`);
  }, 300_000);
});
