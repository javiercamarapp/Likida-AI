// ═══════════════════════════════════════════════════════════════════════════
// CORREGIR EL MONTO DE UN GASTO — el camino que no existía.
//
// AUDITORÍA 24 · WA-3 (ALTO). Un ticket de diésel de $8,000.00 leído como
// $800.00 con 0.94 de confianza sale como «Anotado ✅ Diésel · $800.00» SIN
// botón (`acuse_ticket.ts`: a partir de 0.9 se acusa y ya), y a partir de ahí
// no había NADA que pudiera cambiar esa cifra: el chofer no tiene tool, el
// panel no tiene acción, y `repo.ts` solo sabía actualizar la fecha y los
// campos del XML. La única «corrección» posible era reenviar la foto, que
// crea un SEGUNDO gasto — como el propio `mensajeCorregir` advierte.
//
// El chofer terminaba pagando $7,200 de su bolsa, o la flota pagándolos de
// más. La regla del producto no se rompía al inventar la cifra (nadie la
// inventó: se leyó mal); se rompía porque no se podía DESinventar.
//
// ── LO QUE ESTE MÓDULO SÍ HACE, Y LO QUE NO ────────────────────────────────
//
// SÍ: cambia `gasto.monto` a una cifra que una PERSONA afirma, dejando en la
// misma fila (`ocr_extra.montoCorregido`) lo que decía antes, quién lo
// cambió, cuándo y por qué, y una entrada en `bitacora_auditoria`.
//
// NO: no decide si la cifra nueva es cierta, no toca el XML (si el gasto está
// `xml_verificado` el CFDI es la autoridad y corregir a mano lo contradice:
// se rechaza), y no puede tocar un viaje ya liquidado — de eso se encarga el
// trigger de la 0036/0037, que devuelve `CU001`, y aquí se traduce a un
// motivo con nombre en vez de a un «hubo un problema».
//
// El actor y el motivo son OBLIGATORIOS: una cifra de dinero cambiada por
// nadie y sin razón es exactamente lo que la bitácora existe para impedir.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { logger } from '@/lib/logger';

export interface CorreccionDeMonto {
  tenantId: string;
  gastoId: string;
  /** La cifra que la persona afirma que dice el papel. En pesos. */
  montoNuevo: number;
  /** Quién lo afirma. `'sistema'` NO se acepta: esto siempre lo firma alguien. */
  actor: { id?: string | null; email?: string | null };
  /** Por qué. Texto libre corto, va a la bitácora y a la fila. */
  motivo: string;
}

export type ResultadoCorreccion =
  | { ok: true; antes: number; despues: number }
  | { ok: false; motivo: 'monto_invalido' | 'sin_motivo' | 'sin_actor' | 'no_existe' | 'liquidado' | 'xml_verificado' | 'error'; detalle?: string };

/** Tope de cordura: un gasto de viaje por encima de esto es un dedo, no un dato. */
const TOPE_MONTO = 1_000_000;

/**
 * A37-S45-10 — el merge de `ocr_extra` en SQL (migración 0876).
 *
 * Leer `ocr_extra`, agregarle una clave y reescribir la columna ENTERA pisaba lo
 * que la validación SAT o la ingesta del XML escribieron en medio, perdía una de
 * dos correcciones concurrentes y devolvía ok sobre un gasto ya borrado.
 * `gasto_mezclar_ocr_extra` hace el `||`, el append al historial y el cambio de
 * monto en UNA sentencia y dice cuántas filas tocó.
 *
 *  · `{ filas }`  — la RPC corrió (0 = el gasto ya no existe o dejó de cumplir la condición).
 *  · `{ error }`  — falló de verdad (p. ej. CU001: la liquidación ya se emitió).
 *  · `null`       — la base aún no trae la 0876 (PGRST202 / 42883): se avisa y quien
 *                   llama cae al camino anterior (leer-fusionar-escribir).
 */
async function mezclarOcrExtraAtomico(a: {
  tenantId: string; gastoId: string; parche?: Record<string, unknown>;
  historial?: { clave: string; entrada: Record<string, unknown> };
  monto?: number; sinXmlVerificado?: boolean; contexto: string;
}): Promise<{ filas: number } | { error: { message: string; code?: string } } | null> {
  const { data, error } = await acotada(
    supabaseAdmin().rpc('gasto_mezclar_ocr_extra', {
      p_tenant: a.tenantId,
      p_gasto: a.gastoId,
      p_parche: a.parche ?? {},
      p_historial_clave: a.historial?.clave ?? null,
      p_historial_entrada: a.historial?.entrada ?? null,
      p_monto: a.monto ?? null,
      p_sin_xml_verificado: a.sinXmlVerificado ?? false,
    }),
    a.contexto,
  ) as { data: unknown; error: { message: string; code?: string } | null };
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') {
      logger.warn('gasto.mezcla_atomica_no_disponible', { contexto: a.contexto, code: error.code });
      return null;
    }
    return { error };
  }
  return { filas: Number(data ?? 0) };
}

/**
 * Cambia el monto de un gasto y deja constancia. NUNCA lanza.
 *
 * Devuelve el motivo con nombre para que quien llame pueda decir la verdad:
 * «llegó tarde, el viaje ya se liquidó» no es lo mismo que «no se pudo».
 */
export async function corregirMontoGasto(c: CorreccionDeMonto): Promise<ResultadoCorreccion> {
  const motivo = c.motivo?.trim() ?? '';
  if (!Number.isFinite(c.montoNuevo) || c.montoNuevo <= 0 || c.montoNuevo > TOPE_MONTO) {
    return { ok: false, motivo: 'monto_invalido' };
  }
  if (!motivo) return { ok: false, motivo: 'sin_motivo' };
  if (!c.actor?.id && !c.actor?.email) return { ok: false, motivo: 'sin_actor' };

  // Redondeo a centavos: la columna es `numeric` y una fracción de centavo
  // que nadie tecleó descuadra el neto contra el PDF.
  const montoNuevo = Math.round(c.montoNuevo * 100) / 100;

  const { data: fila, error: errorLectura } = await acotada(
    supabaseAdmin().from('gasto')
      .select('id, viaje_id, monto, xml_verificado, ocr_extra')
      .eq('id', c.gastoId).eq('tenant_id', c.tenantId).maybeSingle(),
    'corregirMontoGasto.leer',
  );
  // FAIL-CLOSED: `acotada` entrega el tope agotado POR VALOR. Sin esto, un
  // timeout de lectura se leería como «el gasto no existe» y el update de
  // abajo REEMPLAZARÍA el `ocr_extra` entero desde `{}`, borrando litros,
  // moneda y discrepancias que el motor de cuadre sí usa.
  if (errorLectura) {
    logger.error('gasto.correccion_lectura', { tenant: c.tenantId, gasto: c.gastoId, err: errorLectura.message });
    return { ok: false, motivo: 'error', detalle: errorLectura.message };
  }
  if (!fila) return { ok: false, motivo: 'no_existe' };
  if (fila.xml_verificado) return { ok: false, motivo: 'xml_verificado' };

  const antes = Number(fila.monto ?? 0);
  if (antes === montoNuevo) return { ok: true, antes, despues: montoNuevo };

  const entrada = {
    antes, despues: montoNuevo, motivo,
    por: c.actor.email ?? c.actor.id ?? null,
    en: new Date().toISOString(),
  };

  // Camino atómico (0876). La HISTORIA se conserva en SQL: la corrección
  // anterior no se pisa y dos correcciones concurrentes dejan las dos entradas.
  let error: { message: string; code?: string } | null = null;
  const atomico = await mezclarOcrExtraAtomico({
    tenantId: c.tenantId, gastoId: c.gastoId, monto: montoNuevo, sinXmlVerificado: true,
    historial: { clave: 'montoCorregido', entrada }, contexto: 'corregirMontoGasto.mezclar',
  });
  if (atomico && 'error' in atomico) {
    error = atomico.error;
  } else if (atomico) {
    if (atomico.filas === 0) {
      // 0 filas: se borró entre la lectura y la escritura, o llegó el XML y ya es
      // la autoridad. Nunca «ok» sobre una fila que no se tocó.
      const { data: ahora } = await acotada(
        supabaseAdmin().from('gasto').select('id, xml_verificado')
          .eq('id', c.gastoId).eq('tenant_id', c.tenantId).maybeSingle(),
        'corregirMontoGasto.releer',
      ) as { data: { id: string; xml_verificado: boolean | null } | null };
      logger.warn('gasto.correccion_sin_filas', { tenant: c.tenantId, gasto: c.gastoId, existe: Boolean(ahora) });
      if (!ahora) return { ok: false, motivo: 'no_existe' };
      if (ahora.xml_verificado) return { ok: false, motivo: 'xml_verificado' };
      return { ok: false, motivo: 'error', detalle: 'el gasto cambió mientras se corregía; vuelve a intentar' };
    }
  } else {
    // La base aún no trae la 0876: camino anterior (leer-fusionar-escribir).
    const extra = { ...((fila.ocr_extra ?? {}) as Record<string, unknown>) };
    const previas = Array.isArray(extra.montoCorregido) ? extra.montoCorregido : (extra.montoCorregido ? [extra.montoCorregido] : []);
    extra.montoCorregido = [...previas, entrada];
    ({ error } = await acotada(
      supabaseAdmin().from('gasto').update({ monto: montoNuevo, ocr_extra: extra })
        .eq('id', c.gastoId).eq('tenant_id', c.tenantId),
      'corregirMontoGasto.update',
    ));
  }
  if (error) {
    // CU001 es el trigger de la 0036/0037: la liquidación de ese viaje ya se
    // emitió. NO es un fallo técnico y no se le puede pedir que reintente.
    if (error.code === 'CU001') {
      logger.info('gasto.correccion_tarde', { tenant: c.tenantId, gasto: c.gastoId, viaje: fila.viaje_id });
      return { ok: false, motivo: 'liquidado' };
    }
    logger.error('gasto.correccion_error', { tenant: c.tenantId, gasto: c.gastoId, err: error.message, code: error.code });
    return { ok: false, motivo: 'error', detalle: error.message };
  }

  logger.info('gasto.corregido', { tenant: c.tenantId, gasto: c.gastoId, viaje: fila.viaje_id, antes, despues: montoNuevo });
  await anotarBitacora({
    tenantId: c.tenantId,
    actor: c.actor,
    accion: 'gasto.corregir_monto',
    entidad: 'gasto',
    entidadId: c.gastoId,
    detalle: { antes, despues: montoNuevo, motivo, viaje: fila.viaje_id },
  }, { evento: 'gasto.correccion_sin_bitacora' });

  return { ok: true, antes, despues: montoNuevo };
}

/**
 * El chofer dice que el monto está MAL, pero no dice cuál es el bueno.
 *
 * AUDITORÍA 24 · WA-3. Apretar «No, corregir» no dejaba rastro de ninguna
 * clase: un `logger.warn` que muere con la invocación y un mensaje que lo
 * manda con su oficina — la cual no tenía forma de saber que él dijo nada.
 * Esto NO cambia la cifra (corregirla a un número que nadie dio sería peor
 * que dejarla mal leída, y ponerla en cero le quitaría un gasto que sí hizo):
 * marca la fila para que el panel y el cuadre puedan levantarla.
 *
 * NUNCA lanza: la marca es información, y el gasto ya está en el viaje.
 */
export async function marcarMontoDisputado(
  d: { tenantId: string; gastoId: string; quien: string; dijo?: string | null },
): Promise<boolean> {
  const { data: fila, error: errorLectura } = await acotada(
    supabaseAdmin().from('gasto').select('id, monto, ocr_extra')
      .eq('id', d.gastoId).eq('tenant_id', d.tenantId).maybeSingle(),
    'marcarMontoDisputado.leer',
  );
  // Mismo fail-closed que arriba: sin esto una lectura caída borraría el
  // `ocr_extra` entero al reemplazarlo desde `{}`.
  if (errorLectura || !fila) {
    logger.warn('gasto.disputa_sin_lectura', { tenant: d.tenantId, gasto: d.gastoId, err: errorLectura?.message ?? 'no existe' });
    return false;
  }
  const disputa = {
    montoLeido: Number(fila.monto ?? 0),
    por: d.quien,
    dijo: d.dijo ?? null,
    en: new Date().toISOString(),
  };
  // A37-S45-10: merge atómico (0876) para no pisar lo que la validación SAT o la
  // ingesta del XML escribieron entre la lectura y la escritura.
  let error: { message: string; code?: string } | null = null;
  const atomico = await mezclarOcrExtraAtomico({
    tenantId: d.tenantId, gastoId: d.gastoId, parche: { montoDisputado: disputa }, contexto: 'marcarMontoDisputado.mezclar',
  });
  if (atomico && 'error' in atomico) {
    error = atomico.error;
  } else if (atomico) {
    if (atomico.filas === 0) {
      logger.warn('gasto.disputa_sin_filas', { tenant: d.tenantId, gasto: d.gastoId });
      return false;
    }
  } else {
    const extra = { ...((fila.ocr_extra ?? {}) as Record<string, unknown>) };
    extra.montoDisputado = disputa;
    ({ error } = await acotada(
      supabaseAdmin().from('gasto').update({ ocr_extra: extra })
        .eq('id', d.gastoId).eq('tenant_id', d.tenantId),
      'marcarMontoDisputado.update',
    ));
  }
  if (error) {
    logger.warn('gasto.disputa_no_marcada', { tenant: d.tenantId, gasto: d.gastoId, err: error.message, code: error.code });
    return false;
  }
  logger.info('gasto.monto_disputado', { tenant: d.tenantId, gasto: d.gastoId });
  return true;
}
