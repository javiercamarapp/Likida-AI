// ═══════════════════════════════════════════════════════════════════════════
// LOS DOS BORDES DE POSTGREST — extraídos de analytics.ts para que el módulo
// de operación (operacion.ts) no los reimplemente.
//
// Reimplementarlos habría sido peor que moverlos: son exactamente los dos
// fallos que CLAUDE.md llama "la familia de bugs más repetida del repo", y una
// segunda copia es una segunda oportunidad de escribirla mal.
// ═══════════════════════════════════════════════════════════════════════════

// ── Los fallos de Supabase llegan POR VALOR, no lanzando ────────────────────
// `shouldThrowOnError` es false por defecto en postgrest-js, así que un host
// inalcanzable, un 500, una llave rotada o un `grant` que le cierre la tabla al
// service-role devuelven `{ data: null, error }` y siguen. Desestructurar solo
// `data` convierte cualquiera de esos fallos en "no hay nada": el panel pintaba
// "Aún no hay liquidaciones" con la base caída y el contralor concluía que la
// flota nunca ha liquidado un viaje (auditoría 5, frontend, CRÍTICO).
//
// El panel ya sabe distinguir null de dato —`safe()` en dashboard/page.tsx
// atrapa excepciones—, así que lo único que faltaba era TRADUCIR el error por
// valor a una excepción. Se hace aquí, en el borde, y no en cada llamador.
export type RespuestaPg<T> = { data: T | null; error: { message: string } | null };

export function exigir<T>(res: RespuestaPg<T>, consulta: string): T | null {
  if (res.error) throw new Error(`${consulta}: ${res.error.message}`);
  return res.data;
}

// AUDITORÍA 8, ALTO REINCIDENTE: PostgREST recorta en silencio a `max_rows`
// (1,000 por default) sin avisar — no lanza, no loguea, simplemente devuelve
// menos filas. Para un tenant que ya lleva un trimestre operando, eso apagaba
// `detectarAnomalias` (el detector de fraude entre viajes) justo cuando más
// datos hay que mirar, sin que el panel supiera que la lectura estaba
// incompleta. `getAcumuladoCombustible` (repo.ts) ya paginaba así desde la
// ronda 6; aquí no se había movido.
const PAGINA = 1_000;
/** 100 páginas son 100,000 filas. Un tenant que las pase necesita un `sum()`
 *  en SQL, no más vueltas: se corta y se dice, en vez de colgar el turno. */
const MAX_PAGINAS = 100;

export async function traerTodo<T>(
  construir: (desde: number, hasta: number) => PromiseLike<RespuestaPg<T[]>>,
  consulta: string,
): Promise<T[]> {
  const filas: T[] = [];
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const desde = pagina * PAGINA;
    const pag = exigir(await construir(desde, desde + PAGINA - 1), consulta) ?? [];
    filas.push(...pag);
    if (pag.length < PAGINA) break;
  }
  return filas;
}
