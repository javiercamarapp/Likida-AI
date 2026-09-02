// ═══════════════════════════════════════════════════════════════════════════
// EL MEDIDOR DE UNA CORRIDA — compara lo que la corrida LEYÓ DE VERDAD contra
// la verdad-de-terreno del banco, foto por foto, y lo deja ESCRITO. SOLO
// servidor (habla con la base); el juicio campo por campo es de qa-verdad.ts,
// que es puro y ya está probado.
//
// EL AGUJERO QUE VIENE A CERRAR, MEDIDO: la corrida del 28-ago-2026 procesó
// las 90 fotos reales (qa_corrida_foto = 90, US$0.29 de modelo), y
// `qa_foto_lectura` quedó en CERO — el carril completo mandaba cada foto por
// `processInbound` y nadie comparaba lo leído contra `qa_foto.ocr_esperado`.
// El gasto compró lecturas; la medición, que era el punto, no existió.
//
// DE DÓNDE SALE "LO QUE LA CORRIDA LEYÓ". De la EVIDENCIA PERSISTIDA, no de
// volver a llamar al modelo: los `gasto` del tenant sintético (cruzados por
// `img_hash` = `qa_foto.hash`, el mismo sha256 de bytes en las dos puntas) y
// los `comprobante_huerfano` si el guion mandó un ticket tarde. Medir sobre lo
// persistido tiene dos virtudes que ninguna alternativa da: no cuesta un
// centavo re-medir (idempotencia barata), y mide EL CARRIL COMPLETO — lo que
// de verdad entró al sistema, que es lo que acaba en una liquidación y en una
// deducción. El precio está dicho en `medirSinGasto`: una foto que el pipeline
// rechazó no conserva lo que el modelo leyó, y ahí se elige estricto.
//
// CUÁNDO CORRE: en la fase de oráculos de la corrida, ANTES de la limpieza —
// la limpieza borra el tenant en cascada y con él los `gasto` que son la
// evidencia. También lo corre `scripts/qa/medir-corrida.ts` sobre una corrida
// ya terminada cuyo tenant se CONSERVÓ (retención o aborto).
//
// LA IDEMPOTENCIA ES DE LA BASE: el índice único parcial de la 0246. Correr
// la medición dos veces sobre la misma corrida no duplica una fila — el
// segundo intento rebota con 23505 y aquí se cuenta como "ya medida".
// ═══════════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CorridaQA, EstadoFotoCorrida, FotoBanco } from './qa-tipos';
import {
  medir, medirSinGasto, medicionSinLeer, ocrVacio, ocrLeidoDeGasto, resumenPrecision,
  type OcrLeido, type MedicionFotoResumen, type ResumenPrecisionCorrida,
} from './qa-verdad';
import {
  leerManifiesto, leerFotosDeCorrida, guardarLecturaDeCorrida, leerLecturasDeCorrida,
  type LecturaFoto, type LecturaNueva,
} from './qa-storage';

type Resultado<T> = { ok: true; datos: T } | { ok: false; error: string };

/** Las columnas de `gasto` que la medición necesita, tal cual la base. */
export interface GastoEvidencia {
  img_hash: string | null;
  monto: number | string | null;
  fecha: string | null;
  folio: string | null;
  rfc_emisor: string | null;
  ocr_extra: Record<string, unknown> | null;
}

/** Fila de `gasto` → las 7 claves medibles. Reusa `ocrLeidoDeGasto` (el
 *  puente probado con el Gasto de producción) adaptando solo el casing de la
 *  base. `monto` no finito o ≤ 0 se queda en null vía el propio puente. */
export function ocrLeidoDeGastoPersistido(g: GastoEvidencia): OcrLeido {
  const monto = g.monto === null || g.monto === undefined ? undefined : Number(g.monto);
  return ocrLeidoDeGasto({
    ...(monto !== undefined && Number.isFinite(monto) ? { monto } : {}),
    ...(g.fecha !== null && g.fecha !== undefined ? { fecha: g.fecha } : {}),
    ...(g.folio !== null && g.folio !== undefined ? { folio: g.folio } : {}),
    ...(g.rfc_emisor !== null && g.rfc_emisor !== undefined ? { rfcEmisor: g.rfc_emisor } : {}),
    ocrExtra: g.ocr_extra ?? {},
  });
}

/** El rótulo de modelo de las lecturas de una corrida, a partir de los
 *  modelos que `llm_costo` registró en fase 'ocr'. El ledger no ata cada
 *  llamada a su foto, así que con UN modelo se afirma ese; con varios se
 *  dicen todos (no se elige uno al azar); con ninguno se dice que no quedó
 *  registrado — jamás se inventa un nombre. Pura. */
export function modeloOcrDeCorrida(modelosFaseOcr: readonly string[]): string {
  const unicos = [...new Set(modelosFaseOcr.filter((m) => typeof m === 'string' && m.trim() !== ''))];
  if (unicos.length === 0) return 'ocr:modelo-no-registrado';
  if (unicos.length === 1) return unicos[0];
  return `ocr:varios(${unicos.sort().join(', ')})`;
}

/** Todo lo que hace falta para juzgar UNA foto de la corrida. */
export interface EntradaMedicionFoto {
  foto: FotoBanco;
  /** Estado en `qa_corrida_foto`, o `null` si la corrida nunca le dio turno
   *  (o el carril rápido, que no lleva esas filas — ahí `estado` lo aporta el
   *  motor con lo que él mismo vio). */
  estado: EstadoFotoCorrida | null;
  detalle: string | null;
  /** Costo MEDIDO de esta foto (qa_corrida_foto.costo_usd). null = no se
   *  midió: la fila lleva 0 y el motivo lo DICE — jamás un 0 mudo. */
  costoUsd: number | null;
  /** El `gasto` que la corrida persistió para esta foto (por img_hash). */
  gasto: GastoEvidencia | null;
  /** Lo mismo, si acabó en `comprobante_huerfano` (ticket tras el cierre):
   *  el jsonb `gasto` del huérfano viene en camelCase (es el Gasto en
   *  memoria), así que llega ya traducido a OcrLeido. */
  huerfanoLeido: OcrLeido | null;
}

/**
 * La lectura de UNA foto de la corrida, lista para escribirse. PURA — es la
 * pieza que decide cómo se cuenta cada caso, así que se prueba sola:
 *
 *  · con evidencia persistida (gasto o huérfano) → `medir` campo por campo;
 *  · procesada sin evidencia → `medirSinGasto` (la regla de las dos listas y
 *    la clase del papel deciden: rechazo correcto / rechazo por diseño /
 *    fallo de punta a punta);
 *  · foto que el modelo pudo no haber visto (bad / interrumpida / corriendo /
 *    sin turno) → 7 campos sin medir, con el motivo técnico — un fallo de
 *    infraestructura contado como fallo de lectura hundiría la exactitud sin
 *    que el modelo haya visto la foto;
 *  · sin verdad-de-terreno → 7 sin medir: no hay vara.
 */
export function prepararLecturaDeFoto(e: EntradaMedicionFoto, modeloOcr: string): LecturaNueva {
  const verdad = e.foto.ocrEsperado;
  const notaCosto = e.costoUsd === null
    ? 'el costo de esta foto NO se midió en la corrida: el 0 no significa gratis'
    : null;
  const costoUsd = e.costoUsd !== null && Number.isFinite(e.costoUsd) ? Math.max(0, e.costoUsd) : 0;
  const conMotivos = (...partes: Array<string | null>) => partes.filter(Boolean).join(' · ') || null;

  if (verdad === null) {
    return {
      fotoId: e.foto.id, modelo: modeloOcr, ocrLeido: ocrVacio(),
      medicion: medicionSinLeer('esta foto no tiene verdad-de-terreno confirmada: la corrida la procesó pero no hay contra qué medir lo que leyó'),
      costoUsd,
      motivo: conMotivos('sin verdad-de-terreno confirmada — etiquétala y vuelve a medir la corrida (no cuesta modelo: se mide sobre lo persistido)', notaCosto),
    };
  }

  const leido = e.gasto !== null ? ocrLeidoDeGastoPersistido(e.gasto) : e.huerfanoLeido;
  if (leido !== null) {
    // Hay evidencia persistida: se mide contra ella, DIGA lo que diga el
    // estado de la fila — una 'interrumpida' con gasto escrito sí se procesó,
    // y la evidencia manda sobre la sospecha.
    return {
      fotoId: e.foto.id, modelo: modeloOcr, ocrLeido: leido,
      medicion: medir(verdad, leido),
      costoUsd,
      motivo: conMotivos(
        e.huerfanoLeido !== null && e.gasto === null
          ? 'medida sobre el comprobante_huerfano que dejó el ticket tardío'
          : null,
        notaCosto,
      ),
    };
  }

  if (e.estado === null || e.estado === 'bad' || e.estado === 'interrumpida' || e.estado === 'corriendo') {
    // No hay evidencia Y no se puede afirmar que el modelo vio la foto: la
    // descarga falló, la pasada murió con ella en vuelo, o nunca tuvo turno.
    // Ni acierto ni fallo — 7 campos fuera del denominador, con el porqué.
    const causa = e.estado === null
      ? 'la corrida terminó sin darle turno a esta foto: no se procesó'
      : e.estado === 'bad'
        ? `la foto falló ANTES de que el modelo la viera (${e.detalle ?? 'sin detalle'})`
        : e.estado === 'interrumpida'
          ? 'una pasada murió con esta foto en vuelo: no se sabe si el modelo llegó a verla, y no dejó gasto'
          : 'la foto sigue marcada en vuelo y no dejó gasto: no se afirma nada sobre ella';
    return {
      fotoId: e.foto.id, modelo: modeloOcr, ocrLeido: ocrVacio(),
      medicion: medicionSinLeer(causa),
      costoUsd,
      motivo: conMotivos(causa, notaCosto),
    };
  }

  // Procesada ('ok') y sin nada persistido: el pipeline la RECHAZÓ. La clase
  // del papel decide cómo se cuenta (medirSinGasto tiene el porqué entero).
  return {
    fotoId: e.foto.id, modelo: modeloOcr, ocrLeido: ocrVacio(),
    medicion: medirSinGasto(verdad),
    costoUsd,
    motivo: conMotivos(
      verdad.clase === 'no_comprobante'
        ? 'el pipeline RECHAZÓ esta foto y no persistió nada — para un papel que no es comprobante, ese es el veredicto correcto'
        : verdad.clase === 'voucher_bancario'
          ? 'el pipeline reconoció el voucher y lo rechazó por diseño (solo_pago): sus campos con valor quedan sin medir, no como error'
          : 'la corrida procesó la foto y NO quedó ningún gasto: de punta a punta no se leyó nada (los campos impresos cuentan como error — estricto a propósito)',
      notaCosto,
    ),
  };
}

/** Las lecturas de una corrida, cruzadas con el banco, en la forma que la
 *  pantalla pinta (`resumenPrecision` es puro y client-safe; esto solo hace
 *  el cruce). Una foto que ya no está en el banco lo DICE en su etiqueta —
 *  no desaparece del resumen. */
export function resumenDeLecturas(
  lecturas: readonly LecturaFoto[], fotosBanco: readonly FotoBanco[],
): ResumenPrecisionCorrida {
  const porId = new Map(fotosBanco.map((f) => [f.id, f]));
  const fotos: MedicionFotoResumen[] = lecturas.map((l) => {
    const f = porId.get(l.fotoId);
    return {
      fotoId: l.fotoId,
      etiqueta: f?.etiqueta ?? '(ya no está en el banco)',
      clase: f?.ocrEsperado?.clase ?? null,
      medicion: l.medicion,
      modelo: l.modelo,
      motivo: l.motivo,
      costoUsd: l.costoUsd,
    };
  });
  return resumenPrecision(fotos);
}

export interface ResumenMedicionCorrida {
  /** Filas NUEVAS escritas por esta pasada del medidor. */
  medidas: number;
  /** Rebotes del índice de la 0246: fotos que esta corrida ya tenía medidas. */
  yaMedidas: number;
  /** Fotos cuya lectura NO se pudo escribir, con su motivo — dichas una por
   *  una, jamás un conteo que no cuadra en silencio. */
  fallos: string[];
  /** Todas las lecturas de la corrida tras medir (una por foto). */
  lecturas: LecturaFoto[];
}

/**
 * Mide UNA corrida contra la verdad-de-terreno y escribe `qa_foto_lectura`.
 *
 * `evidenciaRapida` la aporta el carril RÁPIDO (que no lleva filas de
 * `qa_corrida_foto`): el estado de cada foto tal como el propio motor lo vio.
 * El carril completo la omite y se leen las filas reales.
 *
 * Falla cerrado: si la evidencia no se puede LEER (gastos, banco, avance), no
 * se escribe nada y se dice — medir contra una lectura a medias produciría
 * exactamente la cifra inventada que este módulo existe para no producir.
 */
export async function medirCorrida(
  db: SupabaseClient,
  corrida: CorridaQA,
  evidenciaRapida?: ReadonlyMap<string, { estado: EstadoFotoCorrida; detalle: string | null; costoUsd: number | null }>,
): Promise<Resultado<ResumenMedicionCorrida>> {
  const preparado = await prepararMedicionCorrida(db, corrida, evidenciaRapida);
  if (!preparado.ok) return preparado;

  let medidas = 0;
  let yaMedidas = 0;
  const fallos = [...preparado.datos.fallos];
  for (const lectura of preparado.datos.lecturas) {
    const guardada = await guardarLecturaDeCorrida(db, corrida.id, lectura);
    if (!guardada.ok) {
      fallos.push(`${lectura.fotoId}: ${guardada.error}`);
      continue;
    }
    if (guardada.yaMedida) yaMedidas += 1;
    else medidas += 1;
  }

  const lecturas = await leerLecturasDeCorrida(db, corrida.id);
  if (!lecturas.ok) {
    return { ok: false, error: `la medición se escribió (${medidas} nuevas, ${yaMedidas} ya estaban) pero no se pudo releer: ${lecturas.error}` };
  }
  return { ok: true, datos: { medidas, yaMedidas, fallos, lecturas: lecturas.datos } };
}

/**
 * Lee la evidencia de la corrida y PREPARA las lecturas sin escribir nada —
 * la mitad que el script puede correr en ensayo. Falla cerrado sobre
 * cualquier evidencia ilegible.
 */
export async function prepararMedicionCorrida(
  db: SupabaseClient,
  corrida: CorridaQA,
  evidenciaRapida?: ReadonlyMap<string, { estado: EstadoFotoCorrida; detalle: string | null; costoUsd: number | null }>,
): Promise<Resultado<{ lecturas: LecturaNueva[]; fallos: string[]; modeloOcr: string; fotosBanco: FotoBanco[] }>> {
  const tenantId = corrida.tenantId;
  if (!tenantId) return { ok: false, error: 'la corrida no llegó a sembrar tenant: no hay evidencia que medir' };

  // EL GUARD DE LA EVIDENCIA BORRADA. Si la limpieza ya se llevó el tenant,
  // la consulta de gastos devolvería 0 filas VERDADERAS — y la medición
  // contaría 90 fotos como "rechazadas por el pipeline", que es una mentira
  // completa con la suma cuadrada. Cero gastos solo es un dato si el tenant
  // sigue vivo.
  const tenant = await db.from('tenant').select('id').eq('id', tenantId).maybeSingle();
  if (tenant.error) return { ok: false, error: `no se pudo comprobar que el tenant sintético siga vivo: ${tenant.error.message}` };
  if (!tenant.data) {
    return { ok: false, error: `el tenant sintético ${tenantId} ya se limpió: los gastos que eran la evidencia se borraron en cascada, y medir sobre su ausencia contaría cada foto como rechazada. Esta corrida ya no se puede medir — la próxima se mide sola ANTES de su limpieza.` };
  }

  const manifiesto = await leerManifiesto(db);
  if (!manifiesto.ok) return { ok: false, error: `no se pudo leer el banco de fotos: ${manifiesto.error}` };
  const porId = new Map(manifiesto.datos.map((f) => [f.id, f]));

  // El avance real (carril completo) o el que el motor vio (rápido).
  let filas: Map<string, { estado: EstadoFotoCorrida; detalle: string | null; costoUsd: number | null }>;
  if (evidenciaRapida) {
    filas = new Map(evidenciaRapida);
  } else {
    const avance = await leerFotosDeCorrida(db, corrida.id);
    if (!avance.ok) return { ok: false, error: `no se pudo leer el avance foto por foto: ${avance.error}` };
    filas = new Map(avance.datos.map((f) => [f.fotoId, { estado: f.estado, detalle: f.detalle, costoUsd: f.costoUsd }]));
  }

  // La evidencia persistida: gastos por hash. El error se lee POR VALOR y
  // detiene la medición entera — "0 gastos" sobre una tabla ilegible contaría
  // 90 fotos como rechazadas.
  const gastos = await db.from('gasto')
    .select('img_hash, monto, fecha, folio, rfc_emisor, ocr_extra')
    .eq('tenant_id', tenantId);
  if (gastos.error) return { ok: false, error: `no se pudieron leer los gastos del tenant sintético: ${gastos.error.message}` };
  const gastoPorHash = new Map<string, GastoEvidencia>();
  for (const g of (gastos.data ?? []) as GastoEvidencia[]) {
    if (g.img_hash) gastoPorHash.set(g.img_hash, g);
  }

  // Los huérfanos (ticket tras el cierre): su `gasto` es jsonb en camelCase.
  const huerfanos = await db.from('comprobante_huerfano')
    .select('gasto')
    .eq('tenant_id', tenantId);
  if (huerfanos.error) return { ok: false, error: `no se pudieron leer los huérfanos del tenant sintético: ${huerfanos.error.message}` };
  const huerfanoPorHash = new Map<string, OcrLeido>();
  for (const h of (huerfanos.data ?? []) as Array<{ gasto: unknown }>) {
    const g = h.gasto as { imgHash?: string } & Parameters<typeof ocrLeidoDeGasto>[0] | null;
    if (g && typeof g.imgHash === 'string') huerfanoPorHash.set(g.imgHash, ocrLeidoDeGasto(g));
  }

  // El modelo que de verdad respondió, del ledger — nunca inventado.
  const costos = await db.from('llm_costo').select('modelo, fase').eq('tenant_id', tenantId);
  if (costos.error) return { ok: false, error: `no se pudo leer llm_costo para nombrar el modelo: ${costos.error.message}` };
  const modeloOcr = modeloOcrDeCorrida(
    ((costos.data ?? []) as Array<{ modelo: string | null; fase: string | null }>)
      .filter((c) => c.fase === 'ocr').map((c) => c.modelo ?? ''),
  );

  const lecturas: LecturaNueva[] = [];
  const fallos: string[] = [];
  for (const fotoId of corrida.parametros.fotoIds) {
    const foto = porId.get(fotoId);
    if (!foto) {
      fallos.push(`la foto ${fotoId} ya no está en el banco — sin su hash no se puede cruzar la evidencia`);
      continue;
    }
    const fila = filas.get(fotoId) ?? null;
    lecturas.push(prepararLecturaDeFoto({
      foto,
      estado: fila?.estado ?? null,
      detalle: fila?.detalle ?? null,
      costoUsd: fila?.costoUsd ?? null,
      gasto: gastoPorHash.get(foto.hash) ?? null,
      huerfanoLeido: huerfanoPorHash.get(foto.hash) ?? null,
    }, modeloOcr));
  }

  return { ok: true, datos: { lecturas, fallos, modeloOcr, fotosBanco: manifiesto.datos } };
}
