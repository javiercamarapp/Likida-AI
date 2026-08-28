import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  leerManifiesto, listarCorridas, gastoHoyUsd, firmarRuta, leerUltimasLecturas, BUCKET_QA_FOTOS,
} from '@/lib/admin/qa-storage';
import { TOPE_DIA_USD } from '@/lib/admin/qa-tipos';
import { TOPE_CORRIDA_USD } from '../../../../scripts/qa-agentes/config.qa';
import { PantallaQa } from './pantalla';
import type { UltimaLectura } from './banco-verdad';
import type { FotoConUrl } from './lanzar-form';

export const dynamic = 'force-dynamic';

/**
 * /admin/qa — el panel de QA (Fase A). La puerta ya la puso el layout de
 * /admin (`requireSuperadmin()`); aquí solo se LEE — cada fuente falla por
 * valor y la pantalla lo dice (PantallaQa), nunca un "sin corridas" sobre un
 * Storage caído.
 *
 * Diseño completo: 00-PANEL-DE-QA.md (carpeta qa-autonomo/panel). El estado
 * vive en las tablas qa_foto / qa_corrida / qa_corrida_paso (mig. 0185); en
 * Storage quedan solo los bytes — ver qa-tipos.ts, cabecera.
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

  // La última medición del OCR por foto (mig. 0239). Fuente PROPIA: que falle
  // no puede vaciar el banco ni el historial — el panel dice qué fuente se
  // cayó y sigue enseñando el resto (mismo criterio que las tres de arriba).
  // Un Map no viaja al cliente: se serializa como objeto plano.
  const lecturas = await leerUltimasLecturas(db).catch((e) => ({ ok: false as const, error: String(e) }));
  const lecturasIniciales: Record<string, UltimaLectura> = {};
  if (lecturas.ok) {
    for (const [fotoId, l] of lecturas.datos) {
      lecturasIniciales[fotoId] = {
        corridaEn: l.corridaEn, modelo: l.modelo, medicion: l.medicion,
        costoUsd: l.costoUsd, motivo: l.motivo,
      };
    }
  }

  return (
    <PantallaQa
      fotos={fotos}
      bancoError={bancoError}
      corridas={historial.ok ? historial.datos : []}
      historialError={historial.ok ? null : historial.error}
      gastoHoy={gasto.ok ? gasto.datos : null}
      gastoError={gasto.ok ? null : gasto.error}
      topeDiaUsd={TOPE_DIA_USD}
      topeCorridaUsd={TOPE_CORRIDA_USD}
      lecturasIniciales={lecturasIniciales}
      lecturasError={lecturas.ok ? null : lecturas.error}
    />
  );
}
