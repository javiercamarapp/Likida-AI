// Ayudas PURAS (sin React) para armar los enlaces de `BarraPeriodo`: el estado del periodo y de los filtros vive en la URL
// (`?periodo=…&desde=…&hasta=…&moneda=…`). Sirven en servidor y en cliente.

export type ParamsUrl = Readonly<Record<string, string | undefined>>;

/** Enlace a `ruta` con los parámetros vigentes (`params`) más `cambios`. Un cambio `null`/`''` quita el parámetro. Cambiar un filtro
 *  reinicia la paginación: `pagina` se quita siempre (por omisión; `conservar: ['pagina']` lo mantiene). Orden estable por nombre. */
export function hrefConParams(ruta: string, params: ParamsUrl, cambios: Readonly<Record<string, string | null | undefined>> = {}, conservar: readonly string[] = []): string {
  const salida = new Map<string, string>();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') salida.set(k, v);
  for (const [k, v] of Object.entries(cambios)) {
    if (v === null || v === undefined || v === '') salida.delete(k); else salida.set(k, v);
  }
  if (!conservar.includes('pagina')) salida.delete('pagina');
  const qs = new URLSearchParams([...salida.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))).toString();
  // Sin ruta (enlace relativo a la página actual) y sin parámetros, `?` deja la misma página sin consulta.
  return qs ? `${ruta}?${qs}` : (ruta || '?');
}

/** Pares ocultos para un `<form method="get">`: los parámetros vigentes menos los que el formulario edita (y `pagina`). */
export function ocultosSin(params: ParamsUrl, editados: readonly string[]): Array<[string, string]> {
  const fuera = new Set([...editados, 'pagina']);
  return Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined && e[1] !== '' && !fuera.has(e[0]));
}
