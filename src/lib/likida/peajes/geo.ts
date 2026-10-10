// ═══════════════════════════════════════════════════════════════════════════
// GEOMETRÍA DEL CRUCE POR CASETA — pura, sin base ni red.
//
// Haversine (distancia sobre la esfera) y distancia de un punto a un segmento
// de trayectoria. La esfera usa el radio medio de la Tierra (6,371,008.8 m):
// el error contra el elipsoide WGS84 es < 0.5%, inocuo frente a un radio de
// caseta de cientos de metros y a ~10 m de error del GPS civil.
// ═══════════════════════════════════════════════════════════════════════════

export const RADIO_TIERRA_M = 6_371_008.8;

export interface Punto { lat: number; lng: number }

const rad = (g: number) => (g * Math.PI) / 180;

export function coordenadasValidas(p: Punto): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

/** Distancia en metros entre dos puntos (fórmula de Haversine). NaN si alguna coordenada es inválida. */
export function haversineM(a: Punto, b: Punto): number {
  if (!coordenadasValidas(a) || !coordenadasValidas(b)) return Number.NaN;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Distancia (m) del punto `p` al segmento `a`–`b`, en un plano local centrado en
 * `p` (equirectangular). Válido para segmentos de decenas de km: el error de la
 * proyección a esa escala es de metros. Si a == b es la distancia al punto.
 */
export function distanciaPuntoSegmentoM(p: Punto, a: Punto, b: Punto): number {
  if (!coordenadasValidas(p) || !coordenadasValidas(a) || !coordenadasValidas(b)) return Number.NaN;
  const k = Math.cos(rad(p.lat));
  const aX = rad(a.lng - p.lng) * k * RADIO_TIERRA_M;
  const aY = rad(a.lat - p.lat) * RADIO_TIERRA_M;
  const bX = rad(b.lng - p.lng) * k * RADIO_TIERRA_M;
  const bY = rad(b.lat - p.lat) * RADIO_TIERRA_M;
  const dx = bX - aX;
  const dy = bY - aY;
  const largo2 = dx * dx + dy * dy;
  if (largo2 === 0) return Math.hypot(aX, aY);
  // Proyección de p (el origen) sobre la recta, acotada al segmento.
  const t = Math.max(0, Math.min(1, -(aX * dx + aY * dy) / largo2));
  return Math.hypot(aX + t * dx, aY + t * dy);
}
