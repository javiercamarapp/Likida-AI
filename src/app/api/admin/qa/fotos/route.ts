// ═══════════════════════════════════════════════════════════════════════════
// EL BANCO DE FOTOS DE QA — /api/admin/qa/fotos.
//
// GET  → el manifiesto con URL firmada de 60 s por foto (miniaturas del
//        formulario — bucket privado, nunca un <img src> sin firmar).
// POST → subida MÚLTIPLE (multipart): el pedido explícito de Javier es poder
//        soltar una "cantidad obscena de tickets" de golpe. Dedup por sha256
//        (mismo digest que img_hash de producción); cada archivo reporta su
//        suerte por separado.
//
// Fase A: sin confirmación de OCR (eso es el oráculo humano de Fase B, tabla
// qa_foto) — aquí solo entra/lista el material.
// ═══════════════════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  leerManifiesto, subirFotos, firmarRuta, BUCKET_QA_FOTOS, type ArchivoNuevo,
} from '@/lib/admin/qa-storage';
import { sesionSuperadmin } from '../puerta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Tope del LOTE (no por archivo): 40 fotos de ~3 MB caben; más que esto se
 *  sube en dos tandas — el error lo dice, no revienta a medias. */
const MAX_LOTE_BYTES = 120 * 1024 * 1024;
const MAX_ARCHIVOS_POR_LOTE = 200;

export async function GET() {
  const { error } = await sesionSuperadmin();
  if (error) return error;
  const db = supabaseAdmin();
  const manifiesto = await leerManifiesto(db);
  if (!manifiesto.ok) return NextResponse.json({ error: manifiesto.error }, { status: 502 });
  const fotos = await Promise.all(manifiesto.datos.map(async (f) => ({
    ...f,
    url: await firmarRuta(db, BUCKET_QA_FOTOS, f.path),
  })));
  return NextResponse.json({ fotos });
}

export async function POST(req: Request) {
  const { error } = await sesionSuperadmin();
  if (error) return error;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'se esperaba multipart/form-data con archivos' }, { status: 400 });
  }
  const archivos: ArchivoNuevo[] = [];
  let totalBytes = 0;
  for (const [, valor] of form.entries()) {
    if (!(valor instanceof File)) continue;
    if (archivos.length >= MAX_ARCHIVOS_POR_LOTE) {
      return NextResponse.json({ error: `máximo ${MAX_ARCHIVOS_POR_LOTE} archivos por lote — manda el resto en otra tanda` }, { status: 413 });
    }
    const bytes = Buffer.from(await valor.arrayBuffer());
    totalBytes += bytes.length;
    if (totalBytes > MAX_LOTE_BYTES) {
      return NextResponse.json({ error: 'el lote pasa de 120 MB — súbelo en dos tandas' }, { status: 413 });
    }
    archivos.push({ nombre: valor.name || 'sin-nombre', mime: valor.type, bytes });
  }
  if (archivos.length === 0) return NextResponse.json({ error: 'no llegó ningún archivo' }, { status: 400 });

  const db = supabaseAdmin();
  const r = await subirFotos(db, archivos);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });

  const fotos = await Promise.all(r.datos.fotos.map(async (f) => ({
    ...f,
    url: await firmarRuta(db, BUCKET_QA_FOTOS, f.path),
  })));
  return NextResponse.json({ resultados: r.datos.resultados, fotos });
}
