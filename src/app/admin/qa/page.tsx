import { supabaseAdmin } from '@/lib/supabase/admin';
import { leerManifiesto, listarCorridas, gastoHoyUsd, firmarRuta, BUCKET_QA_FOTOS } from '@/lib/admin/qa-storage';
import { TOPE_DIA_USD } from '@/lib/admin/qa-tipos';
import { PantallaQa } from './pantalla';
import type { FotoConUrl } from './lanzar-form';

export const dynamic = 'force-dynamic';

/**
 * /admin/qa — el panel de QA (Fase A). La puerta ya la puso el layout de
 * /admin (`requireSuperadmin()`); aquí solo se LEE — cada fuente falla por
 * valor y la pantalla lo dice (PantallaQa), nunca un "sin corridas" sobre un
 * Storage caído.
 *
 * Diseño completo: 00-PANEL-DE-QA.md (carpeta qa-autonomo/panel). El estado
 * vive en Storage (buckets qa-fotos / qa-evidencia) mientras las migraciones
 * de qa_corrida/qa_foto siguen congeladas — ver qa-tipos.ts, cabecera.
 */
export default async function QaPage() {
  const db = supabaseAdmin();

  let fotos: FotoConUrl[] = [];
  let bancoError: string | null = null;
  const manifiesto = await leerManifiesto(db).catch((e) => ({ ok: false as const, error: String(e) }));
  if (manifiesto.ok) {
    fotos = await Promise.all(manifiesto.datos.map(async (f) => ({
      ...f,
      url: await firmarRuta(db, BUCKET_QA_FOTOS, f.path).catch(() => null),
    })));
  } else {
    bancoError = manifiesto.error;
  }

  const historial = await listarCorridas(db).catch((e) => ({ ok: false as const, error: String(e) }));
  const gasto = await gastoHoyUsd(db).catch((e) => ({ ok: false as const, error: String(e) }));

  return (
    <PantallaQa
      fotos={fotos}
      bancoError={bancoError}
      corridas={historial.ok ? historial.datos : []}
      historialError={historial.ok ? null : historial.error}
      gastoHoy={gasto.ok ? gasto.datos : null}
      gastoError={gasto.ok ? null : gasto.error}
      topeDiaUsd={TOPE_DIA_USD}
    />
  );
}
