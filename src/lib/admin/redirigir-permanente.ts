import { permanentRedirect } from 'next/navigation';

/** Los `searchParams` de una página de Next (cada valor puede venir repetido como arreglo). */
export type ParametrosDeBusqueda = Record<string, string | string[] | undefined>;

/**
 * La dirección de destino con la consulta de la dirección vieja conservada (`?tenant=…`, `?periodo=…`). Pura, para probarla sin Next.
 * Si el destino ya trae consulta, la de origen se AÑADE; una clave que el destino ya fija no se pisa (manda el destino).
 */
export function destinoConConsulta(destino: string, params?: ParametrosDeBusqueda): string {
  const [ruta, consultaDestino = ''] = destino.split('?');
  const q = new URLSearchParams(consultaDestino);
  for (const [clave, valor] of Object.entries(params ?? {})) {
    if (valor === undefined || q.has(clave)) continue;
    for (const v of Array.isArray(valor) ? valor : [valor]) q.append(clave, v);
  }
  const consulta = q.toString();
  return consulta ? `${ruta}?${consulta}` : ruta;
}

/**
 * Redirección PERMANENTE (308) de una pantalla que cambió de dirección, conservando la consulta. Los enlaces de correos y runbooks
 * antiguos siguen sirviendo. Como `permanentRedirect`, nunca regresa (lanza la señal de Next).
 */
export function redirigirPermanente(destino: string, searchParams?: ParametrosDeBusqueda): never {
  return permanentRedirect(destinoConConsulta(destino, searchParams));
}
