import { ErrorInsight, validarInsight, type Regla } from './regla';
import { PESO_SEVERIDAD, type Insight } from './tipos';

export const MAX_POR_PANTALLA = 3;

export interface ResultadoComposicion {
  /** Los primeros N por severidad (por defecto 3). */
  visibles: Insight[];
  /** El resto, para «ver más». */
  verMas: Insight[];
  total: number;
}

/**
 * Aplica las reglas, valida cada insight producido, ordena por severidad (urgente primero;
 * empate: orden de declaración de las reglas) y limita a `max`. Pura: no muta entradas.
 */
export function componer<D>(
  reglas: readonly Regla<D>[],
  datos: D,
  opciones: { max?: number } = {},
): ResultadoComposicion {
  const max = opciones.max ?? MAX_POR_PANTALLA;
  if (!Number.isInteger(max) || max < 0) {
    throw new ErrorInsight('componer', 'max debe ser un entero >= 0');
  }

  const vistos = new Set<string>();
  const producidos: { insight: Insight; orden: number }[] = [];

  reglas.forEach((regla, orden) => {
    if (vistos.has(regla.id)) throw new ErrorInsight(regla.id, 'id de regla duplicado');
    vistos.add(regla.id);
    if (!regla.aplica(datos)) return;
    const insight = validarInsight(regla.producir(datos), regla.id);
    if (insight.agente !== regla.agente) {
      throw new ErrorInsight(regla.id, `produce agente «${insight.agente}» pero la regla es de «${regla.agente}»`);
    }
    producidos.push({ insight, orden });
  });

  const ids = new Set<string>();
  for (const { insight } of producidos) {
    if (ids.has(insight.id)) throw new ErrorInsight(insight.id, 'dos insights con el mismo id');
    ids.add(insight.id);
  }

  const ordenados = producidos
    .sort(
      (a, b) =>
        PESO_SEVERIDAD[b.insight.severidad] - PESO_SEVERIDAD[a.insight.severidad] || a.orden - b.orden,
    )
    .map((p) => p.insight);

  return {
    visibles: ordenados.slice(0, max),
    verMas: ordenados.slice(max),
    total: ordenados.length,
  };
}
