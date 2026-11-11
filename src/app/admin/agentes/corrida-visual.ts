import type { TonoEstado } from '@/app/ui-v2/componentes';

const HORAS = 3_600_000;

/** «hace 70 días» / «hace 5 h»: la antigüedad en palabras, calculada del instante real (nunca inventada). Es dato de apoyo en gris: el tono NO sale de aquí. */
export function haceTiempo(inicioIso: string, ahora: number): string {
  const h = Math.max(0, (ahora - Date.parse(inicioIso)) / HORAS);
  if (h < 1) return 'hace menos de 1 h';
  if (h < 48) return `hace ${Math.floor(h)} h`;
  return `hace ${Math.floor(h / 24)} días`;
}

/** El RESULTADO de la última corrida, dicho con texto. Rojo solo si de verdad falló; parcial va en ámbar; «ok» es texto llano (sin chip: no es un aviso).
 *  Antes la FECHA se pintaba en rojo por antigüedad aunque la corrida hubiera terminado bien, y parecía un error. */
export function resultadoCorrida(estado: string): { texto: string; tono: TonoEstado | null } {
  if (estado === 'ok') return { texto: 'Terminó bien', tono: null };
  if (estado === 'parcial') return { texto: 'Terminó parcial', tono: 'warn' };
  if (estado === 'fallo') return { texto: 'Terminó con fallo', tono: 'bad' };
  return { texto: `Terminó: ${estado}`, tono: 'neutral' };
}
