// ═══════════════════════════════════════════════════════════════════════════
// ARNÉS MANUAL — ¿el agente lee bien MIS fotos?
//
// Corre el camino real de intake sobre imágenes locales:
//   foto → extraerComprobante() [visión + QR CFDI + consulta SAT] → Gasto
//   y luego cuadrarViaje() sobre todo el lote, como en una liquidación.
//
// NO entra en `npm test` (ver pruebas-manuales/vitest.config.ts). Hace llamadas
// reales y cuesta dinero: se corre a propósito, no en CI.
//
// USO
//   npx vitest run --config pruebas-manuales/vitest.config.ts
//     → toma todo lo que haya en pruebas-manuales/imagenes/
//
//   IMGS="/ruta/foto1.jpg,/ruta/carpeta" ANTICIPO=5000 \
//     npx vitest run --config pruebas-manuales/vitest.config.ts
// ═══════════════════════════════════════════════════════════════════════════

import { test, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, extname, basename, resolve } from 'node:path';
// Type-only: se borran al compilar, no rompen el orden de carga del env.
import type { PoliticaGasto } from '@/lib/cuadra/cuadre/engine';
import type { Gasto } from '@/types/cuadra';

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

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

/** Rutas de imágenes: de IMGS (archivos y/o carpetas) o de la carpeta por defecto. */
function listarImagenes(): string[] {
  const crudo = process.env.IMGS?.trim();
  const entradas = crudo
    ? crudo.split(',').map((s) => resolve(s.trim().replace(/^~/, process.env.HOME ?? '~')))
    : [resolve('pruebas-manuales/imagenes')];

  const salida: string[] = [];
  for (const e of entradas) {
    if (!existsSync(e)) {
      console.log(`⚠️  no existe: ${e}`);
      continue;
    }
    if (statSync(e).isDirectory()) {
      for (const f of readdirSync(e).sort()) {
        if (MIME[extname(f).toLowerCase()]) salida.push(join(e, f));
      }
    } else if (MIME[extname(e).toLowerCase()]) {
      salida.push(e);
    } else {
      console.log(`⚠️  extensión no soportada: ${e}`);
    }
  }
  return salida;
}

/** Data-URL. Convierte HEIC/HEIF de iPhone a JPEG (el modelo de visión no come HEIC). */
async function aDataUrl(ruta: string): Promise<{ url: string; bytes: number; nota?: string }> {
  const ext = extname(ruta).toLowerCase();
  let buf: Buffer = readFileSync(ruta);
  let mime = MIME[ext];
  let nota: string | undefined;

  if (ext === '.heic' || ext === '.heif') {
    // sharp NO trae libheif compilado en esta máquina (falla con "Support for this
    // compression format has not been built in"). `sips` de macOS sí decodifica
    // HEIC, así que va primero. Sin esto, el HEIC crudo llega al modelo y todo
    // sale "ilegible" por culpa del arnés, no del producto.
    const { execFileSync } = await import('node:child_process');
    const { tmpdir } = await import('node:os');
    const salida = join(tmpdir(), `cuadra-heic-${basename(ruta, ext)}.jpg`);
    try {
      // -Z remuestrea al lado mayor: imita lo que WhatsApp entrega (comprime
      // antes de mandar). Probar con el original de 12 Mpx no representa el
      // camino real y cuesta el triple de tokens. MAXPX=0 lo desactiva.
      const maxpx = process.env.MAXPX ?? '1600';
      const args = ['-s', 'format', 'jpeg'];
      if (maxpx !== '0') args.push('-Z', maxpx);
      execFileSync('sips', [...args, ruta, '--out', salida], { stdio: 'ignore' });
      buf = readFileSync(salida);
      mime = 'image/jpeg';
      nota = `HEIC→JPEG${maxpx !== '0' ? ` @${maxpx}px` : ''}`;
    } catch {
      try {
        const sharp = (await import('sharp')).default;
        buf = await sharp(buf).jpeg({ quality: 90 }).toBuffer();
        mime = 'image/jpeg';
        nota = 'HEIC→JPEG (sharp)';
      } catch (e) {
        nota = `⚠️ NO se pudo convertir el HEIC (${e instanceof Error ? e.message : e}) — el resultado NO es válido`;
      }
    }
  }
  return { url: `data:${mime};base64,${buf.toString('base64')}`, bytes: buf.length, nota };
}

// c_FormaPago del SAT, como lo guarda ocr.ts.
const FORMA_PAGO: Record<string, string> = {
  '01': 'efectivo (01)',
  '03': 'transferencia (03)',
  '04': 'tarjeta (04)',
  '28': 'tarjeta de débito (28)',
};

const money = (n: number | null | undefined) =>
  n == null ? '—' : `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;

test('OCR sobre imágenes reales + cuadre del lote', async () => {
  cargarEnv(resolve('.env.local'));

  const imagenes = listarImagenes();
  if (imagenes.length === 0) {
    console.log(
      '\n⚠️  Sin imágenes.\n' +
        '   Pon los archivos en pruebas-manuales/imagenes/ o pasa IMGS="/ruta/a/foto.jpg".\n',
    );
    return;
  }

  expect(process.env.OPENROUTER_API_KEY, 'falta OPENROUTER_API_KEY en .env.local').toBeTruthy();

  // Import dinámico: DESPUÉS de cargar el env, por si algún módulo lo lee al importarse.
  const { extraerComprobante } = await import('@/lib/cuadra/intake/ocr');
  const { cuadrarViaje } = await import('@/lib/cuadra/cuadre/engine');

  // 🔴 INVENTADA: misma política de fantasía que /api/demo y seed.sql.
  // Cámbiala por la real de la flota antes de sacar conclusiones del cuadre.
  const POLITICA: PoliticaGasto[] = [
    { concepto: 'diesel', topeMonto: 4000 },
    { concepto: 'caseta', topeMonto: 1500 },
    { concepto: 'viaticos', topeMonto: 800 },
    { concepto: 'factura', requiereCfdi: true },
  ];

  console.log(`\n${'═'.repeat(78)}\n${imagenes.length} imagen(es) a procesar\n${'═'.repeat(78)}`);

  const gastos: Gasto[] = [];
  let costoTotal = 0;
  const problemas: string[] = [];

  for (const [i, ruta] of imagenes.entries()) {
    const { url, bytes, nota } = await aDataUrl(ruta);
    const kb = (bytes / 1024).toFixed(0);
    console.log(`\n[${i + 1}/${imagenes.length}] ${basename(ruta)}  (${kb} KB${nota ? `, ${nota}` : ''})`);

    // Se decodifica aparte SOLO para el informe: es lo único que distingue "el
    // lector no vio nada" de "vio un código que no era de CFDI". Sin esto, el
    // arnés decía "sin QR" sobre tickets cuyo QR se había leído perfectamente.
    const { decodeCodigosFromImage, bufferFromDataUrl } = await import('@/lib/cuadra/intake/cfdi');
    const codigos = await decodeCodigosFromImage(bufferFromDataUrl(url)).catch(() => []);

    const t0 = Date.now();
    let r: Awaited<ReturnType<typeof extraerComprobante>>;
    try {
      r = await extraerComprobante(url);
    } catch (e) {
      console.log(`   💥 EXCEPCIÓN: ${e instanceof Error ? e.message : e}`);
      problemas.push(`${basename(ruta)}: excepción — ${e instanceof Error ? e.message : e}`);
      continue;
    }
    const seg = ((Date.now() - t0) / 1000).toFixed(1);
    const g = r.gasto;
    const extra = (g.ocrExtra ?? {}) as Record<string, unknown>;

    const estado = r.legible ? '✅ legible' : `❌ NO legible (${r.motivo ?? 'sin motivo'})`;
    console.log(`   ${estado}  confianza ${((g.ocrConfianza ?? 0) * 100).toFixed(0)}%  ·  ${seg}s`);
    console.log(`   concepto : ${g.concepto}`);
    console.log(`   monto    : ${money(g.monto)}${g.subTotal != null ? `   subtotal ${money(g.subTotal)}` : ''}`);
    console.log(`   folio    : ${g.folio ?? '—'}${g.folioNorm && g.folioNorm !== g.folio ? `  (norm: ${g.folioNorm})` : ''}`);
    // Fecha: la normalizada es la que se guarda; la cruda revela si el modelo
    // se inventó el año (pasó con un ticket real: leyó 2024 donde decía 2026).
    console.log(`   fecha    : ${g.fecha ?? '—'}${extra.fechaRaw ? `   (leyó: "${String(extra.fechaRaw)}")` : ''}`);
    // Método de pago: '01' efectivo dispara la regla de combustible en efectivo
    // del motor (engine.ts:106), así que no es un dato decorativo.
    console.log(`   pago     : ${FORMA_PAGO[g.formaPago ?? ''] ?? (g.formaPago ? `c_FormaPago ${g.formaPago}` : '— no detectado')}`);
    // Liga de autofacturación: un ticket de estación no es factura, hay que
    // timbrarlo en el portal del emisor. Sin esto la oficina no sabe ni dónde.
    console.log(`   liga     : ${extra.urlFacturacion ? String(extra.urlFacturacion) : '— no detectada'}`);
    if (Object.keys(extra).length) {
      const campos = ['producto', 'litros', 'precioUnitario', 'estacion', 'webId', 'ivaMonto', 'ivaTasa']
        .filter((k) => extra[k] != null)
        .map((k) => `${k}=${String(extra[k])}`);
      if (campos.length) console.log(`   ticket   : ${campos.join('  ')}`);
    }
    console.log(
      `   fiscal   : RFC emisor ${g.rfcEmisor ?? (extra.rfcEmisorDudoso ? `⚠️ ${String(extra.rfcEmisorDudoso)} RECHAZADO (dígito verificador)` : '—')}  ·  receptor ${g.rfcReceptor ?? '—'}\n` +
        // "sin QR" a secas engañaba: los tickets de este lote SÍ traen QR, pero de
        // FACTURACIÓN (mefacturo.mx), no de CFDI — y el lector los leyó bien. El
        // arnés hacía parecer que el decodificador había fallado cuando no.
        `   códigos  : ${codigos.length ? codigos.map((c) => `[${c.formato}] ${String(c.texto).slice(0, 62)}`).join('\n              ') : '— ninguno leído'}\n` +
        `              UUID ${g.cfdiUuid ?? '—'}  ·  QR de CFDI ${g.cfdiValido === true ? 'sí ✅' : 'no'}` +
        `  ·  SAT ${g.estadoSat ?? '—'}  ·  EFOS ${g.efos === true ? '🚨 EN LISTA 69-B' : g.efos === false ? 'limpio' : '—'}`,
    );
    console.log(`   costo    : ${r.costo.modelo}  ${r.costo.tokensIn}→${r.costo.tokensOut} tok  $${r.costo.costoUsd.toFixed(4)} USD`);

    costoTotal += r.costo.costoUsd;
    if (!r.legible) problemas.push(`${basename(ruta)}: ilegible → el flujo pediría reenvío`);
    else if ((g.ocrConfianza ?? 0) < 0.8) problemas.push(`${basename(ruta)}: confianza baja (${((g.ocrConfianza ?? 0) * 100).toFixed(0)}%)`);
    else if (!g.monto) problemas.push(`${basename(ruta)}: sin monto`);
    gastos.push(g);
  }

  // ── Cuadre del lote, como si fuera un viaje ────────────────────────────────
  const anticipo = Number(process.env.ANTICIPO ?? 0);
  // El arnés pasaba SOLO la política, así que el motor corría a media máquina:
  // sin `estimulos` no se evalúa el tope de alimentación de LISR 28-V ni el de
  // efectivo, y sin `hoy` no se evalúan la fecha ni el plazo de facturación.
  //
  // Con tickets reales eso engaña: un ticket de $1,050 de comida pasaba sin que
  // nadie notara que excede el tope de $750/día. Probar con fotos de verdad no
  // sirve de nada si el motor no está entero.
  const { DEMO_CONFIG } = await import('@/lib/cuadra/config');
  const hoy = new Date().toISOString().slice(0, 10);
  const liq = cuadrarViaje({
    viajeId: 'prueba-manual',
    anticipo,
    gastos,
    politica: POLITICA,
    ruta: 'prueba',
    hoy,
    estimulos: DEMO_CONFIG.estimulos,
    hidrocarburos: DEMO_CONFIG.hidrocarburos,
  });

  console.log(`\n${'═'.repeat(78)}\nCUADRE DEL LOTE  (anticipo ${money(anticipo)}${process.env.ANTICIPO ? '' : ' — pásalo con ANTICIPO=…'})\n${'═'.repeat(78)}`);
  console.log(`comprobado : ${money(liq.totalComprobado)}`);
  console.log(`anticipo   : ${money(liq.totalAnticipo)}`);
  console.log(`diferencia : ${money(liq.diferencia)}`);
  console.log(`estatus    : ${liq.estatus}`);
  if (liq.diferencias.length) {
    console.log('\nlo que marcó el motor:');
    for (const d of liq.diferencias) console.log(`  · ${d.tipo}  ${money(d.monto)}  — ${d.nota ?? ''}`);
  }

  console.log(`\n${'─'.repeat(78)}`);
  console.log(`costo OCR del lote: $${costoTotal.toFixed(4)} USD  (${imagenes.length} imágenes)`);
  if (problemas.length) {
    console.log(`\n⚠️  ${problemas.length} para revisar a ojo:`);
    for (const p of problemas) console.log(`  · ${p}`);
  } else {
    console.log('\n✅ ninguna imagen quedó ilegible ni con confianza baja');
  }
  console.log(`${'─'.repeat(78)}\n`);
}, 600_000);
