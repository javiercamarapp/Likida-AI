import { notFound } from 'next/navigation';
import { Bug } from 'lucide-react';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { leerCorrida, leerManifiesto, leerLecturasDeCorrida, firmarRutas, BUCKET_QA_FOTOS } from '@/lib/admin/qa-storage';
import { resumenDeLecturas } from '@/lib/admin/qa-medicion';
import type { ResumenPrecisionCorrida } from '@/lib/admin/qa-verdad';
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
  //
  // FE-14 (22-ago-2026) puso las firmas en paralelo para no pagar 20 viajes
  // EN SERIE; el incidente del 28-ago-2026 (corrida 46ad99ca) enseñó el otro
  // filo: ~90 firmas EN PARALELO por pintada + el poll de /estado saturaban
  // el pool de Storage API («Too many connections issued to the database», 10
  // fotos del carril rebotadas). La forma correcta era la tercera: UN solo
  // request que firma todas (`firmarRutas`). El orden lo preserva el `map`
  // sobre `fotoIds`, que es el que la pantalla enseña.
  const manifiesto = await leerManifiesto(db);
  const porId = manifiesto.ok ? new Map(manifiesto.datos.map((f) => [f.id, f])) : null;
  const urls = porId === null ? new Map<string, string | null>() : await firmarRutas(
    db, BUCKET_QA_FOTOS,
    corrida.parametros.fotoIds.map((id) => porId.get(id)?.path).filter((p): p is string => p !== undefined),
  );
  const fotos: FotoFirmada[] = porId === null ? [] : corrida.parametros.fotoIds.map((fotoId) => {
    const f = porId.get(fotoId);
    return {
      id: fotoId,
      etiqueta: f?.etiqueta ?? '(ya no está en el banco)',
      url: f ? urls.get(f.path) ?? null : null,
    };
  });
  const urlsPdf = await firmarRutas(db, 'liquidaciones', corrida.pdfs ?? []);
  const pdfs: PdfFirmado[] = (corrida.pdfs ?? []).map((path) => ({
    path,
    url: urlsPdf.get(path) ?? null,
  }));

  // LA PRECISIÓN MEDIDA (qa_foto_lectura) de la primera pintada. Importa
  // sobre todo en una corrida TERMINADA, donde el polling ya no corre y esta
  // lectura es la única. Cero lecturas = todavía sin medir (null); un fallo
  // de lectura se dice aparte, jamás como "sin medir".
  let medicionInicial: ResumenPrecisionCorrida | null = null;
  let medicionErrorInicial: string | null = null;
  const lecturas = await leerLecturasDeCorrida(db, id);
  if (!lecturas.ok) medicionErrorInicial = lecturas.error;
  else if (lecturas.datos.length > 0) {
    medicionInicial = resumenDeLecturas(lecturas.datos, manifiesto.ok ? manifiesto.datos : []);
  }

  return (
    <CorridaViva
      corridaInicial={corrida}
      fotosIniciales={fotos}
      pdfsIniciales={pdfs}
      medicionInicial={medicionInicial}
      medicionErrorInicial={medicionErrorInicial}
    />
  );
}
