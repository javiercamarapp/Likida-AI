/**
 * `/ruta` + `?paso=x` + el sufijo de tenant/vista/rol que ya trae la página (que empieza con `?`).
 * Vive aparte de los módulos `'use client'` (`resumen-cliente.tsx`): el Resumen es un componente de servidor y llamar a una función
 * exportada por un módulo de cliente revienta el render ("Attempted to call conPaso() from the server").
 */
export function conPaso(ruta: string, sufijo: string, paso?: string): string {
  const partes = [sufijo.replace(/^\?/, ''), paso ? `paso=${encodeURIComponent(paso)}` : ''].filter(Boolean);
  return partes.length ? `${ruta}?${partes.join('&')}` : ruta;
}
