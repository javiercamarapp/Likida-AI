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
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { DatoInvalido } from '../errores';
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
 * Mezcla el parcial sobre `tenant.config` y lo guarda, anclado al tenant.
 *
 * La mezcla ocurre DENTRO del UPDATE (`tenant_config_merge`, 0159): ya no hay
 * ventana entre leer y escribir. La que había no se cerraba con "la estrategia
 * la edita el dueño" —el argumento de antes—, porque los otros tres escritores
 * de `tenant.config` sí corren en paralelo con esto (DAT-20).
 */
export async function guardarEstrategiaAgente(
  tenantId: string,
  parcial: ParcialEstrategia,
  actor?: { id?: string; email?: string },
): Promise<void> {
  // ── DAT-20 · LA MEZCLA LA HACE LA BASE ──────────────────────────────────
  //
  // Esto era lee-mezcla-escribe, y el comentario de arriba aceptaba la ventana
  // de carrera con un argumento razonable: la estrategia la edita el dueño. El
  // problema no era ése — era que `tenant.config` lo escriben OTROS TRES
  // sitios (política, ajustes operativos, facilidad del 15%), y ésos sí corren
  // al mismo tiempo que esto. Guardar la estrategia mientras alguien guarda el
  // tabulador tiraba uno de los dos, en silencio, y ahí viven los topes.
  //
  // `tenant_config_merge` (0159) mezcla dentro del UPDATE y en PROFUNDIDAD, así
  // que `agentes.conductores` sobrevive a un guardado de `agentes.liquidacion`
  // — el `||` de jsonb no habría bastado.
  //
  // Y aquí salió lo otro: el CHECK `tenant_config_valida` NO conocía la llave
  // `agentes`, así que esta función NUNCA pudo guardar nada. La 0159 le da su
  // propio CHECK (`config_agentes_valida`), con los mismos rangos que validan
  // `validarHorasEscalacion` y `validarUmbralConfianza`.
  const { error: errUpd } = await acotada(
    supabaseAdmin().rpc('tenant_config_merge', {
      p_tenant: tenantId,
      p_parcial: { agentes: parcial },
      p_borrar: [],
    }),
    'estrategia.guardar',
  );
  if (errUpd) {
    if ((errUpd as { code?: string }).code === 'CU013') {
      throw new DatoInvalido('No se encontró tu flota. Recarga la pantalla.');
    }
    throw new Error(`guardarEstrategiaAgente: ${errUpd.message}`);
  }

  await anotarBitacora(
    { tenantId, actor: actor ?? {}, accion: 'agente.estrategia', entidad: 'tenant', entidadId: tenantId,
      detalle: parcial as Record<string, unknown> },
    { evento: 'estrategia.bitacora_no_escribio' },
  );
}
