#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Regenera `archivos-muestra/whatsapp/resumen_esperado.json` con el IMPORTADOR REAL del producto (el lector del Vigía y el análisis del
// histórico), no con las cuentas del generador de muestras.
//
// Antes ese archivo lo escribía `exportar-archivos.mjs` con SUS conteos (su propia taxonomía: «cita», «placas», «documentos» ≠ la del
// producto) y la prueba de muestras traducía entre las dos. Ahora el archivo trae lo que el importador lee de cada chat, con los temas del
// producto, y una prueba (`muestras_importadores_reales.test.ts`) falla si deja de coincidir: si cambias el importador, vuelve a correr esto
// y revisa el diff (y las tablas del guion y del kit, que se calculan del mismo análisis).
//
//   node scripts/demo/innovativos/regenerar-resumen-esperado.mjs          # reescribe el archivo
//   node scripts/demo/innovativos/regenerar-resumen-esperado.mjs --revisar # sale 1 si el archivo no coincide (no escribe)
//
// No usa base de datos ni red: lee los 3 chats de muestra.
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '..', '..', '..');
const muestras = join(aqui, 'archivos-muestra', 'whatsapp');
const { createJiti } = createRequire(import.meta.url)('jiti');
const jiti = createJiti(import.meta.url, { alias: { '@': join(raiz, 'src') }, moduleCache: false });
const { leerExportWhatsapp } = await jiti.import(join(raiz, 'src/lib/likida/vigia/historial/export_whatsapp.ts'));
const { textoDeZip } = await jiti.import(join(raiz, 'src/lib/likida/vigia/historial/zip_lector.ts'));
const { analizarHistorial } = await jiti.import(join(raiz, 'src/lib/likida/vigia/historial/analisis.ts'));

const EQUIPO = ['Despacho Innovativos Demo', 'Servicio a Cliente Demo A', 'Servicio a Cliente Demo B', 'Servicio a Cliente Demo C'];
const GRUPOS = [['afb', 'grupo_afb_silao_ios.txt'], ['arr', 'grupo_arr_ramos_android.txt'], ['cfn', 'grupo_cfn_apodaca_ios.zip']];

export function calcularResumen() {
  const resumen = { _fuente: 'lo calcula el importador real (leerExportWhatsapp + analizarHistorial) con regenerar-resumen-esperado.mjs; no editar a mano' };
  for (const [id, archivo] of GRUPOS) {
    const bytes = new Uint8Array(readFileSync(join(muestras, archivo)));
    let texto;
    if (archivo.endsWith('.zip')) { const z = textoDeZip(bytes); if (!z.ok) throw new Error(`${archivo}: ${z.error}`); texto = z.texto; } else texto = Buffer.from(bytes).toString('utf8');
    const lectura = leerExportWhatsapp(texto, { equipo: EQUIPO, sal: 'prueba' });
    const a = analizarHistorial(lectura.mensajes);
    const por_tema = {};
    for (const t of a.porTema) if (t.mensajes > 0) por_tema[t.tema] = t.mensajes;
    resumen[id] = {
      mensajes: a.mensajes, mensajes_cliente: a.mensajesCliente, mensajes_equipo: a.mensajesEquipo, descartados: lectura.descartados,
      sin_respuesta_10min: a.tiempos.sobreUmbral, mediana_min: a.tiempos.medianaMin, p90_min: a.tiempos.p90Min,
      por_tema, quejas: por_tema.queja ?? 0,
    };
  }
  return `${JSON.stringify(resumen, null, 2)}\n`;
}

const destino = join(muestras, 'resumen_esperado.json');
const nuevo = calcularResumen();
if (process.argv.includes('--revisar')) {
  const actual = readFileSync(destino, 'utf8');
  if (actual !== nuevo) { console.error('resumen_esperado.json NO coincide con lo que lee el importador real: corre regenerar-resumen-esperado.mjs y revisa el diff.'); process.exit(1); }
  console.log('resumen_esperado.json coincide con el importador real.');
} else {
  writeFileSync(destino, nuevo);
  console.log(`escrito ${destino}`);
}
