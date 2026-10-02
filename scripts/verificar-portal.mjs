#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// CORRIDA SUPERVISADA DE VERIFICACIÓN DE UN PORTAL — contra el portal REAL, solo lectura.
//
//   npx tsx scripts/verificar-portal.mjs --listar
//   npx tsx scripts/verificar-portal.mjs <claveComercio> --visita-real --yo "Nombre Apellido"
//
// ES LO ÚNICO QUE PUEDE MARCAR UN PORTAL COMO VERIFICADO. Y NO CORRE SOLO:
//   · exige `--visita-real` Y `--yo "<tu nombre>"` (queda en el registro como `confirmadoPor`);
//   · exige una terminal interactiva y que TECLEES la frase exacta de confirmación: no corre en CI,
//     ni desde un cron, ni redirigiendo la entrada;
//   · UNA visita, de SOLO LECTURA: toda petición que no sea GET/HEAD se aborta (emitir es un POST);
//   · no resuelve CAPTCHA ni rodea nada: si lo hay, no se gradúa (modo asistido).
//
// Deja EVIDENCIA en pruebas-manuales/verificacion-portales/<comercio>/<fecha>/ (reporte, captura, DOM
// saneado) y, SOLO si todos los selectores del formulario en blanco resolvieron y no hubo CAPTCHA, escribe
// la entrada en src/lib/likida/facturacion/adaptadores/verificaciones.json con la huella de la tabla medida
// y el sha256 del reporte. Revisa el diff (el DOM saneado va a git) y commitea.
//
// QUÉ SIGNIFICA «VERIFICADO» aquí: nivel `prevuelo` — los selectores del formulario en blanco existen.
// El UUID, el cuadro de error y el XML solo se ven emitiendo: la PRIMERA emisión real sigue supervisada
// (docs/operacion/agente-autofactura.md). Runbook por portal: docs/operacion/verificacion-portales.md.
// ════════════════════════════════════════════════════════════════════════════

import process from 'node:process';
import readline from 'node:readline/promises';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const bandera = (n) => args.includes(n);

const { GUIONES, guionDe } = await import('../src/lib/likida/facturacion/adaptadores/portales.ts');
const { estadoVerificacion, aplicarEntrada } = await import('../src/lib/likida/autofactura/verificacion.ts');
const { REGISTRO_VERIFICACIONES } = await import('../src/lib/likida/autofactura/registro_verificaciones.ts');
const { correrPrevuelo, renderizarReporte, entradaDeRegistro, sanearHtml } = await import('../src/lib/likida/autofactura/verificacion_corrida.ts');

const RAIZ = process.cwd();
const REGISTRO_RUTA = join(RAIZ, 'src/lib/likida/facturacion/adaptadores/verificaciones.json');
const FIXTURES = join(RAIZ, 'src/lib/likida/facturacion/adaptadores/fixtures');

if (bandera('--listar')) {
  console.log('Estado de verificación de los guiones (real = visita supervisada; el contrato lo calculan las pruebas):\n');
  for (const g of GUIONES) {
    const e = estadoVerificacion(g, REGISTRO_VERIFICACIONES);
    console.log(`  ${g.comercio.padEnd(24)} ${e.estado === 'verificado' ? `verificado (${e.entrada.fecha}, ${e.entrada.nivel})` : e.estado === 'obsoleto' ? `OBSOLETO (se midió otra tabla el ${e.entrada.fecha})` : 'no verificado'}`);
  }
  process.exit(0);
}

const clave = args.find((a) => !a.startsWith('--') && a !== opcion('--yo'));
const quien = (opcion('--yo') ?? '').trim();
if (!clave || !bandera('--visita-real') || quien.length < 3) {
  console.error('Uso: npx tsx scripts/verificar-portal.mjs <claveComercio> --visita-real --yo "Nombre Apellido"');
  console.error('     npx tsx scripts/verificar-portal.mjs --listar');
  process.exit(2);
}
const g = guionDe(clave);
if (!g) { console.error(`No hay guion "${clave}". Los que hay: ${GUIONES.map((x) => x.comercio).join(', ')}`); process.exit(2); }
if (process.env.CI) { console.error('Esto no corre en CI: es una visita real que confirma una persona.'); process.exit(2); }
if (!process.stdin.isTTY) { console.error('Hace falta una terminal interactiva: la confirmación se teclea, no se redirige.'); process.exit(2); }

const FRASE = `VISITAR ${clave.toUpperCase()} EN EL PORTAL REAL`;
console.log(`\nVas a abrir UNA VEZ ${g.portal} con un Chromium real, SOLO LECTURA (toda petición que no sea GET/HEAD se aborta).`);
console.log('No se resuelve ningún CAPTCHA, no se teclea nada y no se envía ningún formulario.');
console.log(`Quedará registrado a nombre de: ${quien}\n`);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const tecleado = (await rl.question(`Para continuar escribe exactamente: ${FRASE}\n> `)).trim();
rl.close();
if (tecleado !== FRASE) { console.error('La frase no coincide: no se visitó nada.'); process.exit(1); }

const { chromium } = await import('playwright-core');
const { PaginaPlaywright, resolverEjecutable } = await import('../src/lib/likida/facturacion/adaptadores/pagina_playwright.ts');
const hoy = new Date().toISOString().slice(0, 10);
const dir = join(RAIZ, 'pruebas-manuales/verificacion-portales', clave, hoy);
mkdirSync(dir, { recursive: true });

const resolucion = await resolverEjecutable();
const navegador = await chromium.launch({ headless: true, executablePath: resolucion.executablePath });
let resultado; let domSaneado = '';
try {
  const contexto = await navegador.newContext({ locale: 'es-MX', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36' });
  const bloqueadas = [];
  // EL CANDADO, antes de navegar: emitir un CFDI es un POST.
  await contexto.route('**/*', async (ruta) => {
    const m = ruta.request().method();
    if (m === 'GET' || m === 'HEAD') return ruta.continue();
    bloqueadas.push(`${m} ${ruta.request().url()}`);
    return ruta.abort();
  });
  const page = await contexto.newPage();
  const pp = new PaginaPlaywright(page, { directorioCapturas: dir, capturaCompleta: true, calidadCaptura: 70 });
  const verificable = {
    abrir: (u) => pp.abrir(u), existe: (s) => pp.existe(s), inventario: () => pp.inventario(), captura: () => pp.captura(),
    titulo: () => page.title(), urlActual: () => page.url(), html: () => page.content(),
  };
  resultado = await correrPrevuelo(g, verificable);
  if (resultado.abrio) domSaneado = sanearHtml(await page.content());
  if (bloqueadas.length > 0) console.log(`(Peticiones no-GET abortadas: ${bloqueadas.length})`);
} finally {
  await navegador.close().catch(() => {});
}

const reporte = renderizarReporte(resultado);
const reporteRel = `pruebas-manuales/verificacion-portales/${clave}/${hoy}/reporte.txt`;
writeFileSync(join(RAIZ, reporteRel), reporte, 'utf8');
if (domSaneado) writeFileSync(join(dir, 'dom-saneado.html'), domSaneado, 'utf8');
let capturaRel;
if (resultado.capturaRuta && existsSync(resultado.capturaRuta)) {
  capturaRel = `pruebas-manuales/verificacion-portales/${clave}/${hoy}/captura.jpg`;
  copyFileSync(resultado.capturaRuta, join(RAIZ, capturaRel));
}
console.log(`\n${reporte}`);

if (resultado.veredicto !== 'graduable') {
  console.log(`NO se escribió nada en el registro (${resultado.veredicto}). La evidencia quedó en ${dir}.`);
  process.exit(resultado.veredicto === 'no_abrio' ? 3 : 1);
}

const entrada = entradaDeRegistro({ guion: g, resultado, confirmadoPor: quien, reporteRel, reporteTexto: reporte, capturaRel });
writeFileSync(REGISTRO_RUTA, aplicarEntrada(readFileSync(REGISTRO_RUTA, 'utf8'), clave, entrada), 'utf8');

// El DOM real saneado queda como fixture `grabado` del portal (el sintético no se toca: lleva el comportamiento de emitir).
const dirFx = join(FIXTURES, clave);
mkdirSync(dirFx, { recursive: true });
writeFileSync(join(dirFx, 'grabado.html'), domSaneado, 'utf8');
const manifiestoRuta = join(FIXTURES, 'manifest.json');
if (existsSync(manifiestoRuta)) {
  const m = JSON.parse(readFileSync(manifiestoRuta, 'utf8'));
  m.portales[clave] = { ...(m.portales[clave] ?? {}), grabado: { fecha: hoy, archivo: 'grabado.html' } };
  writeFileSync(manifiestoRuta, `${JSON.stringify(m, null, 2)}\n`, 'utf8');
}
console.log(`✓ ${clave} quedó VERIFICADO (nivel prevuelo, ${hoy}, confirmado por ${quien}).`);
console.log('  REVISA el diff: el DOM saneado (grabado.html) va a git — confirma que no trae datos de nadie. Luego commitea.');
console.log('  Ojo: la primera emisión real de este portal sigue siendo supervisada (confirmación humana por lote y límites).');
