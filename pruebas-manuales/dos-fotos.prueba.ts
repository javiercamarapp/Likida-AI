// ═══════════════════════════════════════════════════════════════════════════
// ARNÉS MANUAL — el protocolo de DOS FOTOS de punta a punta.
//
// Corre el camino real sobre un par (ticket completo + acercamiento al código)
// y comprueba lo que la suite offline no puede: que con fotos de campo el total
// y el folio salgan del CÓDIGO y no de la visión.
//
// NO entra en `npm test`: hace una llamada de visión real y cuesta dinero.
//
// USO
//   TICKET=/ruta/ticket.HEIC CERCA=/ruta/acercamiento.HEIC \
//     npx vitest run --config pruebas-manuales/vitest.config.ts pruebas-manuales/dos-fotos.prueba.ts
// ═══════════════════════════════════════════════════════════════════════════

import { test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

/** Carga .env.local a process.env (vitest no lo hace; Next sí). */
function cargarEnv(ruta: string): void {
  if (!existsSync(ruta)) return;
  for (const linea of readFileSync(ruta, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(linea);
    if (!m) continue;
    const valor = m[2].trim().replace(/^["']|["']$/g, '');
    if (valor && !process.env[m[1]]) process.env[m[1]] = valor;
  }
}

/** HEIC → JPEG a 1600 px: como llega una foto por WhatsApp. */
function comoWhatsApp(ruta: string): string {
  const ext = extname(ruta).toLowerCase();
  let buf: Buffer;
  if (ext === '.heic' || ext === '.heif') {
    const out = join(tmpdir(), `dos-${basename(ruta, ext)}.jpg`);
    execFileSync('sips', ['-s', 'format', 'jpeg', '-Z', '1600', ruta, '--out', out], { stdio: 'ignore' });
    buf = readFileSync(out);
  } else {
    buf = readFileSync(ruta);
  }
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

test('ticket + acercamiento: el código manda sobre el OCR', async () => {
  const rutaTicket = process.env.TICKET;
  const rutaCerca = process.env.CERCA;
  if (!rutaTicket || !rutaCerca) return console.log('\n⚠️  Faltan TICKET= y CERCA=\n');

  // El env ANTES de importar el módulo: openrouter lee la llave al cargarse.
  cargarEnv(resolve('.env.local'));
  expect(process.env.OPENROUTER_API_KEY, 'falta OPENROUTER_API_KEY en .env.local').toBeTruthy();

  const { extraerComprobante } = await import('@/lib/cuadra/intake/ocr');

  const t0 = Date.now();
  const r = await extraerComprobante([comoWhatsApp(rutaTicket), comoWhatsApp(rutaCerca)]);
  const ms = Date.now() - t0;
  const extra = (r.gasto.ocrExtra ?? {}) as Record<string, unknown>;

  console.log(`\n${'═'.repeat(74)}`);
  console.log(`ticket    ${basename(rutaTicket)}`);
  console.log(`cerca     ${basename(rutaCerca)}`);
  console.log(`${'─'.repeat(74)}`);
  console.log(`legible          ${r.legible}   motivo=${r.motivo ?? '—'}`);
  console.log(`monto            ${r.gasto.monto}        (OCR dijo: ${extra.montoOcr ?? 'lo mismo'})`);
  console.log(`discrepancia     ${extra.montoDiscrepante ?? false}`);
  console.log(`folio portal     ${extra.folioPortal ?? '—'}`);
  console.log(`código barras    ${extra.codigoBarras ?? '—'}`);
  console.log(`liga             ${extra.urlFacturacion ?? '—'}`);
  console.log(`folio OCR        ${r.gasto.folio ?? '—'}`);
  console.log(`RFC emisor       ${r.gasto.rfcEmisor ?? '—'}   dudoso=${extra.rfcEmisorDudoso ?? '—'}`);
  console.log(`costo            $${r.costo.costoUsd.toFixed(4)}   ${ms} ms`);
  console.log(`${'═'.repeat(74)}\n`);

  // Lo que este arnés existe para probar: los identificadores salieron de un
  // código, no de visión. Si esto falla, el protocolo de dos fotos no sirve.
  expect(extra.folioPortal ?? extra.codigoBarras).toBeTruthy();
  expect(r.gasto.monto).toBeGreaterThan(0);
}, 600_000);
