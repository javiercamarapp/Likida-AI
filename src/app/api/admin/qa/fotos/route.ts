// ═══════════════════════════════════════════════════════════════════════════
// EL BANCO DE FOTOS DE QA — /api/admin/qa/fotos.
//
// GET   → el manifiesto con URL firmada de 60 s por foto (miniaturas del
//         formulario — bucket privado, nunca un <img src> sin firmar). Desde
//         la Fase B pieza 2 cada foto viaja con su VERDAD-DE-TERRENO y con
//         `confirmadoEn`: la pantalla necesita distinguir "sin etiquetar" de
//         "etiquetada", porque una foto sin etiqueta no se puede medir.
// POST  → subida MÚLTIPLE (multipart): el pedido explícito de Javier es poder
//         soltar una "cantidad obscena de tickets" de golpe. Dedup por sha256
//         (mismo digest que img_hash de producción); cada archivo reporta su
//         suerte por separado.
// PATCH → EL ORÁCULO HUMANO: firma la verdad-de-terreno de UNA foto (lo que
//         una persona leyó mirando el comprobante). Es la vara contra la que
//         se mide el OCR, así que se valida dos veces —aquí con
//         `validarVerdadTerreno` y en la base con el CHECK de la 0239— y el
//         motivo del rechazo se dice completo.
// ═══════════════════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  leerManifiesto, subirFotos, firmarRuta, confirmarVerdadTerreno,
  BUCKET_QA_FOTOS, type ArchivoNuevo,
} from '@/lib/admin/qa-storage';
import { validarVerdadTerreno } from '@/lib/admin/qa-tipos';
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_PATCH = 16 * 1024;

/**
 * Firma la verdad-de-terreno de UNA foto: `{ fotoId, verdad }`.
 *
 * Quién la firma sale de LA SESIÓN, jamás del body. Un campo "confirmadoPor"
 * que el cliente pudiera mandar convertiría la firma en decoración —cualquiera
 * podría atribuirle una etiqueta a otro—, y esta columna existe precisamente
 * para que un "esperado" tenga un responsable.
 */
export async function PATCH(req: Request) {
  const { error, sesion } = await sesionSuperadmin();
  if (error) return error;

  const crudo = await req.text();
  if (crudo.length > MAX_BODY_PATCH) return NextResponse.json({ error: 'payload muy grande' }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(crudo);
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const b = body as Record<string, unknown> | null;
  const fotoId = b?.fotoId;
  if (typeof fotoId !== 'string' || !UUID_RE.test(fotoId)) {
    return NextResponse.json({ error: 'fotoId inválido — se esperaba el uuid de una foto del banco' }, { status: 400 });
  }

  // Se valida ANTES de tocar la base para que el motivo del rechazo sea el
  // texto largo de `validarVerdadTerreno` («folio: es null y no está
  // clasificado…») y no el mensaje de un CHECK de Postgres, que dice qué
  // restricción rebotó pero no cuál de las siete claves la rompió.
  const v = validarVerdadTerreno(b?.verdad);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const db = supabaseAdmin();
  const r = await confirmarVerdadTerreno(db, fotoId, v.datos, sesion.userId ?? null);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });

  const url = await firmarRuta(db, BUCKET_QA_FOTOS, r.datos.path);
  return NextResponse.json({ foto: { ...r.datos, url } });
}
