import type { Ciudad } from '@/lib/likida/geo/ciudades';

/** Km en línea recta (haversine) — se rotula "en línea recta" SIEMPRE: no es el kilometraje de carretera y no se presenta como tal. */
export function kmEntre(a: Pick<Ciudad, 'lat' | 'lng'>, b: Pick<Ciudad, 'lat' | 'lng'>): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}
