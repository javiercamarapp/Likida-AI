import { resolverCiudad } from '@/lib/likida/geo/ciudades';
import type { FilaViaje } from '@/lib/likida/orquestador/tablero_viajes';
import type { PinUnidad, ViajeEnMapa } from '../mapa/mapa-vivo';
import { proyectar } from '../mapa/mexico-geo';
import { kmEntre } from '../mapa/km';

/**
 * Lo que el mapa de «En vivo» dibuja, sacado SOLO de las filas del tablero: un arco por viaje cuyo origen y destino están en el catálogo de
 * ciudades (los demás se declaran en `sinUbicar`, nunca se omiten en silencio) y un rombo por posición medida del tractor, con su
 * antigüedad tal como la calculó el modelo. Nada se estima: sin coordenadas no hay rombo y sin ciudad reconocida no hay arco.
 */
export function mapaDelTablero(filas: readonly FilaViaje[]): { viajes: ViajeEnMapa[]; pines: PinUnidad[]; sinUbicar: number } {
  const viajes: ViajeEnMapa[] = [];
  const pines: PinUnidad[] = [];
  let sinUbicar = 0;
  for (const f of filas) {
    const etiqueta = f.folio ?? f.viajeId.slice(0, 8);
    const origen = resolverCiudad(f.origen);
    const destino = resolverCiudad(f.destino);
    if (origen && destino) {
      const o = proyectar(origen.lat, origen.lng);
      const d = proyectar(destino.lat, destino.lng);
      viajes.push({
        id: f.viajeId, folio: etiqueta, operadorNombre: f.chofer, origenNombre: origen.nombre, destinoNombre: destino.nombre,
        ox: +o.x.toFixed(1), oy: +o.y.toFixed(1), dx: +d.x.toFixed(1), dy: +d.y.toFixed(1),
        dias: null, fotos: 0, escalado: f.escalado !== null && !f.escalado.atendido, kmRecta: kmEntre(origen, destino),
      });
    } else sinUbicar += 1;
    if (f.posicion) {
      const { x, y } = proyectar(f.posicion.lat, f.posicion.lng);
      pines.push({
        unidadId: f.viajeId, etiqueta, placas: null, estadoUnidad: 'en_ruta', x: +x.toFixed(1), y: +y.toFixed(1),
        lat: f.posicion.lat, lng: f.posicion.lng, medidaEn: f.posicion.medidaEn, minutos: f.posicion.antiguedadMin,
        velocidadKmh: null, proveedor: 'gps',
      });
    }
  }
  return { viajes, pines, sinUbicar };
}
