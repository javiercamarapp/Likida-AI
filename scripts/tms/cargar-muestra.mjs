#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// CARGADOR LOCAL de la muestra `muestra-tms` (P0-1). Corre TODO el flujo real (convertir → recibir → reglas/guardas → póliza provisional →
// Excel → entregas → [revisión humana simulada] → cola de correo) con base, almacén y correo EN MEMORIA: no abre ninguna conexión, no usa
// llaves y no puede enviar un correo de verdad. El «envío» deja los .xlsx y un resumen en una carpeta LOCAL.
//
//   node scripts/tms/cargar-muestra.mjs --muestra ~/ensayo/muestra.json --padron ~/ensayo/padron.json --salida ~/ensayo/salida \
//        [--correos ~/ensayo/correos.json] [--provisional] [--simular-revision]
//
//   muestra.json  el contrato `muestra-tms` ({ formato, version, bitacoras: [...] })
//   padron.json   [{ "numeroEmpleado": "1001", "nombre": "…" }, …]
//   correos.json  { "1001": "operador@ejemplo.invalid", … }  (sin entrada ⇒ el operador queda «sin correo»)
//   --provisional       enciende la perilla «póliza provisional» (la muestra real no trae póliza); sin ella todo se retiene como `sin_poliza`
//   --simular-revision  simula a la persona que revisa y libera lo retenido; sin ella nada sale (así funciona producción)
//
// SEGURIDAD: los archivos de entrada y la carpeta de salida deben estar FUERA del repositorio (la muestra real tiene datos personales y el
// repo es público); las entradas deben tener modo 600. Se imprimen SOLO conteos y claves técnicas: nunca nombres ni importes. La carpeta de
// salida contiene los Excel con los datos de la muestra: queda en modo 700 y es tuya, bórrala al terminar. Códigos: 0 ok · 1 la muestra no
// pasa el contrato · 2 uso o archivo inseguro.
// ═══════════════════════════════════════════════════════════════════════════
import { chmodSync, closeSync, fstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function parsearArgs(argv) {
  const o = { muestra: null, padron: null, correos: null, salida: null, provisional: false, simularRevision: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const val = () => { i += 1; return argv[i] ?? null; };
    if (a === '--muestra') o.muestra = val();
    else if (a === '--padron') o.padron = val();
    else if (a === '--correos') o.correos = val();
    else if (a === '--salida') o.salida = val();
    else if (a === '--provisional') o.provisional = true;
    else if (a === '--simular-revision') o.simularRevision = true;
    else return { error: `Opción desconocida: ${a}` };
  }
  if (!o.muestra || !o.padron || !o.salida) return { error: 'Faltan --muestra, --padron y --salida.' };
  return o;
}

/** ¿La ruta cae dentro del repositorio? (la muestra real nunca debe entrar ni salir ahí). */
export function dentroDelRepo(ruta, raiz = RAIZ) {
  const r = relative(raiz, resolve(ruta));
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
}

function leerJson(ruta, etiqueta, { exigirModo600 }) {
  if (dentroDelRepo(ruta)) throw new Error(`${etiqueta}: la ruta está DENTRO del repositorio. Los datos reales nunca van al repo; ponla fuera (p. ej. ~/ensayo-tms/).`);
  // Un solo descriptor abierto: validar y leer sobre el MISMO archivo (sin comprobar-y-luego-usar por ruta).
  let fd;
  try { fd = openSync(ruta, 'r'); } catch { throw new Error(`${etiqueta}: no se pudo leer el archivo.`); }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new Error(`${etiqueta}: no es un archivo.`);
    if (exigirModo600 && (st.mode & 0o777) !== 0o600) throw new Error(`${etiqueta}: debe tener modo 600 (tiene ${(st.mode & 0o777).toString(8)}). Corrige con chmod 600.`);
    let texto;
    try { texto = readFileSync(fd, 'utf8'); } catch { throw new Error(`${etiqueta}: no se pudo leer el archivo.`); }
    try { return JSON.parse(texto); } catch { throw new Error(`${etiqueta}: no es un JSON válido.`); }
  } finally { closeSync(fd); }
}

async function main() {
  const salir = (c, ...l) => { for (const x of l) console[c === 0 ? 'log' : 'error'](x); process.exit(c); };
  const o = parsearArgs(process.argv.slice(2));
  if (o.error) salir(2, o.error, 'Uso: node scripts/tms/cargar-muestra.mjs --muestra M.json --padron P.json --salida DIR [--correos C.json] [--provisional] [--simular-revision]');
  let muestra; let padron; let correos;
  try {
    muestra = leerJson(o.muestra, 'muestra', { exigirModo600: true });
    padron = leerJson(o.padron, 'padron', { exigirModo600: true });
    correos = o.correos ? leerJson(o.correos, 'correos', { exigirModo600: true }) : {};
    if (dentroDelRepo(o.salida)) throw new Error('salida: la carpeta está DENTRO del repositorio. Elige una fuera (p. ej. ~/ensayo-tms/salida).');
  } catch (e) { salir(2, e instanceof Error ? e.message : 'entrada inválida'); }
  if (!Array.isArray(padron)) salir(2, 'padron: debe ser una lista de { numeroEmpleado, nombre }.');

  const { createJiti } = createRequire(import.meta.url)('jiti');
  const jiti = createJiti(import.meta.url, { alias: { '@': join(RAIZ, 'src') }, moduleCache: false });
  const { ensayarMuestraTms } = await jiti.import(join(RAIZ, 'src/lib/likida/liquidacion_externa/ensayo_local.ts'));
  const r = await ensayarMuestraTms({ muestra, padron, correos, polizaProvisional: o.provisional, simularRevision: o.simularRevision });
  if (!r.ok) salir(1, `La muestra no pasa el contrato: ${r.mensaje}`);

  const dir = resolve(o.salida);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  for (const x of r.excels) { const p = join(dir, x.nombre); writeFileSync(p, x.bytes, { mode: 0o600 }); chmodSync(p, 0o600); }
  const resumen = {
    provisional: o.provisional, revisionSimulada: o.simularRevision, bitacoras: r.bitacoras, conRevision: r.revisiones,
    resultados: r.resultados, excepcionesAbiertas: r.excepcionesAbiertas, liberadas: r.liberadas,
    correosSimulados: r.correos.map((c) => ({ para: c.para, asunto: c.asunto, adjunto: c.adjunto, provisional: c.provisional, revision: c.revision })),
  };
  writeFileSync(join(dir, 'resumen.json'), JSON.stringify(resumen, null, 2), { mode: 0o600 });

  console.log(`Ensayo LOCAL (en memoria; ningún correo real, ninguna base). Perilla póliza provisional: ${o.provisional ? 'ENCENDIDA' : 'apagada'}. Revisión simulada: ${o.simularRevision ? 'sí' : 'no'}.`);
  console.log(`Bitácoras: ${r.bitacoras} · pendientes de revisar por nombre/padrón: ${r.revisiones}`);
  const porEstado = {};
  for (const x of r.resultados) { const k = x.retenida ? `${x.estado}/retenida` : x.estado; porEstado[k] = (porEstado[k] ?? 0) + 1; }
  console.log(`Resultados: ${JSON.stringify(porEstado)}`);
  console.log(`Excepciones abiertas: ${JSON.stringify(r.excepcionesAbiertas)}`);
  console.log(`Liberadas por la revisión simulada: ${r.liberadas} · correos simulados: ${r.correos.length} · Excel escritos: ${r.excels.length}`);
  console.log('Salida (contiene datos personales; bórrala al terminar): carpeta indicada en --salida.');
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
