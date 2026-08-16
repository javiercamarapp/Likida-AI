import { notFound } from 'next/navigation';
import { Bug } from 'lucide-react';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { leerCorrida, leerManifiesto, firmarRuta, BUCKET_QA_FOTOS } from '@/lib/admin/qa-storage';
import { BarraPagina } from '../../../dashboard/resumen-visual';
import { EstadoError } from '../../ui/kit';
import { CorridaViva, type FotoFirmada, type PdfFirmado } from './corrida-viva';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /admin/qa/<id> — la corrida abierta (molde: admin/corridas/[id]). El server
 * entrega la PRIMERA lectura; el vivo lo lleva CorridaViva con su polling.
 * La puerta la puso el layout de /admin.
 */
export default async function CorridaQaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const db = supabaseAdmin();
  const r = await leerCorrida(db, id).catch((e) => ({ ok: false as const, error: String(e) }));

  if (!r.ok) {
    // Error DICHO, no tragado: una pantalla en blanco sobre un Storage caído
    // afirmaría "esta corrida no dejó nada", que es lo contrario de un ledger.
    return (
      <main className="h-full">
        <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
          <BarraPagina icono={<Bug width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />} titulo="Corrida de QA" />
          <div className="px-5 py-5">
            <EstadoError mensaje={`No se pudo leer la corrida. ${r.error} — no es que no exista, es que no se pudo mirar.`} />
          </div>
        </div>
      </main>
    );
  }
  if (r.datos === null) notFound();
  const corrida = r.datos;

  // La evidencia firmada de la primera pintada (el polling la refresca).
  const manifiesto = await leerManifiesto(db);
  const fotos: FotoFirmada[] = [];
  if (manifiesto.ok) {
    const porId = new Map(manifiesto.datos.map((f) => [f.id, f]));
    for (const fotoId of corrida.parametros.fotoIds) {
      const f = porId.get(fotoId);
      fotos.push({
        id: fotoId,
        etiqueta: f?.etiqueta ?? '(ya no está en el banco)',
        url: f ? await firmarRuta(db, BUCKET_QA_FOTOS, f.path) : null,
      });
    }
  }
  const pdfs: PdfFirmado[] = await Promise.all((corrida.pdfs ?? []).map(async (path) => ({
    path,
    url: await firmarRuta(db, 'liquidaciones', path),
  })));

  return <CorridaViva corridaInicial={corrida} fotosIniciales={fotos} pdfsIniciales={pdfs} />;
}
