// Reglas de un hilo abierto: motivos, nivel y umbral aplicado.
import type { ItemAbierto } from './hilos';
import { minutosEnHorario } from './horario';
import type { ConfigSinAtender, MotivoSinAtender, NivelAlerta } from './tipos';

export interface Evaluacion {
  motivos: MotivoSinAtender[];
  nivel: NivelAlerta;
  umbralAplicadoMin: number;
  antiguedadMin: number;
  excesoMin: number;
  preguntas: number;
}

/** ¿Hay `n` mensajes seguidos dentro de una ventana de `ventanaMin`? (items ordenados por tiempo; dos punteros). */
export function hayInsistencia(items: readonly ItemAbierto[], n: number, ventanaMin: number): boolean {
  if (n <= 0 || items.length < n) return false;
  const ventanaMs = ventanaMin * 60_000;
  for (let i = 0; i + n - 1 < items.length; i += 1) {
    if (items[i + n - 1].ms - items[i].ms <= ventanaMs) return true;
  }
  return false;
}

/**
 * Un hilo es alerta si ya esperó más que su umbral o si el cliente insistió. Urgencia, pregunta y palabra clave explican
 * el motivo y suben el nivel, pero no crean alerta por sí solas (un mensaje de hace un minuto aún no está «sin atender»).
 * Devuelve null si no es alerta.
 */
export function evaluarHilo(items: readonly ItemAbierto[], critico: boolean, config: ConfigSinAtender, fotoMs: number): Evaluacion | null {
  if (items.length === 0) return null;
  const desdeMs = items[0].ms;
  const antiguedadMin = config.horarioAtencion
    ? minutosEnHorario(desdeMs, fotoMs, config.horarioAtencion, config.zona, config.festivos)
    : Math.max(0, Math.floor((fotoMs - desdeMs) / 60_000));
  const urgencia = items.some((i) => i.urgente);
  const clave = items.some((i) => i.clave);
  const preguntas = items.filter((i) => i.pregunta).length;

  const base = critico ? config.umbralCriticoMin : config.umbralMin;
  const umbralAplicadoMin = urgencia || clave ? Math.min(base, config.umbralUrgenteMin) : base;

  const espera = antiguedadMin >= umbralAplicadoMin;
  const insiste = hayInsistencia(items, config.insistenciaMin, config.insistenciaVentanaMin);
  if (!espera && !insiste) return null;

  const motivos: MotivoSinAtender[] = [];
  if (espera) motivos.push('espera_sobre_umbral');
  if (insiste) motivos.push('insistencia');
  if (urgencia) motivos.push('urgencia');
  if (preguntas > 0) motivos.push('pregunta');
  if (clave) motivos.push('palabra_clave');

  const nivel: NivelAlerta = urgencia || clave || (preguntas > 0 && espera) ? 'alta' : 'normal';
  return { motivos, nivel, umbralAplicadoMin, antiguedadMin, excesoMin: Math.max(0, antiguedadMin - umbralAplicadoMin), preguntas };
}
