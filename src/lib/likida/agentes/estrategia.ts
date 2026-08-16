// ═══════════════════════════════════════════════════════════════════════════
// ESTRATEGIA POR AGENTE — el escritor de `tenant.config.agentes` (B4, aud. 4).
//
// Cada uno de los ocho agentes necesita su estrategia editable; aquí se expone donde
// hay una perilla que un motor DE VERDAD lee (config.ts documenta por qué las
// demás no existen). El almacenamiento es `tenant.config` (jsonb) vía el
// mismo `fusionarConfig` recursivo de getConfig: escribir con spread plano ya
// borró hermanos una vez (el bug documentado en config.ts:120-140), así que
// el merge profundo aquí no es elegancia, es la lección aplicada.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { DatoInvalido } from '../errores';
import { fusionarConfig } from '../config';
import { acotada } from '../presupuesto';

// ── Validación (pura) ──────────────────────────────────────────────────────

/**
 * 1 a 48 horas, entero. Menos de 1 escalaría al jefe antes de que el chofer
 * termine de desayunar; más de 48 vuelve el aviso arqueología. El default del
 * producto (5) queda dentro, como debe.
 */
export function validarHorasEscalacion(crudo: string): number {
  const t = crudo.trim();
  if (!/^\d+$/.test(t)) throw new DatoInvalido('Las horas de escalación tienen que ser un número entero (sin decimales).');
  const n = Number(t);
  if (n < 1 || n > 48) throw new DatoInvalido('Las horas de escalación viven entre 1 y 48. Con menos de una hora se le escala al jefe todo; con más de dos días el aviso llega tarde para servir.');
  return n;
}

/**
 * 0.50 a 0.99. Bajarlo de 0.5 aceptaría lecturas de moneda al aire como
 * medición; 1.0 mandaría TODO comprobante a revisión manual y el agente
 * dejaría de servir para lo que existe.
 */
export function validarUmbralConfianza(crudo: string): number {
  const t = crudo.trim().replace(',', '.');
  if (!/^0?\.\d{1,2}$|^0\.\d{1,2}$/.test(t) && !/^\d(\.\d{1,2})?$/.test(t)) {
    throw new DatoInvalido('El umbral tiene que ser un número entre 0.50 y 0.99 (hasta dos decimales).');
  }
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0.5 || n > 0.99) {
    throw new DatoInvalido('El umbral vive entre 0.50 y 0.99: más abajo, una lectura al aire cuenta como medición; en 1.00, todo comprobante iría a revisión manual y el agente dejaría de liquidar.');
  }
  return Math.round(n * 100) / 100;
}

// ── El escritor ────────────────────────────────────────────────────────────

export interface ParcialEstrategia {
  conductores?: { horasEscalacion: number };
  liquidacion?: { umbralConfianza: number };
}

/**
 * Mezcla el parcial sobre `tenant.config` y lo guarda, anclado al tenant y
 * comprobando filas afectadas. LEE-MEZCLA-ESCRIBE sin candado: la ventana de
 * carrera existe y se acepta — la estrategia la edita el dueño, no un proceso
 * concurrente, y el precio de perder una edición simultánea es volverla a
 * teclear (contra el costo real de un advisory lock por flota para esto).
 */
export async function guardarEstrategiaAgente(
  tenantId: string,
  parcial: ParcialEstrategia,
  actor?: { id?: string; email?: string },
): Promise<void> {
  const { data, error } = await acotada(
    supabaseAdmin().from('tenant').select('config').eq('id', tenantId).maybeSingle(),
    'estrategia.leer',
  );
  if (error) throw new Error(`guardarEstrategiaAgente: no se pudo leer la config: ${error.message}`);
  if (data === null) throw new DatoInvalido('No se encontró tu flota. Recarga la pantalla.');

  const actual = (data.config as Record<string, unknown> | null) ?? {};
  // Solo se toca el subárbol `agentes`; el resto del override del tenant
  // (política, tabulador, RFC…) pasa intacto.
  const nueva = fusionarConfig(actual, { agentes: parcial });

  const { data: filas, error: errUpd } = await acotada(
    supabaseAdmin().from('tenant').update({ config: nueva }).eq('id', tenantId).select('id'),
    'estrategia.guardar',
  );
  if (errUpd) throw new Error(`guardarEstrategiaAgente: ${errUpd.message}`);
  if (!Array.isArray(filas) || filas.length === 0) {
    throw new DatoInvalido('No se pudo guardar la estrategia. Recarga la pantalla e intenta de nuevo.');
  }

  const { error: errBitacora } = await supabaseAdmin().from('bitacora_auditoria').insert({
    tenant_id: tenantId,
    actor_id: actor?.id ?? null,
    actor_email: actor?.email ?? null,
    accion: 'agente.estrategia',
    entidad: 'tenant',
    entidad_id: tenantId,
    detalle: parcial as Record<string, unknown>,
  });
  if (errBitacora) logger.warn('estrategia.bitacora_no_escribio', { err: errBitacora.message });
}
