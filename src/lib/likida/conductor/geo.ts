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

// ═══════════════════════════════════════════════════════════════════════════
// «¿ESTÁ DENTRO DE LA GEOCERCA?» — EL HELPER ÚNICO (P1, ola 4b).
//
// Conductor (validar hito), Convenios (acercamiento) y Peajes (reclamación) preguntan
// lo mismo; antes cada uno medía «distancia al centro ≤ radio» y un polígono real
// (patio alargado junto a una carretera) se aproximaba por un círculo +5 %, que
// abarcaba la carretera y acusaba a unidades que solo pasaban.
//
//  · Con POLÍGONO nativo: punto en polígono (más un margen opcional medido al BORDE).
//  · Sin polígono: círculo (centro + radio + margen). Si la geocerca declara
//    `aproximada` (el círculo SUSTITUYE a un polígono del cliente que no se pudo
//    guardar), el resultado lo dice y quien acusa debe bajar su confianza.
//
// Pura, sin I/O. El cálculo del polígono usa una proyección plana local (equirectangular
// alrededor del punto): a las escalas de un patio o una planta (cientos de metros a
// pocos km) el error es de centímetros, muy por debajo del de un GPS civil.
// ═══════════════════════════════════════════════════════════════════════════

export const MIN_VERTICES_POLIGONO = 3;
export const MAX_VERTICES_POLIGONO = 500;

export interface GeocercaGeom {
  lat: number;
  lng: number;
  radioM: number;
  /** Vértices del polígono nativo (sin repetir el primero). null/ausente = círculo. */
  poligono?: readonly Punto[] | null;
  /** El círculo sustituye a un polígono del cliente que no se guardó: la decisión es MENOS fiable. */
  aproximada?: boolean;
}

export interface ResultadoDentro {
  dentro: boolean;
  /** Distancia al BORDE de la geocerca (m, 0 si está dentro del polígono; en círculo, distancia al centro menos el radio, mín. 0). */
  distanciaBordeM: number;
  /** Con qué se decidió. */
  metodo: 'poligono' | 'circulo';
  /** true solo si se decidió con un círculo que sustituye a un polígono (la acusación debe bajar de confianza). */
  aproximada: boolean;
}

/**
 * Vértices válidos de un jsonb de la base: arreglo de {lat,lng} entre 3 y 500, todos con coordenadas válidas.
 * Devuelve null si NO es un polígono usable (no se arregla ni se recorta en silencio).
 */
export function leerPoligono(valor: unknown): Punto[] | null {
  if (!Array.isArray(valor) || valor.length < MIN_VERTICES_POLIGONO || valor.length > MAX_VERTICES_POLIGONO) return null;
  const salida: Punto[] = [];
  for (const v of valor) {
    if (typeof v !== 'object' || v === null) return null;
    const { lat, lng } = v as { lat?: unknown; lng?: unknown };
    if (typeof lat !== 'number' || typeof lng !== 'number' || !coordenadasValidas(lat, lng)) return null;
    salida.push({ lat, lng });
  }
  return salida;
}

/** Área (m², con signo no importa) de un polígono, en proyección plana local: 0 = degenerado (colineal o repetido). */
export function areaPoligonoM2(poligono: readonly Punto[]): number {
  if (poligono.length < MIN_VERTICES_POLIGONO) return 0;
  const ref = poligono[0];
  const k = Math.cos(rad(ref.lat));
  let s = 0;
  const xy = poligono.map((p) => ({ x: rad(p.lng - ref.lng) * RADIO_TIERRA_M * k, y: rad(p.lat - ref.lat) * RADIO_TIERRA_M }));
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i]; const b = xy[(i + 1) % xy.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** Un polígono guardable: vértices válidos, entre 3 y 500, con área real (no una línea ni un punto repetido). */
export function poligonoGuardable(poligono: readonly Punto[] | null | undefined): boolean {
  if (!poligono || poligono.length < MIN_VERTICES_POLIGONO || poligono.length > MAX_VERTICES_POLIGONO) return false;
  if (!poligono.every((p) => coordenadasValidas(p.lat, p.lng))) return false;
  return areaPoligonoM2(poligono) > 1;
}

function distanciaASegmento(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax; const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Punto en polígono (par-impar) y distancia al borde (m), en proyección plana local centrada en el punto. */
function medirContraPoligono(p: Punto, poligono: readonly Punto[]): { dentro: boolean; bordeM: number } {
  const k = Math.cos(rad(p.lat));
  const xy = poligono.map((v) => ({ x: rad(v.lng - p.lng) * RADIO_TIERRA_M * k, y: rad(v.lat - p.lat) * RADIO_TIERRA_M }));
  let dentro = false;
  let bordeM = Infinity;
  for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) {
    const a = xy[i]; const b = xy[j];
    // El punto es el origen (0,0).
    if ((a.y > 0) !== (b.y > 0) && 0 < ((b.x - a.x) * (0 - a.y)) / (b.y - a.y) + a.x) dentro = !dentro;
    bordeM = Math.min(bordeM, distanciaASegmento(0, 0, a.x, a.y, b.x, b.y));
  }
  return { dentro, bordeM };
}

/**
 * El punto, ¿cae en la geocerca? `margenM` se suma al borde (la tolerancia de la flota: el GPS civil y el pin no son
 * exactos). Un punto con coordenadas inválidas NUNCA está dentro.
 */
export function dentroDeGeocerca(punto: Punto, g: GeocercaGeom, margenM = 0): ResultadoDentro {
  const margen = Number.isFinite(margenM) && margenM > 0 ? margenM : 0;
  if (!coordenadasValidas(punto.lat, punto.lng)) return { dentro: false, distanciaBordeM: Infinity, metodo: g.poligono ? 'poligono' : 'circulo', aproximada: false };
  const poli = g.poligono && g.poligono.length >= MIN_VERTICES_POLIGONO ? g.poligono : null;
  if (poli) {
    const m = medirContraPoligono(punto, poli);
    const borde = m.dentro ? 0 : m.bordeM;
    return { dentro: m.dentro || borde <= margen, distanciaBordeM: borde, metodo: 'poligono', aproximada: false };
  }
  const d = haversineM(punto, { lat: g.lat, lng: g.lng });
  // En metros enteros, como siempre se midió el círculo (es la distancia que se guarda y se enseña): el borde exacto cuenta como dentro.
  return { dentro: Math.round(d) <= g.radioM + margen, distanciaBordeM: Math.max(0, d - g.radioM), metodo: 'circulo', aproximada: g.aproximada === true };
}
