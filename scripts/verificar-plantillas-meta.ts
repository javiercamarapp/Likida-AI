// ═══════════════════════════════════════════════════════════════════════════
// Verifica (y, con confirmación explícita, somete) las plantillas de WhatsApp del
// catálogo (src/lib/meta/plantillas_catalogo.ts) contra la cuenta de Meta.
//
//   npx tsx scripts/verificar-plantillas-meta.ts                      EN SECO: imprime el plan, NO toca la red
//   npx tsx scripts/verificar-plantillas-meta.ts --consultar          GET: estado de aprobación + desviaciones
//   npx tsx scripts/verificar-plantillas-meta.ts --consultar --crear --confirmo-meta-real
//                                                                     POST de las que Meta NO tiene
//
// Credenciales SOLO del entorno: WHATSAPP_ACCESS_TOKEN y
// WHATSAPP_BUSINESS_ACCOUNT_ID (p. ej. `vercel env run --environment production --`).
// Código de salida: 0 todo usable; 1 hay plantillas no usables/desviadas; 2 uso o credenciales.
// NO se ha ejecutado contra Meta real (ver plantillas_estado.ts).
// ═══════════════════════════════════════════════════════════════════════════
import {
  compararConMeta, consultarPlantillasMeta, crearPlantillaMeta, resumenEstado,
} from '@/lib/meta/plantillas_estado';
import { CATALOGO_PLANTILLAS, validarCatalogo, plantillaDeCatalogo } from '@/lib/meta/plantillas_catalogo';

async function main(argv: string[]): Promise<number> {
  const consultar = argv.includes('--consultar');
  const crear = argv.includes('--crear');
  const confirmado = argv.includes('--confirmo-meta-real');

  const errores = validarCatalogo();
  if (errores.length) { console.error(`Catálogo inválido:\n- ${errores.join('\n- ')}`); return 2; }

  if (crear && !(consultar && confirmado)) {
    console.error('--crear exige --consultar y --confirmo-meta-real (escribe en la cuenta real de Meta).');
    return 2;
  }

  if (!consultar) {
    console.log(`EN SECO — ${CATALOGO_PLANTILLAS.length} plantillas en el catálogo; no se llamó a Meta.`);
    for (const p of CATALOGO_PLANTILLAS) console.log(`  ${p.estado === 'en_uso' ? 'en uso ' : 'nueva  '} ${p.nombre} [${p.idioma}] ${p.categoria}`);
    console.log('\nPara consultar el estado: --consultar (necesita WHATSAPP_ACCESS_TOKEN y WHATSAPP_BUSINESS_ACCOUNT_ID).');
    return 0;
  }

  const token = process.env.WHATSAPP_ACCESS_TOKEN ?? '';
  const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? '';
  if (!token || !wabaId) { console.error('Faltan WHATSAPP_ACCESS_TOKEN / WHATSAPP_BUSINESS_ACCOUNT_ID en el entorno.'); return 2; }
  const cred = { token, wabaId };

  const remotas = await consultarPlantillasMeta(cred, fetch);
  let resultados = compararConMeta(remotas);
  console.log(resumenEstado(resultados));

  if (crear) {
    for (const r of resultados.filter((x) => x.veredicto === 'faltante')) {
      const p = plantillaDeCatalogo(r.nombre);
      if (!p) continue;
      const c = await crearPlantillaMeta(cred, p, fetch);
      console.log(c.ok ? `  → ${r.nombre}: enviada a aprobación (id ${c.id ?? 'sin id'})` : `  → ${r.nombre}: FALLÓ — ${c.error}`);
    }
    resultados = compararConMeta(await consultarPlantillasMeta(cred, fetch));
    console.log('\nDespués de someter:\n' + resumenEstado(resultados));
  }
  return resultados.every((r) => r.veredicto === 'aprobada') ? 0 : 1;
}

main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(2); });
