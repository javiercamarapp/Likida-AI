// ═══════════════════════════════════════════════════════════════════════════
// VIGENCIAS QUE ANCLAN — el mejor patrón visto en un producto de referencia, traído a carga.
//
// La referencia le pone VIGENCIA al reporte médico de un siniestro: mientras está
// vigente, ancla la ventana de cobertura de los gastos; al vencer, se necesita
// uno nuevo. Un documento con fecha de caducidad que gobierna si un proceso
// puede seguir.
//
// En autotransporte ese patrón vale MÁS que en seguros, porque aquí no es una
// política de la aseguradora: es la ley. Una unidad con la verificación
// vencida o el permiso SICT caducado no es una unidad con un papel pendiente,
// es una unidad que no debería estar en la carretera — y el riesgo (multa,
// detención, seguro que no responde) es del dueño de la flota, no nuestro.
//
// El motor ya existía: `getUnidades()` (operacion.ts) elige el papel MÁS
// PRÓXIMO a vencer de los tres y devuelve los días, negativos si ya venció.
// Lo que faltaba era decir qué significa ese número, y decirlo igual en todas
// las pantallas — de ahí que la clasificación viva aquí, pura, y no dentro de
// una vista.
// ═══════════════════════════════════════════════════════════════════════════

export type EstadoVigencia = 'vencido' | 'por_vencer' | 'vigente' | 'sin_dato';

export interface Vigencia {
  estado: EstadoVigencia;
  /** El texto que va en la pastilla. Ya conjugado, sin armar en la vista. */
  rotulo: string;
  /** Si esto pide a una persona HOY (alimenta las alertas del Inicio). */
  pide: boolean;
}

/**
 * Cuántos días antes empieza a avisar.
 *
 * 30 no es un número redondo por gusto: renovar una verificación
 * físico-mecánica o una póliza toma días hábiles —cita, taller, pago,
 * emisión—, y avisar con una semana deja al gerente sin margen. Avisar con 90
 * entrena a ignorar el aviso, que es peor que no avisarlo.
 */
export const DIAS_AVISO = 30;

/**
 * Traduce los días al vencimiento en un estado con nombre.
 *
 * `null` es `sin_dato`, NUNCA `vigente`. Es la distinción que sostiene la
 * pantalla entera: una unidad a la que nadie le capturó la póliza no está en
 * regla, está sin verificar. Pintarla verde sería exactamente la mentira que
 * el producto no puede permitirse — el gerente la vería en la lista de "todo
 * al día" y se enteraría del problema cuando lo pare un inspector.
 */
export function clasificarVigencia(dias: number | null, queVence: string | null): Vigencia {
  if (dias === null) {
    return {
      estado: 'sin_dato',
      rotulo: 'Sin papeles capturados',
      // No pide a una persona como urgencia operativa: pide capturar el dato,
      // y eso se resuelve en la pantalla de la unidad, no en una alerta roja.
      pide: false,
    };
  }

  const papel = queVence ?? 'Un documento';

  if (dias < 0) {
    const n = Math.abs(dias);
    return {
      estado: 'vencido',
      rotulo: n === 1 ? `${papel}: vencida ayer` : `${papel}: vencida hace ${n} días`,
      pide: true,
    };
  }

  if (dias <= DIAS_AVISO) {
    return {
      estado: 'por_vencer',
      rotulo: dias === 0
        ? `${papel}: vence HOY`
        : dias === 1 ? `${papel}: vence mañana` : `${papel}: vence en ${dias} días`,
      pide: true,
    };
  }

  return {
    estado: 'vigente',
    rotulo: `${papel}: vigente ${dias} días más`,
    pide: false,
  };
}

/** Los tres papeles que la ley le pide a una unidad de carga federal. */
export const PAPELES_UNIDAD = ['Póliza', 'Permiso SICT', 'Verificación'] as const;

export interface ConteoVigencias {
  vencidos: number;
  porVencer: number;
  vigentes: number;
  sinDato: number;
}

/** El resumen para el Inicio: cuántas unidades están en cada estado. */
export function contarVigencias(
  unidades: ReadonlyArray<{ diasAlVencimiento: number | null; queVence: string | null }>,
): ConteoVigencias {
  const c: ConteoVigencias = { vencidos: 0, porVencer: 0, vigentes: 0, sinDato: 0 };
  for (const u of unidades) {
    const v = clasificarVigencia(u.diasAlVencimiento, u.queVence);
    if (v.estado === 'vencido') c.vencidos++;
    else if (v.estado === 'por_vencer') c.porVencer++;
    else if (v.estado === 'vigente') c.vigentes++;
    else c.sinDato++;
  }
  return c;
}

/**
 * La frase del banner del Inicio, o `null` si no hay nada que decir.
 *
 * La referencia abre con "10 credenciales de portal están fallando". Éste es su
 * equivalente, y se calla cuando no hay nada — un banner permanente deja de
 * leerse a la semana.
 */
export function avisoVigencias(c: ConteoVigencias): string | null {
  const partes: string[] = [];
  if (c.vencidos > 0) {
    partes.push(c.vencidos === 1 ? '1 unidad con un papel vencido' : `${c.vencidos} unidades con papeles vencidos`);
  }
  if (c.porVencer > 0) {
    partes.push(c.porVencer === 1
      ? `1 vence en los próximos ${DIAS_AVISO} días`
      : `${c.porVencer} vencen en los próximos ${DIAS_AVISO} días`);
  }
  if (partes.length === 0) return null;
  return partes.join(' · ');
}
