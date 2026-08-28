// ═══════════════════════════════════════════════════════════════════════════
// EL LEDGER EN VIVO DE UNA CORRIDA — /api/admin/qa/<id>/estado (GET).
//
// Lo pollea /admin/qa/<id> cada ~2.5 s. Devuelve la corrida tal cual está
// escrita en Storage MÁS la evidencia firmada al momento (60 s, mismo plazo
// que el PDF de producción): las fotos usadas y el PDF si sobrevive (con
// retención "borrar_al_terminar" el PDF se va junto con el tenant — y la
// respuesta lo dice en vez de dar un link muerto).
//
// Fallar cerrado: si Storage no responde, 502 con el motivo — el panel pinta
// "no se pudo leer", nunca "sin corrida".
// ═══════════════════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { leerCorrida, leerManifiesto, firmarRutas, BUCKET_QA_FOTOS } from '@/lib/admin/qa-storage';
import { sesionSuperadmin } from '../../puerta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await sesionSuperadmin();
  if (error) return error;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'id inválido' }, { status: 404 });

  const db = supabaseAdmin();
  const r = await leerCorrida(db, id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  if (!r.datos) return NextResponse.json({ error: 'corrida no encontrada' }, { status: 404 });
  const corrida = r.datos;

  // Evidencia clicable: las fotos de la corrida, firmadas al momento — EN UN
  // SOLO request. Este endpoint se pollea cada ~2.5 s, y firmarlas una por una
  // fue la causa raíz del incidente del 28-ago-2026 (corrida 46ad99ca): ~90
  // POST /object/sign por poll, polls traslapados, el pool de Storage API
  // lleno, y 10 descargas del carril rebotadas con «Too many connections
  // issued to the database». Ver la cabecera de `firmarRutas`.
  const manifiesto = await leerManifiesto(db);
  const fotos: Array<{ id: string; etiqueta: string; url: string | null }> = [];
  if (manifiesto.ok) {
    const porId = new Map(manifiesto.datos.map((f) => [f.id, f]));
    const urls = await firmarRutas(
      db, BUCKET_QA_FOTOS,
      corrida.parametros.fotoIds.map((id) => porId.get(id)?.path).filter((p): p is string => p !== undefined),
    );
    for (const fotoId of corrida.parametros.fotoIds) {
      const f = porId.get(fotoId);
      fotos.push({
        id: fotoId,
        etiqueta: f?.etiqueta ?? '(ya no está en el banco)',
        url: f ? urls.get(f.path) ?? null : null,
      });
    }
  }

  // El PDF: firmable solo si el objeto sigue vivo (retención). null = borrado
  // con el tenant, y el panel lo dice — un link muerto es peor que ninguno.
  const urlsPdf = await firmarRutas(db, 'liquidaciones', corrida.pdfs ?? []);
  const pdfs = (corrida.pdfs ?? []).map((path) => ({
    path,
    url: urlsPdf.get(path) ?? null,
  }));

  return NextResponse.json({ corrida, fotos, pdfs, ahora: new Date().toISOString() });
}
