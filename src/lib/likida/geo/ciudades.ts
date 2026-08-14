// ═══════════════════════════════════════════════════════════════════════════
// LAS CIUDADES DEL MAPA — la tabla estática con la que se geocodifican los
// `viaje.origen/destino` (texto libre) SIN llamar a ninguna API: sin llave,
// sin red, determinístico. Coordenadas al centro de la ciudad (una décima de
// grado ≈ 11 km): sobran para ubicar un viaje en un mapa nacional, y NUNCA
// se presentan como posición del camión.
//
// Una ciudad que no está aquí NO revienta nada: `resolverCiudad` devuelve
// null y el viaje se lista aparte ("sin ubicar en el mapa"), jamás se omite
// en silencio ni se le inventa un punto. Agregar una ciudad = una línea.
// ═══════════════════════════════════════════════════════════════════════════

export interface Ciudad {
  nombre: string;
  lat: number;
  lng: number;
}

/** Los nodos logísticos del autotransporte (fronteras, puertos, corredores
 *  del Bajío y las capitales) — el criterio es carga, no población. */
const CIUDADES: Ciudad[] = [
  { nombre: 'Tijuana', lat: 32.52, lng: -117.04 },
  { nombre: 'Mexicali', lat: 32.66, lng: -115.47 },
  { nombre: 'Ensenada', lat: 31.87, lng: -116.6 },
  { nombre: 'Nogales', lat: 31.31, lng: -110.94 },
  { nombre: 'Hermosillo', lat: 29.07, lng: -110.96 },
  { nombre: 'Guaymas', lat: 27.92, lng: -110.9 },
  { nombre: 'Ciudad Obregón', lat: 27.49, lng: -109.94 },
  { nombre: 'Los Mochis', lat: 25.79, lng: -109.0 },
  { nombre: 'Culiacán', lat: 24.81, lng: -107.39 },
  { nombre: 'Mazatlán', lat: 23.25, lng: -106.41 },
  { nombre: 'La Paz', lat: 24.14, lng: -110.31 },
  { nombre: 'Ciudad Juárez', lat: 31.69, lng: -106.42 },
  { nombre: 'Chihuahua', lat: 28.63, lng: -106.08 },
  { nombre: 'Delicias', lat: 28.19, lng: -105.47 },
  { nombre: 'Torreón', lat: 25.54, lng: -103.41 },
  { nombre: 'Durango', lat: 24.02, lng: -104.65 },
  { nombre: 'Zacatecas', lat: 22.77, lng: -102.58 },
  { nombre: 'Saltillo', lat: 25.42, lng: -101.0 },
  { nombre: 'Monclova', lat: 26.9, lng: -101.42 },
  { nombre: 'Piedras Negras', lat: 28.7, lng: -100.52 },
  { nombre: 'Monterrey', lat: 25.67, lng: -100.31 },
  { nombre: 'Nuevo Laredo', lat: 27.48, lng: -99.51 },
  { nombre: 'Reynosa', lat: 26.09, lng: -98.28 },
  { nombre: 'Matamoros', lat: 25.87, lng: -97.5 },
  { nombre: 'Ciudad Victoria', lat: 23.73, lng: -99.14 },
  { nombre: 'Tampico', lat: 22.23, lng: -97.86 },
  { nombre: 'Altamira', lat: 22.39, lng: -97.94 },
  { nombre: 'San Luis Potosí', lat: 22.15, lng: -100.98 },
  { nombre: 'Aguascalientes', lat: 21.88, lng: -102.29 },
  { nombre: 'Tepic', lat: 21.5, lng: -104.89 },
  { nombre: 'Puerto Vallarta', lat: 20.62, lng: -105.23 },
  { nombre: 'Guadalajara', lat: 20.67, lng: -103.35 },
  { nombre: 'León', lat: 21.12, lng: -101.68 },
  { nombre: 'Guanajuato', lat: 21.02, lng: -101.26 },
  { nombre: 'Silao', lat: 20.94, lng: -101.43 },
  { nombre: 'Irapuato', lat: 20.67, lng: -101.35 },
  { nombre: 'Salamanca', lat: 20.57, lng: -101.2 },
  { nombre: 'Celaya', lat: 20.52, lng: -100.81 },
  { nombre: 'Querétaro', lat: 20.59, lng: -100.39 },
  { nombre: 'San Juan del Río', lat: 20.39, lng: -100.0 },
  { nombre: 'Morelia', lat: 19.7, lng: -101.19 },
  { nombre: 'Uruapan', lat: 19.41, lng: -102.06 },
  { nombre: 'Lázaro Cárdenas', lat: 17.96, lng: -102.2 },
  { nombre: 'Manzanillo', lat: 19.05, lng: -104.32 },
  { nombre: 'Colima', lat: 19.24, lng: -103.72 },
  { nombre: 'Toluca', lat: 19.29, lng: -99.66 },
  { nombre: 'Ciudad de México', lat: 19.43, lng: -99.13 },
  { nombre: 'Pachuca', lat: 20.12, lng: -98.74 },
  { nombre: 'Cuernavaca', lat: 18.92, lng: -99.23 },
  { nombre: 'Puebla', lat: 19.04, lng: -98.2 },
  { nombre: 'Tlaxcala', lat: 19.32, lng: -98.24 },
  { nombre: 'Tehuacán', lat: 18.46, lng: -97.39 },
  { nombre: 'Poza Rica', lat: 20.53, lng: -97.46 },
  { nombre: 'Xalapa', lat: 19.54, lng: -96.91 },
  { nombre: 'Veracruz', lat: 19.19, lng: -96.14 },
  { nombre: 'Córdoba', lat: 18.89, lng: -96.93 },
  { nombre: 'Orizaba', lat: 18.85, lng: -97.1 },
  { nombre: 'Coatzacoalcos', lat: 18.13, lng: -94.46 },
  { nombre: 'Minatitlán', lat: 17.99, lng: -94.55 },
  { nombre: 'Villahermosa', lat: 17.99, lng: -92.93 },
  { nombre: 'Tuxtla Gutiérrez', lat: 16.75, lng: -93.12 },
  { nombre: 'Tapachula', lat: 14.9, lng: -92.26 },
  { nombre: 'Oaxaca', lat: 17.06, lng: -96.72 },
  { nombre: 'Salina Cruz', lat: 16.17, lng: -95.2 },
  { nombre: 'Acapulco', lat: 16.86, lng: -99.88 },
  { nombre: 'Chilpancingo', lat: 17.55, lng: -99.5 },
  { nombre: 'Iguala', lat: 18.35, lng: -99.54 },
  { nombre: 'Campeche', lat: 19.85, lng: -90.53 },
  { nombre: 'Mérida', lat: 20.97, lng: -89.62 },
  { nombre: 'Progreso', lat: 21.28, lng: -89.66 },
  { nombre: 'Cancún', lat: 21.16, lng: -86.85 },
  { nombre: 'Playa del Carmen', lat: 20.63, lng: -87.07 },
  { nombre: 'Chetumal', lat: 18.5, lng: -88.3 },
];

/** Los apodos con los que el despachador escribe la misma ciudad. */
const ALIAS: Record<string, string> = {
  'cdmx': 'Ciudad de México',
  'mexico': 'Ciudad de México',
  'mexico df': 'Ciudad de México',
  'mexico d f': 'Ciudad de México',
  'df': 'Ciudad de México',
  'd f': 'Ciudad de México',
  'gdl': 'Guadalajara',
  'mty': 'Monterrey',
  'slp': 'San Luis Potosí',
  'qro': 'Querétaro',
  'juarez': 'Ciudad Juárez',
  'obregon': 'Ciudad Obregón',
  'victoria': 'Ciudad Victoria',
  'laredo': 'Nuevo Laredo',
  'vallarta': 'Puerto Vallarta',
  'tuxtla': 'Tuxtla Gutiérrez',
};

/** minúsculas, sin acentos, sin puntuación, sin "cd/ciudad" inicial y sin lo
 *  que venga tras una coma ("Guadalajara, Jal." → "guadalajara"). */
function normalizar(texto: string): string {
  const base = texto.split(',')[0]
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return base.replace(/^(cd|ciudad) (?!de mexico|juarez|obregon|victoria)/, '').trim();
}

const INDICE = new Map<string, Ciudad>();
for (const c of CIUDADES) INDICE.set(normalizar(c.nombre), c);
for (const [apodo, nombre] of Object.entries(ALIAS)) {
  const c = CIUDADES.find((x) => x.nombre === nombre);
  if (c) INDICE.set(apodo, c);
}

/**
 * El origen/destino tal como lo tecleó el despachador → la ciudad de la
 * tabla, o `null`. Null NO es error: es "esta ciudad no está en el mapa
 * todavía", y la página lo dice con esas palabras.
 */
export function resolverCiudad(texto: string | null | undefined): Ciudad | null {
  if (!texto) return null;
  const n = normalizar(texto);
  if (!n) return null;
  return INDICE.get(n)
    ?? INDICE.get(n.replace(/^(cd|ciudad) /, ''))
    // "S.L.P." normaliza a "s l p" y el apodo vive como "slp".
    ?? INDICE.get(n.replaceAll(' ', ''))
    ?? null;
}
