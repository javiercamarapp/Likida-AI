// ═══════════════════════════════════════════════════════════════════════════
// CORRER EL OCR REAL CONTRA EL BANCO — /api/admin/qa/fotos/ocr (POST).
//
// Qué hace: por cada foto seleccionada baja los BYTES del bucket privado, se
// los pasa a `extraerComprobante` —LA función de visión de producción,
// importada tal cual desde src/lib/likida/intake/ocr.ts, sin copia ni
// reimplementación— y mide lo que salió contra la verdad-de-terreno que una
// persona etiquetó. Cada corrida deja una fila en `qa_foto_lectura` (mig.
// 0239).
//
// POR QUÉ SE REUSA EL CAMINO DE PRODUCCIÓN Y NO SE ESCRIBE UN OCR "DE PRUEBA".
// Un extractor propio mediría el extractor propio. Lo que aquí interesa es si
// EL PIPELINE QUE CORRE CON LOS CHOFERES lee bien 91 comprobantes reales, así
// que se llama a la misma función, con el mismo prompt, el mismo esquema y el
// mismo cruce con el QR. Es el mismo criterio con el que `qa-motor.ts` importa
// `processInbound` en lugar de simular el webhook.
//
// ── EL RELOJ (regla de la casa nº10, patrón del PR #152) ───────────────────
//
// Esto ITERA sobre muchas fotos dentro de una función serverless, y cada foto
// es una llamada de visión de varios segundos. Sin reloj, un lote de 25 no cabe
// en `maxDuration` y la invocación MUERE A MEDIAS: las fotos que alcanzaron
// dejaron su fila, las que no, nada, y el navegador recibe un corte sin cuerpo.
// Nadie se entera de cuáles faltaron. El runner de producción murió mudo dos
// veces por motores que iteraban sin mirar el reloj (`escalar_viaje.ts`, ESC-3;
// `asistencia_escalamiento.ts`), y de ahí sale el patrón que se calca aquí:
// consultar `venceEn` ANTES de empezar cada foto y reportar por su nombre las
// que se quedaron sin turno (`sinTurno`), en vez de cortar en silencio.
//
// El corte va ANTES del gasto, no después: una foto que no arranca no cuesta
// nada y la vuelve a tomar la siguiente tanda. El cliente reintenta con
// `sinTurno` y no pierde el hilo.
// ═══════════════════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { extraerComprobante } from '@/lib/likida/intake/ocr';
import { TOPE_DIA_USD, validarLoteOcr } from '@/lib/admin/qa-tipos';
import {
  leerManifiesto, dataUrlDeFoto, guardarLectura, gastoHoyUsd, gastoLecturasHoyUsd,
} from '@/lib/admin/qa-storage';
import {
  medir, medicionSinLeer, ocrVacio, agregar, ocrLeidoDeGasto,
  type ResultadoFotoOcr,
} from '@/lib/admin/qa-verdad';
import { sesionSuperadmin } from '../../puerta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// El mismo techo probado del repo que usa /api/admin/qa/lanzar (y el webhook).
export const maxDuration = 120;

/**
 * El presupuesto de reloj de ESTA invocación, con margen para escribir la
 * respuesta. `maxDuration` es 120 s; se corta en 105 y quedan 15 s para que la
 * última foto en vuelo termine de escribir su fila y para serializar el JSON.
 * Mismo criterio que `TECHO_CORRIDA_MS` (110 s) de qa-motor, un poco más
 * conservador porque aquí la última llamada de visión ya está en curso cuando
 * el reloj se consulta.
 *
 * No se exporta: Next 16 rechaza cualquier export de un `route.ts` que no sea
 * un handler o una de sus opciones de segmento.
 */
const PRESUPUESTO_MS = 105_000;

const MAX_BODY = 8 * 1024;

export async function POST(req: Request) {
  const { error: puerta, sesion } = await sesionSuperadmin();
  if (puerta) return puerta;

  const crudo = await req.text();
  if (crudo.length > MAX_BODY) return NextResponse.json({ error: 'payload muy grande' }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(crudo);
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const v = validarLoteOcr(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const db = supabaseAdmin();

  // ── El candado del día, antes de gastar un centavo ───────────────────────
  // Se suman las DOS fuentes: lo que gastaron las corridas del panel y lo que
  // gastaron las lecturas sueltas del banco. Sumar solo la primera dejaría un
  // agujero por el que este botón se salta el tope entero sin tocarlo.
  const gastoCorridas = await gastoHoyUsd(db);
  if (!gastoCorridas.ok) {
    return NextResponse.json({ error: `no se pudo leer el gasto del día (${gastoCorridas.error}) — no se corre el OCR a ciegas` }, { status: 502 });
  }
  const gastoLecturas = await gastoLecturasHoyUsd(db);
  if (!gastoLecturas.ok) {
    return NextResponse.json({ error: `no se pudo leer el gasto de lecturas del día (${gastoLecturas.error}) — no se corre el OCR a ciegas` }, { status: 502 });
  }
  const gastadoHoy = gastoCorridas.datos + gastoLecturas.datos;
  if (gastadoHoy >= TOPE_DIA_USD) {
    return NextResponse.json({ error: `el gasto de hoy ($${gastadoHoy.toFixed(4)}) ya tocó el tope diario ($${TOPE_DIA_USD}) — mañana, o sube TOPE_DIA_USD a propósito` }, { status: 429 });
  }

  const manifiesto = await leerManifiesto(db);
  if (!manifiesto.ok) return NextResponse.json({ error: manifiesto.error }, { status: 502 });
  const porId = new Map(manifiesto.datos.map((f) => [f.id, f]));

  const faltantes = v.fotoIds.filter((id) => !porId.has(id));
  if (faltantes.length > 0) {
    return NextResponse.json({ error: `foto(s) fuera del banco: ${faltantes.join(', ')}` }, { status: 400 });
  }

  // EL RELOJ. Se fija UNA vez, al principio, y se consulta antes de cada foto.
  const venceEn = Date.now() + PRESUPUESTO_MS;
  const resultados: ResultadoFotoOcr[] = [];
  const sinTurno: string[] = [];

  for (const fotoId of v.fotoIds) {
    const foto = porId.get(fotoId)!;

    // ── El corte, ANTES de tocar red o modelo ──────────────────────────────
    // Lo que no arrancó no cuesta nada y no deja fila a medias. Se nombra
    // entero en la respuesta: el corte mudo es lo que mató al runner dos veces.
    if (Date.now() >= venceEn) {
      sinTurno.push(fotoId);
      continue;
    }

    // Sin verdad-de-terreno NO HAY MEDICIÓN POSIBLE, y correr el OCR de todos
    // modos sería gastar dinero para producir un resultado que no se puede
    // juzgar. Se dice y se sigue; jamás cuenta como acierto.
    if (foto.ocrEsperado === null) {
      resultados.push({
        fotoId, etiqueta: foto.etiqueta, estado: 'no_medida',
        motivo: 'esta foto no tiene verdad-de-terreno confirmada: no hay contra qué medir el OCR. Etiquétala primero (el OCR no se corrió, para no gastar en un resultado que no se puede juzgar)',
        modelo: null, costoUsd: 0, medicion: null, ocrLeido: null, lecturaId: null,
      });
      continue;
    }

    let dataUrl: string;
    try {
      // El reintento por saturación viene declarado en el resultado; aquí la
      // medición del OCR es lo que importa y un reintento no la cambia — el
      // log de qa-storage ya lo dejó contado.
      ({ dataUrl } = await dataUrlDeFoto(db, foto));
    } catch (e) {
      resultados.push({
        fotoId, etiqueta: foto.etiqueta, estado: 'fallo',
        motivo: `no se pudieron bajar los bytes de la foto: ${e instanceof Error ? e.message : String(e)}`,
        modelo: null, costoUsd: 0, medicion: null, ocrLeido: null, lecturaId: null,
      });
      continue;
    }

    let extraccion: Awaited<ReturnType<typeof extraerComprobante>>;
    try {
      // Sin `signal` ni `budget`: el presupuesto de esta pantalla es el tope
      // diario que ya se comprobó arriba, y el corte de tiempo lo hace el bucle
      // entre fotos. Meter un AbortSignal por foto abortaría la llamada A MEDIAS
      // y dejaría un costo cobrado que el proveedor no reporta (`noMedido`),
      // que es peor que esperar a que termine y cortar antes de la siguiente.
      extraccion = await extraerComprobante(dataUrl);
    } catch (e) {
      // `extraerComprobante` ya captura sus fallos y devuelve `fallo_tecnico`,
      // así que aquí solo caen fallos de programación. No se traga en silencio.
      const motivo = `la llamada de visión lanzó: ${e instanceof Error ? e.message : String(e)}`;
      logger.error('qa.ocr_lanzo', { foto: fotoId, err: motivo });
      const medicion = medicionSinLeer(motivo);
      const guardada = await guardarLectura(db, {
        fotoId, modelo: 'ocr:excepcion', ocrLeido: ocrVacio(), medicion, costoUsd: 0, motivo,
      });
      resultados.push({
        fotoId, etiqueta: foto.etiqueta, estado: 'fallo',
        motivo: guardada.ok ? motivo : `${motivo} — y la lectura tampoco se pudo guardar: ${guardada.error}`,
        modelo: 'ocr:excepcion', costoUsd: 0, medicion, ocrLeido: ocrVacio(),
        lecturaId: guardada.ok ? guardada.datos.id : null,
      });
      continue;
    }

    const { gasto, legible, motivo: motivoOcr, costo } = extraccion;
    const ocrLeido = ocrLeidoDeGasto(gasto);

    // UN FALLO TÉCNICO NO ES UN FALLO DE LECTURA. Si el proveedor se cayó o la
    // respuesta vino truncada, el modelo no llegó a mirar la foto: contar sus
    // 7 campos como errores hundiría la exactitud sin que nadie haya leído
    // nada. Queda escrito como 7 campos sin medir, con el motivo técnico.
    const falloTecnico = motivoOcr === 'fallo_tecnico';
    const motivoFila = falloTecnico
      ? `el OCR falló técnicamente (${motivoOcr}) — el modelo no llegó a leer la foto, así que ningún campo se cuenta ni a favor ni en contra`
      : !legible
        ? `el OCR marcó la foto como no legible (${motivoOcr ?? 'sin motivo'}) — se mide igual: es exactamente lo que se quiere saber de una foto real`
        : null;

    const medicion = falloTecnico ? medicionSinLeer(motivoFila!) : medir(foto.ocrEsperado, ocrLeido);

    // El costo, tal cual lo reportó el proveedor. `noMedido` significa que la
    // llamada se cortó sin `usage`: el 0 NO es "gratis", es "no se sabe", y la
    // fila lo dice en vez de dejar que el tablero lo sume como gratis.
    const costoNoMedido = costo.noMedido === true;
    const motivoCosto = costoNoMedido
      ? 'el costo de esta llamada NO se midió (el proveedor no devolvió usage): el 0 de arriba no significa gratis'
      : null;
    const motivoTotal = [motivoFila, motivoCosto].filter(Boolean).join(' · ') || null;

    const guardada = await guardarLectura(db, {
      fotoId, modelo: costo.modelo, ocrLeido, medicion,
      costoUsd: Number.isFinite(costo.costoUsd) ? Math.max(0, costo.costoUsd) : 0,
      motivo: motivoTotal,
    });

    resultados.push({
      fotoId, etiqueta: foto.etiqueta,
      estado: falloTecnico ? 'fallo' : 'medida',
      motivo: guardada.ok ? motivoTotal : `${motivoTotal ?? 'la medición se hizo'} — pero la lectura NO se pudo guardar: ${guardada.error}`,
      modelo: costo.modelo,
      costoUsd: Number.isFinite(costo.costoUsd) ? Math.max(0, costo.costoUsd) : 0,
      medicion, ocrLeido,
      lecturaId: guardada.ok ? guardada.datos.id : null,
    });
  }

  // El agregado sale SOLO de las fotos que de verdad se midieron. Una foto sin
  // etiqueta o con fallo técnico no entra al denominador: `agregar` devuelve
  // `exactitud: null` cuando no hay campos medidos, y la pantalla dice "sin
  // medir" en vez de 0% ni 100%.
  const medidas = resultados.filter((r) => r.estado === 'medida' && r.medicion !== null).map((r) => r.medicion!);
  const resumen = agregar(medidas);
  const costoTotal = resultados.reduce((s, r) => s + r.costoUsd, 0);

  logger.info('qa.ocr_banco', {
    por: sesion.userId ?? null,
    pedidas: v.fotoIds.length,
    medidas: medidas.length,
    sinTurno: sinTurno.length,
    costoUsd: Math.round(costoTotal * 10_000) / 10_000,
  });

  return NextResponse.json({
    resultados,
    // Las que no alcanzaron turno, POR SU NOMBRE. Mándalas otra vez.
    sinTurno,
    resumen,
    costoUsdTotal: Math.round(costoTotal * 10_000) / 10_000,
  });
}
