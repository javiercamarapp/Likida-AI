// ═══════════════════════════════════════════════════════════════════════════
// RESOLVER UN NOMBRE CONTRA EL CATÁLOGO DE LA FLOTA — puro.
//
// El modelo dice «la terminal de Guadalajara» o «el cliente Acme»; el catálogo
// (terminales, clientes) ya está cargado en memoria y es de ESTA flota. La
// coincidencia se hace aquí, contra esa lista: el texto del modelo NUNCA llega a
// una consulta. Sin coincidencia única no se adivina: se devuelven las opciones
// para que el modelo le pregunte a la persona.
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoFiltro =
  | { tipo: 'sin_filtro' }
  | { tipo: 'ok'; id: string; nombre: string }
  | { tipo: 'ambiguo'; opciones: string[] }
  | { tipo: 'no_encontrado'; opciones: string[] };

const norma = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export function resolverNombre(texto: unknown, catalogo: ReadonlyArray<{ id: string; nombre: string }>): ResultadoFiltro {
  if (typeof texto !== 'string' || !texto.trim()) return { tipo: 'sin_filtro' };
  const q = norma(texto.slice(0, 80));
  const exactos = catalogo.filter((c) => norma(c.nombre) === q);
  if (exactos.length === 1) return { tipo: 'ok', id: exactos[0].id, nombre: exactos[0].nombre };
  const contiene = exactos.length > 1 ? exactos : catalogo.filter((c) => norma(c.nombre).includes(q));
  if (contiene.length === 1) return { tipo: 'ok', id: contiene[0].id, nombre: contiene[0].nombre };
  const opciones = (contiene.length > 1 ? contiene : catalogo).slice(0, 15).map((c) => c.nombre);
  return contiene.length > 1 ? { tipo: 'ambiguo', opciones } : { tipo: 'no_encontrado', opciones };
}
