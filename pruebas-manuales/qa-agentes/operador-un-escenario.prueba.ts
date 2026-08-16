// ═══════════════════════════════════════════════════════════════════════════
// ARNÉS DE DEPURACIÓN — UN escenario del agente Operador, UNA repetición.
//
// Para depurar un ataque sin pagar la corrida completa del orquestador.
// Hace llamadas REALES de pago (OCR; y agente de cuadre si el ataque las
// necesita) — NO corre en `npm test` (regla de pruebas-manuales/).
//
// USO
//   npx vitest run --config vitest.qa.config.ts \
//     pruebas-manuales/qa-agentes/operador-un-escenario.prueba.ts
//   QA_ATAQUE=post_cierre|texto_sin_fotos|borde_tope para elegir otro ataque
//   (default: foto_duplicada, el más barato — puro OCR, sin agente).
// ═══════════════════════════════════════════════════════════════════════════

import { test, expect } from 'vitest';
import {
  cargaEnvLocal, exigirClaves, exigirTenantZZZ, exigirPrefijoQA,
  TENANT_QA_ID, TENANT_QA_NOMBRE, TELEFONOS_QA, PREFIJO_QA,
  fechaCorrida, type VeredictoOraculo,
} from '../../scripts/qa-agentes/config.qa';
import {
  generarEscenario, ATAQUES_FASE_1, type AtaqueOperador,
} from '../../scripts/qa-agentes/escenarios/operador.escenarios';
import {
  instalarMetaFalso, generarTicketPng, capturarBitacora, enviarFoto, enviarTexto,
  drenarSalientes,
} from '../../scripts/qa-agentes/agentes/operador.qa';

// El mock ANTES de cualquier import de src/ (los oráculos van dinámicos).
instalarMetaFalso();

const ATAQUE = (process.env.QA_ATAQUE ?? 'foto_duplicada') as AtaqueOperador;

test(`arnés: un escenario de ${ATAQUE}, una repetición, con limpieza`, async () => {
  expect(ATAQUES_FASE_1, `QA_ATAQUE inválido: ${ATAQUE}`).toContain(ATAQUE);
  cargaEnvLocal();
  exigirClaves();
  const { supabaseAdmin } = await import('@/lib/supabase/admin');
  const db = supabaseAdmin();
  const O = {
    cuadre: await import('../../scripts/qa-agentes/oraculos/cuadre_balancea.oraculo'),
    dedup: await import('../../scripts/qa-agentes/oraculos/dedup_comprobante.oraculo'),
    huerfano: await import('../../scripts/qa-agentes/oraculos/huerfano_post_cierre.oraculo'),
    cifras: await import('../../scripts/qa-agentes/oraculos/cifras_con_fuente.oraculo'),
    bitacora: await import('../../scripts/qa-agentes/oraculos/bitacora_registro.oraculo'),
  };
  const { hashImagen } = await import('@/lib/likida/intake/hash');

  // ── Siembra mínima (mismos datos que el orquestador) ──────────────────────
  const previo = await db.from('tenant').select('id').eq('id', TENANT_QA_ID).maybeSingle();
  if (previo.data) {
    await exigirTenantZZZ(db, TENANT_QA_ID);
    await db.from('tenant').delete().eq('id', TENANT_QA_ID);
  }
  const insTenant = await db.from('tenant').insert({
    id: TENANT_QA_ID, nombre: TENANT_QA_NOMBRE, plan: 'demo',
    razon_social: 'ZZZ QA SA DE CV',
    domicilio_fiscal: 'Carretera Sintetica QA SN, Monterrey NL',
    config: { politica: [{ concepto: 'diesel', topeMonto: 4000 }, { concepto: 'caseta', topeMonto: 1500 }] },
  });
  expect(insTenant.error, insTenant.error?.message).toBeNull();
  const insOps = await db.from('operador').insert(TELEFONOS_QA.map((tel, i) => ({
    tenant_id: TENANT_QA_ID, nombre: `ZZZ QA Chofer ${i + 1}`, telefono: tel, activo: true,
  })));
  expect(insOps.error, insOps.error?.message).toBeNull();
  const opId = async (tel: string) =>
    (await db.from('operador').select('id').eq('tenant_id', TENANT_QA_ID).eq('telefono', tel).single()).data!.id as string;
  const viaje = async (operadorId: string, folio: string, anticipo: number, fechaInicio: string, estatus: string) => {
    const r = await db.from('viaje').insert({
      tenant_id: TENANT_QA_ID, operador_id: operadorId, folio,
      origen: 'ZZZ Origen QA', destino: 'ZZZ Destino QA', anticipo,
      // aceptado_en exige avisado_en (constraint viaje_aceptado_requiere_aviso).
      fecha_inicio: fechaInicio, estatus, aceptado_en: new Date().toISOString(), avisado_en: new Date().toISOString(),
    }).select('id').single();
    expect(r.error, r.error?.message).toBeNull();
    return r.data!.id as string;
  };

  const esc = generarEscenario(fechaCorrida(), ATAQUE, 0);
  console.log('\n═══ escenario:', JSON.stringify(esc, null, 2));

  const [tel1, tel2] = TELEFONOS_QA;
  const bit = await capturarBitacora();
  const veredictos: VeredictoOraculo[] = [];
  try {
    const op1 = await opId(tel1);
    if (ATAQUE === 'foto_duplicada') {
      const op2 = await opId(tel2);
      await viaje(op1, esc.folioViaje, esc.anticipo, esc.fechaInicioViaje, 'abierto');
      const v2 = await viaje(op2, esc.folioViaje2!, esc.anticipo, esc.fechaInicioViaje, 'abierto');
      const dataUrl = await generarTicketPng(esc.tickets[0]);
      const hash = await hashImagen(dataUrl);
      await enviarFoto(tel1, dataUrl, 'arnes-f1');
      await enviarFoto(tel2, dataUrl, 'arnes-f2');
      veredictos.push(await O.dedup.oraculoDedupComprobante(TENANT_QA_ID, v2, hash));
      veredictos.push(O.bitacora.oraculoBitacoraRegistro(bit.eventos, ['foto.ya_en_otro_viaje']));
    } else if (ATAQUE === 'post_cierre') {
      const v3 = await viaje(op1, esc.folioViaje, esc.anticipo, esc.fechaInicioViaje, 'liquidado');
      const liq = esc.liquidacionSembrada!;
      const insLiq = await db.from('liquidacion').insert({
        tenant_id: TENANT_QA_ID, viaje_id: v3, total_comprobado: liq.totalComprobado,
        total_anticipo: liq.totalAnticipo, diferencia: liq.diferencia,
        estatus: 'cuadrada', diferencias: [], created_at: `${esc.fechaCierre}T18:00:00Z`,
      });
      expect(insLiq.error, insLiq.error?.message).toBeNull();
      await enviarFoto(tel1, await generarTicketPng(esc.tickets[0]), 'arnes-f1');
      veredictos.push(await O.huerfano.oraculoHuerfanoPostCierre(TENANT_QA_ID, v3, {
        liqSembrada: liq, montoTicket: esc.tickets[0].monto,
      }));
      veredictos.push(O.bitacora.oraculoBitacoraRegistro(bit.eventos, ['huerfano.guardado']));
    } else if (ATAQUE === 'texto_sin_fotos') {
      const v4 = await viaje(op1, esc.folioViaje, esc.anticipo, esc.fechaInicioViaje, 'abierto');
      await enviarTexto(tel1, esc.textos[0], 'arnes-t1');
      veredictos.push(await O.cuadre.oraculoCuadreBalancea(TENANT_QA_ID, v4, { esperaLiquidacion: false }));
      veredictos.push(O.bitacora.oraculoBitacoraRegistro(bit.eventos, ['agent.run']));
    } else {
      const v5 = await viaje(op1, esc.folioViaje, esc.anticipo, esc.fechaInicioViaje, 'abierto');
      await enviarFoto(tel1, await generarTicketPng(esc.tickets[0]), 'arnes-f1');
      await enviarFoto(tel1, await generarTicketPng(esc.tickets[1]), 'arnes-f2');
      await enviarTexto(tel1, esc.textos[0], 'arnes-t1');
      veredictos.push(await O.cuadre.oraculoCuadreBalancea(TENANT_QA_ID, v5, {
        esperaLiquidacion: true, esperaSobrePolitica: { cuantas: 1, excesoTotal: 1 },
      }));
      veredictos.push(O.bitacora.oraculoBitacoraRegistro(bit.eventos, ['agent.run']));
    }
  } finally {
    bit.restaurar();
  }

  console.log('\n═══ lo que el sistema contestó:');
  for (const m of drenarSalientes()) console.log(`  [${m.tipo} → ${m.para}]`, m.texto.slice(0, 200));
  console.log('\n═══ veredictos:');
  for (const v of veredictos) console.log(' ', JSON.stringify(v, null, 2));

  // ── Limpieza total, detrás del guard ──────────────────────────────────────
  await exigirTenantZZZ(db, TENANT_QA_ID);
  const del = await db.from('tenant').delete().eq('id', TENANT_QA_ID);
  expect(del.error, del.error?.message).toBeNull();
  const patron = `${PREFIJO_QA}%`;
  exigirPrefijoQA(patron);
  await db.from('wa_mensaje_procesado').delete().like('wa_message_id', patron);

  expect(veredictos.length).toBeGreaterThan(0);
}, 900_000);
