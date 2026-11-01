import { PISTAS_CONTEXTUALES } from './pistas';
import type { PistaContextual } from './tipos';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `/dashboard/carta-porte/borrador/<uuid>` → `/dashboard/carta-porte/borrador/[id]`; `/dashboard/<uuid>` → `/dashboard/[id]`. */
export function claveDeRuta(pathname: string): string {
  const limpio = pathname.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  return limpio.split('/').map((s) => (UUID.test(s) ? '[id]' : s)).join('/');
}

/** La pista que toca mostrar al abrir `pathname`, o null. */
export function pistaDeRuta(pathname: string, pistas: Readonly<Record<string, PistaContextual>> = PISTAS_CONTEXTUALES): (PistaContextual & { ruta: string }) | null {
  const ruta = claveDeRuta(pathname);
  const p = Object.hasOwn(pistas, ruta) ? pistas[ruta] : null;
  return p ? { ...p, ruta } : null;
}
