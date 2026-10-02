#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// VINCULAR UN PORTAL — la sesión asistida, desde una máquina con pantalla.
//
// MODO NORMAL (0540) — con el código de un solo uso que da el panel
// («Vincular» en /dashboard/agentes/facturas):
//
//   npx tsx scripts/vincular-portal.mjs --codigo XXXX-XXXX-XXXX-XXXX
//   (opcional: --url https://app.likida.ai  o la variable LIKIDA_URL)
//
// No lleva llaves de Likida ni toca la base: presenta el código por HTTPS, abre el
// portal en un Chromium VISIBLE, espera a que TÚ entres con tu cuenta (incluido su
// CAPTCHA o su código de dos pasos, que resuelves tú) y sube SOLO las cookies de ese
// portal; el servidor las vuelve a recortar, las cifra y marca el portal «vinculado».
//
// MODO LOCAL (legado, requiere llaves de servicio y LIKIDA_COFRE_LLAVE en el entorno):
//
//   npx tsx scripts/vincular-portal.mjs <tenantId> <claveComercio>
//
// LO QUE ESTE SCRIPT NO HACE, NUNCA: teclear tu usuario o tu contraseña. No las
// pide, no las lee y no las guarda. Lo único que se lleva son las cookies que el
// portal te dio después de que entraste tú. La lógica vive en
// `src/lib/likida/facturacion/vinculacion_asistida.ts`.
// ════════════════════════════════════════════════════════════════════════════

import process from 'node:process';

const args = process.argv.slice(2);
const opcion = (nombre) => { const i = args.indexOf(nombre); return i >= 0 ? args[i + 1] : undefined; };
const codigo = opcion('--codigo');
const base = (opcion('--url') ?? process.env.LIKIDA_URL ?? 'https://app.likida.ai').replace(/\/+$/, '');
const [tenantId, claveLocal] = args.filter((a) => !a.startsWith('--') && a !== codigo && a !== opcion('--url'));

if (!codigo && (!tenantId || !claveLocal)) {
  console.error('Uso: npx tsx scripts/vincular-portal.mjs --codigo XXXX-XXXX-XXXX-XXXX   (el código sale del panel)');
  console.error('Legado: npx tsx scripts/vincular-portal.mjs <tenantId> <claveComercio>');
  process.exit(2);
}

async function llamar(ruta, cuerpo) {
  const res = await fetch(`${base}/api/vinculacion-portal/${ruta}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo),
  });
  let json = null;
  try { json = await res.json(); } catch { /* sin cuerpo */ }
  return { ok: res.ok && json?.ok === true, estado: res.status, json };
}

// En modo remoto la ficha viene del servidor (portal a abrir); en local, del catálogo.
let clave = claveLocal;
let portalRemoto = null;
if (codigo) {
  const r = await llamar('reclamar', { codigo });
  if (!r.ok) {
    console.error(`✗ El servidor no aceptó el código: ${r.json?.motivo ?? `HTTP ${r.estado}`}`);
    process.exit(1);
  }
  clave = r.json.comercio;
  portalRemoto = r.json.portal;
  console.log(`Código aceptado. Portal: ${r.json.nombre}. Vence ${r.json.expiraEn}.`);
}

const { chromium } = await import('playwright-core');
const { PaginaPlaywright, resolverEjecutable } = await import('../src/lib/likida/facturacion/adaptadores/pagina_playwright.ts');
const { vincularPortalAsistido } = await import('../src/lib/likida/facturacion/vinculacion_asistida.ts');
const { comercio } = await import('../src/lib/likida/facturacion/comercios.ts');

const ficha = comercio(clave);
// Con código, lo que se abre es lo que dijo el servidor, y debe coincidir con el catálogo de este checkout.
if (ficha && portalRemoto && ficha.portal !== portalRemoto) {
  console.error('✗ El portal que indicó el servidor no coincide con el catálogo de este checkout. Actualiza el repo (git pull).');
  if (codigo) await llamar('completar', { codigo, fallo: 'el catálogo local no coincide con el servidor' });
  process.exit(1);
}
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
    tenantId: tenantId ?? '(remoto)',
    comercio: clave,
    entorno: {
      pagina,
      estadoDeSesion: async () => JSON.stringify(await contexto.storageState()),
    },
    // Remoto: entrega la sesión al servidor (que la cifra y la guarda) en vez de guardarla aquí.
    ...(codigo ? {
      entregar: async (estadoRecortado) => {
        const s = await llamar('completar', { codigo, storageState: estadoRecortado });
        if (!s.ok) throw new Error(s.json?.motivo ?? `HTTP ${s.estado}`);
      },
    } : {}),
  });
  if (codigo && !r.ok) await llamar('completar', { codigo, fallo: r.motivo.slice(0, 300) }).catch(() => {});

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
