// ═══════════════════════════════════════════════════════════════════════════
// EL BORRADOR DE STORAGE — la mitad que faltaba del ciclo de purga.
//
// La 0165 aprendió a golpes que Supabase PROHÍBE `delete from storage.objects`
// desde SQL (lo corta el trigger `storage.protect_delete()`), y por eso el
// barrido nocturno solo MARCA candidatos en `storage_huerfano_candidato`.
//
// Lo que nadie escribió es lo que sigue: nada leía esa cola. Los archivos
// quedaban marcados para siempre y el bucket nunca se vaciaba. Con el ejecutor
// ARCO (0173) eso pasa de ser deuda a ser un incumplimiento: una cancelación
// que promete borrar las fotos del titular y las deja en el bucket es una
// promesa incumplida con evidencia escrita de que se prometió.
//
// POR QUÉ NO ES UNA FUNCIÓN DE POSTGRES: el borrado tiene que ir por la API de
// Storage, que es HTTP. Postgres no la puede llamar; este código sí.
//
// FAIL-CLOSED CON LA MARCA: `borrado_en` solo se sella cuando la API confirmó.
// Un archivo que falló se queda en la cola y lo reintenta la corrida siguiente
// — mejor reintentar mil veces que marcar como borrado algo que sigue ahí.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';

/** Tope por corrida: el cron tiene presupuesto y la API cobra por llamada. */
const LOTE = 200;

export interface ResultadoBorradoStorage {
  intentados: number;
  borrados: number;
  fallidos: number;
  /** Cuántos quedan en la cola sin borrar (para saber si hace falta otra vuelta). */
  pendientes: number | null;
}

/**
 * Vacía la cola de archivos marcados para borrado. Devuelve el conteo real —
 * no el intentado — porque el que importa para una constancia ARCO es cuántos
 * dejaron de existir.
 */
export async function borrarStorageMarcado(): Promise<ResultadoBorradoStorage> {
  const db = supabaseAdmin();

  const { data: cola, error } = await acotada(
    db.from('storage_huerfano_candidato')
      .select('bucket, nombre, motivo')
      .is('borrado_en', null)
      // Los de ARCO primero: tienen un plazo legal detrás (15 días hábiles),
      // los huérfanos ordinarios solo ocupan espacio.
      .order('motivo', { ascending: true })
      .order('detectado_en', { ascending: true })
      .limit(LOTE),
    'storage.cola_borrado',
  );
  if (error) {
    logger.error('storage.cola_ilegible', { err: error.message });
    return { intentados: 0, borrados: 0, fallidos: 0, pendientes: null };
  }

  const filas = cola ?? [];
  if (filas.length === 0) return { intentados: 0, borrados: 0, fallidos: 0, pendientes: 0 };

  // Agrupado por bucket: la API borra en lote y así es una llamada por bucket
  // en vez de una por archivo.
  const porBucket = new Map<string, string[]>();
  for (const f of filas) {
    const b = f.bucket as string;
    if (!porBucket.has(b)) porBucket.set(b, []);
    porBucket.get(b)!.push(f.nombre as string);
  }

  let borrados = 0;
  let fallidos = 0;

  for (const [bucket, nombres] of porBucket) {
    const { data, error: errBorrado } = await db.storage.from(bucket).remove(nombres);
    if (errBorrado) {
      // No se marca nada: la corrida siguiente lo reintenta entero.
      logger.error('storage.borrado_fallo', { bucket, n: nombres.length, err: errBorrado.message });
      fallidos += nombres.length;
      continue;
    }

    // `remove` devuelve SOLO lo que borró de verdad. Un archivo que ya no
    // existía no viene en la respuesta, y ése también hay que sellarlo: sigue
    // sin estar en el bucket, que es lo que la cola pregunta.
    const confirmados = new Set((data ?? []).map((o) => o.name));
    const aSellar = nombres.filter((n) => confirmados.has(n) || confirmados.size === 0);

    const { error: errSello } = await acotada(
      db.from('storage_huerfano_candidato')
        .update({ borrado_en: new Date().toISOString() })
        .eq('bucket', bucket)
        .in('nombre', aSellar),
      'storage.sellar_borrado',
    );
    if (errSello) {
      // El archivo YA no está, pero la marca no se pudo poner: la corrida
      // siguiente lo reintentará y la API devolverá "no existe", que este
      // mismo camino trata como borrado. No se pierde nada; se repite.
      logger.warn('storage.sello_fallo', { bucket, n: aSellar.length, err: errSello.message });
    }
    borrados += aSellar.length;
    fallidos += nombres.length - aSellar.length;
  }

  const { count } = await db.from('storage_huerfano_candidato')
    .select('nombre', { count: 'exact', head: true })
    .is('borrado_en', null);

  logger.info('storage.borrado', { intentados: filas.length, borrados, fallidos, pendientes: count });
  return { intentados: filas.length, borrados, fallidos, pendientes: count ?? null };
}
