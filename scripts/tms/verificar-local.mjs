#!/usr/bin/env node
// T-TMS-17 · Verificación LOCAL del conector TMS: login, lectura de 20 bitácoras y validación contra el contrato de
// liquidaciones externas. Imprime SOLO conteos y banderas: nunca un valor, un nombre, una URL ni un importe.
//
//   node scripts/tms/verificar-local.mjs --falso      ensayo contra el servidor sintético en memoria (sin red)
//   TMS_CREDENCIALES_ARCHIVO=/ruta/.env.tms node scripts/tms/verificar-local.mjs
//
// El archivo de credenciales (líneas CLAVE=valor: base_url, usuario, clave, ruta_login opcional) vive FUERA del repo y
// debe tener modo 600; con cualquier otro modo el script se niega a leerlo. Con `TMS_REPORTE_ARCHIVO=/ruta.md` escribe
// además un reporte de solo conteos. Ventana de lectura real: `TMS_DESDE` / `TMS_HASTA` (ISO UTC; por omisión 1 año).
// Código de salida: 0 = 20/20 y sumas cuadran; 1 = no cuadra o hubo rechazos; 2 = uso/credenciales.
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const META = 20;

// Los módulos del conector son TypeScript con imports sin extensión, alias `@/` y JSON sin atributos (los resuelve
// Next/vitest). Este gancho mínimo (con el `typescript` ya instalado del repo) permite importarlos desde Node.
const GANCHO = `
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const SRC = ${JSON.stringify(pathToFileURL(resolve(RAIZ, 'src')).href)};
const ts = createRequire(${JSON.stringify(resolve(RAIZ, 'package.json'))})('typescript');
const esArchivo = (url) => { const r = fileURLToPath(url); return existsSync(r) && statSync(r).isFile(); };
export async function resolve(esp, ctx, siguiente) {
  let base = null;
  if (esp.startsWith('@/')) base = SRC + '/' + esp.slice(2);
  else if ((esp.startsWith('./') || esp.startsWith('../')) && ctx.parentURL) base = new URL(esp, ctx.parentURL).href;
  if (base) {
    for (const c of [base, base + '.ts', base + '.tsx', base + '/index.ts']) {
      if (esArchivo(c)) return { url: c, shortCircuit: true };
    }
  }
  return siguiente(esp, ctx);
}
export async function load(url, ctx, siguiente) {
  if (url.startsWith('file:') && url.endsWith('.json')) {
    return { format: 'module', source: 'export default ' + readFileSync(fileURLToPath(url), 'utf8') + ';', shortCircuit: true };
  }
  if (url.startsWith('file:') && /\\.tsx?$/.test(url) && !url.includes('/node_modules/')) {
    const fuente = ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    return { format: 'module', source: fuente, shortCircuit: true };
  }
  return siguiente(url, ctx);
}
`;
register('data:text/javascript;base64,' + Buffer.from(GANCHO).toString('base64'), import.meta.url);

const salir = (codigo, ...lineas) => {
  for (const l of lineas) console[codigo === 0 ? 'log' : 'error'](l);
  process.exit(codigo);
};

/** Lee el archivo de credenciales (modo 600 obligatorio). Nunca devuelve ni imprime el contenido en errores. */
export function leerCredenciales(ruta) {
  if (!ruta) salir(2, 'Falta TMS_CREDENCIALES_ARCHIVO (ruta del archivo de credenciales, modo 600). No se llamó a nadie.');
  let st;
  try { st = statSync(ruta); } catch { salir(2, 'No se pudo leer el archivo de credenciales indicado. No se llamó a nadie.'); }
  if (!st.isFile()) salir(2, 'La ruta de credenciales no es un archivo. No se llamó a nadie.');
  if ((st.mode & 0o777) !== 0o600) {
    salir(2, `El archivo de credenciales debe tener modo 600 (tiene ${(st.mode & 0o777).toString(8)}). Corrige con chmod 600. No se leyó ni se llamó a nadie.`);
  }
  const valores = {};
  for (const linea of readFileSync(ruta, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([a-z_]+)\s*=\s*(.*?)\s*$/i.exec(linea);
    if (m && !linea.trimStart().startsWith('#')) valores[m[1].toLowerCase()] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  for (const k of ['base_url', 'usuario', 'clave']) {
    if (!valores[k]) salir(2, `Al archivo de credenciales le falta el campo ${k}. No se llamó a nadie.`);
  }
  return valores;
}

// ── Origen sintético (modo --falso): las tres tablas del mapeo supuesto, generadas con semilla ───────────────────
function origenFalso(datos) {
  const dia = (iso, hora) => `${iso.slice(0, 10)} ${hora}`;
  const nomina = []; const operadores = []; const catalogo = new Map();
  const conceptoId = (n) => { if (!catalogo.has(n)) catalogo.set(n, catalogo.size + 1); return catalogo.get(n); };
  let id = 1;
  datos.liquidaciones.forEach((l, i) => {
    const op = 100 + i;
    operadores.push({ ID: op, NumeroEmpleado: `E-${String(op).padStart(4, '0')}` });
    const comunes = { Poliza: `P${l.bitacora}`, Bitacora: l.bitacora, OperadorID: op, FechaInicio: dia(l.de, '00:00:00'), FechaFin: dia(l.a, '23:59:59') };
    for (const r of l.percepciones) nomina.push({ ID: id++, ...comunes, ConceptoID: conceptoId(r.concepto), Cargo: r.valor, Abono: 0 });
    for (const r of l.deducciones) nomina.push({ ID: id++, ...comunes, ConceptoID: conceptoId(r.concepto), Cargo: 0, Abono: r.valor });
  });
  const conceptos = [...catalogo].map(([descripcion, ID]) => ({ ID, Clave: `C${String(ID).padStart(3, '0')}`, Descripcion: descripcion, Oculto: 'no' }));
  const tablas = { '/api/nomina-bitacora': nomina, '/api/operadores': operadores, '/api/conceptos-nomina': conceptos, '/api/liquidaciones': nomina };
  return async (pet) => {
    const u = new URL(pet.url);
    if (u.pathname === '/api/login') return { estado: 200, encabezados: {}, cuerpo: JSON.stringify({ token: 'tok-sintetico' }) };
    const tabla = tablas[u.pathname];
    if (!tabla) return { estado: 404, encabezados: {}, cuerpo: '{}' };
    const tam = Number(u.searchParams.get('tam') ?? 100);
    const pagina = Number(u.searchParams.get('pagina') ?? 1);
    return { estado: 200, encabezados: { 'content-type': 'application/json' }, cuerpo: JSON.stringify({ data: { items: tabla.slice((pagina - 1) * tam, pagina * tam) } }) };
  };
}

const sumar = (conceptos, tipo, aCentavos) =>
  conceptos.filter((c) => c.tipo === tipo).reduce((a, c) => a + aCentavos(c.monto), 0);

async function main() {
  const args = process.argv.slice(2);
  const falso = args.includes('--falso');
  const desconocido = args.find((a) => a !== '--falso');
  if (desconocido) salir(2, 'Uso: node scripts/tms/verificar-local.mjs [--falso]');

  const mod = (ruta) => import(pathToFileURL(resolve(RAIZ, 'src/lib/likida', ruta)).href);
  const { SesionTms } = await mod('conectores/tms/sesion.ts');
  const { leerLiquidaciones, MAPEO_LIQUIDACIONES_SUPUESTO } = await mod('conectores/tms/liquidaciones.ts');
  const { probarTmsApiLectura } = await mod('conectores/tms/ficha.ts');
  const { aCentavos, validarLiquidacionExterna } = await mod('liquidacion_externa/esquema.ts');
  const { generarDatos, SUMAS_1228, BITACORA_1228 } = await mod('conectores/tms/falso/datos.ts');

  let http; let valores; let base; let ventana;
  if (falso) {
    http = origenFalso(generarDatos({ semilla: 7, n: META }));
    valores = { base_url: 'https://tms.ejemplo.test', usuario: 'usuario-sintetico', clave: 'clave-sintetica' };
    ventana = { desde: '2026-01-01T06:00:00.000Z', hasta: '2026-12-31T06:00:00.000Z' };
  } else {
    valores = leerCredenciales(process.env.TMS_CREDENCIALES_ARCHIVO);
    const { httpsPublico } = await import(pathToFileURL(resolve(RAIZ, 'src/lib/http/https_publico.ts')).href);
    http = (p) => httpsPublico(p, 15_000);
    const hasta = process.env.TMS_HASTA ?? new Date().toISOString();
    const desde = process.env.TMS_DESDE ?? new Date(Date.parse(hasta) - 365 * 86_400_000).toISOString();
    ventana = { desde, hasta };
  }
  base = valores.base_url;

  // 1) probar(): login + una lectura de bajo costo. Solo la bandera.
  const prueba = await probarTmsApiLectura(valores, http);
  const veredicto = prueba.ok ? 'OK' : 'NO OK';

  // 2) Lectura de las bitácoras y validación contra el contrato.
  const sesion = new SesionTms({
    http, base,
    login: { ruta: valores.ruta_login || '/api/login', cuerpo: { usuario: '{usuario}', clave: '{clave}' }, campo_token: 'token' },
    credenciales: { usuario: valores.usuario, clave: valores.clave },
    reloj: falso ? { ahora: () => 1_000_000, dormir: async () => undefined } : undefined,
  });
  const lectura = await leerLiquidaciones(sesion, MAPEO_LIQUIDACIONES_SUPUESTO, ventana, {});
  if (!lectura.ok) salir(1, `probar(): ${veredicto}`, 'Lectura: falló (el motivo no se imprime porque puede traer datos del origen). 0/20');
  const cuerpos = lectura.cuerpos.slice(0, META);

  let validas = 0; let cuadran = 0; let con1228 = 0; let cuadra1228 = 0;
  for (const c of cuerpos) {
    let normalizada = true;
    try { validarLiquidacionExterna(c.cuerpo); } catch { normalizada = false; }
    if (normalizada) validas += 1;
    const conceptos = c.cuerpo.conceptos;
    const p = sumar(conceptos, 'percepcion', aCentavos); const d = sumar(conceptos, 'deduccion', aCentavos);
    const cuadre = normalizada && p - d === aCentavos(c.cuerpo.total);
    if (cuadre) cuadran += 1;
    if (c.bitacora === BITACORA_1228) {
      con1228 += 1;
      if (p === SUMAS_1228.percepciones && d === SUMAS_1228.deducciones && p - d === SUMAS_1228.neto) cuadra1228 += 1;
    }
  }

  const todas = cuerpos.length === META && validas === META && cuadran === META && lectura.rechazadas.length === 0;
  const lineas = [
    `probar(): ${veredicto}`,
    `${validas}/${META} válidas, sumas ${cuadran === META ? 'cuadran' : `NO cuadran (${cuadran}/${META})`}`,
    `bitácoras leídas: ${cuerpos.length}; rechazadas: ${lectura.rechazadas.length}; pendientes sin póliza: ${lectura.pendientes_poliza.length}`,
    `bitácora de referencia contra el desglose impreso: ${con1228 === 0 ? 'no está entre las leídas' : cuadra1228 === con1228 ? 'cuadra' : 'NO cuadra'}`,
  ];
  if (process.env.TMS_REPORTE_ARCHIVO) {
    const fecha = new Date().toISOString().slice(0, 10);
    writeFileSync(process.env.TMS_REPORTE_ARCHIVO, `# Verificación TMS (${falso ? 'ensayo con el falso' : 'ambiente real'}) · ${fecha}\n\n${lineas.map((l) => `- ${l}`).join('\n')}\n`);
  }
  salir(todas && prueba.ok ? 0 : 1, ...lineas);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
