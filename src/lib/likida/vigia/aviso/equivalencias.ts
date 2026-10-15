// Equivalencias texto → cliente (T-A4-11).
//
// El programa de despacho trae el cliente como TEXTO libre («Cliente Uno S.A.», «CLIENTE  UNO»). El `clienteId` nunca sale
// del texto: sale de la tabla de alias de ESTA flota (`vigia_cliente_alias`), donde alguien mapeó ese texto a un cliente.
//  - Se compara el texto normalizado: sin acentos, en mayúsculas, espacios colapsados. Solo eso: sin puntuación ni parecidos,
//    porque un alias «casi igual» enviaría un aviso al cliente equivocado.
//  - Si el texto no está en la tabla, no se adivina: `ninguno`.
//  - Si dos clientes distintos comparten el alias, es `ambiguo` y no se envía.
//  - Una fila de alias de otra flota se ignora, aunque la consulta la devuelva por error.
// Función pura: no lee red ni base.

export type CampoAlias = 'cliente' | 'consignatario';

export interface AliasCliente {
  tenantId: string;
  /** Texto ya normalizado con `normalizarAlias`. */
  textoNormalizado: string;
  clienteId: string;
  campo: CampoAlias;
}

export type ResultadoAlias =
  | { tipo: 'uno'; clienteId: string }
  | { tipo: 'ninguno' }
  | { tipo: 'ambiguo'; clienteIds: string[] };

const LARGO_MAX_ALIAS = 200;

/** Sin acentos, mayúsculas, espacios (incluidos saltos y espacios duros) colapsados y recortados. */
export function normalizarAlias(texto: string | null | undefined): string {
  if (texto == null) return '';
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LARGO_MAX_ALIAS);
}

/**
 * Decide a qué cliente corresponde `texto` entre las filas de alias que devolvió la consulta. Solo cuentan las filas de la
 * flota `tenantId`, del `campo` pedido y con el mismo texto normalizado.
 */
export function resolverAlias(
  texto: string | null | undefined,
  campo: CampoAlias,
  tenantId: string,
  filas: readonly AliasCliente[],
): ResultadoAlias {
  const clave = normalizarAlias(texto);
  if (clave === '') return { tipo: 'ninguno' };
  const ids = new Set<string>();
  for (const f of filas) {
    if (f.tenantId !== tenantId || f.campo !== campo) continue;
    if (normalizarAlias(f.textoNormalizado) !== clave) continue;
    ids.add(f.clienteId);
  }
  if (ids.size === 0) return { tipo: 'ninguno' };
  if (ids.size === 1) return { tipo: 'uno', clienteId: [...ids][0] };
  return { tipo: 'ambiguo', clienteIds: [...ids].sort() };
}
