// ═══════════════════════════════════════════════════════════════════════════
// IMPORTA EL LEDGER DEL PANEL DE QA — de los JSON de Storage a las tablas de
// la migración 0185.
//
//   npx tsx scripts/qa/importar-ledger.ts            # dice qué haría
//   npx tsx scripts/qa/importar-ledger.ts --aplicar  # lo hace
//
// La Fase A guardaba el banco en `qa-fotos/banco/manifiesto.json` y cada
// corrida en `qa-evidencia/corridas/<id>/corrida.json`. La 0185 creó las
// tablas; esto pasa lo que ya existe, sin perder historial ni tocar un byte
// de las imágenes (las filas conservan el `path` original — este script no
// mueve objetos).
//
// IDEMPOTENTE por construcción: las fotos entran con `on conflict (hash) do
// nothing` y las corridas con `on conflict (id) do nothing`. Correrlo dos
// veces no duplica nada y no pisa lo que el panel ya haya escrito después.
// Por eso NO borra los JSON: hasta que la corrida en tabla se haya visto en
// la pantalla, el archivo es el respaldo. Borrarlos es una decisión aparte.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../../src/lib/supabase/admin';
import { BUCKET_QA_FOTOS, BUCKET_QA_EVIDENCIA } from '../../src/lib/admin/qa-storage';
import type { CorridaQA, FotoBanco } from '../../src/lib/admin/qa-tipos';

const APLICAR = process.argv.includes('--aplicar');
const db = supabaseAdmin();

function di(linea: string): void {
  console.log(linea);
}

async function leerJson<T>(bucket: string, path: string): Promise<T | null> {
  const { data, error } = await db.storage.from(bucket).download(path);
  if (error || !data) return null;
  try {
    return JSON.parse(await data.text()) as T;
  } catch {
    return null;
  }
}

async function importarFotos(): Promise<{ vistas: number; nuevas: number }> {
  const crudo = await leerJson<{ fotos?: FotoBanco[] }>(BUCKET_QA_FOTOS, 'banco/manifiesto.json');
  const fotos = crudo?.fotos ?? [];
  if (fotos.length === 0) {
    di('· banco: el manifiesto no existe o está vacío — nada que importar.');
    return { vistas: 0, nuevas: 0 };
  }

  const { data: yaHay, error } = await db.from('qa_foto').select('hash');
  if (error) throw new Error(`no se pudo leer qa_foto: ${error.message}`);
  const conocidos = new Set((yaHay ?? []).map((f: { hash: string }) => f.hash));
  const faltan = fotos.filter((f) => !conocidos.has(f.hash));

  di(`· banco: ${fotos.length} en el manifiesto, ${conocidos.size} ya en tabla, ${faltan.length} por importar.`);
  if (!APLICAR || faltan.length === 0) return { vistas: fotos.length, nuevas: faltan.length };

  // Se conservan `id` y `subido_en` originales: el id viaja en los
  // `parametros.fotoIds` de las corridas viejas, y cambiarlo rompería la
  // trazabilidad de qué foto corrió en qué corrida.
  const filas = faltan.map((f) => ({
    id: f.id, hash: f.hash, path: f.path, mime: f.mime,
    etiqueta: f.etiqueta, bytes: f.bytes, subido_en: f.subidoEn,
  }));
  const { error: errIns } = await db.from('qa_foto').upsert(filas, { onConflict: 'hash', ignoreDuplicates: true });
  if (errIns) throw new Error(`no se pudieron importar las fotos: ${errIns.message}`);
  return { vistas: fotos.length, nuevas: faltan.length };
}

async function importarCorridas(): Promise<{ vistas: number; nuevas: number; pasos: number }> {
  const { data: carpetas, error } = await db.storage.from(BUCKET_QA_EVIDENCIA).list('corridas', { limit: 1000 });
  if (error) throw new Error(`no se pudieron listar las corridas: ${error.message}`);
  const ids = (carpetas ?? []).filter((e) => !e.id).map((e) => e.name);
  if (ids.length === 0) {
    di('· corridas: ninguna carpeta en qa-evidencia/corridas — nada que importar.');
    return { vistas: 0, nuevas: 0, pasos: 0 };
  }

  const { data: yaHay, error: errSel } = await db.from('qa_corrida').select('id');
  if (errSel) throw new Error(`no se pudo leer qa_corrida: ${errSel.message}`);
  const conocidas = new Set((yaHay ?? []).map((c: { id: string }) => c.id));

  const nuevas: CorridaQA[] = [];
  const ilegibles: string[] = [];
  for (const id of ids) {
    if (conocidas.has(id)) continue;
    const c = await leerJson<CorridaQA>(BUCKET_QA_EVIDENCIA, `corridas/${id}/corrida.json`);
    // Un JSON que no se puede leer se NOMBRA. Saltarlo en silencio sería
    // perder una corrida y creer que se importó todo.
    if (!c) { ilegibles.push(id); continue; }
    nuevas.push(c);
  }

  const totalPasos = nuevas.reduce((s, c) => s + (c.pasos?.length ?? 0), 0);
  di(`· corridas: ${ids.length} carpetas, ${conocidas.size} ya en tabla, ${nuevas.length} por importar (${totalPasos} pasos).`);
  if (ilegibles.length > 0) di(`  ⚠️  ${ilegibles.length} JSON ilegibles, NO importados: ${ilegibles.join(', ')}`);
  if (!APLICAR || nuevas.length === 0) return { vistas: ids.length, nuevas: nuevas.length, pasos: totalPasos };

  const filas = nuevas.map((c) => ({
    id: c.id, escenario: c.escenario, carril: c.carril ?? 'rapido',
    parametros: c.parametros, estado: c.estado, motivo: c.motivo,
    tenant_id: c.tenantId, tenant_nombre: c.tenantNombre,
    creada_en: c.creadaEn, inicio: c.inicio, fin: c.fin,
    latido_en: c.latidoEn ?? c.creadaEn,
    costo_usd_total: c.costoUsdTotal ?? 0,
    veredicto: c.veredicto, turnos: c.turnos ?? [],
    pdfs: c.pdfs ?? [], limpieza: c.limpieza,
  }));
  const { error: errC } = await db.from('qa_corrida').upsert(filas, { onConflict: 'id', ignoreDuplicates: true });
  if (errC) throw new Error(`no se pudieron importar las corridas: ${errC.message}`);

  const filasPaso = nuevas.flatMap((c) => (c.pasos ?? []).map((p) => ({
    corrida_id: c.id, n: p.n, nombre: p.nombre, estado: p.estado,
    costo_usd: p.costoUsd ?? 0, detalle: p.detalle ?? null,
    inicio: p.inicio ?? null, fin: p.fin ?? null,
  })));
  if (filasPaso.length > 0) {
    const { error: errP } = await db.from('qa_corrida_paso')
      .upsert(filasPaso, { onConflict: 'corrida_id,n', ignoreDuplicates: true });
    if (errP) throw new Error(`no se pudieron importar los pasos: ${errP.message}`);
  }
  return { vistas: ids.length, nuevas: nuevas.length, pasos: filasPaso.length };
}

async function main(): Promise<void> {
  di(APLICAR ? '── IMPORTANDO el ledger de QA a las tablas de la 0185 ──' : '── ENSAYO (sin --aplicar no se escribe nada) ──');
  const fotos = await importarFotos();
  const corridas = await importarCorridas();
  di('');
  di(APLICAR
    ? `✔ importado: ${fotos.nuevas} fotos, ${corridas.nuevas} corridas, ${corridas.pasos} pasos.`
    : `Se importarían: ${fotos.nuevas} fotos, ${corridas.nuevas} corridas, ${corridas.pasos} pasos. Corre con --aplicar.`);
  di('Los JSON de Storage NO se borran: son el respaldo hasta que verifiques el panel.');
}

main().catch((e) => {
  console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
