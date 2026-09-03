// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 25, BE-C1a + BE-C1b + DATOS-C1 (CRÍTICO, reincidente de la 24).
// DECISIÓN DE PRODUCTO YA TOMADA: cuando se AJUSTA una liquidación a mano, el
// sistema regenera el desglose fiscal y el PDF con las cifras recalculadas —
// no solo mueve `total_comprobado`/`diferencia` por una delta y deja el resto
// (iva_acreditable, el PDF archivado…) con la cifra vieja.
//
// Este archivo tiene las DOS mitades que `revision.ts` orquesta alrededor de
// la RPC `revisar_liquidacion` (mig. 0306):
//
//   · `recalcularParaAjuste` — ANTES de llamar a la RPC: vuelve a correr el
//     motor de cuadre (`cuadrarDesdeDB`, puro) sobre los gastos VIVOS del
//     viaje con el/los monto(s) ajustado(s) ya aplicados EN MEMORIA (nada se
//     escribe aquí — la RPC es quien escribe `gasto.monto`, dentro de su
//     propia transacción). NO se prorratea a mano `sub_total`/`iva_traslado`/
//     `ieps_traslado`: son el HECHO del CFDI (o su ausencia) y no se tocan;
//     el motor los LEE tal cual y de ahí sale el desglose recalculado. Es la
//     rama "si no es posible recalcular proporcionalmente… vuelve a correr
//     el motor" del encargo, elegida a propósito: prorratear el desglose de
//     un comprobante que YA trae CFDI (sub_total/iva_traslado reales) sería
//     inventar una cifra que ningún papel respalda.
//
//   · `regenerarPdfTrasAjuste` — DESPUÉS de que la RPC confirmó: imprime los
//     dos ejemplares (contralor y operador, mismo patrón que `tools.ts`) con
//     el cuadre YA recalculado y YA persistido, los sube a la MISMA ruta
//     canónica que el resto del sistema asume (`${tenant}/${viaje}.pdf` /
//     `-operador.pdf`) y ARCHIVA el PDF que sustituyen en
//     `liquidacion.pdf_historial` (no se borra, `pdf_url` sigue diciendo cuál
//     es el vigente). Limpia los dos sellos de entrega de la 0279
//     (`entregada_operador_en`/`avisada_oficina_en`): el papel que ya se le
//     dio al chofer dejó de ser el vigente, así que "ya se entregó" deja de
//     ser cierto y el mecanismo de reentrega existente (`processor.ts`,
//     AGEN-4) tiene con qué volver a mandarlo.
//
// Best-effort en la mitad del PDF (igual que `tools.ts`): la RPC ya
// confirmó el ajuste — perder el PDF nuevo es un papel desactualizado, no una
// cifra mal en la base. Nunca lanza; el llamador decide qué decirle a la
// persona con `regenerado: false`.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from './presupuesto';
import { getGastos, getViaje, getOperador } from './repo';
import { cuadrarDesdeDB } from './cuadre/desde_db';
import { generarLiquidacionPDF } from './liquidacion/pdf';
import { getDatosFiscales } from '@/lib/saas/fiscal';
import { logger } from '@/lib/logger';
import type { Gasto, Liquidacion } from '@/types/likida';

export interface AjustePedido { gastoId: string; montoNuevo: number }

/** Lo que `p_recalculo` de `revisar_liquidacion` (mig. 0306) espera, en el
 *  mismo `camelCase` que el resto de este módulo — se serializa a JSON tal
 *  cual al llamar la RPC. */
export interface RecalculoAjuste {
  totalComprobado: number;
  diferencia: number;
  estatus: string;
  diferencias: unknown[];
  iepsAcreditable: number;
  litrosDieselAcreditables: number;
  ivaAcreditable: number;
  peajeAcreditable: number;
}

export interface ResultadoRecalculo {
  recalculo: RecalculoAjuste;
  /** El cuadre completo — lo necesita `regenerarPdfTrasAjuste` para imprimir. */
  cuadre: Omit<Liquidacion, 'id' | 'creadaEn'>;
}

/**
 * Vuelve a correr el motor sobre los gastos VIVOS del viaje, con los ajustes
 * pedidos ya aplicados en memoria — nada se escribe en la base.
 *
 * Lanza si el viaje no existe o si alguno de los `ajustes` no corresponde a
 * un comprobante real del viaje: la RPC ya lo iba a rechazar (LR017), mejor
 * fallar aquí que gastar el recálculo completo del motor para nada.
 */
export async function recalcularParaAjuste(
  tenantId: string,
  viajeId: string,
  ajustes: AjustePedido[],
): Promise<ResultadoRecalculo> {
  const gastos = await getGastos(viajeId, tenantId);
  const porId = new Map(gastos.map((g) => [g.id, g]));
  for (const a of ajustes) {
    if (!porId.has(a.gastoId)) {
      throw new Error(`recalcularParaAjuste: el comprobante ${a.gastoId} no es de este viaje`);
    }
  }
  const nuevos = new Map(ajustes.map((a) => [a.gastoId, a.montoNuevo]));
  const gastosAjustados: Gasto[] = gastos.map((g) => (
    nuevos.has(g.id) ? { ...g, monto: nuevos.get(g.id)! } : g
  ));
  const cuadre = await cuadrarDesdeDB(tenantId, viajeId, gastosAjustados);
  return {
    cuadre,
    recalculo: {
      totalComprobado: cuadre.totalComprobado,
      diferencia: cuadre.diferencia,
      estatus: cuadre.estatus,
      diferencias: cuadre.diferencias,
      iepsAcreditable: cuadre.iepsAcreditable,
      litrosDieselAcreditables: cuadre.litrosDieselAcreditables ?? 0,
      ivaAcreditable: cuadre.ivaAcreditable,
      peajeAcreditable: cuadre.peajeAcreditable,
    },
  };
}

const BUCKET = 'liquidaciones';

async function subir(path: string, bytes: Uint8Array): Promise<boolean> {
  const up = await supabaseAdmin().storage.from(BUCKET).upload(path, Buffer.from(bytes), {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (up.error) { logger.warn('revision_recalculo.pdf_upload', { path, err: up.error.message }); return false; }
  return true;
}

/**
 * Copia el objeto que YA está en `path` a `archivoPath` — best-effort. Si
 * `path` no existe todavía (primer PDF de esta liquidación), no hay nada que
 * archivar y no es un error.
 */
async function archivar(path: string, archivoPath: string): Promise<boolean> {
  const { error } = await supabaseAdmin().storage.from(BUCKET).copy(path, archivoPath);
  if (error) {
    // "not found" es el camino normal cuando todavía no había PDF (o el del
    // operador, que no se versiona) — no ensucia el log con un warn.
    if (!/not.?found/i.test(error.message)) {
      logger.warn('revision_recalculo.pdf_archivar', { path, archivoPath, err: error.message });
    }
    return false;
  }
  return true;
}

/**
 * Imprime, sube y versiona el PDF del contralor (y reimprime el del
 * operador) tras un ajuste YA persistido por la RPC. Limpia los sellos de
 * entrega para que el chofer y la oficina puedan volver a recibir el papel
 * correcto. Nunca lanza — best-effort, como `tools.ts`.
 */
export async function regenerarPdfTrasAjuste(
  tenantId: string,
  viajeId: string,
  liquidacionId: string,
  cuadre: Omit<Liquidacion, 'id' | 'creadaEn'>,
  revisadaPor: string,
  revisadaEn: string,
): Promise<{ regenerado: boolean }> {
  try {
    const [viaje, razon] = await Promise.all([
      getViaje(viajeId, tenantId),
      // Mismo criterio que `tools.ts`: perder el nombre no puede tumbar el
      // PDF — sale con el encabezado genérico en vez de no salir.
      getDatosFiscales(tenantId).then((d) => d?.razonSocial ?? undefined).catch((e) => {
        logger.warn('revision_recalculo.razon_social', { err: e instanceof Error ? e.message : String(e) });
        return undefined;
      }),
    ]);
    if (!viaje) { logger.warn('revision_recalculo.sin_viaje', { tenantId, viajeId }); return { regenerado: false }; }
    const operador = viaje.operadorId ? await getOperador(viaje.operadorId, tenantId) : null;
    if (!operador) { logger.warn('revision_recalculo.sin_operador', { tenantId, viajeId }); return { regenerado: false }; }

    const full: Liquidacion = {
      ...cuadre,
      id: liquidacionId,
      // "Generado por Likida · <fecha>" en el pie: la fecha de ESTE papel,
      // no la de la liquidación original — es honesto, es cuándo se imprimió.
      creadaEn: new Date().toISOString(),
      revision: 'ajustada',
      revisadaPor,
      revisadaEn,
    };

    const rutaContralor = `${tenantId}/${viajeId}.pdf`;
    const rutaOperador = `${tenantId}/${viajeId}-operador.pdf`;
    const archivoContralor = `${tenantId}/${viajeId}-ajustada-${Date.now()}.pdf`;

    // Archivar ANTES de sobrescribir: el que está en la ruta canónica es el
    // que este ajuste va a sustituir.
    const archivado = await archivar(rutaContralor, archivoContralor);

    const [okContralor, okOperador] = await Promise.all([
      generarLiquidacionPDF(full, viaje, operador, razon, 'contralor').then((b) => subir(rutaContralor, b)),
      generarLiquidacionPDF(full, viaje, operador, razon, 'operador').then((b) => subir(rutaOperador, b)),
    ]);

    if (!okContralor) {
      // El PDF del contralor —el que se archiva y se exporta— no se pudo
      // regenerar: el papel vigente se queda con la cifra vieja. Se dice.
      return { regenerado: false };
    }

    // Plano, fuera de la RPC: `pdf_url` y los dos sellos NO son columnas que
    // el trigger de revisión vigile (ni las cinco de la "retira firma" ni
    // las de LR003) — un UPDATE normal es seguro aquí. `pdf_historial` se
    // empuja aparte, con `jsonb ||` en SQL (ver `agregarAlHistorial`): un
    // read-modify-write en JS perdería una entrada si dos ajustes corrieran
    // cerca uno del otro.
    const { error } = await acotada(supabaseAdmin()
      .from('liquidacion')
      .update({ pdf_url: rutaContralor, entregada_operador_en: null, avisada_oficina_en: null })
      .eq('tenant_id', tenantId).eq('id', liquidacionId), 'revision_recalculo.persistir_pdf');
    if (error) {
      logger.warn('revision_recalculo.persistir_pdf', { tenantId, liquidacionId, err: error.message });
    }
    if (archivado) {
      await agregarAlHistorial(tenantId, liquidacionId, { url: archivoContralor, archivadaEn: new Date().toISOString() });
    }

    return { regenerado: okContralor && okOperador };
  } catch (e) {
    logger.error('revision_recalculo.pdf_gen', { tenantId, viajeId, liquidacionId, err: e instanceof Error ? e.message : String(e) });
    return { regenerado: false };
  }
}

/** Empuja una entrada a `pdf_historial` con `jsonb ||` — sin leer-modificar-
 *  escribir en JS, que perdería una entrada si dos ajustes corrieran cerca. */
async function agregarAlHistorial(tenantId: string, liquidacionId: string, entrada: { url: string; archivadaEn: string }): Promise<void> {
  const { error } = await supabaseAdmin().rpc('agregar_pdf_historial', {
    p_tenant: tenantId,
    p_liquidacion: liquidacionId,
    p_entrada: entrada,
  });
  if (error) logger.warn('revision_recalculo.historial', { tenantId, liquidacionId, err: error.message });
}
