// ═══════════════════════════════════════════════════════════════════════════
// EL EXAMEN DORADO DEL OCR (F17). Modos:
//
//   npx tsx scripts/evals/correr-ocr.ts --check            deriva, SIN red (es lo que corre CI vía vitest)
//   npx tsx scripts/evals/correr-ocr.ts                    corre el DOBLE realista y escribe el informe
//   npx tsx scripts/evals/correr-ocr.ts --sabotaje         el doble saboteado: DEBE salir en fallo
//   npx tsx scripts/evals/correr-ocr.ts --congelar-doble   re-congela las lecturas del doble
//   npx tsx scripts/evals/correr-ocr.ts --real --max-usd N corrida REAL (APAGADA: ver ocr-real.ts, D25)
//       con LIKIDA_OCR_CORPUS_REAL_DIR=<carpeta fuera de git> usa el corpus real redactado.
//
// Un doble prueba el arnés, no al modelo. Solo --real mide al proveedor.
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CORPUS_SINTETICO } from '../../src/lib/evals/ocr-corpus';
import { ManifiestoOcrSchema, mensajeDeriva, verificarDeriva, type ManifiestoOcr } from '../../src/lib/evals/ocr-congelado';
import { huellaOcrViva } from '../../src/lib/evals/ocr-huella';
import { calificarCorrida, correrLector, informeTexto, lectorDoble } from '../../src/lib/evals/ocr-corrida';
import { lineaBaseDe } from '../../src/lib/evals/ocr-metricas';
import { CORRIDA_REAL_OCR, cargarCorpusReal, permisoCorridaReal } from '../../src/lib/evals/ocr-real';

const MANIFIESTO = join(process.cwd(), 'src/lib/evals/fixtures/ocr-congelado.json');
const arg = (n: string) => process.argv.includes(n);
const valor = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };

function leerManifiesto(): ManifiestoOcr {
  return ManifiestoOcrSchema.parse(JSON.parse(readFileSync(MANIFIESTO, 'utf8')));
}

async function main() {
  const huella = huellaOcrViva(CORPUS_SINTETICO);

  if (arg('--check')) {
    const m = leerManifiesto();
    const r = verificarDeriva(m, huella, CORPUS_SINTETICO);
    if (!r.ok) { console.error(mensajeDeriva(m, r)); process.exit(1); }
    console.log(`OK: sin deriva (origen del congelado: ${m.origen}).`);
    return;
  }

  if (arg('--real')) {
    const maxUsd = valor('--max-usd') === undefined ? undefined : Number(valor('--max-usd'));
    const permiso = permisoCorridaReal(maxUsd, process.env);
    if (!permiso.permitido) { console.error(`Corrida real NO autorizada: ${permiso.razon}`); process.exit(2); }
    // Recién aquí se importa el cliente del LLM: apagada, ni siquiera se carga.
    const { corridaRealOcr } = await import('./ocr-real-lector');
    const dirReal = process.env[CORRIDA_REAL_OCR.variableCorpusReal];
    const casos = dirReal ? cargarCorpusReal(dirReal, process.cwd()) : [...CORPUS_SINTETICO];
    const origen = dirReal ? 'real_redactado' : 'sintetico_real';
    const res = await corridaRealOcr(casos, permiso.maxUsd!);
    const informe = calificarCorrida(casos, res, origen, lineaBaseDe(calificarCorrida(CORPUS_SINTETICO, await correrLector({ lector: lectorDoble('fiel'), casos: CORPUS_SINTETICO }), 'doble').metricas));
    console.log(informeTexto(informe));
    if (!dirReal && !res.detenidoPorTope) {
      const m: ManifiestoOcr = { version: 1, rol: 'ocr', origen: 'real', perfilDoble: null, congeladoEn: new Date().toISOString().slice(0, 10), huella, costoUsd: res.gastadoUsd, veredicto: informe.compuerta.veredicto, lecturas: res.lecturas };
      writeFileSync(MANIFIESTO, JSON.stringify(m, null, 2) + '\n');
      console.log('Congelado con la corrida real.');
    }
    return;
  }

  const perfil = arg('--sabotaje') ? 'sabotaje' : 'realista';
  const res = await correrLector({ lector: lectorDoble(perfil), casos: CORPUS_SINTETICO });
  const base = lineaBaseDe(calificarCorrida(CORPUS_SINTETICO, await correrLector({ lector: lectorDoble('fiel'), casos: CORPUS_SINTETICO }), 'doble').metricas);
  const informe = calificarCorrida(CORPUS_SINTETICO, res, 'doble', arg('--sabotaje') ? base : null);
  console.log(informeTexto(informe));
  if (arg('--congelar-doble')) {
    const m: ManifiestoOcr = { version: 1, rol: 'ocr', origen: 'doble', perfilDoble: perfil, congeladoEn: new Date().toISOString().slice(0, 10), huella, costoUsd: null, veredicto: informe.compuerta.veredicto, lecturas: res.lecturas };
    writeFileSync(MANIFIESTO, JSON.stringify(m, null, 2) + '\n');
    console.log(`Congelado el doble «${perfil}» en ${MANIFIESTO}`);
  }
  if (arg('--sabotaje')) {
    if (informe.compuerta.veredicto !== 'fallo') { console.error('EL EXAMEN ESTÁ ROTO: el doble saboteado no salió en fallo.'); process.exit(1); }
    console.log('Bien: el doble saboteado sale en FALLO (el examen sí discrimina).');
  } else if (informe.compuerta.veredicto === 'fallo') process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
