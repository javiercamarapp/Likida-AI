// ═══════════════════════════════════════════════════════════════════════════
// GEOMETRÍA DEL AGENTE 5 — pura, sin I/O.
//
// Haversine con el radio medio de la Tierra (6,371,000 m): la MISMA aritmética
// que la RPC de presencia de la 0207, y la que se verifica a mano. A las
// distancias de un andén (decenas de metros) el error contra el elipsoide es
// de centímetros: mucho menos que el del GPS civil o el del pin de WhatsApp.
// ═══════════════════════════════════════════════════════════════════════════

export const RADIO_TIERRA_M = 6_371_000;

export interface Punto {
  lat: number;
  lng: number;
}

/** Coordenadas finitas y dentro del rango geográfico. */
export function coordenadasValidas(lat: unknown, lng: unknown): boolean {
  return typeof lat === 'number' && typeof lng === 'number'
    && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/** Caja que contiene a México (con holgura). Sirve para cazar lat/lng intercambiadas o un signo perdido, no para geocodificar. */
export function dentroDeMexico(lat: number, lng: number): boolean {
  return lat >= 14 && lat <= 33.5 && lng >= -119 && lng <= -86;
}

const rad = (g: number): number => (g * Math.PI) / 180;

/** Distancia en metros sobre la esfera entre dos puntos. */
export function haversineM(a: Punto, b: Punto): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
