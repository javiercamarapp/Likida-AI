#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// VINCULAR UN PORTAL — la sesión asistida, desde una máquina con pantalla.
//
//   npx tsx scripts/vincular-portal.mjs <tenantId> <claveComercio>
//
// Abre el portal en un Chromium VISIBLE, espera a que TÚ entres con tu cuenta
// (incluido su CAPTCHA, que resuelves tú), y en cuanto estás dentro guarda la
// sesión cifrada en el cofre. A partir de ahí las corridas del agente entran
// solas hasta que el portal la caduque.
//
// POR QUÉ ES UN SCRIPT Y NO UN BOTÓN DEL PANEL: una función de Vercel no tiene
// pantalla donde enseñarte un navegador. El botón «Vincular ahora» del panel te
// lleva al portal para que entres por tu lado; esto es lo que convierte ese
// login en una sesión que el robot pueda reusar. El día que haya un navegador
// remoto con vista, lo único que cambia es de dónde sale la página — la lógica
// vive en `src/lib/likida/facturacion/vinculacion_asistida.ts` y no aquí.
//
// LO QUE ESTE SCRIPT NO HACE, NUNCA: teclear tu usuario o tu contraseña. No las
// pide, no las lee y no las guarda. Lo único que se lleva son las cookies que
// el portal te dio después de que entraste tú.
//
// Requiere `LIKIDA_COFRE_LLAVE` y las llaves de Supabase en el entorno: sin
// cofre no se guarda nada (`guardarSesionPortal` lanza a propósito).
// ════════════════════════════════════════════════════════════════════════════

import process from 'node:process';

const [, , tenantId, clave] = process.argv;

if (!tenantId || !clave) {
  console.error('Uso: npx tsx scripts/vincular-portal.mjs <tenantId> <claveComercio>');
  console.error('Ejemplo: npx tsx scripts/vincular-portal.mjs 1111-... la_gas');
  process.exit(2);
}

const { chromium } = await import('playwright-core');
const { PaginaPlaywright, resolverEjecutable } = await import('../src/lib/likida/facturacion/adaptadores/pagina_playwright.ts');
const { vincularPortalAsistido } = await import('../src/lib/likida/facturacion/vinculacion_asistida.ts');
const { comercio } = await import('../src/lib/likida/facturacion/comercios.ts');

const ficha = comercio(clave);
if (!ficha) {
  console.error(`No existe el comercio "${clave}" en el catálogo.`);
  process.exit(2);
}

// HEADFUL a propósito: el punto entero es que una persona vea la pantalla y
// teclee en ella. Es el único sitio de todo el repo donde `headless: false` es
// lo correcto y no una depuración olvidada.
const resolucion = await resolverEjecutable();
const navegador = await chromium.launch({ headless: false, executablePath: resolucion.executablePath });
const contexto = await navegador.newContext({ locale: 'es-MX', viewport: { width: 1366, height: 900 } });

try {
  const pagina = new PaginaPlaywright(await contexto.newPage());
  console.log(`\nAbriendo ${ficha.nombre} — ${ficha.portal}`);
  console.log('Entra con tu cuenta en la ventana que se acaba de abrir. Aquí se espera hasta 5 minutos.\n');

  const r = await vincularPortalAsistido({
    tenantId,
    comercio: clave,
    entorno: {
      pagina,
      estadoDeSesion: async () => JSON.stringify(await contexto.storageState()),
    },
  });

  if (r.ok) {
    console.log(`\n✓ ${ficha.nombre} quedó vinculado: ${r.cookies} cookies guardadas cifradas (${r.capturadaEn}).`);
    console.log('  El panel ya lo enseña como «vinculado» y la próxima corrida entra sola.');
  } else {
    console.error(`\n✗ No se vinculó ${ficha.nombre}: ${r.motivo}`);
    process.exitCode = 1;
  }
} finally {
  await contexto.close().catch(() => {});
  await navegador.close().catch(() => {});
}
