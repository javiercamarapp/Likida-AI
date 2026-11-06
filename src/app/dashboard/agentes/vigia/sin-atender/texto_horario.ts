import type { ConfigGuardadaSinAtender } from '@/lib/likida/vigia/sin_atender_aviso/motor';

/** Texto llano del horario guardado, o null si no hay horario (entonces la espera cuenta minutos corridos). */
export function textoHorario(h: ConfigGuardadaSinAtender['horarioAtencion']): string | null {
  if (!h) return null;
  const nombres: Record<number, string> = { 0: 'dom', 1: 'lun', 2: 'mar', 3: 'mié', 4: 'jue', 5: 'vie', 6: 'sáb' };
  const dias = h.diasHabiles ? h.diasHabiles.map((d) => nombres[d] ?? String(d)).join(', ') : 'todos los días';
  return `de ${h.desdeHora}:00 a ${h.hastaHora}:00 h (${dias})`;
}
