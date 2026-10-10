import { correrCicloVivo, type ResultadoCicloVivo } from './ciclo_cron';
import { depsAvisoReales, depsBarridoReales, puertoCicloVivoReal } from './fuentes_reales';

/** El ciclo vivo del orquestador con las dependencias reales: lo llama el cron `escalar` (un solo import dinámico). */
export function correrOrquestadorVivo(opciones: { venceEn: number }): Promise<ResultadoCicloVivo> {
  return correrCicloVivo(puertoCicloVivoReal(), depsBarridoReales(), depsAvisoReales(), { venceEn: opciones.venceEn });
}
