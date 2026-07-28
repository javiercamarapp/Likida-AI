// ═══════════════════════════════════════════════════════════════════════════
// ¿Encuentra el QR en una foto REAL de celular? (paso 1 de la recepción)
//
//   npx vitest run --config pruebas-manuales/vitest.config.ts pruebas-manuales/qr.prueba.ts
//   IMGS="/ruta/a/fotos" npx vitest run --config pruebas-manuales/vitest.config.ts pruebas-manuales/qr.prueba.ts
//
// Mide también el TIEMPO: la escalera de mosaico corre dentro del request, y el
// presupuesto de Vercel hoy es 60s para toda la liquidación.
// ═══════════════════════════════════════════════════════════════════════════

import { test } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, extname, basename, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const EXT = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'];

function listar(): string[] {
  const crudo = process.env.IMGS?.trim();
  const entradas = crudo
    ? crudo.split(',').map((s) => resolve(s.trim()))
    : [resolve('pruebas-manuales/imagenes')];
  const out: string[] = [];
  for (const e of entradas) {
    if (!existsSync(e)) continue;
    if (statSync(e).isDirectory()) {
      for (const f of readdirSync(e).sort()) if (EXT.includes(extname(f).toLowerCase())) out.push(join(e, f));
    } else if (EXT.includes(extname(e).toLowerCase())) out.push(e);
  }
  return out;
}

/** Mismo preprocesado que el arnés de OCR: HEIC→JPEG a 1600px, como entrega WhatsApp. */
function comoLoRecibeWhatsApp(ruta: string): Buffer {
  const ext = extname(ruta).toLowerCase();
  if (ext !== '.heic' && ext !== '.heif') return readFileSync(ruta);
  const out = join(tmpdir(), `qr-${basename(ruta, ext)}.jpg`);
  execFileSync('sips', ['-s', 'format', 'jpeg', '-Z', process.env.MAXPX ?? '1600', ruta, '--out', out], { stdio: 'ignore' });
  return readFileSync(out);
}

test('¿aparece el QR en fotos reales?', async () => {
  const imagenes = listar();
  if (!imagenes.length) return console.log('\n⚠️  Sin imágenes (usa IMGS=…)\n');

  const { decodeQrFromImage } = await import('@/lib/cuadra/intake/cfdi');

  console.log(`\n${'═'.repeat(74)}\nQR sobre ${imagenes.length} foto(s)\n${'═'.repeat(74)}`);
  let hallados = 0;
  for (const ruta of imagenes) {
    const buf = comoLoRecibeWhatsApp(ruta);
    const t0 = Date.now();
    const qr = await decodeQrFromImage(buf);
    const ms = Date.now() - t0;

    if (!qr) {
      console.log(`\n❌ ${basename(ruta)}  — sin QR  (${ms} ms)`);
      continue;
    }
    hallados++;
    console.log(`\n✅ ${basename(ruta)}  (${ms} ms)`);
    if (qr.cfdi) {
      console.log(`   QR del SAT → uuid=${qr.cfdi.uuid ?? '—'}`);
      console.log(`                emisor=${qr.cfdi.rfcEmisor ?? '—'}  receptor=${qr.cfdi.rfcReceptor ?? '—'}  total=${qr.cfdi.total ?? '—'}`);
    } else if (qr.urlFacturacion) {
      console.log(`   LIGA de facturación → ${qr.urlFacturacion}`);
    } else {
      console.log(`   QR no fiscal → ${qr.texto.slice(0, 90)}`);
    }
  }
  console.log(`\n${'─'.repeat(74)}\n${hallados}/${imagenes.length} con QR legible\n${'─'.repeat(74)}\n`);
}, 600_000);
