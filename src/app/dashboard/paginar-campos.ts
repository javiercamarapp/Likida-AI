/**
 * Los `<input type="hidden">` que un `<form method="get">` del registro tiene
 * que llevar para no perder el "ver como" del superadmin (FE-12).
 *
 * Un GET reemplaza el query string ENTERO: si `?tenant=` no viaja como campo,
 * buscar una unidad saca al superadmin de la flota que estaba mirando y lo
 * deja en la demo — sin avisar, que es la parte mala. Es el mismo problema
 * que `dashboard/sufijo.ts` resuelve para los links.
 */
export function camposDeSufijo(
  sp: { vista?: string; tenant?: string; rol?: string },
): Array<[string, string]> {
  const campos: Array<[string, string]> = [];
  if (sp.tenant) campos.push(['tenant', sp.tenant]);
  else if (sp.vista) campos.push(['vista', sp.vista]);
  if (sp.rol) campos.push(['rol', sp.rol]);
  return campos;
}
