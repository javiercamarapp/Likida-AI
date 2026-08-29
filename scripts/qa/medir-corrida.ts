// ═══════════════════════════════════════════════════════════════════════════
// MIDE UNA CORRIDA DEL PANEL DE QA CONTRA LA VERDAD-DE-TERRENO — sin gastar
// un centavo de modelo: la evidencia son los `gasto` que la corrida ya
// persistió en su tenant sintético (por eso solo funciona si el tenant se
// CONSERVÓ — retención o aborto — y el guard lo dice si no).
//
//   npx tsx scripts/qa/medir-corrida.ts <corridaId>            ← ensayo: solo imprime
//   npx tsx scripts/qa/medir-corrida.ts <corridaId> --aplicar  ← escribe qa_foto_lectura
//
// Existe por el agujero medido del 28-ago-2026: el carril completo procesó
// las 90 fotos reales ($0.29 de modelo, qa_corrida_foto = 90) y
// `qa_foto_lectura` quedó en CERO — el motor de entonces no medía. El motor
// ya mide solo (fase de oráculos, qa-motor.ts); este script es (a) el
// respaldo para corridas viejas cuyo tenant sobrevive y (b) la forma de
// RE-medir una corrida cuando cambie una regla de comparación, gratis,
// porque el crudo está guardado.
//
// LA IDEMPOTENCIA ES DE LA BASE (índice único parcial de la 0246): correrlo
// dos veces no duplica una fila — la segunda pasada rebota con 23505 y se
// reporta como "ya medida". Sin `--aplicar` NO escribe nada.
//
// Los números se imprimen con su denominador y sus fuera-de-denominador:
// `exactitud null` se dice "sin medir", jamás 0%.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../../src/lib/supabase/admin';
import { leerCorrida, leerManifiesto } from '../../src/lib/admin/qa-storage';
import { medirCorrida, prepararMedicionCorrida, resumenDeLecturas } from '../../src/lib/admin/qa-medicion';
import { NOMBRE_CLAVE_VERDAD } from '../../src/lib/admin/qa-tipos';
import type { ResumenPrecisionCorrida } from '../../src/lib/admin/qa-verdad';

const APLICAR = process.argv.includes('--aplicar');
const ARGS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pct(v: number | null): string {
  // `null` jamás se vuelve 0: sin campos medidos no hay porcentaje que decir.
  return v === null ? 'sin medir' : `${(v * 100).toFixed(1)}%`;
}

function imprimirResumen(r: ResumenPrecisionCorrida): void {
  console.log('\n── LA PRECISIÓN, MEDIDA ─────────────────────────────────────');
  console.log(`Global: ${pct(r.global.exactitud)}  (✅ ${r.global.ok} · ❌ ${r.global.mal} sobre ${r.global.medidos} campos con vara; ${r.global.noMedidos} fuera del denominador)`);
  console.log(`Fiscales (rfc, folio, monto, fecha): ${pct(r.fiscales.exactitud)}  ·  Descriptivos (emisor, sucursal, dominio): ${pct(r.descriptivos.exactitud)}`);
  console.log('\nPor campo (el peor vale más que el global):');
  for (const c of r.porCampo) {
    console.log(`  ${NOMBRE_CLAVE_VERDAD[c.clave].padEnd(24)} ${pct(c.exactitud).padStart(9)}  ✅ ${String(c.ok).padStart(3)} · ❌ ${String(c.mal).padStart(3)} · sin medir ${String(c.noMedidos).padStart(3)}`);
  }
  console.log(`\nNegativos (papeles que NO son comprobante): ${r.negativos.fotos} en la corrida`);
  console.log(r.negativos.fotos === 0
    ? '  esta corrida no trae casos negativos'
    : r.negativos.conAlucinacion === 0
      ? '  ✅ los rechazó TODOS — nada inventado entró al sistema (el veredicto correcto)'
      : `  ❌ ${r.negativos.conAlucinacion} con alucinación (${r.negativos.camposAlucinados} campo(s) inventados sobre papel sin nada que leer)`);
  console.log(`Alucinaciones en toda la corrida: ${r.alucinaciones} campo(s)`);
  if (r.noMedidosPorMotivo.length > 0) {
    console.log('\nFuera del denominador, por su razón:');
    for (const m of r.noMedidosPorMotivo) {
      console.log(`  · ${m.campos} campo(s): ${m.motivo}`);
    }
  }
}

async function main(): Promise<number> {
  const corridaId = ARGS[0];
  if (!corridaId || !UUID.test(corridaId)) {
    console.error('Uso: npx tsx scripts/qa/medir-corrida.ts <corridaId> [--aplicar]');
    return 1;
  }

  const db = supabaseAdmin();
  const corrida = await leerCorrida(db, corridaId);
  if (!corrida.ok) {
    console.error(`No se pudo leer la corrida: ${corrida.error}`);
    return 1;
  }
  if (corrida.datos === null) {
    console.error(`La corrida ${corridaId} no existe.`);
    return 1;
  }
  console.log(`Corrida ${corridaId} — escenario "${corrida.datos.escenario}", carril ${corrida.datos.carril}, estado ${corrida.datos.estado}, ${corrida.datos.parametros.fotoIds.length} fotos, $${corrida.datos.costoUsdTotal.toFixed(4)} USD medidos.`);

  if (!APLICAR) {
    const prep = await prepararMedicionCorrida(db, corrida.datos);
    if (!prep.ok) {
      console.error(`La medición no se puede hacer: ${prep.error}`);
      return 1;
    }
    console.log(`\nENSAYO — nada se escribió. Se prepararían ${prep.datos.lecturas.length} lecturas (modelo: ${prep.datos.modeloOcr}).`);
    for (const f of prep.datos.fallos) console.log(`  ⚠️ ${f}`);
    imprimirResumen(resumenDeLecturas(
      prep.datos.lecturas.map((l, i) => ({
        id: `ensayo-${i}`, fotoId: l.fotoId, corridaId, corridaEn: new Date().toISOString(),
        modelo: l.modelo, ocrLeido: l.ocrLeido, medicion: l.medicion,
        camposOk: l.medicion.camposOk, camposMal: l.medicion.camposMal,
        camposNoMedidos: l.medicion.camposNoMedidos, costoUsd: l.costoUsd, motivo: l.motivo,
      })),
      prep.datos.fotosBanco,
    ));
    console.log('\nPara escribirlo en qa_foto_lectura: agrega --aplicar');
    return 0;
  }

  const med = await medirCorrida(db, corrida.datos);
  if (!med.ok) {
    console.error(`La medición no se pudo hacer: ${med.error}`);
    return 1;
  }
  console.log(`\nESCRITO: ${med.datos.medidas} lecturas nuevas, ${med.datos.yaMedidas} ya estaban (rebote del índice de la 0246 — idempotencia, no error).`);
  for (const f of med.datos.fallos) console.log(`  ⚠️ SIN escribir: ${f}`);
  const banco = await leerManifiesto(db);
  imprimirResumen(resumenDeLecturas(med.datos.lecturas, banco.ok ? banco.datos : []));
  return med.datos.fallos.length > 0 ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error(`Error no anticipado: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
