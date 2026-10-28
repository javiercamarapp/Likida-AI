import type { PosicionConViaje } from './viajes_fuente';
import { haversineM, coordenadasValidas } from './geo';
import { fechaHoraEnZona, TZ_MX } from '@/lib/formato';

// ═══════════════════════════════════════════════════════════════════════════
// LAS POSICIONES LOCALES CON `despacho_ref` → LO QUE EL CRUCE CON VIAJE ENTIENDE.
//
// `posicion` (0050) guarda lat/lng por unidad y, desde la 0780, el `despacho_ref`
// que el TMS del cliente entrega con cada posición (el `Icident`). A diferencia
// de la lista de puntos de interés del TMS, la tabla local NO trae el nombre de
// la caseta: se deduce SOLO si la posición cae dentro del radio de una caseta
// del catálogo con coordenadas (la más cercana). Una posición que no está en
// ninguna caseta no sirve para ligar un cobro y se descarta; nunca se inventa
// una caseta. PURO: sin base ni red.
// ═══════════════════════════════════════════════════════════════════════════

export interface FilaPosicionDespacho {
  unidadId: string;
  lat: number;
  lng: number;
  /** ISO con zona (timestamptz). */
  medidaEn: string;
  despachoRef: string;
}

export interface CasetaConCoordenadas {
  nombre: string;
  lat: number;
  lng: number;
  radioM: number;
}

/** Un instante ISO → 'YYYY-MM-DDTHH:MM' en hora local de México (la que usa el archivo del proveedor). Minutos: la ventana de cruce es de ±30 min. */
export function aHoraLocalMx(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return fechaHoraEnZona(new Date(ms), TZ_MX).replace(' ', 'T');
}

export interface ResultadoPosicionesDespacho {
  posiciones: PosicionConViaje[];
  /** Filas que no se pudieron usar, por motivo (para decirlo, no para esconderlo). */
  descartadas: { sinUnidad: number; sinCaseta: number; invalidas: number };
}

/**
 * @param numeroPorUnidadId  unidad.id → número económico (una posición sin unidad con número no liga nada).
 */
export function posicionesConDespacho(
  filas: readonly FilaPosicionDespacho[],
  numeroPorUnidadId: ReadonlyMap<string, string>,
  casetas: readonly CasetaConCoordenadas[],
): ResultadoPosicionesDespacho {
  const descartadas = { sinUnidad: 0, sinCaseta: 0, invalidas: 0 };
  const posiciones: PosicionConViaje[] = [];
  for (const f of filas) {
    const ref = f.despachoRef.trim();
    const hora = aHoraLocalMx(f.medidaEn);
    if (!ref || hora === null || !coordenadasValidas({ lat: f.lat, lng: f.lng })) { descartadas.invalidas++; continue; }
    const unidad = numeroPorUnidadId.get(f.unidadId);
    if (!unidad) { descartadas.sinUnidad++; continue; }
    let mejor: { c: CasetaConCoordenadas; d: number } | null = null;
    for (const c of casetas) {
      const d = haversineM({ lat: f.lat, lng: f.lng }, c);
      if (d <= c.radioM && (mejor === null || d < mejor.d)) mejor = { c, d };
    }
    if (!mejor) { descartadas.sinCaseta++; continue; }
    posiciones.push({ unidad, icident: ref, puntoInteres: mejor.c.nombre, fechaHoraLocal: hora, lat: f.lat, lng: f.lng });
  }
  return { posiciones, descartadas };
}
