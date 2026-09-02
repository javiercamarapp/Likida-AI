// ═══════════════════════════════════════════════════════════════════════════
// MIDE LA EXTRACCIÓN REAL (extraerComprobante) CONTRA LA VERDAD-DE-TERRENO —
// el banco entero, con la MISMA vara del carril completo, sin sembrar tenant.
//
//   OPENROUTER_API_KEY=… npx tsx scripts/qa/medir-extraccion.ts <rotulo>
//   … [--fotos=N]  [--contra=<rotulo-previo>]
//
// PARA QUÉ EXISTE. Subir la precisión exige medir ANTES y DESPUÉS de cada
// cambio de prompt/esquema, con las mismas 90 fotos y la misma vara. La
// corrida del panel mide de punta a punta pero cuesta sembrar un tenant y
// pasar por WhatsApp; esto llama a `extraerComprobante` —LA función de
// producción, sin copia— directo sobre los bytes del banco y aplica EXACTA la
// semántica de persistencia del medidor de corridas (qa-medicion.ts):
//
//   · legible            → se mediría el gasto persistido → `medir`
//   · no legible / solo_pago / solo_codigo → producción NO persiste →
//     `medirSinGasto` (la clase del papel decide: negativo rechazado = ok,
//     voucher = diseño, ticket = error de punta a punta)
//   · fallo_tecnico      → 7 campos sin medir, con el motivo
//
// LO QUE NO CUBRE, dicho: el tramo processInbound (dedup, políticas, huérfanos)
// no corre aquí. Para el número OFICIAL, la corrida del panel sigue mandando;
// esto es el instrumento de iteración.
//
// GASTA DINERO DE MODELO (≈$0.15 por pasada de 90). Tope duro de $1 USD por
// corrida del script: al tocarlo PARA y lo dice — jamás se gasta a ciegas.
// Cada pasada se guarda como JSON (rotulado) para comparar contra la anterior
// con `--contra=`. Nada de esto escribe en qa_foto_lectura.
// ═══════════════════════════════════════════════════════════════════════════

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { supabaseAdmin } from '../../src/lib/supabase/admin';
import { leerManifiesto, dataUrlDeFoto } from '../../src/lib/admin/qa-storage';
import { extraerComprobante } from '../../src/lib/likida/intake/ocr';
import {
  medir, medirSinGasto, medicionSinLeer, ocrLeidoDeGasto, ocrVacio, resumenPrecision,
  type Medicion, type MedicionFotoResumen, type ResumenPrecisionCorrida, type OcrLeido,
} from '../../src/lib/admin/qa-verdad';
import { NOMBRE_CLAVE_VERDAD, CLAVES_VERDAD } from '../../src/lib/admin/qa-tipos';

const TOPE_USD = 1.0;
const DIR = join(process.cwd(), '.mediciones-extraccion');

const ARGS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const opt = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');

function pct(v: number | null): string {
  return v === null ? 'sin medir' : `${(v * 100).toFixed(1)}%`;
}

/** Cada foto guarda TAMBIÉN el crudo (`ocrLeido`): con él, una regla nueva de
 *  comparación se re-aplica sobre pasadas viejas sin volver a gastar en el
 *  modelo — el mismo criterio que `qa_foto_lectura.ocr_leido` (0239). */
type FotoPasada = MedicionFotoResumen & { ocrLeido?: OcrLeido };

interface Pasada {
  rotulo: string;
  cuando: string;
  costoUsd: number;
  fotos: FotoPasada[];
}

function imprimir(r: ResumenPrecisionCorrida, contra: ResumenPrecisionCorrida | null): void {
  const d = (a: number | null, b: number | null | undefined) =>
    a === null || b === null || b === undefined ? '' : `  (${a - b >= 0 ? '+' : ''}${((a - b) * 100).toFixed(1)} pts)`;
  console.log(`\nGlobal: ${pct(r.global.exactitud)}${d(r.global.exactitud, contra?.global.exactitud)}  ✅ ${r.global.ok} · ❌ ${r.global.mal} sobre ${r.global.medidos}; ${r.global.noMedidos} fuera del denominador`);
  console.log(`Fiscales (rfc, folio, monto, fecha): ${pct(r.fiscales.exactitud)}${d(r.fiscales.exactitud, contra?.fiscales.exactitud)}  ·  Descriptivos (emisor, sucursal, dominio): ${pct(r.descriptivos.exactitud)}${d(r.descriptivos.exactitud, contra?.descriptivos.exactitud)}`);
  console.log('\nPor campo:');
  for (const c of r.porCampo) {
    const antes = contra?.porCampo.find((x) => x.clave === c.clave);
    console.log(`  ${NOMBRE_CLAVE_VERDAD[c.clave].padEnd(24)} ${pct(c.exactitud).padStart(9)}${d(c.exactitud, antes?.exactitud)}  ✅ ${String(c.ok).padStart(3)} · ❌ ${String(c.mal).padStart(3)} · s/m ${String(c.noMedidos).padStart(3)}`);
  }
  console.log(`\nNegativos: ${r.negativos.fotos} — ${r.negativos.conAlucinacion === 0 ? '✅ TODOS rechazados, 0 alucinaciones (el candado aguanta)' : `❌ ${r.negativos.conAlucinacion} con alucinación (${r.negativos.camposAlucinados} campos) — EL CANDADO SE ROMPIÓ`}`);
  console.log(`Alucinaciones totales: ${r.alucinaciones}`);
}

async function main(): Promise<number> {
  const rotulo = ARGS[0];
  if (!rotulo || !/^[\w.-]{1,40}$/.test(rotulo)) {
    console.error('Uso: npx tsx scripts/qa/medir-extraccion.ts <rotulo> [--fotos=N] [--contra=<rotulo>]');
    return 1;
  }
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('Falta OPENROUTER_API_KEY: sin llave no hay modelo que medir.');
    return 1;
  }
  mkdirSync(DIR, { recursive: true });

  const db = supabaseAdmin();
  const manifiesto = await leerManifiesto(db);
  if (!manifiesto.ok) {
    console.error(`No se pudo leer el banco: ${manifiesto.error}`);
    return 1;
  }
  const tope = Number(opt('fotos') ?? Infinity);
  const conVerdad = manifiesto.datos.filter((f) => f.ocrEsperado !== null).slice(0, tope);
  console.log(`${conVerdad.length} fotos con verdad-de-terreno. Tope de gasto: $${TOPE_USD.toFixed(2)} USD.`);

  let costoTotal = 0;
  const fotos: FotoPasada[] = [];
  for (const [i, foto] of conVerdad.entries()) {
    if (costoTotal >= TOPE_USD) {
      console.error(`⛔ TOPE de $${TOPE_USD} tocado tras ${i} fotos — PARA aquí. Las restantes NO se midieron.`);
      break;
    }
    const verdad = foto.ocrEsperado!;
    let medicion: Medicion;
    let motivo: string | null = null;
    let modelo = 'sin-llamada';
    let costo = 0;
    let leido = ocrVacio();
    try {
      const { dataUrl } = await dataUrlDeFoto(db, foto);
      const r = await extraerComprobante(dataUrl);
      modelo = r.costo.modelo;
      costo = r.costo.costoUsd;
      costoTotal += Number.isFinite(costo) ? Math.max(0, costo) : 0;
      if (r.motivo === 'fallo_tecnico') {
        medicion = medicionSinLeer('fallo técnico del extractor: el modelo no llegó a leer la foto');
        motivo = 'fallo_tecnico';
      } else if (r.legible) {
        leido = ocrLeidoDeGasto(r.gasto);
        medicion = medir(verdad, leido);
      } else {
        // Producción NO persistiría este papel (ilegible / voucher /
        // acercamiento): misma semántica que el medidor de corridas.
        medicion = medirSinGasto(verdad);
        motivo = `no persistido: ${r.motivo ?? 'no legible'}`;
      }
    } catch (e) {
      medicion = medicionSinLeer(`la foto no se pudo bajar o el extractor lanzó: ${e instanceof Error ? e.message : String(e)}`);
      motivo = 'error';
    }
    fotos.push({
      fotoId: foto.id, etiqueta: foto.etiqueta, clase: verdad.clase,
      medicion, modelo, motivo, costoUsd: costo, ocrLeido: leido,
    });
    // La suma SIEMPRE es 7 — misma garantía que el CHECK de la 0239.
    const m = medicion;
    if (m.camposOk + m.camposMal + m.camposNoMedidos !== 7) {
      console.error(`BUG: la medición de ${foto.etiqueta} no suma 7 — se aborta para no reportar una cifra rota.`);
      return 1;
    }
    process.stdout.write(`\r${i + 1}/${conVerdad.length} · $${costoTotal.toFixed(4)}   `);
  }
  console.log('');

  const resumen = resumenPrecision(fotos);
  const pasada: Pasada = { rotulo, cuando: new Date().toISOString(), costoUsd: costoTotal, fotos };
  const ruta = join(DIR, `${rotulo}.json`);
  writeFileSync(ruta, JSON.stringify(pasada, null, 1));

  let contra: ResumenPrecisionCorrida | null = null;
  const rotuloContra = opt('contra');
  if (rotuloContra) {
    const rutaContra = join(DIR, `${rotuloContra}.json`);
    if (!existsSync(rutaContra)) {
      console.error(`No existe la pasada "${rotuloContra}" para comparar.`);
    } else {
      const previa = JSON.parse(readFileSync(rutaContra, 'utf8')) as Pasada;
      contra = resumenPrecision(previa.fotos);
      console.log(`\nContra "${rotuloContra}" (${previa.cuando}):`);
    }
  }
  imprimir(resumen, contra);
  console.log(`\nCosto de esta pasada: $${costoTotal.toFixed(4)} USD · guardada en ${ruta}`);

  // Los cambios de campo, foto por foto, contra la pasada previa — para ver
  // QUÉ se movió y no solo cuánto.
  if (contra && rotuloContra) {
    const previa = JSON.parse(readFileSync(join(DIR, `${rotuloContra}.json`), 'utf8')) as Pasada;
    const antesPorFoto = new Map(previa.fotos.map((f) => [f.fotoId, f]));
    console.log('\nCambios campo a campo (solo los que cambiaron de veredicto):');
    for (const f of fotos) {
      const a = antesPorFoto.get(f.fotoId);
      if (!a) continue;
      for (const clave of CLAVES_VERDAD) {
        const va = a.medicion.campos.find((c) => c.clave === clave)?.veredicto;
        const vb = f.medicion.campos.find((c) => c.clave === clave)?.veredicto;
        if (va !== vb) console.log(`  ${f.etiqueta} · ${clave}: ${va} → ${vb}`);
      }
    }
  }
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => {
  console.error(`Error no anticipado: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
