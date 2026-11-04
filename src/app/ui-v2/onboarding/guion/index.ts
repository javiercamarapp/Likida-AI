import type { Recorrido, PasoTour } from '@/app/ui-v2/movimiento/tour/tipos';
import type { PasoGuia } from '@/lib/likida/guia/tipos';
import { PASOS_PM } from './pm';

// Del guion (`PasoGuia`, el contrato) al recorrido que entiende el motor (`PasoTour`). Lo no aprobado NO se publica: `publicables`
// es la única puerta hacia el motor, y con todo en borrador devuelve vacío (el recorrido de siempre sigue sin cambios).

export const GUION: Readonly<Record<string, readonly PasoGuia[]>> = { 'puesta-en-marcha.dueno_ca': PASOS_PM };

export const publicables = (pasos: readonly PasoGuia[]): PasoGuia[] => pasos.filter((p) => p.aprobado);

export function pasoDeGuion(p: PasoGuia): PasoTour | null {
  if (p.tipo === 'mensaje') return null; // el canal de WhatsApp no se renderiza en el panel
  const d = p.deteccion;
  return {
    id: p.id,
    titulo: p.titulo,
    texto: p.texto,
    ...(p.ancla ? { ancla: p.ancla } : {}),
    ruta: p.pantalla.startsWith('/') ? p.pantalla : undefined,
    tipo: p.tipo === 'orientar' ? 'info' : p.tipo,
    ...(p.accion ? { accion: p.accion } : {}),
    ...(p.visual.tipo === 'ilu' ? { ilu: p.visual.id } : {}),
    ...(p.tiempoLimiteMs ? { tiempoLimiteMs: p.tiempoLimiteMs } : {}),
    ...(d.via === 'senal' ? { deteccion: { via: 'senal' as const, senal: d.senal, modo: d.modo } }
      : d.via === 'dom' ? { deteccion: { via: 'dom' as const, evento: d.evento, ancla: d.ancla } }
        : d.via === 'declarada' ? { deteccion: { via: 'declarada' as const, clave: d.clave } } : {}),
  };
}

/** Arma el recorrido del guion. `soloAprobados: false` es para revisar y validar el borrador; el motor SIEMPRE recibe `true`. */
export function recorridoDeGuion(id: string, titulo: string, pasos: readonly PasoGuia[], soloAprobados = true): Recorrido | null {
  const lista = (soloAprobados ? publicables(pasos) : [...pasos]).map(pasoDeGuion).filter((x): x is PasoTour => x !== null);
  if (lista.length === 0) return null;
  return { id, version: Math.max(...pasos.map((p) => p.version)), titulo, pasos: lista };
}
